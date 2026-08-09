/**
 * 2i-F — the phone's own typed client (D175).
 *
 * Three things are worth pinning here and everything else follows from them:
 * the TOKEN never leaves the header, a REFUSAL is the server's own sentence
 * rather than this client's paraphrase, and the ORDER a move produces is exact.
 * The last one is not a formatting detail — the photograph order IS the
 * document, so an off-by-one silently reorders a form that a person will later
 * read as authoritative.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  CAPTURE_TOKEN_HEADER,
  CAPTURE_UNKNOWN_SESSION_MESSAGE,
  capturePhoneUrl,
} from "../../../src/domain/capture-surface.js";
import {
  CapturePhoneError,
  createCapturePhoneClient,
  movedPhotoOrder,
  photoOrderOf,
  readCaptureTokenFromFragment,
} from "../../../src/dashboard/phone/capture-client.js";
import {
  FIXTURE_CAPTURE_PHOTO_IDS,
  FIXTURE_CAPTURE_SESSIONS,
  FIXTURE_CAPTURE_TOKEN,
} from "../../parity/helpers/fixture-capture.js";

interface Call {
  readonly url: string;
  readonly method: string;
  readonly token: string | null;
  readonly contentType: string | undefined;
  readonly body: string | undefined;
}

function clientOver(
  respond: (call: Call) => { status: number; body: unknown },
  options?: { token?: string },
): { client: ReturnType<typeof createCapturePhoneClient>; calls: Call[] } {
  const calls: Call[] = [];
  let issued = 0;
  const client = createCapturePhoneClient({
    baseUrl: "http://phone.test",
    token: options?.token ?? FIXTURE_CAPTURE_TOKEN,
    // Pinned so a request's exact `commandId` / `photoId` are assertable; the
    // production default is `crypto.randomUUID`.
    newId: () => {
      issued += 1;
      return `00000000-0000-4000-8000-${String(issued).padStart(12, "0")}`;
    },
    fetchImpl: (url, init) => {
      const headers = new Headers(init?.headers);
      const call: Call = {
        url,
        method: init?.method ?? "GET",
        token: headers.get(CAPTURE_TOKEN_HEADER),
        contentType: headers.get("content-type") ?? undefined,
        body: typeof init?.body === "string" ? init.body : undefined,
      };
      calls.push(call);
      const { status, body } = respond(call);
      return Promise.resolve(new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }));
    },
  });
  return { client, calls };
}

const OPEN = FIXTURE_CAPTURE_SESSIONS.photos;

describe("the capture token is a credential, and it rides the header", () => {
  it("sends the token in X-Capture-Token on every verb and in no URL", async () => {
    const { client, calls } = clientOver(() => ({ status: 200, body: OPEN }));
    await client.readSession();
    await client.reorder([...FIXTURE_CAPTURE_PHOTO_IDS].reverse(), OPEN.version);
    await client.finalize(OPEN.version);
    await client.retryFinalize(OPEN.version);
    await client.discard(OPEN.version);
    await client.deletePhoto(FIXTURE_CAPTURE_PHOTO_IDS[0], OPEN.version);
    await client.uploadPhoto({ expectedVersion: OPEN.version, mediaType: "image/jpeg", bytes: "x" });

    assert.equal(calls.length, 7);
    for (const call of calls) {
      assert.equal(call.token, FIXTURE_CAPTURE_TOKEN, `${call.method} ${call.url} lost the header`);
      // The load-bearing negative: not a path segment, not a query value.
      assert.ok(
        !call.url.includes(FIXTURE_CAPTURE_TOKEN),
        `${call.method} ${call.url} put the token in the URL`,
      );
    }
  });

  it("reads the token off the fragment and answers nothing when there is none", () => {
    assert.equal(
      readCaptureTokenFromFragment(`#t=${FIXTURE_CAPTURE_TOKEN}`),
      FIXTURE_CAPTURE_TOKEN,
    );
    // The QR's own payload round-trips through the reader.
    const url = new URL(capturePhoneUrl("https://capture.example", FIXTURE_CAPTURE_TOKEN));
    assert.equal(readCaptureTokenFromFragment(url.hash), FIXTURE_CAPTURE_TOKEN);
    // Absent is "" — deliberately NOT a local refusal. It goes to the server,
    // which owns the one fail-closed sentence.
    assert.equal(readCaptureTokenFromFragment(""), "");
    assert.equal(readCaptureTokenFromFragment("#somethingelse=1"), "");
  });

  it("sends the empty token rather than short-circuiting, so the server refuses it", async () => {
    const { client, calls } = clientOver(
      () => ({
        status: 404,
        body: {
          state: "error",
          code: "CAPTURE_UNKNOWN_SESSION",
          message: CAPTURE_UNKNOWN_SESSION_MESSAGE,
          retryable: false,
        },
      }),
      { token: "" },
    );
    await assert.rejects(client.readSession(), (error: unknown) => {
      assert.ok(error instanceof CapturePhoneError);
      assert.equal(error.message, CAPTURE_UNKNOWN_SESSION_MESSAGE);
      assert.equal(error.code, "CAPTURE_UNKNOWN_SESSION");
      return true;
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].token, "");
  });
});

describe("a refusal is the server's own sentence", () => {
  it("surfaces the message verbatim with its code and status", async () => {
    const { client } = clientOver(() => ({
      status: 422,
      body: {
        state: "error",
        code: "CAPTURE_UNSUPPORTED_MEDIA_TYPE",
        message: "a capture photograph must be image/jpeg or image/png; this one declared image/heic",
        retryable: false,
      },
    }));
    await assert.rejects(
      client.uploadPhoto({ expectedVersion: 3, mediaType: "image/heic", bytes: "x" }),
      (error: unknown) => {
        assert.ok(error instanceof CapturePhoneError);
        assert.equal(
          error.message,
          "a capture photograph must be image/jpeg or image/png; this one declared image/heic",
        );
        assert.equal(error.code, "CAPTURE_UNSUPPORTED_MEDIA_TYPE");
        assert.equal(error.status, 422);
        return true;
      },
    );
  });

  /**
   * The load-bearing negative. A client that fell back to an empty session on a
   * failed read would tell someone standing at a filing cabinet that none of
   * their pages arrived, and they would photograph all six again.
   */
  it("never substitutes a session when the read fails", async () => {
    const dead = createCapturePhoneClient({
      baseUrl: "http://phone.test",
      token: FIXTURE_CAPTURE_TOKEN,
      fetchImpl: () => Promise.reject(new Error("network down")),
    });
    await assert.rejects(dead.readSession(), (error: unknown) => {
      assert.ok(error instanceof CapturePhoneError);
      assert.match(error.message, /network down/);
      assert.equal(error.code, undefined);
      return true;
    });
  });

  it("refuses a 200 whose body is not the session contract", async () => {
    const { client } = clientOver(() => ({ status: 200, body: { wireVersion: 1 } }));
    await assert.rejects(client.readSession());
  });
});

