/**
 * The in-process HTTP host for the Hono BFF. Node's own `http` server feeds
 * `app.fetch` — no adapter dependency — and the response body (including the
 * SSE stream) is piped chunk-by-chunk so an EventSource sees envelopes as
 * they are enqueued.
 *
 * Loopback only (ref clock-config-secrets): the listener binds 127.0.0.1 and refuses any other
 * hostname — a "temporary" LAN bind would turn a local operator tool into an
 * unaudited remote-control surface.
 */
import { createServer, type IncomingMessage, type Server } from "node:http";
import { Readable } from "node:stream";
import { z } from "zod";
import type { DashboardApp } from "./routes/api.js";

export interface DashboardHttpServerDeps {
  readonly app: DashboardApp;
  /**
   * The config-resolved isolation port — never a literal at a call site.
   * 0 delegates to the OS (an ephemeral port), for a composition that must
   * not claim the machine-wide isolation port — a test composing the real
   * runtime; the returned `port` is always the port actually bound.
   */
  readonly port: number;
  readonly hostname?: string;
}

export interface DashboardHttpServer {
  readonly port: number;
  close(): Promise<void>;
}

function toWebRequest(req: IncomingMessage, hostname: string, port: number): Request {
  const url = `http://${hostname}:${String(port)}${req.url ?? "/"}`;
  const method = req.method ?? "GET";
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (typeof value === "string") headers.set(name, value);
    else if (Array.isArray(value)) for (const entry of value) headers.append(name, entry);
  }
  if (method === "GET" || method === "HEAD") return new Request(url, { method, headers });
  return new Request(url, {
    method,
    headers,
    body: Readable.toWeb(req) as unknown as BodyInit,
    duplex: "half",
  } as RequestInit);
}

export async function startDashboardHttpServer(deps: DashboardHttpServerDeps): Promise<DashboardHttpServer> {
  const requestedPort = z.number().int().nonnegative().parse(deps.port);
  const hostname = deps.hostname ?? "127.0.0.1";
  if (hostname !== "127.0.0.1" && hostname !== "localhost") {
    throw new Error(`the dashboard BFF is loopback-only; refusing to bind ${hostname}`);
  }

  // Reassigned to the OS-assigned port after listen when requestedPort is 0;
  // requests only arrive after listen, so the handler always sees the bound port.
  let boundPort = requestedPort;
  const server: Server = createServer((req, res) => {
    void (async (): Promise<void> => {
      const response = await deps.app.fetch(toWebRequest(req, hostname, boundPort));
      res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      if (response.body === null) {
        res.end();
        return;
      }
      const reader = response.body.getReader();
      res.on("close", () => {
        void reader.cancel().catch((cancelError: unknown) => {
          // The client hung up mid-stream; cancellation failure has no one
          // left to signal, but it must not become an unhandled rejection.
          void cancelError;
        });
      });
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        const canContinue = res.write(chunk.value);
        if (!canContinue) await new Promise<void>((resolve) => res.once("drain", resolve));
      }
      res.end();
    })().catch((error: unknown) => {
      res.destroy(error instanceof Error ? error : new Error(String(error)));
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(requestedPort, hostname, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("the dashboard HTTP server reported no TCP address after listen; the bound port is unknowable");
  }
  boundPort = address.port;

  return Object.freeze({
    port: boundPort,
    close: (): Promise<void> => new Promise<void>((resolve, reject) => {
      server.closeAllConnections();
      server.close((error) => {
        if (error === undefined) resolve();
        else reject(error);
      });
    }),
  });
}
