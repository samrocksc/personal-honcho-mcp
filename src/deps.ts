import { type Effect } from "effect";
import type { Honcho } from "@honcho-ai/sdk";
import type { HonchoConfig } from "./config.js";
import type { HonchoApiError, MissingWorkspaceError } from "./errors.js";

/**
 * Services every tool program runs against, provided via Effect layers.
 * Tests replace the Honcho client with a stub layer.
 */
export interface ToolDeps {
  /** Parsed server configuration (env / per-connection). */
  config: HonchoConfig;
  /** Workspace-scoped Honcho client factory; resolves the config default. */
  honchoFor: (
    workspaceId?: string,
  ) => Effect.Effect<Honcho, HonchoApiError | MissingWorkspaceError>;
  /** Client for credential-scoped ops (list_/create_workspace). */
  unscoped: Honcho;
}