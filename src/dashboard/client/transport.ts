/** The ONE transport implementation (ref frontend-backend-integration ): nothing outside `src/dashboard/client/**` may call `fetch` or open an event stream.
 * The */
import { CHATGPT_COMPLETION_READ_DEADLINE_MS, SETTINGS_READ_DEADLINE_MS, STORAGE_DOCTOR_DEADLINE_MS, readWithDeadline } from "./read-deadline.js";
import type { ErrorCatalogCode } from "../../models/failures/error-catalog.js";
import { httpError, networkError } from "./errors.js";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface SseMessage {
  readonly id?: string;
  readonly data: string;
}

export interface StreamHandle {
  /** Resolves when the stream ends server-side; rejects on transport failure. */
  readonly done: Promise<void>;
  close(): void;
}

/** A response whose STATUS is part of the contract, kept beside its body. */
export interface JsonResponse {
  readonly status: number;
  readonly ok: boolean;
  readonly body: unknown;
}

export interface BinaryResponse {
  readonly headers: Headers;
  readonly bytes: ArrayBuffer;
}

export interface DashboardTransport {
  requestJson(path: string, init?: RequestInit): Promise<unknown>;
  /** The same request, with the status line preserved.
 * Two routes make the status load-bearing rather than incidental: the command */
  requestJsonResponse(path: string, init?: RequestInit): Promise<JsonResponse>;
  /** A strict binary response; non-2xx bodies still use the wire-error contract. */
  requestBinary(path: string, init?: RequestInit): Promise<BinaryResponse>;
  /** The absolute URL this transport would request `path` at.
 * It exists for the ONE thing a typed client cannot do for a surface: hand */
  resolveUrl(path: string): string;
  openStream(
    path: string,
    options: Readonly<{
      lastEventId?: string;
      lastProjectionGeneration?: number;
      onMessage: (message: SseMessage) => void;
    }>,
  ): StreamHandle;
}

