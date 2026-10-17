import { retireOrphanVerification } from "../../storage/maintenance/orphan-verification-retirement.js";
import { ERROR_CATALOG } from "../../../models/failures/error-catalog.js";
import { rebuildRuntimeIsolation } from "../config/runtime-isolation.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../storage/sqlite/migrations.js";
import { RunRecordService } from "../../runs/lifecycle/run-record-service.js";

import { SETTINGS_CATALOG } from "../../../models/config/catalog.js";
import { ChatGptCredentialError, createChatGptCredentialRepository, createCredentialStore } from "../../storage/configuration/credential-store.js";
import { protectedSettingsReadback } from "../../../models/config/protected-settings.js";
import { existsSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { z } from "zod";
import type { RuntimeIsolation } from "../../../models/config/define-runtime-isolation.js";
import { acquireRecoveryRuntimeRestore, requireRuntimeAdmission, type RuntimeAdmission } from "../../storage/admission/admission.js";
import { DESCRIPTORS, SERVER_REGISTRY } from "../registries/workflow-registry.js";
import type { Clock } from "../../../rules/time/clock.js";
import { systemClock } from "../../../rules/time/clock.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../../rules/identity/ids.js";
import {
  AuthorityDatabase,
  OfflineAuthorityRestoreService,
  OfflineRestoreFailure,
  RecoveryStopProofStore,
  doctorAuthorityStorage,
  summarizeSpanAuthorityReconciliation,
} from "../../storage/sqlite/index.js";
import { settleInterruptedAuthorityRestore } from "../../storage/sqlite/offline-restore.js";
import { acquireRuntimeRestoreAdmission, observeRuntimeLockSnapshot } from "../../storage/sqlite/runtime-process-locks.js";
import type {
  OfflineRestoreReport,
  RecoveryRuntimeLockSnapshot,
  StorageDoctorReport,
} from "../../storage/sqlite/recovery-contracts.js";
import {
  descriptorSetHash,
} from "./dashboard/compose.js";
import { createRunQueueProjection } from "../../runs/projections/run-queue-projection.js";
import { createTransactionHistory } from "../../storage/sqlite/transaction-history.js";
import {
  OfflineSpanRootRepairService,
  type SpanRootRepairReport,
} from "../../runs/recovery/span-root-repair.js";

export interface StorageCommandOutcome {
  readonly output: string;
  readonly exitCode: number;
}

export function restoreFailureDisposition(error: unknown): Readonly<{
  heading:
    | "authority restore REFUSED"
    | "authority restore COMPANION-STATE FAILURE"
    | "authority restore AUTHORITY-STATE UNCERTAIN"
    | "authority restore POST-SWAP FAILURE";
  authorityLine: string;
}> {
  if (error instanceof OfflineRestoreFailure && error.authorityState === "replaced") {
    return Object.freeze({
      heading: "authority restore POST-SWAP FAILURE",
      authorityLine: "the authority database was replaced; inspect the post-swap failure before restarting runtime",
    });
  }
  if (error instanceof OfflineRestoreFailure && error.authorityState === "companion-state-uncertain") {
    return Object.freeze({
      heading: "authority restore COMPANION-STATE FAILURE",
      authorityLine: "the authority database was not replaced, but live WAL/SHM rollback is unproven; inspect recovery artifacts before restarting runtime",
    });
  }
  if (error instanceof OfflineRestoreFailure && error.authorityState === "authority-state-uncertain") {
    return Object.freeze({
      heading: "authority restore AUTHORITY-STATE UNCERTAIN",
      authorityLine: "the authority replacement outcome is unproven; inspect staged/live paths before restarting runtime",
    });
  }
  return Object.freeze({
    heading: "authority restore REFUSED",
    authorityLine: "the live authority database was not modified",
  });
}

// Stop proofs expire quickly because a process may restart immediately after inspection.
export const RESTORE_STOPPED_PROOF_MAX_AGE_MS = 5 * 60_000;

const PackageVersionSchema = z.strictObject({ version: z.string().min(1) }).loose();

const STORAGE_USAGE = [
  "usage: storage doctor [--json]",
  "       storage backup [--json]",
  "       storage upgrade [--plan] [--timeline-from <verified-copy-directory>] [--json]",
  "       storage restore --from <manifest.json> [--json]",
  "       storage recover-restore --operation <id> --from <manifest.json> --outcome <unchanged|replaced> [--json]",
  "       storage relocate --plan <command-id> | --resume <operation-id> | --status [--json]",
  "       storage repair-span-root --run <run-id> [--json]",
  "       storage recover-chatgpt-lock",
  "       storage retire-orphan-verification --acquisition <uuid> [--plan] [--json]",
  "  doctor   read-only authority + span reconciliation + backup report (ref dashboard-surfaces); exit 0 only when",
  "           authority, recovery inspection, credentials and span reconciliation are healthy; backup is reported, not gated",
  "  backup   write ONE verified authority backup + manifest under the state root's backups/authority;",
  "           this command is the only backup writer — the dashboard runs no cadence",
  "  restore  quarantine the suspect authority and swap in one EXACT verified backup,",
  "           rebuilding projections against the staged copy first; the runtime must be",
  "           stopped and the manifest is never chosen for you",
  "  relocate  move the exact pending Settings storage plan while dashboard and workers are stopped;",
  "            an interrupted operation requires its exact --resume <operation-id>",
  "  repair-span-root  append one marked SQLite run.queued root reconstructed from exact",
  "           run/session/start-plan authority; existing span bytes stay unchanged and",
  "           the runtime must be stopped",
].join("\n");

function formatAge(ageMs: number): string {
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 60) return `${String(minutes)}m`;
  return `${String(Math.floor(minutes / 60))}h${String(minutes % 60)}m`;
}

