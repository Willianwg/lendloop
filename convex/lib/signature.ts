// HMAC-SHA256 request signatures for the Convex <-> n8n integration (both directions).
//
//   X-LendLoop-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256>
//   signed string:        `${t}.${METHOD}.${path}.${rawBody}`   (UTF-8)
//
// Binding the method and path stops a signature for one endpoint being replayed against
// another; the timestamp bounds replay to TOLERANCE_SECONDS. "v1" leaves room for key
// rotation (a v2 secret verified alongside v1). WebCrypto only, so the same code runs in
// the Convex runtime, in Vitest and in Node scripts. n8n's Code nodes implement the same
// algorithm with Node's crypto module.

export const SIGNATURE_HEADER = "X-LendLoop-Signature";
export const TOLERANCE_SECONDS = 300;

export type VerifyResult = { ok: true } | { ok: false; reason: "missing" | "malformed" | "stale" | "mismatch" };

const encoder = new TextEncoder();

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, "0")).join("");
}

function signedString(t: number, method: string, path: string, body: string): string {
  return `${t}.${method.toUpperCase()}.${path}.${body}`;
}

/** Constant-time comparison of two equal-length lowercase hex strings. */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Returns the header value for a request. `timestamp` (unix seconds) defaults to now. */
export async function signRequest(args: {
  secret: string;
  method: string;
  path: string;
  body: string;
  timestamp?: number;
}): Promise<string> {
  const t = args.timestamp ?? Math.floor(Date.now() / 1000);
  const v1 = await hmacHex(args.secret, signedString(t, args.method, args.path, args.body));
  return `t=${t},v1=${v1}`;
}

/** Verifies a header against the raw body. `now` is epoch ms (defaults to Date.now()). */
export async function verifyRequest(args: {
  secret: string;
  method: string;
  path: string;
  body: string;
  header: string | null;
  now?: number;
}): Promise<VerifyResult> {
  if (!args.header) return { ok: false, reason: "missing" };
  const match = /^t=(\d{1,12}),v1=([0-9a-f]{64})$/.exec(args.header.trim());
  if (!match) return { ok: false, reason: "malformed" };
  const t = Number(match[1]);
  const nowSeconds = Math.floor((args.now ?? Date.now()) / 1000);
  if (Math.abs(nowSeconds - t) > TOLERANCE_SECONDS) return { ok: false, reason: "stale" };
  const expected = await hmacHex(args.secret, signedString(t, args.method, args.path, args.body));
  return timingSafeEqualHex(expected, match[2]) ? { ok: true } : { ok: false, reason: "mismatch" };
}