describe("the photograph upload carries its facts where the route reads them", () => {
  it("puts commandId, expectedVersion and a minted photoId in the query and the bytes in the body", async () => {
    const { client, calls } = clientOver(() => ({ status: 200, body: OPEN }));
    await client.uploadPhoto({ expectedVersion: 4, mediaType: "image/png", bytes: "bytes" });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, "POST");
    assert.equal(
      calls[0].url,
      "http://phone.test/api/v1/capture/phone/photos"
      + "?commandId=00000000-0000-4000-8000-000000000001"
      + "&expectedVersion=4"
      + "&photoId=00000000-0000-4000-8000-000000000002",
    );
    // Not application/json — the route reads the media type off this header.
    assert.equal(calls[0].contentType, "image/png");
  });

  it("sends the command facts as JSON for the verbs whose route takes a body", async () => {
    const { client, calls } = clientOver(() => ({ status: 200, body: OPEN }));
    await client.finalize(7);
    assert.equal(calls[0].url, "http://phone.test/api/v1/capture/phone/finalize");
    assert.deepEqual(JSON.parse(calls[0].body ?? "null"), {
      commandId: "00000000-0000-4000-8000-000000000001",
      expectedVersion: 7,
    });
  });
});

describe("moving a page produces the exact order", () => {
  const [first, second, third] = FIXTURE_CAPTURE_PHOTO_IDS;

  it("swaps with the neighbour in the named direction", () => {
    assert.deepEqual(
      movedPhotoOrder(FIXTURE_CAPTURE_PHOTO_IDS, second, "up"),
      [second, first, third],
    );
    assert.deepEqual(
      movedPhotoOrder(FIXTURE_CAPTURE_PHOTO_IDS, second, "down"),
      [first, third, second],
    );
    assert.deepEqual(
      movedPhotoOrder(FIXTURE_CAPTURE_PHOTO_IDS, third, "up"),
      [first, third, second],
    );
  });

  /** A press at the end does NOTHING — it never wraps to the other end. */
  it("returns the list unchanged at either end rather than wrapping", () => {
    assert.deepEqual(movedPhotoOrder(FIXTURE_CAPTURE_PHOTO_IDS, first, "up"), FIXTURE_CAPTURE_PHOTO_IDS);
    assert.deepEqual(movedPhotoOrder(FIXTURE_CAPTURE_PHOTO_IDS, third, "down"), FIXTURE_CAPTURE_PHOTO_IDS);
  });

  it("throws on an id the order does not hold rather than guessing a position", () => {
    assert.throws(
      () => movedPhotoOrder(FIXTURE_CAPTURE_PHOTO_IDS, "not-a-photo", "up"),
      /not in this session's order/,
    );
  });

  it("reads the order from the wire's own ordinals, not from array position", () => {
    // The wire is deliberately handed back out of order here; `ordinal` wins.
    const shuffled = { ...OPEN, photos: [...OPEN.photos].reverse() };
    assert.deepEqual(photoOrderOf(shuffled), FIXTURE_CAPTURE_PHOTO_IDS);
  });

  it("sends the moved order to the reorder route", async () => {
    const { client, calls } = clientOver(() => ({ status: 200, body: OPEN }));
    await client.reorder(movedPhotoOrder(FIXTURE_CAPTURE_PHOTO_IDS, third, "up"), OPEN.version);
    assert.deepEqual(JSON.parse(calls[0].body ?? "null"), {
      commandId: "00000000-0000-4000-8000-000000000001",
      expectedVersion: OPEN.version,
      orderedPhotoIds: [first, third, second],
    });
  });
});
