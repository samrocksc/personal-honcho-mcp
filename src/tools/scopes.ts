import { z } from "zod";
import { Effect } from "effect";
import { Scope, type Honcho } from "@honcho-ai/sdk";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolDeps } from "../deps.js";
import { ToolDepsService, apiCall } from "../honcho.js";
import { runTool } from "../run.js";
import {
  workspaceIdSchema,
} from "../types.js";

// Match the SDK's scope ID rules; the constructor bypasses honcho.scope() validation.
const scopeIdSchema = z
  .string()
  .min(1)
  .max(512 - "scope.".length)
  .regex(/^[a-zA-Z0-9_-]+$/, "Scope ID may only contain letters, numbers, underscores, and hyphens");

/**
 * Reference an existing scope without the get-or-create round trip that
 * `honcho.scope()` performs, so read/remove tools never create a scope as a
 * side effect. The server returns 404 if the scope does not exist.
 */
function existingScope(honcho: Honcho, scopeId: string): Scope {
  return new Scope(scopeIdSchema.parse(scopeId), honcho.workspaceId, honcho.http);
}

const pageSchema = z.number().int().min(1).optional().describe("Page number (1-indexed).");
const sizeSchema = z
  .number()
  .int()
  .min(1)
  .max(100)
  .optional()
  .describe("Results per page (max 100).");

