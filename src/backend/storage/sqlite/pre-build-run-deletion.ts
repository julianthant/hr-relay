import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { RunDeleteInputSchema } from "../../../models/run/deleted-run.js";
import { RunHistoryCommandSchema } from "../../../models/dashboard/run-history.js";
import { createRunTerminalEvidenceResult, type RunResultRecord } from "../../../models/run/result.js";
import { PredecessorRunRecordSchema, runClaim, type PredecessorRunRecord } from "../../../models/run/record.js";
import { FingerprintSchema } from "../../../rules/identity/ids.js";
import { RunLifecycleCommandAuditRecordSchema, RunLifecycleCommandRecordSchema } from "../../../rules/commands/commands.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import { CanonicalCancellationTerminalizeRequestSchema, CanonicalTransitionRequestSchema } from "./run-store-contracts.js";
import { insertNativeCommand, settleNativeCommand } from "./command-record-row.js";
import { BUILD_ID_ENVELOPE_SCHEMA_VERSION } from "./migrations.js";
import { executeNativeRunDeletion, prepareNativeRunDeletion } from "./native-run-deletion.js";
import { predecessorRunRecordFromRow, transitionStoredRun, updateRunRecord } from "./run-record-row.js";

const STORED_SHAPE_VERSION = BUILD_ID_ENVELOPE_SCHEMA_VERSION - 1;
type CaptureFile = Parameters<typeof prepareNativeRunDeletion>[3];
/** Inserts the terminal evidence row on the upgrade connection and checks its owner. */
type SettleEvidence = (record: RunResultRecord, run: PredecessorRunRecord) => void;

export function deletePreBuildRuns(database: DatabaseSync, now: string, captureFile: CaptureFile,
  settleEvidence: SettleEvidence): void {
  if (database.prepare("SELECT 1 FROM write_intents WHERE status<>'committed' LIMIT 1").get() !== undefined) {
    throw new Error("authority-upgrade-unresolved-writes");
  }
  const runs = readRuns(database);
  if (runs.some(run => run.lifecycle.state === "parked-write")) throw new Error("authority-upgrade-unresolved-writes");
  for (const run of childrenFirst(runs)) {
    if (run.lifecycle.state === "terminal") continue;
    requireSettledPreBuildRun(database, run.envelope.runId, now, settleEvidence);
  }
  const settled = readRuns(database);
  if (settled.some(run => run.lifecycle.state !== "terminal")) throw new Error("authority-upgrade-run-settlement-refused");
  if (settled.length === 0) return;
  const commandId = randomUUID();
  const request = RunHistoryCommandSchema.parse({ commandId });
  const command = lifecycleCommand("clear-history", request, { kind: "none" }, now);
  insertNativeCommand(database, command);
  const cascadeRunIds = childrenFirst(settled).map(run => run.envelope.runId);
  for (const runId of cascadeRunIds) {
    const run = predecessorRunRecordFromRow(database.prepare("SELECT * FROM runs WHERE id=?").get(runId));
    const deletion = RunDeleteInputSchema.parse({ runId, origin: "storage", commandId, now, cascadeRunIds });
    executeNativeRunDeletion(database, prepareNativeRunDeletion(database, run, deletion, captureFile, "execution", STORED_SHAPE_VERSION));
  }
  recordAudit(database, command, { kind: "history-deletion", runIds: cascadeRunIds }, now);
}

export function requireSettledPreBuildRun(database: DatabaseSync, runId: string, now: string,
  settleEvidence: SettleEvidence): PredecessorRunRecord {
  const outcome = settlePreBuildRun(database, runId, now, settleEvidence);
  if (outcome.state === "refused") throw new Error("authority-upgrade-run-settlement-refused");
  return outcome.run;
}

export function settlePreBuildRun(database: DatabaseSync, runId: string, now: string,
  settleEvidence: SettleEvidence):
  { state: "applied"; run: PredecessorRunRecord } | { state: "refused" } {
  const current = predecessorRunRecordFromRow(database.prepare("SELECT * FROM runs WHERE id=?").get(runId));
  if (current.lifecycle.state === "terminal") return { state: "applied", run: current };
  if (current.lifecycle.state === "parked-write") throw new Error("authority-upgrade-unresolved-writes");
  if (childOpen(database, runId)) return { state: "refused" };
  if (current.lifecycle.state === "queued" || current.lifecycle.state === "parked-gate") {
    if (runClaim(current) !== undefined) return { state: "refused" };
    return { state: "applied", run: settleUnclaimed(database, current, now, settleEvidence) };
  }
  if (current.lifecycle.state === "claimed" || current.lifecycle.state === "validating" || current.lifecycle.state === "running") {
    return { state: "applied", run: settleClaimed(database, current, now, settleEvidence) };
  }
  return { state: "refused" };
}

function settleUnclaimed(database: DatabaseSync, current: PredecessorRunRecord, now: string,
  settleEvidence: SettleEvidence): PredecessorRunRecord {
  const lifecycle = { state: "terminal" as const, outcome: "cancelled" as const, endedAt: now };
  const candidate = PredecessorRunRecordSchema.parse({ ...current, lifecycle });
  const updated = transitionStoredRun(current, candidate, now, PredecessorRunRecordSchema);
  updateRunRecord(database, updated, PredecessorRunRecordSchema);
  const request = CanonicalTransitionRequestSchema.parse({
    commandId: randomUUID(), runId: current.envelope.runId, expectedVersion: current.version, lifecycle,
  });
  const command = lifecycleCommand("transition", request, { kind: "version", expectedVersion: current.version }, now);
  const audit = recordAudit(database, command, journalRun(updated), now);
  writeEvidence(updated, command, audit, settleEvidence);
  return updated;
}

