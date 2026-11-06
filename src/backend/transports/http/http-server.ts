import { getRequestListener, type HttpBindings, type Http2Bindings } from "@hono/node-server";
import { createServer, ServerResponse } from "node:http";
import { z } from "zod";
import type { DashboardApp } from "./routes/api.js";

export interface DashboardHttpServerDeps {
  readonly app: DashboardApp;

  readonly port: number;
  readonly hostname?: string;
  /** Structured local observation for transfer/cleanup failures after no wire error remains possible. */
  readonly onTransferError?: (error: Error) => void;
}

export interface DashboardHttpMount {
  close(this: void): Promise<void>;
}

/** In-process dispatch of the signed-in application. The fetch identifier stays in this network owner. */
export function dispatchMountedRequest(app: DashboardApp, request: Request): ReturnType<DashboardApp["fetch"]> {
  return app.fetch(request);
}

export interface DashboardHttpServer {
  readonly port: number;
  close(): Promise<void>;
}

export interface DashboardHttpListener extends DashboardHttpServer {
  mount(app: DashboardApp, accepts: (request: Request) => boolean): DashboardHttpMount;
}

type Mount = { app: DashboardApp; accepts: (request: Request) => boolean; state: "open" | "closing" | "closed" | "failed";
  failures: unknown[]; closing?: Promise<void> };
type Transfer = { mount?: Mount; response: ServerResponse; done: Promise<void>; reason?: "client" | "shutdown" };

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function primaryFirstAggregate(primary: unknown, cleanup: unknown, message: string): AggregateError {
  return new AggregateError([primary, cleanup], message, { cause: primary });
}

