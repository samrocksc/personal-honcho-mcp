import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../types.js";
import {
  textResult,
  errorResult,
  errorMessage,
  workspaceIdSchema,
} from "../types.js";
import { resolveAiPeerId, resolveUserPeerId } from "../identity.js";

/**
 * Identity tools: shortcuts bound to the server's configured user
 * (HONCHO_USER_PEER_ID) and default AI peer (HONCHO_AI_PEER_ID).
 *
 * Every tool accepts optional overrides so a single server instance can serve
 * multiple AI peers against the same user.
 */
export function register(server: McpServer, ctx: ToolContext) {
  const userIdSchema = (description: string) =>
    z
      .string()
      .optional()
      .describe(
        ctx.config.userPeerId
          ? `${description} Defaults to the server's HONCHO_USER_PEER_ID=${ctx.config.userPeerId}; omit unless overriding.`
          : `${description} No server default configured (HONCHO_USER_PEER_ID unset).`,
      );

  const aiIdSchema = (description: string) =>
    z
      .string()
      .optional()
      .describe(
        ctx.config.aiPeerId
          ? `${description} Defaults to the server's HONCHO_AI_PEER_ID=${ctx.config.aiPeerId}; omit unless overriding (e.g. pass a different AI peer's name).`
          : `${description} No server default configured (HONCHO_AI_PEER_ID unset).`,
      );

  // ── get_my_peer_card ────────────────────────────────────────────────
  server.registerTool(
    "get_my_peer_card",
    {
      annotations: {
        title: "Get My Peer Card",
        readOnlyHint: true,
      },
      description: [
        "Get the peer card the AI peer holds about you (the configured user).",
        "A compact set of biographical facts about you, as remembered from the AI peer's perspective.",
        "Returns an array of fact strings, or a notice if no card exists yet.",
      ].join("\n"),
      inputSchema: {
        workspace_id: workspaceIdSchema(ctx),
        ai_peer_id: aiIdSchema(
          "The observer AI peer whose card about you to read.",
        ),
        user_peer_id: userIdSchema("You — the observed peer."),
      },
    },
    async ({ workspace_id, ai_peer_id, user_peer_id }) => {
      try {
        const aiPeerId = resolveAiPeerId(ctx, ai_peer_id);
        const userPeerId = resolveUserPeerId(ctx, user_peer_id);
        const peer = await ctx.clientFor(workspace_id).peer(aiPeerId);
        const card = await peer.getCard(userPeerId);
        return textResult(card ?? "No peer card found yet.");
      } catch (e) {
        return errorResult(errorMessage("Failed to get my peer card", e));
      }
    },
  );

  // ── set_my_peer_card ────────────────────────────────────────────────
  server.registerTool(
    "set_my_peer_card",
    {
      annotations: {
        title: "Set My Peer Card",
        readOnlyHint: false,
        destructiveHint: true,
      },
      description: [
        "Set or update the peer card the AI peer holds about you (the configured user).",
        "Use this to correct facts the AI has wrong, or to bootstrap your card manually.",
        "Returns the updated card.",
      ].join("\n"),
      inputSchema: {
        workspace_id: workspaceIdSchema(ctx),
        peer_card: z
          .array(z.string())
          .describe("Array of fact strings to set as your card."),
        ai_peer_id: aiIdSchema(
          "The observer AI peer whose card about you to write.",
        ),
        user_peer_id: userIdSchema("You — the observed peer."),
      },
    },
    async ({ workspace_id, peer_card, ai_peer_id, user_peer_id }) => {
      try {
        const aiPeerId = resolveAiPeerId(ctx, ai_peer_id);
        const userPeerId = resolveUserPeerId(ctx, user_peer_id);
        const peer = await ctx.clientFor(workspace_id).peer(aiPeerId);
        const result = await peer.setCard(peer_card, userPeerId);
        return textResult(result ?? "Peer card set successfully");
      } catch (e) {
        return errorResult(errorMessage("Failed to set my peer card", e));
      }
    },
  );

  // ── get_ai_peer_card ────────────────────────────────────────────────
  server.registerTool(
    "get_ai_peer_card",
    {
      annotations: {
        title: "Get AI Peer Card",
        readOnlyHint: true,
      },
      description: [
        "Get the peer card you (the configured user) hold about the AI peer — the reverse direction of get_my_peer_card.",
        "Returns an array of fact strings, or a notice if no card exists yet.",
      ].join("\n"),
      inputSchema: {
        workspace_id: workspaceIdSchema(ctx),
        ai_peer_id: aiIdSchema("You — the observed AI peer."),
        user_peer_id: userIdSchema(
          "The observer user whose card about the AI peer to read.",
        ),
      },
    },
    async ({ workspace_id, ai_peer_id, user_peer_id }) => {
      try {
        const aiPeerId = resolveAiPeerId(ctx, ai_peer_id);
        const userPeerId = resolveUserPeerId(ctx, user_peer_id);
        const peer = await ctx.clientFor(workspace_id).peer(userPeerId);
        const card = await peer.getCard(aiPeerId);
        return textResult(card ?? "No peer card found yet.");
      } catch (e) {
        return errorResult(errorMessage("Failed to get AI peer card", e));
      }
    },
  );

  // ── set_ai_peer_card ────────────────────────────────────────────────
  server.registerTool(
    "set_ai_peer_card",
    {
      annotations: {
        title: "Set AI Peer Card",
        readOnlyHint: false,
        destructiveHint: true,
      },
      description: [
        "Set or update the peer card you (the configured user) hold about the AI peer.",
        "Returns the updated card.",
      ].join("\n"),
      inputSchema: {
        workspace_id: workspaceIdSchema(ctx),
        peer_card: z
          .array(z.string())
          .describe("Array of fact strings to set as the AI peer's card."),
        ai_peer_id: aiIdSchema("You — the observed AI peer."),
        user_peer_id: userIdSchema(
          "The observer user whose card about the AI peer to write.",
        ),
      },
    },
    async ({ workspace_id, peer_card, ai_peer_id, user_peer_id }) => {
      try {
        const aiPeerId = resolveAiPeerId(ctx, ai_peer_id);
        const userPeerId = resolveUserPeerId(ctx, user_peer_id);
        const peer = await ctx.clientFor(workspace_id).peer(userPeerId);
        const result = await peer.setCard(peer_card, aiPeerId);
        return textResult(result ?? "Peer card set successfully");
      } catch (e) {
        return errorResult(errorMessage("Failed to set AI peer card", e));
      }
    },
  );

  // ── chat_about_me ───────────────────────────────────────────────────
  server.registerTool(
    "chat_about_me",
    {
      annotations: {
        title: "Chat About Me",
        readOnlyHint: true,
      },
      description: [
        "Ask a natural-language question about you (the configured user), answered from the AI peer's representation of you.",
        "Shortcut for chat(peer_id=<ai_peer>, target_peer_id=<user>) — no peer IDs needed.",
        "Returns a natural-language answer, or 'None' if no relevant information exists.",
      ].join("\n"),
      inputSchema: {
        workspace_id: workspaceIdSchema(ctx),
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
    }) => {
      try {
        const aiPeerId = resolveAiPeerId(ctx, ai_peer_id);
        const userPeerId = resolveUserPeerId(ctx, user_peer_id);
        const peer = await ctx.clientFor(workspace_id).peer(aiPeerId);
        const result = await peer.chat(query, {
          target: userPeerId,
          session: session_id,
          scope,
          sessions,
          reasoningLevel: reasoning_level ?? ctx.config.reasoningLevel,
        });
        return textResult(result ?? "None");
      } catch (e) {
        return errorResult(errorMessage("Chat about me failed", e));
      }
    },
  );

  // ── chat_as_user ────────────────────────────────────────────────────
  server.registerTool(
    "chat_as_user",
    {
      annotations: {
        title: "Chat as User",
        readOnlyHint: true,
      },
      description: [
        "Ask a natural-language question answered from YOUR (the user's) representation of the AI peer.",
        "Shortcut for chat(peer_id=<user>, target_peer_id=<ai_peer>) — the reverse direction of chat_about_me.",
        "Returns a natural-language answer, or 'None' if no relevant information exists.",
      ].join("\n"),
      inputSchema: {
        workspace_id: workspaceIdSchema(ctx),
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
    }) => {
      try {
        const aiPeerId = resolveAiPeerId(ctx, ai_peer_id);
        const userPeerId = resolveUserPeerId(ctx, user_peer_id);
        const peer = await ctx.clientFor(workspace_id).peer(userPeerId);
        const result = await peer.chat(query, {
          target: aiPeerId,
          session: session_id,
          scope,
          sessions,
          reasoningLevel: reasoning_level ?? ctx.config.reasoningLevel,
        });
        return textResult(result ?? "None");
      } catch (e) {
        return errorResult(errorMessage("Chat as user failed", e));
      }
    },
  );

  // ── get_my_context ──────────────────────────────────────────────────
  server.registerTool(
    "get_my_context",
    {
      annotations: {
        title: "Get My Context",
        readOnlyHint: true,
      },
      description: [
        "Get full context about you (the configured user): the AI peer's representation of you plus its peer card about you, in one call.",
        "Shortcut for get_peer_context(peer_id=<ai_peer>, target_peer_id=<user>).",
      ].join("\n"),
      inputSchema: {
        workspace_id: workspaceIdSchema(ctx),
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
    }) => {
      try {
        const aiPeerId = resolveAiPeerId(ctx, ai_peer_id);
        const userPeerId = resolveUserPeerId(ctx, user_peer_id);
        const peer = await ctx.clientFor(workspace_id).peer(aiPeerId);
        const context = await peer.context({
          target: userPeerId,
          searchQuery: search_query,
          maxConclusions: max_conclusions,
        });
        return textResult({
          user_peer_id: userPeerId,
          ai_peer_id: aiPeerId,
          representation: context.representation,
          peer_card: context.peerCard,
        });
      } catch (e) {
        return errorResult(errorMessage("Failed to get my context", e));
      }
    },
  );

  // ── get_my_representation ───────────────────────────────────────────
  server.registerTool(
    "get_my_representation",
    {
      annotations: {
        title: "Get My Representation",
        readOnlyHint: true,
      },
      description: [
        "Get the textual representation the AI peer holds of you (the configured user) — a summary built from its conclusions about you, without the peer card.",
        "Shortcut for get_representation(peer_id=<ai_peer>, target_peer_id=<user>).",
      ].join("\n"),
      inputSchema: {
        workspace_id: workspaceIdSchema(ctx),
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
    }) => {
      try {
        const aiPeerId = resolveAiPeerId(ctx, ai_peer_id);
        const userPeerId = resolveUserPeerId(ctx, user_peer_id);
        const peer = await ctx.clientFor(workspace_id).peer(aiPeerId);
        const rep = await peer.representation({
          target: userPeerId,
          session: session_id,
          scope,
          sessions,
          searchQuery: search_query,
          maxConclusions: max_conclusions,
        });
        return textResult(rep);
      } catch (e) {
        return errorResult(errorMessage("Failed to get my representation", e));
      }
    },
  );
}