function formatReport(report: StorageDoctorReport): string {
  const lines: string[] = [];
  lines.push(`authority storage doctor — ${report.mode} — checked ${report.checkedAt}`);
  if (report.authority.state === "healthy") {
    const { schemaVersion, authorityGeneration, pageCount } = report.authority.inspection;
    lines.push(
      `authority: healthy (schema v${String(schemaVersion)}, generation ${String(authorityGeneration)}, `
      + `${String(pageCount)} pages, quick_check ok)`,
    );
  } else {
    lines.push(`authority: DEGRADED — ${report.authority.cause.code}: ${report.authority.cause.summary}`);
  }
  lines.push(report.recovery.state === "clear" ? "recovery: clear (no interruption markers; not runtime admission)"
    : `recovery: ${report.recovery.state.toUpperCase()}${report.recovery.state === "unavailable" ? ` — ${report.recovery.cause.summary}` : " — preserve evidence and settle the exact interrupted operation"}`);
  if (report.recovery.state !== "clear") for (const finding of report.recovery.findings) {
    lines.push(`  ${finding.marker}: ${finding.state}`);
  }
  lines.push(report.protectedSettings.state === "available"
    ? `protected settings: ${report.protectedSettings.entries.map(({ name, present }) => `${name}=${present ? "present" : "absent"}`).join(" · ")}`
    : `protected settings: unavailable — ${report.protectedSettings.cause.summary}`);
  lines.push(report.authorityUpgrades.state === "available"
    ? `authority upgrades: ${report.authorityUpgrades.phases.map(({ phase, fromSchemaVersion, toSchemaVersion }) => `${phase} v${String(fromSchemaVersion)} → v${String(toSchemaVersion)}`).join(" · ")}`
    : `authority upgrades: ${report.authorityUpgrades.state}`);
  if (report.counts.state === "available") {
    const values = report.counts.values;
    lines.push(
      `pending: commands ${String(values.pendingCommands)} · write intents ${String(values.unresolvedWriteIntents)} `
      + `· leases ${String(values.leases)} `
      + `· provider reservations ${String(values.providerReservations)} `
      + `· artifact outbox ${String(values.artifactOutbox)}`,
    );
  } else {
    lines.push(`pending: unavailable — ${report.counts.cause.code}: ${report.counts.cause.summary}`);
  }
  if (report.spanAuthority.state === "reconciled") {
    lines.push(
      `span authority: reconciled (${String(report.spanAuthority.streamRunCount)} stream runs; `
      + `${String(report.spanAuthority.archived.length)} archived; `
      + `${String(report.spanAuthority.deleted.length)} deleted)`,
    );
  } else if (report.spanAuthority.state === "degraded") {
    const problemSummary = report.spanAuthority.problems.map((problem) => {
      switch (problem.state) {
        case "missing": return `${problem.runId} missing authority${problem.possibleExternalWrite === true ? "; possibleExternalWrite=true" : ""}`;
        case "restore-loss": return `${problem.runId} newer preserved authority evidence${problem.possibleExternalWrite === true ? "; possibleExternalWrite=true" : ""}`;
        case "missing-span": return `${problem.runId} missing span root`;
        case "malformed": return `${problem.runId} malformed in ${problem.table}`;
        case "malformed-authority": return `${problem.recordKey} malformed in ${problem.source} authority`;
      }
    }).join(", ");
    lines.push(`span authority: DEGRADED — ${problemSummary}`);
  } else {
    lines.push(
      `span authority: unavailable — ${report.spanAuthority.cause.code}: ${report.spanAuthority.cause.summary}`,
    );
  }
  if (report.tombstoneOrdinals.state === "available") {
    for (const finding of report.tombstoneOrdinals.findings) {
      lines.push(`tombstone-ordinal-unknown: ${finding.runId} missing ${finding.missingFields.join(", ")}`);
    }
  } else {
    lines.push("tombstone ordinals: unavailable");
  }
  if (report.backup.state === "current") {
    const latest = report.backup.latest;
    const gap = latest.generationGap.state === "known"
      ? `generation gap ${String(latest.generationGap.value)}`
      : `generation gap unknown (${latest.generationGap.reason})`;
    lines.push(`backup: current — ${latest.backupFileName} (age ${formatAge(latest.ageMs)}, ${gap})`);
  } else {
    lines.push(`backup: ${report.backup.state.toUpperCase()} — ${report.backup.cause.code}: ${report.backup.cause.summary}`);
  }
  const reconciliation = summarizeSpanAuthorityReconciliation(report.spanAuthority);
  lines.push(`span/authority: ${reconciliation.state === "healthy" ? "healthy" : "DEGRADED"} — ${reconciliation.summary}`);
  if (report.spanAuthority.state !== "unavailable") {
    for (const archived of report.spanAuthority.archived) {
      lines.push(`  archived: ${archived.runId}`);
    }

    for (const deleted of report.spanAuthority.deleted) {
      lines.push(
        `  deleted: ${deleted.runId} — ${deleted.workflow} · trace ${deleted.traceId} `
        + `· ${deleted.origin} · ${deleted.deletedAt}`,
      );
    }
  }
  if (report.spanAuthority.state === "degraded") {
    for (const problem of report.spanAuthority.problems) {
      lines.push(`  ${problem.state}: ${"runId" in problem ? problem.runId : problem.recordKey}`);
    }
  }
  lines.push(`restore candidates (${String(report.restoreCandidates.length)}):`);
  for (const candidate of report.restoreCandidates) {
    if (candidate.state === "verified-compatible") {
      lines.push(
        `  verified bytes ${candidate.manifestFileName} — ${candidate.selection}; restore ${candidate.restoreEligibility.state}; created ${candidate.createdAt}, `
        + `generation ${String(candidate.authorityGeneration)}, age ${formatAge(candidate.ageMs)}`,
      );
    } else {
      lines.push(`  INVALID ${candidate.manifestFileName} — ${candidate.cause.code}: ${candidate.cause.summary}`);
    }
  }
  return lines.join("\n");
}

