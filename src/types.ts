import { z } from "zod";
import type {
  Conclusion,
  Honcho,
  Message,
  Summary,
  SessionSummaries,
} from "@honcho-ai/sdk";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { HonchoConfig } from "./config.js";
import { resolveWorkspaceId } from "./config.js";

export interface ToolContext {
  config: HonchoConfig;
  /** Return a Honcho client scoped to the given workspace (or the default). */
  clientFor: (workspaceId?: string) => Honcho;
  /** Client used only for credential-scoped ops (list/create workspaces). */
  unscoped: Honcho;
}

/**
 * Always optional at the schema layer so a missing value reaches
 * resolveWorkspaceId, which returns a clear error when unresolvable.
 */
export function workspaceIdSchema(ctx: ToolContext) {
  const fromEnv = ctx.config.workspaceId;
  const description = fromEnv
    ? `Workspace to operate in. The server defaulted to HONCHO_WORKSPACE_ID=${fromEnv}; omit this argument unless you need a different workspace.`
    : "Workspace to operate in. Omit if the server set HONCHO_WORKSPACE_ID; otherwise pass it on every call.";
  const field = z.string().optional().describe(description);
  return fromEnv ? field.default(fromEnv) : field;
}

export function textResult(
  data: string | object | unknown[],
): CallToolResult {
  const text = typeof data === "string" ? data : JSON.stringify(data);
  return { content: [{ type: "text", text }] };
}

export function errorResult(msg: string): CallToolResult {
  return { content: [{ type: "text", text: msg }], isError: true };
}

export function errorMessage(prefix: string, e: unknown): string {
  return `${prefix}: ${e instanceof Error ? e.message : String(e)}`;
}

/** Serialize a Message to a plain JSON-safe object. */
export function formatMessage(message: Message) {
  return {
    id: message.id,
    content: message.content,
    peer_id: message.peerId,
    session_id: message.sessionId,
    metadata: message.metadata,
    created_at: message.createdAt,
  };
}

/** Serialize a Message[] to a plain JSON-safe array. */
export function formatMessages(messages: Message[]) {
  return messages.map(formatMessage);
}

/** Serialize a Conclusion to a plain JSON-safe object. */
export function formatConclusion(conclusion: Conclusion) {
  return {
    id: conclusion.id,
    content: conclusion.content,
    level: conclusion.level,
    source_ids: conclusion.sourceIds,
    times_derived: conclusion.timesDerived,
    observer_id: conclusion.observerId,
    observed_id: conclusion.observedId,
    session_id: conclusion.sessionId,
    created_at: conclusion.createdAt,
  };
}

/** Serialize a Conclusion[] to a plain JSON-safe array. */
export function formatConclusions(conclusions: Conclusion[]) {
  return conclusions.map(formatConclusion);
}

/** Serialize a Summary to a plain JSON-safe object. */
export function formatSummary(summary: Summary) {
  return {
    content: summary.content,
    message_id: summary.messageId,
    summary_type: summary.summaryType,
    created_at: summary.createdAt,
    token_count: summary.tokenCount,
  };
}

/** Serialize SessionSummaries to a plain JSON-safe object. */
export function formatSessionSummaries(summaries: SessionSummaries) {
  return {
    session_id: summaries.sessionId,
    short_summary: summaries.shortSummary
      ? formatSummary(summaries.shortSummary)
      : null,
    long_summary: summaries.longSummary
      ? formatSummary(summaries.longSummary)
      : null,
  };
}