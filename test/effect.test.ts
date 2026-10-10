import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect } from "effect";
import type { Honcho } from "@honcho-ai/sdk";
import { parseEnvConfig } from "../src/config.js";
import { resolveAiPeer, resolveIdentityPair, resolveUserPeer } from "../src/identity.js";
import { MissingIdentityError } from "../src/errors.js";
import { ToolDepsService } from "../src/honcho.js";
import { runTool } from "../src/run.js";
import type { ToolDeps } from "../src/deps.js";
import { makeConclusion, makeStubDeps } from "./stubs.js";

const cfgWithIdentity = () =>
  parseEnvConfig({
    HONCHO_WORKSPACE_ID: "my-workspace",
    HONCHO_USER_PEER_ID: "userA",
    HONCHO_AI_PEER_ID: "assistant",
  });

function depsWith(config = cfgWithIdentity(), honcho?: Partial<Honcho>): ToolDeps {
  return makeStubDeps(config, honcho);
}

function runId<T0, E0>(
  effect: Effect.Effect<T0, E0, ToolDepsService>,
  deps: ToolDeps,
) {
  return Effect.runPromise(Effect.provideService(effect, ToolDepsService, deps));
}

test("resolveAiPeer: explicit argument wins over env default", async () => {
  const id = await runId(resolveAiPeer("alt-peer"), depsWith());
  assert.equal(id, "alt-peer");
});

test("resolveAiPeer: falls back to HONCHO_AI_PEER_ID", async () => {
  const id = await runId(resolveAiPeer(undefined), depsWith());
  assert.equal(id, "assistant");
});

test("resolveUserPeer: falls back to HONCHO_USER_PEER_ID", async () => {
  const id = await runId(resolveUserPeer(undefined), depsWith());
  assert.equal(id, "userA");
});

test("resolveIdentityPair / missing identity: typed error with helpful message", async () => {
  const bare = depsWith(parseEnvConfig({}));
  const err = await runId(resolveIdentityPair(undefined, undefined), bare).then(
    () => null,
    (e) => e,
  );
  assert.ok(err instanceof MissingIdentityError);
  assert.equal(err.kind, "ai");
  assert.match(err.message, /HONCHO_AI_PEER_ID/);

  const err2 = await runId(resolveUserPeer(undefined), bare).then(
    () => null,
    (e) => e,
  );
  assert.ok(err2 instanceof MissingIdentityError);
  assert.equal(err2.kind, "user");
  assert.match(err2.message, /HONCHO_USER_PEER_ID/);
});

test("runTool: success value becomes text content", async () => {
  const result = await runTool(
    Effect.gen(function* () {
      yield* ToolDepsService;
      return { hello: "world" };
    }),
    depsWith(),
  );
  assert.deepEqual(result, {
    content: [{ type: "text", text: '{"hello":"world"}' }],
  });
});

test("runTool: typed failure becomes isError with message", async () => {
  const result = await runTool(
    Effect.gen(function* () {
      const d = yield* ToolDepsService;
      return (yield* d.honchoFor()) ? "unreachable" : "unreachable";
    }),
    depsWith(parseEnvConfig({})), // no workspace default
  );
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /Missing workspace_id/);
});

test("honchoFor: resolves workspace default and caches per workspace", async () => {
  const deps = depsWith();
  const a = await runId(deps.honchoFor(undefined), deps);
  const b = await runId(deps.honchoFor("my-workspace"), deps);
  const c = await runId(deps.honchoFor("other"), deps);
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test("stub honcho: peer card + conclusions round trip shape", async () => {
  const deps = depsWith();
  const honcho = await runId(deps.honchoFor(), deps);
  const peer = await honcho.peer("assistant");
  assert.deepEqual(await peer.getCard("userA"), ["likes tea"]);
  const view = peer.conclusionsOf("userA");
  const page = await view.list({});
  assert.equal(page.total, 1);
  assert.equal(makeConclusion("c1", "fact one").content, "fact one");
});