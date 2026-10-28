import assert from "node:assert/strict";
import { afterEach,describe,it,vi } from "vitest";
import { createOperatorRunDetail } from "../../../../../src/backend/app/composition/dashboard/run-detail.js";
import { buildRunDetail, buildRunSection } from "../../../../../src/backend/runs/queries/run-detail.js";
import { projectRunLogs } from "../../../../../src/dashboard/state/run-wiring-adapter.js";
import { ERROR_CATALOG, resolveErrorCatalogFailure, failureCodeFromTaskCode } from "../../../../../src/models/failures/error-catalog.js";
import { DiagnosticBundleCorruptError } from "../../../../../src/backend/runs/commands/refusals.js";
import { RerunRefusedError } from "../../../../../src/backend/runs/start/rerun.js";
import { buildReceiptFailureSection, failureRecovery } from "../../../../../src/backend/runs/queries/run-detail/receipts-failures.js";
import { createServerVerifiedArtifactReader } from "../../../../../src/backend/storage/artifacts/server-verified-artifact-reader.js";
import { deriveDiagnosticContentDigest } from "../../../../../src/models/trust/diagnostic-capture.js";
import { DiagnosticBundleSchema,type DiagnosticBundle } from "../../../../../src/models/trust/diagnostic.js";
import { ActorIdSchema,DiagnosticBundleIdSchema,FailureIdSchema } from "../../../../../src/rules/identity/ids.js";
import { canonicalJsonStringify } from "../../../../../src/rules/validation/canonical-json.js";
import { HASH_A,HASH_B,NOW } from "../../../../support/fixtures/phase1c-contract-fixtures.js";
import { trustWorld } from "../../../../support/helpers/backend/trust-authority-fixture.js";
import { separationsModule } from "../../../../../src/backend/app/registries/workflow-registry.js";
import { RunRecordSchema } from "../../../../../src/models/run/record.js";
import { FailureRecordSchema } from "../../../../../src/models/trust/failure.js";

const worlds: Awaited<ReturnType<typeof trustWorld>>[] = [];
afterEach(async () => { for (const world of worlds.splice(0).reverse()) await world.dispose(); });

async function fixture() {
  const f = await trustWorld();
  worlds.push(f);
  const run = f.fail(f.create(301), 302);
  const failure = f.database.authority.failures.listByRun(run.envelope.runId).at(-1);
  assert.ok(failure);
  const artifactReader = createServerVerifiedArtifactReader({ admission: f.profile.admission });
  await artifactReader.ready;
  const captures = { authority: f.database.authority.diagnosticBundles, artifactReader };
  const bundle = (seed: number, origin: DiagnosticBundle["origin"], runId = run.envelope.runId) => {
    const content = {
      runId,
      origin,
      capturedAt: NOW,
      configFingerprint: HASH_A,
      descriptorFingerprint: HASH_B,
      redaction: { fields: [], warnings: [] },
      attachments: [],
    };
    const { capturedAt, ...stored } = content;
    return DiagnosticBundleSchema.parse({
      ...stored,
      bundleId: `00000000-0000-4000-8000-${String(seed).padStart(12, "0")}`,
      createdAt: capturedAt,
      contentDigest: deriveDiagnosticContentDigest(content),
      retention: { kind: "pinned", reason: "write-recovery" },
    });
  };
  const trustWithBundle = (diagnosticBundleId?: string) => ({
      ...f.receipts,
      getFailure: (failureId: string) => {
        const current = f.receipts.getFailure(failureId);
        return current === undefined || diagnosticBundleId === undefined
          ? current
          : { ...current, diagnosticBundleId: DiagnosticBundleIdSchema.parse(diagnosticBundleId) };
      },
    });
  const read = (diagnosticBundleId?: string, captureAuthority = captures.authority) => {
    return buildReceiptFailureSection({
      ...f.deps,
      trust: trustWithBundle(diagnosticBundleId),
      captures: { ...captures, authority: captureAuthority },
    }, run.envelope.runId, "failure");
  };
  const readWithoutCaptures = (diagnosticBundleId: string) => buildReceiptFailureSection({
    ...f.deps,
    trust: trustWithBundle(diagnosticBundleId),
    captures: undefined,
  }, run.envelope.runId, "failure");
  return { f, run, failure, captures, bundle, read, readWithoutCaptures };
}

