import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

/** Clerk's Frontend API origin: from the issuer domain, or decoded from the publishable key. */
function clerkFrontendApi(): string {
  const issuer = process.env.CLERK_JWT_ISSUER_DOMAIN;
  if (issuer) return new URL(issuer).origin;
  const key = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";
  const encoded = key.split("_")[2];
  if (!encoded) return "https://*.clerk.accounts.dev";
  return `https://${Buffer.from(encoded, "base64").toString("utf8").replace(/\$$/, "")}`;
}

const convex = new URL(process.env.NEXT_PUBLIC_CONVEX_URL ?? "http://127.0.0.1:3210");
const convexHttp = convex.origin;
const convexWs = `${convex.protocol === "https:" ? "wss:" : "ws:"}//${convex.host}`;
const clerk = clerkFrontendApi();
const turnstile = "https://challenges.cloudflare.com"; // Clerk's bot protection on sign-up
// Clerk's abuse and fraud protection. Its probes use ports other than 443, hence ":*" on connect-src.
const clerkProtect = "https://*.protect.clerk.com";

// Follows Clerk's manual CSP list (clerk.com/docs/guides/secure/best-practices/csp-headers).
// No nonces: they would force every page to render per request. Next.js still needs
// 'unsafe-inline' for its inline bootstrap scripts, and 'unsafe-eval' only in dev.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} ${clerk} ${clerkProtect} ${turnstile}`,
  `connect-src 'self' ${clerk} ${clerkProtect}:* ${convexHttp} ${convexWs}`,
  "img-src 'self' data: blob: https://img.clerk.com",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  `frame-src ${turnstile} ${clerkProtect}`,
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
