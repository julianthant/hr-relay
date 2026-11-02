import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "vitest";
import { createDashboardClient, DashboardClientError } from "../../../src/dashboard/client/index.js";

const RUN = "00000000-0000-4000-8000-000000000001";
const COMMAND = "00000000-0000-4000-8000-000000000002";
it("uses the existing transport for a content-bound PDF upload and exact review page URL", async () => {
  const bytes = new TextEncoder().encode("%PDF-1.7\nsynthetic source");
  const source = { artifact: { id: COMMAND, mediaType: "application/pdf", bytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex") }, fileName: "source.pdf",
    uploadedAt: "2026-11-02T10:00:00.000Z", uploadedBy: "local-operator" };
  const client = createDashboardClient({ baseUrl: "http://localhost", fetchImpl: async (url, init) => {
    assert.equal(url, "http://localhost/api/v1/ocr/files?filename=source.pdf");
    assert.equal(init?.method, "POST");
    assert.deepEqual(new Uint8Array(await new Response(init?.body).arrayBuffer()), bytes);
    return new Response(JSON.stringify(source), { status: 201, headers: { "content-type": "application/json" } });
  } });
  assert.deepEqual(await client.uploadOcrSource({ fileName: "source.pdf", bytes }), source);
  assert.equal(client.ocrSourcePageUrl(RUN, 3, 2), `http://localhost/api/v1/runs/${RUN}/ocr/pages/2?revision=3`);
});

it("refuses a source upload response whose bytes differ and a foreign run's command result", async () => {
  const client = createDashboardClient({ baseUrl: "http://localhost", fetchImpl: async url => new Response(JSON.stringify(
    url.includes("/ocr/files") ? { artifact: { id: COMMAND, mediaType: "application/pdf", bytes: 1, sha256: "a".repeat(64) },
      fileName: "source.pdf", uploadedAt: "2026-11-02T10:00:00.000Z", uploadedBy: "local-operator" }
      : { state: "recorded", request: { commandId: COMMAND, requestedAt: "2026-11-02T10:00:00.000Z", requestedBy: "local-operator", source: "dashboard",
        family: "ocr-review", type: "discard-ocr-record", target: { runId: COMMAND, expectedRevision: 1 }, payload: { recordId: `${"a".repeat(64)}#emergency-contact#1` } },
      result: { state: "applied", commandId: COMMAND, affectedTargets: [{ family: "ocr-review", runId: COMMAND }] } }
  ), { status: 200, headers: { "content-type": "application/json" } }) });
  await assert.rejects(client.uploadOcrSource({ fileName: "source.pdf", bytes: new Uint8Array([1, 2]) }), DashboardClientError);
  await assert.rejects(client.ocrCommandResult(RUN, COMMAND), DashboardClientError);
});
