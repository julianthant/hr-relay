import { retainedRunProtectedBindings, publicTransactionKeyDigest } from "../../../models/write-safety/protected-input.js";
import { valueFreeProtectedInput } from "../../../models/write-safety/protected-input.js";

import { z } from "zod";
import { evaluateNodeCondition } from "../../../models/workflow/node-condition.js";
import {
  idempotencyKeyDigestReference,
} from "../../../rules/redaction/redaction.js";
import {
  descriptorRuntimeNodes,
  workflowTerminalResultExecution,
  type AnyWorkflowDescriptor,
} from "../../../workflow-kit/workflow.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import {
  ErrorCodeSchema,
  FingerprintSchema,
  type EvidenceEntryId,
} from "../../../rules/identity/ids.js";
import { RunRecordSchema, type RunRecord } from "../../../models/run/record.js";
import {
  RunDryRunPreviewResultSchema,
  RunResultRecordSchema,
  terminalEvidenceResult,
  deriveTerminalFailureDigest,
  deriveCheckpointOutputDigest,
  deriveTerminalDependencyDigest,
  type RunResultRecord,
  type TerminalNotRunReason,
} from "../../../models/run/result.js";
import { SchemaBoundCanonicalValueSchema, deriveSchemaHash } from "../../../models/validation/schema-bound-value.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import {
  evidenceLeaves,
  redactEvidenceLeaf,
  type EvidenceLeaf,
  type EvidenceValueScope,
} from "../../../models/trust/evidence-classification.js";
import {
  deriveEvidenceEntryId,
  deriveEvidenceReceiptId,
  evidenceEntryRef,
} from "../../../models/trust/evidence-identity.js";
import {
  gateDecisionArm,
  gateDecisionFor,
} from "../../../models/trust/gate-decisions.js";
import { GateResultRecordSchema, type GateResultRecord } from "../../../models/workflow/gates.js";
import {
  obligationsFor,
  type EvidenceObligation,
  type EvidenceObligationSource,
} from "../../../models/trust/evidence-obligations.js";
import {
  ActionWriteProofSchema,
  RunEvidenceReceiptSchema,
  type ActionWriteProof,
  type RunEvidenceReceipt,
} from "../../../models/trust/evidence.js";
import {
  evaluateReceiptDerivationBinding,
  evaluateReceiptRederivation,
  type ReceiptBindingCheckResult,
} from "../../runtime/writes/receipt-derivation-binding.js";
import { FailureRecordSchema, type FailureRecord } from "../../../models/trust/failure.js";
import type { RuntimeFlowNode } from "../../../models/workflow/graph.js";
import {
  RunCheckpointRecordSchema,
  type FactProvenance,
  type RunCheckpointRecord,
} from "../../../models/workflow/checkpoint.js";
import {
  TransactionOutcomeSchema,
  WriteAttemptRecordSchema,
  WriteIntentRecordSchema,
  type WriteAttemptRecord,
  type WriteIntentRecord,
} from "../../../rules/write-safety/write-safety.js";
import type { AnyCommitTaskContract, AnyTaskContract } from "../../../models/task/task-contract.js";

/* ── inputs ──────────────────────────────────────────────────────────────── */

export interface ReceiptWriteEvidence {
  readonly intent: WriteIntentRecord;
  readonly attempts: readonly WriteAttemptRecord[];
}

export interface ReceiptBuildInput {
  readonly descriptor: AnyWorkflowDescriptor;
  /** The TERMINAL run record. A non-terminal run has no settled verdict. */
  readonly run: unknown;
  /** Present exactly when the run ended `done`. */
  readonly result?: unknown;
  /** Present exactly when the run ended `failed`. */
  readonly failure?: unknown;
  /** Every checkpoint row for the run's logical item, any attempt. */
  readonly checkpoints: readonly unknown[];
  /** Every write intent this run fenced, with its attempt rows. */
  readonly writes?: readonly ReceiptWriteEvidence[];

  readonly gateResults?: readonly unknown[];
}

/* ── node helpers ────────────────────────────────────────────────────────── */

function contractOf(node: RuntimeFlowNode): AnyTaskContract | undefined {
  if (node.kind === "task") return node.uses;
  if (node.kind === "transaction") return node.commit.uses;
  return undefined;
}

// Transaction checkpoints wrap output and proof; resolve output paths inside that wrapper.
interface TransactionOutcomeShape {
  readonly disposition: "committed" | "already-present";
  readonly proofSource: string;
  readonly output: unknown;
}

function transactionOutcomeOf(record: RunCheckpointRecord): TransactionOutcomeShape {
  const stored: unknown = record.output.value;
  if (stored === null || typeof stored !== "object" || Array.isArray(stored)) {
    throw new Error(`transaction checkpoint ${record.nodeId} does not store a transaction outcome object`);
  }
  const candidate = stored as Record<string, unknown>;
  const { disposition, proofSource } = candidate;
  if ((disposition !== "committed" && disposition !== "already-present") || typeof proofSource !== "string") {
    throw new Error(
      `transaction checkpoint ${record.nodeId} stores no closed disposition/proofSource pair; `
      + "refusing to describe a write whose outcome is not recorded",
    );
  }
  if (!("output" in candidate)) {
    throw new Error(`transaction checkpoint ${record.nodeId} stores no commit-contract output`);
  }
  // Durable checkpoint values are schema-bound canonical data; graph scope holds parsed values.
  const bound = SchemaBoundCanonicalValueSchema.parse(candidate.output);
  return Object.freeze({ disposition, proofSource, output: bound.value });
}

function contractOutputOf(node: RuntimeFlowNode, record: RunCheckpointRecord): unknown {
  if (node.kind !== "transaction") return record.output.value;
  return transactionOutcomeOf(record).output;
}

function scopeOf(node: RuntimeFlowNode): EvidenceValueScope {
  const contract = contractOf(node);
  if (contract === undefined) {
    throw new Error(`node "${node.id}" (${node.kind}) owns no task contract and has no evidence scope`);
  }
  return { kind: "task-output", taskId: contract.id };
}


function isLocalProjection(contract: AnyTaskContract): boolean {
  return contract.id.startsWith("workflow:");
}

function finiteFreshnessLimit(contract: AnyTaskContract): number | undefined {
  if (contract.effect !== "read") return undefined;
  const limit = contract.freshness.defaultMaxAgeMs;
  return Number.isFinite(limit) && limit > 0 ? Math.trunc(limit) : undefined;
}

/* ── receipt assembly ────────────────────────────────────────────────────── */


type ReceiptInput = z.input<typeof RunEvidenceReceiptSchema>;
type Fact = ReceiptInput["input"][number];
type Decision = ReceiptInput["decisions"][number];
type Action = ReceiptInput["actions"][number];
type Verification = ReceiptInput["verification"][number];
type Reuse = ReceiptInput["reuse"][number];
type Warning = ReceiptInput["warnings"][number];

interface NodeEvidence {
  readonly node: RuntimeFlowNode;
  readonly record?: RunCheckpointRecord;
  readonly notRun?: TerminalNotRunReason;
  readonly verificationId: EvidenceEntryId;
  /** leaf path → the observation entry that carries it. */
  readonly factIds: Map<string, EvidenceEntryId>;
  /** leaf path → the RAW value, for declared cross-source obligations. */
  readonly values: Map<string, unknown>;
}

function canonicalInputFingerprint(run: RunRecord) {
  const { protectedBindings, ...canonical } = run.input.parsed;
  return FingerprintSchema.parse(sha256Hex(
    `hrauto:receipt-canonical-input:v1\0${canonicalJsonStringify({ ...canonical, ...(protectedBindings === undefined || protectedBindings.length === 0 ? {} : { protectedBindings }), value: valueFreeProtectedInput(run.input.parsed.value, retainedRunProtectedBindings(run)) })}`,
  ));
}