function formatLockSnapshot(snapshot: RecoveryRuntimeLockSnapshot): string {
  return Object.entries(snapshot.processLocks)
    .map(([name, lock]) => (lock.state === "active"
      ? `${name}=ACTIVE pid ${String(lock.pid)} (generation ${String(lock.generation)})`
      : `${name}=stopped (generation ${String(lock.generation)})`))
    .join(" · ");
}

function formatRestoreReport(report: OfflineRestoreReport): string {
  return [
    `authority restore — ${report.state} ${report.restoredAt}`,
    `from manifest: ${report.manifestFileName}`,
    `from backup:   ${report.backupFileName} (generation ${String(report.authorityGeneration)})`,
    `suspect kept:  ${report.suspectFileName}`,
    `schema: v${String(report.schemaVersion)}${report.schemaVersion < CURRENT_AUTHORITY_SCHEMA_VERSION ? "; storage upgrade required before runtime boot" : ""}`,
    `projections rebuilt: ${String(report.projectionRebuilt)} · `
    + `authority preserved across rebuild: ${String(report.authorityPreservedAcrossProjectionRebuild)}`,
  ].join("\n");
}

function formatSpanRootRepairReport(report: SpanRootRepairReport): string {
  return [
    `span root repair — ${report.state} ${report.repairedAt}`,
    `run: ${report.runId}`,
    `timeline event: ${report.eventId}`,
    `authority: generation ${String(report.sourceAuthorityGeneration)} · ${report.sourceAuthorityFingerprint}`,
    `prior ingestion cursor: ${String(report.priorCursor)}`,
  ].join("\n");
}

