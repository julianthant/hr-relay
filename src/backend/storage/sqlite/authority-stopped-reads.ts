import { workerSlotFromRow } from "./worker-slots.js";
import { artifactReferencesIn, deletionArtifactReferenceMatcher } from "./artifact-references.js";
import { fileStatus } from "../file-identity.js";
import { SETTINGS_RECORD_CONVERSION_VERSION, convertSettingsRecordRow } from "./settings-record-conversion.js";
import { existsSync,statSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { ArtifactRef } from "../../../models/artifacts/artifacts.js";
import { AUTHORITY_TABLE_REGISTRY } from "../../../models/config/authority.js";
import { ConfigSnapshotRecordSchema } from "../../../models/config/snapshot.js";
import { runClaim, type RunRecord } from "../../../models/run/record.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import { requireRuntimeAdmission } from "../admission/admission-identity.js";
import { type RuntimeAdmission } from "../admission/admission.js";
import { assertOfflineMaintenanceForProcessRoot } from "../admission/process-root.js";
import { hasUnprovedSourceClosure,retainAuthoritySourceClosure,retainUnprovedSourceOwners } from "../source-closure.js";
import { deletedRunFromRow } from "./deleted-run-row.js";
import { createGeneratedArtifactRepository } from "./generated-artifacts.js";
import { nativeOrdinaryRecordFromRow } from "./native-record-row.js";
import { createReadonlyAuthoritySnapshot } from "./readonly-authority-snapshot.js";
import { requireDatabaseSourcePath } from "./recovery-admission.js";
import type { WorkerSlotRecord } from "../../../models/run/worker-slot.js";
import { predecessorWorkerSlotFromRow } from "./worker-custody-predecessor.js";
import { runRecordFromRow } from "./run-record-row.js";
import { readAppSettings } from "./settings-storage.js";
import { FingerprintSchema } from "../../../rules/identity/ids.js";
import { DuoCeremonyLeaseRecordSchema } from "../../../rules/sessions/duo-ceremony-lease.js";
import type { Clock } from "../../../rules/time/clock.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { WriteIntentRecordSchema } from "../../../rules/write-safety/write-safety.js";
import { exclusiveSessionLeaseFromRow } from "./exclusive-session-leases.js";
import { AUTHORITY_APPLICATION_ID, CURRENT_AUTHORITY_SCHEMA_VERSION, WORKER_CUSTODY_SCHEMA_VERSION, isCurrentAuthoritySchemaVersion } from "./migrations.js";
import { SpanAuthorityReadSnapshotSchema, SpanAuthorityRunResolutionSchema, SpanAuthorityRunRootSchema, type AuthorityCopyInspection, type SpanAuthorityReadSnapshot, type SpanAuthorityRunRoot } from "./recovery-contracts.js";
import { readIntPragma, inspectionTableNames, readMetaRow } from "./authority-connection.js";
import type { AuthorityDatabase } from "./authority-database.js";
import { AuthoritySchemaVersionError } from "./authority-errors.js";
import { inspectNativeAuthority, inspectOpenDatabase, authorityContentFingerprint, assertPublishedAssistantNumbering, assertNativeSchema } from "./authority-inspection.js";
import { inspectionRunReader, readRunPages } from "./authority-run-evidence.js";
import { readAuthorityUpgradeRecords } from "./authority-upgrades.js";

const TableColumnRowSchema = z.object({ name: z.string() });

export function browserProfileInventory(database: DatabaseSync, inspectedSchemaVersion: number) {
  const convert = inspectedSchemaVersion < SETTINGS_RECORD_CONVERSION_VERSION ? convertSettingsRecordRow : (_table: string, row: unknown) => row;
  const settings = readAppSettings(database, convert);
  const settingsAuthority = settings === undefined
    ? Object.freeze({ state: "never-initialized" as const })
    : Object.freeze({ state: "initialized" as const, record: settings });
  const configSnapshots = database.prepare("SELECT * FROM settings_snapshots ORDER BY id").all()
    .map(row => ConfigSnapshotRecordSchema.parse(nativeOrdinaryRecordFromRow("settings_snapshots", convert("settings_snapshots", row))));
  // A predecessor slot's pause is its newest lease directive, which the custody migration carries onto the slot.
  const predecessorPaused = (slot: WorkerSlotRecord) => ({ ...slot, paused: database.prepare("SELECT directive FROM worker_leases WHERE worker_id=? ORDER BY lease_generation DESC LIMIT 1").get(slot.workerId)?.directive === "pause" });
  const slots = database.prepare("SELECT * FROM worker_slots ORDER BY ordinal").all()
    .map(inspectedSchemaVersion < WORKER_CUSTODY_SCHEMA_VERSION ? row => predecessorPaused(predecessorWorkerSlotFromRow(row)) : workerSlotFromRow);
  return { settingsAuthority, configSnapshots, slots };
}

export function maintenanceInventory(database: DatabaseSync, inspection: ReturnType<typeof inspectNativeAuthority>, artifactRoot: string) {
  const browserProfiles = browserProfileInventory(database, inspection.schemaVersion);
  const runs = database.prepare("SELECT * FROM runs ORDER BY id").all().map(inspectionRunReader(inspection.schemaVersion));
  const writeIntents = database.prepare("SELECT * FROM write_intents ORDER BY id").all().map(row => WriteIntentRecordSchema.parse(nativeOrdinaryRecordFromRow("write_intents", row)));
  const duoLeases = database.prepare("SELECT * FROM auth_leases ORDER BY credential_key").all().map(row => DuoCeremonyLeaseRecordSchema.parse(nativeOrdinaryRecordFromRow("auth_leases", row)));
  const exclusiveSessionLeases = inspection.schemaVersion >= 14 ? database.prepare("SELECT * FROM exclusive_session_leases ORDER BY id").all().map(exclusiveSessionLeaseFromRow) : [];
  const pendingArtifacts = createGeneratedArtifactRepository({ database, mutate: () => { throw new Error("profile-maintenance-mutation-refused"); } }).outbox.listPending();
  return Object.freeze({ authorityGeneration: inspection.authorityGeneration, ...browserProfiles, runs, writeIntents, duoLeases, exclusiveSessionLeases, pendingArtifacts, upgrades: readAuthorityUpgradeRecords(database), artifactReferences: readManagedArtifactReferencesFromDatabase(database, artifactRoot) });
}

export function flatQueuedRunCancellationInventory(database: DatabaseSync, artifactRoot: string, assertResourcesClosed: (facts: ReturnType<AuthorityDatabase["readProfileResourceCustody"]>) => void) {
  const inspection = inspectNativeAuthority(database, 6);
  if (inspection.installationId !== undefined || inspection.profileId !== undefined) throw new Error("queued-run-cancellation-binding-refused");
  const facts = maintenanceInventory(database, inspection, artifactRoot);
  const candidates = facts.runs.filter(run => run.lifecycle.state !== "terminal");
  for (const run of candidates) {
    if (run.lifecycle.state !== "queued" || run.claimGeneration !== 0 || runClaim(run) !== undefined
      || run.lifecycle.requeuedFrom !== undefined || run.envelope.parent !== undefined
      || database.prepare("SELECT 1 FROM write_intents WHERE run_id=? LIMIT 1").get(run.envelope.runId) !== undefined
      || database.prepare("SELECT 1 FROM run_checkpoints WHERE run_id=? LIMIT 1").get(run.envelope.runId) !== undefined
      || database.prepare("SELECT 1 FROM run_delegations WHERE parent_run_id=? LIMIT 1").get(run.envelope.runId) !== undefined) {
      throw new Error("queued-run-cancellation-ineligible");
    }
  }
  assertResourcesClosed({ ...facts, runs: facts.runs.filter(run => run.lifecycle.state === "terminal") });
  const { installationId: _installationId, profileId: _profileId, ...nativeInspection } = inspection;
  return { digest: sha256Hex(canonicalJsonStringify({ inspection: nativeInspection, facts })), candidates };
}

export function requireStoppedUpgradeSource(admission: RuntimeAdmission, path: string, processLockRoot: string, _clock: Clock, backup = false): void {
  if (backup) requireRuntimeAdmission(admission).assertStoppedAuthorityBackup(path, processLockRoot);
  else requireRuntimeAdmission(admission).assertStoppedProfileUpgrade(path, processLockRoot);
  requireDatabaseSourcePath(path);
  const operation = admission.maintenanceOperation();
  admission.assertOfflineMaintenance(operation);
  assertOfflineMaintenanceForProcessRoot(operation, processLockRoot);
}

export function inspectExistingDatabaseReadOnly(path: string, busyTimeoutMs: number, workbookPayloads = true): AuthorityCopyInspection {
  const parsedPath = z.string().min(1).parse(path);
  if (!existsSync(parsedPath) || statSync(parsedPath).size === 0) {
    throw new Error(`authority database ${parsedPath} is missing or empty`);
  }
  const snapshotCopy = createReadonlyAuthoritySnapshot(parsedPath);
  let database: DatabaseSync;
  try {
    database = new DatabaseSync(snapshotCopy.path, {
    readOnly: true,
    enableForeignKeyConstraints: true,
    enableDoubleQuotedStringLiterals: false,
    allowExtension: false,
    timeout: z.number().int().positive().parse(busyTimeoutMs),
    readBigInts: false,
    returnArrays: false,
    allowBareNamedParameters: false,
    allowUnknownNamedParameters: false,
    defensive: true,
  });
  } catch (error) { snapshotCopy.dispose(); throw error; }
  let transactionOpen = false;
  try {
    database.exec("PRAGMA foreign_keys = ON");
    database.exec("PRAGMA query_only = ON");
    database.exec("BEGIN");
    transactionOpen = true;
    const inspection = inspectOpenDatabase(database, false, workbookPayloads);
    database.exec("COMMIT");
    transactionOpen = false;
    return inspection;
  } finally {
    try {
      if (transactionOpen) database.exec("ROLLBACK");
    } finally {
      closeSnapshotReader(database, snapshotCopy);
    }
  }
}

/** A reader that fails to close keeps its snapshot files with the retained owner. */
function closeSnapshotReader(database: DatabaseSync, snapshot: ReturnType<typeof createReadonlyAuthoritySnapshot>): void {
  try { database.close(); } catch (error) { throw retainAuthoritySourceClosure([error], { snapshot, database }); }
  try { snapshot.assertUnchanged(); } finally { snapshot.dispose(); }
}

/** A direct reader's unproved close stays registered with the admission that ran it, even when a caller folds the error into a report. */
export function withDirectReaderAdmission<T>(admission: RuntimeAdmission, read: () => T): T {
  try { return read(); } catch (error) {
    if (hasUnprovedSourceClosure(error)) { admission.retainSourceClosure(error); retainUnprovedSourceOwners(error, { admission }); }
    throw error;
  }
}

export type AuthorityReadIdentitySnapshot = Readonly<{
  authorityGeneration: number;
  authorityContentFingerprint: string;
}>;

export function inspectAuthorityReadIdentityReadOnly(
  path: string,
  busyTimeoutMs: number,
  readWithinSnapshot?: (database: DatabaseSync) => void,
): AuthorityReadIdentitySnapshot {
  const parsedPath = z.string().min(1).parse(path);
  if (!existsSync(parsedPath) || statSync(parsedPath).size === 0) {
    throw new Error(`authority database ${parsedPath} is missing or empty`);
  }
  const snapshotCopy = createReadonlyAuthoritySnapshot(parsedPath);
  let database: DatabaseSync;
  try {
    database = new DatabaseSync(snapshotCopy.path, {
    readOnly: true,
    enableForeignKeyConstraints: true,
    enableDoubleQuotedStringLiterals: false,
    allowExtension: false,
    timeout: z.number().int().positive().parse(busyTimeoutMs),
    readBigInts: false,
    returnArrays: false,
    allowBareNamedParameters: false,
    allowUnknownNamedParameters: false,
    defensive: true,
  });
  } catch (error) { snapshotCopy.dispose(); throw error; }
  let transactionOpen = false;
  try {
    database.exec("PRAGMA foreign_keys = ON");
    database.exec("PRAGMA query_only = ON");
    database.exec("BEGIN");
    transactionOpen = true;
    const applicationId = readIntPragma(database, "application_id");
    if (applicationId !== AUTHORITY_APPLICATION_ID) {
      throw new Error(`existing database application_id ${String(applicationId)} is not the HR authority store`);
    }
    const schemaVersion = readIntPragma(database, "user_version");
    if (!isCurrentAuthoritySchemaVersion(schemaVersion)) {
      throw new Error(
        `authority schema ${String(schemaVersion)} does not match supported ${String(CURRENT_AUTHORITY_SCHEMA_VERSION)}`,
      );
    }
    const names = inspectionTableNames(database);
    const expected = AUTHORITY_TABLE_REGISTRY.map(({ name }) => name).sort();
    if (names.length !== expected.length || expected.some((name, index) => names[index] !== name)) {
      throw new Error(`authority database tables do not match registry: actual=${names.join(",")} expected=${expected.join(",")}`);
    }
    const meta = readMetaRow(database);
    readWithinSnapshot?.(database);
    const snapshot = Object.freeze({
      authorityGeneration: meta.authority_generation,
      authorityContentFingerprint: FingerprintSchema.parse(authorityContentFingerprint(database)),
    });
    database.exec("COMMIT");
    transactionOpen = false;
    return snapshot;
  } finally {
    try {
      if (transactionOpen) database.exec("ROLLBACK");
    } finally {
      closeSnapshotReader(database, snapshotCopy);
    }
  }
}

function mismatchSummary(
  field: string,
  spanValue: unknown,
  authorityValue: unknown,
  table: "runs" | "deleted_runs",
): string | undefined {
  const spanJson = canonicalJsonStringify(spanValue);
  const authorityJson = canonicalJsonStringify(authorityValue);
  return spanJson === authorityJson
    ? undefined
    : `span root ${field} ${spanJson} does not match ${table} authority ${authorityJson}`;
}

function liveSpanRootMismatches(root: SpanAuthorityRunRoot, run: RunRecord): readonly string[] {
  const envelope = run.envelope;
  return [
    mismatchSummary("runId", root.runId, envelope.runId, "runs"),
    mismatchSummary("workflow", root.workflow, envelope.workflow, "runs"),
    mismatchSummary("itemId", root.itemId, envelope.itemId, "runs"),
    mismatchSummary("traceId", root.traceId, envelope.traceId, "runs"),
    mismatchSummary("finalAttempt", root.finalAttempt, envelope.attempt, "runs"),
    mismatchSummary("parentRunId", root.parentRunId ?? null, envelope.parent?.runId ?? null, "runs"),
    mismatchSummary("shape", root.shape, envelope.shape, "runs"),
    mismatchSummary("priority", root.priority, envelope.priority, "runs"),
    mismatchSummary("dryRun", root.dryRun, envelope.dryRun, "runs"),
    mismatchSummary("retryOf", root.retryOf ?? null, envelope.retryOf ?? null, "runs"),
    mismatchSummary("descriptorVersion", root.descriptorVersion, envelope.descriptorVersion, "runs"),
    mismatchSummary("contractFingerprint", root.contractFingerprint, envelope.contractFingerprint, "runs"),
    mismatchSummary("resolvedInstance", root.resolvedInstance, envelope.resolvedInstance, "runs"),
    mismatchSummary("configFingerprint", root.configFingerprint, envelope.configFingerprint, "runs"),
    mismatchSummary("configSnapshotId", root.configSnapshotId, envelope.configSnapshotId, "runs"),
    mismatchSummary("queuedAt", root.queuedAt, envelope.enqueuedAt, "runs"),
  ].filter((issue): issue is string => issue !== undefined);
}

function structuralSpanRootIssues(roots: readonly SpanAuthorityRunRoot[]): readonly (readonly string[])[] {
  const issues = roots.map((root) => [...root.streamIssues]);
  const occurrenceCount = new Map<string, number>();
  for (const root of roots) occurrenceCount.set(root.runId, (occurrenceCount.get(root.runId) ?? 0) + 1);
  const lastAttemptByItem = new Map<string, number>();
  for (const [index, root] of roots.entries()) {
    const rootIssues = issues[index];
    if (rootIssues === undefined) throw new Error(`span authority root ${String(index)} has no structural issue bucket`);
    const add = (issue: string): void => {
      if (!rootIssues.includes(issue)) rootIssues.push(issue);
    };
    if ((occurrenceCount.get(root.runId) ?? 0) > 1) {
      add(`duplicate run.queued root for run ${root.runId}`);
    }
    if (root.spanPath !== root.traceId) {
      add("run.queued root spanPath does not equal traceId");
    }
    const itemKey = `${root.workflow}\u0000${root.itemId}`;
    const previousAttempt = lastAttemptByItem.get(itemKey);
    if (previousAttempt !== undefined && root.initialAttempt <= previousAttempt) {
      add(
        `run.queued item attempt ${String(root.initialAttempt)} did not strictly increase after ${String(previousAttempt)}`,
      );
    }
    lastAttemptByItem.set(itemKey, root.initialAttempt);
  }
  return issues;
}

export function inspectSpanRunAuthorityReadOnly(path: string, rootsInput: readonly SpanAuthorityRunRoot[], busyTimeoutMs: number): SpanAuthorityReadSnapshot {
  const roots = z.array(SpanAuthorityRunRootSchema).readonly().parse(rootsInput);
  const rootIssues = structuralSpanRootIssues(roots);
  if (!existsSync(path) || statSync(path).size === 0) throw new Error("span-authority-database-missing-or-empty");
  const snapshotCopy = createReadonlyAuthoritySnapshot(path);
  let database: DatabaseSync;
  try {
    database = new DatabaseSync(snapshotCopy.path,{readOnly:true,enableForeignKeyConstraints:true,allowExtension:false,timeout:busyTimeoutMs});
  } catch (error) { snapshotCopy.dispose(); throw error; }
  let transactionOpen = false;
  try {
    database.exec("PRAGMA query_only=ON"); database.exec("BEGIN"); transactionOpen = true;
    if (readIntPragma(database,"application_id") !== AUTHORITY_APPLICATION_ID) throw new Error("span-authority-application-mismatch");
    const version = readIntPragma(database,"user_version");
    assertPublishedAssistantNumbering(database);
    if (!isCurrentAuthoritySchemaVersion(version)) throw new AuthoritySchemaVersionError(version);
    assertNativeSchema(database);
    const meta = readMetaRow(database);
    if (meta.schema_version !== version) throw new Error("span-authority-schema-metadata-mismatch");
    const rootsByRun = new Map(roots.map(root => [root.runId, root]));
    const liveIssues = new Map<string, readonly string[]>();
    const malformedRunIds = new Set<string>();
    const missingSpanRunIds: RunRecord["envelope"]["runId"][] = [];
    let liveRunCount = 0;
    const malformedRecords: Array<z.input<typeof SpanAuthorityReadSnapshotSchema>["malformedRecords"][number]> = [];
    for (const raw of readRunPages(database)) {
      const key = z.object({ id: z.string() }).parse(raw).id;
      let run: RunRecord;
      try { run = runRecordFromRow(raw); }
      catch {
        malformedRunIds.add(key);
        malformedRecords.push({ state: "malformed-authority", source: "current", recordKey: key, summary: "runs authority failed its strict native row validation" });
        continue;
      }
      liveRunCount += 1;
      const root = rootsByRun.get(run.envelope.runId);
      if (root === undefined) missingSpanRunIds.push(run.envelope.runId);
      else liveIssues.set(key, liveSpanRootMismatches(root, run));
    }
    const deletedById = database.prepare("SELECT * FROM deleted_runs WHERE run_id=?");
    const resolutions = roots.map((root,index) => {
      const issues = rootIssues[index];
      if (issues === undefined) throw new Error("span-authority-structural-issues-missing");
      if (issues.length > 0) return SpanAuthorityRunResolutionSchema.parse({state:"malformed",runId:root.runId,table:"span_stream",summary:issues.join("; ")});
      const deletedRow = deletedById.get(root.runId);
      if (deletedRow !== undefined) {
        try {
          const {receipt} = deletedRunFromRow(deletedRow);
          const mismatches = [mismatchSummary("workflow",root.workflow,receipt.workflow,"deleted_runs"),
            mismatchSummary("itemId",root.itemId,receipt.itemId,"deleted_runs"),mismatchSummary("traceId",root.traceId,receipt.traceId,"deleted_runs"),
            mismatchSummary("finalAttempt",root.finalAttempt,receipt.attempt,"deleted_runs")].filter((issue):issue is string=>issue !== undefined);
          if (liveIssues.has(root.runId) || mismatches.length > 0) throw new Error("deleted-run-span-identity-mismatch");
          return SpanAuthorityRunResolutionSchema.parse({state:"deleted",runId:receipt.runId,workflow:receipt.workflow,traceId:receipt.traceId,
            origin:receipt.origin,commandId:receipt.commandId,deletedAt:receipt.deletedAt});
        } catch { return SpanAuthorityRunResolutionSchema.parse({state:"malformed",runId:root.runId,table:"deleted_runs",summary:"deletion receipt failed native row or span identity validation"}); }
      }
      if (malformedRunIds.has(root.runId)) return SpanAuthorityRunResolutionSchema.parse({state:"malformed",runId:root.runId,table:"runs",summary:"runs authority failed its strict native row validation"});
      const mismatches = liveIssues.get(root.runId);
      if (mismatches === undefined) return SpanAuthorityRunResolutionSchema.parse({state:"missing",runId:root.runId});
      return SpanAuthorityRunResolutionSchema.parse(mismatches.length === 0 ? {state:"live",runId:root.runId}
        : {state:"malformed",runId:root.runId,table:"runs",summary:mismatches.join("; ")});
    });
    const snapshot = SpanAuthorityReadSnapshotSchema.parse({authorityGeneration:meta.authority_generation,authorityContentFingerprint:authorityContentFingerprint(database),
      liveRunCount,tombstoneOrdinalFindings:[],malformedRecords,resolutions,
      missingSpanRunIds:malformedRecords.length === 0 ? missingSpanRunIds : []});
    database.exec("COMMIT");transactionOpen = false;
    return Object.freeze(snapshot);
  } finally {
    try { if (transactionOpen) database.exec("ROLLBACK"); } finally {
      closeSnapshotReader(database, snapshotCopy);
    }
  }
}

export function readManagedArtifactReferencesFromDatabase(database: DatabaseSync, artifactRoot: string, candidate?: ArtifactRef): readonly ArtifactRef[] {
      const references = new Map<string, ArtifactRef>();
      const deletions = database.prepare("SELECT * FROM deleted_runs").all().map(deletedRunFromRow);
      const retainedCandidates = artifactReferencesIn([
        ...deletions.flatMap(deletion => deletion.files.filter(file => file.disposition === "retain" || deletion.cleanupState === "pending").map(file => file.ref)),
        ...(candidate === undefined ? [] : [candidate]),
      ]);
      for (const deletion of deletions) if (deletion.cleanupState === "pending") {
        for (const file of deletion.files) if (file.disposition === "remove") {
          try { fileStatus(join(artifactRoot, `${file.ref.sha256}.artifact`)); }
          catch (error) {
            if (error instanceof Error && "code" in error && error.code === "ENOENT") continue;
            throw error;
          }
          references.set(file.ref.sha256, file.ref);
        }
      }
      const retainedBy = new Map<string, ArtifactRef>(retainedCandidates.map(ref => [ref.sha256, ref])), retainedIn = deletionArtifactReferenceMatcher(retainedCandidates);
      const visit = (value: unknown): void => {
        for (const digest of retainedIn(value)) { const ref = retainedBy.get(digest); if (ref !== undefined) references.set(digest, ref); }
        for (const ref of artifactReferencesIn(value)) references.set(ref.sha256, ref);
      };
      for (const table of AUTHORITY_TABLE_REGISTRY.map(entry => entry.name)) {
        if (table === "deleted_runs") continue;
        const columns = database.prepare(`PRAGMA table_info(${table})`).all()
          .map(raw => TableColumnRowSchema.parse(raw).name)
          .filter(name => name.endsWith("_json"));
        if (columns.length === 0) continue;
        const retained = table === "diagnostic_snapshots" ? " WHERE json_extract(payload_json,'$.availability.state') IS NOT 'purged'"
          : table === "diagnostic_files" ? " WHERE snapshot_id IN (SELECT id FROM diagnostic_snapshots WHERE json_extract(payload_json,'$.availability.state') IS NOT 'purged')" : "";
        for (const raw of database.prepare(`SELECT ${columns.join(",")} FROM ${table}${retained}`).all()) {
          for (const value of Object.values(raw)) {
            if (typeof value === "string") visit(JSON.parse(value));
          }
        }
      }
      // Table scans return rows in storage order, which a rebuild can change; inventories compare this list, so order it by content.
      return Object.freeze([...references.values()].sort((a, b) => a.sha256 < b.sha256 ? -1 : a.sha256 > b.sha256 ? 1 : 0).map(reference => Object.freeze(reference)));
}
