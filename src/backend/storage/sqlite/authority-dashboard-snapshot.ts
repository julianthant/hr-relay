import type { DashboardBackgroundReadRequest, DashboardBackgroundReadResult } from "./dashboard-background-read-worker.js";
import { workerSlotFromRow } from "./worker-slots.js";
import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { currentRowKey, type ChangeEntry } from "./authority-change-log.js";
import type { ProfileDatabaseBindingSchema } from "../../../models/profiles/profile.js";
import { runClaim } from "../../../models/run/record.js";
import { RunSessionRecordSchema,type RunSessionRecord } from "../../../models/run/session.js";
import { WorkerPoolRecordSchema, type WorkerPoolRecord } from "../../../models/run/worker-pool.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import { nativeOrdinaryRecordFromRow } from "./native-record-row.js";
import type { WorkerSlotRecord } from "../../../models/run/worker-slot.js";
import { runRecordFromRow } from "./run-record-row.js";
import { createTimelineRepository } from "./timeline-repository.js";
import { DuoCeremonyLeaseRecordSchema, isDuoCeremonyLeaseLive, type DuoCeremonyLeaseRecord } from "../../../rules/sessions/duo-ceremony-lease.js";
import { AUTHORITY_APPLICATION_ID, CURRENT_AUTHORITY_SCHEMA_VERSION } from "./migrations.js";
import { type ChangeLogReader, validateAuthorityStore, changeLogBaseline, admitChanges, changeLogHighWater } from "./authority-change-admission.js";
import { readMetaRow, readIntPragma } from "./authority-connection.js";
import { assertNativeSchema } from "./authority-inspection.js";
import { assertTimelineOwner, readRunPages } from "./authority-run-evidence.js";
import type { StoredRow } from "./authority-stored-rows.js";

type DashboardFactTable = "runs" | "run_batches" | "worker_slots" | "worker_pools" | "auth_leases";
type DashboardFactChanges = Map<DashboardFactTable, Map<string, ChangeEntry["op"]>>;

function includeDashboardFactChange(changes: DashboardFactChanges, entry: ChangeEntry) {
  const table = entry.table === "write_intents" ? "runs" : entry.table;
  if (table !== "runs" && table !== "run_batches" && table !== "worker_slots" && table !== "worker_pools" && table !== "auth_leases") return;
  const ids = changes.get(table) ?? new Map<string, ChangeEntry["op"]>();
  if (table === "runs") {
    for (const key of entry.keys) if (key.startsWith("run:")) ids.set(key.slice(4), entry.op);
  } else {
    const id = z.string().parse(entry.rowKey[0]);
    if (!ids.has(id)) ids.set(id, entry.op);
  }
  changes.set(table, ids);
}

/** One worker connection validates peer commits and captures a page and its reconciliation facts together. */
export type DashboardSnapshotPosition = Readonly<{ schemaVersion: number; schemaCookie: number; authorityGeneration: number; changeLogSeq: number }>;

