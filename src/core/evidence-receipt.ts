/**
 * The `RunEvidenceReceipt` builder (doc 12 §2.3, D140/D141).
 *
 * ## What this is for
 *
 * D82's acceptance bar: the receipt must let the operator finish their
 * double-check WITHOUT opening UCPath. A receipt that says "success" fails
 * that bar. This builder composes, from durable authority alone:
 *
 * - the exact subject the run bound and the proof source that matched it;
 * - every observation and output fact, with the source that established it
 *   (fresh-live this attempt, a replayed checkpoint, or an operator
 *   correction) and the instant it was observed;
 * - the decision reason behind every branch / gate / identity / dedupe
 *   outcome, including a conditional node that did not run;
 * - each commit action's write state and the binding proof it filed;
 * - a verdict per declared obligation, with the durable facts it compared;
 * - warnings ONLY where the uncertainty is non-load-bearing;
 * - one explicit confidence and one explicit result.
 *
 * ## Derived, not minted (D141)
 *
 * The receipt is a **pure function of authority**, derived on demand and
 * persisted on first derivation — it is NOT written inside the terminal
 * settlement transaction. Two reasons, in order of weight:
 *
 * 1. **Authority must never depend on a projection to terminalize.** The
 *    terminal composite (`terminalizeSuccess` / `terminalizeFailure`) is the
 *    one CAS that decides whether a real HR transaction is settled. Making it
 *    also assemble a receipt would let a receipt-shaped problem — a missing
 *    classification, an unreadable span file — block or unwind a settlement
 *    that already happened. That is the wrong failure direction.
 * 2. **The runs this program has already produced would otherwise be
 *    permanently receipt-less.** The live person-lookup exit run and the
 *    controlled Kuali commit terminalized before this code existed. A
 *    mint-only design could never explain them, which defeats the point.
 *
 * The safety property a mint-at-settlement design would have bought is bought
 * a different way: every identity the receipt carries is derived (see
 * `evidence-identity.ts`) and `generatedAt` is the terminal settlement instant
 * rather than a clock read, so re-deriving the same terminal run yields the
 * same bytes. `ensureRunEvidenceReceipt` therefore ALWAYS routes through
 * `evidenceReceipts.insert`, whose immutable-insert check refuses a divergent
 * rebuild by name instead of overwriting one. A receipt that disagrees with
 * authority is louder than no receipt, which is the requirement.
 *
 * `generatedAt = lifecycle.endedAt` is a deliberate, stated reading: the
 * receipt describes the run AS OF the instant its evidence closed. Nothing
 * about the run changes after that, so a wall-clock "when was this rendered"
 * stamp would carry no information and would destroy determinism.
 *
 * ## Bound to what it consumes, not to a closure hash (D199)
 *
 * "Re-deriving one run yields the same bytes" only holds if the derivation
 * survives the tree moving around it. It did not: `descriptorFingerprint` was
 * stamped from the CURRENT build's `descriptor.contractFingerprint`, so any
 * edit anywhere in a ~31-file descriptor closure changed a settled run's
 * receipt and the immutable insert refused it. That value is now the run's OWN
 * retained `envelope.contractFingerprint` — a fact about the run, read from
 * authority like everything else here — and resolvability is checked directly
 * against the surfaces this builder consumes. See
 * `receipt-derivation-binding.ts` for the check table and why a closure hash is
 * neither necessary NOR sufficient for a receipt.
 *
 * ## A gate's evidence is a `gate_results` row, not a checkpoint (D204)
 *
 * `gate_results` is the REPOSITORY's name (`authority.gateResults`), not a
 * table: the rows live in `checkpoint_payloads` keyed `<runId>:<gateId>`, which
 * is why the operator-facing decision sentence below says "the gate result
 * record" and names no table at all. A receipt an operator reads months later
 * must not send them looking for a table that does not exist, and re-pointing
 * the storage to make the sentence true would be renaming authority to suit a
 * string.
 *
 * D203 taught the provenance collector that; the receipt still derived from
 * checkpoints alone, so a settled gated run listed its gate node `unknown` and
 * the approver — the whole point of doc 09 §14.6 risk 6 — reached authority and
 * stopped there. The reader moves again, for the same reason D144 gave: a
 * durable record must not be fabricated into the shape its reader expected.
 *
 * A gate contributes its stored payload's leaves as observation facts sourced
 * `gate-result` (carrying the kernel's own `resolvedBy`/`resolvedAt`), ONE
 * `kind: "gate"` decision whose outcome comes from the declared arm table in
 * `src/domain/trust/gate-decisions.ts`, and a `verified` obligation. Nothing
 * about the human decision is sniffed out of the payload's field names.
 */
