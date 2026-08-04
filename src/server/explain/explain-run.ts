/**
 * `explain run <traceId|runId> [--json] [--bundle <dir>]` — doc 12 §2.5's
 * canonical debug entry point (D139).
 *
 * The section list is the doc's, in the doc's order: current/terminal state,
 * node timeline, checkpoint reuse, subject bindings, failure fingerprint, last
 * successful action, open gate/dependency, command history, notification
 * state, write intent/proof, and the concrete next safe action.
 *
 * Two rules shape what it prints.
 *
 * 1. **It reads authority, and it says so when authority has nothing.** A
 *    section whose backing service has not landed prints a named absence
 *    ("the notification inbox lands with the 2g inbox slice") rather than an
 *    empty heading an operator would read as "nothing happened". The two are
 *    completely different facts and this command exists to keep them apart.
 * 2. **The evidence receipt IS the explanation of a settled run.** For a
 *    terminal run the command derives the same receipt the dashboard serves
 *    and reads the sections off it, so a terminal explanation and a terminal
 *    receipt can never disagree — they are one derivation.
 */
import { z } from "zod";
import type { RunEvidenceReceipt } from "../../domain/trust/evidence.js";
import type { FailureRecord } from "../../domain/trust/failure.js";
import type { RunRecord } from "../../domain/run/record.js";
import type { RunCheckpointRecord } from "../../domain/workflow/checkpoint.js";
import type { WriteIntentRecord } from "../../domain/write-safety.js";
import type { RemediationActionSchema } from "../../domain/trust/failure.js";

/* ── the view ────────────────────────────────────────────────────────────── */

const AbsenceSchema = z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) });

function present<Value extends z.ZodType>(value: Value) {
  return z.discriminatedUnion("state", [
    AbsenceSchema,
    z.strictObject({ state: z.literal("present"), value }),
  ]);
}

export const ExplainRunViewSchema = z.strictObject({
  runId: z.string().min(1),
  traceId: z.string().min(1),
  workflowId: z.string().min(1),
  attempt: z.number().int().positive(),
  state: z.string().min(1),
  outcome: present(z.string().min(1)),
  dryRun: z.boolean(),
  resolvedInstance: z.record(z.string(), z.string()),
  timeline: z.array(z.strictObject({
    nodeId: z.string().min(1),
    disposition: z.enum(["observed-this-attempt", "replayed-from-checkpoint", "not-run", "no-record"]),
    detail: z.string().min(1),
  })),
  reuse: z.array(z.strictObject({
    nodeId: z.string().min(1),
    kind: z.string().min(1),
    ageMs: z.number().int().nonnegative(),
    freshnessLimitMs: z.number().int().positive(),
  })),
  subjectBindings: z.array(z.strictObject({
    source: z.string().min(1),
    verdict: z.string().min(1),
    reason: z.string().min(1),
  })),
  failure: present(z.strictObject({
    failureId: z.string().min(1),
    fingerprint: z.string().min(1),
    code: z.string().min(1),
    summary: z.string().min(1),
    writeState: z.string().min(1),
    sameFingerprintSeen: z.number().int().positive(),
  })),
  lastSuccessfulAction: present(z.string().min(1)),
  openGate: present(z.string().min(1)),
  openDependency: present(z.string().min(1)),
  commandHistory: z.discriminatedUnion("state", [
    AbsenceSchema,
    z.strictObject({ state: z.literal("present"), entries: z.array(z.string().min(1)) }),
  ]),
  notifications: AbsenceSchema,
  writes: z.array(z.strictObject({
    writeIntentId: z.string().min(1),
    system: z.string().min(1),
    status: z.string().min(1),
    idempotencyKey: z.string().min(1),
    proof: z.string().min(1),
  })),
  receipt: present(z.strictObject({
    receiptId: z.string().min(1),
    result: z.string().min(1),
    confidence: z.string().min(1),
    verification: z.array(z.strictObject({
      obligation: z.string().min(1),
      mandatory: z.boolean(),
      verdict: z.string().min(1),
    })),
    warnings: z.array(z.string().min(1)),
  })),
  nextSafeAction: z.string().min(1),
});
export type ExplainRunView = z.infer<typeof ExplainRunViewSchema>;

