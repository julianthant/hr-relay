/** The ONE transport implementation (ref frontend-backend-integration ): nothing outside `src/dashboard/client/**` may call `fetch` or open an event stream.
 * The */
import type { ErrorCatalogCode } from "../../models/failures/error-catalog.js";
import { PublicProfileStateSchema } from "../../models/profiles/public-profile.js";
import { debugFailureOutcome, debugFailureOutcomes, diagnosticRequestRoute } from "../../models/events/debug-report.js";
import { DashboardClientError, WIRE_ERROR_BODY, httpError,networkError,markDashboardErrorReported } from "./errors.js";
import { BOUNDED_READ_ATTEMPTS, BOUNDED_READ_RETRY_MS, CHATGPT_ACCOUNT_READ_DEADLINE_MS, CHATGPT_COMPLETION_READ_DEADLINE_MS, SETTINGS_READ_DEADLINE_MS, readDeadlineExpired, readWithDeadline } from "./read-deadline.js";

/** The closed cause of a request that ended without a response body. */
const unansweredReason = (error: unknown): string => readDeadlineExpired(error) ? "read-deadline"
  : error instanceof DashboardClientError && error.kind === "http" ? "response-json-invalid" : "network-failed";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Refusals the caller shows as its own state, so they are not error reports: a preflight re-check turned away because one is running or too many started. */
const EXPECTED_REFUSALS: Readonly<Record<string, readonly number[]>> = Object.freeze({
  "POST /api/v1/preflight/rerun": Object.freeze([429]),
});

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
  readonly headers: Headers;
  readonly status: number;
  readonly ok: boolean;
  readonly body: unknown;
}

export interface BinaryResponse {
  readonly headers: Headers;
  readonly bytes: ArrayBuffer;
}