import { z } from "zod";
import {
  descriptorRuntimeNodes,
  workflowTerminalResultExecution,
  type AnyWorkflowDescriptor,
} from "../base/workflow.js";
import { canonicalJsonStringify } from "../domain/canonical-json.js";
import {
  ErrorCodeSchema,
  FingerprintSchema,
  type EvidenceEntryId,
} from "../domain/ids.js";
import { RunRecordSchema, type RunRecord } from "../domain/run/record.js";
import {
  RunDryRunPreviewResultSchema,
  RunResultRecordSchema,
  deriveCheckpointOutputDigest,
  deriveTerminalDependencyDigest,
  type RunResultRecord,
  type TerminalNotRunReason,
} from "../domain/run/result.js";
import { SchemaBoundCanonicalValueSchema, deriveSchemaHash } from "../domain/schema-bound-value.js";
import { sha256Hex } from "../domain/sha256.js";
import {
  evidenceLeaves,
  redactEvidenceLeaf,
  type EvidenceLeaf,
  type EvidenceValueScope,
} from "../domain/trust/evidence-classification.js";
import {
  deriveEvidenceEntryId,
  deriveEvidenceReceiptId,
  evidenceEntryRef,
} from "../domain/trust/evidence-identity.js";
import {
  gateDecisionArm,
  gateDecisionFor,
} from "../domain/trust/gate-decisions.js";
import { GateResultRecordSchema, type GateResultRecord } from "../domain/gates.js";
import {
  obligationsFor,
  type EvidenceObligation,
  type EvidenceObligationSource,
} from "../domain/trust/evidence-obligations.js";
import { RunEvidenceReceiptSchema, type RunEvidenceReceipt } from "../domain/trust/evidence.js";
import {
  evaluateReceiptDerivationBinding,
  evaluateReceiptRederivation,
  type ReceiptBindingCheckResult,
} from "./receipt-derivation-binding.js";
import { FailureRecordSchema, type FailureRecord } from "../domain/trust/failure.js";
import type { RuntimeFlowNode } from "../domain/workflow/graph.js";
import {
  RunCheckpointRecordSchema,
  type FactProvenance,
  type RunCheckpointRecord,
} from "../domain/workflow/checkpoint.js";
import {
  WriteAttemptRecordSchema,
  WriteIntentRecordSchema,
  type WriteAttemptRecord,
  type WriteIntentRecord,
} from "../domain/write-safety.js";
import type { AnyTaskContract } from "../domain/contracts/base.js";

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
  /**
   * Every `gate_results` row this run resolved (D204). Absent and empty are the
   * same answer — a run with no gate node truthfully has none — but a gate node
   * whose row is missing stays `unknown` rather than being invented.
   */
  readonly gateResults?: readonly unknown[];
}

/* ── node helpers ────────────────────────────────────────────────────────── */

function contractOf(node: RuntimeFlowNode): AnyTaskContract | undefined {
  if (node.kind === "task") return node.uses;
  if (node.kind === "transaction") return node.commit.uses;
  return undefined;
}

/**
 * A transaction node's stored output is the kernel's `TypedTransactionOutcome`
 * wrapper (`{ disposition, proofSource, output, proof }`) while its declared
 * output SCHEMA — and therefore its detail paths and its classification scope
 * — is the commit contract's own output (`outputSchemaOf` in
 * `src/base/workflow.ts`). Unwrapping here is the one place that difference is
 * reconciled, stated rather than assumed.
 */
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
  // The DURABLE outcome stores `output` and `proof` as schema-bound canonical
  // values; the in-memory graph scope carries the parsed values directly. A
  // checkpoint is always the durable form, so the bound value is unwrapped
  // here rather than sniffed for at every reader.
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