export function createDashboardTransport(input: Readonly<{
  baseUrl: string;
  fetchImpl?: FetchLike;
}>): DashboardTransport {
  const baseUrl = input.baseUrl.replace(/\/$/, "");
  const baseOrigin = new URL(baseUrl).origin;
  const fetchImpl: FetchLike = input.fetchImpl ?? ((url, init) => fetch(url, init));

  /** Every non-GET request carries the transport's own Origin. A browser sets
 * (and refuses to let a page override) this header itself, so in the real */
  const isMutation = (init?: RequestInit): boolean =>
    init?.method !== undefined && init.method.toUpperCase() !== "GET" && init.method.toUpperCase() !== "HEAD";

  const isTypedCommandResultStatus = (path: string, status: number): boolean =>
    (path === "/api/v1/commands" && (status === 409 || status === 422))
    || (path === "/api/v1/commands/bulk" && status === 422);

  const sendUnbounded = async (path: string, init?: RequestInit): Promise<JsonResponse> => {
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        ...init,
        headers: {
          accept: "application/json",
          ...(init?.body === undefined ? {} : { "content-type": "application/json" }),
          ...(isMutation(init) ? { origin: baseOrigin } : {}),
          ...init?.headers,
        },
      });
    } catch (error) {
      throw networkError(`${init?.method ?? "GET"} ${path}`, error);
    }
    const body: unknown = await response.json().catch((error: unknown) => {
      throw httpError(response.status, { unparseable: String(error) });
    });
    return Object.freeze({ status: response.status, ok: response.ok, body });
  };

  const send = (path: string, init?: RequestInit): Promise<JsonResponse> => {
    const method = init?.method?.toUpperCase() ?? "GET";
    const route = path.split("?")[0];
    const code: ErrorCatalogCode | undefined = method !== "GET" ? undefined
      : route === "/api/v1/storage/doctor" || route === "/api/v1/storage/doctor/latest" ? "STORAGE_DOCTOR_FAILED"
      : route === "/api/v1/settings/chatgpt-account" || /^\/api\/v1\/settings\/chatgpt-account\/sign-in\/[^/]+$/u.test(route ?? "") ? "CHATGPT_AUTH_UNAVAILABLE"
      : route === "/api/v1/preflight" ? "PREFLIGHT_READ_UNAVAILABLE"
      : route === "/api/v1/settings/editable" || route === "/api/v1/settings/storage-relocation" || route === "/api/v1/settings/facts" ? "SETTINGS_INITIAL_READ_UNAVAILABLE"
      : route?.startsWith("/api/v1/workbooks") || route === "/api/v1/explorer" || route?.startsWith("/api/v1/reports/activity") ? "DASHBOARD_READ_FAILED" : undefined;
    if (code === undefined) return sendUnbounded(path, init);
    return readWithDeadline(signal => sendUnbounded(path, { ...init, signal }), code,
      route?.startsWith("/api/v1/settings/chatgpt-account/sign-in/") ? CHATGPT_COMPLETION_READ_DEADLINE_MS : route === "/api/v1/storage/doctor" ? STORAGE_DOCTOR_DEADLINE_MS : SETTINGS_READ_DEADLINE_MS, init?.signal ?? undefined).catch((error: unknown) => {
        if (init?.signal?.aborted) throw networkError(`${method} ${path}`, init.signal.reason);
        throw error;
      });
  };

  return Object.freeze({
    async requestJson(path: string, init?: RequestInit): Promise<unknown> {
      const response = await send(path, init);
      // Typed command refusals use 409/422; other non-success responses follow the wire-error contract.
      if (!response.ok && !isTypedCommandResultStatus(path, response.status)) {
        throw httpError(response.status, response.body);
      }
      return response.body;
    },

    requestJsonResponse: send,

    async requestBinary(path: string, init?: RequestInit): Promise<BinaryResponse> {
      let response: Response;
      try {
        response = await fetchImpl(`${baseUrl}${path}`, {
          ...init,
          headers: {
            accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            ...(init?.body === undefined ? {} : { "content-type": "application/json" }),
            ...(isMutation(init) ? { origin: baseOrigin } : {}),
            ...init?.headers,
          },
        });
      } catch (error) {
        throw networkError(`${init?.method ?? "GET"} ${path}`, error);
      }
      if (!response.ok) {
        const body: unknown = await response.json().catch((error: unknown) => {
          throw httpError(response.status, { unparseable: String(error) });
        });
        throw httpError(response.status, body);
      }
      return Object.freeze({ headers: response.headers, bytes: await response.arrayBuffer() });
    },

    resolveUrl: (path: string): string => `${baseUrl}${path}`,

    openStream(
      path: string,
      options: Readonly<{
        lastEventId?: string;
        lastProjectionGeneration?: number;
        onMessage: (message: SseMessage) => void;
      }>,
    ): StreamHandle {
      const controller = new AbortController();
      const done = (async (): Promise<void> => {
        let response: Response;
        try {
          response = await fetchImpl(`${baseUrl}${path}`, {
            headers: {
              accept: "text/event-stream",
              ...(options.lastEventId === undefined ? {} : { "last-event-id": options.lastEventId }),
              ...(options.lastProjectionGeneration === undefined
                ? {}
                : { "dashboard-projection-generation": String(options.lastProjectionGeneration) }),
            },
            signal: controller.signal,
          });
        } catch (error) {
          if (controller.signal.aborted) return;
          throw networkError(`stream ${path}`, error);
        }
        if (!response.ok || response.body === null) {
          throw httpError(response.status, await response.json().catch(() => ({ unparseable: true })));
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        const dispatch = (block: string): void => {
          let id: string | undefined;
          const dataLines: string[] = [];
          for (const line of block.split("\n")) {
            if (line.startsWith("id: ")) id = line.slice(4);
            else if (line.startsWith("data: ")) dataLines.push(line.slice(6));
          }
          if (dataLines.length > 0) {
            options.onMessage({ ...(id === undefined ? {} : { id }), data: dataLines.join("\n") });
          }
        };
        try {
          for (;;) {
            const chunk = await reader.read();
            if (chunk.done) break;
            buffer += decoder.decode(chunk.value, { stream: true });
            for (;;) {
              const boundary = buffer.indexOf("\n\n");
              if (boundary === -1) break;
              dispatch(buffer.slice(0, boundary));
              buffer = buffer.slice(boundary + 2);
            }
          }
        } catch (error) {
          if (!controller.signal.aborted) throw networkError(`stream ${path}`, error);
        }
      })();
      return Object.freeze({
        done,
        close: (): void => controller.abort(),
      });
    },
  });
}
