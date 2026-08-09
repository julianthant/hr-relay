/**
 * 2i-F — the operator's Start Capture control (D175).
 *
 * The control itself is three states over one request, so what is worth pinning
 * is the request's contract and what each answer MEANS:
 *
 *   201  the session started, and this response is the ONE moment the raw token
 *        exists outside the phone
 *   409  a NAMED ingress refusal with a remediation the operator can act on —
 *        an outcome, not a fault
 *   else a fault, which must never render as "capture is misconfigured"
 *
 * The rendered half (the QR being on screen, the refusal's two sentences beside
 * the button) is asserted by the parity lane against the real bundle in a real
 * browser — `tests/parity/capture-phone-reference.spec.ts` — because this repo
 * has no DOM test environment and the .tsx surfaces are excluded from coverage
 * for exactly that reason.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  capturePhoneUrl,
  CaptureTokenSchema,
  CAPTURE_PHONE_ASSET_ENTRY,
  CAPTURE_TOKEN_FRAGMENT_KEY,
} from "../../../src/domain/capture-surface.js";
import { encodeQrCode, qrCodeSvgPath, qrCodeSvgViewBox } from "../../../src/domain/qr-code.js";
import { createDashboardClient, DashboardClientError } from "../../../src/dashboard/client/index.js";
import { FIXTURE_CAPTURE_START, FIXTURE_CAPTURE_TOKENS } from "../../parity/helpers/fixture-capture.js";

interface Call {
  readonly url: string;
  readonly method: string;
  readonly body: string | undefined;
}

function clientOver(respond: () => { status: number; body: unknown }): {
  client: ReturnType<typeof createDashboardClient>;
  calls: Call[];
} {
  const calls: Call[] = [];
  const client = createDashboardClient({
    baseUrl: "http://bff.test",
    fetchImpl: (url, init) => {
      calls.push({
        url,
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? init.body : undefined,
      });
      const { status, body } = respond();
      return Promise.resolve(new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }));
    },
  });
  return { client, calls };
}

const REFUSAL = {
  state: "refused",
  code: "ingress-not-built",
  message: "capture.ingress is \"on-demand-ngrok\" and the credential is present, but the on-demand "
    + "tunnel launcher is not built in this repository yet",
  remediation: "set capture.ingress to \"forwarded\" with an explicit HTTPS forwardedUrl",
};

describe("starting a capture is one request with three meanings", () => {
  it("posts the workflow to the loopback route and carries no token of its own", async () => {
    const { client, calls } = clientOver(() => ({ status: 201, body: FIXTURE_CAPTURE_START }));
    await client.startCaptureSession({ workflowId: "person-lookup" });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, "POST");
    assert.equal(calls[0].url, "http://bff.test/api/v1/capture/sessions");
    assert.deepEqual(JSON.parse(calls[0].body ?? "null"), { workflow: "person-lookup" });
  });

  it("reads 201 as started, carrying the one raw token and the phone url", async () => {
    const { client } = clientOver(() => ({ status: 201, body: FIXTURE_CAPTURE_START }));
    const result = await client.startCaptureSession({ workflowId: "person-lookup" });
    assert.equal(result.state, "started");
    if (result.state !== "started") return;
    // A real credential, not a placeholder the schema happens to admit.
    assert.equal(CaptureTokenSchema.safeParse(result.token).success, true);
    assert.equal(result.token, FIXTURE_CAPTURE_TOKENS.empty);
  });

  it("reads 409 as a named refusal with its remediation, not as a failure", async () => {
    const { client } = clientOver(() => ({ status: 409, body: REFUSAL }));
    const result = await client.startCaptureSession({ workflowId: "person-lookup" });
    assert.equal(result.state, "refused");
    if (result.state !== "refused") return;
    // Verbatim, both halves: the operator is told what is wrong AND what to do.
    assert.equal(result.message, REFUSAL.message);
    assert.equal(result.remediation, REFUSAL.remediation);
    assert.equal(result.code, "ingress-not-built");
  });

  /**
   * The load-bearing negative. Treating any non-2xx as a refusal would send the
   * operator to edit `capture.ingress` because the BFF fell over — a plausible
   * sentence pointing at the wrong system.
   */
  it("throws on a status outside {201, 409} rather than calling it a refusal", async () => {
    const { client } = clientOver(() => ({
      status: 500,
      body: { state: "error", code: "INTERNAL_FAILURE", message: "the authority database is locked", retryable: true },
    }));
    await assert.rejects(
      client.startCaptureSession({ workflowId: "person-lookup" }),
      (error: unknown) => {
        assert.ok(error instanceof DashboardClientError);
        assert.equal(error.kind, "http");
        assert.equal(error.status, 500);
        return true;
      },
    );
  });

  it("refuses a 201 whose body is not the start contract", async () => {
    const { client } = clientOver(() => ({ status: 201, body: { state: "started" } }));
    await assert.rejects(client.startCaptureSession({ workflowId: "person-lookup" }));
  });
});

describe("the QR carries the phone url, token in the fragment", () => {
  const phoneUrl = FIXTURE_CAPTURE_START.phoneUrl;

  it("is the url the domain composes, with the token off the path and the query", () => {
    assert.equal(
      phoneUrl,
      capturePhoneUrl("https://capture.example", FIXTURE_CAPTURE_TOKENS.empty),
    );
    const url = new URL(phoneUrl);
    assert.equal(url.pathname, CAPTURE_PHONE_ASSET_ENTRY);
    assert.equal(url.search, "");
    assert.equal(url.hash, `#${CAPTURE_TOKEN_FRAGMENT_KEY}=${FIXTURE_CAPTURE_TOKENS.empty}`);
    // A fragment is never transmitted to a server — that is the whole reason
    // the credential rides there rather than in the path this QR encodes.
    assert.ok(!`${url.origin}${url.pathname}${url.search}`.includes(FIXTURE_CAPTURE_TOKENS.empty));
  });

  it("encodes deterministically into a drawable symbol with its quiet zone", () => {
    const matrix = encodeQrCode(phoneUrl);
    // Same payload, same picture — a reference of a QR must not move on its own.
    assert.deepEqual(encodeQrCode(phoneUrl), matrix);
    assert.equal(matrix.size, 4 * matrix.version + 17);
    assert.ok(qrCodeSvgPath(matrix).length > 0);
    // The renderer's viewBox reserves the standard's four-module light border;
    // drawing the path without it ships a picture that does not scan.
    assert.equal(qrCodeSvgViewBox(matrix), `-4 -4 ${String(matrix.size + 8)} ${String(matrix.size + 8)}`);
  });
});