export function createDashboardSnapshotQuery(database: DatabaseSync, binding: z.infer<typeof ProfileDatabaseBindingSchema>,
  withValidatedSnapshot?: <T>(read: () => T) => T) {
  const timeline = createTimelineRepository({ database, read: read => read(),
    mutate: () => { throw new Error("dashboard-background-read-only"); }, assertOwner: record => assertTimelineOwner(database, record) });
  let baseline: ChangeLogReader | undefined;
  let validatedVersion: number | undefined;
  let facts: ReturnType<typeof createDashboardWorkerFacts> | undefined;
  const ownSnapshot = <T>(read: () => T): T => {
    database.exec("BEGIN");
    try {
      const result = read();
      database.exec("COMMIT");
      return result;
    } catch (error) {
      if (database.isTransaction) database.exec("ROLLBACK");
      throw error;
    }
  };
  const snapshot = withValidatedSnapshot ?? ownSnapshot;
  /** onSnapshot receives the store position of the transaction the page and its worker facts were read in. */
  return (request: DashboardBackgroundReadRequest, onSnapshot?: (position: DashboardSnapshotPosition) => void,
    logPage?: () => Pick<DashboardBackgroundReadResult, "records" | "cursor" | "through">) =>
    snapshot(() => {
      const meta = readMetaRow(database);
      if (meta.installation_id !== binding.installationId || meta.profile_id !== binding.profileId) throw new Error("profile-database-binding-mismatch");
      if (meta.schema_version !== CURRENT_AUTHORITY_SCHEMA_VERSION || readIntPragma(database, "user_version") !== meta.schema_version
        || readIntPragma(database, "application_id") !== AUTHORITY_APPLICATION_ID) throw new Error("dashboard-background-schema-mismatch");
      const version = readIntPragma(database, "data_version");
      if (baseline === undefined || facts === undefined) {
        if (withValidatedSnapshot === undefined) {
          assertNativeSchema(database);
          validateAuthorityStore(database);
        }
        baseline = changeLogBaseline(database);
        facts = createDashboardWorkerFacts(database);
      } else if (validatedVersion !== version) {
        const changes: DashboardFactChanges = new Map();
        const contiguous = admitChanges(database, baseline, "all", version, entry => includeDashboardFactChange(changes, entry));
        const previous = facts;
        // Admission has advanced the cursor. Publish the cache only after the matching refresh succeeds.
        facts = undefined;
        if (contiguous) {
          previous.refresh(changes);
          facts = previous;
        } else facts = createDashboardWorkerFacts(database);
      }
      validatedVersion = version;

      const readStatePage = () => {
        const head = timeline.highWaterMark(), through = request.through ?? head;
        if (through > head || request.after > through) throw new Error("timeline-cursor-reset-required");
        const records = timeline.page({ after: request.after, through, limit: request.limit, spanTypes: request.spanTypes });
        const cursor = records.length === request.limit ? records[records.length - 1].cursor : through;
        return { records: [...records], cursor, through };
      };
      const page = logPage === undefined ? readStatePage() : logPage();
      const workers = facts.page(request);
      onSnapshot?.({ schemaVersion: meta.schema_version, schemaCookie: readIntPragma(database, "schema_version"),
        authorityGeneration: meta.authority_generation, changeLogSeq: changeLogHighWater(database) });
      return { ...page, workers };
    });
}

