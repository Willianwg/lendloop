// Reads one key from the repo's .env without sourcing it, so the dev scripts can use the
// HMAC secrets that scripts/setup.sh generated. process.env wins, for CI or one-off overrides.
import { readFileSync } from "node:fs";
import { join } from "node:path";

export function envValue(key: string): string {
  if (process.env[key]) return process.env[key]!;
  let text = "";
  try {
    text = readFileSync(join(__dirname, "..", "..", ".env"), "utf8");
  } catch {
    // no .env: fall through to the error below
  }
  const line = text.split("\n").find((l) => l.startsWith(`${key}=`));
  const value = line?.slice(key.length + 1).trim().replace(/^['"]|['"]$/g, "");
  if (!value) throw new Error(`${key} is not set (run scripts/setup.sh to create .env)`);
  return value;
}