function provenanceFor(record: RunCheckpointRecord, lookupPath: string): FactProvenance | undefined {
  return record.provenance
    .filter((fact) => fact.path === lookupPath || lookupPath.startsWith(`${fact.path}.`))
    .sort((left, right) => right.path.length - left.path.length)[0];
}

function pickCheckpoint(
  records: readonly RunCheckpointRecord[],
  nodeId: string,
  attempt: number,
): RunCheckpointRecord | undefined {
  // Select the latest execution within the latest attempt; a gate resume can re-execute a node.
  return records
    .filter((record) => record.nodeId === nodeId && record.attempt <= attempt)
    .sort((left, right) =>
      right.attempt - left.attempt
      || (right.claimGeneration ?? 0) - (left.claimGeneration ?? 0))[0];
}


export type ReceiptComposition = RunEvidenceReceipt["composition"];
export const LATEST_RECEIPT_COMPOSITION = 5 satisfies ReceiptComposition;

/** The one sentence a receipt says about each closed not-run reason; a new reason must be authored here, never inherited. */
const NOT_RUN_SENTENCE: Record<TerminalNotRunReason, (id: string) => string> = {
  "condition-false": (id) => `node "${id}" did not run: its declared \`when\` condition was false for this run's input`,
  "branch-not-selected": (id) => `node "${id}" did not run: the branch controller selected another case`,
  "step-omitted": (id) => `node "${id}" did not run: the operator omitted its step at start`,
  // Unreachable by construction (the sealed factory refuses it as a not-run
  // reason), authored so the closed map stays exhaustive rather than defaulted.
  "operator-asserted": (id) => `node "${id}" did not run: the operator asserted its facts at start`,
};

export function buildRunEvidenceReceipt(
  input: ReceiptBuildInput,
  composition: ReceiptComposition = LATEST_RECEIPT_COMPOSITION,
): RunEvidenceReceipt {
  return deriveRunEvidenceReceipt(input, composition).receipt;
}


export function deriveActionWriteProof(input: Readonly<{
  commitContract: AnyCommitTaskContract;
  /** The transaction node's checkpoint row (raw or parsed). */
  record: unknown;
  intent: WriteIntentRecord | undefined;
  composition?: ReceiptComposition;
}>): ActionWriteProof {
  if(input.composition!==undefined)RunEvidenceReceiptSchema.shape.composition.parse(input.composition);
  const { commitContract, intent } = input;
  const record = RunCheckpointRecordSchema.parse(input.record);
  const parsed = TransactionOutcomeSchema.safeParse(record.output.value);
  if (!parsed.success) {
    throw new Error(
      `transaction checkpoint ${record.nodeId} does not store a recorded transaction outcome, so `
      + "nothing durable proves this write: " + parsed.error.message,
    );
  }
  const outcome = parsed.data;
  if (intent === undefined) {
    throw new Error(
      `transaction checkpoint ${record.nodeId} stores a settled "${outcome.disposition}" outcome for `
      + `${commitContract.id} (proof source ${outcome.proofSource}), but no durable write intent row `
      + "pairs with it. The sequencer records the intent before any outcome settles, so this is a "
      + "recorder/store failure — refusing to describe the write as if the absence were a fact",
    );
  }
  const declaredProofHash = deriveSchemaHash(commitContract.writeSafety.completion.proofSchema, "output");
  if (outcome.proof.schemaHash !== declaredProofHash) {
    throw new Error(
      `transaction checkpoint ${record.nodeId} stores a completion proof bound to schema `
      + `${outcome.proof.schemaHash}, and ${commitContract.id} now declares ${declaredProofHash}; `
      + "refusing to redact a proof under a declaration authored for a different shape",
    );
  }
  const scope: EvidenceValueScope = { kind: "write-proof", taskId: commitContract.id };
  return ActionWriteProofSchema.parse({
    system: intent.system,
    idempotencyKeyDigest: publicTransactionKeyDigest(intent.idempotencyKeyDigest, false),
    completion: commitContract.writeSafety.completion.kind,
    proofSource: outcome.proofSource,
    values: evidenceLeaves(outcome.proof.value).map((leaf) => redactEvidenceLeaf(scope, leaf)),
    recordedAt: outcome.disposition === "committed" ? outcome.confirmedAt : outcome.observedAt,
  });
}


