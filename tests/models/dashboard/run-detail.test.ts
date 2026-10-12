import { createDashboardModelFixtures } from "../../support/helpers/dashboard-model-fixtures.js";
import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { FrontendBootstrapWireSchema } from "../../../src/models/dashboard/bootstrap.js";
import { DashboardDayWireSchema,QueueSurfaceWireSchema } from "../../../src/models/dashboard/projection.js";
import { CaptureListSchema,RunCaptureArtifactWireSchema,RunDetailSectionResponseSchema,RunDetailWireSchema } from "../../../src/models/dashboard/run-detail.js";
import { failureDetailWireFixture,receiptWireFixture } from "../../support/helpers/trust/trust-wire-fixtures.js";

const { BOOTSTRAP, RUN_1, RUN_2, NOTE_1, RECORD_1, HASH_A, HASH_B, NOW, QUEUE, DAY, DETAIL, NOTE_PAGE, REVIEW_PAGE, PEOPLE_PAGE, ARTIFACT } = createDashboardModelFixtures();

const FAILURE_1 = "99999999-9999-4999-8999-999999999999";






function isPlainObject(value: unknown): value is object {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function objectPaths(value: unknown, path: readonly (string | number)[] = []): readonly (readonly (string | number)[])[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => objectPaths(item, [...path, index]));
  }
  if (!isPlainObject(value)) return [];
  return [path, ...Object.entries(value).flatMap(([key, child]) => objectPaths(child, [...path, key]))];
}

function addUnknownAt(value: unknown, target: readonly (string | number)[], depth = 0): unknown {
  if (depth === target.length) {
    if (!isPlainObject(value)) throw new Error("unknown-key target must be an object");
    return { ...value, unexpectedBoundaryKey: true };
  }
  const segment = target[depth];
  if (typeof segment === "number") {
    if (!Array.isArray(value)) throw new Error("unknown-key path expected an array");
    return Array.from(value, (child: unknown, index) => (
      index === segment ? addUnknownAt(child, target, depth + 1) : child
    ));
  }
  if (!isPlainObject(value)) throw new Error("unknown-key path expected an object");
  return Object.fromEntries(Object.entries(value).map(([key, child]) => (
    key === segment ? [key, addUnknownAt(child, target, depth + 1)] : [key, child]
  )));
}

function assertRecursivelyStrict(schema: { safeParse(input: unknown): { success: boolean } }, fixture: unknown): void {
  assert.equal(schema.safeParse(fixture).success, true);
  for (const path of objectPaths(fixture)) {
    assert.equal(schema.safeParse(addUnknownAt(fixture, path)).success, false, `accepted unknown key at ${path.join(".") || "root"}`);
  }
}

describe("dashboard wire primitives", () => {
  it("parses recursively strict bootstrap, day, and detail resources", () => {
    assertRecursivelyStrict(FrontendBootstrapWireSchema, BOOTSTRAP);
    assertRecursivelyStrict(DashboardDayWireSchema, DAY);
    assertRecursivelyStrict(RunDetailWireSchema, DETAIL);
  });

  it("keeps version, fingerprint, generation, revision, cursor, and identities distinct", () => {
    assert.equal(FrontendBootstrapWireSchema.safeParse({ ...BOOTSTRAP, wireVersion: 2 }).success, false);
    assert.equal(FrontendBootstrapWireSchema.safeParse({ ...BOOTSTRAP, projectionGeneration: 0 }).success, false);
    assert.equal(FrontendBootstrapWireSchema.safeParse({ ...BOOTSTRAP, descriptorHash: BOOTSTRAP.appVersion }).success, false);
    assert.equal(QueueSurfaceWireSchema.safeParse({ ...QUEUE, rowRevision: 1.5 }).success, false);
    for (const cursor of [1, "1", "pc:0", "pc:-1", "pc:1.5", "cursor:1"]) {
      assert.equal(DashboardDayWireSchema.safeParse({ ...DAY, snapshotCursor: cursor }).success, false, String(cursor));
    }
    assert.equal(RunDetailWireSchema.safeParse({ ...DETAIL, runId: RUN_2 }).success, false);
  });

  it("rejects incompatible panel sections, open terminal gates, and duplicate detail identities", () => {
    assert.equal(RunDetailWireSchema.safeParse({ ...DETAIL, availableSections: [...DETAIL.availableSections, "review"] }).success, false);
    assert.equal(RunDetailWireSchema.safeParse({ ...DETAIL, panelKind: "review", availableSections: ["review", "people"] }).success, false);
    assert.equal(RunDetailWireSchema.safeParse({ ...DETAIL, panelKind: "group", availableSections: ["people", "review"] }).success, false);
    assert.equal(RunDetailWireSchema.safeParse({
      ...DETAIL,
      gate: { state: "open", gateId: NOTE_1, label: "Approve", openedAt: NOW, revision: 1 },
      outcome: { state: "terminal", result: "verified-done", completedAt: NOW },
    }).success, false);
    assert.equal(RunDetailWireSchema.safeParse({
      ...DETAIL,
      timeline: { events: [...DETAIL.timeline.events, DETAIL.timeline.events[0]] },
    }).success, false);
  });

  it("a replayed step names the checkpoint it replayed, and measures nothing", () => {
    const stepped = (member: unknown) => ({
      ...DETAIL,
      timeline: { ...DETAIL.timeline, steps: [{ label: "Kronos timecard", state: "replayed", members: [member] }] },
    });
    assert.equal(RunDetailWireSchema.safeParse(
      stepped({ label: "Timecard", state: "replayed", replayedFrom: { attempt: 8, claimGeneration: 2 } }),
    ).success, true);

    assert.equal(RunDetailWireSchema.safeParse(
      stepped({ label: "Timecard", state: "replayed", replayedFrom: { attempt: 8 } }),
    ).success, true);
    // Replayed with no source is a claim with no citation.
    assert.equal(RunDetailWireSchema.safeParse(stepped({ label: "Timecard", state: "replayed" })).success, false);
    // A source on anything else says a step both ran and did not.
    assert.equal(RunDetailWireSchema.safeParse(
      stepped({ label: "Timecard", state: "done", replayedFrom: { attempt: 8 } }),
    ).success, false);
    // `took 0s` is exactly the sentence this arm exists to delete.
    assert.equal(RunDetailWireSchema.safeParse(
      stepped({ label: "Timecard", state: "replayed", durationSec: 0, replayedFrom: { attempt: 8 } }),
    ).success, false);
  });
});

