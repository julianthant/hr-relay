import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { canonicalJsonStringify } from "../../../src/domain/canonical-json.js";
import { ArchivedRunRecordSchema, VersionBumpApplicationSchema, archivedRunContentDigest, archivedRunReferenceFingerprint } from "../../../src/domain/archive/model.js";
import { FailureTriageOutcomeSchema } from "../../../src/domain/trust/advisory.js";
import { FailureRecordSchema } from "../../../src/domain/trust/failure.js";
import { buildRunAdvisory, type AdvisoryQueryDeps } from "../../../src/server/dashboard/queries/advisory.js";
import { buildTrustSection } from "../../../src/server/dashboard/queries/run-trust.js";
import { SectionUnavailableError, TargetNotFoundError } from "../../../src/server/failures.js";
import { VERSION_PLAN_ROW, VERSION_BUMP_APPLICATION } from "../../fixtures/archive-fixtures.js";
import { HASH_A } from "../../fixtures/phase1c-contract-fixtures.js";
import { VALID_TRIAGE_ADVICE } from "../fixtures/advisory-fixtures.js";
import { uuidOf } from "./helpers/dashboard-harness.js";
import { trustWorld, trustArchiveRecord } from "./helpers/trust-authority-fixture.js";

const worlds: ReturnType<typeof trustWorld>[] = [];
afterEach(() => { for (const world of worlds.splice(0).reverse()) world.dispose(); });
function fixture() {
  const f = trustWorld(); worlds.push(f);
  const run = f.fail(f.create(71), 72);
  const failure = f.database.authority.failures.listByRun(run.envelope.runId).at(-1); assert.ok(failure);
  const now = f.world.clock.now().toISOString();
  const outcome = FailureTriageOutcomeSchema.parse({ outcome: "advisory-produced", advice: VALID_TRIAGE_ADVICE,
    invocation: { surface: "failure-triage", promptTemplateVersion: 1, redactedInputDigest: HASH_A,
      resultSchemaFingerprint: HASH_A, startedAt: now, endedAt: now, provider: "gemini", model: "fixture" } });
  let calls = 0;
  const deps: AdvisoryQueryDeps = { runReader: f.reader,
    authority: { getFailureForRun: id => f.database.authority.failures.listByRun(id).at(-1) },
    advise: async (subject, evidence) => { calls++; assert.deepEqual(subject, run); assert.deepEqual(evidence, failure); return outcome; } };
  const archive = () => {
    f.database.authority.versionPlans.insert(VERSION_PLAN_ROW);
    f.database.authority.versionBumpApplications.insert(VersionBumpApplicationSchema.parse({ ...VERSION_BUMP_APPLICATION,
      archivedRunIds: [run.envelope.runId] }));
    const detail = buildTrustSection(f.deps, run.envelope.runId, "failure");
    assert.equal(detail.section, "failure");
    if (detail.section !== "failure" || detail.payload.state !== "available") throw new Error("failure evidence missing");
    const { contentDigest: _digest, ...template } = trustArchiveRecord(run);
    const content = { ...template, failure: { state: "present" as const, value: detail.payload.value } };
    const frozen = ArchivedRunRecordSchema.parse({ ...content, contentDigest: archivedRunContentDigest(content) });
    assert.deepEqual(f.database.authority.archivedRuns.bindingMismatches(frozen), []);
    assert.equal(f.service.archive({ commandId: uuidOf(73), expectedVersion: run.version, archive: frozen }).state, "applied");
    return frozen;
  };
  return { ...f, run, failure, outcome, deps, archive, calls: () => calls };
}

describe("canonical failure advisory admission", () => {
  it("serves a real failed run without a fold and preserves its durable evidence", async () => {
    const f = fixture(); const id = f.run.envelope.runId;
    assert.equal(f.world.projection.runFold(id), undefined);
    const before = canonicalJsonStringify(f.failure);
    const result = await buildRunAdvisory(f.deps, id);
    assert.equal(result.runId, id); assert.equal(result.failureId, f.failure.failureId);
    assert.deepEqual(result.outcome, f.outcome); assert.equal(f.calls(), 1);
    assert.equal(canonicalJsonStringify(f.database.authority.failures.get(f.failure.failureId)), before);
    assert.deepEqual(f.reader.read(id), { state: "present", disposition: "live", run: f.run });
  });

  it("refuses absent, archived and tombstoned runs before calling the provider", async () => {
    const f = fixture(); const id = f.run.envelope.runId;
    await assert.rejects(buildRunAdvisory(f.deps, uuidOf(999)), TargetNotFoundError);
    const archive = f.archive(); const frozen = canonicalJsonStringify(f.database.authority.archivedRuns.get(id));
    await assert.rejects(buildRunAdvisory(f.deps, id), SectionUnavailableError);
    assert.equal(canonicalJsonStringify(f.database.authority.archivedRuns.get(id)), frozen);
    assert.equal(f.service.deleteArchived({ commandId: uuidOf(74), runId: id,
      archiveFingerprint: archivedRunReferenceFingerprint(archive) }).state, "deleted");
    await assert.rejects(buildRunAdvisory(f.deps, id), TargetNotFoundError);
    assert.equal(f.calls(), 0); assert.equal(f.database.authority.failures.get(f.failure.failureId), undefined);
  });

  it("refuses a missing or foreign failure before provider work", async () => {
    const f = fixture(); const id = f.run.envelope.runId;
    await assert.rejects(buildRunAdvisory({ ...f.deps, authority: { getFailureForRun: () => undefined } }, id), SectionUnavailableError);
    for (const change of [{ runId: uuidOf(98) }, { failureId: uuidOf(99) }, { workflowId: "separations" },
      { traceId: "pl-010101-0002" }, { attempt: f.failure.attempt + 1 }]) {
      const foreign = FailureRecordSchema.parse({ ...f.failure, ...change });
      await assert.rejects(buildRunAdvisory({ ...f.deps, authority: { getFailureForRun: () => foreign } }, id), /IDENTITY_MISMATCH/);
    }
    const queued = f.create(75);
    await assert.rejects(buildRunAdvisory({ ...f.deps, authority: { getFailureForRun: () => f.failure } }, queued.envelope.runId), SectionUnavailableError);
    assert.equal(f.calls(), 0); assert.deepEqual(f.database.authority.failures.get(f.failure.failureId), f.failure);
  });

  it.each(["archive", "delete"] as const)("refuses readback when %s invalidates the run during provider work", async action => {
    const f = fixture(); const id = f.run.envelope.runId;
    let calls = 0;
    await assert.rejects(buildRunAdvisory({ ...f.deps, advise: async () => {
      calls++; const archive = f.archive();
      if (action === "delete") assert.equal(f.service.deleteArchived({ commandId: uuidOf(74), runId: id,
        archiveFingerprint: archivedRunReferenceFingerprint(archive) }).state, "deleted");
      return f.outcome;
    } }, id), action === "archive" ? SectionUnavailableError : TargetNotFoundError);
    assert.equal(calls, 1);
    assert.equal(f.reader.read(id).state, action === "delete" ? "deleted" : "present");
  });
});
