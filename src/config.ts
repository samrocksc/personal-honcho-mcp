import { Honcho } from "@honcho-ai/sdk";

/** Chat runs a tool-using agent that can outlast shorter defaults. */
const DEFAULT_TIMEOUT_MS = 300_000;

export const REASONING_LEVELS = [
  "minimal",
  "low",
  "medium",
  "high",
  "max",
] as const;
export type ReasoningLevel = (typeof REASONING_LEVELS)[number];

export interface IdentityConfig {
  /** The user's peer ID (e.g. "sam"). Powers all "my" tools. */
  userPeerId?: string;
  /** Default AI peer ID (e.g. "assistant"). Overridable per tool call. */
  aiPeerId?: string;
  /** Default reasoning level for chat-family tools. */
  reasoningLevel?: ReasoningLevel;
}

export interface HonchoConfig extends IdentityConfig {
  /** Optional. When unset, no Authorization header is sent (keyless self-host). */
  apiKey?: string;
  baseUrl: string;
  /** Default workspace for tools; individual calls may override. */
  workspaceId?: string;
  /** Honcho API request timeout, from HONCHO_TIMEOUT_MS. */
  timeoutMs: number;
}

export interface EnvConfig {
  HONCHO_API_KEY?: string;
  HONCHO_API_URL?: string;
  HONCHO_WORKSPACE_ID?: string;
  HONCHO_USER_PEER_ID?: string;
  HONCHO_AI_PEER_ID?: string;
  HONCHO_REASONING_LEVEL?: string;
  HONCHO_TIMEOUT_MS?: string;
}

export function parseTimeoutMs(value?: string): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT_MS;
}

export function parseReasoningLevel(
  value?: string,
): ReasoningLevel | undefined {
  const v = value?.trim().toLowerCase();
  if (!v) return undefined;
  return (REASONING_LEVELS as readonly string[]).includes(v)
    ? (v as ReasoningLevel)
    : undefined;
}

const DEFAULT_BASE_URL = "https://api.honcho.dev";

export function missingIdentityMessage(kind: "user" | "ai_peer"): string {
  return kind === "user"
    ? "Missing user peer. Pass user_peer_id on the tool call, or set HONCHO_USER_PEER_ID on the server."
    : "Missing AI peer. Pass ai_peer_id on the tool call, or set HONCHO_AI_PEER_ID on the server.";
}

/** Parse configuration from process env. Never throws for optional values. */
export function parseEnvConfig(env: EnvConfig): HonchoConfig {
  return {
    apiKey: env.HONCHO_API_KEY?.trim() || undefined,
    baseUrl: env.HONCHO_API_URL?.trim() || DEFAULT_BASE_URL,
    workspaceId: env.HONCHO_WORKSPACE_ID?.trim() || undefined,
    userPeerId: env.HONCHO_USER_PEER_ID?.trim() || undefined,
    aiPeerId: env.HONCHO_AI_PEER_ID?.trim() || undefined,
    reasoningLevel: parseReasoningLevel(env.HONCHO_REASONING_LEVEL),
    timeoutMs: parseTimeoutMs(env.HONCHO_TIMEOUT_MS),
  };
}

export function resolveWorkspaceId(
  config: HonchoConfig,
  workspaceId?: string | null,
): string {
  const id = workspaceId?.trim() || config.workspaceId?.trim();
  if (!id) {
    throw new Error(
      "Missing workspace_id. Pass workspace_id on the tool call, or set HONCHO_WORKSPACE_ID on the server.",
    );
  }
  return id;
}

export const MISSING_WORKSPACE_ID_MESSAGE =
  "Missing workspace_id. Pass workspace_id on the tool call, or set HONCHO_WORKSPACE_ID on the server.";

export function createClient(
  config: HonchoConfig,
  workspaceId?: string,
): Honcho {
  return new Honcho({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
    workspaceId: workspaceId ?? config.workspaceId,
    timeout: config.timeoutMs,
  });
}

/**
 * Client factory with a per-workspace cache.
 * Throws when no workspace can be resolved (config default + argument).
 */
export function createClientFactory(
  config: HonchoConfig,
): (workspaceId?: string) => Honcho {
  const cache = new Map<string, Honcho>();
  return (workspaceId?: string) => {
    const id = resolveWorkspaceId(config, workspaceId);
    let client = cache.get(id);
    if (!client) {
      client = createClient(config, id);
      cache.set(id, client);
    }
    return client;
  };
}

/** Client used only for credential-scoped ops (list/create workspace). */
export function createUnscopedClient(config: HonchoConfig): Honcho {
  return createClient(config);
}