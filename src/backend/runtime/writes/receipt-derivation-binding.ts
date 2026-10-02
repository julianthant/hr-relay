/**
 * D199 — what a settled run's evidence receipt actually binds to (ref operator-trust §2.3).
 *
 * A receipt is D141's pure function of authority: derive it again over the same
 * terminal run and the same durable rows and you must get the same bytes, which
 * is why `evidenceReceipts.insert` refuses a divergent rebuild by name. That
 * promise is only worth something if the derivation SURVIVES the tree moving
 * around it — a receipt is read months after the run, by an operator who is
 * finishing a double-check on a real HR transaction.
 *
 * It did not. `buildRunEvidenceReceipt` stamped the CURRENT build's
 * `descriptor.contractFingerprint` into a record that describes a run which
 * executed under a different one, so the moment anything anywhere in a ~31-file
 * descriptor closure changed, every already-settled run's receipt re-derived to
 * different bytes and the immutable insert correctly refused it. Chunk 2's five
 * live-proof `separations-kuali-read` receipts were stranded exactly this way by
 * a raw-control-byte fix that changed no semantics at all.
 *
 * Two things are wrong with binding a receipt to the closure hash, and they
 * point in OPPOSITE directions:
 *
 * - **The hash is not necessary.** Nearly every edit inside the closure leaves
 *   every surface the derivation reads untouched. This is D136's finding for
 *   parked writes, and a receipt is the same shape of promise.
 * - **The hash is not sufficient either** — and this is where a receipt differs
 *   from a parked write. The declared redaction table
 *   (`src/domain/trust/evidence-classification.ts`) and the declared
 *   cross-source obligations are NOT in any descriptor's import closure, so
 *   they can move with `contractFingerprint` byte-identical. D197 moved one and
 *   two receipts changed content under a frozen hash.
 *
 * So the fingerprint is not the binding at all. The run's OWN retained
 * `envelope.contractFingerprint` is the honest value for the receipt's
 * `descriptorFingerprint` field — it is a fact about the run, read from
 * authority — and resolvability is stated directly, one named check at a time,
 * against the surfaces the derivation actually consumes.
 *
 * **The surfaces `buildRunEvidenceReceipt` consumes, exhaustively:** the
 * workflow id (identity, both evidence scope keys, the obligation lookup); the
 * descriptor version; the runtime node walk (node ids, kinds, `dependsOn`, and
 * each node's task contract id / effect / freshness bound / subject binding);
 * `descriptor.details` (which leaves are mandatory); the terminal execution's
 * `dependsOn` set; the declared obligations for the workflow; the declared gate
 * decisions for every gate node it describes (D204); and the declared redaction
 * for every scope it redacts through. Everything else it reads is a durable
 * authority row, which is immutable and cannot move.
 *
 * **May change** — anything in the closure that leaves the checks below held:
 * an unrelated module in the same import graph, comments, formatting, a control
 * byte escaped to its `\u0000` form, a sibling workflow, a driver gaining an
 * operation.
 *
 * **May not change** — the workflow id; the descriptor version; the presence of
 * every node the run's durable evidence names, still owning the same task
 * contract — and, for a node a `gate_results` row names, still BEING a gate;
 * the canonical-input schema the stored input snapshot is bound to;
 * the terminal dependency set the stored result was built against; and, for a
 * run whose receipt is already stored, the declared evidence itself — the
 * redaction verdict, the mandatory declaration and the obligation set the
 * stored receipt retained.
 *
 * There is no waiver, no override flag and no "force" arm. A refusal prints the
 * whole check table with both fingerprints, because the honest repair is to
 * restore the declaration or accept that the receipt is frozen — never to
 * overwrite an operator-facing record of a real HR transaction with a newer
 * story about it.
 */
import { z } from "zod";
import {
  descriptorRuntimeNodes,
  workflowDryRunSupport,
  workflowTerminalResultExecution,
  type AnyWorkflowDescriptor,
} from "../../../workflow-kit/workflow.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import type { RunRecord } from "../../../models/run/record.js";
import type { RunResultRecord } from "../../../models/run/result.js";
import type { GateResultRecord } from "../../../models/workflow/gates.js";
import { deriveSchemaHash } from "../../../models/validation/schema-bound-value.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import type { RunEvidenceReceipt } from "../../../models/trust/evidence.js";
import type { RunCheckpointRecord } from "../../../models/workflow/checkpoint.js";
import type { WriteIntentRecord } from "../../../rules/write-safety/write-safety.js";

/**
 * The named semantic checks, in evaluation order. Adding one is a contract
 * change (ref operator-trust §2.3 owns the list); removing one lets a receipt be re-derived
 * against a declaration it was never built under.
 */