describe("lazy detail and artifact resources", () => {
  it("correlates every lazy section with a closed payload", () => {
    const sections = [
      { section: "logs", payload: NOTE_PAGE },

      { section: "receipt", payload: { state: "available", value: receiptWireFixture() } },
      { section: "review", payload: REVIEW_PAGE },
      { section: "people", payload: PEOPLE_PAGE },
      {
        section: "context-data",
        payload: {
          runId: RUN_1,
          state: "available",
          entries: [
            {
              label: "EID",
              valueRedacted: "••••1234",
              coordinate: { nodeId: "crm-dates", fieldPath: "emplId" },
              checkpoint: {
                state: "present", runId: RUN_1, attempt: 1, claimGeneration: 1,
                descriptorVersion: 1, contractFingerprint: HASH_A, schemaHash: HASH_B, writtenAt: NOW,
              },
              valueState: "present",
            },
            {
              label: "Starts on",
              valueRedacted: "Not recorded for this run",
              coordinate: { nodeId: "crm-dates", fieldPath: "startsOn.value" },
              checkpoint: { state: "absent", reason: "no-checkpoint-for-run" },
              valueState: "absent",
            },
          ],
        },
      },
      { section: "context-evidence", payload: { runId: RUN_1, entries: [] } },
      { section: "context-attempts", payload: { runId: RUN_1, entries: [] } },
      { section: "failure", payload: { state: "available", value: failureDetailWireFixture({
        runId: RUN_1, failureId: FAILURE_1, traceId: "on-120000-1111", workflowId: "onboarding",
      }) } },
      { section: "captures", payload: { runId: RUN_1, artifacts: [{ artifact: ARTIFACT.value,
        origins: [{ bundleId: RECORD_1, originKind: "operator-request" }] }] } },
    ];
    for (const section of sections) assert.equal(RunDetailSectionResponseSchema.safeParse(section).success, true, section.section);
    assert.equal(RunDetailSectionResponseSchema.safeParse({ section: "logs", payload: REVIEW_PAGE }).success, false);
    assert.equal(RunDetailSectionResponseSchema.safeParse({ section: "review", payload: { ...REVIEW_PAGE, records: [...REVIEW_PAGE.records, REVIEW_PAGE.records[0]] } }).success, false);
    assert.equal(RunDetailSectionResponseSchema.safeParse({ section: "people", payload: { ...PEOPLE_PAGE, members: [...PEOPLE_PAGE.members, PEOPLE_PAGE.members[0]], total: 2 } }).success, false);
  });

  it("requires strict nonempty unique capture memberships and identical bundle kinds across tiles", () => {
    const capture = { artifact: ARTIFACT.value, origins: [{ bundleId: RECORD_1, originKind: "failure" }] };
    assertRecursivelyStrict(RunCaptureArtifactWireSchema, capture);
    assert.equal(RunCaptureArtifactWireSchema.safeParse({ ...capture, origins: [] }).success, false);
    assert.equal(RunCaptureArtifactWireSchema.safeParse({ artifact: ARTIFACT.value }).success, false);
    assert.equal(RunCaptureArtifactWireSchema.safeParse({ ...capture, origins: [...capture.origins, ...capture.origins] }).success, false);
    assert.equal(CaptureListSchema.safeParse({ runId: RUN_1, artifacts: [] }).success, false);
    assert.equal(CaptureListSchema.safeParse({ runId: RUN_1, artifacts: [capture, capture] }).success, false);
    const other = { artifact: { ...ARTIFACT.value, artifactId: RUN_2 }, origins: [{ bundleId: RECORD_1, originKind: "operator-request" }] };
    assert.equal(CaptureListSchema.safeParse({ runId: RUN_1, artifacts: [capture, other] }).success, false);
    assert.equal(CaptureListSchema.safeParse({ runId: RUN_1, artifacts: [capture, { ...other, origins: capture.origins }] }).success, true);
  });
});
