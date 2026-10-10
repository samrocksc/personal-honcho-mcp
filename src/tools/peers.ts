import { z } from "zod";
import { Effect } from "effect";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolDeps } from "../deps.js";
import { ToolDepsService, apiCall } from "../honcho.js";
import { runTool } from "../run.js";
import {
  errorResult,
  workspaceIdSchema,
} from "../types.js";

export function register(server: McpServer, deps: ToolDeps) {
  // ── create_peer ─────────────────────────────────────────────────────
  server.registerTool(
    "create_peer",
    {
      annotations: { title: "Create Peer", readOnlyHint: false, destructiveHint: false },
      description: [
        "Get or create a peer with the given ID.",
        "Use this to register a new participant (user or agent) in the workspace.",
        "Returns the peer ID and any configuration that was set.",
      ].join("\n"),
      inputSchema: {
        workspace_id: workspaceIdSchema(deps),
        peer_id: z.string().describe("Unique identifier for the peer."),
        configuration: z
          .object({
            observeMe: z.boolean().nullable().optional().describe(
              "Whether derivation tasks should be created for this peer's messages. Default: true.",
            ),
          })
          .optional()
          .describe("Optional peer configuration."),
      },
    },
    async ({ workspace_id, peer_id, configuration }) =>
      runTool(
        Effect.gen(function* () {
          const d = yield* ToolDepsService;
          const honcho = yield* d.honchoFor(workspace_id);
          const peer = yield* apiCall("create peer", () =>
            honcho.peer(peer_id, { configuration }),
          );
          return { peer_id: peer.id, configuration: peer.configuration };
        }),
        deps,
      ),
  );

  // ── list_peers ──────────────────────────────────────────────────────
  server.registerTool(
    "list_peers",
    {
      annotations: { title: "List Peers", readOnlyHint: true },
      description: [
        "List peers in the given workspace (paginated).",
        "Use this to discover which users and agents exist.",
        "Returns peer IDs with pagination metadata; pass page/size to walk past the first page.",
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
          const p = yield* apiCall("list peers", () =>
            honcho.peers({ page: pageNum, size, reverse }),
          );
          return {
            peers: p.items.map((x) => ({ id: x.id })),
            total: p.total,
            page: p.page,
            pages: p.pages,
          };
        }),
        deps,
      ),
  );

  // ── chat ────────────────────────────────────────────────────────────
  server.registerTool(
    "chat",
    {
      annotations: { title: "Ask About a Peer", readOnlyHint: true },
      description: [
        "Ask a natural-language question about ONE peer and get an answer from Honcho's reasoning system.",
        "Requires `peer_id`. Answers from that peer's representation only — not the rest of the workspace.",
        "For cross-peer themes or questions not tied to one peer, use `workspace_chat`.",
        "For questions about the configured user, `chat_about_me` is a shortcut.",
        "Returns a natural-language answer, or 'None' if no relevant information exists.",
        "With `include_evidence`, returns an object instead: the answer plus what the agent read to produce it.",
      ].join("\n"),
      inputSchema: {
        workspace_id: workspaceIdSchema(deps),
        peer_id: z.string().describe("The peer to query about."),
        query: z.string().describe("Natural-language question."),
        target_peer_id: z
          .string()
          .optional()
          .describe(
            "Optional: query what peer_id knows about this target peer instead of their global representation.",
          ),
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
        sessions: z
          .array(z.string())
          .max(1000)
          .optional()
          .describe(
            "Optional: allowlist of session IDs to confine recall to (explicit conclusions only). Use for an ad hoc boundary without provisioning a scope.",
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
      peer_id,
      query,
      target_peer_id,
      session_id,
      scope,
      sessions,
      reasoning_level,
      include_evidence,
    }) =>
      runTool(
        Effect.gen(function* () {
          const d = yield* ToolDepsService;
          const honcho = yield* d.honchoFor(workspace_id);
          const peer = yield* apiCall("get peer", () => honcho.peer(peer_id));
          const options = {
            target: target_peer_id,
            session: session_id,
            scope,
            sessions,
            reasoningLevel: reasoning_level ?? d.config.reasoningLevel,
          };
          if (!include_evidence) {
            const result = yield* apiCall("chat", () => peer.chat(query, options));
            return result ?? "None";
          }
          const { content, evidence } = yield* apiCall("chat", () =>
            peer.chat(query, { ...options, includeEvidence: true }),
          );
          return { content: content ?? "None", evidence };
        }),
        deps,
      ),
  );

  // ── get_peer_card ───────────────────────────────────────────────────
  server.registerTool(
    "get_peer_card",
    {
      annotations: { title: "Get Peer Card", readOnlyHint: true },
      description: [
        "Get the peer card — a compact set of biographical facts about a peer.",
        "Use this when you need a quick summary of who someone is.",
        "Returns an array of fact strings, or null if no card exists yet.",
      ].join("\n"),
      inputSchema: {
        workspace_id: workspaceIdSchema(deps),
        peer_id: z.string().describe("The observer peer."),
        target_peer_id: z
          .string()
          .optional()
          .describe(
            "Optional: get this peer's card about the target instead of their own.",
          ),
      },
    },
    async ({ workspace_id, peer_id, target_peer_id }) =>
      runTool(
        Effect.gen(function* () {
          const d = yield* ToolDepsService;
          const honcho = yield* d.honchoFor(workspace_id);
          const peer = yield* apiCall("get peer", () => honcho.peer(peer_id));
          const card = yield* apiCall("get peer card", () =>
            peer.getCard(target_peer_id),
          );
          return card ?? "No peer card found.";
        }),
        deps,
      ),
  );

  // ── set_peer_card ───────────────────────────────────────────────────
  server.registerTool(
    "set_peer_card",
    {
      annotations: { title: "Set Peer Card", readOnlyHint: false, destructiveHint: true },
      description: [
        "Set or update the peer card — a list of biographical facts about a peer.",
        "Use this to manually establish or correct facts about a peer.",
        "Returns the updated peer card.",
      ].join("\n"),
      inputSchema: {
        workspace_id: workspaceIdSchema(deps),
        peer_id: z.string().describe("The observer peer."),
        peer_card: z
          .array(z.string())
          .describe("Array of fact strings to set as the peer card."),
        target_peer_id: z
          .string()
          .optional()
          .describe(
            "Optional: set this peer's card about the target instead of their own.",
          ),
      },
    },
    async ({ workspace_id, peer_id, peer_card, target_peer_id }) =>
      runTool(
        Effect.gen(function* () {
          const d = yield* ToolDepsService;
          const honcho = yield* d.honchoFor(workspace_id);
          const peer = yield* apiCall("get peer", () => honcho.peer(peer_id));
          const result = yield* apiCall("set peer card", () =>
            peer.setCard(peer_card, target_peer_id),
          );
          return result ?? "Peer card set successfully";
        }),
        deps,
      ),
  );

  // ── get_peer_context ────────────────────────────────────────────────
  server.registerTool(
    "get_peer_context",
    {
      annotations: { title: "Get Peer Context", readOnlyHint: true },
      description: [
        "Get comprehensive context for a peer — combines their representation (conclusions) and peer card.",
        "Use this when you need the full picture of what Honcho knows about someone.",
        "Returns an object with representation, peer_card, peer_id, and target_id.",
      ].join("\n"),
      inputSchema: {
        workspace_id: workspaceIdSchema(deps),
        peer_id: z.string().describe("The observer peer."),
        target_peer_id: z
          .string()
          .optional()
          .describe("Optional: get context about this target peer."),
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
      peer_id,
      target_peer_id,
      search_query,
      max_conclusions,
    }) =>
      runTool(
        Effect.gen(function* () {
          const d = yield* ToolDepsService;
          const honcho = yield* d.honchoFor(workspace_id);
          const peer = yield* apiCall("get peer", () => honcho.peer(peer_id));
          const context = yield* apiCall("get peer context", () =>
            peer.context({
              target: target_peer_id,
              searchQuery: search_query,
              maxConclusions: max_conclusions,
            }),
          );
          return {
            peer_id: context.peerId,
            target_id: context.targetId,
            representation: context.representation,
            peer_card: context.peerCard,
          };
        }),
        deps,
      ),
  );

  // ── get_representation ──────────────────────────────────────────────
  server.registerTool(
    "get_representation",
    {
      annotations: { title: "Get Peer Representation", readOnlyHint: true },
      description: [
        "Get the formatted representation for a peer — a text summary built from their conclusions.",
        "Use this when you want the textual representation without the peer card.",
        "Returns a formatted string of conclusions.",
      ].join("\n"),
      inputSchema: {
        workspace_id: workspaceIdSchema(deps),
        peer_id: z.string().describe("The observer peer."),
        target_peer_id: z
          .string()
          .optional()
          .describe("Optional: get representation about this target peer."),
        session_id: z
          .string()
          .optional()
          .describe("Optional: scope to a specific session."),
        scope: z
          .union([z.string(), z.array(z.string()).max(100)])
          .optional()
          .describe(
            "Optional: confine the representation to a scope. A single scope name reads that scope's own reasoned view (all conclusion levels). A list of scope names is an allowlist: explicit conclusions from the union of their sessions only.",
          ),
        sessions: z
          .array(z.string())
          .max(1000)
          .optional()
          .describe(
            "Optional: allowlist of session IDs to confine the representation to (explicit conclusions only). Use for an ad hoc boundary without provisioning a scope.",
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
      peer_id,
      target_peer_id,
      session_id,
      scope,
      sessions,
      search_query,
      max_conclusions,
    }) =>
      runTool(
        Effect.gen(function* () {
          const d = yield* ToolDepsService;
          const honcho = yield* d.honchoFor(workspace_id);
          const peer = yield* apiCall("get peer", () => honcho.peer(peer_id));
          const rep = yield* apiCall("get representation", () =>
            peer.representation({
              target: target_peer_id,
              session: session_id,
              scope,
              sessions,
              searchQuery: search_query,
              maxConclusions: max_conclusions,
            }),
          );
          return rep;
        }),
        deps,
      ),
  );
}