function settleClaimed(database: DatabaseSync, current: PredecessorRunRecord, now: string,
  settleEvidence: SettleEvidence): PredecessorRunRecord {
  if (runClaim(current) === undefined) throw new Error("authority-upgrade-run-settlement-refused");
  const marked = current.cancelRequested === true ? current : requestCancellation(database, current, now);
  const held = runClaim(marked);
  if (held === undefined) throw new Error("authority-upgrade-run-settlement-refused");
  const terminalRequest = CanonicalCancellationTerminalizeRequestSchema.parse({
    kind: "cancelled", commandId: randomUUID(), runId: marked.envelope.runId, expectedVersion: marked.version,
    claim: { workerId: held.workerId, claimGeneration: held.claimGeneration }, endedAt: now,
  });
  const candidate = PredecessorRunRecordSchema.parse({
    ...marked, lifecycle: { state: "terminal", outcome: "cancelled", endedAt: now },
  });
  const updated = transitionStoredRun(marked, candidate, now, PredecessorRunRecordSchema);
  updateRunRecord(database, updated, PredecessorRunRecordSchema);
  const command = lifecycleCommand("terminalize", terminalRequest, {
    kind: "terminal", expectedVersion: marked.version, workerId: held.workerId, claimGeneration: held.claimGeneration,
  }, now);
  const audit = recordAudit(database, command, journalRun(updated), now);
  writeEvidence(updated, command, audit, settleEvidence);
  return updated;
}

function requestCancellation(database: DatabaseSync, current: PredecessorRunRecord, now: string): PredecessorRunRecord {
  const requested = PredecessorRunRecordSchema.parse({ ...current, cancelRequested: true });
  const marked = transitionStoredRun(current, requested, now, PredecessorRunRecordSchema);
  updateRunRecord(database, marked, PredecessorRunRecordSchema);
  const request = CanonicalTransitionRequestSchema.parse({
    commandId: randomUUID(), runId: current.envelope.runId, expectedVersion: current.version,
    lifecycle: { state: "terminal", outcome: "cancelled", endedAt: now },
  });
  recordAudit(database, lifecycleCommand("transition", request, { kind: "version", expectedVersion: current.version }, now), journalRun(marked), now);
  return marked;
}

function writeEvidence(run: PredecessorRunRecord, command: z.infer<typeof RunLifecycleCommandRecordSchema>,
  audit: z.infer<typeof RunLifecycleCommandAuditRecordSchema>, settleEvidence: SettleEvidence): void {
  if (run.lifecycle.state !== "terminal" || run.lifecycle.outcome === "done" || run.lifecycle.outcome === "failed" || run.lifecycle.outcome === "interrupted") return;
  const result = createRunTerminalEvidenceResult(run, {
    kind: "lifecycle-evidence", outcome: run.lifecycle.outcome, commandId: command.commandId, auditId: audit.auditId,
    requestFingerprint: command.requestFingerprint, appliedVersion: run.version,
  });
  settleEvidence(result, run);
}

export function lifecycleCommand(operation: string, request: unknown, fence: unknown, now: string) {
  return RunLifecycleCommandRecordSchema.parse({
    kind: "run-lifecycle", commandId: z.object({ commandId: z.string() }).parse(request).commandId, operation,
    requestFingerprint: FingerprintSchema.parse(sha256Hex(`hrauto:run-lifecycle-command:v1\0${operation}\0${canonicalJsonStringify(request)}`)),
    request, fence, recordedAt: now,
  });
}

export function recordAudit(database: DatabaseSync, command: z.infer<typeof RunLifecycleCommandRecordSchema>, result: z.infer<typeof RunLifecycleCommandAuditRecordSchema>["result"], now: string) {
  insertNativeCommand(database, command);
  const audit = RunLifecycleCommandAuditRecordSchema.parse({
    kind: "run-lifecycle", auditId: command.commandId, request: command, result, completedAt: now,
  });
  database.prepare("INSERT INTO command_audits(id,command_id,code,payload_json,created_at) VALUES(?,?,NULL,?,?)")
    .run(audit.auditId, command.commandId, canonicalJsonStringify(audit), audit.completedAt);
  settleNativeCommand(database, audit);
  return audit;
}

function journalRun(run: PredecessorRunRecord) {
  const lifecycle = run.lifecycle;
  return { kind: "run" as const, runId: run.envelope.runId, appliedVersion: run.version,
    ...(run.envelope.continuation === undefined ? {} : { continuation: run.envelope.continuation }),
    ...(lifecycle.state === "terminal" && (lifecycle.outcome === "cancelled" || lifecycle.outcome === "discarded" || lifecycle.outcome === "superseded")
      ? { terminal: { outcome: lifecycle.outcome, endedAt: lifecycle.endedAt } } : {}),
  };
}

function readRuns(database: DatabaseSync): PredecessorRunRecord[] {
  return database.prepare("SELECT * FROM runs ORDER BY id").all().map(predecessorRunRecordFromRow);
}

function childOpen(database: DatabaseSync, runId: string): boolean {
  return database.prepare("SELECT 1 FROM runs WHERE parent_id=? AND state<>'terminal' LIMIT 1").get(runId) !== undefined;
}

export function childrenFirst(runs: readonly PredecessorRunRecord[]): PredecessorRunRecord[] {
  const ordered: PredecessorRunRecord[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (run: PredecessorRunRecord): void => {
    const id = run.envelope.runId;
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new Error("run-history-parent-cycle");
    visiting.add(id);
    for (const child of runs) if (child.envelope.parent?.runId === id) visit(child);
    visiting.delete(id);
    visited.add(id);
    ordered.push(run);
  };
  for (const run of runs) if (run.envelope.parent === undefined) visit(run);
  if (visited.size !== runs.length) throw new Error("run-history-disconnected-members");
  return ordered;
}