/** The whole `cause` chain, so a refusal names the condition and not just its wrapper. */
function messageChain(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  while (current instanceof Error) {
    parts.push(current.message);
    current = current.cause;
  }
  if (parts.length === 0) parts.push(String(error));
  return parts.join(" ← ");
}


function rebuildStagedProjections(
  stateRoot: string,
  appVersion: string,
  clock: Clock,
  admission: RuntimeAdmission,
): (stagedPath: string) => Promise<void> {
  const setHash = descriptorSetHash(DESCRIPTORS.map((descriptor) => descriptor.contractFingerprint));
  return async (stagedPath: string): Promise<void> => {
    const stagedAdmission = admission.stoppedStagedAuthority(stagedPath);
    let staged: AuthorityDatabase;
    try {
      staged = AuthorityDatabase.open(
        stagedAdmission,
        { path: stagedPath, busyTimeoutMs: 5000, migrationOwner: "rebuild-storage-restore" },
        clock,
      );
    } catch (error) {
      stagedAdmission.release();
      throw error;
    }
    try {
      const projection = createRunQueueProjection({
        timeline: staged.authority.timelineEvents,
        reader: new RunRecordService({ database: staged, clock,
          ids: { uuid: () => { throw new Error("restore projector cannot mint ids"); } },
          publishQueued: () => { throw new Error("restore projector cannot publish runs"); },
        }),
        stateRoot,
        clock,
        appVersion,
        descriptorSetHash: setHash,
        ledger: createTransactionHistory(staged.authority),
        authority: {
          listNotifications: (actorId) => staged.authority.notifications.listByActor(actorId),
          latestNotificationSource: (notificationId) => staged.authority.notificationPublications.latest(notificationId),
          listNotificationCheckpoints: (workflowId, itemId, nodeId, attempt) => staged.authority.runCheckpoints.listByAttempt(workflowId, itemId, nodeId, attempt),
          listLiveWorkerLeases: () => staged.authority.workerLeases.listLive(),
          getWorkerLease: (workerId) => staged.authority.workerLeases.get(workerId),
          listWorkerPools: () => staged.authority.workerPools.list(),
          listRunBatches: () => staged.authority.runSessions.list(),
          getRunBatch: (id) => staged.authority.runSessions.get(id),
          getFailure: (failureId) => staged.authority.failures.get(failureId),
          getReceipt: (runId) => staged.authority.evidenceReceipts.findByRun(runId),
          canonicalPerson: (runId) => staged.canonicalPerson(runId),
          latestCheckpoint: (workflowId, itemId, nodeId) =>
            staged.authority.runCheckpoints.latest(workflowId, itemId, nodeId),
        },
        descriptors: { resolve: (workflowId: string) => SERVER_REGISTRY[workflowId]?.descriptor },
      });
      projection.rebuildFromTimeline();
      const health = projection.health();
      if (health.state === "degraded") {
        // A failed projection rebuild refuses restore instead of serving empty surfaces.
        throw new Error(
          `projection rebuild over the staged restore is degraded: ${health.lastError ?? "unknown"}`,
        );
      }
    } finally {
      staged.close();
      stagedAdmission.release();
    }
  };
}