/* ── assembly ────────────────────────────────────────────────────────────── */

export interface ExplainRunEvidence {
  readonly run: RunRecord;
  readonly checkpoints: readonly RunCheckpointRecord[];
  readonly writes: readonly WriteIntentRecord[];
  readonly failure?: FailureRecord;
  readonly sameFingerprintSeen?: number;
  readonly receipt?: RunEvidenceReceipt;
  readonly nodeIds: readonly string[];
  readonly dependencies: readonly { readonly nodeId: string; readonly state: string }[];
  /** Absent until the command projection exposes a by-run query (see below). */
  readonly commandHistory?: readonly string[];
}

type Remediation = z.infer<typeof RemediationActionSchema>;

function nextSafeAction(run: RunRecord, failure: readonly Remediation[]): string {
  const { lifecycle } = run;
  switch (lifecycle.state) {
    case "terminal":
      switch (lifecycle.outcome) {
        case "done":
          return "Nothing. This run is settled; its receipt is the record.";
        case "failed":
          return failure.length === 0
            ? "The failure record names no remediation; investigate at the source before re-running."
            : failure.map((entry) => `[${entry.kind}] ${entry.message}`).join("\n              ");
        case "interrupted":
          return "Nothing by hand. Doc-09 recovery will requeue or settle this run; a manual "
            + "transition here would race it.";
        default:
          return `This run ended ${lifecycle.outcome}. Start a new run if the work still needs doing.`;
      }
    case "parked-write":
      return `Resolve the parked write through the typed operator commands only (doc 09 §4.1): `
        + `intent ${lifecycle.writeIntentId} generation ${String(lifecycle.intentGeneration)}, `
        + `park code "${lifecycle.code}" — ${lifecycle.message}. Never edit the row.`;
    case "parked-gate":
      return `Resolve gate ${lifecycle.gateId}; the run resumes at node "${lifecycle.resumeAt}".`;
    case "queued":
      return lifecycle.notBefore === undefined
        ? "Nothing. A worker will claim this run."
        : `Nothing until ${lifecycle.notBefore}, when its backoff expires.`;
    default:
      return `Nothing. Worker ${lifecycle.workerId} holds the claim (last heartbeat ${lifecycle.heartbeatAt}).`;
  }
}

