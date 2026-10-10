import { Effect } from "effect";
import { ToolDepsService } from "./honcho.js";
import type { ToolDeps } from "./deps.js";
import { renderError } from "./errors.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/**
 * Run a tool program to completion, providing the ToolDepsService it depends
 * on. Success maps to a text result; failure (typed error or defect) maps to
 * an MCP error result.
 */
export function runTool<A>(
  effect: Effect.Effect<A, unknown, ToolDepsService>,
  deps: ToolDeps,
): Promise<CallToolResult> {
  return Effect.runPromise(
    Effect.provideService(effect, ToolDepsService, deps),
  ).then(
    (a): CallToolResult => ({
      content: [
        { type: "text", text: typeof a === "string" ? a : JSON.stringify(a) },
      ],
    }),
    (e): CallToolResult => ({
      content: [{ type: "text", text: renderError(e) }],
      isError: true,
    }),
  );
}