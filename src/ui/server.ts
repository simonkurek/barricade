import index from "./index.html";

/**
 * Minimal full-stack dev server. Bun bundles the TypeScript imported by
 * index.html (the engine + UI) for the browser automatically — no build step,
 * no framework. Run with `bun --hot src/ui/server.ts` and open the URL.
 */
const server = Bun.serve({
  port: 3000,
  routes: {
    "/": index,
  },
  development: true,
});

console.log(`Barricade UI running at ${server.url}`);
