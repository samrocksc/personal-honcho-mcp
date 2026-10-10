import { createServer as createHttpServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { parseEnvConfig, type HonchoConfig } from "./config.js";
import { makeToolDeps } from "./honcho.js";
import { createServer as createMcpServer } from "./server.js";
import { loadDotenv } from "./dotenv.js";

// .env first (never overrides real env vars), then the program.
loadDotenv();

const CORS_ORIGIN = "*";
const CORS_METHODS = "GET, POST, DELETE, OPTIONS";
const CORS_ALLOWED_HEADERS =
  "Content-Type, Authorization, mcp-session-id, mcp-protocol-version, last-event-id";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": CORS_ORIGIN,
  "Access-Control-Allow-Methods": CORS_METHODS,
  "Access-Control-Allow-Headers": CORS_ALLOWED_HEADERS,
  "Access-Control-Expose-Headers": "mcp-session-id",
};

const MCP_PATHS = new Set(["/", "/mcp"]);

type Session = {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  lastSeen: number;
  apiKey?: string;
};

const sessions = new Map<string, Session>();
const DEFAULT_SESSION_IDLE_MS = 30 * 60 * 1000;
const DEFAULT_SESSION_MAX = 128;

function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function dropSession(id: string): void {
  const session = sessions.get(id);
  if (!session) return;
  sessions.delete(id);
  void session.transport.close();
  void session.server.close();
}

function sweepSessions(): void {
  const idleMs = envInt("MCP_SESSION_IDLE_MS", DEFAULT_SESSION_IDLE_MS);
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastSeen > idleMs) dropSession(id);
  }
}

/**
 * Enforce MCP_SESSION_MAX: when at capacity, drop the least-recently-seen
 * session to make room. Called before creating a new session.
 */
function enforceSessionMax(): void {
  const max = envInt("MCP_SESSION_MAX", DEFAULT_SESSION_MAX);
  while (sessions.size >= max) {
    let oldestId: string | undefined;
    let oldestSeen = Infinity;
    for (const [id, session] of sessions) {
      if (session.lastSeen < oldestSeen) {
        oldestSeen = session.lastSeen;
        oldestId = id;
      }
    }
    if (!oldestId) break;
    dropSession(oldestId);
  }
}

function corsPreflight(res: ServerResponse): void {
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    res.setHeader(key, value);
  }
}

function jsonResponse(
  res: ServerResponse,
  body: unknown,
  status: number,
  extraHeaders?: Record<string, string>,
): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    ...CORS_HEADERS,
    ...extraHeaders,
  });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 10_000_000) {
        reject(new Error("Body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function readApiKey(req: IncomingMessage): string | undefined {
  const auth = req.headers.authorization?.trim();
  if (!auth) return undefined;
  const match = auth.match(/^Bearer\s+(.*)$/i);
  return match?.[1]?.trim() || undefined;
}

/**
 * Per-connection config: the bearer key is chosen by the client; everything
 * else comes from the server environment.
 */
function configForRequest(req: IncomingMessage): HonchoConfig {
  const config = parseEnvConfig(process.env);
  const apiKey = readApiKey(req);
  return apiKey ? { ...config, apiKey } : config;
}

async function handleMcp(req: IncomingMessage, res: ServerResponse) {
  sweepSessions();
  const sessionId = req.headers["mcp-session-id"];
  if (typeof sessionId === "string") {
    const existing = sessions.get(sessionId);
    if (existing) {
      const key = readApiKey(req);
      if ((existing.apiKey ?? undefined) !== (key ?? undefined)) {
        return jsonResponse(
          res,
          { error: "Authorization does not match this session." },
          401,
        );
      }
      existing.lastSeen = Date.now();
      return existing.transport.handleRequest(req, res);
    }
  }

  if (req.method !== "POST") {
    return jsonResponse(
      res,
      {
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Bad Request: No valid session ID provided",
        },
        id: null,
      },
      400,
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    return jsonResponse(
      res,
      {
        jsonrpc: "2.0",
        error: { code: -32700, message: "Parse error: Invalid JSON" },
        id: null,
      },
      400,
    );
  }

  const messages = Array.isArray(body) ? body : [body];
  if (!messages.some((message) => isInitializeRequest(message))) {
    return jsonResponse(
      res,
      {
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Bad Request: No valid session ID provided",
        },
        id: null,
      },
      400,
    );
  }

  // New session: build a config-scoped runtime + server.
  enforceSessionMax();
  const config = configForRequest(req);
  const deps = makeToolDeps(config);
  const mcp = createMcpServer(deps);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    enableJsonResponse: true,
    onsessioninitialized: (id: string) => {
      sessions.set(id, { transport, server: mcp, lastSeen: Date.now(), apiKey: config.apiKey });
    },
  });

  transport.onclose = () => {
    const id = transport.sessionId;
    if (id && sessions.get(id)?.transport === transport) {
      sessions.delete(id);
    }
  };

  await mcp.connect(transport);
  await transport.handleRequest(req, res, body);
}

export function startHttpServer(): void {
  // Effect bootstrap: environment → config → runtime → server lifecycle.
  const bootstrap = Effect.gen(function* () {
    const config = parseEnvConfig(process.env);
    const deps = makeToolDeps(config);
    yield* Effect.sync(() => buildAndListen(deps.config));
    return config;
  });

  Effect.runPromise(bootstrap).catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}

function buildAndListen(config: HonchoConfig): void {
  const port = Number(process.env.PORT);
  const resolvedPort = Number.isFinite(port) && port > 0 ? port : 3000;
  const host = process.env.HOST?.trim() || "0.0.0.0";

  const httpServer = createHttpServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    corsPreflight(res);

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        ...CORS_HEADERS,
        "Access-Control-Max-Age": "86400",
      });
      res.end();
      return;
    }

    if (req.method === "GET" && url.pathname === "/health") {
      jsonResponse(res, { ok: true }, 200);
      return;
    }

    if (MCP_PATHS.has(url.pathname)) {
      handleMcp(req, res).catch((e) => {
        jsonResponse(res, {
          jsonrpc: "2.0",
          error: { code: -32603, message: `Internal error: ${String(e)}` },
          id: null,
        }, 500);
      });
      return;
    }

    jsonResponse(res, { error: "Not found" }, 404);
  });

  httpServer.listen(resolvedPort, host, () => {
    console.error(`personal-honcho-mcp listening on http://${host}:${resolvedPort}`);
    console.error(
      `  honcho: ${config.baseUrl}` +
        ` (workspace: ${config.workspaceId ?? "unset"})` +
        ` (user: ${config.userPeerId ?? "unset"})` +
        ` (ai peer: ${config.aiPeerId ?? "unset"})` +
        ` (auth: ${config.apiKey ? "key" : "keyless"})`,
    );
  });

  const shutdown = () => {
    for (const id of [...sessions.keys()]) dropSession(id);
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

startHttpServer();