export async function startDashboardHttpServer(deps: DashboardHttpServerDeps): Promise<DashboardHttpListener> {
  const requestedPort = z.number().int().nonnegative().parse(deps.port);
  const hostname = deps.hostname ?? "127.0.0.1";
  if (hostname !== "127.0.0.1" && hostname !== "localhost") {
    throw new Error(`the dashboard BFF is loopback-only; refusing to bind ${hostname}`);
  }

  const active = new Set<Transfer>();
  const unownedFailures: unknown[] = [];
  let selected: Mount | undefined;
  let closing = false;

  const retain = (transfer: Transfer, failure: unknown): void => {
    (transfer.mount?.failures ?? unownedFailures).push(failure);
  };
  /** Report to the local observer; an unobserved failure and a throwing observer stay owed until close, and an unproved cleanup stays owed by its mount. */
  const settleFailure = (transfer: Transfer, failure: Error, proved: boolean): void => {
    if (deps.onTransferError === undefined) {
      if (!proved) retain(transfer, new AggregateError([failure], "dashboard transfer failure had no local observer", { cause: failure }));
      return;
    }
    try {
      deps.onTransferError(failure);
    } catch (observerFailure: unknown) {
      retain(transfer, primaryFirstAggregate(failure, observerFailure, "dashboard transfer and local failure observation both failed"));
      return;
    }
    if (!proved) transfer.mount?.failures.push(failure);
  };

  /** Own the response body: client disconnect and shutdown cancel the source and settle only when that cancellation does. */
  const ownBody = (response: Response, transfer: Transfer, request: Request, settle: () => void): Response => {
    const source = (response.body as ReadableStream<Uint8Array>).getReader();
    let cancelling: Promise<void> | undefined;
    const cancel = (reason: unknown): Promise<void> => {
      transfer.reason ??= "client";
      cancelling ??= (async () => {
        transfer.response.off("close", onClose);
        const closed = new Error("dashboard response closed before finish");
        try {
          await source.cancel(reason ?? request.signal.reason);
        } catch (cleanup: unknown) {
          if (transfer.reason === "shutdown") retain(transfer, cleanup);
          else settleFailure(transfer, primaryFirstAggregate(closed, cleanup, "dashboard response transfer and cancellation both failed"), false);
          return settle();
        }
        if (transfer.reason === "client") settleFailure(transfer, closed, true);
        settle();
      })();
      return cancelling;
    };
    const onClose = (): void => {
      if (!transfer.response.writableFinished) void cancel(undefined);
    };
    transfer.response.once("close", onClose);
    if (transfer.response.destroyed) void cancel(undefined);
    const finish = (): void => {
      transfer.response.off("close", onClose);
      settle();
    };
    const body = new ReadableStream<Uint8Array>({
      async pull(controller): Promise<void> {
        try {
          const chunk = await source.read();
          if (cancelling === undefined) {
            if (chunk.done) {
              finish();
              controller.close();
            } else controller.enqueue(chunk.value);
            return;
          }
        } catch (error: unknown) {
          if (cancelling === undefined) {
            settleFailure(transfer, asError(error), false);
            finish();
            controller.error(error);
            return;
          }
        }
        try { controller.close(); } catch { /* the adapter already cancelled this stream */ }
      },
      cancel,
    }, { highWaterMark: 0 });
    const headers = new Headers(response.headers);
    // Declared chunked so a failing body read destroys the connection instead of ending as an empty success.
    if (!headers.has("content-length")) headers.set("transfer-encoding", "chunked");
    return new Response(body, { status: response.status, statusText: response.statusText, headers });
  };

  const handle = async (request: Request, bindings: HttpBindings | Http2Bindings): Promise<Response> => {
    const outgoing = bindings.outgoing;
    if (!(outgoing instanceof ServerResponse)) throw new Error("the dashboard HTTP server expects HTTP/1 responses");
    if (closing) return new Response(null, { status: 503 });
    const mount = selected?.state === "open" && selected.accepts(request) ? selected : undefined;
    const finished = Promise.withResolvers<void>();
    const transfer: Transfer = { ...(mount === undefined ? {} : { mount }), response: outgoing, done: finished.promise };
    active.add(transfer);
    void finished.promise.then(() => { active.delete(transfer); });
    try {
      const response = await (mount?.app ?? deps.app).fetch(request);
      if (response.body === null) {
        finished.resolve();
        return response;
      }
      return ownBody(response, transfer, request, finished.resolve);
    } catch (error: unknown) {
      settleFailure(transfer, asError(error), false);
      finished.resolve();
      throw error;
    }
  };

  const server = createServer(getRequestListener(handle, { hostname, overrideGlobalObjects: false }));
  let boundPort: number;

  try {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        server.removeListener("listening", onListening);
        reject(error);
      };
      const onListening = (): void => {
        server.removeListener("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(requestedPort, hostname);
    });
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("the dashboard HTTP server reported no TCP address after listen; the bound port is unknowable");
    }
    boundPort = address.port;
  } catch (primary: unknown) {
    if (server.listening) {
      try {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => error === undefined ? resolve() : reject(error));
        });
      } catch (cleanup: unknown) {
        server.closeAllConnections();
        throw primaryFirstAggregate(primary, cleanup, "dashboard HTTP startup and listener cleanup both failed");
      }
    }
    server.closeAllConnections();
    throw primary;
  }

  const shutDown = (transfers: readonly Transfer[]): void => {
    for (const transfer of transfers) {
      transfer.reason ??= "shutdown";
      transfer.response.destroy();
    }
  };

  return Object.freeze({
    port: boundPort,
    mount: (app: DashboardApp, accepts: (request: Request) => boolean): DashboardHttpMount => {
      if (closing || selected !== undefined) throw new Error("dashboard HTTP mount unavailable");
      const mount: Mount = { app, accepts, state: "open", failures: [] };
      selected = mount;
      return Object.freeze({ close(): Promise<void> {
        if (mount.closing !== undefined) return mount.closing;
        mount.state = "closing";
        const owned = [...active].filter((transfer) => transfer.mount === mount);
        shutDown(owned);
        mount.closing = (async () => {
          await Promise.all(owned.map((transfer) => transfer.done));
          if (mount.failures.length > 0) {
            mount.state = "failed";
            throw new AggregateError([...mount.failures], "dashboard HTTP mount closure is unproved");
          }
          mount.state = "closed";
          selected = undefined;
        })();
        return mount.closing;
      } });
    },
    close: async (): Promise<void> => {
      closing = true;
      const closeServer = new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) resolve();
          else reject(error);
        });
      });
      const transfers = [...active];
      shutDown(transfers);
      server.closeAllConnections();
      const [closed] = await Promise.allSettled([closeServer, ...transfers.map((transfer) => transfer.done)]);
      const failures: unknown[] = [...(selected?.failures ?? []), ...unownedFailures];
      if (closed.status === "rejected") failures.push(closed.reason);
      unownedFailures.length = 0;
      if (failures.length === 1) throw failures[0];
      if (failures.length > 1) throw new AggregateError(failures, "dashboard shutdown observed transfer cleanup failures");
    },
  });
}