export function buildExplainRunView(evidence: ExplainRunEvidence): ExplainRunView {
  const { run } = evidence;
  const { envelope, lifecycle } = run;
  const notRun = new Map(evidence.dependencies
    .filter((entry) => entry.state !== "resolved")
    .map((entry) => [entry.nodeId, entry.state]));
  const byNode = new Map(evidence.checkpoints.map((record) => [String(record.nodeId), record]));

  const timeline = evidence.nodeIds.map((nodeId) => {
    const record = byNode.get(nodeId);
    if (record === undefined) {
      const reason = notRun.get(nodeId);
      return reason === undefined
        ? {
          nodeId,
          disposition: "no-record" as const,
          detail: "no checkpoint and no closed not-run reason; this node did not reach a durable outcome",
        }
        : { nodeId, disposition: "not-run" as const, detail: `closed reason: ${reason}` };
    }
    const replayed = record.runId !== envelope.runId || record.attempt !== envelope.attempt;
    return {
      nodeId,
      disposition: replayed ? ("replayed-from-checkpoint" as const) : ("observed-this-attempt" as const),
      detail: replayed
        ? `checkpoint written by run ${record.runId} attempt ${String(record.attempt)} at ${record.writtenAt}`
        : `observed at ${record.writtenAt}`,
    };
  });

  const receipt = evidence.receipt;
  const lastSuccessful = [...(receipt?.actions ?? [])]
    .filter((action) => action.writeState !== "unknown" && action.writeState !== "attempting")
    .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt))
    .at(-1);

  return ExplainRunViewSchema.parse({
    runId: envelope.runId,
    traceId: envelope.traceId,
    workflowId: envelope.workflow,
    attempt: envelope.attempt,
    state: lifecycle.state,
    outcome: lifecycle.state === "terminal"
      ? { state: "present", value: lifecycle.outcome }
      : { state: "absent", reason: "this run has not settled" },
    dryRun: envelope.dryRun,
    resolvedInstance: envelope.resolvedInstance,
    timeline,
    reuse: (receipt?.reuse ?? []).map((entry) => ({
      // The reuse row's source ref names the node's verification entry; the
      // obligation is `node.<id>`, so the node id is recoverable without a
      // second lookup.
      nodeId: receipt?.verification
        .find((row) => `observation:${row.id}` === entry.source)
        ?.obligation.replace(/^node\./, "") ?? "unknown",
      kind: entry.kind,
      ageMs: entry.ageMs,
      freshnessLimitMs: entry.freshnessLimitMs,
    })),
    subjectBindings: (receipt?.decisions ?? [])
      .filter((decision) => decision.kind === "identity")
      .map((decision) => ({ source: "receipt", verdict: decision.outcome, reason: decision.reason })),
    failure: evidence.failure === undefined
      ? { state: "absent", reason: "this run holds no structured failure record" }
      : {
        state: "present",
        value: {
          failureId: evidence.failure.failureId,
          fingerprint: evidence.failure.fingerprint,
          code: evidence.failure.code,
          summary: evidence.failure.summary,
          writeState: evidence.failure.writeState,
          sameFingerprintSeen: Math.max(1, evidence.sameFingerprintSeen ?? 1),
        },
      },
    lastSuccessfulAction: lastSuccessful === undefined
      ? {
        state: "absent",
        reason: receipt === undefined
          ? "no receipt exists yet, so no action has been attributed"
          : "this run recorded no completed action",
      }
      : {
        state: "present",
        value: `${lastSuccessful.kind} ${lastSuccessful.taskId} (${lastSuccessful.writeState}) at ${lastSuccessful.occurredAt}`,
      },
    openGate: lifecycle.state === "parked-gate"
      ? { state: "present", value: `${lifecycle.gateId} since ${lifecycle.parkedAt}; resumes at ${lifecycle.resumeAt}` }
      : { state: "absent", reason: "this run is not parked on a gate" },
    openDependency: lifecycle.state === "parked-write"
      ? {
        state: "present",
        value: `write intent ${lifecycle.writeIntentId} generation `
          + `${String(lifecycle.intentGeneration)} (${lifecycle.code})`,
      }
      : { state: "absent", reason: "this run is not blocked on a durable dependency" },
    commandHistory: evidence.commandHistory === undefined
      ? {
        state: "absent",
        reason: "authority indexes commands by id, not by run; the by-run command projection is "
          + "doc 03's queue projection and is not wired into this command",
      }
      : { state: "present", entries: evidence.commandHistory },
    notifications: {
      state: "absent",
      reason: "no notification trigger is wired yet; the durable actor-keyed inbox is a separate "
        + "2g slice, so this run has none rather than none being shown",
    },
    writes: evidence.writes.map((intent) => ({
      writeIntentId: intent.writeIntentId,
      system: intent.system,
      status: intent.status,
      idempotencyKey: intent.idempotencyKey,
      proof: intent.status === "committed"
        ? `binding proof ${intent.bindingProof.proofId}; completion proof confirmed ${intent.confirmedAt}`
        : intent.status === "observed-present"
          ? `no fresh binding proof — the permanent key was already satisfied, observed ${intent.observedAt}`
          : `binding proof ${intent.bindingProof.proofId}; NO completion proof (status ${intent.status})`,
    })),
    receipt: receipt === undefined
      ? {
        state: "absent",
        reason: lifecycle.state === "terminal"
          ? "this run is terminal but no receipt could be derived"
          : "a receipt states a settled verdict and this run has not settled",
      }
      : {
        state: "present",
        value: {
          receiptId: receipt.receiptId,
          result: receipt.result,
          confidence: receipt.confidence,
          verification: receipt.verification.map((row) => ({
            obligation: row.obligation,
            mandatory: row.mandatory,
            verdict: row.verdict,
          })),
          warnings: receipt.warnings.map((warning) => `${warning.code}: ${warning.summary}`),
        },
      },
    nextSafeAction: nextSafeAction(run, evidence.failure?.remediation ?? []),
  });
}