export async function runOfflineAuthorityRestoreRecovery(workspace: string, args: readonly string[], clock: Clock = systemClock) {
  const fields = new Map<string, string>(); let json = false;
  for (let index = 0; index < args.length; index += 1) {
    const field = args[index];
    if (field === "--json" && !json) { json = true; continue; }
    const value = args[index + 1];
    if (field === undefined || !["--operation", "--from", "--outcome"].includes(field)
      || fields.has(field) || value === undefined || value.startsWith("--")) throw new Error("storage-recover-restore-usage");
    fields.set(field, value); index += 1;
  }
  const operationId = z.uuid().parse(fields.get("--operation"));
  const manifestPath = z.string().min(1).parse(fields.get("--from"));
  const outcome = z.enum(["unchanged", "replaced"]).parse(fields.get("--outcome"));
  const processLockRoot = join(workspace, rebuildRuntimeIsolation.processLockRoot);
  const restore = acquireRuntimeRestoreAdmission({ processLockRoot, pid: process.pid }, clock);
  let admission: RuntimeAdmission | undefined;
  try {
    const recovered = acquireRecoveryRuntimeRestore(workspace, operationId, restore);
    admission = recovered.admission;
    const sourceDatabaseIdentity = AuthorityDatabase.sourceDatabaseIdentity(recovered.input.authorityPath);
    const proofs = new RecoveryStopProofStore({ processLockRoot, maxProofAgeMs: RESTORE_STOPPED_PROOF_MAX_AGE_MS }, clock);
    proofs.recordRuntimeState(observeRuntimeLockSnapshot({ processLockRoot, sourceDatabaseIdentity }, clock));
    const stoppedSystemProof = proofs.issue({ observedBy: LOCAL_OPERATOR_ACTOR_ID, sourceDatabaseIdentity });
    const report = await settleInterruptedAuthorityRestore({ admission, operationId, manifestPath: resolve(manifestPath),
      outcome, processLockRoot, stoppedSystemProof, restoreAdmission: restore, clock });
    return { report, json };
  } finally {
    try { admission?.release(); } finally { restore.release(); }
  }
}

async function restoreCommand(
  isolation: RuntimeIsolation,
  rest: readonly string[],
  clock: Clock,
  repoRoot: string,
  admission: RuntimeAdmission,
): Promise<StorageCommandOutcome> {
  const fromIndex = rest.indexOf("--from");
  const manifestArgument = fromIndex === -1 ? undefined : rest[fromIndex + 1];
  if (manifestArgument === undefined || manifestArgument.startsWith("--")) {
    return {
      output: `storage restore requires the exact backup manifest: --from <manifest.json>\n${STORAGE_USAGE}`,
      exitCode: 2,
    };
  }
  const json = rest.includes("--json");
  const stateRoot = admission.stateRoot;
  const authorityPath = join(stateRoot, "state.db");
  const processLockRoot = join(repoRoot, isolation.processLockRoot);
  const appVersion = PackageVersionSchema.parse(
    JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")),
  ).version;
  const sourceDatabaseIdentity = AuthorityDatabase.sourceDatabaseIdentity(authorityPath);

  try {
    // The snapshot is an OBSERVATION of the two role locks, taken now — the
    // stop-proof store re-reads it at consume time and refuses if it moved.
    const snapshot = observeRuntimeLockSnapshot({ processLockRoot, sourceDatabaseIdentity }, clock);
    const proofs = new RecoveryStopProofStore(
      { processLockRoot, maxProofAgeMs: RESTORE_STOPPED_PROOF_MAX_AGE_MS },
      clock,
    );
    proofs.recordRuntimeState(snapshot);
    const stoppedSystemProof = proofs.issue({
      observedBy: LOCAL_OPERATOR_ACTOR_ID,
      sourceDatabaseIdentity,
    });
    const service = new OfflineAuthorityRestoreService(
      admission,
      {
        authorityPath,
        suspectDirectory: join(stateRoot, "backups", "suspects"),
        busyTimeoutMs: 5000,
        processLockRoot,
        stoppedProofMaxAgeMs: RESTORE_STOPPED_PROOF_MAX_AGE_MS,
      },
      rebuildStagedProjections(stateRoot, appVersion, clock, admission),
      clock,
    );
    const report = await service.restore({ manifestPath: resolve(manifestArgument), stoppedSystemProof });
    // Observe credentials only AFTER successful SQLite replacement. Their failure
    // neither authorizes a rollback nor changes the reported restore outcome.
    const credentials = (() => {
      try { return { state: "available" as const, ...protectedSettingsReadback(createCredentialStore({ admission, stateRoot }).read()) }; }
      catch { return { state: "unavailable" as const, code: "credential-store-unavailable" as const }; }
    })();
    const availability = credentials.state === "available"
      ? `credentials: revision ${String(credentials.revision)}; ${Object.entries(credentials.entries).map(([name, entry]) => `${name}=${entry.present ? "present" : "absent"}`).join(" · ")}`
      : "credentials: unavailable — credential-store-unavailable";
    return {
      output: json ? JSON.stringify({ ...report, credentials }, null, 2) : `${formatRestoreReport(report)}\n${availability}`,
      exitCode: 0,
    };
  } catch (error) {

    const snapshotLine = describeLocksForRefusal(processLockRoot, sourceDatabaseIdentity, clock);
    const disposition = restoreFailureDisposition(error);
    return {
      output: [
        `${disposition.heading} — ${messageChain(error)}`,
        `process locks: ${snapshotLine}`,
        disposition.authorityLine,
      ].join("\n"),
      exitCode: 1,
    };
  }
}