export function register(server: McpServer, deps: ToolDeps) {
  // ── list_scopes ─────────────────────────────────────────────────────
  server.registerTool(
    "list_scopes",
    {
      annotations: { title: "List Scopes", readOnlyHint: true },
      description: [
        "List the scopes in a workspace (paginated).",
        "A scope is a named set of sessions that acts as a recall boundary: chat with scope=<name> answers only from that scope's sessions.",
        "Returns each scope's id, metadata, and created_at.",
      ].join("\n"),
      inputSchema: {
        workspace_id: workspaceIdSchema(deps),
        page: pageSchema,
        size: sizeSchema,
      },
    },
    async ({ workspace_id, page: pageNum, size }) =>
      runTool(
        Effect.gen(function* () {
          const d = yield* ToolDepsService;
          const honcho = yield* d.honchoFor(workspace_id);
          const page = yield* apiCall("list scopes", () =>
            honcho.scopes({ page: pageNum, size }),
          );
          return {
            scopes: page.items.map((s) => ({
              id: s.id,
              metadata: s.metadata ?? {},
              created_at: s.createdAt,
            })),
            total: page.total,
            page: page.page,
            pages: page.pages,
          };
        }),
        deps,
      ),
  );

  // ── create_scope ────────────────────────────────────────────────────
  server.registerTool(
    "create_scope",
    {
      annotations: { title: "Create Scope", readOnlyHint: false, destructiveHint: false },
      description: [
        "Get or create a scope with the given ID.",
        "A scope is a named set of sessions that acts as a recall boundary. Optional metadata (e.g. a label, description, example queries) is stored with it.",
        "Sessions are added separately with add_sessions_to_scope. Returns the scope's id, metadata, and created_at.",
      ].join("\n"),
      inputSchema: {
        workspace_id: workspaceIdSchema(deps),
        scope_id: z
          .string()
          .describe("Scope name, unique within the workspace (e.g. 'therapy', 'honcho-core')."),
        metadata: z
          .looseObject({})
          .optional()
          .describe("Optional metadata to store with the scope."),
      },
    },
    async ({ workspace_id, scope_id, metadata }) =>
      runTool(
        Effect.gen(function* () {
          const d = yield* ToolDepsService;
          const honcho = yield* d.honchoFor(workspace_id);
          const scope = yield* apiCall("create scope", () =>
            honcho.scope(scope_id, metadata ? { metadata } : undefined),
          );
          return {
            id: scope.id,
            metadata: scope.metadata ?? {},
            created_at: scope.createdAt,
          };
        }),
        deps,
      ),
  );

  // ── add_sessions_to_scope ───────────────────────────────────────────
  server.registerTool(
    "add_sessions_to_scope",
    {
      annotations: { title: "Add Sessions to Scope", readOnlyHint: false, destructiveHint: false },
      description: [
        "Add sessions to a scope. Every session must already exist; re-adding a member is a no-op.",
        "Sessions that already hold messages are backfilled into the scope asynchronously — poll get_scope_status before relying on scoped recall for them.",
        "At most 100 sessions per call.",
      ].join("\n"),
      inputSchema: {
        workspace_id: workspaceIdSchema(deps),
        scope_id: z.string().describe("The scope to add sessions to."),
        session_ids: z
          .array(z.string())
          .min(1)
          .max(100)
          .describe("Session IDs to add (max 100)."),
      },
    },
    async ({ workspace_id, scope_id, session_ids }) =>
      runTool(
        Effect.gen(function* () {
          const d = yield* ToolDepsService;
          const honcho = yield* d.honchoFor(workspace_id);
          const scope = yield* apiCall("get or create scope", () =>
            honcho.scope(scope_id),
          );
          yield* apiCall("add sessions to scope", () =>
            scope.addSessions(session_ids),
          );
          return { scope_id, added: session_ids.length };
        }),
        deps,
      ),
  );

  // ── remove_session_from_scope ───────────────────────────────────────
  server.registerTool(
    "remove_session_from_scope",
    {
      annotations: { title: "Remove Session from Scope", readOnlyHint: false, destructiveHint: true },
      description: [
        "Remove a session from a scope.",
        "Conclusions derived while it was a member are reconciled out asynchronously; the session itself is untouched.",
      ].join("\n"),
      inputSchema: {
        workspace_id: workspaceIdSchema(deps),
        scope_id: z.string().describe("The scope to remove the session from."),
        session_id: z.string().describe("The session to remove."),
      },
    },
    async ({ workspace_id, scope_id, session_id }) =>
      runTool(
        Effect.gen(function* () {
          const d = yield* ToolDepsService;
          const honcho = yield* d.honchoFor(workspace_id);
          const scope = existingScope(honcho, scope_id);
          yield* apiCall("remove session from scope", () =>
            scope.removeSession(session_id),
          );
          return { scope_id, removed: session_id };
        }),
        deps,
      ),
  );

  // ── get_scope_status ────────────────────────────────────────────────
  server.registerTool(
    "get_scope_status",
    {
      annotations: { title: "Get Scope Status", readOnlyHint: true },
      description: [
        "Get backfill progress for a scope, keyed by session ID.",
        "Each entry is pending, completed, or failed. Only sessions with a backfill enqueued appear, so an empty result means nothing is outstanding.",
        "Use this after add_sessions_to_scope to tell 'the scope hasn't caught up yet' apart from 'there is nothing to recall'.",
      ].join("\n"),
      inputSchema: {
        workspace_id: workspaceIdSchema(deps),
        scope_id: z.string().describe("The scope to check."),
      },
    },
    async ({ workspace_id, scope_id }) =>
      runTool(
        Effect.gen(function* () {
          const d = yield* ToolDepsService;
          const honcho = yield* d.honchoFor(workspace_id);
          const scope = existingScope(honcho, scope_id);
          const status = yield* apiCall("get scope status", () => scope.status());
          const entries = Object.entries(status.backfillStatus);
          const counts = { pending: 0, completed: 0, failed: 0 };
          const sessions: Record<
            string,
            { state: string; updated_at: string; docs_copied?: number }
          > = {};
          for (const [sid, st] of entries) {
            if (Object.hasOwn(counts, st.state)) {
              counts[st.state] += 1;
            }
            sessions[sid] = { state: st.state, updated_at: st.updatedAt };
            if (st.docsCopied !== undefined) sessions[sid].docs_copied = st.docsCopied;
          }
          return { scope_id, ...counts, sessions };
        }),
        deps,
      ),
  );

  // ── get_scope_sessions ──────────────────────────────────────────────
  server.registerTool(
    "get_scope_sessions",
    {
      annotations: { title: "Get Scope Sessions", readOnlyHint: true },
      description: [
        "List the sessions that belong to a scope (paginated).",
        "Use this to see which conversations a recall boundary covers.",
        "Returns session IDs with pagination metadata.",
      ].join("\n"),
      inputSchema: {
        workspace_id: workspaceIdSchema(deps),
        scope_id: z.string().describe("The scope to list sessions for."),
        page: pageSchema,
        size: sizeSchema,
      },
    },
    async ({ workspace_id, scope_id, page: pageNum, size }) =>
      runTool(
        Effect.gen(function* () {
          const d = yield* ToolDepsService;
          const honcho = yield* d.honchoFor(workspace_id);
          const scope = existingScope(honcho, scope_id);
          const page = yield* apiCall("get scope sessions", () =>
            scope.sessions({ page: pageNum, size }),
          );
          return {
            scope_id,
            sessions: page.items.map((s) => ({ id: s.id })),
            total: page.total,
            page: page.page,
            pages: page.pages,
          };
        }),
        deps,
      ),
  );
}