/** A `workflow:<id>/…` task contributes no browser session (doc 02 §3 / D2). */
function isLocalProjection(contract: AnyTaskContract): boolean {
  return contract.id.startsWith("workflow:");
}

function finiteFreshnessLimit(contract: AnyTaskContract): number | undefined {
  if (contract.effect !== "read") return undefined;
  const limit = contract.freshness.defaultMaxAgeMs;
  return Number.isFinite(limit) && limit > 0 ? Math.trunc(limit) : undefined;
}

/* ── receipt assembly ────────────────────────────────────────────────────── */

/**
 * The rows are assembled as schema INPUT — unbranded — and the whole receipt
 * is parsed once at the end. Branding every intermediate would mean re-parsing
 * each id at every construction site, which buys nothing: the single terminal
 * parse is what makes the record authority.
 */
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
  return FingerprintSchema.parse(sha256Hex(
    `hrauto:receipt-canonical-input:v1\0${canonicalJsonStringify(run.input.parsed)}`,
  ));
}

/**
 * The provenance row that DATES a leaf, using the covering rule
 * `src/core/task-provenance.ts` already applies: a row covers a path when it
 * names it exactly or is a dot-prefix of it, and the longest such row wins.
 *
 * `lookupPath` is the path INSIDE the stored checkpoint value, which is not
 * the same as the path inside the contract output for a transaction node: the
 * sequencer stores provenance for the wrapper's four fields (`disposition`,
 * `proofSource`, `proof`, `output`), so every commit-output leaf is dated by
 * the wrapper's `output` row. Resolving through the prefix rule rather than a
 * special case keeps one vocabulary; guessing an instant when nothing covers
 * the leaf remains forbidden, and the fact stays `unresolved`.
 */
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
  /*
   * D214 — an attempt can hold several EXECUTIONS of one node (a gate resume is
   * a fresh claim and an `always-rerun` node re-executes across it), so the tie
   * inside one attempt is broken by the claim generation. A row that names no
   * generation predates the component, and every row that names one was written
   * after it, so absence sorts LAST — the same order the authority index uses.
   */
  return records
    .filter((record) => record.nodeId === nodeId && record.attempt <= attempt)
    .sort((left, right) =>
      right.attempt - left.attempt
      || (right.claimGeneration ?? 0) - (left.claimGeneration ?? 0))[0];
}

export function buildRunEvidenceReceipt(input: ReceiptBuildInput): RunEvidenceReceipt {
  return deriveRunEvidenceReceipt(input).receipt;
}

/**
 * The same derivation, returning the D199 binding table beside the receipt.
 * `ensureRunEvidenceReceipt` needs the held rows to print a legible refusal
 * when the stored receipt no longer re-derives, and evaluating the table twice
 * would let the two answers drift.
 */
