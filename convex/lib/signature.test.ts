import { describe, expect, test } from "vitest";
import { SIGNATURE_HEADER, TOLERANCE_SECONDS, signRequest, verifyRequest } from "./signature";

const base = { secret: "s3cret", method: "POST", path: "/automation/reminders", body: '{"a":1}' };
const T = 1_800_000_000;
const nowMs = (seconds: number) => seconds * 1000;

describe("signature", () => {
  test("exposes the header name and tolerance", () => {
    expect(SIGNATURE_HEADER).toBe("X-LendLoop-Signature");
    expect(TOLERANCE_SECONDS).toBe(300);
  });

  test("round trip verifies", async () => {
    const header = await signRequest({ ...base, timestamp: T });
    expect(header).toMatch(/^t=1800000000,v1=[0-9a-f]{64}$/);
    expect(await verifyRequest({ ...base, header, now: nowMs(T) })).toEqual({ ok: true });
  });

  test("wrong secret is a mismatch", async () => {
    const header = await signRequest({ ...base, timestamp: T });
    expect(await verifyRequest({ ...base, secret: "other", header, now: nowMs(T) })).toEqual({ ok: false, reason: "mismatch" });
  });

  test("tampered body is a mismatch", async () => {
    const header = await signRequest({ ...base, timestamp: T });
    expect(await verifyRequest({ ...base, body: '{"a":2}', header, now: nowMs(T) })).toEqual({ ok: false, reason: "mismatch" });
  });

  test("a different path or method is a mismatch", async () => {
    const header = await signRequest({ ...base, timestamp: T });
    expect(await verifyRequest({ ...base, path: "/automation/errors", header, now: nowMs(T) })).toEqual({ ok: false, reason: "mismatch" });
    expect(await verifyRequest({ ...base, method: "GET", header, now: nowMs(T) })).toEqual({ ok: false, reason: "mismatch" });
  });

  test("timestamps outside the tolerance are stale, in both directions", async () => {
    const header = await signRequest({ ...base, timestamp: T });
    expect(await verifyRequest({ ...base, header, now: nowMs(T + 301) })).toEqual({ ok: false, reason: "stale" });
    expect(await verifyRequest({ ...base, header, now: nowMs(T - 301) })).toEqual({ ok: false, reason: "stale" });
    expect(await verifyRequest({ ...base, header, now: nowMs(T + 300) })).toEqual({ ok: true });
  });

  test("missing and malformed headers are rejected", async () => {
    expect(await verifyRequest({ ...base, header: null, now: nowMs(T) })).toEqual({ ok: false, reason: "missing" });
    expect(await verifyRequest({ ...base, header: "t=abc", now: nowMs(T) })).toEqual({ ok: false, reason: "malformed" });
    expect(await verifyRequest({ ...base, header: `t=${T},v1=zz`, now: nowMs(T) })).toEqual({ ok: false, reason: "malformed" });
  });

  test("method is case-insensitive", async () => {
    const header = await signRequest({ ...base, method: "post", timestamp: T });
    expect(await verifyRequest({ ...base, header, now: nowMs(T) })).toEqual({ ok: true });
  });

  test("matches Node crypto over UTF-8 bytes (non-ASCII payloads)", async () => {
    // node -e "require('crypto').createHmac('sha256','k').update('1700000000.POST./webhook/x.{\"name\":\"João — jardim\"}','utf8').digest('hex')"
    const header = await signRequest({
      secret: "k",
      method: "POST",
      path: "/webhook/x",
      body: '{"name":"João — jardim"}',
      timestamp: 1_700_000_000,
    });
    expect(header).toBe("t=1700000000,v1=8b38d4a9a3cca0936b5b057b305f4152491756404e7e649e0dc2b6dbd7ee00bd");
  });
});
