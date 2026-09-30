import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { RunDetailSectionResponseSchema, RunDetailWireSchema } from "../../../src/domain/dashboard/run-detail.js";
import { mergeSection, sectionsWanted } from "../../../src/dashboard/surfaces/run-detail/section-registration.js";

const RUN = "00000000-0000-4000-8000-000000000314";

function detail(availableSections: readonly string[]) {
  return RunDetailWireSchema.parse({
    runId: RUN,
    rowRevision: 3,
    panelKind: "run",
    header: {
      runId: RUN,
      traceId: "pl-100001-0314",
      workflowId: "person-lookup",
      actorId: "local-operator",
      title: "Section registration fixture",
      status: "queued",
      attempt: 1,
    },
    timeline: { events: [] },
    gate: { state: "absent", reason: "not started" },
    outcome: { state: "absent", reason: "not started" },
    context: { dataFacts: 0, evidenceFacts: 0, attempts: 1 },
    availableSections,
  });
}

describe("run-detail client section registration", () => {
  it("fetches retained controls and inline sections without retired data or receipt surfaces", () => {
    const run = detail([
      "captures", "identity-gate", "logs", "context-attempts", "failure", "receipt",
      "context-evidence", "parked-write", "context-data",
    ]);

    assert.deepEqual(sectionsWanted(run, "logs"), [
      "context-attempts", "logs", "failure", "parked-write", "identity-gate",
    ]);
    assert.deepEqual(sectionsWanted(run, "receipt"), [
      "context-attempts", "logs", "failure", "parked-write", "identity-gate",
    ]);
  });

  it("never fetches an unadvertised Logs section for a retired receipt selection", () => {
    assert.deepEqual(sectionsWanted(detail(["receipt", "context-data", "context-evidence"]), "receipt"), []);
  });

  it("places a response only in its named owner section", () => {
    const response = RunDetailSectionResponseSchema.parse({
      section: "logs",
      payload: {
        runId: RUN,
        rows: [],
        notes: [],
        nextCursor: { state: "absent", reason: "end-of-page" },
      },
    });

    const sections = mergeSection({}, response);
    assert.equal(sections.logs?.runId, RUN);
    assert.equal(sections.receipt, undefined);
    assert.equal(sections.failure, undefined);
  });

  it("refuses payloads owned by the capture surface or not rendered by this panel", () => {
    const captureResponse = RunDetailSectionResponseSchema.parse({
      section: "captures",
      payload: {
        runId: RUN,
        artifacts: [{
          artifact: {
            mediaKind: "data",
            artifactId: "00000000-0000-4000-8000-000000000315",
            sha256: "a".repeat(64),
            byteLength: 0,
            sensitivity: "redacted",
            redaction: "applied",
            mediaType: "text/plain",
          },
          origins: [{ bundleId: "00000000-0000-4000-8000-000000000316", originKind: "operator-request" }],
        }],
      },
    });
    assert.throws(() => mergeSection({}, captureResponse), /capture owner/u);

    const unservedResponse = RunDetailSectionResponseSchema.parse({
      section: "review",
      payload: { runId: RUN, records: [] },
    });
    assert.throws(
      () => mergeSection({}, unservedResponse),
      /review.*has no panel placement/u,
    );
  });
});
