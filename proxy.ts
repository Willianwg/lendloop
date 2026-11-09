import { clerkMiddleware } from "@clerk/nextjs/server";

// Public pages: the landing page and the offline fallback (the service worker precaches it,
// possibly while signed out). Static files never reach this function (see the matcher).
// Every other page requires a session. This gate is for navigation only: the pages read data
// through Convex, which authorizes every call on its own.
const PUBLIC_PAGES = new Set(["/", "/offline"]);

export default clerkMiddleware(async (auth, req) => {
  if (!PUBLIC_PAGES.has(req.nextUrl.pathname)) await auth.protect();
});

export const config = {
  matcher: [
    // Skip Next.js internals and static files (incl. the web manifest and sw.js).
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