function createDashboardWorkerFacts(database: DatabaseSync) {
  const attempting = database.prepare("SELECT 1 FROM write_intents WHERE run_id=? AND status='attempting' LIMIT 1");
  const runDigests = new Map<string, bigint>();
  let runSum = 0n;
  function updateRun(id: string, row: StoredRow | undefined) {
    // A commutative sum of per-run hashes lets a replacement or deletion touch only its own contribution.
    runSum -= runDigests.get(id) ?? 0n;
    if (row === undefined) { runDigests.delete(id); return; }
    const run = runRecordFromRow(row);
    const claimed = runClaim(run) !== undefined;
    const lifecycle = claimed ? { ...run.lifecycle, heartbeatAt: undefined } : run.lifecycle;
    const digest = createHash("sha256").update(JSON.stringify([run.envelope, run.displayName, run.runNumber, run.sessionId, run.appVersion,
      lifecycle, run.cancelRequested, run.pause, claimed && attempting.get(id) !== undefined])).digest("hex");
    const value = BigInt(`0x${digest}`);
    runDigests.set(id, value);
    runSum += value;
  }

  const batches = new Map<string, Pick<RunSessionRecord, "sessionId" | "version">>();
  const slots = new Map<string, WorkerSlotRecord>();
  const pools = new Map<string, WorkerPoolRecord>();
  const leaseRecords = new Map<string, DuoCeremonyLeaseRecord>();
  let slotWorkflows: WorkerSlotRecord["workflow"][] = [];
  let batchVersions: Pick<RunSessionRecord, "sessionId" | "version">[] = [];
  let slotDigest = "", poolDigest = "", batchDigest = "", fingerprint = "";
  let leases: DuoCeremonyLeaseRecord[] = [];
  function refresh(changes?: DashboardFactChanges) {
    const dirty = (table: DashboardFactTable) => changes === undefined || changes.has(table);
    function rows(table: DashboardFactTable, apply: (id: string, row: StoredRow | undefined) => void) {
      const ids = changes?.get(table);
      if (changes !== undefined && ids === undefined) return;
      const key = currentRowKey(table)[0];
      // Pools and leases are retained, but their capture trigger records only the new primary key on update.
      const retained = table === "worker_pools" ? pools : table === "auth_leases" ? leaseRecords : undefined;
      const renamed = retained !== undefined && ids !== undefined && [...ids].some(([id, op]) => op === "update" && !retained.has(id));
      if (ids === undefined || renamed) {
        retained?.clear();
        const initial = table === "runs" ? readRunPages(database) : database.prepare(`SELECT * FROM ${table} ORDER BY ${key}`).iterate();
        for (const row of initial) apply(z.string().parse(row[key]), row);
      } else {
        const byId = database.prepare(`SELECT * FROM ${table} WHERE ${key}=?`);
        for (const id of ids.keys()) apply(id, byId.get(id));
      }
    }
    rows("runs", updateRun);
    if (dirty("run_batches")) {
      rows("run_batches", (id, row) => {
        if (row === undefined) { batches.delete(id); return; }
        const { sessionId, version } = RunSessionRecordSchema.parse(nativeOrdinaryRecordFromRow("run_batches", row));
        batches.set(id, { sessionId, version });
      });
      batchVersions = [...batches.values()].sort((a, b) => a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0);
      batchDigest = sha256Hex(JSON.stringify(batchVersions));
    }
    if (dirty("worker_slots")) {
      rows("worker_slots", (id, row) => {
        if (row === undefined) slots.delete(id);
        else slots.set(id, workerSlotFromRow(row));
      });
      const ordered = [...slots.values()].sort((a, b) => a.ordinal - b.ordinal);
      slotWorkflows = [...new Set(ordered.map(slot => slot.workflow))];
      slotDigest = sha256Hex(JSON.stringify(ordered));
    }
    if (dirty("worker_pools")) {
      rows("worker_pools", (id, row) => {
        if (row === undefined) pools.delete(id);
        else pools.set(id, WorkerPoolRecordSchema.parse(nativeOrdinaryRecordFromRow("worker_pools", row)));
      });
      poolDigest = sha256Hex(JSON.stringify([...pools.values()].sort((a, b) => a.workflow.localeCompare(b.workflow))));
    }
    if (dirty("auth_leases")) {
      rows("auth_leases", (id, row) => {
        if (row === undefined) leaseRecords.delete(id);
        else leaseRecords.set(id, DuoCeremonyLeaseRecordSchema.parse(nativeOrdinaryRecordFromRow("auth_leases", row)));
      });
      leases = [...leaseRecords.values()].filter(lease => lease.state === "held" && lease.holder.workerId !== undefined)
        .sort((a, b) => a.credentialKey.localeCompare(b.credentialKey));
    }
    fingerprint = sha256Hex(JSON.stringify([runSum.toString(16), slotDigest, poolDigest, batchDigest]));
  }
  refresh();
  function page({ nowMs, limit, workerCursor }: DashboardBackgroundReadRequest) {
    const heldDuoLeases = leases.filter(lease => isDuoCeremonyLeaseLive(lease, nowMs))
      .map(lease => ({ workerId: lease.holder.workerId, system: lease.holder.system, since: lease.acquiredAt, expiresAt: lease.expiresAt }));
    const offset = workerCursor?.offset ?? 0, end = offset + limit;
    const more = Math.max(batchVersions.length, slotWorkflows.length, heldDuoLeases.length) > end;
    const pageDigest = sha256Hex(JSON.stringify([fingerprint, heldDuoLeases]));
    if (workerCursor !== undefined && workerCursor.digest !== pageDigest) throw new Error("dashboard-background-worker-cursor-stale");
    const next = more ? { offset: end, digest: pageDigest } : null;
    return { fingerprint, next, batchVersions: batchVersions.slice(offset, end), slotWorkflows: slotWorkflows.slice(offset, end),
      heldDuoLeases: heldDuoLeases.slice(offset, end) };
  }
  return { refresh, page };
}
