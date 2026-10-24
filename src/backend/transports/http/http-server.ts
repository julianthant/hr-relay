
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
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

export interface DashboardHttpServer {
  readonly port: number;
  close(): Promise<void>;
}

export interface DashboardHttpListener extends DashboardHttpServer {
  mount(app: DashboardApp, accepts: (request: Request) => boolean): DashboardHttpMount;
  committedResponse(response: Response): Promise<void>;
}

function toWebRequest(req: IncomingMessage, hostname: string, port: number, signal: AbortSignal): Request {
  const url = `http://${hostname}:${String(port)}${req.url ?? "/"}`;
  const method = req.method ?? "GET";
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (typeof value === "string") headers.set(name, value);
    else if (Array.isArray(value)) for (const entry of value) headers.append(name, entry);
  }
  if (method === "GET" || method === "HEAD") return new Request(url, { method, headers, signal });
  const body = Readable.toWeb(req);
  if (!(body instanceof ReadableStream)) {
    throw new Error("node request body did not adapt to a web ReadableStream");
  }
  const init: RequestInit & { readonly duplex: "half" } = {
    method,
    headers,
    body,
    duplex: "half",
    signal,
  };
  return new Request(url, init);
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function primaryFirstAggregate(primary: unknown, cleanup: unknown, message: string): AggregateError {
  return new AggregateError([primary, cleanup], message, { cause: primary });
}

class DashboardResponseClosedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DashboardResponseClosedError";
  }
}

function waitForDrain(res: ServerResponse): Promise<void> {
  if (res.destroyed) {
    return Promise.reject(new DashboardResponseClosedError("dashboard response closed before drain wait"));
  }
  return new Promise<void>((resolve, reject) => {
    const cleanup = (): void => {
      res.removeListener("drain", onDrain);
      res.removeListener("close", onClose);
      res.removeListener("error", onError);
    };
    const onDrain = (): void => {
      cleanup();
      resolve();
    };
    const onClose = (): void => {
      cleanup();
      reject(new DashboardResponseClosedError("dashboard response closed while waiting for drain"));
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    res.once("drain", onDrain);
    res.once("close", onClose);
    res.once("error", onError);
  });
}

function endResponse(res: ServerResponse): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const cleanup = (): void => {
      res.removeListener("finish", onFinish);
      res.removeListener("close", onClose);
      res.removeListener("error", onError);
    };
    const onFinish = (): void => {
      cleanup();
      resolve();
    };
    const onClose = (): void => {
      cleanup();
      reject(new DashboardResponseClosedError("dashboard response closed before finish"));
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    res.once("finish", onFinish);
    res.once("close", onClose);
    res.once("error", onError);
    res.end();
  });
}

interface RequestCancellation {
  readonly hasBody: boolean;
  readonly reason: Error | undefined;
  cancel(reason: Error): Promise<void>;
  attachBody(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void>;
  settle(): Promise<void>;
}

function createRequestCancellation(requestAbort: AbortController): RequestCancellation {
  let reason: Error | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let bodyCancellation: Promise<void> | undefined;
  const startBodyCancellation = (): Promise<void> => {
    if (reader === undefined || reason === undefined) return Promise.resolve();
    bodyCancellation ??= reader.cancel(reason);
    return bodyCancellation;
  };
  return {
    get hasBody(): boolean {
      return reader !== undefined;
    },
    get reason(): Error | undefined {
      return reason;
    },
    cancel(nextReason: Error): Promise<void> {
      reason ??= nextReason;
      requestAbort.abort(reason);
      return startBodyCancellation();
    },
    attachBody(nextReader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
      reader = nextReader;
      return reason === undefined ? Promise.resolve() : startBodyCancellation();
    },
    settle(): Promise<void> {
      return bodyCancellation ?? Promise.resolve();
    },
  };
}

class DashboardShutdownError extends Error {
  constructor() {
    super("dashboard server is shutting down");
    this.name = "DashboardShutdownError";
  }
}

async function pipeResponse(
  response: Response,
  res: ServerResponse,
  cancellation: RequestCancellation,
): Promise<void> {
  try {
    if (response.body === null) {
      if (res.destroyed) return;
      res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      await endResponse(res);
      return;
    }
    const reader = response.body.getReader();
    await cancellation.attachBody(reader);
    if (res.destroyed) {
      await cancellation.cancel(new Error("dashboard client disconnected before response handoff"));
      return;
    }
    res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (res.destroyed) {
        await cancellation.cancel(new DashboardResponseClosedError("dashboard response closed before body write"));
        return;
      }
      const canContinue = res.write(chunk.value);
      if (!canContinue) await waitForDrain(res);
    }
    if (res.destroyed) {
      await cancellation.cancel(new DashboardResponseClosedError("dashboard response closed before finish"));
      return;
    }
    await endResponse(res);
    await cancellation.settle();
  } catch (error: unknown) {
    const requestedReason = cancellation.reason;
    try {
      await cancellation.cancel(asError(error));
    } catch (cleanup: unknown) {
      throw primaryFirstAggregate(error, cleanup, "dashboard response transfer and cancellation both failed");
    }
    if (requestedReason instanceof DashboardShutdownError
      && (error === requestedReason || error instanceof DashboardResponseClosedError)) return;
    throw error;
  }
}

