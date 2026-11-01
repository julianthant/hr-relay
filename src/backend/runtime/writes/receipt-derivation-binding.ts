
import { z } from "zod";
import {
  descriptorRuntimeNodes,
  workflowDryRunSupport,
  workflowTerminalResultExecution,
  type AnyWorkflowDescriptor,
} from "../../../workflow-kit/workflow.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import type { RunRecord } from "../../../models/run/record.js";
import { RunDryRunPreviewResultSchema, terminalEvidenceResult, type RunResultRecord } from "../../../models/run/result.js";
import type { GateResultRecord } from "../../../models/workflow/gates.js";
import { deriveSchemaHash } from "../../../models/validation/schema-bound-value.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import type { RunEvidenceReceipt } from "../../../models/trust/evidence.js";
import type { RunCheckpointRecord } from "../../../models/workflow/checkpoint.js";
import type { WriteIntentRecord } from "../../../rules/write-safety/write-safety.js";


export const ReceiptBindingCheckSchema = z.enum([
  "workflow-identity",
  "descriptor-version",
  "canonical-input",
  "evidence-graph",
  "terminal-dependency-set",
  "declared-evidence",
]);
export type ReceiptBindingCheck = z.infer<typeof ReceiptBindingCheckSchema>;


export const ReceiptEvidenceOwnerSchema = z.enum([
  "declared-redaction",
  "declared-details",
  "declared-obligations",
  "terminal-dependency-set",
  "run-identity",
  "receipt-composition",
]);
export type ReceiptEvidenceOwner = z.infer<typeof ReceiptEvidenceOwnerSchema>;

export const ReceiptBindingCheckResultSchema = z.strictObject({
  check: ReceiptBindingCheckSchema,
  // Not-evaluated is distinct from held; a moved prerequisite supplies no equivalence proof.
  state: z.enum(["held", "moved", "not-evaluated"]),
  detail: z.string().min(1),
});
export type ReceiptBindingCheckResult = z.infer<typeof ReceiptBindingCheckResultSchema>;

export type ReceiptDerivationBinding =
  | Readonly<{
    state: "compatible";
    storedContractFingerprint: string;
    currentContractFingerprint: string;
    checks: readonly ReceiptBindingCheckResult[];
  }>
  | Readonly<{
    state: "incompatible";
    storedContractFingerprint: string;
    currentContractFingerprint: string;
    checks: readonly ReceiptBindingCheckResult[];
    /** The first check that moved — the headline of the refusal. */
    moved: ReceiptBindingCheck;
    message: string;
  }>;

export interface ReceiptDerivationBindingInput {
  readonly descriptor: AnyWorkflowDescriptor;
  readonly run: RunRecord;
  /** The immutable success result or truthful final evidence owner. */
  readonly result?: RunResultRecord;
  /** Every checkpoint row for the run's logical item, any attempt. */
  readonly checkpoints: readonly RunCheckpointRecord[];
  /** Every write intent this run fenced. */
  readonly writes?: readonly WriteIntentRecord[];

  readonly gateResults?: readonly GateResultRecord[];
}

/* ── rendering ───────────────────────────────────────────────────────────── */

function held(check: ReceiptBindingCheck, detail: string): ReceiptBindingCheckResult {
  return ReceiptBindingCheckResultSchema.parse({ check, state: "held", detail });
}

function moved(check: ReceiptBindingCheck, detail: string): ReceiptBindingCheckResult {
  return ReceiptBindingCheckResultSchema.parse({ check, state: "moved", detail });
}

function skipped(check: ReceiptBindingCheck, detail: string): ReceiptBindingCheckResult {
  return ReceiptBindingCheckResultSchema.parse({ check, state: "not-evaluated", detail });
}

const SHORT = 12;
function short(fingerprint: string): string {
  return `${fingerprint.slice(0, SHORT)}…`;
}


export function renderReceiptBindingChecks(checks: readonly ReceiptBindingCheckResult[]): string {
  const label = (result: ReceiptBindingCheckResult) =>
    result.state === "held" ? "[held] " : result.state === "moved" ? "[MOVED]" : "[skip] ";
  return checks.map((result) => `  ${label(result)} ${result.check} — ${result.detail}`).join("\n");
}