export function deriveRunEvidenceReceipt(input: ReceiptBuildInput): Readonly<{
  receipt: RunEvidenceReceipt;
  checks: readonly ReceiptBindingCheckResult[];
}> {
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
      `run ${envelope.runId} ended interrupted; doc-09 recovery will requeue or settle it, and a `
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
    // A gate row is keyed `(runId, gateId)` in authority, so a foreign one here
    // is a supply bug, not a fact about this run. It says who approved WHAT —
    // attributing another run's approval to this one is the exact wrong-subject
    // failure the gate exists to prevent.
    if (row.runId !== envelope.runId) {
      throw new Error(
        `gate result for "${row.gateId}" belongs to run ${row.runId}, not to run ${envelope.runId}; `
        + "refusing to attribute another run's operator decision to this one",
      );
    }
  }
  const gateResultsByNode = new Map<string, GateResultRecord>();
  for (const row of gateResults) gateResultsByNode.set(String(row.gateId), row);

  /*
   * D199: before describing the run at all, prove this build still owns every
   * semantic surface the description consumes. The workflow-identity refusal
   * that used to sit inline is the table's first row.
   */
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
  for (const dependency of result?.dependencies ?? []) {
    if (dependency.state === "not-run") notRunByNode.set(dependency.nodeId, dependency.reason);
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

  /** The descriptor's OWN declaration of what matters on a surface (doc 02 §1.5). */
  const declaredDetails = new Set(
    descriptor.details.map((detail) => `${detail.source.nodeId}\u0000${detail.source.fieldPath}`),
  );

  for (const node of nodes) {
    const id = String(node.id);
    const evidence = byNode.get(id);
    if (evidence === undefined) continue;
    const { record } = evidence;
    const contract = contractOf(node);

    /*
     * D204: a GATE's durable evidence is its `gate_results` row. It is read
     * before the record-less arms below because a gate never has a checkpoint
     * and never will — falling through would report `unknown` for a decision
     * authority holds in full. A gate node with no row DOES fall through: the
     * run never resolved it, and `unknown` is then the honest verdict.
     */
    if (node.kind === "gate") {
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
        });
        continue;
      }
    }

    if (record === undefined) {
      const reason = evidence.notRun;
      if (reason !== undefined) {
        // A conditional node that did not run is a DECISION with a closed
        // reason — never a silent omission (D114's `not-run` arm, mirrored).
        // Its obligation is `absent`, and NOT mandatory: an absence the
        // descriptor authored and the terminal record closed is a correct
        // outcome, not an unresolved one. The reason is what carries it.
        const decisionId = entryId("decision", `not-run.${id}`);
        decisions.push({
          id: decisionId,
          kind: "branch",
          outcome: "not-taken",
          reason: reason === "condition-false"
            ? `node "${id}" did not run: its declared \`when\` condition was false for this run's input`
            : `node "${id}" did not run: the branch controller selected another case`,
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
        /**
         * EVERY record-less node emits its obligation, not only a terminal
         * dependency (D187).
         *
         * `verificationId` is minted for every node in the graph a few lines
         * above, and a DOWNSTREAM node's derived fact cites its upstream
         * nodes' verification ids by that mint. Emitting the row only for a
         * terminal dependency therefore made the id resolvable or dangling
         * depending on a completely unrelated property — and
         * `assertEvidenceRefsResolve` correctly refused the whole receipt,
         * which turns the ONE surface whose job is to explain a run into an
         * HTTP 500.
         *
         * The state is reachable in production, not just in fixtures: doc 02
         * §5.4's `startAt` resume with `envelope.injected` (the Edit Data path,
         * D166/D168) gives a downstream node its upstream VALUE without any
         * upstream checkpoint. `unknown` is the honest verdict for "authority
         * holds no checkpoint for this node and no recorded reason it did not
         * run", and it is exactly what the operator needs to see in the
         * verification section. `mandatory` still tracks the terminal
         * dependency set, so confidence is unchanged for every receipt that
         * could already be derived.
         */
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

    const scope = scopeOf(node);
    const replayed = record.runId !== envelope.runId || record.attempt !== envelope.attempt;
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
      const write = writes.find((entry) => entry.intent.taskId === contract.id);
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
            + `${String(limit)}ms freshness limit; doc 02 §5.5's walk proved it feeds no commit `
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

  /**
   * D210 — a PREVIEWED run. The two facts must agree: the envelope says the
   * operator asked for a dry run, and the stored terminal row is bound to the
   * preview schema. Either alone would be an incoherent record, so each is
   * checked against the other rather than one being believed.
   */
  const previewResultSchemaHash = deriveSchemaHash(RunDryRunPreviewResultSchema, "output");
  const previewed = result !== undefined && result.resultSchemaHash === previewResultSchemaHash;
  if (previewed !== (envelope.dryRun && result !== undefined)) {
    throw new Error(
      `run ${envelope.runId} has dryRun=${String(envelope.dryRun)} but its terminal result is bound to `
      + `${result === undefined ? "no schema" : result.resultSchemaHash}; a receipt cannot describe a run `
      + "whose envelope and terminal record disagree about whether it committed anything",
    );
  }

  if (previewed && result !== undefined) {
    const preview = RunDryRunPreviewResultSchema.parse(result.result.value);
    /**
     * NO output facts. A preview produced no workflow result, and putting its
     * staged-then-discarded values in the section an operator reads as "what
     * this run produced" is exactly the confusion the arm exists to prevent.
     * The staged values are not lost — they are on the durable terminal row —
     * but the receipt's job is the verdict, and the verdict is "nothing".
     */
    verification.push({
      id: terminalResultVerificationId,
      obligation: "completion.terminal-result",
      mandatory: true,
      // D187: a record-less obligation reports `unknown`, which is the honest
      // verdict. It also makes `verified-done` structurally unreachable here.
      verdict: "unknown",
      evidence: [],
    });
    /*
     * D215 — the warning states what the preview actually REACHED. A preview
     * whose beat-① probe settled `already-present` staged no page and read no
     * subject, so it has no subject verdict to quote; saying so is the honest
     * report, and it is also the more useful one — it tells the operator the
     * real run would have written nothing here either.
     */
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
  } else if (result !== undefined) {
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
      byNode,
    }));
  }

  /* ── residual writes ───────────────────────────────────────────────────── */

  for (const { intent } of writes) {
    if (intent.status === "parked" || intent.status === "retryable") {
      warnings.push({
        id: entryId("warning", `residual-write.${intent.writeIntentId}`),
        code: ErrorCodeSchema.parse("RESIDUAL_WRITE_INTENT"),
        summary: `write intent ${intent.writeIntentId} for ${intent.system} key `
          + `"${intent.idempotencyKey}" is still ${intent.status}; this run left an unsettled `
          + "external write behind and only doc 09's typed operator resolutions may release it",
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

  const receipt = RunEvidenceReceiptSchema.parse({
    receiptId,
    runId: envelope.runId,
    traceId: envelope.traceId,
    workflowId: envelope.workflow,
    attempt: envelope.attempt,
    generatedAt,
    /*
     * D199: the closure the RUN executed under, retained on its own envelope —
     * never the current build's. Stamping `descriptor.contractFingerprint` here
     * made the receipt claim the run ran under whatever closure happens to be
     * checked out, which is both a false statement and the reason every settled
     * receipt was stranded by an unrelated edit.
     */
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
  });
  assertEvidenceRefsResolve(receipt);
  return Object.freeze({ receipt, checks: binding.checks });
}

/**
 * Every `observation:`/`receipt:` reference a receipt makes must land on a row
 * the SAME receipt carries. A dangling ref is a citation to nothing, which on
 * a trust surface reads exactly like a citation to something.
 */
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
  /** Every `gate_results` row this run resolved (D204). */
  listGateResultsByRun(runId: string): readonly unknown[];
  findReceiptByRun(runId: string): unknown;
  insertReceipt(receipt: unknown): Readonly<{ state: "inserted" | "existing"; record: RunEvidenceReceipt }>;
}

export type EnsureReceiptOutcome = Readonly<{
  state: "derived" | "existing";
  receipt: RunEvidenceReceipt;
}>;

/**
 * Derive the receipt for a terminal run and persist it, or return the one
 * already stored.
 *
 * The derivation ALWAYS runs, even when a row already exists, and the row is
 * always written through `insertReceipt` — whose immutable-insert check throws
 * by name when the stored bytes differ from the derived ones. That is the
 * whole safety argument for deriving rather than minting: a receipt that
 * disagrees with authority cannot be served quietly, and a stored receipt that
 * a later builder can no longer reproduce is a loud, visible fact rather than
 * an invisible one.
 *
 * D199 adds the missing half of "loud": when a stored receipt no longer
 * re-derives, the refusal NAMES the declaration that moved instead of saying
 * only that the bytes differ. `insertReceipt`'s check stays underneath as the
 * backstop for any caller that does not come through here — this path never
 * skips it.
 */
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
  const { receipt: derived, checks } = deriveRunEvidenceReceipt({
    descriptor,
    run,
    ...(lifecycle.outcome === "done" ? { result: store.getResult(runId) } : {}),
    ...(lifecycle.failureId === undefined ? {} : { failure: store.getFailure(lifecycle.failureId) }),
    checkpoints: store.listCheckpointsByRun(runId),
    writes: store.listWritesByRun(runId),
    gateResults: store.listGateResultsByRun(runId),
  });
  const existing: unknown = store.findReceiptByRun(runId);
  if (existing !== undefined && existing !== null) {
    const rederivation = evaluateReceiptRederivation({
      run,
      descriptor,
      stored: RunEvidenceReceiptSchema.parse(existing),
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

/* ── gate evidence (D204) ────────────────────────────────────────────────── */

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
}

/**
 * One resolved gate, as receipt rows: its payload's leaves as facts sourced
 * from the operator decision, ONE `gate` decision, and a `verified` obligation.
 *
 * The three values that answer §14.6 risk 6 — WHO, WHEN, and on WHAT evidence —
 * come from three different places on purpose. `resolvedBy` and `resolvedAt`
 * are the kernel's own fields on the durable record and are stamped onto every
 * fact's source; the decision arm and the bound-evidence digest are payload
 * leaves, resolved through the DECLARED table rather than by field name.
 */
function emitGateEvidence(input: GateEvidenceInput): void {
  const { stored, nodeId, entryId, evidence } = input;
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
  // A bound-evidence leaf names WHAT was approved, so it has to be a value an
  // operator can compare by eye against the packet's own digest. A structure
  // there is a declaration error, not something to stringify into the reason.
  if (boundLeaf !== undefined && typeof boundLeaf.value !== "string") {
    throw new Error(
      `gate "${nodeId}" of ${input.workflowId} declares "${String(declaration.boundEvidencePath)}" as its `
      + `bound evidence and stored ${canonicalJsonStringify(boundLeaf.value)} there; a bound-evidence leaf `
      + "must be a single comparable identity",
    );
  }
  const bound: string | undefined = typeof boundLeaf?.value === "string" ? boundLeaf.value : undefined;
  const decisionId = entryId("decision", `gate.${nodeId}`);
  input.decisions.push({
    id: decisionId,
    kind: "gate",
    outcome: arm.outcome,
    reason: `${arm.summary}: gate "${nodeId}" was resolved \`${arm.value}\` by `
      + `${stored.resolvedBy} at ${stored.resolvedAt} through command ${stored.commandId}`
      + (bound === undefined
        ? ""
        : `, bound to the identity evidence it was granted on `
          + `(${String(declaration.boundEvidencePath)} ${bound})`)
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

/* ── fact construction ───────────────────────────────────────────────────── */

interface ObservationFactInput {
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
  /** Appended to for an operator correction's superseded twin. */
  readonly supersededFacts: Fact[];
}

function observationFact(input: ObservationFactInput): Fact {
  const {
    factId, entryId, nodeId, taskId, leaf, scope, provenance, replayed, checkpointFingerprint, writtenAt,
  } = input;
  const value = redactEvidenceLeaf(scope, leaf);
  const base = { id: factId, field: leaf.field, mandatory: input.mandatory, state: "satisfied" as const, value };

  if (provenance === undefined) {
    // A leaf with no provenance row cannot be dated, and a receipt never dates
    // a fact by guessing. The checkpoint it came from is still named — what is
    // unresolved is WHEN it was observed, and the fact says exactly that.
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
    // The checkpoint proves the commit path ran, but no durable intent was
    // supplied. `committed` is the truthful floor: the run has a schema-bound
    // outcome and this receipt has no proof to file.
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
    return `the permanent key ${intent.system}/"${intent.idempotencyKey}" was already satisfied and `
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
  if (source.kind === "workflow-input") {
    if (!context.inputValues.has(source.path)) return undefined;
    return { source, value: context.inputValues.get(source.path) };
  }
  const node = context.byNode.get(String(source.nodeId));
  if (node === undefined || !node.values.has(source.path)) return undefined;
  const factId = node.factIds.get(source.path);
  return {
    source,
    value: node.values.get(source.path),
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
  if (resolved.length === 1) {
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
