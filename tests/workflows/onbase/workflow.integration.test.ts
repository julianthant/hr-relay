import { onbaseImportDocumentModule, onbaseModule } from "../../support/helpers/registered-workflows.js";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { PDFDocument } from "@cantoo/pdf-lib";
import { afterEach, it } from "vitest";
import { createOperatorProjection } from "../../../src/backend/app/composition/dashboard/queue.js";
import { createOperatorRunDetail } from "../../../src/backend/app/composition/dashboard/run-detail.js";
import { deriveRunEvidenceReceipt } from "../../../src/backend/runs/provenance/evidence-receipt.js";
import { buildRunDetail } from "../../../src/backend/runs/queries/run-detail.js";
import { buildRunLogsWhole } from "../../../src/backend/runs/queries/run-logs.js";
import { planStart } from "../../../src/backend/runs/start/plan.js";
import { projectStartRows, projectStartSteps, resolveStartStepOmissions, startRowWire, StartStepOmissionRefusedError } from "../../../src/backend/runs/start/step-selection.js";
import { createOnbaseDriver } from "../../../src/backend/systems/onbase/driver/interpreter.js";
import { extractOnbasePage } from "../../../src/backend/systems/onbase/tasks/read-source-page.js";
import { createWriteSequencer } from "../../../src/backend/runtime/writes/write-sequencer.js";
import { createTransactionHistory } from "../../../src/backend/storage/sqlite/transaction-history.js";
import { projectRunLogs } from "../../../src/dashboard/state/run-wiring-adapter.js";
import { logPlainText } from "../../../src/dashboard/surfaces/run-detail/logs/log-feed-model.js";
import { handOffStepOmissions } from "../../../src/dashboard/surfaces/run-start/run-start-model.js";
import { startRowsOf } from "../../../src/dashboard/surfaces/run-start/run-steps-model.js";
import { ONBASE_EXAMPLE_INPUT, OnbaseInputSchema, OnbaseTargetSchema } from "../../../src/models/systems/onbase/import-document.js";
import { OnbaseCommitImport } from "../../../src/models/systems/onbase/upload-import.js";
import type { StepOmissions } from "../../../src/models/workflow/step-omission.js";
import { FingerprintSchema } from "../../../src/rules/identity/ids.js";
import type { AnyWorkflowDescriptor } from "../../../src/workflow-kit/workflow.js";
import { queuedRunFixture } from "../../support/fixtures/backend/queued-run.js";
import { canonicalChildExecution } from "../../support/helpers/backend/canonical-child-execution.js";
import { onbaseFilingFixture } from "../../support/helpers/backend/onbase-filing-fixture.js";
import { createRunExecutorTestWorld } from "../../support/helpers/backend/run-executor-world.js";
import { sessionFactoryHarness } from "../../support/helpers/phase1f-executor-harness.js";
import { fakeOnbasePage } from "../../support/helpers/browser/fake-onbase-page.js";
const world = createRunExecutorTestWorld();
afterEach(world.cleanup);
type StartSelection = Pick<Parameters<ReturnType<typeof canonicalChildExecution>["start"]>[2], "selectedStepKeys" | "stepOmissions">;