function availableFailure(response: ReturnType<typeof buildReceiptFailureSection>) {
  assert.equal(response.section, "failure");
  if (response.section !== "failure" || response.payload.state !== "available") {
    throw new Error("failure evidence was not available");
  }
  return response.payload.value;
}

describe("run-detail failure diagnostic-bundle linkage", () => {
  it("offers no recovery for canonical rerun refusal and propagates unexpected snapshot failures", async () => {
    const h = await fixture(), descriptor = separationsModule.descriptor;
    const correction = descriptor.failureCorrections?.[0]; assert.ok(correction);
    const run = RunRecordSchema.parse({ ...h.run, envelope: { ...h.run.envelope, workflow: descriptor.id,
      descriptorVersion: descriptor.version, contractFingerprint: descriptor.contractFingerprint } });
    const failure = FailureRecordSchema.parse({ ...h.failure, nodeId: correction.nodeId,
      code: failureCodeFromTaskCode(correction.code), writeState: "not-attempted" });
    const deps = { ...h.f.deps, canonical: { reader: h.f.reader, database: h.f.database, descriptors: { resolve: () => descriptor } } };
    let error: Error = new RerunRefusedError("source-stale", "synthetic stale source");
    const snapshot = vi.spyOn(h.f.database, "withAuthorityReadSnapshot").mockImplementation(() => { throw error; });
    try {
      assert.deepEqual(failureRecovery(deps, run, failure), {});
      error = new Error("synthetic unexpected snapshot failure");
      assert.throws(() => failureRecovery(deps, run, failure), candidate => candidate === error);
    } finally { snapshot.mockRestore(); }
  });

  it("does not offer document correction for an unavailable Kuali page or uncertain write", async () => {
    const h = await fixture();
    const descriptor = separationsModule.descriptor;
    const run = RunRecordSchema.parse({ ...h.run, envelope: { ...h.run.envelope, workflow: descriptor.id,
      descriptorVersion: descriptor.version, contractFingerprint: descriptor.contractFingerprint } });
    const existence = h.f.reader.read(h.run.envelope.runId);
    assert.ok("run" in existence);
    if (!("run" in existence)) throw new Error("run unavailable");
    let failure = FailureRecordSchema.parse({ ...h.failure, workflowId: descriptor.id, nodeId: "document",
      taskId: "kuali/read-separation-document", code: "DOCUMENT_UNAVAILABLE", writeState: "not-attempted" });
    let current = true;
    const reader = { ...h.f.reader, read: () => ({ ...existence, run }) };
    const deps = { ...h.f.deps, runReader: reader,
      canonical: { reader, database: h.f.database, descriptors: { resolve: () => current ? descriptor : undefined } },
      trust: { ...h.f.receipts, getFailure: () => failure },
    };
    const read = () => availableFailure(buildReceiptFailureSection(deps, run.envelope.runId, "failure"));
    assert.equal(read().recovery, undefined, "an unavailable page is not a proved missing document");
    failure = FailureRecordSchema.parse({ ...failure, action: { ...failure.action, operation: "commit" }, writeState: "unknown" });
    assert.equal(read().recovery, undefined, "UNKNOWN is never offered a correction/retry");
    failure = FailureRecordSchema.parse({ ...failure, action: { ...failure.action, operation: "read" }, writeState: "not-attempted", code: "UNEXPECTED_PAGE_STATE" });
    assert.equal(read().recovery, undefined, "a different failure is not a document correction");
    failure = FailureRecordSchema.parse({ ...failure, code: "DOCUMENT_UNAVAILABLE" });
    current = false;
    assert.equal(read().recovery, undefined, "missing current descriptor never becomes a default");
  });
  it("retains an early terminal failure in Logs when the empty evidence fold skips timeline reads", async () => {
    const h = await fixture();
    const runId = h.run.envelope.runId;
    const record = h.f.database.authority.timelineEvents.append({ schemaVersion: 1,
      eventId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", workflow: h.run.envelope.workflow,
      scope: { kind: "run", runId }, occurredAt: NOW, recordedAt: NOW, retentionDate: "2026-07-31",
      source: { kind: "native" }, payload: { kind: "span", event: { t: "span.ended", kind: "run", outcome: "failed",
        failureId: h.failure.failureId, runId, attempt: h.failure.attempt, traceId: h.failure.traceId,
        spanPath: h.failure.traceId, workflow: h.run.envelope.workflow, pid: 4242, ts: NOW } } }).record;
    const { world } = h.f;
    const e = h.run.envelope;
    world.authority.records.set(runId, h.run);
    world.writer.emit({ t: "run.queued", kind: "run", ts: NOW, workflow: e.workflow, runId,
      attempt: e.attempt, traceId: e.traceId, spanPath: e.traceId, itemId: e.itemId,
      shape: e.shape, priority: e.priority, dryRun: e.dryRun, actorId: "local-operator", title: "Early failure",
      descriptorVersion: e.descriptorVersion, contractFingerprint: e.contractFingerprint,
      resolvedInstance: e.resolvedInstance, configFingerprint: e.configFingerprint, configSnapshotId: e.configSnapshotId });
    const row = world.projection.runFold(runId);
    assert.ok(row);
    assert.equal(row.queued.runId, runId);
    assert.deepEqual(row.taskSpans, []);
    assert.deepEqual(row.openGates, []);
    assert.deepEqual(row.resolvedGates, []);
    const deps = createOperatorRunDetail({ stateRoot: world.stateRoot, projection: world.projection,
      database: h.f.database, runReader: h.f.reader, trust: h.f.receipts });
    let timelineReads = 0;
    const detail = buildRunDetail({ ...deps, timeline: { ...deps.timeline, page(input) {
      timelineReads++;
      return deps.timeline.page(input);
    } } }, runId);
    assert.equal(timelineReads, 0);
    assert.equal(detail.runId, runId);
    assert.equal(detail.header.status, "failed");
    assert.equal(detail.header.traceId, h.failure.traceId);
    assert.equal(detail.header.attempt, h.failure.attempt);
    assert.ok(detail.outcome.state === "terminal");
    assert.equal(detail.outcome.result, "failed");
    assert.ok(detail.availableSections.includes("failure"));
    assert.deepEqual(detail.timeline.events, []);
    const failureSection = buildRunSection(deps, runId, "failure");
    const value = availableFailure(failureSection);
    assert.equal(value.failureId, h.failure.failureId);
    assert.equal(value.summary, ERROR_CATALOG.ERROR_CATALOG_CODE_UNREGISTERED.text);
    assert.notEqual(value.summary, h.failure.summary);
    assert.equal(value.code, h.failure.code);
    assert.equal(value.nodeId, undefined);
    assert.deepEqual(value.native, { eventId: record.eventId, order: record.cursor, runId,
      attempt: h.failure.attempt, traceId: h.failure.traceId, spanPath: h.failure.traceId,
      ...(h.failure.nodeId === undefined ? {} : { nodeId: h.failure.nodeId }) });
    const logs = buildRunSection(deps, runId, "logs");
    assert.ok(logs.section === "logs");
    assert.ok(logs.payload.confirmedActions !== undefined);
    const projected = projectRunLogs({ detail, logs: logs.payload, sections: [failureSection],
      actionEvidence: { state: "available", events: logs.payload.confirmedActions, missingPages: [] },
      confirmedActionBindings: logs.payload.confirmedActionBindings, unavailableEvidence: [] },
    { artifactUrl: () => { throw new Error("early failure has no artifacts"); } });
    const failureStep = projected.steps.find(step => step.id === h.failure.failureId);
    assert.ok(failureStep);
    assert.equal(value.display?.title, "Step could not be completed");
    assert.equal(failureStep.title, "Step could not be completed");
    const decision = failureStep.entries.find(entry => entry.kind === "decision");
    assert.ok(decision?.kind === "decision");
    const message = resolveErrorCatalogFailure(h.failure, "http-response");
    assert.ok(message.state === "resolved");
    assert.equal(message.code, "ERROR_CATALOG_CODE_UNREGISTERED");
    assert.equal(message.text, "This failure code is not in the current catalog. Review the recorded local evidence.");
    assert.equal(decision.id, h.failure.failureId);
    assert.equal(decision.decision.title, "Step could not be completed");
    assert.equal(decision.decision.state, "failed");
    assert.equal(decision.decision.message, "This failure code is not in the current catalog. Review the recorded local evidence.");
  });

  it("keeps an unlinked failure's capture absent", async () => {
    const h = await fixture();
    const value = availableFailure(buildReceiptFailureSection(h.f.deps, h.run.envelope.runId, "failure"));
    assert.equal(value.diagnosticBundle.state, "absent");
    assert.ok(value.display?.title);
    assert.ok(value.display?.observation);
    assert.equal(value.summary, ERROR_CATALOG.ERROR_CATALOG_CODE_UNREGISTERED.text);
    assert.notEqual(value.summary, h.failure.summary);
    assert.deepEqual(value.remediation, h.failure.remediation);
    assert.equal(value.writeState, h.failure.writeState);
  });

  it.each([
    { kind: "failure" as const },
    { kind: "subject-mismatch" as const },
    { kind: "recovery-park" as const },
    { kind: "unexpected-state" as const },
  ])("serves a bundle linked to this run and failure origin: $kind", async ({ kind }) => {
    const h = await fixture();
    const row = h.bundle(303, { kind, failureId: h.failure.failureId });
    h.f.database.authority.diagnosticBundles.insert(row);
    const before = canonicalJsonStringify(h.failure);
    const value = availableFailure(h.read(row.bundleId));
    assert.deepEqual(value.diagnosticBundle, { state: "present", bundleId: row.bundleId });
    assert.equal(canonicalJsonStringify(h.f.database.authority.failures.get(h.failure.failureId)), before);
  });

  it("fails loudly when a failure names a bundle but capture authority is absent", async () => {
    const h = await fixture();
    const row = h.bundle(304, { kind: "failure", failureId: h.failure.failureId });
    assert.throws(() => h.readWithoutCaptures(row.bundleId), DiagnosticBundleCorruptError);
  });

  it("fails loudly when the exact bundle record is missing", async () => {
    const h = await fixture();
    const row = h.bundle(305, { kind: "failure", failureId: h.failure.failureId });
    assert.throws(() => h.read(row.bundleId), DiagnosticBundleCorruptError);
  });

  it("fails loudly when a named bundle belongs to another run", async () => {
    const h = await fixture();
    const foreignRun = h.f.create(306).envelope.runId;
    const row = h.bundle(307, { kind: "failure", failureId: h.failure.failureId }, foreignRun);
    const authority = {
      ...h.captures.authority,
      get: (id: string) => id === row.bundleId ? row : h.captures.authority.get(id),
    };
    assert.throws(() => h.read(row.bundleId, authority), DiagnosticBundleCorruptError);
  });

  it("fails loudly when the origin belongs to a different failure or an operator request", async () => {
    const h = await fixture();
    const wrongFailure = h.bundle(308, {
      kind: "failure",
      failureId: FailureIdSchema.parse("00000000-0000-4000-8000-000000000309"),
    });
    const wrongFailureAuthority = {
      ...h.captures.authority,
      get: (id: string) => id === wrongFailure.bundleId ? wrongFailure : h.captures.authority.get(id),
    };
    assert.throws(() => h.read(wrongFailure.bundleId, wrongFailureAuthority), DiagnosticBundleCorruptError);

    const operatorBundle = h.bundle(310, {
      kind: "operator-request",
      requestedBy: ActorIdSchema.parse("local-operator"),
    });
    const operatorAuthority = {
      ...h.captures.authority,
      get: (id: string) => id === operatorBundle.bundleId ? operatorBundle : h.captures.authority.get(id),
    };
    assert.throws(() => h.read(operatorBundle.bundleId, operatorAuthority), DiagnosticBundleCorruptError);
  });

  it("requires exact membership and matching contents between lookup and run index", async () => {
    const h = await fixture();
    const row = h.bundle(311, { kind: "failure", failureId: h.failure.failureId });
    const indexedElsewhere = {
      ...h.captures.authority,
      get: (id: string) => id === row.bundleId ? row : h.captures.authority.get(id),
      listByRun: (runId: string) => runId === h.run.envelope.runId
        ? []
        : h.captures.authority.listByRun(runId),
    };
    assert.throws(() => h.read(row.bundleId, indexedElsewhere), DiagnosticBundleCorruptError);

    h.f.database.authority.diagnosticBundles.insert(row);
    const substituted = { ...row, retention: { kind: "pinned" as const, reason: "fix" as const } };
    const disagreeing = {
      ...h.captures.authority,
      get: (id: string) => id === row.bundleId ? row : h.captures.authority.get(id),
      listByRun: (runId: string) => runId === h.run.envelope.runId
        ? [substituted]
        : h.captures.authority.listByRun(runId),
    };
    assert.throws(() => h.read(row.bundleId, disagreeing), DiagnosticBundleCorruptError);
  });
});