export function deriveRunEvidenceReceipt(
  input: ReceiptBuildInput,
  composition: ReceiptComposition = LATEST_RECEIPT_COMPOSITION,
): Readonly<{
  receipt: RunEvidenceReceipt;
  checks: readonly ReceiptBindingCheckResult[];
}> {
  RunEvidenceReceiptSchema.shape.composition.parse(composition);
  const { descriptor } = input;
  const run = RunRecordSchema.parse(input.run);
  const { envelope, lifecycle } = run;
  if (lifecycle.state !== "terminal") {
    throw new Error(
      `run ${envelope.runId} is ${lifecycle.state}; a receipt states a settled verdict and a `
      + "non-terminal run has none",
    );
  }
  if (lifecycle.outcome === "interrupted") {
    throw new Error(
      `run ${envelope.runId} ended interrupted; ref write-safety recovery will requeue or settle it, and a `
      + "receipt may not name a verdict recovery has not reached",
    );
  }
  const result: RunResultRecord | undefined = input.result === undefined
    ? undefined
    : RunResultRecordSchema.parse(input.result);
  const failure: FailureRecord | undefined = input.failure === undefined
    ? undefined
    : FailureRecordSchema.parse(input.failure);
  if (lifecycle.outcome === "done" && result === undefined) {
    throw new Error(`run ${envelope.runId} is terminal done but no run result was supplied`);
  }
  if (lifecycle.outcome === "failed" && failure === undefined) {
    throw new Error(`run ${envelope.runId} is terminal failed but no failure record was supplied`);
  }
  if (failure !== undefined && failure.failureId !== lifecycle.failureId) {
    throw new Error(
      `failure ${failure.failureId} is not run ${envelope.runId}'s terminal failure `
      + `(${String(lifecycle.failureId)})`,
    );
  }
  if (result === undefined) throw new Error("terminal-evidence-result-missing");
  const terminalEvidence = terminalEvidenceResult(result);
  if (terminalEvidence !== undefined) {
    if (result === undefined || result.runId !== envelope.runId || result.workflowId !== envelope.workflow
      || result.attempt !== envelope.attempt || result.configFingerprint !== envelope.configFingerprint
      || result.configSnapshotId !== envelope.configSnapshotId || result.descriptorVersion !== envelope.descriptorVersion
      || result.contractFingerprint !== envelope.contractFingerprint || result.createdAt !== lifecycle.endedAt) throw new Error("terminal-evidence-receipt-identity-mismatch");
    if (terminalEvidence.kind === "failed-evidence") {
      if (lifecycle.outcome !== "failed" || failure === undefined
        || deriveTerminalFailureDigest(failure) !== terminalEvidence.failureDigest
        || failure.failureId !== terminalEvidence.authorization.failureId
        || run.completion === undefined || run.completion.kind !== "failed"
        || run.completion.expectedVersion !== terminalEvidence.authorization.expectedVersion
        || canonicalJsonStringify(run.completion.claim) !== canonicalJsonStringify(terminalEvidence.authorization.claim)
        || run.completion.authorizedAt !== terminalEvidence.authorization.authorizedAt) throw new Error("terminal-failure-result-mismatch");
    } else if (lifecycle.outcome !== terminalEvidence.outcome || run.version < terminalEvidence.appliedVersion) throw new Error("terminal-evidence-outcome-mismatch");
  } else if (result !== undefined && lifecycle.outcome !== "done") throw new Error("terminal-evidence-payload-required");
  const checkpoints = input.checkpoints.map((record) => RunCheckpointRecordSchema.parse(record));
  for (const record of checkpoints) {
    if (record.workflowId !== envelope.workflow || record.itemId !== envelope.itemId) {
      throw new Error(
        `checkpoint ${record.nodeId} belongs to ${record.workflowId}/${record.itemId}, not to `
        + `run ${envelope.runId}'s logical item`,
      );
    }
  }
  const writes = (input.writes ?? []).map((entry) => Object.freeze({
    intent: WriteIntentRecordSchema.parse(entry.intent),
    attempts: entry.attempts.map((attempt) => WriteAttemptRecordSchema.parse(attempt)),
  }));
  const gateResults = (input.gateResults ?? []).map((row) => GateResultRecordSchema.parse(row));
  for (const row of gateResults) {

    if (row.runId !== envelope.runId) {
      throw new Error(
        `gate result for "${row.gateId}" belongs to run ${row.runId}, not to run ${envelope.runId}; `
        + "refusing to attribute another run's operator decision to this one",
      );
    }
  }
  const gateResultsByNode = new Map<string, GateResultRecord>();
  for (const row of gateResults) gateResultsByNode.set(String(row.gateId), row);


  const binding = evaluateReceiptDerivationBinding({
    descriptor,
    run,
    ...(result === undefined ? {} : { result }),
    checkpoints,
    writes: writes.map((entry) => entry.intent),
    gateResults,
  });
  if (binding.state === "incompatible") throw new Error(binding.message);

  const receiptId = deriveEvidenceReceiptId(envelope.runId, envelope.attempt);
  const generatedAt = lifecycle.endedAt;
  const entryId = (
    kind: Parameters<typeof deriveEvidenceEntryId>[1],
    key: string,
  ): EvidenceEntryId => deriveEvidenceEntryId(receiptId, kind, key);

  const inputFacts: Fact[] = [];
  const observations: Fact[] = [];
  const outputs: Fact[] = [];
  const decisions: Decision[] = [];
  const actions: Action[] = [];
  const verification: Verification[] = [];
  const reuse: Reuse[] = [];
  const warnings: Warning[] = [];

  /* ── input ─────────────────────────────────────────────────────────────── */

  const inputScope: EvidenceValueScope = { kind: "workflow-input", workflowId: descriptor.id };
  const inputFingerprint = canonicalInputFingerprint(run);
  const inputValues = new Map<string, unknown>();
  for (const leaf of evidenceLeaves(run.input.parsed.value)) {
    inputValues.set(leaf.path, leaf.value);
    inputFacts.push({
      id: entryId("input", leaf.path),
      field: leaf.field,
      mandatory: true,
      source: { kind: "input", inputFingerprint },
      state: "satisfied",
      value: redactEvidenceLeaf(inputScope, leaf),
    });
  }

  /* ── node walk ─────────────────────────────────────────────────────────── */

  const notRunByNode = new Map<string, TerminalNotRunReason>();

  const assertedByNode = new Map<string, CitedAssertion>();
  const resolvedByNode = new Set<string>();
  for (const dependency of result?.dependencies ?? []) {
    if (dependency.state === "not-run") notRunByNode.set(dependency.nodeId, dependency.reason);
    if (dependency.state === "asserted") {
      assertedByNode.set(dependency.nodeId, {
        step: dependency.step,
        assertedAt: dependency.assertedAt,
        outputSchemaHash: dependency.outputSchemaHash,
        outputDigest: dependency.outputDigest,
      });
    }
    if (dependency.state === "resolved") resolvedByNode.add(String(dependency.nodeId));
  }
  const omittedSteps = [...new Set((envelope.stepOmissions ?? []).map((entry) => String(entry.step)))].sort();
  for (const [nodeId, cited] of assertedByNode) {
    const stored = pickCheckpoint(checkpoints, nodeId, envelope.attempt);
    if (stored?.assertion === undefined) {
      throw new Error(
        `run ${envelope.runId}'s terminal record cites node "${nodeId}" as asserted for step "${cited.step}", `
        + "and authority holds no checkpoint row marked as an assertion for it; a receipt may not "
        + "describe an operator assertion no durable row carries",
      );
    }
    if (stored.assertion.step !== cited.step || stored.assertion.assertedAt !== cited.assertedAt) {
      throw new Error(
        `run ${envelope.runId}'s checkpoint for node "${nodeId}" was asserted for step `
        + `"${stored.assertion.step}" at ${stored.assertion.assertedAt}, and its terminal record cites step `
        + `"${cited.step}" at ${cited.assertedAt}; the two authorities disagree about this assertion`,
      );
    }
    // Step and instant bind the act; schema and digest bind the asserted value.
    if (stored.output.schemaHash !== cited.outputSchemaHash) {
      throw new Error(
        `run ${envelope.runId}'s asserted checkpoint for node "${nodeId}" was parsed with output schema `
        + `${stored.output.schemaHash}, and its terminal record cites ${cited.outputSchemaHash}; the two `
        + "authorities disagree about which schema bound this assertion's value",
      );
    }
    const storedDigest = deriveCheckpointOutputDigest(stored.output);
    if (storedDigest !== cited.outputDigest) {
      throw new Error(
        `run ${envelope.runId}'s asserted checkpoint for node "${nodeId}" disagrees with its terminal output binding; `
        + "the terminal derive did not consume the value "
        + "this row carries",
      );
    }
  }
  const terminalDependencies = new Set(
    workflowTerminalResultExecution(descriptor).dependsOn.map(String),
  );

  const terminalResultVerificationId = entryId("verification", "completion.terminal-result");
  const nodes = descriptorRuntimeNodes(descriptor);
  const byNode = new Map<string, NodeEvidence>();
  for (const node of nodes) {
    const id = String(node.id);
    byNode.set(id, {
      node,
      record: pickCheckpoint(checkpoints, id, envelope.attempt),
      notRun: notRunByNode.get(id),
      verificationId: entryId("verification", `node.${id}`),
      factIds: new Map(),
      values: new Map(),
    });
  }

  /** The descriptor's OWN declaration of what matters on a surface (ref workflow-model ). */
  const declaredDetails = new Set(
    descriptor.details.flatMap((detail) => "nodeId" in detail.source ? [`${detail.source.nodeId}\u0000${detail.source.fieldPath}`] : []),
  );

  for (const node of nodes) {
    const id = String(node.id);
    const evidence = byNode.get(id);
    if (evidence === undefined) continue;
    const { record } = evidence;
    const contract = contractOf(node);


    if (node.kind === "gate") {
      // An inapplicable conditional gate produces no synthetic operator decision.
      if (node.resolvedBy === "operator" && node.when !== undefined
        && node.dependsOn.every((dependency) => byNode.get(String(dependency))?.record !== undefined)) {
        const outputs = Object.fromEntries(node.dependsOn.map((dependency) => {
          const upstream = byNode.get(String(dependency))?.record;
          if (upstream === undefined) throw new Error(`conditional gate ${id} lost dependency ${dependency}`);
          return [String(dependency), upstream.output.value];
        }));
        if (!evaluateNodeCondition(node.when, { input: run.input.parsed.value, outputs })) {
          if (gateResultsByNode.has(id)) throw new Error(`inapplicable gate ${id} carries an operator result`);
          const decisionId = entryId("decision", `not-run.${id}`);
          decisions.push({
            id: decisionId, kind: "branch", outcome: "not-taken",
            reason: `gate "${id}" was not required by its declared evidence condition; no operator decision was made`,
            evidence: node.dependsOn.map((dependency) => evidenceEntryRef(entryId("verification", `node.${dependency}`))),
          });
          verification.push({ id: evidence.verificationId, obligation: `node.${id}`, mandatory: false,
            verdict: "absent", evidence: [evidenceEntryRef(decisionId)] });
          continue;
        }
      }
      const stored = gateResultsByNode.get(id);
      if (stored !== undefined) {
        emitGateEvidence({
          stored,
          nodeId: id,
          workflowId: descriptor.id,
          verificationId: evidence.verificationId,
          mandatory: terminalDependencies.has(id),
          declaredDetails,
          entryId,
          evidence,
          observations,
          decisions,
          verification,
          composition,
        });
        continue;
      }
    }

    if (record === undefined) {
      const reason = evidence.notRun;
      if (reason !== undefined) {

        const decisionId = entryId("decision", `not-run.${id}`);
        decisions.push({
          id: decisionId,
          kind: "branch",
          outcome: "not-taken",
          reason: NOT_RUN_SENTENCE[reason](id),
          evidence: [evidenceEntryRef(terminalResultVerificationId)],
        });
        verification.push({
          id: evidence.verificationId,
          obligation: `node.${id}`,
          mandatory: false,
          verdict: "absent",
          evidence: [evidenceEntryRef(decisionId)],
        });
      } else {

        verification.push({
          id: evidence.verificationId,
          obligation: `node.${id}`,
          mandatory: terminalDependencies.has(id),
          verdict: "unknown",
          evidence: [],
        });
      }
      continue;
    }
    if (contract === undefined) {
      throw new Error(`node "${id}" stored a checkpoint but owns no task contract to interpret it`);
    }


    if (record.assertion !== undefined) {
      emitAssertedNodeEvidence({
        composition,
        assertion: record.assertion,
        record,
        node,
        nodeId: id,
        taskId: contract.id,
        scope: scopeOf(node),
        declaredDetails,
        entryId,
        evidence,
        omittedSteps,
        runId: envelope.runId,
        ...(evidence.notRun === undefined ? {} : { citedNotRun: evidence.notRun }),
        citedResolved: resolvedByNode.has(id),
        observations,
        decisions,
        verification,
      });
      continue;
    }

    const scope = scopeOf(node);
    const replayed = record.runId !== envelope.runId || record.attempt !== envelope.attempt
      || Number(record.claimGeneration) !== Number(run.claimGeneration);
    const corrected = record.provenance.some((fact) => fact.correctedAt !== undefined);
    const checkpointFingerprint = deriveCheckpointOutputDigest(record.output);
    const nodeLeaves = evidenceLeaves(contractOutputOf(node, record));

    for (const leaf of nodeLeaves) {
      const factId = entryId("observation", `${id}.${leaf.path}`);
      evidence.factIds.set(leaf.path, factId);
      evidence.values.set(leaf.path, leaf.value);
      const provenance = provenanceFor(
        record,
        node.kind === "transaction" ? `output.${leaf.path}` : leaf.path,
      );
      const mandatory = declaredDetails.has(`${id}\u0000${leaf.path}`);
      observations.push(observationFact({
        composition,
        factId,
        entryId,
        nodeId: id,
        taskId: contract.id,
        leaf,
        scope,
        provenance,
        replayed,
        checkpointFingerprint,
        writtenAt: record.writtenAt,
        upstream: node.dependsOn
          .map((dependency) => byNode.get(String(dependency))?.verificationId)
          .filter((value): value is EvidenceEntryId => value !== undefined),
        mandatory,
        supersededFacts: observations,
      }));
    }

    /* action */
    const occurredAt = record.writtenAt;
    if (node.kind === "transaction") {
      const outcome = transactionOutcomeOf(record);
      // Checkpoint rows lack intent IDs; a duplicated task ID cannot safely join to a first matching intent.
      const matchingWrites = writes.filter((entry) => entry.intent.taskId === contract.id);
      if (matchingWrites.length > 1) {
        throw new Error(
          `run ${envelope.runId} supplies ${matchingWrites.length} write intents for commit contract `
          + `${contract.id} (${matchingWrites.map((entry) => entry.intent.writeIntentId).join(", ")}); `
          + `the checkpoint for node "${id}" names no intent id, so the fence identity cannot be `
          + "attributed to one of them — refusing to guess which intent proved this write",
        );
      }
      const write = matchingWrites[0];
      actions.push({
        id: entryId("action", `${id}.prepare`),
        taskId: node.prepare.uses.id,
        kind: "prepare",
        writeState: "prepared",
        occurredAt,
      });
      const commitAction = commitActionOf({
        id: entryId("action", `${id}.commit`),
        taskId: contract.id,
        occurredAt,
        write,
      });
      commitAction.proved = deriveActionWriteProof({
        composition,
        commitContract: node.commit.uses,
        record,
        intent: write?.intent,
      });
      actions.push(commitAction);
      const dedupeId = entryId("decision", `dedupe.${id}`);
      decisions.push({
        id: dedupeId,
        kind: "dedupe",
        outcome: outcome.disposition === "committed" ? "taken" : "not-taken",
        reason: outcome.disposition === "committed"
          ? `the permanent key was not already satisfied, so this run fenced and committed once `
            + `(proof source: ${outcome.proofSource})`
          : `the permanent key was ALREADY satisfied (proof source: ${outcome.proofSource}); `
            + "this run performed no second write",
        evidence: [evidenceEntryRef(commitAction.id)],
      });
      if (write !== undefined) {
        const identityId = entryId("decision", `identity.${id}`);
        decisions.push({
          id: identityId,
          kind: "identity",
          outcome: "approved",
          reason: subjectReason(write.intent),
          evidence: [evidenceEntryRef(commitAction.id)],
        });
      }
    } else {
      actions.push({
        id: entryId("action", `${id}.read`),
        taskId: contract.id,
        kind: isLocalProjection(contract) ? "local-projection" : "external-read",
        writeState: "not-attempted",
        occurredAt,
      });
      if (contract.subject.kind !== "none") {
        decisions.push({
          id: entryId("decision", `identity.${id}`),
          kind: "identity",
          outcome: "approved",
          reason: `contract ${contract.id} binds the subject by observing `
            + `"${contract.subject.observe}" and matching it ${contract.subject.match} `
            + `${contract.subject.requiredAt}; the task refuses its output on a mismatch, and this `
            + "node returned a schema-valid, provenance-complete output",
          evidence: [evidenceEntryRef(evidence.verificationId)],
        });
      }
    }

    /* reuse */
    const limit = finiteFreshnessLimit(contract);
    const observedAtMs = record.provenance
      .map((fact) => Date.parse(fact.originalObservedAt))
      .filter((value) => Number.isFinite(value));
    const oldest = observedAtMs.length === 0 ? Date.parse(record.writtenAt) : Math.min(...observedAtMs);
    const ageMs = Math.max(0, Date.parse(generatedAt) - oldest);
    if (limit !== undefined) {
      reuse.push({
        id: entryId("reuse", id),
        kind: corrected ? "corrected" : replayed ? "checkpoint" : "fresh-live",
        source: evidenceEntryRef(evidence.verificationId),
        ageMs,
        freshnessLimitMs: limit,
      });
      if (replayed && ageMs > limit) {
        warnings.push({
          id: entryId("warning", `stale-replay.${id}`),
          code: ErrorCodeSchema.parse("REPLAYED_FACT_OLDER_THAN_FRESHNESS_LIMIT"),
          summary: `node "${id}" replayed a checkpoint observed ${String(ageMs)}ms ago against a `
            + `${String(limit)}ms freshness limit; ref workflow-model §5.5's walk proved it feeds no commit `
            + "scheduled in this run, so it is recorded and not load-bearing",
          loadBearing: false,
          evidence: [evidenceEntryRef(evidence.verificationId)],
        });
      }
    }

    verification.push({
      id: evidence.verificationId,
      obligation: `node.${id}`,
      mandatory: terminalDependencies.has(id),
      verdict: "verified",
      evidence: [...evidence.factIds.values()].map(evidenceEntryRef),
    });
  }

  /* ── outputs ───────────────────────────────────────────────────────────── */

  // Preview envelope and terminal schema must agree; neither alone proves a coherent preview.
  const previewResultSchemaHash = deriveSchemaHash(RunDryRunPreviewResultSchema, "output");
  const previewed = result !== undefined && result.resultSchemaHash === previewResultSchemaHash;
  if (previewed !== (envelope.dryRun && lifecycle.outcome === "done" && result !== undefined)) {
    throw new Error(
      `run ${envelope.runId} has dryRun=${String(envelope.dryRun)} but its terminal result is bound to `
      + `${result === undefined ? "no schema" : result.resultSchemaHash}; a receipt cannot describe a run `
      + "whose envelope and terminal record disagree about whether it committed anything",
    );
  }

  if (previewed && result !== undefined) {
    const preview = RunDryRunPreviewResultSchema.parse(result.result.value);

    verification.push({
      id: terminalResultVerificationId,
      obligation: "completion.terminal-result",
      mandatory: true,

      verdict: "unknown",
      evidence: [],
    });

    const reached = preview.preview.outcome.state === "would-prepare"
      ? `staged its page and observed subject ${preview.preview.outcome.subject.state}`
      : `settled ${preview.preview.outcome.state} at its ${preview.preview.probe.state} probe, `
        + "before anything was staged";
    warnings.push({
      id: entryId("warning", "dry-run-preview"),
      code: ErrorCodeSchema.parse("DRY_RUN_PREVIEW"),
      summary: `this run was a DRY RUN: transaction node "${preview.stoppedAtNodeId}" was previewed `
        + `(${reached}, observed ${preview.preview.observedAt}) and the run ended `
        + "there. No external write was attempted — no write intent, no fence, no commit — so this "
        + "receipt states what WOULD have been written, never what was",
      loadBearing: true,
      evidence: [],
    });
  } else if (result !== undefined && terminalEvidence === undefined) {
    const resultScope: EvidenceValueScope = { kind: "workflow-result", workflowId: descriptor.id };
    for (const leaf of evidenceLeaves(result.result.value)) {
      outputs.push({
        id: entryId("output", leaf.path),
        field: leaf.field,
        mandatory: true,
        source: {
          kind: "derived",
          evidence: [...derivedResultEvidence(result, byNode, terminalResultVerificationId)],
        },
        state: "satisfied",
        value: redactEvidenceLeaf(resultScope, leaf),
      });
    }
    verification.push({
      id: terminalResultVerificationId,
      obligation: "completion.terminal-result",
      mandatory: true,
      verdict: deriveTerminalDependencyDigest(result.dependencies) === result.dependencyDigest
        ? "verified"
        : "ambiguous",
      evidence: outputs.map(({ id }) => evidenceEntryRef(id)),
    });
  } else if (failure !== undefined) {
    verification.push({
      id: terminalResultVerificationId,
      obligation: "completion.terminal-result",
      mandatory: true,
      verdict: "absent",
      evidence: [],
    });
    warnings.push({
      id: entryId("warning", "failure"),
      code: failure.code,
      summary: `${failure.summary} — write state at failure: ${failure.writeState}`,
      loadBearing: true,
      evidence: [],
    });
  } else {
    verification.push({
      id: terminalResultVerificationId,
      obligation: "completion.terminal-result",
      mandatory: true,
      verdict: "absent",
      evidence: [],
    });
  }

  /* ── declared cross-source obligations ─────────────────────────────────── */

  for (const obligation of obligationsFor(descriptor.id)) {
    verification.push(evaluateObligation(obligation, {
      obligationId: entryId("verification", obligation.obligation),
      inputValues,
      resultFacts: outputs,
      resultValues: result !== undefined && terminalEvidence === undefined && !previewed ? new Map(evidenceLeaves(result.result.value).map(leaf => [leaf.path, leaf.value])) : new Map(),
      byNode,
    }));
  }



  // Receipts name omitted step keys; operator-entered facts stay in run input.
  if (omittedSteps.length > 0) {
    warnings.push({
      id: entryId("warning", "step-omitted"),
      code: ErrorCodeSchema.parse("OPERATOR_OMITTED_STEP"),
      summary: `the operator omitted ${omittedSteps.length === 1 ? "one step" : `${String(omittedSteps.length)} steps`} `
        + `at start and typed the facts this run would have read there: ${omittedSteps.join(", ")}. `
        + "Every node of those steps either carries an operator-asserted value or did not run at all; "
        + "nothing under them was observed in a live system",
      loadBearing: true,
      evidence: [],
    });
  }

  /* ── residual writes ───────────────────────────────────────────────────── */

  for (const { intent } of writes) {
    if (intent.status === "parked" || intent.status === "retryable") {
      warnings.push({
        id: entryId("warning", `residual-write.${intent.writeIntentId}`),
        code: ErrorCodeSchema.parse("RESIDUAL_WRITE_INTENT"),
        summary: `write intent ${intent.writeIntentId} for ${intent.system} `
          + `${idempotencyKeyDigestReference(intent.idempotencyKeyDigest, false)} is still ${intent.status}; this run left an unsettled `
          + "external write behind and only ref write-safety's typed operator resolutions may release it",
        loadBearing: true,
        evidence: [],
      });
    }
  }

  /* ── verdict ───────────────────────────────────────────────────────────── */

  const facts = [...inputFacts, ...observations, ...outputs];
  const unresolvedMandatoryFact = facts.some((fact) => fact.mandatory && fact.state === "unresolved");
  const unresolvedMandatoryObligation = verification.some((entry) => (
    entry.mandatory && (entry.verdict === "unknown" || entry.verdict === "ambiguous")
  ));
  const absentMandatoryObligation = verification.some((entry) => entry.mandatory && entry.verdict === "absent");
  const loadBearingWarning = warnings.some(({ loadBearing }) => loadBearing);

  const confidence = unresolvedMandatoryFact || unresolvedMandatoryObligation || absentMandatoryObligation
    ? "unknown"
    : warnings.length > 0
      ? "partial"
      : "verified";

  const receiptResult = lifecycle.outcome === "failed"
    ? "failed"
    : lifecycle.outcome !== "done"
      ? "cancelled"
      : confidence === "verified"
        ? "verified-done"
        : loadBearingWarning || confidence === "unknown"
          ? "partial"
          : "done-with-warnings";

  const receiptData = {
    composition,
    receiptId,
    runId: envelope.runId,
    traceId: envelope.traceId,
    workflowId: envelope.workflow,
    attempt: envelope.attempt,
    generatedAt,

    descriptorFingerprint: envelope.contractFingerprint,
    configFingerprint: envelope.configFingerprint,
    retryOf: envelope.retryOf === undefined
      ? { state: "absent" }
      : { state: "present", value: envelope.retryOf },
    failure: receiptResult === "failed" && failure !== undefined
      ? { state: "present", value: failure.failureId }
      : { state: "absent" },
    input: inputFacts,
    observations,
    decisions,
    actions,
    verification,
    output: outputs,
    reuse,
    warnings,
    confidence,
    result: receiptResult,
  };
  const parsedReceipt = RunEvidenceReceiptSchema.parse(receiptData);
  const receipt = RunEvidenceReceiptSchema.parse(JSON.parse(canonicalJsonStringify(parsedReceipt)));
  assertEvidenceRefsResolve(receipt);
  return Object.freeze({ receipt, checks: binding.checks });
}