async function repairSpanRootCommand(
  isolation: RuntimeIsolation,
  rest: readonly string[],
  clock: Clock,
  repoRoot: string,
  admission: RuntimeAdmission,
): Promise<StorageCommandOutcome> {
  const runIndex = rest.indexOf("--run");
  const runId = runIndex === -1 ? undefined : rest[runIndex + 1];
  if (runId === undefined || runId.startsWith("--")) {
    return {
      output: `storage repair-span-root requires one exact run id: --run <run-id>\n${STORAGE_USAGE}`,
      exitCode: 2,
    };
  }
  const json = rest.includes("--json");
  const stateRoot = admission.stateRoot;
  const authorityPath = join(stateRoot, "state.db");
  const processLockRoot = join(repoRoot, isolation.processLockRoot);
  const sourceDatabaseIdentity = AuthorityDatabase.sourceDatabaseIdentity(authorityPath);
  try {
    const snapshot = observeRuntimeLockSnapshot({ processLockRoot, sourceDatabaseIdentity }, clock);
    const proofs = new RecoveryStopProofStore(
      { processLockRoot, maxProofAgeMs: RESTORE_STOPPED_PROOF_MAX_AGE_MS },
      clock,
    );
    proofs.recordRuntimeState(snapshot);
    const stoppedSystemProof = proofs.issue({
      observedBy: LOCAL_OPERATOR_ACTOR_ID,
      sourceDatabaseIdentity,
    });
    const service = new OfflineSpanRootRepairService(admission, {
      stateRoot,
      authorityPath,
      processLockRoot,
      stoppedProofMaxAgeMs: RESTORE_STOPPED_PROOF_MAX_AGE_MS,
      busyTimeoutMs: 5000,
    }, clock);
    const report = service.repair({ runId, stoppedSystemProof });
    return {
      output: json ? JSON.stringify(report, null, 2) : formatSpanRootRepairReport(report),
      exitCode: 0,
    };
  } catch (error) {
    return {
      output: [
        `span root repair REFUSED — ${messageChain(error)}`,
        `process locks: ${describeLocksForRefusal(processLockRoot, sourceDatabaseIdentity, clock)}`,
        "rerun doctor before deciding the next action; an exact repeat reuses the retained marked event without another append",
      ].join("\n"),
      exitCode: 1,
    };
  }
}


