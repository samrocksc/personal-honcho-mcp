import { Context, Effect, Layer } from "effect";
import type { Honcho } from "@honcho-ai/sdk";
import {
  createClientFactory,
  createUnscopedClient,
  type HonchoConfig,
} from "./config.js";
import { HonchoApiError, MissingWorkspaceError } from "./errors.js";
import type { ToolDeps } from "./deps.js";

/** Service providing parsed config + workspace-scoped Honcho clients. */
export class ToolDepsService extends Context.Service<ToolDepsService, ToolDeps>()(
  "ToolDepsService",
) {}

export const MISSING_WORKSPACE_MESSAGE =
  "Missing workspace_id. Pass workspace_id on the tool call, or set HONCHO_WORKSPACE_ID on the server.";

/** Tool deps layer: config from memory, Honcho clients with workspace cache. */
export function toolDepsLayer(config: HonchoConfig): Layer.Layer<ToolDepsService> {
  return Layer.succeed(ToolDepsService, makeToolDeps(config));
}

export function makeToolDeps(config: HonchoConfig): ToolDeps {
  const factory = createClientFactory(config);
  return {
    config,
    unscoped: createUnscopedClient(config),
    honchoFor: (workspaceId?: string) =>
      Effect.try({
        try: () => factory.get(factory.resolve(workspaceId)),
        catch: () =>
          new MissingWorkspaceError({ message: MISSING_WORKSPACE_MESSAGE }),
      }),
  };
}

/**
 * Wrap a Honcho SDK call in an Effect, tagging any failure as
 * HonchoApiError with the operation name for error attribution.
 */
export function apiCall<A>(
  op: string,
  make: () => Promise<A>,
): Effect.Effect<A, HonchoApiError> {
  return Effect.tryPromise({
    try: make,
    catch: (cause) => new HonchoApiError({ op, cause }),
  });
}