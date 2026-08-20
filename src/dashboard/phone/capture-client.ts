/**
 * The phone's own typed client (2i-F, D175).
 *
 * It is deliberately NOT `src/dashboard/client/**`. The operator client knows
 * the bootstrap, the day projection, the run detail, the command envelope and
 * the SSE stream — none of which the phone may reach, and all of which would
 * ride into the phone bundle the moment one import crossed. Ref operator-trust §7 permits
 * exactly one exception to the loopback rule, and the closed route union in
 * `src/domain/capture-surface.ts` is its whole surface; this module speaks that
 * union and nothing else.
 *
 * ## The token is a credential, and it lives in exactly two places
 *
 * The URL FRAGMENT the QR encoded, and the `X-Capture-Token` request header.
 * Never a path segment, never a query value, never `document.title`, never
 * storage. A fragment is not transmitted to any server, so the QR payload can
 * cross a tunnel without the credential appearing in an access log; the header
 * is what actually authenticates. `photoBytes` is why this matters in practice:
 * an `<img src>` cannot carry a header, so the bytes are fetched here and
 * handed to the page as an object URL rather than by pointing the DOM at a
 * URL that would have to carry the token to work.
 *
 * ## Every failure is the server's own sentence
 *
 * A non-2xx carries the `WireError` contract, and its `message` is surfaced
 * verbatim. Nothing here re-words a refusal, maps several statuses onto one
 * outcome, or falls back to a cached or default session — a phone that showed
 * a stale session after a failed read would have the operator photographing
 * pages into a bundle that no longer exists. When something goes wrong this
 * throws, and the one caller renders what it threw.
 */
import { z } from "zod";
import {
  CAPTURE_TOKEN_FRAGMENT_KEY,
  CAPTURE_TOKEN_HEADER,
  CaptureSessionWireSchema,
  type CaptureSessionWire,
} from "../../domain/capture-surface.js";
import { WireErrorSchema } from "../../domain/dashboard/primitives.js";

/* ── the refusal ─────────────────────────────────────────────────────────── */

/**
 * Everything this client can fail with, carrying the server's own words.
 *
 * `code` is absent only when the failure happened before a `WireError` could be
 * read — a dead network, an unparseable body. That distinction is kept rather
 * than flattened because "the server refused this" and "the server was never
 * reached" are different things to tell someone standing at a filing cabinet.
 */
export class CapturePhoneError extends Error {
  readonly code: string | undefined;
  readonly status: number | undefined;

  constructor(message: string, options?: { code?: string; status?: number }) {
    super(message);
    this.name = "CapturePhoneError";
    this.code = options?.code;
    this.status = options?.status;
  }
}

/* ── the token ───────────────────────────────────────────────────────────── */

/**
 * The token the QR put in this page's fragment, or `""` when there is none.
 *
 * An absent fragment is NOT answered locally. The empty string is sent, the
 * server refuses it with the one fail-closed sentence every unresolvable token
 * produces, and that sentence is what the operator reads — so "no link",
 * "expired link", "someone else's link" and "unknown link" are one outcome with
 * one wording, held in one place, on the server. A client-side branch here
 * would be a second vocabulary that could drift into an existence oracle.
 */
export function readCaptureTokenFromFragment(hash: string): string {
  const fragment = hash.startsWith("#") ? hash.slice(1) : hash;
  const found = new URLSearchParams(fragment).get(CAPTURE_TOKEN_FRAGMENT_KEY);
  return found ?? "";
}

/* ── the client ──────────────────────────────────────────────────────────── */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** The bytes of one photograph, as this session's own page rendered them. */
export interface CapturePhotoBytesResult {
  readonly mediaType: string;
  readonly blob: Blob;
}

export interface CapturePhoneClient {
  readSession(): Promise<CaptureSessionWire>;
  uploadPhoto(input: Readonly<{
    expectedVersion: number;
    mediaType: string;
    bytes: BlobPart;
  }>): Promise<CaptureSessionWire>;
  photoBytes(photoId: string): Promise<CapturePhotoBytesResult>;
  deletePhoto(photoId: string, expectedVersion: number): Promise<CaptureSessionWire>;
  reorder(orderedPhotoIds: readonly string[], expectedVersion: number): Promise<CaptureSessionWire>;
  finalize(expectedVersion: number): Promise<CaptureSessionWire>;
  retryFinalize(expectedVersion: number): Promise<CaptureSessionWire>;
  discard(expectedVersion: number): Promise<CaptureSessionWire>;
}

/**
 * `newId` is injected rather than reached for so a test can pin the exact
 * `commandId` and `photoId` a request carried. The default is the platform's
 * own UUID source; there is no fallback to a counter or a timestamp, because a
 * repeated `commandId` is what makes two photographs one journaled act.
 */
