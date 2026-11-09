// Wraps the n8n -> Convex HTTP actions: every route verifies the HMAC signature (lib/signature.ts)
// over the raw body before anything else runs.
import type { z } from "zod";
import { httpAction, type ActionCtx } from "../_generated/server";
import { SIGNATURE_HEADER, verifyRequest } from "./signature";

export function json(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

class InvalidBodyError extends Error {}

/** Validates a parsed body inside a `signedRoute` handler; a mismatch becomes a 400. */
export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) throw new InvalidBodyError();
  return result.data;
}

/** Rejects a request from inside a handler with 400 `invalid_body` (for checks zod can't express). */
export function invalidBody(): never {
  throw new InvalidBodyError();
}

/**
 * Returns an httpAction that only calls `handler` for correctly signed requests.
 *
 * - The signature covers `t.METHOD.path.rawBody`, so the body is read as text *before* parsing:
 *   re-serialized JSON could differ byte for byte from what n8n signed.
 * - Every failure is the same generic 401; only the reason (missing/malformed/stale/mismatch) is
 *   logged, never the header, body or secret.
 * - For non-GET requests the body is parsed as JSON and handed over as `unknown`; handlers
 *   validate it with `parseBody`.
 */
export function signedRoute(handler: (ctx: ActionCtx, body: unknown, req: Request) => Promise<Response>) {
  return httpAction(async (ctx, req) => {
    const raw = await req.text();
    const path = new URL(req.url).pathname;
    const secret = process.env.N8N_TO_CONVEX_SECRET;
    const verdict = secret
      ? await verifyRequest({ secret, method: req.method, path, body: raw, header: req.headers.get(SIGNATURE_HEADER) })
      : ({ ok: false, reason: "not_configured" } as const);
    if (!verdict.ok) {
      console.warn(JSON.stringify({ event: "automation.unauthorized", method: req.method, path, reason: verdict.reason }));
      return json(401, { error: "unauthorized" });
    }

    let body: unknown = undefined;
    if (req.method !== "GET") {
      try {
        body = JSON.parse(raw);
      } catch {
        return json(400, { error: "invalid_body" });
      }
    }
    try {
      return await handler(ctx, body, req);
    } catch (e) {
      if (e instanceof InvalidBodyError) return json(400, { error: "invalid_body" });
      throw e;
    }
  });
}
