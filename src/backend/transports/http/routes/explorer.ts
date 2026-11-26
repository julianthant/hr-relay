import type { DashboardApp } from "./api-types.js";
import type { ExplorerRouteDeps } from "./explorer-types.js";

export function registerExplorerRoutes(app: DashboardApp, deps: ExplorerRouteDeps): void {
  const { body, etag } = deps.explorer;
  const headers = { "Cache-Control": "private, no-cache", ETag: etag };
  app.get("/api/v1/explorer", (c) => {
    const validators = c.req.header("If-None-Match");
    if (validators?.trim() === "*" || validators?.match(/"[^"]*"/gu)?.includes(etag)) {
      return new Response(null, { status: 304, headers });
    }
    return new Response(body, { headers: { ...headers, "Content-Type": "application/json" } });
  });
}
