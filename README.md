# personal-honcho-mcp

Personal MCP server for [Honcho](https://honcho.dev), pointed at your **self-hosted** instance. Full tool parity with the official Honcho MCP server, plus an **identity layer** for your configured user and AI peer.

Node 22 · TypeScript · **[Effect-TS](https://effect.website)** · JSON over Streamable HTTP (Docker) and stdio (local clients).

## Architecture

Every tool is an `Effect.gen` program. Its error channel is typed: `Effect.catch`-style handling maps `MissingWorkspaceError` / `MissingIdentityError` / `HonchoApiError` into the tool's error result — no untyped throw paths. Dependencies (parsed config + workspace-cached Honcho clients) live in a `ToolDepsService` provided by `runTool`, so tests can swap the Honcho client for a stub and drive the full MCP protocol over `InMemoryTransport` — no network, no mocks of the transport layer.

## Why

The official server expects you to pass `peer_id` on every call. This one knows who you are: set `HONCHO_USER_PEER_ID` and `HONCHO_AI_PEER_ID` once, and the identity tools answer "what does my AI remember about me?" with zero arguments.

## Configure

| Variable | Default | Purpose |
|---|---|---|
| `HONCHO_API_URL` | `https://api.honcho.dev` | Your self-hosted server |
| `HONCHO_API_KEY` | *(empty)* | Optional. Empty = keyless self-host mode (no auth header sent) |
| `HONCHO_WORKSPACE_ID` | *(unset)* | Default workspace; tools omit `workspace_id` |
| `HONCHO_USER_PEER_ID` | *(unset)* | You — powers all identity tools |
| `HONCHO_AI_PEER_ID` | *(unset)* | Default AI peer; every identity tool accepts a per-call override |
| `HONCHO_REASONING_LEVEL` | *(unset)* | `minimal`/`low`/`medium`/`high`/`max` default for chat tools |
| `HONCHO_TIMEOUT_MS` | `300000` | Per-request API timeout (chat is slow) |
| `HOST` / `PORT` | `0.0.0.0` / `3000` | HTTP bind |
| `MCP_SESSION_IDLE_MS` | `1800000` | Drop idle MCP sessions after |
| `MCP_SESSION_MAX` | `128` | Concurrent session cap |

`.env.example` covers every variable — copy it to `.env` and fill in yours.
The server auto-loads `.env` from its working directory; real environment
variables take precedence.

## Run

### Docker (recommended)

```bash
# Build locally
docker compose up -d --build

# Or use the published image
# image: ghcr.io/<owner>/personal-honcho-mcp:latest
```

Connect any MCP client via `mcp-remote`:

```
mcp-remote http://127.0.0.1:3000/mcp
```

`GET /health` is unauthenticated. Bearer auth is accepted if you set `HONCHO_API_KEY` on clients, but not required. MCP is served at `/` and `/mcp`.

### Compose alongside self-hosted Honcho

Drop the `mcp:` service from `docker-compose.yml` into your Honcho stack's compose file — `HONCHO_API_URL: http://api:8000` with the service names from [honcho's docker-compose.yml.example](https://github.com/plastic-labs/honcho/blob/main/docker-compose.yml.example).

### Local stdio (Claude Desktop, Codex, ...)

```bash
npm install && npm run build
claude mcp add personal-honcho \
  -e HONCHO_API_URL=http://your-honcho-host:8000 \
  -e HONCHO_WORKSPACE_ID=my-workspace \
  -e HONCHO_USER_PEER_ID=me \
  -e HONCHO_AI_PEER_ID=assistant \
  -- node /path/to/personal-honcho-mcp/dist/stdio.js
```

## Tools

**Identity layer** (configured user + AI peer; every tool takes optional `ai_peer_id`/`user_peer_id` overrides):

| Tool | Purpose |
|---|---|
| `get_my_peer_card` | AI peer's card about you |
| `set_my_peer_card` | Correct/boot your card |
| `get_ai_peer_card` | Your card about the AI peer |
| `set_ai_peer_card` | Write the AI peer's card from your view |
| `chat_about_me` | Ask about you from the AI peer's memory |
| `chat_as_user` | Ask from your representation of the AI peer |
| `get_my_context` | Representation + card about you in one call |
| `get_my_representation` | AI peer's conclusions about you, no card |
| `conclude_about_me` | Record facts about you into memory |
| `list_my_conclusions` | Review what the AI peer holds about you |
| `query_my_conclusions` | Semantic search over those conclusions |
| `update_my_conclusion` | Replace a conclusion's content (fetch-delete-recreate) |
| `delete_my_conclusion` | Remove a wrong/outdated fact |

**Workspace:** `list_workspaces`, `create_workspace`, `inspect_workspace`, `search`, `workspace_chat`, `get_metadata`, `set_metadata`

**Peers:** `create_peer`, `list_peers`, `chat`, `get_peer_card`, `set_peer_card`, `get_peer_context`, `get_representation`

**Sessions:** `create_session`, `list_sessions`, `delete_session`, `clone_session`, `add_peers_to_session`, `remove_peers_from_session`, `get_session_peers`, `inspect_session`, `add_messages_to_session`, `get_session_messages`, `get_session_message`, `get_session_context`

**Scopes:** `list_scopes`, `create_scope`, `add_sessions_to_scope`, `remove_session_from_scope`, `get_scope_sessions`, `get_scope_status`

**Conclusions:** `list_conclusions`, `query_conclusions`, `get_conclusions`, `get_derived_conclusions`, `create_conclusions`, `delete_conclusion`

**System:** `schedule_dream`, `get_queue_status`

## Development

```bash
npm install
npm run dev          # HTTP on :3000, watch via tsx
npm run dev:stdio    # stdio host
npm test             # typecheck + unit tests
docker build -t personal-honcho-mcp .
```

## Publish to ghcr.io

`.github/workflows/docker-publish.yml` runs on every push to `main` and every
`v*` tag: typecheck + unit tests first, then a multi-arch (amd64/arm64) build
pushed to `ghcr.io/samrocksc/personal-honcho-mcp` (tagged `latest`, branch
name, semver).