import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseEnvConfig,
  parseTimeoutMs,
  parseReasoningLevel,
  resolveWorkspaceId,
  createClientFactory,
  missingIdentityMessage,
} from "../src/config.js";
import { resolveAiPeerId, resolveUserPeerId } from "../src/identity.js";
import type { ToolContext } from "../src/types.js";

test("parseEnvConfig: all values from env", () => {
  const config = parseEnvConfig({
    HONCHO_API_KEY: "  hch-test  ",
    HONCHO_API_URL: " http://localhost:8000 ",
    HONCHO_WORKSPACE_ID: " my-workspace ",
    HONCHO_USER_PEER_ID: " sam ",
    HONCHO_AI_PEER_ID: " assistant ",
    HONCHO_REASONING_LEVEL: "HIGH",
    HONCHO_TIMEOUT_MS: "5000",
  });
  assert.equal(config.apiKey, "hch-test");
  assert.equal(config.baseUrl, "http://localhost:8000");
  assert.equal(config.workspaceId, "my-workspace");
  assert.equal(config.userPeerId, "sam");
  assert.equal(config.aiPeerId, "assistant");
  assert.equal(config.reasoningLevel, "high");
  assert.equal(config.timeoutMs, 5000);
});

test("parseEnvConfig: empty strings fall back to defaults", () => {
  const config = parseEnvConfig({
    HONCHO_API_KEY: "",
    HONCHO_API_URL: "",
    HONCHO_WORKSPACE_ID: "",
    HONCHO_USER_PEER_ID: "",
    HONCHO_AI_PEER_ID: "",
    HONCHO_REASONING_LEVEL: "",
    HONCHO_TIMEOUT_MS: "",
  });
  assert.equal(config.apiKey, undefined);
  assert.equal(config.baseUrl, "https://api.honcho.dev");
  assert.equal(config.workspaceId, undefined);
  assert.equal(config.userPeerId, undefined);
  assert.equal(config.aiPeerId, undefined);
  assert.equal(config.reasoningLevel, undefined);
  assert.equal(config.timeoutMs, 300000);
});

test("parseTimeoutMs: invalid values fall back to default", () => {
  assert.equal(parseTimeoutMs(undefined), 300000);
  assert.equal(parseTimeoutMs("nope"), 300000);
  assert.equal(parseTimeoutMs("-5"), 300000);
  assert.equal(parseTimeoutMs("0"), 300000);
  assert.equal(parseTimeoutMs("42"), 42);
});

test("parseReasoningLevel: valid/invalid", () => {
  assert.equal(parseReasoningLevel("max"), "max");
  assert.equal(parseReasoningLevel("Medium"), "medium");
  assert.equal(parseReasoningLevel("bogus"), undefined);
  assert.equal(parseReasoningLevel(undefined), undefined);
});

test("resolveWorkspaceId: argument beats env default; error when unresolvable", () => {
  const config = parseEnvConfig({ HONCHO_WORKSPACE_ID: "my-workspace" });
  assert.equal(resolveWorkspaceId(config), "my-workspace");
  assert.equal(resolveWorkspaceId(config, " other "), "other");
  const bare = parseEnvConfig({});
  assert.throws(
    () => resolveWorkspaceId(bare),
    /Missing workspace_id/,
  );
});

test("resolveUserPeerId / resolveAiPeerId: overrides and defaults", () => {
  const ctx = {
    config: parseEnvConfig({
      HONCHO_USER_PEER_ID: "sam",
      HONCHO_AI_PEER_ID: "assistant",
    }),
  } as unknown as ToolContext;

  assert.equal(resolveUserPeerId(ctx, " alt "), "alt");
  assert.equal(resolveUserPeerId(ctx), "sam");
  assert.equal(resolveAiPeerId(ctx, "alt-peer"), "alt-peer");
  assert.equal(resolveAiPeerId(ctx), "assistant");

  const bare = { config: parseEnvConfig({}) } as unknown as ToolContext;
  assert.throws(() => resolveUserPeerId(bare), /HONCHO_USER_PEER_ID/);
  assert.throws(() => resolveAiPeerId(bare), /HONCHO_AI_PEER_ID/);
  assert.match(missingIdentityMessage("ai peer"), /HONCHO_AI_PEER_ID/);
});

test("createClientFactory: throws without workspace, caches per workspace", () => {
  const config = parseEnvConfig({ HONCHO_WORKSPACE_ID: "my-workspace" });
  const factory = createClientFactory(config);
  const a = factory();
  const b = factory("my-workspace");
  assert.equal(a, b);
  const c = factory("other");
  assert.notEqual(a, c);
  const bare = createClientFactory(parseEnvConfig({}));
  assert.throws(() => bare(), /Missing workspace_id/);
});