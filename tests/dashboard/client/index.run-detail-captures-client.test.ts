
import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { createDashboardClient,DashboardClientError } from "../../../src/dashboard/client/index.js";

const RUN = "00000000-0000-4000-8000-000000000301";
const FOREIGN = "00000000-0000-4000-8000-000000000302";
const ARTIFACT = "00000000-0000-4000-8000-000000000303";
const BUNDLE = "00000000-0000-4000-8000-000000000304";
const CAPTURE = {
  artifact: { mediaKind: "data", artifactId: ARTIFACT, mediaType: "application/json",
    byteLength: 2, sha256: "a".repeat(64), sensitivity: "redacted", redaction: "applied" },
  origins: [{ bundleId: BUNDLE, originKind: "unexpected-state" }, { bundleId: FOREIGN, originKind: "operator-request" }],
};
const SECTION = { section: "captures", payload: { runId: RUN, artifacts: [CAPTURE] } };
const DETAIL = {
  runId: RUN, rowRevision: 1, panelKind: "run",
  header: { runId: RUN, traceId: "pl-100001-0000", workflowId: "person-lookup", actorId: "local-operator",
    title: "Requested run", status: "queued", attempt: 1 },
  timeline: { events: [] }, gate: { state: "absent", reason: "not started" },
  outcome: { state: "absent", reason: "not started" }, context: { dataFacts: 0, evidenceFacts: 0, attempts: 1 },
  captures: { state: "available", artifactCount: 1 }, availableSections: ["logs", "captures"],
};
function clientReturning(body: unknown) {
  return createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async () => Response.json(body) });
}
function identityError(code: string) {
  return (error: unknown) => {
    assert.ok(error instanceof DashboardClientError);
    assert.equal(error.kind, "schema");
    assert.equal(error.code, code);
    assert.match(error.message, new RegExp(RUN, "u"));
    assert.doesNotMatch(error.message, new RegExp(FOREIGN, "u"));
    return true;
  };
}

describe("capture client", () => {
  it("rejects a foreign initial run's capture capability", async () => {
    const client = clientReturning({ ...DETAIL, runId: FOREIGN, header: { ...DETAIL.header, runId: FOREIGN } });
    await assert.rejects(() => client.runDetail(RUN), identityError("RUN_DETAIL_IDENTITY_MISMATCH"));
  });
  it("rejects a foreign lazy capture list", async () => {
    const client = clientReturning({ ...SECTION, payload: { ...SECTION.payload, runId: FOREIGN } });
    await assert.rejects(() => client.runSection(RUN, "captures"), identityError("RUN_SECTION_IDENTITY_MISMATCH"));
  });
  it("rejects a different strict section returned for a captures request", async () => {
    const client = clientReturning({ section: "context-attempts", payload: { runId: RUN, entries: [] } });
    await assert.rejects(() => client.runSection(RUN, "captures"), identityError("RUN_SECTION_IDENTITY_MISMATCH"));
  });
  it("preserves all served origins and byte facts", async () => {
    assert.deepEqual(await clientReturning(SECTION).runSection(RUN, "captures"), SECTION);
  });
  it.each([
    ["missing", undefined], ["empty", []], ["unknown kind", [{ bundleId: BUNDLE, originKind: "latest" }]],
    ["actor leakage", [{ bundleId: BUNDLE, originKind: "operator-request", requestedBy: "local-operator" }]],
    ["failure leakage", [{ bundleId: BUNDLE, originKind: "failure", failureId: FOREIGN }]],
    ["duplicate", [CAPTURE.origins[0], CAPTURE.origins[0]]],
  ])("refuses %s provenance", async (_name, origins) => {
    const client = clientReturning({ ...SECTION, payload: { runId: RUN, artifacts: [{ ...CAPTURE, origins }] } });
    await assert.rejects(() => client.runSection(RUN, "captures"), (error: unknown) => {
      assert.ok(error instanceof DashboardClientError);
      assert.equal(error.kind, "schema");
      return true;
    });
  });
  it("forwards the optional fourth abort signal to the lazy request", async () => {
    const controller = new AbortController();
    let received: AbortSignal | null | undefined;
    let path: unknown;
    const client = createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async (input, init) => {
      path = input; received = init?.signal; return Response.json(SECTION);
    } });
    await client.runSection(RUN, "captures", undefined, controller.signal);
    assert.equal(received, controller.signal);
    assert.equal(String(path), `http://fixture.test/api/v1/runs/${RUN}/captures`);
  });
  it("builds only exact artifact byte URLs", () => {
    const client = clientReturning(SECTION);
    assert.equal(client.artifactUrl(ARTIFACT), `http://fixture.test/artifacts/v1/${ARTIFACT}`);
    assert.throws(() => client.artifactUrl("../../latest"), /uuid|invalid/iu);
  });
});
