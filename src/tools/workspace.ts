import { z } from "zod";
import { Effect } from "effect";
import type { Conclusion } from "@honcho-ai/sdk";
import {
  BadRequestError,
  HonchoError,
  UnprocessableEntityError,
  type PageResponse,
  type WorkspaceResponse,
} from "@honcho-ai/sdk";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolDeps } from "../deps.js";
import { ToolDepsService, apiCall, MISSING_WORKSPACE_MESSAGE } from "../honcho.js";
import { runTool } from "../run.js";
import {
  errorResult,
  formatMessages,
  workspaceIdSchema,
} from "../types.js";
import { MissingWorkspaceError } from "../errors.js";

/** Admin ops (list/create workspace) need an admin key; hint on 401/403. */
function failAdminHint(prefix: string, cause: unknown) {
  const message = cause instanceof Error ? cause.message : String(cause);
  const denied =
    cause instanceof HonchoError && (cause.status === 401 || cause.status === 403);
  return Effect.fail(
    new Error(
      `${prefix}: ${message}${denied ? ". This operation is only possible with an admin API key." : ""}`,
    ),
  );
}

function formatWorkspace(workspace: WorkspaceResponse) {
  return {
    id: workspace.id,
    metadata: workspace.metadata ?? {},
    created_at: workspace.created_at,
  };
}