export function createCapturePhoneClient(input: Readonly<{
  baseUrl: string;
  token: string;
  fetchImpl?: FetchLike;
  newId?: () => string;
}>): CapturePhoneClient {
  const baseUrl = input.baseUrl.replace(/\/$/, "");
  const fetchImpl: FetchLike = input.fetchImpl ?? ((url, init) => fetch(url, init));
  const newId = input.newId ?? ((): string => crypto.randomUUID());

  const send = async (
    path: string,
    init: RequestInit,
  ): Promise<Response> => {
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        ...init,
        headers: { ...init.headers, [CAPTURE_TOKEN_HEADER]: input.token },
      });
    } catch (error) {
      // Re-thrown, never converted into an empty session: a phone that showed
      // "no photographs yet" because the network blinked would invite the
      // operator to photograph six pages a second time.
      throw new CapturePhoneError(
        `the dashboard could not be reached: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!response.ok) throw await refusalOf(response);
    return response;
  };

  /**
   * A non-2xx body is the `WireError` contract; its `message` is the answer.
   *
   * The body is read as TEXT and parsed here rather than through
   * `response.json()`, so a body that is not JSON produces an error naming
   * that fact instead of being swallowed into an `undefined` the schema would
   * then reject for a different reason. Every branch returns a
   * `CapturePhoneError` carrying a real sentence — none of them returns a
   * default and lets the caller continue.
   */
  const refusalOf = async (response: Response): Promise<CapturePhoneError> => {
    const text = await response.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch (error) {
      return new CapturePhoneError(
        `the dashboard answered ${String(response.status)} with a body that is not JSON: `
        + `${error instanceof Error ? error.message : String(error)}`,
        { status: response.status },
      );
    }
    const parsed = WireErrorSchema.safeParse(body);
    if (!parsed.success) {
      return new CapturePhoneError(
        `the dashboard answered ${String(response.status)} with a body this page could not read`,
        { status: response.status },
      );
    }
    return new CapturePhoneError(parsed.data.message, {
      code: parsed.data.code,
      status: response.status,
    });
  };

  /** Every verb answers the same wire, and every one of them is parsed. */
  const sessionOf = async (response: Response): Promise<CaptureSessionWire> =>
    CaptureSessionWireSchema.parse(await response.json());

  const command = async (
    path: string,
    expectedVersion: number,
    extra?: Readonly<Record<string, unknown>>,
  ): Promise<CaptureSessionWire> =>
    sessionOf(await send(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ commandId: newId(), expectedVersion, ...extra }),
    }));

  return Object.freeze({
    async readSession(): Promise<CaptureSessionWire> {
      return sessionOf(await send("/api/v1/capture/phone/session", { method: "GET" }));
    },

    async uploadPhoto(upload: Readonly<{
      expectedVersion: number;
      mediaType: string;
      bytes: BlobPart;
    }>): Promise<CaptureSessionWire> {
      // The command facts ride the QUERY here and the body carries the bytes —
      // the route's own shape (a photograph is not JSON). The token still rides
      // the header; nothing identifying the session is in this URL.
      const query = new URLSearchParams({
        commandId: newId(),
        expectedVersion: String(upload.expectedVersion),
        photoId: newId(),
      });
      return sessionOf(await send(`/api/v1/capture/phone/photos?${query.toString()}`, {
        method: "POST",
        headers: { "content-type": upload.mediaType },
        body: upload.bytes,
      }));
    },

    async photoBytes(photoId: string): Promise<CapturePhotoBytesResult> {
      const response = await send(
        `/api/v1/capture/phone/photos/${encodeURIComponent(photoId)}/bytes`,
        { method: "GET" },
      );
      const mediaType = response.headers.get("content-type");
      if (mediaType === null) {
        throw new CapturePhoneError(
          `the dashboard served photograph ${photoId} without naming its media type`,
        );
      }
      return { mediaType, blob: await response.blob() };
    },

    async deletePhoto(photoId: string, expectedVersion: number): Promise<CaptureSessionWire> {
      const query = new URLSearchParams({
        commandId: newId(),
        expectedVersion: String(expectedVersion),
      });
      return sessionOf(await send(
        `/api/v1/capture/phone/photos/${encodeURIComponent(photoId)}?${query.toString()}`,
        { method: "DELETE" },
      ));
    },

    reorder(orderedPhotoIds: readonly string[], expectedVersion: number): Promise<CaptureSessionWire> {
      return command("/api/v1/capture/phone/order", expectedVersion, {
        orderedPhotoIds: [...orderedPhotoIds],
      });
    },

    finalize(expectedVersion: number): Promise<CaptureSessionWire> {
      return command("/api/v1/capture/phone/finalize", expectedVersion);
    },

    retryFinalize(expectedVersion: number): Promise<CaptureSessionWire> {
      return command("/api/v1/capture/phone/retry-finalize", expectedVersion);
    },

    discard(expectedVersion: number): Promise<CaptureSessionWire> {
      return command("/api/v1/capture/phone/discard", expectedVersion);
    },
  });
}

/* ── ordering ────────────────────────────────────────────────────────────── */

/**
 * The photo id order produced by moving one page up or down by one place.
 *
 * It is a pure function, exported and tested in its own right, because the
 * order IS the document: page 3 becoming page 2 is the operator restating what
 * the paper says, and an off-by-one here silently reorders a form. A move off
 * either end returns the list unchanged rather than wrapping — the control is
 * disabled there, and wrapping would be a plausible-but-wrong answer to a press
 * that should do nothing.
 */
export function movedPhotoOrder(
  orderedPhotoIds: readonly string[],
  photoId: string,
  direction: "up" | "down",
): readonly string[] {
  const index = orderedPhotoIds.indexOf(photoId);
  if (index < 0) {
    throw new Error(`cannot move photograph ${photoId}: it is not in this session's order`);
  }
  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= orderedPhotoIds.length) return orderedPhotoIds;
  const next = [...orderedPhotoIds];
  next[index] = orderedPhotoIds[target];
  next[target] = orderedPhotoIds[index];
  return next;
}

/** The wire's photographs in their durable ordinal order, as ids. */
export function photoOrderOf(session: CaptureSessionWire): readonly string[] {
  return [...session.photos]
    .sort((left, right) => left.ordinal - right.ordinal)
    .map((photo) => z.string().parse(String(photo.photoId)));
}
