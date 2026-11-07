import { readFile } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";

export function createStaticAssetFixture() {
  const CONTENT_TYPES: Readonly<Record<string, string>> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".woff2": "font/woff2",
    ".png": "image/png",
    ".map": "application/json; charset=utf-8",
    ".json": "application/json; charset=utf-8",
  };

  async function serveStatic(distDir: string, pathname: string, res: ServerResponse): Promise<void> {
    const relative = pathname === "/" ? "/index.html" : pathname;
    const target = normalize(join(distDir, relative));
    if (!target.startsWith(normalize(distDir))) {
      res.writeHead(404).end("not found");
      return;
    }
    try {
      const body = await readFile(target);
      const type = CONTENT_TYPES[extname(target)];
      res.writeHead(200, type === undefined ? {} : { "content-type": type }).end(body);
    } catch {
      // A missing asset is a 404, never a silent empty 200 — the parity spec
      // fails loudly on a blank page rather than capturing one.
      res.writeHead(404).end("not found");
    }
  }

  return serveStatic;
}
