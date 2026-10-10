import { z } from "zod";
import { Effect } from "effect";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolDeps } from "../deps.js";
import { ToolDepsService, apiCall } from "../honcho.js";
import { runTool } from "../run.js";
import {
  formatConclusions,
  workspaceIdSchema,
} from "../types.js";

const ATTRIBUTION_NOTE =
  "Each conclusion carries `level` (explicit = extracted from messages; deductive/inductive/contradiction = derived while dreaming), `source_ids` (the conclusions it was derived from, null for explicit), and `times_derived` (how many times it was independently reached).";

export function register(server: McpServer, deps: ToolDeps) {
  // ── list_conclusions ────────────────────────────────────────────────
  server.registerTool(
    "list_conclusions",
    {
      annotations: { title: "List Conclusions", readOnlyHint: true },
      description: [
        "List conclusions (facts and observations) that Honcho has derived about a peer (paginated).",
        "Use this to see what Honcho has learned. If no target is given, returns self-conclusions.",
        ATTRIBUTION_NOTE,
        "Returns conclusion objects with pagination metadata.",
      ].join("\n"),
      inputSchema: {
        workspace_id: workspaceIdSchema(deps),
        peer_id: z.string().describe("The observer peer."),
        target_peer_id: z
          .string()
          .optional()
          .describe(
            "Optional: list conclusions about this target. Omit for self-conclusions.",
          ),
        session_id: z
          .string()
          .optional()
          .describe("Optional: only conclusions attached to this session."),
        filters: z
          .looseObject({})
          .optional()
          .describe(
            'Optional: filter criteria, e.g. {"level": "inductive"} for pattern conclusions only, or {"source_ids": {"contains": "<id>"}} for conclusions derived from a given one. See https://honcho.dev/docs/v3/documentation/features/advanced/using-filters',
          ),
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
      },
    },
    async ({
      workspace_id,
      peer_id,
      target_peer_id,
      session_id,
      filters,
      page: pageNum,
      size,
      reverse,
    }) =>
      runTool(
        Effect.gen(function* () {
          const d = yield* ToolDepsService;
          const honcho = yield* d.honchoFor(workspace_id);
          const peer = yield* apiCall("get peer", () => honcho.peer(peer_id));
          const view = target_peer_id
            ? peer.conclusionsOf(target_peer_id)
            : peer.conclusions;
          const page = yield* apiCall("list conclusions", () =>
            view.list({
              session: session_id,
              filters,
              page: pageNum,
              size,
              reverse,
            }),
          );
          return {
            conclusions: formatConclusions(page.items),
            total: page.total,
            page: page.page,
            pages: page.pages,
          };
        }),
        deps,
      ),
  );

  // ── query_conclusions ───────────────────────────────────────────────
  server.registerTool(
    "query_conclusions",
    {
      annotations: { title: "Query Conclusions", readOnlyHint: true },
      description: [
        "Semantic search across a peer's conclusions.",
        "Use this to find specific knowledge Honcho has derived — more targeted than list_conclusions.",
        ATTRIBUTION_NOTE,
        "Returns an array of matching conclusions ranked by relevance.",
      ].join("\n"),
      inputSchema: {
        workspace_id: workspaceIdSchema(deps),
        peer_id: z.string().describe("The observer peer."),
        query: z.string().describe("Semantic search query."),
        target_peer_id: z
          .string()
          .optional()
          .describe("Optional: search conclusions about this target."),
        top_k: z
          .number()
          .optional()
          .describe("Max results to return."),
        filters: z
          .looseObject({})
          .optional()
          .describe(
            'Optional: filter criteria, e.g. {"level": ["deductive", "inductive"]} to only return conclusions derived during dreaming. Levels: explicit (extracted directly from messages), deductive, inductive, contradiction. See https://honcho.dev/docs/v3/documentation/features/advanced/using-filters',
          ),
      },
    },
    async ({ workspace_id, peer_id, query, target_peer_id, top_k, filters }) =>
      runTool(
        Effect.gen(function* () {
          const d = yield* ToolDepsService;
          const honcho = yield* d.honchoFor(workspace_id);
          const peer = yield* apiCall("get peer", () => honcho.peer(peer_id));
          const view = target_peer_id
            ? peer.conclusionsOf(target_peer_id)
            : peer.conclusions;
          const conclusions = yield* apiCall("query conclusions", () =>
            view.query(query, top_k, undefined, filters),
          );
          return formatConclusions(conclusions);
        }),
        deps,
      ),
  );

  // ── get_conclusions ─────────────────────────────────────────────────
  server.registerTool(
    "get_conclusions",
    {
      annotations: { title: "Get Conclusions", readOnlyHint: true },
      description: [
        "Fetch conclusions by ID, from anywhere in the workspace — no observer/observed pair needed.",
        "Pass the `source_ids` of a conclusion to see the premises it was derived from; repeat to walk a reasoning chain down to the explicit facts it rests on.",
        ATTRIBUTION_NOTE,
        "IDs that no longer exist are omitted rather than erroring, so a shorter result means some premises have been consolidated or deleted.",
      ].join("\n"),
      inputSchema: {
        workspace_id: workspaceIdSchema(deps),
        conclusion_ids: z
          .array(z.string())
          .min(1)
          .max(100)
          .describe("Conclusion IDs to fetch (max 100)."),
      },
    },
    async ({ workspace_id, conclusion_ids }) =>
      runTool(
        Effect.gen(function* () {
          const d = yield* ToolDepsService;
          const honcho = yield* d.honchoFor(workspace_id);
          const conclusions = yield* apiCall("get conclusions", () =>
            honcho.conclusions.getMany(conclusion_ids),
          );
          const found = new Set(conclusions.map((c) => c.id));
          return {
            conclusions: formatConclusions(conclusions),
            missing: conclusion_ids.filter((id) => !found.has(id)),
          };
        }),
        deps,
      ),
  );

  // ── get_derived_conclusions ─────────────────────────────────────────
  server.registerTool(
    "get_derived_conclusions",
    {
      annotations: { title: "Get Derived Conclusions", readOnlyHint: true },
      description: [
        "List the conclusions derived FROM a given conclusion — those naming it in their `source_ids`.",
        "This walks the reasoning tree upward (premise -> conclusion); `get_conclusions` on a conclusion's `source_ids` walks it downward.",
        "Use this to see what Honcho built on top of a fact before deleting or correcting it.",
        "Returns conclusion objects with pagination metadata.",
      ].join("\n"),
      inputSchema: {
        workspace_id: workspaceIdSchema(deps),
        conclusion_id: z.string().describe("The premise conclusion."),
        page: z.number().int().min(1).optional().describe("Page number (1-indexed)."),
        size: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Results per page (max 100)."),
      },
    },
    async ({ workspace_id, conclusion_id, page: pageNum, size }) =>
      runTool(
        Effect.gen(function* () {
          const d = yield* ToolDepsService;
          const honcho = yield* d.honchoFor(workspace_id);
          const page = yield* apiCall("get derived conclusions", () =>
            honcho.conclusions.list({
              filters: { source_ids: { contains: conclusion_id } },
              page: pageNum,
              size,
            }),
          );
          return {
            conclusions: formatConclusions(page.items),
            total: page.total,
            page: page.page,
            pages: page.pages,
          };
        }),
        deps,
      ),
  );

  // ── create_conclusions ──────────────────────────────────────────────
  server.registerTool(
    "create_conclusions",
    {
      annotations: { title: "Create Conclusions", readOnlyHint: false, destructiveHint: false },
      description: [
        "Manually create conclusions (facts/observations) about a peer.",
        "Use this to inject knowledge into Honcho that wasn't derived from conversation.",
        "Returns the number of conclusions created.",
      ].join("\n"),
      inputSchema: {
        workspace_id: workspaceIdSchema(deps),
        peer_id: z.string().describe("The observer peer."),
        target_peer_id: z
          .string()
          .describe("The peer the conclusions are about."),
        conclusions: z
          .array(z.string())
          .describe("Conclusion content strings to create."),
        session_id: z
          .string()
          .optional()
          .describe(
            "Optional: associate conclusions with a session. Omit for global conclusions.",
          ),
      },
    },
    async ({
      workspace_id,
      peer_id,
      target_peer_id,
      conclusions,
      session_id,
    }) =>
      runTool(
        Effect.gen(function* () {
          const d = yield* ToolDepsService;
          const honcho = yield* d.honchoFor(workspace_id);
          const peer = yield* apiCall("get peer", () => honcho.peer(peer_id));
          const view = peer.conclusionsOf(target_peer_id);
          yield* apiCall("create conclusions", () =>
            view.create(
              conclusions.map((content) => ({ content, sessionId: session_id })),
            ),
          );
          return `Created ${conclusions.length} conclusion${conclusions.length === 1 ? "" : "s"} successfully`;
        }),
        deps,
      ),
  );

  // ── delete_conclusion ───────────────────────────────────────────────
  server.registerTool(
    "delete_conclusion",
    {
      annotations: { title: "Delete Conclusion", readOnlyHint: false, destructiveHint: true },
      description: [
        "Delete a specific conclusion by ID.",
        "Use query_conclusions or list_conclusions to find the ID first.",
        "Use this to remove incorrect or outdated knowledge.",
      ].join("\n"),
      inputSchema: {
        workspace_id: workspaceIdSchema(deps),
        peer_id: z.string().describe("The observer peer."),
        target_peer_id: z
          .string()
          .describe("The peer the conclusion is about."),
        conclusion_id: z.string().describe("The conclusion to delete."),
      },
    },
    async ({ workspace_id, peer_id, target_peer_id, conclusion_id }) =>
      runTool(
        Effect.gen(function* () {
          const d = yield* ToolDepsService;
          const honcho = yield* d.honchoFor(workspace_id);
          const peer = yield* apiCall("get peer", () => honcho.peer(peer_id));
          const view = peer.conclusionsOf(target_peer_id);
          yield* apiCall("delete conclusion", () => view.delete(conclusion_id));
          return "Conclusion deleted successfully";
        }),
        deps,
      ),
  );
}