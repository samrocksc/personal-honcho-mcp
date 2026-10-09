import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Minimal .env loader (no dependency). Loads `<cwd>/.env` when present;
 * never overrides variables already set in the real environment.
 */
export function loadDotenv(
  env: NodeJS.ProcessEnv = process.env,
  dir: string = process.cwd(),
): void {
  let raw: string;
  try {
    raw = readFileSync(join(dir, ".env"), "utf8");
  } catch {
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = trimmed.slice(eq + 1).trim();
    const q = value[0];
    if ((q === '"' || q === "'") && value.length >= 2 && value.at(-1) === q) {
      value = value.slice(1, -1);
    }
    if (env[key] === undefined) env[key] = value;
  }
}