// Every observation or receipt reference must point to a row in this same receipt.
export function assertEvidenceRefsResolve(receipt: RunEvidenceReceipt): void {
  const known = new Set<string>([
    `receipt:${receipt.receiptId}`,
    ...[
      ...receipt.input, ...receipt.observations, ...receipt.output,
      ...receipt.decisions, ...receipt.actions, ...receipt.verification,
      ...receipt.reuse, ...receipt.warnings,
    ].map(({ id }) => `observation:${id}`),
  ]);
  const dangling: string[] = [];
  const check = (ref: string, owner: string): void => {
    if (!known.has(ref)) dangling.push(`${owner} → ${ref}`);
  };
  for (const fact of [...receipt.input, ...receipt.observations, ...receipt.output]) {
    if (fact.state !== "satisfied") continue;
    if (fact.source.kind === "derived") {
      for (const ref of fact.source.evidence) check(ref, `fact ${fact.id}`);
    }
    if (fact.source.kind === "operator-correction") {
      check(`observation:${fact.source.supersedes}`, `fact ${fact.id}`);
    }
  }
  for (const decision of receipt.decisions) {
    for (const ref of decision.evidence) check(ref, `decision ${decision.id}`);
  }
  for (const entry of receipt.verification) {
    for (const ref of entry.evidence) check(ref, `verification ${entry.obligation}`);
  }
  for (const entry of receipt.reuse) check(entry.source, `reuse ${entry.id}`);
  for (const warning of receipt.warnings) {
    for (const ref of warning.evidence) check(ref, `warning ${warning.id}`);
  }
  if (dangling.length > 0) {
    throw new Error(
      `receipt ${receipt.receiptId} cites evidence rows it does not carry: ${dangling.join(", ")}`,
    );
  }
}

