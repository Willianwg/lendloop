import type { AuthConfig } from "convex/server";

// Clerk issues the session token (aud "convex" via Clerk's Convex integration).
export default {
  providers: [{ domain: process.env.CLERK_JWT_ISSUER_DOMAIN!, applicationID: "convex" }],
} satisfies AuthConfig;
