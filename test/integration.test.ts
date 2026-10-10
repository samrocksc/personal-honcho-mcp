import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect } from "effect";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { ToolDepsService } from "../src/honcho.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { parseEnvConfig } from "../src/config.js";
import { createServer } from "../src/server.js";
import { makeStubDeps } from "./stubs.js";
import type { ToolDeps } from "../src/deps.js";

async function connect(deps: ToolDeps) {
  const server = createServer(deps);
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientTransport);
  return client;
}

const depsWithIdentity = makeStubDeps(
  parseEnvConfig({
    HONCHO_WORKSPACE_ID: "my-workspace",
    HONCHO_USER_PEER_ID: "userA",
    HONCHO_AI_PEER_ID: "assistant",
  }),
);

const bareDeps = makeStubDeps(parseEnvConfig({}));

test("every tool registers and lists over the MCP protocol", async () => {
  const client = await connect(depsWithIdentity);
  const { tools } = await client.listTools();
  assert.equal(tools.length, 53);
  const names = new Set(tools.map((t) => t.name));
  assert.deepEqual(
    [
      "get_my_peer_card",
      "set_my_peer_card",
      "get_ai_peer_card",
      "set_ai_peer_card",
      "chat_about_me",
      "chat_as_user",
      "get_my_context",
      "get_my_representation",
      "conclude_about_me",
      "list_my_conclusions",
      "query_my_conclusions",
      "update_my_conclusion",
      "delete_my_conclusion",
    ].every((n) => names.has(n)),
    true,
    "identity tool set missing",
  );
  await client.close();
});

test("get_my_peer_card defaults identities from server config", async () => {
  const client = await connect(depsWithIdentity);
  const result = await client.callTool({ name: "get_my_peer_card", arguments: {} });
  assert.equal(result.isError, undefined);
  const text = (result.content as Array<{ text: string }>)[0].text;
  assert.deepEqual(JSON.parse(text), ["likes tea"]);
  await client.close();
});

test("missing identity surfaces a typed, helpful error", async () => {
  const client = await connect(bareDeps);
  const result = await client.callTool({ name: "get_my_peer_card", arguments: {} });
  assert.equal(result.isError, true);
  const text = (result.content as Array<{ text: string }>)[0].text;
  assert.match(text, /Missing AI peer.*HONCHO_AI_PEER_ID/);
  await client.close();
});

test("missing workspace surfaces a typed, helpful error", async () => {
  const client = await connect(bareDeps);
  const result = await client.callTool({ name: "list_peers", arguments: {} });
  assert.equal(result.isError, true);
  const text = (result.content as Array<{ text: string }>)[0].text;
  assert.match(text, /Missing workspace_id/);
  await client.close();
});

test("conclude_about_me creates and list_my_conclusions reviews", async () => {
  const client = await connect(depsWithIdentity);
  const created = await client.callTool({
    name: "conclude_about_me",
    arguments: { conclusions: ["likes tea", "prefers node"] },
  });
  const createdText = (created.content as Array<{ text: string }>)[0].text;
  const createdBody = JSON.parse(createdText) as {
    created: Array<{ id: string }>;
    count: number;
  };
  assert.equal(createdBody.count, 2);
  assert.equal(createdBody.created[0].id, "new-0");

  const listed = await client.callTool({
    name: "list_my_conclusions",
    arguments: {},
  });
  const listedBody = JSON.parse(
    (listed.content as Array<{ text: string }>)[0].text,
  ) as { total: number };
  assert.equal(listedBody.total, 1);
  await client.close();
});

test("chat_about_me routes through the stub's chat", async () => {
  const client = await connect(depsWithIdentity);
  const result = await client.callTool({
    name: "chat_about_me",
    arguments: { query: "what does the user like?" },
  });
  const text = (result.content as Array<{ text: string }>)[0].text;
  assert.equal(
    text,
    "echo:what does the user like?",
  );
  await client.close();
});

test("update_my_conclusion fetch-delete-recreates preserving metadata", async () => {
  const client = await connect(depsWithIdentity);
  // The stub's conclusions.get returns a conclusion with sessionId: null;
  // the update path should delete id and return the replacement.
  const result = await client.callTool({
    name: "update_my_conclusion",
    arguments: { conclusion_id: "c1", content: "likes oolong" },
  });
  const body = JSON.parse(
    (result.content as Array<{ text: string }>)[0].text,
  ) as { deleted_id: string; new_conclusion: { id: string; content: string } };
  assert.equal(body.deleted_id, "c1");
  assert.equal(body.new_conclusion.content, "likes oolong");
  await client.close();
});

test("Effect bootstrap: runTool maps defects to error results", async () => {
  const { runTool } = await import("../src/run.js");
  const boom = Effect.gen(function* () {
    yield* ToolDepsService;
    throw new Error("kaboom");
  });
  const result = await runTool(boom, depsWithIdentity);
  assert.equal(result.isError, true);
  assert.match((result.content as Array<{ text: string }>)[0].text, /kaboom/);
});