/* ── rendering ───────────────────────────────────────────────────────────── */

function section(title: string, lines: readonly string[]): readonly string[] {
  return [`  ${title}`, ...(lines.length === 0 ? ["    (none)"] : lines.map((line) => `    ${line}`)), ""];
}

function shown<Value>(
  resource: Readonly<{ state: "absent"; reason: string }> | Readonly<{ state: "present"; value: Value }>,
  render: (value: Value) => string,
): string {
  return resource.state === "present" ? render(resource.value) : `— ${resource.reason}`;
}

export function renderExplainRun(view: ExplainRunView): string {
  const instances = Object.entries(view.resolvedInstance)
    .map(([system, instance]) => `${system}=${instance}`)
    .join(" ");
  return [
    `run ${view.runId}  trace ${view.traceId}  workflow ${view.workflowId}  attempt ${String(view.attempt)}`,
    "",
    ...section("state", [
      `${view.state}${shown(view.outcome, (outcome) => ` → ${outcome}`)}`,
      `dryRun=${String(view.dryRun)}  instances: ${instances === "" ? "(none resolved)" : instances}`,
    ]),
    ...section("node timeline", view.timeline.map((entry) =>
      `${entry.nodeId.padEnd(22)} ${entry.disposition.padEnd(26)} ${entry.detail}`)),
    ...section("checkpoint reuse", view.reuse.map((entry) =>
      `${entry.nodeId.padEnd(22)} ${entry.kind.padEnd(12)} age ${String(entry.ageMs)}ms of ${String(entry.freshnessLimitMs)}ms`)),
    ...section("subject bindings", view.subjectBindings.map((entry) => `${entry.verdict}: ${entry.reason}`)),
    ...section("failure", [shown(view.failure, (failure) =>
      `${failure.code} (${failure.writeState}) fingerprint ${failure.fingerprint}\n`
      + `    seen ${String(failure.sameFingerprintSeen)}× · ${failure.summary}`)]),
    ...section("last successful action", [shown(view.lastSuccessfulAction, (value) => value)]),
    ...section("open gate", [shown(view.openGate, (value) => value)]),
    ...section("open dependency", [shown(view.openDependency, (value) => value)]),
    ...section("command history", view.commandHistory.state === "present"
      ? view.commandHistory.entries
      : [`— ${view.commandHistory.reason}`]),
    ...section("notifications", [`— ${view.notifications.reason}`]),
    ...section("write intent / proof", view.writes.map((entry) =>
      `${entry.system} ${entry.status.padEnd(18)} ${entry.writeIntentId}\n`
      + `    key ${entry.idempotencyKey}\n`
      + `    ${entry.proof}`)),
    ...section("evidence receipt", [shown(view.receipt, (receipt) => [
      `${receipt.result} (confidence ${receipt.confidence}) · ${receipt.receiptId}`,
      ...receipt.verification.map((row) =>
        `    ${row.mandatory ? "[mandatory]" : "[optional] "} ${row.obligation.padEnd(40)} ${row.verdict}`),
      ...receipt.warnings.map((warning) => `    ! ${warning}`),
    ].join("\n"))]),
    ...section("next safe action", [view.nextSafeAction]),
  ].join("\n");
}
