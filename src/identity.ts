import { Effect } from "effect";
import { ToolDepsService } from "./honcho.js";
import { MissingIdentityError } from "./errors.js";

/**
 * Resolve the AI peer ID: explicit argument wins, then the HONCHO_AI_PEER_ID
 * default configured on the server.
 */
export function resolveAiPeer(
  aiPeerId: string | undefined,
): Effect.Effect<string, MissingIdentityError, ToolDepsService> {
  return Effect.gen(function* () {
    const deps = yield* ToolDepsService;
    const id = aiPeerId?.trim() || deps.config.aiPeerId?.trim();
    if (!id) return yield* Effect.fail(new MissingIdentityError({ kind: "ai" }));
    return id;
  });
}

/**
 * Resolve the user peer ID: explicit argument wins, then the
 * HONCHO_USER_PEER_ID default configured on the server.
 */
export function resolveUserPeer(
  userPeerId: string | undefined,
): Effect.Effect<string, MissingIdentityError, ToolDepsService> {
  return Effect.gen(function* () {
    const deps = yield* ToolDepsService;
    const id = userPeerId?.trim() || deps.config.userPeerId?.trim();
    if (!id) return yield* Effect.fail(new MissingIdentityError({ kind: "user" }));
    return id;
  });
}

/** Resolve both identities at once (AI peer observing the user). */
export function resolveIdentityPair(
  aiPeerId: string | undefined,
  userPeerId: string | undefined,
): Effect.Effect<
  { readonly aiPeerId: string; readonly userPeerId: string },
  MissingIdentityError,
  ToolDepsService
> {
  const ai = resolveAiPeer(aiPeerId);
  const user = resolveUserPeer(userPeerId);
  return Effect.all([ai, user]).pipe(
    Effect.map(([aiPeerId, userPeerId]) => ({ aiPeerId, userPeerId })),
  );
}