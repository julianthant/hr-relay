import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { buildRerunPlan, previewRerunWarnings, RerunRefusedError } from "../../../../src/backend/runs/start/rerun.js";
import { readRerunValues } from "../../../../src/backend/runs/start/rerun-values.js";
import { planStart } from "../../../../src/backend/runs/start/plan.js";
import type { AuthorityRepositories } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { evidenceLeaves } from "../../../../src/models/trust/evidence-classification.js";
import { RunRecordSchema, type RunRecord } from "../../../../src/models/run/record.js";
import type { EvidenceSchemaReader } from "../../../../src/models/storage/evidence-schema-admission.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { RunCheckpointRecordSchema, type RunCheckpointRecord } from "../../../../src/models/workflow/checkpoint.js";
import { deriveIdempotencyKeyDigest, WriteIntentRecordSchema, type WriteIntentRecord } from "../../../../src/rules/write-safety/write-safety.js";
import { JsonValueSchema, type JsonValue } from "../../../../src/rules/validation/canonical-json.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { descriptorRuntimeNodes } from "../../../../src/workflow-kit/workflow.js";
import { kualiReceiptEvidence } from "../../../support/fixtures/receipt-run-fixtures.js";
import { HASH_A, NOW, UUID_4 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { sequentialIdFactory } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { PRE_INITIALS_CANONICAL_INPUT_HASH, preInitialsSeparationsRun } from "../../../support/fixtures/storage/pre-initials-separations.js";
import { FINALIZATION_SCOPE_OUTPUTS } from "../../../support/helpers/kuali-finalization-fixtures.js";
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

function hasOwnKey(value: unknown, key: string): boolean {
  return value !== null && typeof value === "object" && Object.hasOwn(value, key);
}

function repositoriesOf(source: Source): AuthorityRepositories {
  const intents: readonly WriteIntentRecord[] = [source.intent];
  return new Proxy(Object.create(null) as AuthorityRepositories, { get(_target, key) {
    switch (key) {
      case "deletedRuns": return { get: () => undefined };
      case "runs": return { get: () => source.run };
      case "writeIntents": return { listAttemptingByItem: () => [], listByRun: () => intents,
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

/** A fresh plan entry admitted from an account whose initials are not the letters of its name. */
function freshEntry() {
  const record = planStart({ authority: { authority: { runs: { listByItem: () => [] } } }, clock: manualClock(new Date(NOW)), ids: sequentialIdFactory(), planTtlMs: 600_000,
    protectedSecrets: protectedSecretSource({ profileName: "Lex Rivers", profileInitials: CURRENT_INITIALS }) },
  { descriptor, submissions: [{ documentNumber: COMPOSITION_DOCUMENT }], dryRun: true, priority: "bulk", shape: "single",
    configFingerprint: HASH_A, configSnapshotId: UUID_4, plannedBy: "local-operator" });
  assert.deepEqual(record.refused, []);
  const entry = record.planned[0];
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
    assert.equal(Reflect.get(Object(entry.input.value), "timekeeperInitials"), CURRENT_INITIALS);
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
});
