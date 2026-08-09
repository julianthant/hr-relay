/**
 * The ONE transport implementation (doc 13 §2): nothing outside
 * `src/dashboard/client/**` may call `fetch` or open an event stream. The
 * stream side speaks SSE over `fetch` + `ReadableStream` — no `EventSource`
 * dependency, so the same code runs in the browser and in Node tests — and
 * resumes with `Last-Event-ID` exactly like an EventSource would.
 */
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

export interface DashboardTransport {
  requestJson(path: string, init?: RequestInit): Promise<unknown>;
  /**
   * The same request, with the status line preserved.
   *
   * Two routes make the status load-bearing rather than incidental: the command
   * route rides `409`/`422` with a typed body, and the intake upload answers
   * `201` for a session it CREATED against `200` for one it JOINED — the same
   * wire shape, two different things to tell the operator. `requestJson` throws
   * that distinction away by design, so a caller who needs it asks for it here
   * instead of re-deriving it from the payload.
   */
  requestJsonResponse(path: string, init?: RequestInit): Promise<JsonResponse>;
  openStream(
    path: string,
    options: Readonly<{ lastEventId?: string; onMessage: (message: SseMessage) => void }>,
  ): StreamHandle;
}

export function createDashboardTransport(input: Readonly<{
  baseUrl: string;
  fetchImpl?: FetchLike;
}>): DashboardTransport {
  const baseUrl = input.baseUrl.replace(/\/$/, "");
  const fetchImpl: FetchLike = input.fetchImpl ?? ((url, init) => fetch(url, init));

  const send = async (path: string, init?: RequestInit): Promise<JsonResponse> => {
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        ...init,
        headers: { accept: "application/json", ...(init?.body === undefined ? {} : { "content-type": "application/json" }), ...init?.headers },
      });
    } catch (error) {
      throw networkError(`${init?.method ?? "GET"} ${path}`, error);
    }
    const body: unknown = await response.json().catch((error: unknown) => {
      throw httpError(response.status, { unparseable: String(error) });
    });
    return Object.freeze({ status: response.status, ok: response.ok, body });
  };

  return Object.freeze({
    async requestJson(path: string, init?: RequestInit): Promise<unknown> {
      const response = await send(path, init);
      // Command results legitimately ride 409/422 with a typed body; every
      // other non-2xx is the wire-error contract.
      if (!response.ok && path !== "/api/v1/commands") throw httpError(response.status, response.body);
      return response.body;
    },

    requestJsonResponse: send,

    openStream(
      path: string,
      options: Readonly<{ lastEventId?: string; onMessage: (message: SseMessage) => void }>,
    ): StreamHandle {
      const controller = new AbortController();
      const done = (async (): Promise<void> => {
        let response: Response;
        try {
          response = await fetchImpl(`${baseUrl}${path}`, {
            headers: {
              accept: "text/event-stream",
              ...(options.lastEventId === undefined ? {} : { "last-event-id": options.lastEventId }),
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