async function runOnbase(mode: "dry-run" | "committed" | "lost-acknowledgement", selection?: StartSelection | { internalOmissions: StepOmissions },
  descriptor: AnyWorkflowDescriptor = onbaseModule.descriptor) {
  const pdf = await PDFDocument.create({ updateMetadata: false }); pdf.addPage([100, 200]); pdf.addPage([300, 400]);
  const bytes = await pdf.save(), page = fakeOnbasePage({ lostClick: mode === "lost-acknowledgement" });
  const sessions = sessionFactoryHarness({ onbase: () => createOnbaseDriver(() => undefined, page.page, harness.authority.clock) });
  const harness = await world.executorHarness({ descriptor, sessions });
  const { database, clock, path, stateRoot } = harness.authority;
  const input = OnbaseInputSchema.parse({ ...ONBASE_EXAMPLE_INPUT, sourcePage: 2,
    document: { ...ONBASE_EXAMPLE_INPUT.document, sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length } });
  const dryRun = mode === "dry-run";
  const sequencer = createWriteSequencer({ lifecycle: harness.deps.lifecycle, stores: harness.deps.stores, authority: database, sessions: harness.manager,
    emitter: harness.emitter.emitter, clock, ids: harness.deps.ids, scheduler: harness.scheduler, taskDeadlineMs: 60000, operator: "local-operator", log: harness.deps.log });
  let sourceOpens = 0;
  const resolve = (id: string) => id === descriptor.id ? descriptor : undefined;
  const execution = canonicalChildExecution({ ...harness.deps, writeSequencer: sequencer, artifacts: {
    open: async () => { sourceOpens++; return Readable.from([bytes]); },
    put: async () => { throw new Error("unexpected artifact write"); },
  } }, database, path, resolve);
  // Dashboard Start requires a running step. Exercise both omissions together at the executor's queued-run boundary.
  const queued = selection !== undefined && "internalOmissions" in selection ? (() => {
    const config = database.authority.runtimeConfig.get();
    assert.ok(config);
    const stepOmissions = selection.internalOmissions;
    const plan = planStart({ authority: database, clock, ids: harness.deps.ids, planTtlMs: 600_000 }, { descriptor, submissions: [input], dryRun,
      priority: "bulk", shape: "operation-member", plannedBy: "local-operator", configFingerprint: config.configFingerprint,
      configSnapshotId: config.configSnapshotId, stepOmissions });
    assert.deepEqual(plan.refused, []);
    const entry = plan.planned[0];
    assert.ok(entry);
    const run = queuedRunFixture({ descriptor, runId: harness.deps.ids.uuid(), itemId: entry.itemId, traceId: "ob-090000-2222",
      rawInput: entry.rawInput, canonicalInput: entry.input, ingressSchemaHash: plan.ingressSchemaHash, configFingerprint: plan.configFingerprint,
      configSnapshotId: plan.configSnapshotId, resolvedInstance: plan.resolvedInstance, shape: plan.shape, priority: plan.priority, dryRun,
      attempt: 1, runNumber: 1, appVersion: "0.1.0", now: clock.now().toISOString(), stepOmissions });
    database.authority.runs.enqueue(run);
    return run;
  })() : execution.start(descriptor, input, { dryRun, ...selection });
  const { run, outcomes } = await execution.execute(queued, world.SIGNAL);
  const result = outcomes[0];
  assert.ok(result);
  const runId = queued.envelope.runId;
  const failures = database.authority.failures.listByRun(runId);
  assert.equal(result.state, mode === "lost-acknowledgement" ? "parked-write" : "done", JSON.stringify(failures.map(failure => failure.summary)));
  const manualImport = queued.envelope.stepOmissions?.some(({ step }) => step === "import-document") === true;
  assert.equal(page.actions.filter(action => action === "click:Import").length, dryRun || manualImport ? 0 : 1);
  const intents = database.authority.writeIntents.listByRun(runId);
  const stored = database.authority.runResults.get(runId);
  if (dryRun) assert.deepEqual(database.authority.writeIntents.countDryRunEvidenceByRun(runId), { writeIntents: 0, writeAttempts: 0, confirmedOperations: 0 });
  if (mode === "lost-acknowledgement") assert.equal(intents[0]?.status, "parked");
  if (mode === "committed") assert.ok(stored);
  return { run, runId, intents, stored, sourceOpens, actions: page.actions, database, clock, stateRoot, resolve, reader: execution.lifecycle };
}

function omittedReceipt(descriptor: AnyWorkflowDescriptor, fixture: Awaited<ReturnType<typeof runOnbase>>) {
  const { run, stored, database } = fixture;
  assert.ok(run?.lifecycle.state === "terminal" && run.lifecycle.outcome === "done");
  assert.ok(stored);
  const { receipt } = deriveRunEvidenceReceipt({ descriptor, run, result: stored,
    checkpoints: database.authority.runCheckpoints.listByItem(descriptor.id, run.envelope.itemId) });
  assert.equal(receipt.result, "partial");
  assert.equal(receipt.output.length, 1);
  const [disposition] = receipt.output;
  assert.ok(disposition?.state === "satisfied");
  assert.equal(disposition.field, "disposition");
  assert.deepEqual(disposition.value, { key: "disposition", state: "allowed", classification: "safe-diagnostic", transform: "allow", value: "omitted" });
  return receipt;
}

it("onbase/dry-run — runs the registered child through the real executor and stops after preparation", () => runOnbase("dry-run"));
it("onbase/committed — runs one import through the real executor and sequencer with a durable result", () => runOnbase("committed"));
it("onbase/unknown — parks a lost Import acknowledgement without another click", () => runOnbase("lost-acknowledgement"));

