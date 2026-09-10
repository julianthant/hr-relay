import { z } from "zod";
import type { DatabaseSync } from "node:sqlite";
import { RunRecordSchema } from "../../domain/run/record.js";
import { FingerprintSchema } from "../../domain/ids.js";
import { DeletedRunRecordSchema } from "../../domain/run/deleted-run.js";
import type { ArchiveDatabase } from "./archive-database.js";

export const ArchiveTransferIdentitySchema = z.strictObject({
  run: RunRecordSchema, transferId: z.string().uuid(), reportDigest: FingerprintSchema,
  sourceDigest: FingerprintSchema,
});
export const ARCHIVE_TRANSFER_DDL = `CREATE TABLE archive_transfers (
 record_key TEXT PRIMARY KEY, workflow TEXT NOT NULL,item_id TEXT NOT NULL,attempt INTEGER NOT NULL,
 run_number INTEGER,record_json TEXT NOT NULL CHECK(json_valid(record_json)),created_at TEXT NOT NULL
) STRICT`;
const RowSchema = z.strictObject({record_json:z.string()});
/** All candidate owners are validated; a retained peer never masks an invalid owner. */
export function resolveRunEvidenceOwner(database: DatabaseSync, archive: () => ArchiveDatabase, runId: string, verifyFiles = true) {
  const read = (table: "workflow_runs" | "deleted_runs" | "archive_transfers") => {
    const row = database.prepare(`SELECT record_json FROM ${table} WHERE record_key=?`).get(runId);
    return row === undefined ? undefined : JSON.parse(RowSchema.parse(row).record_json) as unknown;
  };
  const live = read("workflow_runs"), deleted = read("deleted_runs"), transferred = read("archive_transfers");
  if (live !== undefined && (deleted !== undefined || transferred !== undefined)) throw new Error("run-evidence-owner-ambiguous");
  if (deleted !== undefined) {
    const record = DeletedRunRecordSchema.parse(deleted);
    if (record.runId !== runId) throw new Error("run-evidence-owner-identity-mismatch");
    return {state:"deleted" as const,workflow:record.workflow,itemId:record.itemId};
  }
  if (live !== undefined) {
    const run = RunRecordSchema.parse(live);
    if (run.envelope.runId !== runId) throw new Error("run-evidence-owner-identity-mismatch");
    return {state:"live" as const,workflow:run.envelope.workflow,itemId:run.envelope.itemId};
  }
  if (transferred !== undefined) {
    const identity = ArchiveTransferIdentitySchema.parse(transferred);
    const store = archive();
    if (!["verified", "published"].includes(store.state(runId) ?? "")) throw new Error("run-evidence-archive-unverified");
    const report = verifyFiles ? store.verified(runId,identity.reportDigest) : store.verifiedReport(runId,identity.reportDigest);
    if (identity.run.envelope.runId !== runId || report.content.transferId !== identity.transferId
      || report.content.sourceDigest !== identity.sourceDigest || report.content.workflow !== identity.run.envelope.workflow
      || report.content.itemId !== identity.run.envelope.itemId || report.content.attempt !== identity.run.envelope.attempt
      || report.content.runNumber !== (identity.run.runNumber??null)) throw new Error("run-evidence-archive-identity-mismatch");
    return {state:"archived" as const,workflow:report.content.workflow,itemId:report.content.itemId};
  }
  throw new Error("run-delete-evidence-owner-missing");
}

/** Frozen transfer identity only. Saved display reads never parse a current run or workflow input. */
export function resolveSavedReportOwner(database: DatabaseSync, archive: () => ArchiveDatabase, runId: string) {
  const read = (table: "workflow_runs" | "deleted_runs" | "archive_transfers") => {
    const row = database.prepare(`SELECT record_json FROM ${table} WHERE record_key=?`).get(runId);
    return row === undefined ? undefined : JSON.parse(RowSchema.parse(row).record_json) as unknown;
  };
  const live = read("workflow_runs"), deleted = read("deleted_runs"), transferred = read("archive_transfers");
  if (live !== undefined && (deleted !== undefined || transferred !== undefined)) throw new Error("run-evidence-owner-ambiguous");
  if (deleted !== undefined) {
    const record = DeletedRunRecordSchema.parse(deleted);
    if (record.runId !== runId) throw new Error("run-evidence-owner-identity-mismatch");
    return { state: "deleted" as const };
  }
  if (live !== undefined) {
    const identity = z.object({ envelope: z.object({ runId: z.string().uuid() }) }).parse(live);
    if (identity.envelope.runId !== runId) throw new Error("run-evidence-owner-identity-mismatch");
    return { state: "live" as const };
  }
  if (transferred === undefined) return { state: "missing" as const };
  const identity = z.strictObject({ transferId: z.string().uuid(), reportDigest: FingerprintSchema, sourceDigest: FingerprintSchema,
    run: z.object({ envelope: z.object({ runId: z.string().uuid(), workflow: z.string().min(1), itemId: z.string().min(1), attempt: z.number().int().positive() }),
      runNumber: z.number().int().positive().optional() }),
  }).parse(transferred);
  const store = archive();
  if (!["verified", "published"].includes(store.state(runId) ?? "")) throw new Error("run-evidence-archive-unverified");
  const report = store.verifiedReport(runId, identity.reportDigest);
  if (identity.run.envelope.runId !== runId || report.content.transferId !== identity.transferId
    || report.content.sourceDigest !== identity.sourceDigest || report.content.workflow !== identity.run.envelope.workflow
    || report.content.itemId !== identity.run.envelope.itemId || report.content.attempt !== identity.run.envelope.attempt
    || report.content.runNumber !== (identity.run.runNumber ?? null)) throw new Error("run-evidence-archive-identity-mismatch");
  return { state: "archived" as const, reportDigest: identity.reportDigest };
}
