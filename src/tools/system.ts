import { z } from "zod";
import { Effect } from "effect";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolDeps } from "../deps.js";
import { ToolDepsService, apiCall } from "../honcho.js";
import { runTool } from "../run.js";
import { workspaceIdSchema } from "../types.js";

export function register(server: McpServer, deps: ToolDeps) {
  // ── schedule_dream ──────────────────────────────────────────────────
  server.registerTool(
    "schedule_dream",
    {
      annotations: { title: "Schedule Dream", readOnlyHint: false, destructiveHint: true },
      description: [
        "Schedule a dream — a background memory-consolidation task for a peer.",
        "Dreams consolidate observations into higher-level insights and update peer cards.",
        "Use this after a long conversation to improve Honcho's memory quality.",
      ].join("\n"),
      inputSchema: {
        workspace_id: workspaceIdSchema(deps),
        peer_id: z.string().describe("The observer peer to dream for."),
        target_peer_id: z
          .string()
          .optional()
          .describe(
            "Optional: dream about this target peer. Omit for self-reflection.",
          ),
        session_id: z
          .string()
          .optional()
          .describe("Optional: scope the dream to a session."),
      },
    },
    async ({ workspace_id, peer_id, target_peer_id, session_id }) =>
      runTool(
        Effect.gen(function* () {
          const d = yield* ToolDepsService;
          const honcho = yield* d.honchoFor(workspace_id);
          yield* apiCall("schedule dream", () =>
            honcho.scheduleDream({
              observer: peer_id,
              observed: target_peer_id,
              session: session_id,
            }),
          );
          return "Dream scheduled successfully";
        }),
        deps,
      ),
  );

  // ── get_queue_status ────────────────────────────────────────────────
  server.registerTool(
    "get_queue_status",
    {
      annotations: { title: "Get Queue Status", readOnlyHint: true },
      description: [
        "Get the current processing queue status for background tasks (message derivation, dreams).",
        "Use this to check if Honcho is still processing messages before querying for insights.",
        "Returns work unit counts: total, completed, in-progress, and pending.",
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
          const status = yield* apiCall("get queue status", () =>
            honcho.queueStatus(),
          );
          return status;
        }),
        deps,
      ),
  );
}