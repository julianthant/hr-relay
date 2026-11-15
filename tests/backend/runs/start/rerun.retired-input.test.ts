import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { z } from "zod";
import { createCommandKernel } from "../../../../src/backend/runs/commands/command-kernel.js";
import type { CreateRunRequest, RunRecordService } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { buildRerunPlan, previewRerunWarnings, RerunRefusedError } from "../../../../src/backend/runs/start/rerun.js";
import { readRerunValues } from "../../../../src/backend/runs/start/rerun-values.js";
import { planStart } from "../../../../src/backend/runs/start/plan.js";
import type { AuthorityRepositories } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { evidenceLeaves } from "../../../../src/models/trust/evidence-classification.js";
import { RunRecordSchema, type RunRecord } from "../../../../src/models/run/record.js";
import { derivePlannedInputFingerprint, StartPlanRecordSchema } from "../../../../src/models/run/start-plan.js";
import { StartCommandRequestSchema } from "../../../../src/rules/commands/commands.js";
import type { EvidenceSchemaReader } from "../../../../src/models/storage/evidence-schema-admission.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { KualiFinalizationTargetSchema, KualiSavedFinalizationProofSchema, kualiFinalizationFields } from "../../../../src/models/ui/kuali-separation-finalization.js";
import { RunCheckpointRecordSchema, type RunCheckpointRecord } from "../../../../src/models/workflow/checkpoint.js";
import { deriveIdempotencyKeyDigest, deriveWriteBindingProofDigest, WriteIntentRecordSchema, type WriteIntentRecord } from "../../../../src/rules/write-safety/write-safety.js";
import { TransactionOutcomeSchema } from "../../../../src/rules/write-safety/write-safety-primitives.js";
import { JsonValueSchema, type JsonValue } from "../../../../src/rules/validation/canonical-json.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { descriptorRuntimeNodes } from "../../../../src/workflow-kit/workflow.js";
import { kualiReceiptEvidence } from "../../../support/fixtures/receipt-run-fixtures.js";
import { HASH_A, NOW, UUID_4 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { sequentialIdFactory } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { PRE_INITIALS_CANONICAL_INPUT_HASH, PRE_INITIALS_TIMEKEEPER_INITIALS, preInitialsSeparationsRun, preInitialsSignedComment } from "../../../support/fixtures/storage/pre-initials-separations.js";
import { FINALIZATION_SCOPE_OUTPUTS } from "../../../support/helpers/kuali-finalization-fixtures.js";
import { NO_INTAKE_PROJECTIONS, UNWIRED_INTAKE_PARSER } from "../../../support/fixtures/intake-kernel-seams.js";
import { unusedWorkerPool } from "../../../support/helpers/backend/unused-worker-pool.js";
import { protectedSecretSource } from "../../../support/helpers/protected-secret-source.js";
import { separationsDescriptor as descriptor } from "../../../support/helpers/registered-workflows.js";
import { COMPOSITION_DOCUMENT, COMPOSITION_SCOPE_OUTPUTS, FINALIZATION_IDEMPOTENCY_KEY, FINALIZE_NODE,
  compositionQueuedRun } from "../../../support/helpers/separations-composition-fixtures.js";

const CURRENT_INITIALS = "QZ";
const OLD_CONTRACT_FINGERPRINT = "d".repeat(64);

function merge(example: JsonValue, value: JsonValue): JsonValue {
  if (example === null || value === null || typeof example !== "object" || typeof value !== "object" || Array.isArray(example) || Array.isArray(value)) return value;
  const result: Record<string, JsonValue> = Object.fromEntries(Object.entries(example));
  for (const [key, child] of Object.entries(value)) result[key] = result[key] === undefined ? child : merge(result[key], child);
  return result;
}

/** A terminal Separations run whose Kuali finalization committed, as the current build stores it. */
function currentSource() {
  const evidence = kualiReceiptEvidence(), stored = RunRecordSchema.parse(evidence.run), queued = RunRecordSchema.parse(compositionQueuedRun());
  const run = RunRecordSchema.parse({ ...stored, input: queued.input,
    envelope: { ...stored.envelope, workflow: descriptor.id, descriptorVersion: descriptor.version, contractFingerprint: descriptor.contractFingerprint } });
  const finalize = descriptorRuntimeNodes(descriptor).find(node => node.id === FINALIZE_NODE);
  assert.ok(finalize?.kind === "transaction");
  const checkpoints: RunCheckpointRecord[] = [];
  for (const id of finalize.dependsOn) {
    const node = descriptorRuntimeNodes(descriptor).find(candidate => candidate.id === id);
    assert.ok(node?.kind === "task");
    const override: unknown = id === "approval" ? { ...COMPOSITION_SCOPE_OUTPUTS.approval, jobs: FINALIZATION_SCOPE_OUTPUTS.approval.jobs } : Reflect.get(COMPOSITION_SCOPE_OUTPUTS, id);
    const value = JsonValueSchema.parse(node.uses.output.parse(merge(JsonValueSchema.parse(node.uses.example), JsonValueSchema.parse(override))));
    checkpoints.push(RunCheckpointRecordSchema.parse({ workflowId: descriptor.id, runId: run.envelope.runId, itemId: run.envelope.itemId, nodeId: id,
      attempt: 1, claimGeneration: 1, descriptorVersion: descriptor.version, contractFingerprint: descriptor.contractFingerprint, implFingerprint: "c".repeat(64),
      output: { schemaHash: deriveSchemaHash(node.uses.output, "output"), value }, writtenAt: run.createdAt,
      provenance: evidenceLeaves(value).map(({ path }) => ({ path, source: "live", observedAt: run.createdAt, originalObservedAt: run.createdAt })) }));
  }
  const transaction = evidence.checkpoints.map(value => RunCheckpointRecordSchema.parse(value)).find(checkpoint => checkpoint.nodeId === FINALIZE_NODE);
  const recorded = evidence.writes[0]?.intent;
  assert.ok(transaction && recorded?.status === "committed");
  checkpoints.push(RunCheckpointRecordSchema.parse({ ...transaction, workflowId: descriptor.id, contractFingerprint: descriptor.contractFingerprint }));
  const intent = WriteIntentRecordSchema.parse({ ...recorded, workflowId: descriptor.id, idempotencyKey: FINALIZATION_IDEMPOTENCY_KEY,
    idempotencyKeyDigest: deriveIdempotencyKeyDigest("kuali", FINALIZATION_IDEMPOTENCY_KEY) });
  return { run, checkpoints, intent };
}

type Source = ReturnType<typeof currentSource>;

/** The same run as the last pre-initials build stored it: its pinned hash, no initials, and the contract it was written under. */
function retainedAsPreInitials(source: Source): Source {
  const run = RunRecordSchema.parse({ ...preInitialsSeparationsRun(source.run, "pre-initials"),
    envelope: { ...source.run.envelope, contractFingerprint: OLD_CONTRACT_FINGERPRINT } });
  return { ...source, run, checkpoints: source.checkpoints.map(checkpoint => RunCheckpointRecordSchema.parse({ ...checkpoint, contractFingerprint: OLD_CONTRACT_FINGERPRINT })) };
}

const COMMENT_LIMIT = 4000;

/** The old build's own history at the comment limit: existing Kuali text long enough that its "-DT" filing comment is exactly 4000 characters. */
function signedAtCommentLimit(source: Source): Source {
  const finalize = descriptorRuntimeNodes(descriptor).find(node => node.id === FINALIZE_NODE);
  assert.ok(finalize?.kind === "transaction");
  const run = RunRecordSchema.parse({ ...source.run, input: { ...source.run.input, parsed: { ...source.run.input.parsed,
    value: { ...z.record(z.string(), z.unknown()).parse(source.run.input.parsed.value), timekeeperInitials: PRE_INITIALS_TIMEKEEPER_INITIALS } } } });
  const outputs = (points: readonly RunCheckpointRecord[]) => Object.fromEntries(points.filter(point => point.nodeId !== FINALIZE_NODE).map(point => [point.nodeId, point.output.value]));
  const commentOf = (points: readonly RunCheckpointRecord[]) => KualiFinalizationTargetSchema.parse(finalize.commit.bind({ input: run.input.parsed.value, outputs: outputs(points) }));
  const rewrite = (points: readonly RunCheckpointRecord[], nodeId: string, change: (value: Record<string, unknown>) => unknown) => points.map(point => {
    if (point.nodeId !== nodeId) return point;
    const node = descriptorRuntimeNodes(descriptor).find(candidate => candidate.id === nodeId);
    assert.ok(node?.kind === "task");
    const value = JsonValueSchema.parse(node.uses.output.parse(change(z.record(z.string(), z.unknown()).parse(point.output.value))));
    return RunCheckpointRecordSchema.parse({ ...point, output: { ...point.output, value },
      provenance: evidenceLeaves(value).map(({ path }) => ({ path, source: "live", observedAt: point.writtenAt, originalObservedAt: point.writtenAt })) });
  });
  const signed = rewrite(source.checkpoints, "dates", dates => ({ ...dates, dateChangeComments: preInitialsSignedComment(z.string().parse(dates.dateChangeComments)) }));
  const padding = "A".repeat(COMMENT_LIMIT - commentOf(signed).variables.timekeeperComments.length - 1);
  const padded = rewrite(signed, "document", document => {
    const timekeeper = z.record(z.string(), z.unknown()).parse(document.timekeeper);
    return { ...document, timekeeper: { ...timekeeper, comments: { state: "present", value: padding } } };
  });
  const target = commentOf(padded);
  assert.equal(target.variables.timekeeperComments.length, COMMENT_LIMIT);
  assert.match(target.variables.timekeeperComments, new RegExp(`-${PRE_INITIALS_TIMEKEEPER_INITIALS} `, "u"));
  const recorded = source.intent;
  assert.ok(recorded.status === "committed");
  const proof = KualiSavedFinalizationProofSchema.parse({ ...z.record(z.string(), z.unknown()).parse(recorded.completionProof.value), actionId: target.actionId,
    documentNumber: target.documentNumber, observedEid: target.emplId, fields: kualiFinalizationFields(target.variables) });
  const intent = WriteIntentRecordSchema.parse({ ...recorded, completionProof: { ...recorded.completionProof, value: proof } });
  const checkpoints = padded.map(point => {
    if (point.nodeId !== FINALIZE_NODE) return point;
    const committed = TransactionOutcomeSchema.parse(point.output.value);
    assert.ok(committed.disposition === "committed");
    const value = JsonValueSchema.parse(TransactionOutcomeSchema.parse({ ...committed, proof: { ...committed.proof, value: proof }, output: { ...committed.output, value: { savedState: proof } } }));
    return RunCheckpointRecordSchema.parse({ ...point, output: { ...point.output, value },
      provenance: evidenceLeaves(value).map(({ path }) => ({ path, source: "live", observedAt: point.writtenAt, originalObservedAt: point.writtenAt })) });
  });
  return { run, checkpoints, intent };
}

/** The checkpoint settled already-present from a durable write another run committed. */
function inheritedFromForeignRun(source: Source): Source {
  assert.ok(source.intent.status === "committed");
  const bindingProof = { ...source.intent.bindingProof, runId: "88888888-8888-4888-8888-888888888888", afterPrepareSpanPath: "foreign-trace/finalize-kuali/prepare" };
  const intent = WriteIntentRecordSchema.parse({ ...source.intent, runId: bindingProof.runId, bindingProof, bindingProofDigest: deriveWriteBindingProofDigest(bindingProof) });
  return { ...source, intent, checkpoints: source.checkpoints.map(checkpoint => checkpoint.nodeId !== FINALIZE_NODE ? checkpoint : alreadyPresent(checkpoint, "durable-intent")) };
}

/** The checkpoint settled already-present from a live probe, whose observed-present intent belongs to no run. */
function observedByLiveProbe(source: Source): Source {
  const recorded = source.intent;
  assert.ok(recorded.status === "committed");
  const intent = WriteIntentRecordSchema.parse({ writeIntentId: recorded.writeIntentId, workflowId: recorded.workflowId, itemId: recorded.itemId, taskId: recorded.taskId,
    system: recorded.system, idempotencyKey: recorded.idempotencyKey, idempotencyKeyDigest: recorded.idempotencyKeyDigest, generation: recorded.generation,
    status: "observed-present", observedProof: recorded.completionProof, observedAt: recorded.confirmedAt, version: recorded.version,
    createdAt: recorded.createdAt, updatedAt: recorded.updatedAt });
  return { ...source, intent, checkpoints: source.checkpoints.map(checkpoint => checkpoint.nodeId !== FINALIZE_NODE ? checkpoint : alreadyPresent(checkpoint, "live-probe")) };
}

function alreadyPresent(checkpoint: RunCheckpointRecord, proofSource: "durable-intent" | "live-probe"): RunCheckpointRecord {
  const committed = TransactionOutcomeSchema.parse(checkpoint.output.value);
  assert.ok(committed.disposition === "committed");
  const outcome = TransactionOutcomeSchema.parse({ disposition: "already-present", proofSource, proof: committed.proof, output: committed.output, observedAt: committed.confirmedAt });
  const value = JsonValueSchema.parse(outcome);
  return RunCheckpointRecordSchema.parse({ ...checkpoint, output: { ...checkpoint.output, value },
    provenance: evidenceLeaves(value).map(({ path }) => ({ path, source: "live", observedAt: checkpoint.writtenAt, originalObservedAt: checkpoint.writtenAt })) });
}

function hasOwnKey(value: unknown, key: string): boolean {
  return value !== null && typeof value === "object" && Object.hasOwn(value, key);
}

function repositoriesOf(source: Source, start: Readonly<Record<string, unknown>> = {}): AuthorityRepositories {
  const intents: readonly WriteIntentRecord[] = [source.intent];
  return new Proxy(Object.create(null) as AuthorityRepositories, { get(_target, key) {
    if (typeof key === "string" && Object.hasOwn(start, key)) return start[key];
    switch (key) {
      case "deletedRuns": return { get: () => undefined };
      case "runs": return { get: () => source.run };
      // As production: a run lists only the intents it owns; a live-probe observation owns none.
      case "writeIntents": return { listAttemptingByItem: () => [],
        listByRun: (runId: unknown) => intents.filter(intent => "runId" in intent && intent.runId === runId),
        listByBusinessKey: (system: unknown, digest: unknown) => intents.filter(intent => intent.system === system && intent.idempotencyKeyDigest === digest) };
      case "runCheckpoints": return { listByItem: () => source.checkpoints };
      case "gateResults": return { listByRun: () => [] };
      case "failures": return { listByRun: () => [] };
      default: throw new Error(`unexpected authority access: ${String(key)}`);
    }
  } });
}

/** What production answers for a retired owner: the stored hash, unchanged. */
const retiredReader: EvidenceSchemaReader = (_owner, _source, stored) => stored;

function sourceOf(run: RunRecord) {
  return { runId: run.envelope.runId, expectedVersion: run.version, intent: "rerun" as const, selectedStepKeys: descriptor.timeline.map(step => step.key) };
}

/** A fresh plan admitted from an account whose initials are not the letters of its name. */
function freshPlan() {
  const record = planStart({ authority: { authority: { runs: { listByItem: () => [] } } }, clock: manualClock(new Date(NOW)), ids: sequentialIdFactory(), planTtlMs: 600_000,
    protectedSecrets: protectedSecretSource({ profileName: "Lex Rivers", profileInitials: CURRENT_INITIALS }) },
  { descriptor, submissions: [{ documentNumber: COMPOSITION_DOCUMENT }], dryRun: true, priority: "bulk", shape: "single",
    configFingerprint: HASH_A, configSnapshotId: UUID_4, plannedBy: "local-operator" });
  assert.deepEqual(record.refused, []);
  return record;
}

function freshEntry() {
  const entry = freshPlan().planned[0];
  assert.ok(entry);
  return entry;
}

const refusedAs = (code: string, message: string) => (error: unknown) => error instanceof RerunRefusedError && error.code === code && error.message === message;

describe("Rerun of a retained pre-initials Separations run with a completed Kuali transaction", () => {
  it("control: the current-shape run warns once, naming the committed write", () => {
    const source = currentSource();
    assert.equal(hasOwnKey(source.run.input.parsed.value, "timekeeperInitials"), true);
    const preview = previewRerunWarnings(repositoriesOf(source), descriptor, sourceOf(source.run));
    assert.deepEqual(preview.warnings.map(warning => warning.writeIntentId), [source.intent.writeIntentId]);
  });

  it("previews the same warnings and digest from the retired input as from the current shape", () => {
    const current = currentSource(), retained = retainedAsPreInitials(current);
    assert.equal(retained.run.input.parsed.schemaHash, PRE_INITIALS_CANONICAL_INPUT_HASH);
    assert.equal(hasOwnKey(retained.run.input.parsed.value, "timekeeperInitials"), false);
    const control = previewRerunWarnings(repositoriesOf(current), descriptor, sourceOf(current.run));
    const preview = previewRerunWarnings(repositoriesOf(retained), descriptor, sourceOf(retained.run), retiredReader);
    assert.deepEqual(preview.warnings, control.warnings);
    assert.equal(preview.warningDigest, control.warningDigest);
  });

  it("plans a fresh entry with the current account's initials under the retired source's warnings", () => {
    const retained = retainedAsPreInitials(currentSource()), entry = freshEntry();
    assert.notEqual(CURRENT_INITIALS, "LR");
    const preview = previewRerunWarnings(repositoriesOf(retained), descriptor, sourceOf(retained.run), retiredReader);
    const plan = buildRerunPlan(repositoriesOf(retained), descriptor, sourceOf(retained.run), [entry], preview.warningDigest, undefined, retiredReader);
    assert.deepEqual(plan.warnings, preview.warnings);
    assert.equal(plan.warningDigest, preview.warningDigest);
    assert.equal(plan.acknowledgment, preview.warningDigest);
    assert.equal(z.record(z.string(), z.unknown()).parse(entry.input.value).timekeeperInitials, CURRENT_INITIALS);
    assert.equal(hasOwnKey(retained.run.input.parsed.value, "timekeeperInitials"), false);
  });

  it("reads the retired source's transaction evidence for the Rerun values", () => {
    const retained = retainedAsPreInitials(currentSource());
    const response = readRerunValues({ database: { authority: repositoriesOf(retained), withAuthorityReadSnapshot: work => work(), evidenceSchemaHash: retiredReader },
      reader: { read: () => ({ state: "present", disposition: "live", run: retained.run }) }, descriptors: { resolve: () => descriptor } },
    { runId: retained.run.envelope.runId, expectedVersion: retained.run.version });
    assert.equal(response.state, "available");
    if (response.state !== "available") return;
    assert.deepEqual(response.snapshot.transactions.map(transaction => transaction.writeIntentId), [retained.intent.writeIntentId]);
  });

  it("still refuses an input hash no retirement lists", () => {
    const retained = retainedAsPreInitials(currentSource());
    const run = RunRecordSchema.parse({ ...retained.run, input: { ...retained.run.input, parsed: { ...retained.run.input.parsed, schemaHash: "e".repeat(64) } } });
    assert.throws(() => previewRerunWarnings(repositoriesOf({ ...retained, run }), descriptor, sourceOf(run), retiredReader),
      refusedAs("schema-mismatch", "Rerun transaction source input is invalid"));
  });

  it("refuses when the retirement reader rejects the stored input", () => {
    const retained = retainedAsPreInitials(currentSource());
    const tampered: EvidenceSchemaReader = () => { throw new Error("retirement-seal-invalid"); };
    assert.throws(() => previewRerunWarnings(repositoriesOf(retained), descriptor, sourceOf(retained.run), tampered), error => error instanceof RerunRefusedError && error.code === "schema-mismatch");
    assert.throws(() => previewRerunWarnings(repositoriesOf(retained), descriptor, sourceOf(retained.run)), error => error instanceof RerunRefusedError && error.code === "schema-mismatch");
  });
  it("starts the acknowledged Rerun plan of a retired source, revalidating it with the evidence reader", async () => {
    const retained = retainedAsPreInitials(currentSource()), fresh = freshPlan(), source = sourceOf(retained.run);
    let readerCalls = 0;
    const reader: EvidenceSchemaReader = (...args) => { readerCalls += 1; return retiredReader(...args); };
    const rerun = buildRerunPlan(repositoriesOf(retained), descriptor, source, fresh.planned, previewRerunWarnings(repositoriesOf(retained), descriptor, source, reader).warningDigest, undefined, reader);
    const plan = StartPlanRecordSchema.parse({ ...fresh, rerun,
      inputFingerprint: derivePlannedInputFingerprint(fresh.planned, fresh.ingressSchemaHash, fresh.canonicalInputSchemaHash, rerun, fresh.stepOmissions) });
    const created: CreateRunRequest[] = [], consumed: unknown[] = [];
    const runtimeConfig = { generation: 1, settingsRevision: 1, settingsFingerprint: HASH_A, configFingerprint: plan.configFingerprint, configSnapshotId: plan.configSnapshotId };
    let journaled: unknown, run: RunRecord | undefined;
    const startRepositories = repositoriesOf(retained, {
      runs: { get: (runId: unknown) => runId === run?.envelope.runId ? run : retained.run, listByItem: () => [], admission: () => ({ state: "open" }) },
      workbooks: new Proxy({}, { get: (_target, key) => { throw new Error(`unexpected workbook access: ${String(key)}`); } }),
      startPlans: { get: () => plan, consume: (request: unknown) => { consumed.push(request); return { state: "consumed", plan: { ...plan, version: plan.version + 1 } }; } },
      runtimeConfig: { get: () => runtimeConfig, requireSettingsCurrent: () => {} },
      configSnapshots: { get: () => ({ configSnapshotId: plan.configSnapshotId, fingerprint: plan.configFingerprint }) },
      runSessions: { insert: () => ({ state: "inserted" }) },
      commands: { assertIdentity: () => {}, insert: (request: unknown) => { journaled = request; }, get: () => journaled },
      commandAudits: { findByCommand: () => undefined, insert: () => {} },
    });
    const lifecycle = new Proxy(Object.create(null) as RunRecordService, { get(_target, key) {
      if (key === "create") return (request: CreateRunRequest) => {
        created.push(request);
        run = RunRecordSchema.parse({ ...retained.run, envelope: { ...retained.run.envelope, runId: "77777777-7777-4777-8777-777777777777" } });
        return { state: "applied", run };
      };
      if (key === "continueDelegations") return () => [];
      throw new Error(`unexpected lifecycle access: ${String(key)}`);
    } });
    const unexpected = (): never => { throw new Error("unexpected external effect"); };
    const kernel = createCommandKernel({ authority: { withAuthorityTransaction: work => work(startRepositories), evidenceSchemaHash: reader },
      lifecycle, clock: manualClock(new Date(NOW)), ids: sequentialIdFactory("f"), appVersion: "0.1.0", descriptors: { resolve: () => descriptor },
      configIdentity: { configFingerprint: plan.configFingerprint, configSnapshotId: plan.configSnapshotId },
      intakeParser: UNWIRED_INTAKE_PARSER, intakeProjections: NO_INTAKE_PROJECTIONS,
      writeResolution: { recheck: unexpected, resolveAbsent: unexpected }, workerRuntime: { pool: unusedWorkerPool(unexpected) } });
    readerCalls = 0;
    const result = await kernel.executeStart(StartCommandRequestSchema.parse({ commandId: "99999999-9999-4999-8999-999999999999", requestedAt: NOW,
      requestedBy: "local-operator", source: "dashboard", family: "start", type: "start-run",
      target: { workflowId: descriptor.id, startPlanId: plan.startPlanId, expectedVersion: plan.version },
      payload: { descriptorFingerprint: plan.descriptorFingerprint, configFingerprint: plan.configFingerprint, ingressSchemaHash: plan.ingressSchemaHash,
        canonicalInputSchemaHash: plan.canonicalInputSchemaHash, inputFingerprint: plan.inputFingerprint } }));
    assert.equal(result.state, "applied", JSON.stringify(result));
    assert.ok(readerCalls > 0);
    assert.equal(consumed.length, 1);
    assert.equal(created.length, 1);
    assert.equal(z.record(z.string(), z.unknown()).parse(created[0]?.input.parsed.value).timekeeperInitials, CURRENT_INITIALS);
    assert.equal(created[0]?.sourceBound?.warningDigest, rerun.warningDigest);
  });
  it("previews and reads the Rerun values of a retired source whose signed comment is at the 4000-character limit", () => {
    const current = signedAtCommentLimit(currentSource()), retained = retainedAsPreInitials(current);
    const control = previewRerunWarnings(repositoriesOf(current), descriptor, sourceOf(current.run), retiredReader);
    assert.deepEqual(control.warnings.map(warning => warning.writeIntentId), [current.intent.writeIntentId]);
    const preview = previewRerunWarnings(repositoriesOf(retained), descriptor, sourceOf(retained.run), retiredReader);
    assert.deepEqual(preview.warnings, control.warnings);
    assert.equal(preview.warningDigest, control.warningDigest);
    const response = readRerunValues({ database: { authority: repositoriesOf(retained), withAuthorityReadSnapshot: work => work(), evidenceSchemaHash: retiredReader },
      reader: { read: () => ({ state: "present", disposition: "live", run: retained.run }) }, descriptors: { resolve: () => descriptor } },
    { runId: retained.run.envelope.runId, expectedVersion: retained.run.version });
    assert.equal(response.state, "available");
    if (response.state !== "available") return;
    assert.deepEqual(response.snapshot.transactions.map(transaction => transaction.writeIntentId), [current.intent.writeIntentId]);
  });
  for (const [label, history] of [["a durable write another run committed", inheritedFromForeignRun], ["a live-probe observation owned by no run", observedByLiveProbe]] as const) {
    it(`previews the same warnings for an already-present step settled from ${label}`, () => {
      const current = history(currentSource()), retained = retainedAsPreInitials(current);
      const control = previewRerunWarnings(repositoriesOf(current), descriptor, sourceOf(current.run));
      assert.deepEqual(control.warnings.map(warning => warning.writeIntentId), [current.intent.writeIntentId]);
      const preview = previewRerunWarnings(repositoriesOf(retained), descriptor, sourceOf(retained.run), retiredReader);
      assert.deepEqual(preview.warnings, control.warnings);
      assert.equal(preview.warningDigest, control.warningDigest);
    });

    it(`reads the Rerun values for an already-present step settled from ${label}`, () => {
      const retained = retainedAsPreInitials(history(currentSource()));
      const response = readRerunValues({ database: { authority: repositoriesOf(retained), withAuthorityReadSnapshot: work => work(), evidenceSchemaHash: retiredReader },
        reader: { read: () => ({ state: "present", disposition: "live", run: retained.run }) }, descriptors: { resolve: () => descriptor } },
      { runId: retained.run.envelope.runId, expectedVersion: retained.run.version });
      assert.equal(response.state, "available");
      if (response.state !== "available") return;
      assert.deepEqual(response.snapshot.transactions.map(transaction => transaction.writeIntentId), [retained.intent.writeIntentId]);
    });
  }
});