/* ── persistence ─────────────────────────────────────────────────────────── */

/** What the ensure step needs from authority. Reads only, plus the one insert. */
export interface EvidenceReceiptStore {
  getRun(runId: string): unknown;
  getResult(runId: string): unknown;
  getFailure(failureId: string): unknown;
  listCheckpointsByRun(runId: string): readonly unknown[];
  listWritesByRun(runId: string): readonly ReceiptWriteEvidence[];

  listGateResultsByRun(runId: string): readonly unknown[];
  findReceiptByRun(runId: string): unknown;
  insertReceipt(receipt: unknown): Readonly<{ state: "inserted" | "existing"; record: RunEvidenceReceipt }>;
}

export type EnsureReceiptOutcome = Readonly<{
  state: "derived" | "existing";
  receipt: RunEvidenceReceipt;
}>;


export function ensureRunEvidenceReceipt(
  store: EvidenceReceiptStore,
  descriptor: AnyWorkflowDescriptor,
  runId: string,
): EnsureReceiptOutcome {
  const run = RunRecordSchema.parse(store.getRun(runId));
  const { lifecycle } = run;
  if (lifecycle.state !== "terminal") {
    throw new Error(`run ${runId} is ${lifecycle.state}; only a terminal run has a receipt`);
  }
  if (lifecycle.outcome === "interrupted") throw new Error(`run ${runId} ended interrupted; recovery has not admitted a final receipt`);
  const existingRaw: unknown = store.findReceiptByRun(runId);
  const existing = existingRaw === undefined || existingRaw === null
    ? undefined
    : RunEvidenceReceiptSchema.parse(existingRaw);
  const composition = LATEST_RECEIPT_COMPOSITION;
  const { receipt: derived, checks } = deriveRunEvidenceReceipt({
    descriptor,
    run,
    result: store.getResult(runId),
    ...(lifecycle.failureId === undefined ? {} : { failure: store.getFailure(lifecycle.failureId) }),
    checkpoints: store.listCheckpointsByRun(runId),
    writes: store.listWritesByRun(runId),
    gateResults: store.listGateResultsByRun(runId),
  }, composition);
  if (existing !== undefined) {
    const rederivation = evaluateReceiptRederivation({
      run,
      descriptor,
      stored: existing,
      derived,
      checks,
    });
    if (rederivation.state === "incompatible") throw new Error(rederivation.message);
  }
  const stored = store.insertReceipt(derived);
  return Object.freeze({
    state: stored.state === "inserted" ? "derived" : "existing",
    receipt: stored.record,
  });
}



