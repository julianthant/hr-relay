/**
 * D274's minor/major bump refinement, on the WIRE schemas (unit F9c).
 *
 * `VersionBumpPlanSchema` and `VersionBumpApplicationSchema` (ref
 * `src/domain/archive/model.ts`) refuse a minor bump that lists an archive
 * candidate, a blocker, or an archived run — D274's rule that a minor bump
 * archives nothing and cannot be blocked. F10 found that the WIRE schemas
 * this module serves to the browser (`VersionBumpPlanWireSchema`, and the
 * sweep — the wire's shape for an applied bump) carried no matching
 * refinement, so the same contradiction the durable record refuses to store
 * was representable on the wire. This file pins both directions: the
 * violating payload is refused, and every legitimate shape (major with
 * candidates/blockers, minor with none, a generation-1 sweep with no change
 * record at all) still parses.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { ArchiveSweepWireSchema, SavedArchiveReportWireSchema, VersionBumpPlanWireSchema } from "../../../../src/domain/dashboard/archive.js";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const PLAN_ID = "aa11bb22-0004-4000-8000-aa11bb220004";
const APPLICATION_ID = "aa11bb22-0003-4000-8000-aa11bb220003";
const VERSION_PLAN_ID = "aa11bb22-0007-4000-8000-aa11bb220007";
const RUN_ID = "aa11bb22-0002-4000-8000-aa11bb220002";
const TRACE_ID = "pl-091200-aa22";
const WORKFLOW_ID = "person-lookup";
const NOW = "2026-08-26T09:00:00.000Z";

const IDENTITY = { workflowId: WORKFLOW_ID, descriptorVersion: 2, contractFingerprint: HASH_B };

const CANDIDATE = {
  runId: RUN_ID,
  traceId: TRACE_ID,
  workflowId: WORKFLOW_ID,
  title: "EID 10456712",
  enqueuedAt: NOW,
  drift: ["descriptor-version"],
};

const BLOCKER = { ...CANDIDATE, runState: "parked-write" };

const minorChangeRecord = {
  state: "present" as const,
  value: {
    kind: "minor" as const,
    what: "the label changed",
    why: "the operator wording became clearer",
    commit: { state: "absent" as const, reason: "no commit was named" },
  },
};

const majorChangeRecord = {
  state: "present" as const,
  value: {
    ...minorChangeRecord.value,
    kind: "major" as const,
  },
};

const BASE_PLAN = {
  versionPlanId: PLAN_ID,
  expectedVersion: 1,
  planFingerprint: HASH_A,
  scope: { kind: "workflows", workflowIds: [WORKFLOW_ID] },
  targetVersion: "0.2.0",
  changeFingerprint: HASH_C,
  observedAppVersion: "0.1.0",
  observedIdentities: [IDENTITY],
  candidates: [] as unknown[],
  blockers: [] as unknown[],
  plannedBy: "local-operator",
  plannedAt: NOW,
  state: "planned",
} as const;

const BASE_SWEEP = {
  applicationId: APPLICATION_ID,
  versionPlanId: VERSION_PLAN_ID,
  scope: { kind: "workflows", workflowIds: [WORKFLOW_ID] },
  targetVersion: "0.2.0",
  appliedAppVersion: "0.1.0",
  appliedIdentities: [IDENTITY],
  appliedBy: "local-operator",
  appliedAt: NOW,
  archivedCount: 0,
  fromVersions: [] as number[],
} as const;

describe("D274 mirrored onto the wire (unit F9c, found by F10)", () => {
  it("refuses a minor plan that lists an archive candidate", () => {
    const result = VersionBumpPlanWireSchema.safeParse({
      ...BASE_PLAN,
      candidates: [CANDIDATE],
      changeRecord: minorChangeRecord,
    });
    assert.equal(result.success, false);
  });

  it("refuses a minor plan that lists a blocker", () => {
    const result = VersionBumpPlanWireSchema.safeParse({
      ...BASE_PLAN,
      blockers: [BLOCKER],
      changeRecord: minorChangeRecord,
    });
    assert.equal(result.success, false);
  });

  it("admits a minor plan with no candidates and no blockers", () => {
    const result = VersionBumpPlanWireSchema.safeParse({
      ...BASE_PLAN,
      changeRecord: minorChangeRecord,
    });
    assert.equal(result.success, true);
  });

  it("admits a major plan carrying the exact same candidate and blocker — major is unaffected", () => {
    const result = VersionBumpPlanWireSchema.safeParse({
      ...BASE_PLAN,
      candidates: [CANDIDATE],
      blockers: [BLOCKER],
      changeRecord: majorChangeRecord,
    });
    assert.equal(result.success, true);
  });

  it("admits a plan whose change record is absent (a plan predating charter §25) with candidates and blockers", () => {
    const result = VersionBumpPlanWireSchema.safeParse({
      ...BASE_PLAN,
      candidates: [CANDIDATE],
      blockers: [BLOCKER],
      changeRecord: { state: "absent", reason: "this plan predates the change record" },
    });
    assert.equal(result.success, true);
  });

  it("refuses a minor sweep recording a nonzero archived count", () => {
    const result = ArchiveSweepWireSchema.safeParse({
      ...BASE_SWEEP,
      archivedCount: 1,
      changeRecord: minorChangeRecord,
    });
    assert.equal(result.success, false);
  });

  it("admits a minor sweep recording zero archived", () => {
    const result = ArchiveSweepWireSchema.safeParse({
      ...BASE_SWEEP,
      archivedCount: 0,
      changeRecord: minorChangeRecord,
    });
    assert.equal(result.success, true);
  });

  it("admits a major sweep recording the exact same nonzero archived count — major is unaffected", () => {
    const result = ArchiveSweepWireSchema.safeParse({
      ...BASE_SWEEP,
      archivedCount: 1,
      fromVersions: [1],
      changeRecord: majorChangeRecord,
    });
    assert.equal(result.success, true);
  });

  it("admits a sweep whose change record is absent (generation-1, predates charter §25) with a nonzero archived count", () => {
    const result = ArchiveSweepWireSchema.safeParse({
      ...BASE_SWEEP,
      archivedCount: 1,
      fromVersions: [1],
      changeRecord: { state: "absent", reason: "this sweep predates change records" },
    });
    assert.equal(result.success, true);
  });
});

const SAVED_REPORT = {
  state: "available" as const,
  runId: RUN_ID,
  title: "Saved report",
  workflow: WORKFLOW_ID,
  descriptorVersion: "2",
  outcome: "done" as const,
  completedAt: NOW,
  capturedAt: NOW,
  sections: [],
  files: [],
  archiveFingerprint: HASH_A,
};

describe("saved archive report wire metadata", () => {
  it("accepts historical producers without optional record metadata", () => {
    const result = SavedArchiveReportWireSchema.parse(SAVED_REPORT);
    for (const field of ["transferId", "itemId", "attempt", "runNumber", "publicationState", "reportIntegrity"] as const) {
      assert.equal(field in result, false, `${field} stays absent for a historical producer`);
    }
  });

  it("preserves null, false, zero, empty text and empty collections", () => {
    const report = SavedArchiveReportWireSchema.parse({
      ...SAVED_REPORT,
      transferId: PLAN_ID,
      itemId: "item-1",
      attempt: 1,
      runNumber: null,
      sections: [{ kind: "values", title: "Typed fields", values: [
        { label: "null", value: null },
        { label: "false", value: false },
        { label: "zero", value: 0 },
        { label: "empty text", value: "" },
      ] }],
      publicationState: "published",
      reportIntegrity: "verified",
    });
    assert.equal(report.transferId, PLAN_ID);
    assert.equal(report.itemId, "item-1");
    assert.equal(report.attempt, 1);
    assert.equal(report.runNumber, null);
    if (report.sections[0]?.kind !== "values") throw new Error("expected typed values");
    assert.deepEqual(report.sections[0].values.map(field => field.value), [null, false, 0, ""]);
    assert.deepEqual(report.files, []);
    assert.equal(report.publicationState, "published");
    assert.equal(report.reportIntegrity, "verified");
  });

  it("strictly validates optional metadata and rejects private report digests/snapshots", () => {
    for (const metadata of [
      { transferId: "invalid" },
      { itemId: "" },
      { attempt: 0 },
      { runNumber: -1 },
      { publicationState: "captured" },
      { reportIntegrity: "unverified" },
    ]) assert.equal(SavedArchiveReportWireSchema.safeParse({ ...SAVED_REPORT, ...metadata }).success, false);

    for (const privateField of [
      { sourceDigest: HASH_B },
      { sources: [{ kind: "authority-snapshot", json: "{}", digest: HASH_B }] },
      { digest: HASH_C },
    ]) assert.equal(SavedArchiveReportWireSchema.safeParse({ ...SAVED_REPORT, ...privateField }).success, false);
  });
});