export async function startDashboardHttpServer(deps: DashboardHttpServerDeps): Promise<DashboardHttpListener> {
  const requestedPort = z.number().int().nonnegative().parse(deps.port);
  const hostname = deps.hostname ?? "127.0.0.1";
  if (hostname !== "127.0.0.1" && hostname !== "localhost") {
    throw new Error(`the dashboard BFF is loopback-only; refusing to bind ${hostname}`);
  }

  // Reassigned to the OS-assigned port after listen when requestedPort is 0;
  // requests only arrive after listen, so the handler always sees the bound port.
  let boundPort = requestedPort;
  type Mount = { app: DashboardApp; accepts: (request: Request) => boolean; state: "open" | "closing" | "closed" | "failed";
    failures: unknown[]; closing?: Promise<void> };
  type Transfer = { cancellation: RequestCancellation; response: ServerResponse; mount?: Mount };
  const active = new Map<Promise<void>, Transfer>();
  const commitments = new WeakMap<Response, { resolve(): void; reject(error: unknown): void }>();
  let selected: Mount | undefined;
  let closing = false;
  const retainedObserverFailures: AggregateError[] = [];
  const retainObserverFailure = (failure: AggregateError): void => {
    retainedObserverFailures.push(failure);
  };
  const server: Server = createServer((req, res) => {
    const requestAbort = new AbortController();
    const cancellation = createRequestCancellation(requestAbort);
    const ownership: Transfer = { cancellation, response: res };
    const disconnect = (): void => {
      const phase = cancellation.hasBody ? "during response transfer" : "before response handoff";
      void cancellation.cancel(new Error(`dashboard client disconnected ${phase}`)).catch((error: unknown) => {
        ownership.mount?.failures.push(error);
        if (!res.destroyed) res.destroy(asError(error));
      });
    };
    req.once("aborted", disconnect);
    res.once("close", disconnect);
    res.once("error", disconnect);
    let response: Response | undefined;
    const transfer = (async (): Promise<void> => {
      const request = toWebRequest(req, hostname, boundPort, requestAbort.signal);
      const mount = selected;
      if (closing) throw new DashboardShutdownError();
      if (mount?.state === "open" && mount.accepts(request)) ownership.mount = mount;
      response = await (ownership.mount?.app ?? deps.app).fetch(request);
      await pipeResponse(response, res, cancellation);
    })().catch((error: unknown) => {
      if (error instanceof DashboardShutdownError && error === cancellation.reason) return;
      const normalized = asError(error);
      ownership.mount?.failures.push(normalized);
      if (!res.destroyed) res.destroy(normalized);
      if (deps.onTransferError === undefined) {
        retainObserverFailure(new AggregateError(
          [normalized],
          "dashboard transfer failure had no local observer",
          { cause: normalized },
        ));
        throw normalized;
      }
      try {
        deps.onTransferError(normalized);
      } catch (observerFailure: unknown) {
        const aggregate = primaryFirstAggregate(
          normalized,
          observerFailure,
          "dashboard transfer and local failure observation both failed",
        );
        retainObserverFailure(aggregate);
        throw aggregate;
      }
      throw normalized;
    });
    const task: Promise<void> = transfer.finally(() => {
      req.removeListener("aborted", disconnect);
      res.removeListener("close", disconnect);
      res.removeListener("error", disconnect);
      active.delete(task);
    });
    active.set(task, ownership);
    void task.then(() => {
      if (response === undefined) return;
      const commitment = commitments.get(response);
      if (commitment === undefined) return;
      commitments.delete(response);
      if (req.complete && req.readableEnded && res.writableFinished && cancellation.reason === undefined) commitment.resolve();
      else commitment.reject(new DashboardResponseClosedError("dashboard request and response commitment unproved"));
    }, (error: unknown) => {
      if (response !== undefined) { commitments.get(response)?.reject(error); commitments.delete(response); }
    });
    void task.catch((error: unknown) => {
      if (!res.destroyed) res.destroy(asError(error));
    });
  });

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

  return Object.freeze({
    port: boundPort,
    committedResponse(response: Response): Promise<void> {
      if (closing || commitments.has(response)) throw new Error("dashboard response commitment unavailable");
      return new Promise<void>((resolve, reject) => { commitments.set(response, { resolve, reject }); });
    },
    mount: (app: DashboardApp, accepts: (request: Request) => boolean): DashboardHttpMount => {
      if (closing || selected !== undefined) throw new Error("dashboard HTTP mount unavailable");
      const mount: Mount = { app, accepts, state: "open", failures: [] };
      selected = mount;
      return Object.freeze({ close(): Promise<void> {
        if (mount.closing !== undefined) return mount.closing;
        mount.state = "closing";
        const captured = [...active.entries()].filter(([, transfer]) => transfer.mount === mount);
        const shutdown = new DashboardShutdownError();
        const cancellations = captured.map(([, transfer]) => {
          const cancelled = transfer.cancellation.cancel(shutdown);
          transfer.response.destroy();
          return cancelled;
        });
        mount.closing = (async () => {
          const settled = await Promise.allSettled([...captured.map(([task]) => task), ...cancellations]);
          const failures = [...mount.failures];
          for (const result of settled) if (result.status === "rejected" && !failures.includes(result.reason)) failures.push(result.reason);
          if (failures.length > 0) {
            mount.state = "failed";
            throw new AggregateError(failures, "dashboard HTTP mount closure is unproved");
          }
          mount.state = "closed";
          if (selected !== mount) throw new Error("dashboard HTTP mount ownership changed");
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
      const shutdown = new DashboardShutdownError();
      const cancellations = [...active.values()].map(({ cancellation }) => cancellation.cancel(shutdown));
      server.closeAllConnections();
      const settled = await Promise.allSettled([closeServer, ...active.keys(), ...cancellations]);
      const failures: unknown[] = [...(selected?.failures ?? [])];
      for (const result of settled) {
        if (result.status === "rejected") failures.push(result.reason);
      }
      const unrepresentedObserverFailures = retainedObserverFailures.filter(
        (failure) => !failures.includes(failure),
      );
      if (unrepresentedObserverFailures.length > 0) {
        const first = unrepresentedObserverFailures[0];
        failures.push(unrepresentedObserverFailures.length === 1
          ? first
          : new AggregateError(
            unrepresentedObserverFailures,
            `dashboard local transfer observation failed ${String(unrepresentedObserverFailures.length)} times`,
            { cause: first },
          ));
      }
      retainedObserverFailures.length = 0;
      if (failures.length === 1) throw failures[0];
      if (failures.length > 1) throw new AggregateError(failures, "dashboard shutdown observed transfer cleanup failures");
    },
  });
}
