import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Effect } from "effect";
import { parseEnvConfig } from "./config.js";
import { makeToolDeps } from "./honcho.js";
import { createServer } from "./server.js";
import { loadDotenv } from "./dotenv.js";

// .env first (never overrides real env vars), then the program.
loadDotenv();

/** Effect bootstrap: environment → config → deps → MCP server on stdio. */
const bootstrap = Effect.gen(function* () {
  const config = yield* Effect.try(() => parseEnvConfig(process.env));
  const deps = makeToolDeps(config);
  const server = createServer(deps);
  yield* Effect.tryPromise(() => server.connect(new StdioServerTransport()));
  return config;
});

try {
  await Effect.runPromise(bootstrap).catch((e) => {
    console.error(
      `personal-honcho-mcp failed to start: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
    process.exit(1);
  });
} catch (e) {
  const message = e instanceof Error ? e.message : String(e);
  console.error(message);
  process.exit(1);
}