export const ReceiptBindingCheckSchema = z.enum([
  "workflow-identity",
  "descriptor-version",
  "canonical-input",
  "evidence-graph",
  "terminal-dependency-set",
  "declared-evidence",
]);
export type ReceiptBindingCheck = z.infer<typeof ReceiptBindingCheckSchema>;

/**
 * Which declaration owns a divergence the `declared-evidence` check found. The
 * receipt's own paths are partitioned across these, so every divergent path is
 * attributed to exactly one of them rather than to "something changed".
 */
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
  /**
   * `held` — proved equivalent. `moved` — proved different (a refusal).
   * `not-evaluated` — a prerequisite moved, or the baseline this check reads
   * does not exist for this run; it is NEVER reported as held, because "we
   * could not look" and "we looked and it matched" must stay distinguishable.
   */
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
  /** Present exactly when the run ended `done`. */
  readonly result?: RunResultRecord;
  /** Every checkpoint row for the run's logical item, any attempt. */
  readonly checkpoints: readonly RunCheckpointRecord[];
  /** Every write intent this run fenced. */
  readonly writes?: readonly WriteIntentRecord[];
  /** Every `gate_results` row this run resolved (D204). */
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

/**
 * Render the whole check table, held rows included. An operator staring at a
 * refused receipt needs to see what was PROVED equivalent as much as what
 * moved — the difference between "here is the one declaration that changed" and
 * "computer says no".
 */
export function renderReceiptBindingChecks(checks: readonly ReceiptBindingCheckResult[]): string {
  const label = (result: ReceiptBindingCheckResult) =>
    result.state === "held" ? "[held] " : result.state === "moved" ? "[MOVED]" : "[skip] ";
  return checks.map((result) => `  ${label(result)} ${result.check} — ${result.detail}`).join("\n");
}

/* ── the pre-derivation evaluation ───────────────────────────────────────── */

/**
 * Checks 1–5: can THIS build honestly describe THAT run at all? Every baseline
 * is a durable authority row, so this half is evaluable on a first derivation
 * as well as on a re-derivation.
 */
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
  /*
   * D204: a gate row's node must still BE a gate. A node that stopped being one
   * is a stronger break than a node that vanished — the row would otherwise be
   * read as a decision about a step that no longer asks a human anything.
   */
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

  if (result === undefined) {
    checks.push(skipped(
      "terminal-dependency-set",
      "not evaluated: this run holds no terminal result, so authority retains no dependency set to compare",
    ));
  } else {
    /**
     * D210 — a PREVIEWED run's terminal record is not a derived result, so the
     * set it must still agree with is not `terminalDependsOn`. A preview stops
     * at the graph's first transaction node and its dependencies are THAT
     * node's own `dependsOn` — the exact upstream facts its binds read — so
     * that is the set this build re-derives and compares. Comparing against the
     * terminal set instead would refuse every preview receipt on a difference
     * that is by design, which is a check reporting the wrong baseline rather
     * than a moved declaration.
     */
    const dryRun = workflowDryRunSupport(descriptor);
    const previewed = run.envelope.dryRun;
    const declared = (previewed && dryRun.state === "supported"
      ? descriptorRuntimeNodes(descriptor)
        .find((node) => String(node.id) === dryRun.stopsAt)?.dependsOn ?? []
      : workflowTerminalResultExecution(descriptor).dependsOn).map(String);
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

/**
 * The call-site form: throw the full, legible check table when this build
 * cannot honestly describe the run.
 */
export function requireReceiptDerivationBinding(input: ReceiptDerivationBindingInput): void {
  const binding = evaluateReceiptDerivationBinding(input);
  if (binding.state === "incompatible") throw new Error(binding.message);
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

/**
 * Attribute a divergent path to the ONE declaration that produces it. Every
 * receipt path lands in exactly one owner, so a divergence is always named.
 */
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

/**
 * Walk two receipts and report every path at which they disagree. An array
 * whose LENGTH moved is reported once at the array itself rather than as a
 * cascade of shifted indices, which would name the wrong rows.
 */
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

/**
 * Check 6, evaluated only when authority already holds a receipt for this run:
 * does this build reproduce the receipt it once wrote?
 *
 * This is the one check whose baseline is the receipt row itself, and it is the
 * only check that can see a declared-redaction or declared-obligation move —
 * both live OUTSIDE every descriptor closure, so they change with
 * `contractFingerprint` byte-identical. It refuses; it never rewrites. The
 * immutable insert stays underneath it as the backstop for any caller that does
 * not come through here.
 */
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
