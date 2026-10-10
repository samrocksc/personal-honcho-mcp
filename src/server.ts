import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolDeps } from "./deps.js";
import { register as registerWorkspaceTools } from "./tools/workspace.js";
import { register as registerPeerTools } from "./tools/peers.js";
import { register as registerSessionTools } from "./tools/sessions.js";
import { register as registerScopeTools } from "./tools/scopes.js";
import { register as registerConclusionTools } from "./tools/conclusions.js";
import { register as registerSystemTools } from "./tools/system.js";
import { register as registerIdentityTools } from "./tools/identity.js";
import { register as registerMyConclusionTools } from "./tools/my-conclusions.js";

const INSTRUCTIONS = [
  "Personal Honcho MCP server for a self-hosted Honcho instance.",
  "",
  "Identity: the server is configured with a user peer (HONCHO_USER_PEER_ID)",
  "and a default AI peer (HONCHO_AI_PEER_ID). The `*_my_*` / `*about_me*`",
  "identity tools use these automatically; each accepts optional overrides so",
  "one server can serve multiple AI peers against the same user.",
  "",
  "Workspace: every workspace-scoped tool takes an optional workspace_id;",
  "omit it to use the server's HONCHO_WORKSPACE_ID default.",
  "",
  "Guidance:",
  "- Peer cards: get_my_peer_card (AI's card about the user), get_ai_peer_card",
  "  (user's card about the AI). Both directions exist; set_* writes them.",
  "- chat_about_me asks about the user; chat_as_user asks from the user's",
  "  view of the AI peer.",
  "- conclude_about_me records facts about the user; list/query/update/",
  "  delete_my_conclusion review and maintain them. Honcho conclusion content",
  "  is immutable — update_my_conclusion replaces it fetch-delete-recreate.",
  "- Use search/workspace_chat for cross-peer questions; chat/chat_about_me",
  "  for single-peer questions.",
  "- schedule_dream after heavy message writing to consolidate memory.",
].join("\n");

export function createServer(deps: ToolDeps): McpServer {
  const server = new McpServer(
    {
      name: "personal-honcho-mcp",
      version: "2.0.0",
    },
    { instructions: INSTRUCTIONS },
  );

  registerWorkspaceTools(server, deps);
  registerPeerTools(server, deps);
  registerSessionTools(server, deps);
  registerScopeTools(server, deps);
  registerConclusionTools(server, deps);
  registerSystemTools(server, deps);
  registerIdentityTools(server, deps);
  registerMyConclusionTools(server, deps);

  return server;
}