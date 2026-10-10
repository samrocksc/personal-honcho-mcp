import { Data } from "effect";

/**
 * Tagged domain errors. Every tool failure path is typed; `renderError`
 * maps any E channel value into the tool's text error result.
 */
export class MissingWorkspaceError extends Data.TaggedError(
  "MissingWorkspaceError",
)<{
  readonly message: string;
}> {}

export class MissingIdentityError extends Data.TaggedError(
  "MissingIdentityError",
)<{
  readonly kind: "user" | "ai";
}> {
  get message(): string {
    return this.kind === "user"
      ? "Missing user peer. Pass user_peer_id on the tool call, or set HONCHO_USER_PEER_ID on the server."
      : "Missing AI peer. Pass ai_peer_id on the tool call, or set HONCHO_AI_PEER_ID on the server.";
  }
}

export class HonchoApiError extends Data.TaggedError("HonchoApiError")<{
  readonly op: string;
  readonly cause: unknown;
}> {
  get message(): string {
    const cause = this.cause;
    return `${this.op}: ${cause instanceof Error ? cause.message : String(cause)}`;
  }
}

/** Map any error to the human-facing text used in MCP error results. */
export function renderError(e: unknown): string {
  if (
    e &&
    typeof e === "object" &&
    "message" in e &&
    typeof (e as { message: unknown }).message === "string"
  ) {
    return (e as { message: string }).message;
  }
  return e instanceof Error ? e.message : String(e);
}