it("records an import done outside Relay without preparing it or creating a write intent", async () => {
  const fixture = await runOnbase("committed", {
    selectedStepKeys: ["source-page"], stepOmissions: [{ step: "import-document", facts: {} }],
  });
  const { run, runId, intents, stored, sourceOpens, actions, database, clock, stateRoot, resolve, reader } = fixture;
  assert.equal(sourceOpens, 1);
  assert.deepEqual(actions, []);
  assert.deepEqual(intents, []);
  assert.deepEqual(stored?.result.value, { disposition: "omitted" });
  omittedReceipt(onbaseModule.descriptor, fixture);

  assert.ok(run);
  const descriptors = { resolve };
  const projection = createOperatorProjection({ database, stateRoot, clock, reader, appVersion: "0.1.0",
    descriptorSetHash: FingerprintSchema.parse("a".repeat(64)), ledger: createTransactionHistory(database.authority), descriptors });
  projection.ingestFromTimeline();
  const deps = createOperatorRunDetail({ database, stateRoot, projection, runReader: reader, canonical: { database, reader, descriptors } });
  const detail = buildRunDetail(deps, runId);
  const section = buildRunLogsWhole(deps, runId, projection.runFold(runId), run);
  const projected = projectRunLogs({ detail, logs: section.payload, sections: [], unavailableEvidence: [] }, { artifactUrl: () => "unused" });
  const imported = projected.steps.find(step => step.title === "Import Emergency Contact");
  assert.ok(imported);
  assert.match(logPlainText([imported]), /Done outside Relay/u);
});

it("classifies an omitted import in the retained import proof's receipt", async () => {
  const { descriptor } = onbaseImportDocumentModule;
  const fixture = await runOnbase("committed", {
    selectedStepKeys: ["source-page"], stepOmissions: [{ step: "import-document", facts: {} }],
  }, descriptor);
  omittedReceipt(descriptor, fixture);
});

it("derives a receipt for the skipped source page and import without exposing the manual page value", async () => {
  const { descriptor } = onbaseModule;
  const manualPage = 456789;
  const internalOmissions = resolveStartStepOmissions(descriptor, [], [
    { step: "source-page", facts: { sourcePage: manualPage } }, { step: "import-document", facts: {} },
  ]);
  assert.ok(internalOmissions);
  const fixture = await runOnbase("committed", { internalOmissions });
  assert.equal(fixture.sourceOpens, 0);
  assert.deepEqual(fixture.actions, []);
  assert.deepEqual(fixture.intents, []);
  const receipt = omittedReceipt(descriptor, fixture);
  const warning = receipt.warnings.find(({ code }) => code === "OPERATOR_OMITTED_STEP");
  assert.match(warning?.summary ?? "", /import-document, source-page/u);
  assert.deepEqual(receipt.actions, []);
  assert.equal(JSON.stringify(receipt).includes(`"value":${manualPage}`), false);
});

it("requires a typed PDF page and an explicit import omission when source preparation is off", () => {
  const { descriptor } = onbaseModule;
  const rows = projectStartRows(descriptor);
  const steps = projectStartSteps(descriptor);
  assert.deepEqual(rows.map(({ key, kind, off, lockReason, manual }) => [key, kind, off, lockReason, manual?.form.fields, manual?.forces]), [
    ["source-page", "switch", "values", undefined, [{ key: "sourcePage", label: "PDF page", kind: "integer", min: 1 }], ["import-document"]],
    ["import-document", "switch", "manual", undefined, [], []],
  ]);
  assert.equal(startRowsOf({ steps, rows: rows.map(startRowWire) }).find(({ key }) => key === "source-page")?.note, "Also skips: Import Emergency Contact");
  assert.deepEqual([...handOffStepOmissions(steps, ["import-document"])], [["import-document", ["source-page"]]]);
  assert.throws(() => resolveStartStepOmissions(descriptor, ["import-document"], [{ step: "source-page", facts: { sourcePage: 2 } }]),
    (error: unknown) => error instanceof StartStepOmissionRefusedError && error.code === "cascade-refused");
  assert.throws(() => resolveStartStepOmissions(descriptor, [], [{ step: "source-page", facts: { sourcePage: 0 } }, { step: "import-document", facts: {} }]),
    (error: unknown) => error instanceof StartStepOmissionRefusedError && error.code === "facts-invalid");
  assert.deepEqual(resolveStartStepOmissions(descriptor, [], [{ step: "source-page", facts: { sourcePage: 2 } }, { step: "import-document", facts: {} }]), [
    { step: "source-page", facts: { sourcePage: 2 }, labels: { sourcePage: "PDF page" } },
    { step: "import-document", facts: {}, labels: {} },
  ]);
});

it("keeps the permanent import key when the selected source page is serialized differently", async () => {
  const { bytes, document } = await onbaseFilingFixture();
  const sourcePage = 2;
  const extracted = await extractOnbasePage(bytes, sourcePage);
  const loaded = await PDFDocument.load(extracted, { updateMetadata: false });
  const reserialized = await loaded.save({ useObjectStreams: true });
  const [original, regenerated] = [extracted, reserialized].map(page => OnbaseTargetSchema.parse({
    ...ONBASE_EXAMPLE_INPUT, document, sourcePage, pageSha256: createHash("sha256").update(page).digest("hex"),
  }));
  assert.ok(original && regenerated);
  assert.notEqual(original.pageSha256, regenerated.pageSha256);
  const { key } = OnbaseCommitImport.writeSafety.idempotency;
  assert.equal(key(original), key(regenerated));
});