/* ── the pre-derivation evaluation ───────────────────────────────────────── */


export function evaluateReceiptDerivationBinding(
  input: ReceiptDerivationBindingInput,
): ReceiptDerivationBinding {
  const { descriptor, run, result } = input;
  const stored = run.envelope.contractFingerprint;
  const current = descriptor.contractFingerprint;
  const checks: ReceiptBindingCheckResult[] = [];

  checks.push(descriptor.id === run.envelope.workflow
    ? held("workflow-identity", `both name workflow ${descriptor.id}`)
    : moved(
      "workflow-identity",
      `run ${run.envelope.runId} is workflow ${run.envelope.workflow} and the supplied descriptor is `
      + `${descriptor.id}; refusing to explain a run with another workflow's graph`,
    ));

  if (checks[0]?.state === "moved") {
    for (const check of ["descriptor-version", "canonical-input", "evidence-graph", "terminal-dependency-set"] as const) {
      checks.push(skipped(check, "not evaluated: it needs workflow-identity, which moved"));
    }
    return refuse(stored, current, checks);
  }

  checks.push(descriptor.version === run.envelope.descriptorVersion
    ? held("descriptor-version", `both are v${String(descriptor.version)}`)
    : moved(
      "descriptor-version",
      `the run was planned under v${String(run.envelope.descriptorVersion)} and this build declares `
      + `v${String(descriptor.version)}; a version bump declares that semantics moved`,
    ));

  const currentInputHash = deriveSchemaHash(descriptor.canonicalInput, "output");
  checks.push(currentInputHash === run.input.parsed.schemaHash
    ? held("canonical-input", `both bind canonical schema ${short(currentInputHash)}`)
    : moved(
      "canonical-input",
      `the run's input snapshot is bound to canonical schema ${short(run.input.parsed.schemaHash)} and `
      + `this build parses ${short(currentInputHash)}; the input facts would be redacted under a `
      + "declaration authored for a different shape",
    ));

  const nodes = descriptorRuntimeNodes(descriptor);
  const nodeIds = new Set(nodes.map((node) => String(node.id)));
  const gateNodeIds = new Set(nodes.flatMap((node) => (node.kind === "gate" ? [String(node.id)] : [])));
  const commitTaskIds = new Set(nodes.flatMap((node) =>
    node.kind === "transaction" ? [String(node.commit.uses.id)] : []));
  const graphGaps: string[] = [];
  for (const record of input.checkpoints) {
    if (!nodeIds.has(String(record.nodeId))) {
      graphGaps.push(`checkpoint node "${record.nodeId}" left the graph`);
    }
  }

  for (const row of input.gateResults ?? []) {
    if (!gateNodeIds.has(String(row.gateId))) {
      graphGaps.push(
        nodeIds.has(String(row.gateId))
          ? `gate result node "${row.gateId}" is no longer a gate in this build`
          : `gate result node "${row.gateId}" left the graph`,
      );
    }
  }
  for (const dependency of result?.dependencies ?? []) {
    if (!nodeIds.has(String(dependency.nodeId))) {
      graphGaps.push(`terminal dependency "${String(dependency.nodeId)}" left the graph`);
    }
  }
  for (const intent of input.writes ?? []) {
    if (!commitTaskIds.has(String(intent.taskId))) {
      graphGaps.push(`no transaction node commits "${intent.taskId}", which intent ${intent.writeIntentId} fenced`);
    }
  }
  checks.push(graphGaps.length === 0
    ? held(
      "evidence-graph",
      `every node this run's durable evidence names still resolves in this build `
      + `(${String(input.checkpoints.length)} checkpoint(s), ${String((result?.dependencies ?? []).length)} `
      + `terminal dependency/ies, ${String((input.writes ?? []).length)} write intent(s), `
      + `${String((input.gateResults ?? []).length)} gate result(s))`,
    )
    : moved("evidence-graph", `this build cannot interpret the run's durable evidence: ${graphGaps.join("; ")}`));

  if (result === undefined || terminalEvidenceResult(result) !== undefined) {
    checks.push(skipped(
      "terminal-dependency-set",
      "not evaluated: no workflow output was derived, so there is no terminal derivation dependency set",
    ));
  } else {
    // Preview terminal dependencies bind the preview boundary, not ordinary workflow success dependencies.
    const dryRun = workflowDryRunSupport(descriptor);
    const previewed = run.envelope.dryRun;
    const preview = previewed ? RunDryRunPreviewResultSchema.parse(result.result.value) : undefined;
    const firstDependencies = dryRun.state === "supported" ? descriptorRuntimeNodes(descriptor)
      .find(node => String(node.id) === dryRun.firstTransactionNodeId)?.dependsOn ?? [] : [];
    const declared = preview === undefined ? workflowTerminalResultExecution(descriptor).dependsOn.map(String)
      : [...new Set([...firstDependencies.map(String), ...descriptorRuntimeNodes(descriptor)
        .filter(node => node.kind === "task" && preview.steps.some(step => step.nodeId === node.id && step.state === "exercised"))
        .map(node => String(node.id))])];
    const retained = result.dependencies.map((dependency) => String(dependency.nodeId));
    checks.push(canonicalJsonStringify([...declared].sort()) === canonicalJsonStringify([...retained].sort())
      ? held("terminal-dependency-set", `both depend on [${declared.join(", ")}]`)
      : moved(
        "terminal-dependency-set",
        `the stored result was built from [${retained.join(", ")}] and this build's `
        + `${run.envelope.dryRun ? "dry-run preview" : "terminal execution"} depends on `
        + `[${declared.join(", ")}]; the mandatory-evidence set would move`,
      ));
  }

  return checks.some((check) => check.state === "moved")
    ? refuse(stored, current, checks)
    : Object.freeze({
      state: "compatible",
      storedContractFingerprint: stored,
      currentContractFingerprint: current,
      checks: Object.freeze(checks),
    });
}


