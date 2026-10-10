import { z } from "zod";
import { Effect } from "effect";
import type { MessageInput } from "@honcho-ai/sdk";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolDeps } from "../deps.js";
import { ToolDepsService, apiCall } from "../honcho.js";
import { runTool } from "../run.js";
import {
  formatMessage,
  formatMessages,
  formatSessionSummaries,
  workspaceIdSchema,
} from "../types.js";

export function register(server: McpServer, deps: ToolDeps) {
  // ── create_session ──────────────────────────────────────────────────
  server.registerTool(
    "create_session",
    {
      annotations: { title: "Create Session", readOnlyHint: false, destructiveHint: false },
      description: [
        "Get or create a session with the given ID.",
        "Use this to create or get a session with the given ID.",
        "Optionally join scopes at creation: each named scope is created if missing, and an existing session's messages are backfilled asynchronously (see get_scope_status).",
        "Returns the session ID.",
      ].join("\n"),
      inputSchema: {
        workspace_id: workspaceIdSchema(deps),
        session_id: z.string().describe("Unique identifier for the session."),
        scopes: z
          .array(z.string())
          .min(1)
          .max(100)
          .optional()
          .describe(
            "Optional: scope names this session should join (max 100). Equivalent to create_session followed by add_sessions_to_scope for each.",
          ),
      },
    },
    async ({ workspace_id, session_id, scopes }) =>
      runTool(
        Effect.gen(function* () {
          const d = yield* ToolDepsService;
          const honcho = yield* d.honchoFor(workspace_id);
          const session = yield* apiCall("create session", () =>
            honcho.session(session_id, scopes ? { scopes } : undefined),
          );
          return { session_id: session.id };
        }),
        deps,
      ),
  );

  // ── list_sessions ───────────────────────────────────────────────────
  server.registerTool(
    "list_sessions",
    {
      annotations: { title: "List Sessions", readOnlyHint: true },
      description: [
        "List sessions in the given workspace (paginated).",
        "Use this to discover existing conversations.",
        "Returns session IDs with pagination metadata; pass page/size to walk past the first page.",
      ].join("\n"),
      inputSchema: {
        workspace_id: workspaceIdSchema(deps),
        page: z.number().int().min(1).optional().describe("Page number (1-indexed)."),
        size: z.number().int().min(1).max(100).optional().describe("Results per page (max 100)."),
        reverse: z.boolean().optional().describe("Newest first when true."),
      },
    },
    async ({ workspace_id, page: pageNum, size, reverse }) =>
      runTool(
        Effect.gen(function* () {
          const d = yield* ToolDepsService;
          const honcho = yield* d.honchoFor(workspace_id);
          const page = yield* apiCall("list sessions", () =>
            honcho.sessions({ page: pageNum, size, reverse }),
          );
          return {
            sessions: page.items.map((s) => ({ id: s.id })),
            total: page.total,
            page: page.page,
            pages: page.pages,
          };
        }),
        deps,
      ),
  );

  // ── delete_session ──────────────────────────────────────────────────
  server.registerTool(
    "delete_session",
    {
      annotations: { title: "Delete Session", readOnlyHint: false, destructiveHint: true },
      description: [
        "Delete a session and all its messages.",
        "This cannot be undone.",
      ].join("\n"),
      inputSchema: {
        workspace_id: workspaceIdSchema(deps),
        session_id: z.string().describe("The session to delete."),
      },
    },
    async ({ workspace_id, session_id }) =>
      runTool(
        Effect.gen(function* () {
          const d = yield* ToolDepsService;
          const honcho = yield* d.honchoFor(workspace_id);
          const session = yield* apiCall("get session", () => honcho.session(session_id));
          yield* apiCall("delete session", () => session.delete());
          return "Session deleted successfully";
        }),
        deps,
      ),
  );

  // ── clone_session ───────────────────────────────────────────────────
  server.registerTool(
    "clone_session",
    {
      annotations: { title: "Clone Session", readOnlyHint: false, destructiveHint: false },
      description: [
        "Clone a session, optionally up to a specific message.",
        "Use this to fork a conversation — e.g. to explore a different branch.",
        "Returns the new cloned session ID.",
      ].join("\n"),
      inputSchema: {
        workspace_id: workspaceIdSchema(deps),
        session_id: z.string().describe("The session to clone."),
        message_id: z
          .string()
          .optional()
          .describe(
            "Optional: clone only up to and including this message. Omit to clone everything.",
          ),
      },
    },
    async ({ workspace_id, session_id, message_id }) =>
      runTool(
        Effect.gen(function* () {
          const d = yield* ToolDepsService;
          const honcho = yield* d.honchoFor(workspace_id);
          const session = yield* apiCall("get session", () => honcho.session(session_id));
          const cloned = yield* apiCall("clone session", () =>
            session.clone(message_id),
          );
          return { session_id: cloned.id };
        }),
        deps,
      ),
  );

  // ── add_peers_to_session ────────────────────────────────────────────
  server.registerTool(
    "add_peers_to_session",
    {
      annotations: { title: "Add Peers to Session", readOnlyHint: false, destructiveHint: false },
      description: [
        "Add one or more peers to a session.",
        "Use this to bring participants into a conversation.",
      ].join("\n"),
      inputSchema: {
        workspace_id: workspaceIdSchema(deps),
        session_id: z.string().describe("The session to add peers to."),
        peers: z
          .array(
            z.union([
              z.string().describe("Peer ID with default config."),
              z.object({
                peer_id: z.string().describe("Peer ID."),
                observe_me: z
                  .boolean()
                  .nullable()
                  .optional()
                  .describe("Whether this peer's messages trigger derivation in this session."),
                observe_others: z
                  .boolean()
                  .nullable()
                  .optional()
                  .describe("Whether this peer observes other peers' messages in this session."),
              }).describe("Peer with per-session config."),
            ]),
          )
          .describe("Peers to add — plain IDs or objects with per-session config."),
      },
    },
    async ({ workspace_id, session_id, peers }) =>
      runTool(
        Effect.gen(function* () {
          const d = yield* ToolDepsService;
          const honcho = yield* d.honchoFor(workspace_id);
          const session = yield* apiCall("get session", () => honcho.session(session_id));
          const additions = peers.map((p) => {
            if (typeof p === "string") return p;
            const cfg: { observeMe?: boolean | null; observeOthers?: boolean | null } = {};
            if (p.observe_me !== undefined) cfg.observeMe = p.observe_me;
            if (p.observe_others !== undefined) cfg.observeOthers = p.observe_others;
            return Object.keys(cfg).length > 0
              ? ([p.peer_id, cfg] as [string, typeof cfg])
              : p.peer_id;
          });
          yield* apiCall("add peers to session", () => session.addPeers(additions));
          return "Peers added to session successfully";
        }),
        deps,
      ),
  );

  // ── remove_peers_from_session ───────────────────────────────────────
  server.registerTool(
    "remove_peers_from_session",
    {
      annotations: { title: "Remove Peers from Session", readOnlyHint: false, destructiveHint: true },
      description: [
        "Remove one or more peers from a session.",
        "Membership ends at the current time; messages the peer already wrote stay in the session, and its representation is not deleted.",
        "Scopes are not removed this way — use remove_session_from_scope.",
      ].join("\n"),
      inputSchema: {
        workspace_id: workspaceIdSchema(deps),
        session_id: z.string().describe("The session to remove peers from."),
        peer_ids: z
          .array(z.string())
          .describe("Peer IDs to remove."),
      },
    },
    async ({ workspace_id, session_id, peer_ids }) =>
      runTool(
        Effect.gen(function* () {
          const d = yield* ToolDepsService;
          const honcho = yield* d.honchoFor(workspace_id);
          const session = yield* apiCall("get session", () => honcho.session(session_id));
          yield* apiCall("remove peers from session", () =>
            session.removePeers(peer_ids),
          );
          return "Peers removed from session successfully";
        }),
        deps,
      ),
  );

  // ── get_session_peers ───────────────────────────────────────────────
  server.registerTool(
    "get_session_peers",
    {
      annotations: { title: "Get Session Peers", readOnlyHint: true },
      description: [
        "Get all peers participating in a session.",
        "Use this to see who is in a conversation.",
        "Returns an array of peer IDs.",
      ].join("\n"),
      inputSchema: {
        workspace_id: workspaceIdSchema(deps),
        session_id: z.string().describe("The session to query."),
      },
    },
    async ({ workspace_id, session_id }) =>
      runTool(
        Effect.gen(function* () {
          const d = yield* ToolDepsService;
          const honcho = yield* d.honchoFor(workspace_id);
          const session = yield* apiCall("get session", () => honcho.session(session_id));
          const peers = yield* apiCall("get session peers", () => session.peers());
          return peers.map((p) => p.id);
        }),
        deps,
      ),
  );

  // ── inspect_session ─────────────────────────────────────────────────
  server.registerTool(
    "inspect_session",
    {
      annotations: { title: "Inspect Session", readOnlyHint: true },
      description: [
        "Inspect a session at a glance.",
        "Aggregates peer IDs, message count, and available summaries.",
        "Returns a single JSON object.",
      ].join("\n"),
      inputSchema: {
        workspace_id: workspaceIdSchema(deps),
        session_id: z.string().describe("The session to inspect."),
      },
    },
    async ({ workspace_id, session_id }) =>
      runTool(
        Effect.gen(function* () {
          const d = yield* ToolDepsService;
          const honcho = yield* d.honchoFor(workspace_id);
          const session = yield* apiCall("get session", () => honcho.session(session_id));
          const [peers, messagePage, summaries] = yield* Effect.all([
            apiCall("get session peers", () => session.peers()),
            apiCall("get session messages", () => session.messages()),
            apiCall("get session summaries", () => session.summaries()),
          ]);
          return {
            session_id,
            peers: peers.map((peer) => ({ id: peer.id })),
            message_count: messagePage.total,
            summaries: formatSessionSummaries(summaries),
          };
        }),
        deps,
      ),
  );

  // ── add_messages_to_session ─────────────────────────────────────────
  server.registerTool(
    "add_messages_to_session",
    {
      annotations: { title: "Add Messages to Session", readOnlyHint: false, destructiveHint: false },
      description: [
        "Add messages to a session from specific peers.",
        "Use this to record conversation turns. Each message must specify the peer_id of the author.",
      ].join("\n"),
      inputSchema: {
        workspace_id: workspaceIdSchema(deps),
        session_id: z.string().describe("The session to add messages to."),
        messages: z
          .array(
            z.object({
              peer_id: z.string().describe("Peer ID authoring this message."),
              content: z.string().describe("Message text."),
              metadata: z
                .looseObject({})
                .optional()
                .describe("Optional metadata."),
            }),
          )
          .describe("Messages to add."),
      },
    },
    async ({ workspace_id, session_id, messages }) =>
      runTool(
        Effect.gen(function* () {
          const d = yield* ToolDepsService;
          const honcho = yield* d.honchoFor(workspace_id);
          const session = yield* apiCall("get session", () => honcho.session(session_id));
          const peerCache = new Map<string, Awaited<ReturnType<typeof honcho.peer>>>();
          const sessionMessages: MessageInput[] = [];
          for (const msg of messages) {
            let peer = peerCache.get(msg.peer_id);
            if (!peer) {
              peer = yield* apiCall("get peer", () => honcho.peer(msg.peer_id));
              peerCache.set(msg.peer_id, peer);
            }
            sessionMessages.push(
              msg.metadata
                ? peer.message(msg.content, { metadata: msg.metadata })
                : peer.message(msg.content),
            );
          }
          yield* apiCall("add messages to session", () =>
            session.addMessages(sessionMessages),
          );
          return "Messages added to session successfully";
        }),
        deps,
      ),
  );

  // ── get_session_messages ────────────────────────────────────────────
  server.registerTool(
    "get_session_messages",
    {
      annotations: { title: "Get Session Messages", readOnlyHint: true },
      description: [
        "Get messages from a session (paginated), with optional metadata filtering.",
        "Use this to read the conversation history.",
        "Returns one page of messages with pagination metadata; pass page/size to walk past the first page.",
      ].join("\n"),
      inputSchema: {
        workspace_id: workspaceIdSchema(deps),
        session_id: z.string().describe("The session to get messages from."),
        filters: z
          .looseObject({})
          .optional()
          .describe("Optional metadata filter criteria."),
        page: z.number().int().min(1).optional().describe("Page number (1-indexed)."),
        size: z.number().int().min(1).max(100).optional().describe("Results per page (max 100)."),
        reverse: z.boolean().optional().describe("Newest first when true."),
      },
    },
    async ({ workspace_id, session_id, filters, page: pageNum, size, reverse }) =>
      runTool(
        Effect.gen(function* () {
          const d = yield* ToolDepsService;
          const honcho = yield* d.honchoFor(workspace_id);
          const session = yield* apiCall("get session", () => honcho.session(session_id));
          const page = yield* apiCall("get session messages", () =>
            session.messages({ filters, page: pageNum, size, reverse }),
          );
          return {
            messages: formatMessages(page.items),
            total: page.total,
            page: page.page,
            pages: page.pages,
          };
        }),
        deps,
      ),
  );

  // ── get_session_message ─────────────────────────────────────────────
  server.registerTool(
    "get_session_message",
    {
      annotations: { title: "Get Session Message", readOnlyHint: true },
      description: [
        "Get a single message from a session by ID.",
        "Use this when you already know the message ID and need the exact record.",
        "Returns the message object.",
      ].join("\n"),
      inputSchema: {
        workspace_id: workspaceIdSchema(deps),
        session_id: z.string().describe("The session the message belongs to."),
        message_id: z.string().describe("The message ID to fetch."),
      },
    },
    async ({ workspace_id, session_id, message_id }) =>
      runTool(
        Effect.gen(function* () {
          const d = yield* ToolDepsService;
          const honcho = yield* d.honchoFor(workspace_id);
          const session = yield* apiCall("get session", () => honcho.session(session_id));
          const message = yield* apiCall("get session message", () =>
            session.getMessage(message_id),
          );
          return formatMessage(message);
        }),
        deps,
      ),
  );

  // ── get_session_context ─────────────────────────────────────────────
  server.registerTool(
    "get_session_context",
    {
      annotations: { title: "Get Session Context", readOnlyHint: true },
      description: [
        "Get optimized context for a session, suitable for LLM prompts.",
        "Includes recent messages and an optional summary of older ones.",
        "Pass peer_target to also include that peer's representation and card, read from peer_perspective's view, from a scope's view (scope), or from the global view (neither).",
        "Use this to build a context window for the next LLM call.",
        "Returns messages, summary, session ID, and (with peer_target) peer_representation and peer_card.",
      ].join("\n"),
      inputSchema: {
        workspace_id: workspaceIdSchema(deps),
        session_id: z.string().describe("The session to get context for."),
        summary: z
          .boolean()
          .optional()
          .describe("Include a summary of older messages? Default: true."),
        tokens: z
          .number()
          .optional()
          .describe("Target token budget for the context window."),
        peer_target: z
          .string()
          .optional()
          .describe(
            "Optional: peer whose representation and card to include. Required by peer_perspective, scope, and limit_to_session.",
          ),
        peer_perspective: z
          .string()
          .optional()
          .describe(
            "Optional: read peer_target's representation from this observer peer's view. Mutually exclusive with scope.",
          ),
        scope: z
          .string()
          .optional()
          .describe(
            "Optional: read peer_target's representation and card from what this scope observed. Mutually exclusive with peer_perspective; requires a workspace-level key.",
          ),
        limit_to_session: z
          .boolean()
          .optional()
          .describe(
            "Optional: restrict peer_target's representation to conclusions from this session only.",
          ),
      },
    },
    async ({
      workspace_id,
      session_id,
      summary,
      tokens,
      peer_target,
      peer_perspective,
      scope,
      limit_to_session,
    }) =>
      runTool(
        Effect.gen(function* () {
          const d = yield* ToolDepsService;
          const honcho = yield* d.honchoFor(workspace_id);
          const session = yield* apiCall("get session", () => honcho.session(session_id));
          const context = yield* apiCall("get session context", () =>
            session.context({
              summary,
              tokens,
              peerTarget: peer_target,
              peerPerspective: peer_perspective,
              scope,
              limitToSession: limit_to_session,
            }),
          );
          return {
            session_id: context.sessionId,
            summary: context.summary,
            messages: formatMessages(context.messages),
            ...(peer_target
              ? {
                  peer_representation: context.peerRepresentation,
                  peer_card: context.peerCard,
                }
              : {}),
          };
        }),
        deps,
      ),
  );
}