export interface DashboardTransport {
  /** `retry` asks a run-start read again, as the checks and workbook reads always are. */
  requestJson(path: string, init?: RequestInit, options?: Readonly<{ retry?: boolean }>): Promise<unknown>;
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
  profileHeaders?: (path: string) => Record<string, string>;
  onFailure?: (failure: NonNullable<ReturnType<typeof debugFailureOutcome>> & { route: string }) => void;
  captureProfileSessionStale?: () => () => void;
}>): DashboardTransport {
  const baseUrl = input.baseUrl.replace(/\/$/, "");
  const baseOrigin = new URL(baseUrl).origin;
  const sendRequest: FetchLike = input.fetchImpl ?? ((url, init) => fetch(url, init));
  const fetchImpl: FetchLike = (url, init) => {
    const destination = new URL(url);
    if (destination.origin !== baseOrigin || destination.username || destination.password) throw new Error("Dashboard request origin mismatch");
    return sendRequest(url, { ...init, credentials: "omit", redirect: "error", mode: "same-origin",
      headers: { ...Object.fromEntries(new Headers(init?.headers)), ...input.profileHeaders?.(destination.pathname) } });
  };
  const observeProfileSession = (path: string, status: number, body: unknown, notify: (() => void) | undefined): void => {
    if (status !== 401 || /^\/api\/v1\/profile\//u.test(path) || path === "/api/v1/debug/errors") return;
    const parsed = PublicProfileStateSchema.safeParse(body);
    if (parsed.success && parsed.data.state === "refused" && parsed.data.code === "PROFILE_SESSION_STALE") notify?.();
  };

  /** Every non-GET request carries the transport's own Origin. A browser sets
 * (and refuses to let a page override) this header itself, so in the real */
  const isMutation = (init?: RequestInit): boolean =>
    init?.method !== undefined && init.method.toUpperCase() !== "GET" && init.method.toUpperCase() !== "HEAD";

  const isTypedCommandResultStatus = (path: string, status: number): boolean =>
    (path === "/api/v1/commands" && (status === 409 || status === 422))
    || (path === "/api/v1/commands/bulk" && status === 422);

  const sendUnbounded = async (path: string, init?: RequestInit): Promise<JsonResponse> => {
    const notify = input.captureProfileSessionStale?.();
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
    // A body that is not JSON is the server's answer; a body cut off in delivery is a lost connection.
    const body: unknown = await response.json().catch((error: unknown) => {
      throw error instanceof SyntaxError ? httpError(response.status, { unparseable: String(error) }) : networkError(`${init?.method ?? "GET"} ${path}`, error);
    });
    observeProfileSession(path, response.status, body, notify);
    return Object.freeze({ headers: response.headers, status: response.status, ok: response.ok, body });
  };

  const sendWithDeadline = (path: string, init?: RequestInit, retry = false): Promise<JsonResponse> => {
    const method = init?.method?.toUpperCase() ?? "GET";
    const route = path.split("?")[0];
    const accountStatus = route === "/api/v1/settings/chatgpt-account";
    const accountCompletion = method === "GET" && /^\/api\/v1\/settings\/chatgpt-account\/sign-in\/[^/]+$/u.test(route ?? "");
    const code: ErrorCatalogCode | undefined = method !== "GET" ? undefined
      : accountStatus || accountCompletion ? "CHATGPT_AUTH_UNAVAILABLE"
      : route === "/api/v1/preflight" ? "PREFLIGHT_READ_UNAVAILABLE"
      : route === "/api/v1/settings/editable" || route === "/api/v1/settings/facts" ? "SETTINGS_INITIAL_READ_UNAVAILABLE"
      : route?.startsWith("/api/v1/workbooks") || route === "/api/v1/explorer" || route?.startsWith("/api/v1/reports/activity") ? "DASHBOARD_READ_FAILED" : undefined;
    const retried = method === "GET" && (retry || route === "/api/v1/preflight" || route?.startsWith("/api/v1/workbooks") === true);
    if (code === undefined && !retried || accountCompletion && init?.signal !== undefined) return sendUnbounded(path, init);
    const deadline = accountCompletion ? CHATGPT_COMPLETION_READ_DEADLINE_MS
      : accountStatus ? CHATGPT_ACCOUNT_READ_DEADLINE_MS : SETTINGS_READ_DEADLINE_MS;
    const attempts = retried ? BOUNDED_READ_ATTEMPTS : 1;
    const pause = () => new Promise(resolve => setTimeout(resolve, BOUNDED_READ_RETRY_MS));
    return (async () => {
      for (let attempt = 1; ; attempt += 1) {
        try {
          const response = code === undefined ? await sendUnbounded(path, init)
            : await readWithDeadline(signal => sendUnbounded(path, { ...init, signal }), code, deadline, init?.signal ?? undefined);
          if (attempt === attempts || response.status !== 503 || WIRE_ERROR_BODY.safeParse(response.body).data?.retryable !== true) return response;
        } catch (error) {
          if (init?.signal?.aborted) throw networkError(`${method} ${path}`, init.signal.reason);
          if (attempt === attempts || !(error instanceof DashboardClientError && error.kind === "network")) throw error;
        }
        await pause();
      }
    })();
  };

  const reportFailure = (path: string, body: unknown, status = 200, method = "GET", reason?: string): void => {
    if (path === "/api/v1/debug/errors") return;
    if (EXPECTED_REFUSALS[`${method.toUpperCase()} ${path.split("?")[0] ?? path}`]?.includes(status) === true) return;
    const readRoute = method.toUpperCase() === "GET" ? path.split(/[?#]/u)[0] : undefined;
    for (const failure of debugFailureOutcomes(body, status, readRoute)) input.onFailure?.({ ...failure, ...(reason === undefined ? {} : { reason }), route: diagnosticRequestRoute(path) });
  };
  const send = async (path: string, init?: RequestInit, retry = false): Promise<JsonResponse> => {
    try {
      const response = await sendWithDeadline(path, init, retry);
      reportFailure(path, response.body, response.ok ? response.status : Math.max(400, response.status), init?.method);
      return response;
    } catch (error) {
      if (!init?.signal?.aborted) { reportFailure(path, { state: "error" }, 200, init?.method, unansweredReason(error)); markDashboardErrorReported(error); }
      throw error;
    }
  };

  return Object.freeze({
    async requestJson(path: string, init?: RequestInit, options?: Readonly<{ retry?: boolean }>): Promise<unknown> {
      const response = await send(path, init, options?.retry);
      // Typed command refusals use 409/422; other non-success responses follow the wire-error contract.
      if (!response.ok && !isTypedCommandResultStatus(path, response.status)) {
        const error = httpError(response.status, response.body);
        markDashboardErrorReported(error);
        throw error;
      }
      return response.body;
    },

    requestJsonResponse: (path: string, init?: RequestInit) => send(path, init),

    async requestBinary(path: string, init?: RequestInit): Promise<BinaryResponse> {
      const notify = input.captureProfileSessionStale?.();
      try {
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
        observeProfileSession(path, response.status, body, notify);
        throw httpError(response.status, body);
      }
      return Object.freeze({ headers: response.headers, bytes: await response.arrayBuffer() });
      } catch (error) {
        const failure = error instanceof DashboardClientError ? error : networkError(`${init?.method ?? "GET"} ${path}`, error);
        if (!init?.signal?.aborted) { reportFailure(path, { state: "error", code: failure.code }); markDashboardErrorReported(failure); }
        throw failure;
      }
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
      const notify = input.captureProfileSessionStale?.();
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
          const body: unknown = await response.json().catch(() => ({ unparseable: true }));
          observeProfileSession(path, response.status, body, notify);
          throw httpError(response.status, body);
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
      })().catch((error: unknown) => {
        if (!controller.signal.aborted) { reportFailure(path, { state: "error" }); markDashboardErrorReported(error); }
        throw error;
      });
      return Object.freeze({
        done,
        close: (): void => controller.abort(),
      });
    },
  });
}