function describeLocksForRefusal(
  processLockRoot: string,
  sourceDatabaseIdentity: string,
  clock: Clock,
): string {
  try {
    return formatLockSnapshot(
      observeRuntimeLockSnapshot({ processLockRoot, sourceDatabaseIdentity }, clock),
    );
  } catch (error) {
    return `unreadable (${messageChain(error)})`;
  }
}

// Backup opens existing authority only; missing authority is a refusal, never an empty backup.
async function backupCommand(
  isolation: RuntimeIsolation,
  rest: readonly string[],
  clock: Clock,
  repoRoot: string,
  admission: RuntimeAdmission,
): Promise<StorageCommandOutcome> {
  const json = rest.includes("--json");
  const stateRoot = admission.stateRoot;
  const authorityPath = join(stateRoot, "state.db");
  if (!existsSync(authorityPath)) {
    return {
      output: `storage backup REFUSED — no authority database exists at ${basename(stateRoot)}/state.db; `
        + "start the dashboard once to create it, then back it up",
      exitCode: 1,
    };
  }
  const { backupStoppedAuthority } = await import("../../storage/maintenance/upgrade.js");
  const report = await backupStoppedAuthority(admission,stateRoot, clock,join(repoRoot,isolation.processLockRoot));
    const manifest = report.manifests.at(-1);
    if (manifest === undefined) {
      throw new Error("verified backup run reported no manifest");
    }
    return {
      output: json
        ? JSON.stringify(report, null, 2)
        : [
            `backup: verified — ${manifest.backupFileName}`,
            `  generation ${String(manifest.authorityGeneration)}, ${String(manifest.byteSize)} bytes, sha256 ${manifest.sha256}`,
            `  manifest ${manifest.backupFileName}.manifest.json (restore with: storage restore --from <that manifest>)`,
          ].join("\n"),
      exitCode: 0,
    };

}

/** Clears a ChatGPT credential lock whose recorded owner process is gone; a live owner is refused. */
async function recoverChatGptLockCommand(rest: readonly string[], admission: RuntimeAdmission): Promise<StorageCommandOutcome> {
  if (rest.length !== 0) return { output: `unsupported storage recover-chatgpt-lock argument: ${rest[0] ?? ""}\n${STORAGE_USAGE}`, exitCode: 2 };
  if (!existsSync(join(admission.stateRoot, "credentials", ".chatgpt-account.lock"))) {
    return { output: "storage recover-chatgpt-lock: no ChatGPT credential lock", exitCode: 0 };
  }
  try {
    await createChatGptCredentialRepository({ admission, stateRoot: admission.stateRoot }).withLock(async () => undefined);
  } catch (error) {
    if (error instanceof ChatGptCredentialError) return { output: `storage recover-chatgpt-lock: ${error.code}: ${error.message}`, exitCode: 1 };
    throw error;
  }
  return { output: "storage recover-chatgpt-lock: cleared an abandoned ChatGPT credential lock", exitCode: 0 };
}