/* ── the re-derivation check (6) ─────────────────────────────────────────── */

/** One path at which a stored receipt and this build's derivation disagree. */
export interface ReceiptDivergence {
  readonly path: string;
  readonly owner: ReceiptEvidenceOwner;
  readonly stored: string;
  readonly derived: string;
}

const REDACTION_PATH = /^(?:input|observations|output)\[\d+\]\.value(?:\.|$)/u;
const MANDATORY_PATH = /^(?:input|observations|output)\[\d+\]\.mandatory$/u;
const IDENTITY_PATHS: ReadonlySet<string> = new Set([
  "receiptId", "runId", "traceId", "workflowId", "attempt", "generatedAt",
  "descriptorFingerprint", "configFingerprint", "retryOf", "failure",
]);


function ownerOf(path: string): ReceiptEvidenceOwner {
  const root = path.split(/[.[]/u)[0] ?? path;
  if (IDENTITY_PATHS.has(root)) return "run-identity";
  if (REDACTION_PATH.test(path)) return "declared-redaction";
  if (MANDATORY_PATH.test(path)) return "declared-details";
  if (/^verification\[\d+\]\.mandatory$/u.test(path)) return "terminal-dependency-set";
  if (root === "verification") return "declared-obligations";
  return "receipt-composition";
}

function describeEvidence(value: unknown): string {
  if (value === undefined) return "(absent)";
  return `evidence digest ${short(sha256Hex(canonicalJsonStringify(value)))}`;
}

const OPAQUE_RECEIPT_VALUE_PATH =
  /^(?:(?:input|observations|output)\[\d+\]\.value\.value|actions\[\d+\]\.proved\.values\[\d+\]\.value)$/u;


export function diffReceipts(
  stored: RunEvidenceReceipt,
  derived: RunEvidenceReceipt,
): readonly ReceiptDivergence[] {
  const divergences: ReceiptDivergence[] = [];
  const walk = (path: string, left: unknown, right: unknown): void => {
    if (canonicalJsonStringify(left) === canonicalJsonStringify(right)) return;
    if (OPAQUE_RECEIPT_VALUE_PATH.test(path)) {
      divergences.push({
        path,
        owner: ownerOf(path),
        stored: describeEvidence(left),
        derived: describeEvidence(right),
      });
      return;
    }
    if (Array.isArray(left) && Array.isArray(right)) {
      if (left.length !== right.length) {
        divergences.push({
          path,
          owner: ownerOf(path),
          stored: `${String(left.length)} row(s)`,
          derived: `${String(right.length)} row(s)`,
        });
        return;
      }
      left.forEach((entry, index) => { walk(`${path}[${String(index)}]`, entry, right[index]); });
      return;
    }
    const isPlain = (value: unknown): value is Record<string, unknown> =>
      typeof value === "object" && value !== null && !Array.isArray(value);
    if (isPlain(left) && isPlain(right)) {
      for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
        walk(path === "" ? key : `${path}.${key}`, left[key], right[key]);
      }
      return;
    }
    divergences.push({
      path,
      owner: ownerOf(path),
      stored: describeEvidence(left),
      derived: describeEvidence(right),
    });
  };
  walk("", stored, derived);
  return Object.freeze(divergences);
}

