import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../types.js";
import {
  textResult,
  errorResult,
  errorMessage,
  formatConclusions,
  workspaceIdSchema,
} from "../types.js";
import { resolveAiPeerId, resolveUserPeerId } from "../identity.js";

/**
 * Identity conclusions: let the assistant maintain facts about the configured
 * user directly — conclude, review, update, and delete.
 *
 * All tools default to the AI peer (HONCHO_AI_PEER_ID) observing the user
 * (HONCHO_USER_PEER_ID); every tool accepts optional overrides.
 *
 * Honcho treats conclusion content as immutable, so update_my_conclusion
 * fetches the old conclusion, deletes it, and recreates it with the same
 * session (or an explicit replacement) — content otherwise never changes.
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

  /** Resolve both peers and return the AI-observes-user ConclusionsView. */
  const viewFor = async (
    workspace_id: string | undefined,
    ai_peer_id: string | undefined,
    user_peer_id: string | undefined,
  ) => {
    const aiPeerId = resolveAiPeerId(ctx, ai_peer_id);
    const userPeerId = resolveUserPeerId(ctx, user_peer_id);
    const peer = await ctx.clientFor(workspace_id).peer(aiPeerId);
    const view = peer.conclusionsOf(userPeerId);
    return { view, aiPeerId, userPeerId };
  };

  // ── conclude_about_me ───────────────────────────────────────────────
  server.registerTool(
    "conclude_about_me",
    {
      annotations: {
        title: "Conclude About Me",
        readOnlyHint: false,
        destructiveHint: false,
      },
      description: [
        "Record one or more facts/observations about you (the configured user) into Honcho's memory, attributed to the AI peer.",
        "Use this whenever you learn something durable about the user worth remembering: preferences, biographical facts, project context, corrections.",
        "Optionally anchor the conclusions to a specific session; omit for global conclusions.",
        "Returns the created conclusions with their IDs (pass one to update_my_conclusion later).",
      ].join("\n"),
      inputSchema: {
        workspace_id: workspaceIdSchema(ctx),
        conclusions: z
          .array(z.string())
          .min(1)
          .describe(
            "Fact strings to record about the user. Write them as standalone factual statements, e.g. 'Prefers bun over bun-like tooling' — no context needed.",
          ),
        session_id: z
          .string()
          .optional()
          .describe(
            "Optional: associate the conclusions with a session. Omit for global conclusions.",
          ),
        ai_peer_id: aiIdSchema("The observer AI peer."),
        user_peer_id: userIdSchema("You — the peer the conclusions are about."),
      },
    },
    async ({
      workspace_id,
      conclusions,
      session_id,
      ai_peer_id,
      user_peer_id,
    }) => {
      try {
        const { view, aiPeerId, userPeerId } = await viewFor(
          workspace_id,
          ai_peer_id,
          user_peer_id,
        );
        const created = await view.create(
          conclusions.map((content) => ({ content, sessionId: session_id })),
        );
        return textResult({
          ai_peer_id: aiPeerId,
          user_peer_id: userPeerId,
          created: created.map((c) => ({ id: c.id, content: c.content })),
          count: created.length,
        });
      } catch (e) {
        return errorResult(errorMessage("Failed to conclude", e));
      }
    },
  );

  // ── list_my_conclusions ─────────────────────────────────────────────
  server.registerTool(
    "list_my_conclusions",
    {
      annotations: {
        title: "List My Conclusions",
        readOnlyHint: true,
      },
      description: [
        "List the conclusions the AI peer holds about you (the configured user), newest first by default.",
        "Use this to review what Honcho has recorded about the user — including what conclude_about_me wrote.",
        "Optional filters, e.g. {\"level\": \"explicit\"}. Returns conclusion objects (id, content, level, session_id, created_at) with pagination metadata.",
      ].join("\n"),
      inputSchema: {
        workspace_id: workspaceIdSchema(ctx),
        filters: z
          .looseObject({})
          .optional()
          .describe(
            'Optional: filter criteria, e.g. {"level": "explicit"} or {"session_id": "<id>"}. See https://honcho.dev/docs/v3/documentation/features/advanced/using-filters',
          ),
        session_id: z
          .string()
          .optional()
          .describe("Optional: only conclusions attached to this session."),
        page: z.number().int().min(1).optional().describe("Page number (1-indexed)."),
        size: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Results per page (max 100)."),
        reverse: z
          .boolean()
          .optional()
          .describe("Oldest first instead of the default newest first."),
        ai_peer_id: aiIdSchema("The observer AI peer."),
        user_peer_id: userIdSchema("You — the observed peer."),
      },
    },
    async ({
      workspace_id,
      filters,
      session_id,
      page: pageNum,
      size,
      reverse,
      ai_peer_id,
      user_peer_id,
    }) => {
      try {
        const { view } = await viewFor(workspace_id, ai_peer_id, user_peer_id);
        const page = await view.list({
          filters,
          session: session_id,
          page: pageNum,
          size,
          reverse,
        });
        return textResult({
          conclusions: formatConclusions(page.items),
          total: page.total,
          page: page.page,
          pages: page.pages,
        });
      } catch (e) {
        return errorResult(errorMessage("Failed to list my conclusions", e));
      }
    },
  );

  // ── query_my_conclusions ────────────────────────────────────────────
  server.registerTool(
    "query_my_conclusions",
    {
      annotations: {
        title: "Query My Conclusions",
        readOnlyHint: true,
      },
      description: [
        "Semantic search across the conclusions the AI peer holds about you.",
        "Use this to find specific recorded facts before updating or deleting them.",
        "Returns an array of matching conclusions ranked by relevance.",
      ].join("\n"),
      inputSchema: {
        workspace_id: workspaceIdSchema(ctx),
        query: z.string().describe("Semantic search query."),
        top_k: z
          .number()
          .optional()
          .describe("Max results to return (default 10)."),
        filters: z
          .looseObject({})
          .optional()
          .describe(
            'Optional: filter criteria, e.g. {"level": ["deductive", "inductive"]}. See https://honcho.dev/docs/v3/documentation/features/advanced/using-filters',
          ),
        ai_peer_id: aiIdSchema("The observer AI peer."),
        user_peer_id: userIdSchema("You — the observed peer."),
      },
    },
    async ({
      workspace_id,
      query,
      top_k,
      filters,
      ai_peer_id,
      user_peer_id,
    }) => {
      try {
        const { view } = await viewFor(workspace_id, ai_peer_id, user_peer_id);
        const conclusions = await view.query(query, top_k, undefined, filters);
        return textResult(formatConclusions(conclusions));
      } catch (e) {
        return errorResult(errorMessage("Failed to query my conclusions", e));
      }
    },
  );

  // ── update_my_conclusion ────────────────────────────────────────────
  server.registerTool(
    "update_my_conclusion",
    {
      annotations: {
        title: "Update My Conclusion",
        readOnlyHint: false,
        destructiveHint: true,
      },
      description: [
        "Replace the content of a conclusion the AI peer holds about you.",
        "Honcho conclusion content is immutable: this fetches the old conclusion, deletes it, and creates a new one with identical metadata (observer, observed, session, level preserved as 'explicit' for the fresh record).",
        "Use this to correct or refine a recorded fact — e.g. the user changed jobs, or the original conclusion was wrong.",
        "Returns the new conclusion and echoes the deleted one's ID.",
      ].join("\n"),
      inputSchema: {
        workspace_id: workspaceIdSchema(ctx),
        conclusion_id: z
          .string()
          .describe("ID of the conclusion to update (from conclude_about_me / list_my_conclusions / query_my_conclusions)."),
        content: z
          .string()
          .describe("The replacement conclusion text."),
        session_id: z
          .string()
          .optional()
          .describe(
            "Optional: attach the new conclusion to this session instead of the original's.",
          ),
        ai_peer_id: aiIdSchema("The observer AI peer."),
        user_peer_id: userIdSchema("You — the observed peer."),
      },
    },
    async ({
      workspace_id,
      conclusion_id,
      content,
      session_id,
      ai_peer_id,
      user_peer_id,
    }) => {
      try {
        const { view, aiPeerId, userPeerId } = await viewFor(
          workspace_id,
          ai_peer_id,
          user_peer_id,
        );
        // Content is immutable server-side, so replace: fetch → delete → create.
        const workspace = ctx.clientFor(workspace_id);
        const existing = await workspace.conclusions.get(conclusion_id);
        await view.delete(conclusion_id);
        const [replacement] = await view.create([
          {
            content,
            sessionId: session_id ?? existing.sessionId ?? undefined,
          },
        ]);
        return textResult({
          deleted_id: conclusion_id,
          new_conclusion: { id: replacement.id, content: replacement.content },
          ai_peer_id: aiPeerId,
          user_peer_id: userPeerId,
        });
      } catch (e) {
        return errorResult(errorMessage("Failed to update my conclusion", e));
      }
    },
  );

  // ── delete_my_conclusion ────────────────────────────────────────────
  server.registerTool(
    "delete_my_conclusion",
    {
      annotations: {
        title: "Delete My Conclusion",
        readOnlyHint: false,
        destructiveHint: true,
      },
      description: [
        "Delete a conclusion the AI peer holds about you.",
        "Use this to remove wrong or outdated facts. Read get_derived_conclusions first if unsure what reasoning was built on this fact.",
        "Returns the deleted conclusion's ID.",
      ].join("\n"),
      inputSchema: {
        workspace_id: workspaceIdSchema(ctx),
        conclusion_id: z
          .string()
          .describe("ID of the conclusion to delete."),
        ai_peer_id: aiIdSchema("The observer AI peer."),
        user_peer_id: userIdSchema("You — the observed peer."),
      },
    },
    async ({
      workspace_id,
      conclusion_id,
      ai_peer_id,
      user_peer_id,
    }) => {
      try {
        const { view, aiPeerId, userPeerId } = await viewFor(
          workspace_id,
          ai_peer_id,
          user_peer_id,
        );
        await view.delete(conclusion_id);
        return textResult({
          deleted_id: conclusion_id,
          ai_peer_id: aiPeerId,
          user_peer_id: userPeerId,
        });
      } catch (e) {
        return errorResult(errorMessage("Failed to delete my conclusion", e));
      }
    },
  );
}