interface GateEvidenceInput {
  readonly stored: GateResultRecord;
  readonly nodeId: string;
  readonly workflowId: AnyWorkflowDescriptor["id"];
  readonly verificationId: EvidenceEntryId;
  readonly mandatory: boolean;
  readonly declaredDetails: ReadonlySet<string>;
  readonly entryId: (kind: Parameters<typeof deriveEvidenceEntryId>[1], key: string) => EvidenceEntryId;
  readonly evidence: NodeEvidence;
  readonly observations: Fact[];
  readonly decisions: Decision[];
  readonly verification: Verification[];
  readonly composition: ReceiptComposition;
}


function emitGateEvidence(input: GateEvidenceInput): void {
  const { stored, nodeId, entryId, evidence } = input;
  if ("source" in stored) {
    const factId = entryId("observation", `${nodeId}.sourceEvent`);
    input.observations.push({
      id: factId,
      field: "sourceEvent",
      mandatory: input.mandatory,
      source: {
        kind: "gate-source-event",
        gateId: stored.gateId,
        sourceKind: stored.source.kind,
        sourceId: stored.source.sourceId,
        eventId: stored.source.eventId,
        eventDigest: stored.source.eventDigest,
        correlationDigest: stored.source.correlationDigest,
        attempt: stored.source.attempt,
        resolvedAt: stored.resolvedAt,
      },
      state: "unresolved",
      reason: `source ${stored.source.sourceId} event ${stored.source.eventId} settled gate "${nodeId}"; `
        + "the source event is not a human decision, and this build has no declared semantic interpretation",
    });
    input.verification.push({
      id: input.verificationId,
      obligation: `node.${nodeId}`,
      mandatory: input.mandatory,
      verdict: "unknown",
      evidence: [evidenceEntryRef(factId)],
    });
    return;
  }
  const declaration = gateDecisionFor(input.workflowId, nodeId);
  const scope: EvidenceValueScope = {
    kind: "gate-result",
    workflowId: input.workflowId,
    gateId: stored.gateId,
  };
  const source = {
    kind: "gate-result" as const,
    gateId: stored.gateId,
    resolvedBy: stored.resolvedBy,
    resolvedAt: stored.resolvedAt,
  };

  const leaves = evidenceLeaves(stored.result.value);
  for (const leaf of leaves) {
    const factId = entryId("observation", `${nodeId}.${leaf.path}`);
    evidence.factIds.set(leaf.path, factId);
    evidence.values.set(leaf.path, leaf.value);
    input.observations.push({
      id: factId,
      field: leaf.field,
      mandatory: input.declaredDetails.has(`${nodeId}\u0000${leaf.path}`),
      source,
      state: "satisfied",
      value: redactEvidenceLeaf(scope, leaf),
    });
  }

  const decided = leaves.find((leaf) => leaf.path === declaration.decisionPath);
  if (decided === undefined) {
    throw new Error(
      `gate "${nodeId}" of ${input.workflowId} stored no leaf at the declared decision path `
      + `"${declaration.decisionPath}" (it stored: ${leaves.map((leaf) => leaf.path).join(", ")}); `
      + "the declaration and the gate's result schema disagree",
    );
  }
  const arm = gateDecisionArm(declaration, decided.value);
  const boundLeaf = declaration.boundEvidencePath === undefined
    ? undefined
    : leaves.find((leaf) => leaf.path === declaration.boundEvidencePath);
  // Bound-evidence leaves must be scalar values the operator can compare to the packet digest.
  if (boundLeaf !== undefined && typeof boundLeaf.value !== "string") {
    throw new Error(
      `gate "${nodeId}" of ${input.workflowId} declares "${String(declaration.boundEvidencePath)}" as its `
      + "bound evidence and stored a non-string there; a bound-evidence leaf "
      + "must be a single comparable identity",
    );
  }
  const projectedBound = typeof boundLeaf?.value === "string" ? boundLeaf.value : undefined;
  const decisionId = entryId("decision", `gate.${nodeId}`);
  input.decisions.push({
    id: decisionId,
    kind: "gate",
    outcome: arm.outcome,
    reason: `${arm.summary}: gate "${nodeId}" was resolved \`${arm.value}\` by `
      + `${stored.resolvedBy} at ${stored.resolvedAt} through command ${stored.commandId}`
      + (projectedBound === undefined
        ? ""
        : `, bound to the identity evidence it was granted on `
          + `(${String(declaration.boundEvidencePath)} ${projectedBound})`)
      + ". The approver and the instant are authority's own fields on the gate result record, "
      + "written by the resolving command, not values the resolving payload claimed",
    evidence: [
      evidenceEntryRef(input.verificationId),
      ...[...evidence.factIds.values()].map(evidenceEntryRef),
    ],
  });

  input.verification.push({
    id: input.verificationId,
    obligation: `node.${nodeId}`,
    mandatory: input.mandatory,
    verdict: "verified",
    evidence: [...evidence.factIds.values()].map(evidenceEntryRef),
  });
}