export async function composeStorageCommand(
  isolation: RuntimeIsolation,
  args: readonly string[],
  clock: Clock = systemClock,
  repoRoot: string = process.cwd(),
  admissionInput?: RuntimeAdmission,
): Promise<StorageCommandOutcome> {
  const admission = requireRuntimeAdmission(admissionInput);
  const [subcommand, ...rest] = args;
  if (subcommand === "upgrade") {
    for (let index = 0; index < rest.length; index += 1) {
      const argument = rest[index];
      if (argument === "--plan" || argument === "--json") continue;
      return { output: `unsupported storage upgrade argument: ${argument ?? "missing"}\n${STORAGE_USAGE}`, exitCode: 2 };
    }
    try {
      const { upgradeStorage } = await import("../../storage/maintenance/upgrade.js");
      const report = await upgradeStorage(admission,{ stateRoot: admission.stateRoot,
        processLockRoot: join(repoRoot, isolation.processLockRoot), plan: rest.includes("--plan") }, clock);
      return { output: rest.includes("--json") ? JSON.stringify(report, null, 2) : [
        `storage upgrade: ${report.state} (v${String(report.fromSchemaVersion)} → v${String(report.toSchemaVersion)})`,
        "credentials: unchanged",
        ...(report.diagnostics === undefined ? [] : [
          `diagnostic stages: ${String(report.diagnostics.reclaimedStages)} reclaimed, ${String(report.diagnostics.retainedStages)} retained${report.diagnostics.capacityWarning ? "; retained evidence remains budget-accounted" : ""}`,
        ]),
      ].join("\n"), exitCode: 0 };
    } catch (error) {
      // Unvalidated parser/OS error text can contain input. Emit only a named outcome.
      const code = error instanceof Error ? /^([a-z]+(?:-[a-z]+)+)(?:[: {]|$)/u.exec(error.message)?.[1] : undefined;
      const candidateKey = error instanceof Error ? /\{ key: ([A-Za-z0-9.*_-]+) \}/u.exec(error.message)?.[1] : undefined;
      const key = candidateKey !== undefined && SETTINGS_CATALOG.some((row) => row.key === candidateKey
        || (row.key.startsWith("urls.") && candidateKey.startsWith(`${row.key}.`))) ? candidateKey : undefined;
      const report = { state: "refused-or-incomplete", code: code ?? "upgrade-validation-failed", ...(key === undefined ? {} : { key }) };
      return { output: rest.includes("--json") ? JSON.stringify(report) : `storage upgrade: ${report.code}${key === undefined ? "" : ` { key: ${key} }`}; inspect state before retrying`, exitCode: 1 };
    }
  }
  if (subcommand === "retire-orphan-verification") {
    const parsed = z.tuple([z.literal("--acquisition"), z.uuid()]).safeParse(rest.slice(0, 2));
    if (!parsed.success || rest.slice(2).some(arg => arg !== "--plan" && arg !== "--json")
      || new Set(rest).size !== rest.length) return { output: STORAGE_USAGE, exitCode: 2 };
    let database: AuthorityDatabase | undefined;
    try {
      admission.assertExclusive();
      if (admission.readInstallationContext() !== undefined) admission.assertFixedProcessLockRoot(repoRoot, join(repoRoot, isolation.processLockRoot));
      database = AuthorityDatabase.open(admission, { path: join(admission.stateRoot, "state.db"), busyTimeoutMs: 5000,
        migrationOwner: "orphan-verification-retirement" }, clock);
      const report = retireOrphanVerification(admission, database, { acquisitionId: parsed.data[1], plan: rest.includes("--plan") }, clock);
      return { output: rest.includes("--json") ? JSON.stringify(report) : `orphan verification: ${report.state} ${report.workerId}`, exitCode: 0 };
    } catch {
      const code = "ORPHAN_VERIFICATION_RETIREMENT_REFUSED";
      return { output: rest.includes("--json") ? JSON.stringify({ state: "refused", code }) : `${code}: ${ERROR_CATALOG[code].text}`, exitCode: 1 };
    } finally { database?.close(); }
  }
  if (subcommand === "restore") return restoreCommand(isolation, rest, clock, repoRoot, admission);
  if (subcommand === "backup") return backupCommand(isolation, rest, clock, repoRoot, admission);
  if (subcommand === "repair-span-root") return repairSpanRootCommand(isolation, rest, clock, repoRoot, admission);
  if (subcommand === "recover-chatgpt-lock") return recoverChatGptLockCommand(rest, admission);
  if (subcommand !== "doctor") {
    return { output: STORAGE_USAGE, exitCode: subcommand === undefined ? 1 : 2 };
  }
  const json = rest.includes("--json");
  const stateRoot = admission.stateRoot;
  const report = await doctorAuthorityStorage(admission, {
    stateRootTrustAnchor: resolve(stateRoot, ".."),
    stateRoot,
    authorityPath: join(stateRoot, "state.db"),
    backupDirectory: join(stateRoot, "backups", "authority"),
    busyTimeoutMs: 5000,
  }, clock);
  const healthy = report.authority.state === "healthy"
    && report.recovery.state === "clear"
    && report.spanAuthority.state === "reconciled"
    && report.protectedSettings.state === "available";
  return {
    output: json ? JSON.stringify(report, null, 2) : formatReport(report),
    exitCode: healthy ? 0 : 1,
  };
}