// Stored-receipt comparison requires an existing baseline; it cannot run on first derivation.
export function evaluateReceiptRederivation(input: {
  readonly run: RunRecord;
  readonly descriptor: AnyWorkflowDescriptor;
  readonly stored: RunEvidenceReceipt;
  readonly derived: RunEvidenceReceipt;
  readonly checks: readonly ReceiptBindingCheckResult[];
}): ReceiptDerivationBinding {
  const storedFingerprint = input.run.envelope.contractFingerprint;
  const current = input.descriptor.contractFingerprint;
  const divergences = diffReceipts(input.stored, input.derived);
  const checks = [...input.checks];
  if (divergences.length === 0) {
    checks.push(held(
      "declared-evidence",
      `this build re-derives receipt ${input.stored.receiptId} byte-identically from authority`,
    ));
    return Object.freeze({
      state: "compatible",
      storedContractFingerprint: storedFingerprint,
      currentContractFingerprint: current,
      checks: Object.freeze(checks),
    });
  }
  const byOwner = new Map<ReceiptEvidenceOwner, ReceiptDivergence[]>();
  for (const divergence of divergences) {
    const bucket = byOwner.get(divergence.owner) ?? [];
    bucket.push(divergence);
    byOwner.set(divergence.owner, bucket);
  }
  const summary = [...byOwner.entries()].map(([owner, rows]) => {
    const first = rows[0];
    if (first === undefined) throw new Error("an attributed divergence bucket must hold at least one row");
    return `${owner} (${String(rows.length)} path(s), e.g. ${first.path}: `
      + `stored ${first.stored} → this build ${first.derived})`;
  });
  checks.push(moved(
    "declared-evidence",
    `this build no longer re-derives stored receipt ${input.stored.receiptId}; `
    + `${String(divergences.length)} path(s) moved, owned by ${summary.join("; ")}`,
  ));
  return refuse(storedFingerprint, current, checks);
}

/* ── refusal ─────────────────────────────────────────────────────────────── */

function refuse(
  stored: string,
  current: string,
  checks: readonly ReceiptBindingCheckResult[],
): ReceiptDerivationBinding {
  const first = checks.find((result) => result.state === "moved");
  if (first === undefined) throw new Error("a receipt-derivation refusal must name the check that moved");
  return Object.freeze({
    state: "incompatible",
    storedContractFingerprint: stored,
    currentContractFingerprint: current,
    checks: Object.freeze([...checks]),
    moved: first.check,
    message: `refusing to derive this run's evidence receipt: ${first.check} moved.\n`
      + `the run ran under contract closure ${short(stored)} and this build is ${short(current)}, so the `
      + "closure hash alone proves nothing in either direction; each named check below was re-verified "
      + "directly.\n"
      + `${renderReceiptBindingChecks(checks)}\n`
      + `restore ${first.check} or accept that this receipt is frozen — a settled run's operator-facing `
      + "record is never overwritten with a newer story about what happened",
  });
}