// Reconcile both the asserted act and its schema-bound value against the checkpoint.
interface CitedAssertion {
  readonly step: string;
  readonly assertedAt: string;
  readonly outputSchemaHash: string;
  readonly outputDigest: string;
}

interface AssertedEvidenceInput {
  readonly composition: ReceiptComposition;
  readonly assertion: NonNullable<RunCheckpointRecord["assertion"]>;
  readonly record: RunCheckpointRecord;
  readonly node: RuntimeFlowNode;
  readonly nodeId: string;
  readonly taskId: string;
  readonly scope: EvidenceValueScope;
  readonly declaredDetails: ReadonlySet<string>;
  readonly entryId: (kind: Parameters<typeof deriveEvidenceEntryId>[1], key: string) => EvidenceEntryId;
  readonly evidence: NodeEvidence;
  readonly omittedSteps: readonly string[];
  readonly runId: string;
  /** The terminal record's `not-run` reason for this node, when it cites one — a contradiction. */
  readonly citedNotRun?: TerminalNotRunReason;
  /** True when the terminal record cites this node as RESOLVED — a contradiction. */
  readonly citedResolved: boolean;
  readonly observations: Fact[];
  readonly decisions: Decision[];
  readonly verification: Verification[];
}

// Operator assertions are present facts, never live-verified observations.
function emitAssertedNodeEvidence(input: AssertedEvidenceInput): void {
  const { assertion, record, node, nodeId, taskId, entryId, evidence } = input;
  if (node.kind !== "task") {
    throw new Error(
      `node "${nodeId}" (${node.kind}) of run ${input.runId} stores a checkpoint marked as an operator `
      + `assertion for step "${assertion.step}"; only a TASK node is ever asserted — a gate always runs `
      + "and a transaction in an omitted step never runs at all",
    );
  }

  if (input.citedResolved) {
    throw new Error(
      `run ${input.runId}'s terminal record cites node "${nodeId}" as resolved, and its checkpoint is `
      + `marked as an operator assertion for step "${assertion.step}"; a receipt may not call an asserted `
      + "value an observed one",
    );
  }
  if (input.citedNotRun !== undefined) {
    throw new Error(
      `run ${input.runId}'s terminal record cites node "${nodeId}" as not-run (${input.citedNotRun}), and its `
      + `checkpoint is marked as an operator assertion for step "${assertion.step}"; a receipt may not call an `
      + "asserted value a node that produced nothing",
    );
  }

  if (!input.omittedSteps.includes(assertion.step)) {
    throw new Error(
      `run ${input.runId}'s checkpoint for node "${nodeId}" is asserted for step "${assertion.step}", `
      + `and its envelope omits ${input.omittedSteps.length === 0 ? "no step" : `only ${input.omittedSteps.join(", ")}`}; `
      + "an assertion whose step this run never omitted is not this run's assertion",
    );
  }
  const nonOperator = record.provenance.find((fact) => fact.source !== "operator");
  if (nonOperator !== undefined) {
    throw new Error(
      `run ${input.runId}'s asserted checkpoint for node "${nodeId}" carries a "${nonOperator.source}" `
      + `provenance row at field "${nonOperator.path}"; every leaf of an assertion is operator-sourced, `
      + "and a live or derived row inside one means the marker and the provenance disagree",
    );
  }

  const source = {
    kind: "operator-assertion" as const,
    taskId,
    step: assertion.step,
    assertedAt: assertion.assertedAt,
  };
  for (const leaf of evidenceLeaves(record.output.value)) {
    const factId = entryId("observation", `${nodeId}.${leaf.path}`);
    evidence.factIds.set(leaf.path, factId);
    evidence.values.set(leaf.path, leaf.value);
    input.observations.push({
      id: factId,
      field: leaf.field,
      mandatory: input.declaredDetails.has(`${nodeId}\u0000${leaf.path}`),
      source,
      state: "satisfied",
      value: redactEvidenceLeaf(input.scope, leaf),
    });
  }

  const decisionId = entryId("decision", `assertion.${nodeId}`);
  const factRefs = [...evidence.factIds.values()].map(evidenceEntryRef);
  input.decisions.push({
    id: decisionId,
    kind: "assertion",
    outcome: "taken",
    reason: `node "${nodeId}" did not run: the operator omitted step "${assertion.step}" at start, and `
      + `${taskId}'s output was rebuilt at ${assertion.assertedAt} from the facts the operator typed for `
      + "that step. Every field below it is operator-asserted; none of it was observed in a live "
      + "system, and no write was made from this node",
    evidence: [evidenceEntryRef(evidence.verificationId), ...factRefs],
  });

  // Cite the facts, not the decision that cites this obligation; mutual citation would form a cycle.
  input.verification.push({
    id: evidence.verificationId,
    obligation: `node.${nodeId}`,
    mandatory: true,
    verdict: "present",
    evidence: factRefs,
  });
}

/* ── fact construction ───────────────────────────────────────────────────── */

interface ObservationFactInput {
  readonly composition: ReceiptComposition;
  readonly factId: EvidenceEntryId;
  readonly entryId: (kind: Parameters<typeof deriveEvidenceEntryId>[1], key: string) => EvidenceEntryId;
  readonly nodeId: string;
  readonly taskId: string;
  readonly leaf: EvidenceLeaf;
  readonly scope: EvidenceValueScope;
  readonly provenance?: FactProvenance;
  readonly replayed: boolean;
  readonly checkpointFingerprint: string;
  readonly writtenAt: string;
  readonly upstream: readonly EvidenceEntryId[];
  readonly mandatory: boolean;

  readonly supersededFacts: Fact[];
}

function observationFact(input: ObservationFactInput): Fact {
  const {
    factId, entryId, nodeId, taskId, leaf, scope, provenance, replayed, checkpointFingerprint, writtenAt,
  } = input;
  const value = redactEvidenceLeaf(scope, leaf);
  const base = { id: factId, field: leaf.field, mandatory: input.mandatory, state: "satisfied" as const, value };

  if (provenance === undefined) {
    // Without provenance, observation time stays unknown; the checkpoint still supplies source identity.
    return {
      id: factId,
      field: leaf.field,
      mandatory: input.mandatory,
      source: { kind: "checkpoint", taskId, checkpointFingerprint, observedAt: writtenAt },
      state: "unresolved",
      reason: `node "${nodeId}" stored no provenance row for output field "${leaf.path}", so the `
        + "instant this value was observed is not recoverable from authority",
    };
  }

  if (provenance.correctedAt !== undefined) {
    const supersededId = entryId("observation", `${nodeId}.${leaf.path}#superseded`);
    input.supersededFacts.push({
      id: supersededId,
      field: leaf.field,
      mandatory: false,
      source: {
        kind: "checkpoint",
        taskId,
        checkpointFingerprint,
        observedAt: provenance.supersedes ?? provenance.originalObservedAt,
      },
      state: "unresolved",
      reason: `superseded by an operator correction at ${provenance.correctedAt}; the checkpoint `
        + "retains only the corrected value, so the pre-correction value is not in authority",
    });
    return { ...base, source: { kind: "operator-correction", supersedes: supersededId } };
  }


  if (provenance.source === "operator") {
    throw new Error(
      `node "${nodeId}" stored an operator-sourced provenance row for output field "${leaf.path}" that is `
      + "not an operator correction; only an operator assertion writes one, and an asserted checkpoint's facts "
      + "are emitted from its assertion, never as an observation",
    );
  }

  if (provenance.source === "derived") {
    const evidence: string[] = input.upstream.map(evidenceEntryRef);
    return {
      ...base,
      source: {
        kind: "derived",
        evidence: evidence.length > 0 ? evidence : [evidenceEntryRef(factId)],
      },
    };
  }

  return replayed
    ? { ...base, source: { kind: "checkpoint", taskId, checkpointFingerprint, observedAt: provenance.observedAt } }
    : { ...base, source: { kind: "system", taskId, observedAt: provenance.observedAt } };
}

