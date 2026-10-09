import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  parseEnvConfig,
  createClientFactory,
  createUnscopedClient,
} from "./config.js";
import { createServer } from "./server.js";
import { loadDotenv } from "./dotenv.js";

loadDotenv();

try {
  const config = parseEnvConfig(process.env);
  const server = createServer({
    config,
    clientFor: createClientFactory(config),
    unscoped: createUnscopedClient(config),
  });
  await server.connect(new StdioServerTransport());
} catch (e) {
  const message = e instanceof Error ? e.message : String(e);
  console.error(message);
  process.exit(1);
}