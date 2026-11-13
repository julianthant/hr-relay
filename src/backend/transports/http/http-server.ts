import { getRequestListener, type HttpBindings, type Http2Bindings } from "@hono/node-server";
import { createServer, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { DashboardApp } from "./routes/api.js";
import { bindErrorOrigin } from "../../../models/failures/error-origins.js";
import type { Clock } from "../../../rules/time/clock.js";

export const SLOW_REQUEST_THRESHOLD_MS = 500;

export interface DashboardHttpObservation {
  readonly clock: Clock;
  readonly debugEvents: { emit(input: unknown): unknown };
}

export interface DashboardHttpServerDeps {
  readonly app: DashboardApp;

  readonly port: number;
  readonly hostname?: string;
  readonly observation?: DashboardHttpObservation;
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
  mount(app: DashboardApp, accepts: (request: Request) => boolean, observation?: DashboardHttpObservation): DashboardHttpMount;
}

type Mount = { app: DashboardApp; accepts: (request: Request) => boolean; state: "open" | "closing" | "closed" | "failed";
  failures: unknown[]; closing?: Promise<void>; observation?: DashboardHttpObservation };
type Transfer = { mount?: Mount; response: ServerResponse; done: Promise<void>; reason?: "client" | "shutdown" };

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export class DashboardClientDisconnectedError extends Error {
  constructor(phase: string) {
    super(`dashboard client disconnected ${phase}`);
    this.name = "DashboardClientDisconnectedError";
  }
}
bindErrorOrigin(DashboardClientDisconnectedError, "request-disconnected");

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
            // @hono/node-server ends a rejected pre-headers read as a finished body.
            if (!transfer.response.headersSent) transfer.response.destroy();
            controller.error(error);
            return;
          }
        }
        try { controller.close(); } catch { /* the adapter already cancelled this stream */ }
      },
      cancel,
    }, { highWaterMark: 0 });
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  };

  const handle = async (request: Request, bindings: HttpBindings | Http2Bindings): Promise<Response> => {
    const outgoing = bindings.outgoing;
    if (!(outgoing instanceof ServerResponse)) throw new Error("the dashboard HTTP server expects HTTP/1 responses");
    if (closing) return new Response(null, { status: 503 });
    const mount = selected?.state === "open" && selected.accepts(request) ? selected : undefined;
    const app = mount?.app ?? deps.app;
    const observation = mount === undefined ? deps.observation : mount.observation;
    const finished = Promise.withResolvers<void>();
    const timing = Promise.withResolvers<void>();
    const done = observation === undefined ? finished.promise : Promise.all([finished.promise, timing.promise]).then(() => undefined);
    const transfer: Transfer = { ...(mount === undefined ? {} : { mount }), response: outgoing, done };
    let isEventStream = false;
    active.add(transfer);
    void done.then(() => { active.delete(transfer); });
    if (observation !== undefined) {
      const startedAt = observation.clock.monotonicMs();
      const onClose = (): void => {
        outgoing.off("finish", onFinish);
        timing.resolve();
      };
      const onFinish = (): void => {
        try {
          if (isEventStream) return;
          const durationMs = observation.clock.monotonicMs() - startedAt;
          const status = outgoing.statusCode;
          if (durationMs <= SLOW_REQUEST_THRESHOLD_MS && status < 500) return;
          const method = request.method === "HEAD" ? "GET" : request.method;
          const matches = app.router.match(method, app.getPath(request))[0];
          const matched = matches.find(([[, route]]) => route.method !== "ALL") ?? matches.at(-1);
          const route = matched?.[0][1].path ?? "(unmatched)";
          observation.debugEvents.emit({ category: "http", phase: status >= 500 ? "failed" : "settled", area: "request",
            reason: status >= 500 ? "request-failed" : "slow-request", correlationId: randomUUID(),
            method: request.method, route, status, durationMs });
        } catch (error: unknown) { settleFailure(transfer, asError(error), false); }
        finally { outgoing.off("close", onClose); timing.resolve(); }
      };
      outgoing.once("finish", onFinish);
      outgoing.once("close", onClose);
    }
    // The adapter aborts with a bare string; the route gets one Error naming where the client left.
    const abort = new AbortController();
    let handedOff = false;
    request.signal.addEventListener("abort", () => {
      abort.abort(transfer.reason === "shutdown" ? new Error("dashboard server is shutting down")
        : new DashboardClientDisconnectedError(handedOff ? "during response transfer" : "before response handoff"));
    }, { once: true });
    const routed = new Request(request.url, {
      method: request.method, headers: request.headers, signal: abort.signal,
      ...(request.method === "GET" || request.method === "HEAD" ? {} : { body: request.body, duplex: "half" }),
    });
    try {
      const response = await app.fetch(routed);
      isEventStream = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() === "text/event-stream";
      if (abort.signal.aborted) {
        // The client left before handoff: release the body quietly; nobody receives this response.
        try { await response.body?.cancel(abort.signal.reason); } catch (cleanup: unknown) { settleFailure(transfer, asError(cleanup), false); }
        finished.resolve();
        return new Response(null, { status: 499 });
      }
      if (response.body === null) {
        finished.resolve();
        return response;
      }
      handedOff = true;
      return ownBody(response, transfer, routed, finished.resolve);
    } catch (error: unknown) {
      if (!abort.signal.aborted) settleFailure(transfer, asError(error), false);
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
    mount: (app: DashboardApp, accepts: (request: Request) => boolean, observation?: DashboardHttpObservation): DashboardHttpMount => {
      if (closing || selected !== undefined) throw new Error("dashboard HTTP mount unavailable");
      const mount: Mount = { app, accepts, state: "open", failures: [], ...(observation === undefined ? {} : { observation }) };
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
