/// <reference types="vite/client" />
// Every Convex test builds its backend with `convexTest(schema, modules)`.
export const modules = import.meta.glob("./**/*.*s");