export function register(server: McpServer, deps: ToolDeps) {
  // ── inspect_workspace ───────────────────────────────────────────────
  server.registerTool(
    "inspect_workspace",
    {
      annotations: { title: "Inspect Workspace", readOnlyHint: true },
      description: [
        "Inspect a workspace at a glance.",
        "Aggregates workspace metadata, configuration, peer IDs, and session IDs.",
        "Returns the first page of peers/sessions with total counts.",
      ].join("\n"),
      inputSchema: {
        workspace_id: workspaceIdSchema(deps),
      },
    },
    async ({ workspace_id }) =>
      runTool(
        Effect.gen(function* () {
          const d = yield* ToolDepsService;
          const honcho = yield* d.honchoFor(workspace_id);
          const [metadata, configuration, peerPage, sessionPage] = yield* Effect.all([
            apiCall("get workspace metadata", () => honcho.getMetadata()),
            apiCall("get workspace configuration", () => honcho.getConfiguration()),
            apiCall("list workspace peers", () => honcho.peers()),
            apiCall("list workspace sessions", () => honcho.sessions()),
          ]);
          return {
            workspace_id: honcho.workspaceId,
            metadata,
            configuration,
            peer_count: peerPage.total,
            peers: peerPage.items.map((p) => ({ id: p.id })),
            session_count: sessionPage.total,
            sessions: sessionPage.items.map((s) => ({ id: s.id })),
          };
        }),
        deps,
      ),
  );

  // ── list_workspaces ─────────────────────────────────────────────────
  server.registerTool(
    "list_workspaces",
    {
      annotations: { title: "List Workspaces", readOnlyHint: true },
      description: [
        "List workspaces accessible to the current credentials (paginated).",
        "Skip this if the server already defaults a workspace via HONCHO_WORKSPACE_ID — omit workspace_id on other tools.",
        "Use this only when you don't already know which workspace to use.",
        "Returns each workspace's id, metadata, and created_at. If none fit, call create_workspace.",
      ].join("\n"),
      inputSchema: {
        page: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("Page number (1-indexed)."),
        size: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Results per page (max 100)."),
      },
    },
    async ({ page, size }) =>
      runTool(
        Effect.gen(function* () {
          const d = yield* ToolDepsService;
          const result = yield* Effect.catch(
            apiCall("list workspaces", () =>
              d.unscoped.http.post<PageResponse<WorkspaceResponse>>(
                "/v3/workspaces/list",
                { body: {}, query: { page, size } },
              ),
            ),
            (e) => failAdminHint("Failed to list workspaces", e.cause),
          );
          return {
            workspaces: result.items.map(formatWorkspace),
            total: result.total,
            page: result.page,
            pages: result.pages,
          };
        }),
        deps,
      ),
  );

  // ── create_workspace ────────────────────────────────────────────────
  server.registerTool(
    "create_workspace",
    {
      annotations: { title: "Create Workspace", readOnlyHint: false, destructiveHint: false },
      description: [
        "Get or create a workspace with the given ID.",
        "Skip this if the server already defaults a workspace via HONCHO_WORKSPACE_ID — that pins the workspace without a create call.",
        "Use this only when list_workspaces has no suitable workspace.",
        "Optional metadata helps future list_workspaces calls identify what the workspace is for.",
        "Returns the workspace id, metadata, and created_at.",
      ].join("\n"),
      inputSchema: {
        workspace_id: workspaceIdSchema(deps),
        metadata: z
          .looseObject({})
          .optional()
          .describe(
            "Optional key-value metadata to store on the workspace (e.g. project, purpose).",
          ),
      },
    },
    async ({ workspace_id, metadata }) =>
      runTool(
        Effect.gen(function* () {
          const d = yield* ToolDepsService;
          const id = workspace_id?.trim() || d.config.workspaceId?.trim();
          if (!id) {
            return yield* Effect.fail(
              new MissingWorkspaceError({ message: MISSING_WORKSPACE_MESSAGE }),
            );
          }
          const workspace = yield* Effect.catch(
            apiCall("create workspace", () =>
              d.unscoped.http.post<WorkspaceResponse>("/v3/workspaces", {
                body: { id, metadata },
              }),
            ),
            (e) => failAdminHint("Failed to create workspace", e.cause),
          );
          return formatWorkspace(workspace);
        }),
        deps,
      ),
  );

  // ── search ────────────────────────────────────────────────────────
  server.registerTool(
    "search",
    {
      annotations: { title: "Search Workspace", readOnlyHint: true },
      description: [
        "Semantic search across messages and, when peer_id is given, that peer's saved conclusions.",
        "Message scope is determined by which optional params are provided:",
        "- No scope params: search all messages in the workspace.",
        "- peer_id only: search messages authored by that peer across all sessions.",
        "- session_id only: search messages within that session.",
        "- scope: search messages in that scope's member sessions (optionally narrowed to peer_id's messages). Not combinable with session_id.",
        "Conclusions require peer_id (self-conclusions are searched; conclusion IDs are usable with delete_conclusion).",
        "Returns {messages, conclusions}.",
      ].join("\n"),
      inputSchema: {
        workspace_id: workspaceIdSchema(deps),
        query: z.string().describe("Search query."),
        peer_id: z
          .string()
          .optional()
          .describe("Optional: scope search to messages by this peer."),
        session_id: z
          .string()
          .optional()
          .describe("Optional: scope search to messages in this session."),
        scope: z
          .string()
          .optional()
          .describe(
            "Optional: restrict message search to this scope's member sessions. A scope with no members matches nothing. Mutually exclusive with session_id.",
          ),
        message_limit: z
          .number()
          .optional()
          .describe("Optional: max message results (1-100, default 10)."),
        message_filters: z
          .looseObject({})
          .optional()
          .describe(
            'Optional: filters for the message search, e.g. {"created_at": {"gte": "2026-01-01"}}. See https://honcho.dev/docs/v3/documentation/features/advanced/using-filters',
          ),
        conclusion_top_k: z
          .number()
          .optional()
          .describe("Optional: max conclusion results (default 10)."),
        conclusion_filters: z
          .looseObject({})
          .optional()
          .describe(
            'Optional: filters for the conclusion search, e.g. {"level": ["deductive", "inductive"]} to only return conclusions derived during dreaming. Levels: explicit (extracted directly from messages), deductive, inductive, contradiction. The session_id param does not scope conclusions; use {"session_id": ...} here for that.',
          ),
      },
    },
    async ({
      workspace_id,
      query,
      peer_id,
      session_id,
      scope,
      message_limit,
      message_filters,
      conclusion_top_k,
      conclusion_filters,
    }) => {
      if (scope !== undefined && session_id) {
        return errorResult(
          "Search failed: `scope` and `session_id` are mutually exclusive — a scope already names a set of sessions.",
        );
      }
      return runTool(
        Effect.gen(function* () {
          const d = yield* ToolDepsService;
          const honcho = yield* d.honchoFor(workspace_id);
          const peer = peer_id
            ? yield* apiCall("get peer", () => honcho.peer(peer_id))
            : null;
          const messageOptions = {
            filters: message_filters,
            limit: message_limit,
          };

          let messages;
          if (scope !== undefined) {
            // The scope-aware route is workspace-level; a peer narrows it via
            // the message filter rather than the peer-level search route.
            messages = yield* apiCall("workspace search", () =>
              honcho.search(query, {
                ...messageOptions,
                scope,
                filters: peer_id
                  ? { ...message_filters, peer_id }
                  : message_filters,
              }),
            );
          } else if (session_id) {
            const session = yield* apiCall("get session", () =>
              honcho.session(session_id),
            );
            messages = yield* apiCall("session search", () =>
              session.search(query, messageOptions),
            );
          } else if (peer) {
            messages = yield* apiCall("peer search", () =>
              peer.search(query, messageOptions),
            );
          } else {
            messages = yield* apiCall("workspace search", () =>
              honcho.search(query, messageOptions),
            );
          }

          // Conclusion search needs an (observer, observed) pair, so it only
          // runs when peer_id is given.
          const conclusions = peer
            ? yield* Effect.catch(
                apiCall("query conclusions", () =>
                  peer.conclusions.query(
                    query,
                    conclusion_top_k,
                    undefined,
                    conclusion_filters,
                  ),
                ),
                (e) =>
                  conclusion_filters &&
                  (e.cause instanceof BadRequestError ||
                    e.cause instanceof UnprocessableEntityError)
                    ? Effect.fail(e)
                    : Effect.succeed([] as Conclusion[]),
              )
            : ([] as Conclusion[]);

          return {
            messages: formatMessages(messages),
            conclusions: conclusions.map((c) => ({
              id: c.id,
              content: c.content,
              level: c.level,
              created_at: c.createdAt,
            })),
          };
        }),
        deps,
      );
    },
  );

  // ── workspace_chat ──────────────────────────────────────────────
  server.registerTool(
    "workspace_chat",
    {
      annotations: { title: "Ask About a Workspace", readOnlyHint: true },
      description: [
        "Ask a natural-language question about the whole workspace and get an answer from Honcho's reasoning system.",
        "Reasons across ALL peers and their conclusions — use for cross-peer analysis, common themes, or questions not tied to one peer.",
        "For questions about a single peer, use `chat` instead.",
        "Returns a natural-language answer, or 'None' if no relevant information exists.",
        "With `include_evidence`, returns an object instead: the answer plus what the agent read to produce it.",
      ].join("\n"),
      inputSchema: {
        workspace_id: workspaceIdSchema(deps),
        query: z.string().describe("Natural-language question."),
        session_id: z
          .string()
          .optional()
          .describe("Optional: scope the query to a specific session."),
        scope: z
          .union([z.string(), z.array(z.string()).max(100)])
          .optional()
          .describe(
            "Optional: confine recall to a scope. A single scope name answers from that scope's own reasoned view (all conclusion levels). A list of scope names is an allowlist: explicit conclusions from the union of their sessions only.",
          ),
        reasoning_level: z
          .enum(["minimal", "low", "medium", "high", "max"])
          .optional()
          .describe(
            "Reasoning effort. Higher = more detailed but slower. Defaults to the server's HONCHO_REASONING_LEVEL.",
          ),
        include_evidence: z
          .boolean()
          .optional()
          .describe(
            "Return what the answer was built from: the conclusions and messages the agent read and the tools it called. Collated from what the agent accessed rather than reported by the model, so it over-reports — a listed conclusion was read, which is not proof the answer leaned on it. Costs no extra model tokens.",
          ),
      },
    },
    async ({
      workspace_id,
      query,
      session_id,
      scope,
      reasoning_level,
      include_evidence,
    }) =>
      runTool(
        Effect.gen(function* () {
          const d = yield* ToolDepsService;
          const honcho = yield* d.honchoFor(workspace_id);
          const options = {
            session: session_id,
            scope,
            reasoningLevel: reasoning_level ?? d.config.reasoningLevel,
          };
          if (!include_evidence) {
            const result = yield* apiCall("workspace chat", () =>
              honcho.chat(query, options),
            );
            return result ?? "None";
          }
          const { content, evidence } = yield* apiCall("workspace chat", () =>
            honcho.chat(query, { ...options, includeEvidence: true }),
          );
          return { content: content ?? "None", evidence };
        }),
        deps,
      ),
  );

  // ── get_metadata ──────────────────────────────────────────────────
  server.registerTool(
    "get_metadata",
    {
      annotations: { title: "Get Metadata", readOnlyHint: true },
      description: [
        "Get metadata for a resource. Scope is determined by which optional params are provided:",
        "- No scope params: get workspace metadata.",
        "- peer_id only: get peer metadata.",
        "- session_id only: get session metadata.",
      ].join("\n"),
      inputSchema: {
        workspace_id: workspaceIdSchema(deps),
        peer_id: z
          .string()
          .optional()
          .describe("Optional: get metadata for this peer."),
        session_id: z
          .string()
          .optional()
          .describe("Optional: get metadata for this session."),
      },
    },
    async ({ workspace_id, peer_id, session_id }) =>
      runTool(
        Effect.gen(function* () {
          const d = yield* ToolDepsService;
          const honcho = yield* d.honchoFor(workspace_id);
          if (session_id) {
            const session = yield* apiCall("get session", () =>
              honcho.session(session_id),
            );
            return yield* apiCall("get session metadata", () =>
              session.getMetadata(),
            );
          }
          if (peer_id) {
            const peer = yield* apiCall("get peer", () => honcho.peer(peer_id));
            return yield* apiCall("get peer metadata", () => peer.getMetadata());
          }
          return yield* apiCall("get workspace metadata", () =>
            honcho.getMetadata(),
          );
        }),
        deps,
      ),
  );

  // ── set_metadata ──────────────────────────────────────────────────
  server.registerTool(
    "set_metadata",
    {
      annotations: { title: "Set Metadata", readOnlyHint: false, destructiveHint: true },
      description: [
        "Set metadata for a resource. Overwrites existing metadata.",
        "Scope is determined by which optional params are provided:",
        "- No scope params: set workspace metadata.",
        "- peer_id only: set peer metadata.",
        "- session_id only: set session metadata.",
      ].join("\n"),
      inputSchema: {
        workspace_id: workspaceIdSchema(deps),
        metadata: z
          .looseObject({})
          .describe("Key-value pairs to set as metadata."),
        peer_id: z
          .string()
          .optional()
          .describe("Optional: set metadata for this peer."),
        session_id: z
          .string()
          .optional()
          .describe("Optional: set metadata for this session."),
      },
    },
    async ({ workspace_id, metadata, peer_id, session_id }) =>
      runTool(
        Effect.gen(function* () {
          const d = yield* ToolDepsService;
          const honcho = yield* d.honchoFor(workspace_id);
          if (session_id) {
            const session = yield* apiCall("get session", () =>
              honcho.session(session_id),
            );
            yield* apiCall("set session metadata", () =>
              session.setMetadata(metadata),
            );
            return "Session metadata set successfully";
          }
          if (peer_id) {
            const peer = yield* apiCall("get peer", () => honcho.peer(peer_id));
            yield* apiCall("set peer metadata", () => peer.setMetadata(metadata));
            return "Peer metadata set successfully";
          }
          yield* apiCall("set workspace metadata", () =>
            honcho.setMetadata(metadata),
          );
          return "Workspace metadata set successfully";
        }),
        deps,
      ),
  );
}