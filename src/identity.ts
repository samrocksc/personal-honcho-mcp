import type { ToolContext } from "./types.js";
import { missingIdentityMessage } from "./config.js";

/**
 * Resolve the user peer ID for identity tools: explicit argument wins,
 * then the HONCHO_USER_PEER_ID default. Throws with a clear message when
 * unresolvable.
 */
export function resolveUserPeerId(
  ctx: ToolContext,
  userPeerId?: string | null,
): string {
  const id = userPeerId?.trim() || ctx.config.userPeerId?.trim();
  if (!id) throw new Error(missingIdentityMessage("user"));
  return id;
}

/**
 * Resolve the AI peer ID for identity tools: explicit argument wins, then the
 * HONCHO_AI_PEER_ID default. Throws with a clear message when unresolvable.
 */
export function resolveAiPeerId(
  ctx: ToolContext,
  aiPeerId?: string | null,
): string {
  const id = aiPeerId?.trim() || ctx.config.aiPeerId?.trim();
  if (!id) throw new Error(missingIdentityMessage("ai_peer"));
  return id;
}