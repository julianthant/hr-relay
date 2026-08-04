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
  RunResultRecordSchema,
  deriveCheckpointOutputDigest,
  deriveTerminalDependencyDigest,
  type RunResultRecord,
  type TerminalNotRunReason,
} from "../domain/run/result.js";
import { SchemaBoundCanonicalValueSchema } from "../domain/schema-bound-value.js";
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
  obligationsFor,
  type EvidenceObligation,
  type EvidenceObligationSource,
} from "../domain/trust/evidence-obligations.js";
import { RunEvidenceReceiptSchema, type RunEvidenceReceipt } from "../domain/trust/evidence.js";
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
  return records
    .filter((record) => record.nodeId === nodeId && record.attempt <= attempt)
    .sort((left, right) => right.attempt - left.attempt)[0];
}

export function buildRunEvidenceReceipt(input: ReceiptBuildInput): RunEvidenceReceipt {
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
  if (envelope.workflow !== descriptor.id) {
    throw new Error(
      `run ${envelope.runId} is workflow ${envelope.workflow} and the supplied descriptor is `
      + `${descriptor.id}; refusing to explain a run with another workflow's graph`,
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
    descriptor.details.map((detail) => `${detail.source.nodeId} ${detail.source.fieldPath}`),
  );

  for (const node of nodes) {
    const id = String(node.id);
    const evidence = byNode.get(id);
    if (evidence === undefined) continue;
    const { record } = evidence;
    const contract = contractOf(node);

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
      } else if (terminalDependencies.has(id)) {
        verification.push({
          id: evidence.verificationId,
          obligation: `node.${id}`,
          mandatory: true,
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
      const mandatory = declaredDetails.has(`${id} ${leaf.path}`);
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

  if (result !== undefined) {
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
    descriptorFingerprint: descriptor.contractFingerprint,
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
  return receipt;
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
  const derived = buildRunEvidenceReceipt({
    descriptor,
    run,
    ...(lifecycle.outcome === "done" ? { result: store.getResult(runId) } : {}),
    ...(lifecycle.failureId === undefined ? {} : { failure: store.getFailure(lifecycle.failureId) }),
    checkpoints: store.listCheckpointsByRun(runId),
    writes: store.listWritesByRun(runId),
  });
  const stored = store.insertReceipt(derived);
  return Object.freeze({
    state: stored.state === "inserted" ? "derived" : "existing",
    receipt: stored.record,
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