function derivedResultEvidence(
  result: RunResultRecord,
  byNode: ReadonlyMap<string, NodeEvidence>,
  fallback: EvidenceEntryId,
): readonly string[] {
  const refs = result.dependencies
    .map((dependency) => byNode.get(String(dependency.nodeId))?.verificationId)
    .filter((value): value is EvidenceEntryId => value !== undefined)
    .map(evidenceEntryRef);
  return refs.length > 0 ? refs : [evidenceEntryRef(fallback)];
}

/* ── write actions ───────────────────────────────────────────────────────── */

function commitActionOf(input: Readonly<{
  id: EvidenceEntryId;
  taskId: string;
  occurredAt: string;
  write?: ReceiptWriteEvidence;
}>): Action {
  const intent = input.write?.intent;
  if (intent === undefined) {
    // A checkpoint without supplied durable intent supports committed, never an invented filed proof.
    return {
      id: input.id, taskId: input.taskId, kind: "commit", writeState: "committed", occurredAt: input.occurredAt,
    };
  }
  if (intent.status === "committed") {
    return {
      id: input.id,
      taskId: input.taskId,
      kind: "commit",
      writeState: "verified",
      proofRef: intent.bindingProof.proofId,
      occurredAt: intent.confirmedAt,
    };
  }
  if (intent.status === "observed-present") {
    return {
      id: input.id, taskId: input.taskId, kind: "commit", writeState: "committed", occurredAt: intent.observedAt,
    };
  }
  if (intent.status === "attempting") {
    return {
      id: input.id,
      taskId: input.taskId,
      kind: "commit",
      writeState: "attempting",
      proofRef: intent.bindingProof.proofId,
      occurredAt: intent.fencedAt,
    };
  }
  return {
    id: input.id,
    taskId: input.taskId,
    kind: "commit",
    writeState: "unknown",
    proofRef: intent.bindingProof.proofId,
    occurredAt: intent.updatedAt,
  };
}

function subjectReason(intent: WriteIntentRecord): string {
  if (intent.status === "observed-present") {
    return `the permanent ${intent.system} ${idempotencyKeyDigestReference(intent.idempotencyKeyDigest, false)} was already satisfied and `
      + "observed present; this run bound no fresh subject because it performed no write";
  }
  const proof = intent.bindingProof;
  if (proof.kind === "unscoped") {
    return `the commit is a reviewed subjectless write (${proof.reviewedReasonId}) observed on page `
      + `state ${proof.pageStateId} at ${proof.observedAt}`;
  }
  const observed = proof.observed;
  const shown = observed.kind === "person"
    ? `${observed.identifierKind} ending "${observed.displaySuffix}"`
    : observed.kind === "artifact"
      ? `artifact ${observed.artifactId}`
      : `catalog key ${observed.catalogKey}`;
  return `the page displayed ${shown} (binding digest ${observed.bindingDigest}) on page state `
    + `${proof.pageStateId} at ${proof.observedAt}, observed after prepare and before the fence at `
    + `${proof.afterPrepareSpanPath}, and it matched the expected subject exactly`;
}

/* ── declared obligations ────────────────────────────────────────────────── */

interface ObligationContext {
  readonly obligationId: EvidenceEntryId;
  readonly inputValues: ReadonlyMap<string, unknown>;
  readonly resultValues: ReadonlyMap<string, unknown>;
  readonly resultFacts: readonly Fact[];
  readonly byNode: ReadonlyMap<string, NodeEvidence>;
}

interface ResolvedObligationSource {
  readonly source: EvidenceObligationSource;
  readonly value: unknown;
  readonly ref?: string;
}

function resolveSource(
  source: EvidenceObligationSource,
  context: ObligationContext,
): ResolvedObligationSource | undefined {
  if (source.kind === "workflow-result") {
    if (!context.resultValues.has(source.path)) return undefined;
    const index = [...context.resultValues.keys()].indexOf(source.path);
    const fact = context.resultFacts[index];
    return { source, value: context.resultValues.get(source.path), ...(fact === undefined ? {} : { ref: evidenceEntryRef(fact.id) }) };
  }
  if (source.kind === "workflow-input") {
    if (!context.inputValues.has(source.path)) return undefined;
    return { source, value: context.inputValues.get(source.path) };
  }
  const node = context.byNode.get(String(source.nodeId));
  if (node === undefined) return undefined;
  let path = String(source.path);
  let value = node.values.get(path);
  if (!node.values.has(path)) {
    const parts = path.split(".");
    path = parts.shift() ?? "";
    value = node.values.get(path);
    for (const part of parts) {
      if (value === null || typeof value !== "object") return undefined;
      value = Array.isArray(value) ? value[Number(part)] : (value as Record<string, unknown>)[part];
    }
    if (value === undefined) return undefined;
  }
  const factId = node.factIds.get(path);
  return {
    source,
    value,
    ...(factId === undefined ? {} : { ref: evidenceEntryRef(factId) }),
  };
}

function evaluateObligation(obligation: EvidenceObligation, context: ObligationContext): Verification {
  const resolved = obligation.sources
    .map((source) => resolveSource(source, context))
    .filter((entry): entry is ResolvedObligationSource => entry !== undefined);
  const evidence = resolved
    .map((entry) => entry.ref)
    .filter((ref): ref is string => ref !== undefined);

  if (obligation.rule === "equals-literal") {
    const [only] = resolved;
    if (only === undefined) {
      return {
        id: context.obligationId,
        obligation: obligation.obligation,
        mandatory: obligation.mandatory,
        verdict: "absent",
        evidence: [],
      };
    }
    return {
      id: context.obligationId,
      obligation: obligation.obligation,
      mandatory: obligation.mandatory,
      verdict: only.value === obligation.literal ? "verified" : "ambiguous",
      evidence,
    };
  }

  if (resolved.length === 0) {
    return {
      id: context.obligationId,
      obligation: obligation.obligation,
      mandatory: obligation.mandatory,
      verdict: "absent",
      evidence: [],
    };
  }
  if (resolved.length !== obligation.sources.length || resolved.some(entry => entry.value === null)) {
    // ONE side is not agreement. Reporting `verified` here would be exactly the
    // silent-shrink this whole program forbids.
    return {
      id: context.obligationId,
      obligation: obligation.obligation,
      mandatory: obligation.mandatory,
      verdict: "unknown",
      evidence,
    };
  }
  const canonical = resolved.map((entry) => canonicalJsonStringify(entry.value));
  const agree = canonical.every((value) => value === canonical[0]);
  return {
    id: context.obligationId,
    obligation: obligation.obligation,
    mandatory: obligation.mandatory,
    verdict: agree ? "verified" : "ambiguous",
    evidence: evidence.length > 0 ? evidence : [],
  };
}
