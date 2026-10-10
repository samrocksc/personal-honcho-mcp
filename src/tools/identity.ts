import { z } from "zod";
import { Effect } from "effect";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolDeps } from "../deps.js";
import { ToolDepsService, apiCall } from "../honcho.js";
import { runTool } from "../run.js";
import { resolveAiPeer, resolveIdentityPair, resolveUserPeer } from "../identity.js";
import { workspaceIdSchema } from "../types.js";

/**
 * Identity tools: shortcuts bound to the server's configured user
 * (HONCHO_USER_PEER_ID) and default AI peer (HONCHO_AI_PEER_ID).
 *
 * Every tool accepts optional overrides so a single server instance can serve
 * multiple AI peers against the same user.
 */
export function register(server: McpServer, deps: ToolDeps) {
  const userIdSchema = (description: string) =>
    z
      .string()
      .optional()
      .describe(
        deps.config.userPeerId
          ? `${description} Defaults to the server's HONCHO_USER_PEER_ID=${deps.config.userPeerId}; omit unless overriding.`
          : `${description} No server default configured (HONCHO_USER_PEER_ID unset).`,
      );

  const aiIdSchema = (description: string) =>
    z
      .string()
      .optional()
      .describe(
        deps.config.aiPeerId
          ? `${description} Defaults to the server's HONCHO_AI_PEER_ID=${deps.config.aiPeerId}; omit unless overriding (e.g. pass a different AI peer's name).`
          : `${description} No server default configured (HONCHO_AI_PEER_ID unset).`,
      );

  /** Program resolving both identities, then handing them to `make`. */
  const withIdentity = <A>(
    ai_peer_id: string | undefined,
    user_peer_id: string | undefined,
    make: (ids: { aiPeerId: string; userPeerId: string }) => Effect.Effect<A, unknown, ToolDepsService>,
  ) =>
    Effect.gen(function* () {
      const ids = yield* resolveIdentityPair(ai_peer_id, user_peer_id);
      return yield* make(ids);
    });

  // ── get_my_peer_card ────────────────────────────────────────────────
  server.registerTool(
    "get_my_peer_card",
    {
      annotations: { title: "Get My Peer Card", readOnlyHint: true },
      description: [
        "Get the peer card the AI peer holds about you (the configured user).",
        "A compact set of biographical facts about you, as remembered from the AI peer's perspective.",
        "Returns an array of fact strings, or a notice if no card exists yet.",
      ].join("\n"),
      inputSchema: {
        workspace_id: workspaceIdSchema(deps),
        ai_peer_id: aiIdSchema("The observer AI peer whose card about you to read."),
        user_peer_id: userIdSchema("You — the observed peer."),
      },
    },
    async ({ workspace_id, ai_peer_id, user_peer_id }) =>
      runTool(
        withIdentity(ai_peer_id, user_peer_id, (ids) =>
          Effect.gen(function* () {
            const d = yield* ToolDepsService;
            const honcho = yield* d.honchoFor(workspace_id);
            const peer = yield* apiCall("get AI peer", () =>
              honcho.peer(ids.aiPeerId),
            );
            const card = yield* apiCall("get my peer card", () =>
              peer.getCard(ids.userPeerId),
            );
            return card ?? "No peer card found yet.";
          }),
        ),
        deps,
      ),
  );

  // ── set_my_peer_card ────────────────────────────────────────────────
  server.registerTool(
    "set_my_peer_card",
    {
      annotations: { title: "Set My Peer Card", readOnlyHint: false, destructiveHint: true },
      description: [
        "Set or update the peer card the AI peer holds about you (the configured user).",
        "Use this to correct facts the AI has wrong, or to bootstrap your card manually.",
        "Returns the updated card.",
      ].join("\n"),
      inputSchema: {
        workspace_id: workspaceIdSchema(deps),
        peer_card: z
          .array(z.string())
          .describe("Array of fact strings to set as your card."),
        ai_peer_id: aiIdSchema("The observer AI peer whose card about you to write."),
        user_peer_id: userIdSchema("You — the observed peer."),
      },
    },
    async ({ workspace_id, peer_card, ai_peer_id, user_peer_id }) =>
      runTool(
        withIdentity(ai_peer_id, user_peer_id, (ids) =>
          Effect.gen(function* () {
            const d = yield* ToolDepsService;
            const honcho = yield* d.honchoFor(workspace_id);
            const peer = yield* apiCall("get AI peer", () =>
              honcho.peer(ids.aiPeerId),
            );
            const result = yield* apiCall("set my peer card", () =>
              peer.setCard(peer_card, ids.userPeerId),
            );
            return result ?? "Peer card set successfully";
          }),
        ),
        deps,
      ),
  );

  // ── get_ai_peer_card ────────────────────────────────────────────────
  server.registerTool(
    "get_ai_peer_card",
    {
      annotations: { title: "Get AI Peer Card", readOnlyHint: true },
      description: [
        "Get the peer card you (the configured user) hold about the AI peer — the reverse direction of get_my_peer_card.",
        "Returns an array of fact strings, or a notice if no card exists yet.",
      ].join("\n"),
      inputSchema: {
        workspace_id: workspaceIdSchema(deps),
        ai_peer_id: aiIdSchema("You — the observed AI peer."),
        user_peer_id: userIdSchema(
          "The observer user whose card about the AI peer to read.",
        ),
      },
    },
    async ({ workspace_id, ai_peer_id, user_peer_id }) =>
      runTool(
        withIdentity(ai_peer_id, user_peer_id, (ids) =>
          Effect.gen(function* () {
            const d = yield* ToolDepsService;
            const honcho = yield* d.honchoFor(workspace_id);
            const peer = yield* apiCall("get user peer", () =>
              honcho.peer(ids.userPeerId),
            );
            const card = yield* apiCall("get AI peer card", () =>
              peer.getCard(ids.aiPeerId),
            );
            return card ?? "No peer card found yet.";
          }),
        ),
        deps,
      ),
  );

  // ── set_ai_peer_card ────────────────────────────────────────────────
  server.registerTool(
    "set_ai_peer_card",
    {
      annotations: { title: "Set AI Peer Card", readOnlyHint: false, destructiveHint: true },
      description: [
        "Set or update the peer card you (the configured user) hold about the AI peer.",
        "Returns the updated card.",
      ].join("\n"),
      inputSchema: {
        workspace_id: workspaceIdSchema(deps),
        peer_card: z
          .array(z.string())
          .describe("Array of fact strings to set as the AI peer's card."),
        ai_peer_id: aiIdSchema("You — the observed AI peer."),
        user_peer_id: userIdSchema(
          "The observer user whose card about the AI peer to write.",
        ),
      },
    },
    async ({ workspace_id, peer_card, ai_peer_id, user_peer_id }) =>
      runTool(
        withIdentity(ai_peer_id, user_peer_id, (ids) =>
          Effect.gen(function* () {
            const d = yield* ToolDepsService;
            const honcho = yield* d.honchoFor(workspace_id);
            const peer = yield* apiCall("get user peer", () =>
              honcho.peer(ids.userPeerId),
            );
            const result = yield* apiCall("set AI peer card", () =>
              peer.setCard(peer_card, ids.aiPeerId),
            );
            return result ?? "Peer card set successfully";
          }),
        ),
        deps,
      ),
  );

  // ── chat_about_me ───────────────────────────────────────────────────
  server.registerTool(
    "chat_about_me",
    {
      annotations: { title: "Chat About Me", readOnlyHint: true },
      description: [
        "Ask a natural-language question about you (the configured user), answered from the AI peer's representation of you.",
        "Shortcut for chat(peer_id=<ai_peer>, target_peer_id=<user>) — no peer IDs needed.",
        "Returns a natural-language answer, or 'None' if no relevant information exists.",
      ].join("\n"),
      inputSchema: {
        workspace_id: workspaceIdSchema(deps),
        query: z.string().describe("Natural-language question about you."),
        ai_peer_id: aiIdSchema("The observer AI peer answering the question."),
        user_peer_id: userIdSchema("You — the peer the question is about."),
        session_id: z
          .string()
          .optional()
          .describe("Optional: scope the query to a specific session."),
        scope: z
          .union([z.string(), z.array(z.string()).max(100)])
          .optional()
          .describe(
            "Optional: confine recall to a scope. A single scope name answers from that scope's own reasoned view. A list is an allowlist of sessions (explicit conclusions only).",
          ),
        sessions: z
          .array(z.string())
          .max(1000)
          .optional()
          .describe(
            "Optional: allowlist of session IDs to confine recall to (explicit conclusions only).",
          ),
        reasoning_level: z
          .enum(["minimal", "low", "medium", "high", "max"])
          .optional()
          .describe(
            "Reasoning effort. Defaults to the server's HONCHO_REASONING_LEVEL.",
          ),
      },
    },
    async ({
      workspace_id,
      query,
      ai_peer_id,
      user_peer_id,
      session_id,
      scope,
      sessions,
      reasoning_level,
    }) =>
      runTool(
        withIdentity(ai_peer_id, user_peer_id, (ids) =>
          Effect.gen(function* () {
            const d = yield* ToolDepsService;
            const honcho = yield* d.honchoFor(workspace_id);
            const peer = yield* apiCall("get AI peer", () =>
              honcho.peer(ids.aiPeerId),
            );
            const result = yield* apiCall("chat about me", () =>
              peer.chat(query, {
                target: ids.userPeerId,
                session: session_id,
                scope,
                sessions,
                reasoningLevel: reasoning_level ?? d.config.reasoningLevel,
              }),
            );
            return result ?? "None";
          }),
        ),
        deps,
      ),
  );

  // ── chat_as_user ────────────────────────────────────────────────────
  server.registerTool(
    "chat_as_user",
    {
      annotations: { title: "Chat as User", readOnlyHint: true },
      description: [
        "Ask a natural-language question answered from YOUR (the user's) representation of the AI peer.",
        "Shortcut for chat(peer_id=<user>, target_peer_id=<ai_peer>) — the reverse direction of chat_about_me.",
        "Returns a natural-language answer, or 'None' if no relevant information exists.",
      ].join("\n"),
      inputSchema: {
        workspace_id: workspaceIdSchema(deps),
        query: z.string().describe("Natural-language question."),
        ai_peer_id: aiIdSchema("The AI peer the question is about."),
        user_peer_id: userIdSchema(
          "You — the observer peer answering the question.",
        ),
        session_id: z
          .string()
          .optional()
          .describe("Optional: scope the query to a specific session."),
        scope: z
          .union([z.string(), z.array(z.string()).max(100)])
          .optional()
          .describe(
            "Optional: confine recall to a scope. A single scope name answers from that scope's own reasoned view. A list is an allowlist of sessions (explicit conclusions only).",
          ),
        sessions: z
          .array(z.string())
          .max(1000)
          .optional()
          .describe(
            "Optional: allowlist of session IDs to confine recall to (explicit conclusions only).",
          ),
        reasoning_level: z
          .enum(["minimal", "low", "medium", "high", "max"])
          .optional()
          .describe(
            "Reasoning effort. Defaults to the server's HONCHO_REASONING_LEVEL.",
          ),
      },
    },
    async ({
      workspace_id,
      query,
      ai_peer_id,
      user_peer_id,
      session_id,
      scope,
      sessions,
      reasoning_level,
    }) =>
      runTool(
        withIdentity(ai_peer_id, user_peer_id, (ids) =>
          Effect.gen(function* () {
            const d = yield* ToolDepsService;
            const honcho = yield* d.honchoFor(workspace_id);
            const peer = yield* apiCall("get user peer", () =>
              honcho.peer(ids.userPeerId),
            );
            const result = yield* apiCall("chat as user", () =>
              peer.chat(query, {
                target: ids.aiPeerId,
                session: session_id,
                scope,
                sessions,
                reasoningLevel: reasoning_level ?? d.config.reasoningLevel,
              }),
            );
            return result ?? "None";
          }),
        ),
        deps,
      ),
  );

  // ── get_my_context ──────────────────────────────────────────────────
  server.registerTool(
    "get_my_context",
    {
      annotations: { title: "Get My Context", readOnlyHint: true },
      description: [
        "Get full context about you (the configured user): the AI peer's representation of you plus its peer card about you, in one call.",
        "Shortcut for get_peer_context(peer_id=<ai_peer>, target_peer_id=<user>).",
      ].join("\n"),
      inputSchema: {
        workspace_id: workspaceIdSchema(deps),
        ai_peer_id: aiIdSchema("The observer AI peer."),
        user_peer_id: userIdSchema("You — the observed peer."),
        search_query: z
          .string()
          .optional()
          .describe("Optional: semantic search to filter relevant conclusions."),
        max_conclusions: z
          .number()
          .optional()
          .describe("Optional: max number of conclusions to include."),
      },
    },
    async ({
      workspace_id,
      ai_peer_id,
      user_peer_id,
      search_query,
      max_conclusions,
    }) =>
      runTool(
        withIdentity(ai_peer_id, user_peer_id, (ids) =>
          Effect.gen(function* () {
            const d = yield* ToolDepsService;
            const honcho = yield* d.honchoFor(workspace_id);
            const peer = yield* apiCall("get AI peer", () =>
              honcho.peer(ids.aiPeerId),
            );
            const context = yield* apiCall("get my context", () =>
              peer.context({
                target: ids.userPeerId,
                searchQuery: search_query,
                maxConclusions: max_conclusions,
              }),
            );
            return {
              user_peer_id: ids.userPeerId,
              ai_peer_id: ids.aiPeerId,
              representation: context.representation,
              peer_card: context.peerCard,
            };
          }),
        ),
        deps,
      ),
  );

  // ── get_my_representation ───────────────────────────────────────────
  server.registerTool(
    "get_my_representation",
    {
      annotations: { title: "Get My Representation", readOnlyHint: true },
      description: [
        "Get the textual representation the AI peer holds of you (the configured user) — a summary built from its conclusions about you, without the peer card.",
        "Shortcut for get_representation(peer_id=<ai_peer>, target_peer_id=<user>).",
      ].join("\n"),
      inputSchema: {
        workspace_id: workspaceIdSchema(deps),
        ai_peer_id: aiIdSchema("The observer AI peer."),
        user_peer_id: userIdSchema("You — the observed peer."),
        session_id: z
          .string()
          .optional()
          .describe("Optional: scope to a specific session."),
        scope: z
          .union([z.string(), z.array(z.string()).max(100)])
          .optional()
          .describe(
            "Optional: confine the representation to a scope. A single scope name reads that scope's own reasoned view. A list is an allowlist of sessions (explicit conclusions only).",
          ),
        sessions: z
          .array(z.string())
          .max(1000)
          .optional()
          .describe(
            "Optional: allowlist of session IDs to confine the representation to (explicit conclusions only).",
          ),
        search_query: z
          .string()
          .optional()
          .describe("Optional: semantic search to filter conclusions."),
        max_conclusions: z
          .number()
          .optional()
          .describe("Optional: max number of conclusions."),
      },
    },
    async ({
      workspace_id,
      ai_peer_id,
      user_peer_id,
      session_id,
      scope,
      sessions,
      search_query,
      max_conclusions,
    }) =>
      runTool(
        withIdentity(ai_peer_id, user_peer_id, (ids) =>
          Effect.gen(function* () {
            const d = yield* ToolDepsService;
            const honcho = yield* d.honchoFor(workspace_id);
            const peer = yield* apiCall("get AI peer", () =>
              honcho.peer(ids.aiPeerId),
            );
            const rep = yield* apiCall("get my representation", () =>
              peer.representation({
                target: ids.userPeerId,
                session: session_id,
                scope,
                sessions,
                searchQuery: search_query,
                maxConclusions: max_conclusions,
              }),
            );
            return rep;
          }),
        ),
        deps,
      ),
  );
}