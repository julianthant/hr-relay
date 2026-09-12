import { verifyBackupManifestAtPath } from "../../infra/sqlite/backup-service.js";
import { backupHasArchiveTransferCustody } from "../../infra/compat/backup-inspection.js";
import { restoreLifecyclePair, verifyLifecyclePair } from "../../infra/sqlite/lifecycle-storage.js";
import { RunRecordService } from "../../core/run-record-service.js";
/**
 * `cli storage doctor` and `cli storage restore` (ref dashboard-surfaces
 * §2.5).
 *
 * `doctor` is the read-only recovery report. It opens NOTHING read-write —
 * the doctor inspects the exact authority copy, reconciles its strict run
 * identities against the configured span root, and re-verifies backup bytes
 * — and its exit code is scriptable: 0 only when authority and span/authority
 * reconciliation are healthy AND a verified current backup exists; 1
 * otherwise, with the reasons printed.
 *
 * `restore` (D181) replaces SQLite; `backup` and stopped `upgrade` have separate writing arms. It never picks a backup: the operator names the
 * exact manifest with `--from`, because "restore the newest" is a decision
 * about which minutes of real HR work to discard and no default is right. It
 * observes the runtime's process locks, records that observation, issues the
 * one-time stopped-system proof from it, and hands the whole thing to
 * `OfflineAuthorityRestoreService`, which re-verifies the checksum, quarantines
 * the suspect database, rebuilds projections against the STAGED copy, and only
 * then swaps atomically.
 *
 * The live backup service's last-run state belongs to the dashboard process
 * and is served on its Settings surface / doctor route; this process cannot
 * see it and does not pretend to.
 */
import { SETTINGS_CATALOG } from "../../domain/config/catalog.js";
import { createCredentialStore } from "../../infra/config/credential-store.js";
import { protectedSettingsReadback } from "../../domain/config/protected-settings.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../infra/sqlite/migrations.js";
import { existsSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { z } from "zod";
import type { RuntimeIsolation } from "../../config/define-runtime-isolation.js";
import { DESCRIPTORS, SERVER_REGISTRY } from "../../control/workflow-registry.js";
import type { Clock } from "../../domain/clock.js";
import { systemClock } from "../../domain/clock.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../domain/ids.js";
import {
  AuthorityDatabase,
  OfflineAuthorityRestoreService,
  OfflineRestoreFailure,
  RecoveryStopProofStore,
  doctorAuthorityStorage,
  summarizeSpanAuthorityReconciliation,
} from "../../infra/sqlite/index.js";
import { observeRuntimeLockSnapshot } from "../../infra/sqlite/runtime-process-locks.js";
import type {
  OfflineRestoreReport,
  RecoveryRuntimeLockSnapshot,
  StorageDoctorReport,
} from "../../infra/sqlite/recovery-contracts.js";
import {
  descriptorSetHash,
} from "../dashboard/compose.js";
import { createRunQueueProjection } from "../dashboard/projectors/run-queue-projection.js";
import { createTransactionHistory } from "../../infra/sqlite/transaction-history.js";
import {
  OfflineSpanRootRepairService,
  type SpanRootRepairReport,
} from "./span-root-repair.js";

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

/**
 * How long the observed runtime-lock snapshot and the proof derived from it
 * stay usable. Short on purpose: the proof asserts the system was stopped, and
 * that claim decays the moment the operator can start it again.
 */
export const RESTORE_STOPPED_PROOF_MAX_AGE_MS = 5 * 60_000;

const PackageVersionSchema = z.strictObject({ version: z.string().min(1) }).loose();

const STORAGE_USAGE = [
  "usage: storage doctor [--json]",
  "       storage backup [--json]",
  "       storage upgrade [--plan] [--timeline-from <verified-copy-directory>] [--json]",
  "       storage restore --from <manifest.json> [--json]",
  "       storage repair-span-root --run <run-id> [--json]",
  "  doctor   read-only authority + span reconciliation + backup report (ref dashboard-surfaces §2.5); exit 0 only when",
  "           authority and span/authority reconciliation are healthy; the backup arm is reported, not gated (D322)",
  "  backup   write ONE verified authority backup + manifest under the state root's backups/authority;",
  "           this command is the only backup writer (D322) — the dashboard runs no cadence",
  "  restore  quarantine the suspect authority and swap in one EXACT verified backup,",
  "           rebuilding projections against the staged copy first; the runtime must be",
  "           stopped and the manifest is never chosen for you",
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
    // D308 tombstone facts: run identity and when it left, nothing about a person.
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
        `  ok ${candidate.manifestFileName} — created ${candidate.createdAt}, `
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

/**
 * Rebuild and verify optional span evidence against the staged canonical runs.
 * This never persists a run mirror. The restore service re-inspects authority
 * fingerprint and generation afterwards and refuses any authority mutation.
 */
function rebuildStagedProjections(
  stateRoot: string,
  appVersion: string,
  clock: Clock,
): (stagedPath: string) => Promise<void> {
  const setHash = descriptorSetHash(DESCRIPTORS.map((descriptor) => descriptor.contractFingerprint));
  return async (stagedPath: string): Promise<void> => {
    const staged = AuthorityDatabase.open(
      { path: stagedPath, busyTimeoutMs: 5000, migrationOwner: "rebuild-storage-restore" },
      clock,
    );
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
        // `rebuildFromTimeline` never throws — it records. Restoring onto a
        // projection that could not be rebuilt would hand the operator a
        // database whose surfaces are silently empty, so the refusal happens
        // here, while the live authority is still untouched.
        throw new Error(
          `projection rebuild over the staged restore is degraded: ${health.lastError ?? "unknown"}`,
        );
      }
    } finally {
      staged.close();
    }
  };
}

async function restoreCommand(
  isolation: RuntimeIsolation,
  rest: readonly string[],
  clock: Clock,
  repoRoot: string,
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
  const stateRoot = join(repoRoot, isolation.stateRoot);
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
      {
        authorityPath,
        suspectDirectory: join(stateRoot, "suspects"),
        busyTimeoutMs: 5000,
        processLockRoot,
        stoppedProofMaxAgeMs: RESTORE_STOPPED_PROOF_MAX_AGE_MS,
      },
      rebuildStagedProjections(stateRoot, appVersion, clock),
      clock,
    );
    const resolvedManifest = resolve(manifestArgument);
    const paired = resolvedManifest.endsWith(".lifecycle.json");
    const pairedSelection=paired ? await verifyLifecyclePair(resolvedManifest) : undefined;
    const selected = paired ? undefined : await verifyBackupManifestAtPath(resolvedManifest,sourceDatabaseIdentity);
    const historical = selected !== undefined && selected.manifest.schemaVersion < CURRENT_AUTHORITY_SCHEMA_VERSION;
    if (selected !== undefined && !historical && (existsSync(join(stateRoot,"archive.sqlite"))
      || backupHasArchiveTransferCustody(selected.backupPath))) throw new Error("paired-lifecycle-backup-required");
    const { upgradeStorage } = await import("./upgrade.js");
    const { restoreHistoricalStorage } = await import("./historical-restore.js");
    const historicalResult = historical ? await restoreHistoricalStorage({authorityPath,suspectDirectory:join(stateRoot,"suspects"),busyTimeoutMs:5000,
      processLockRoot,stoppedProofMaxAgeMs:RESTORE_STOPPED_PROOF_MAX_AGE_MS},{manifestPath:resolvedManifest,stoppedSystemProof},join(repoRoot,".env"),clock) : undefined;
    const report = historicalResult !== undefined ? historicalResult.report : paired ? await restoreLifecyclePair({authorityPath,suspectDirectory:join(stateRoot,"suspects"),busyTimeoutMs:5000,
      processLockRoot,stoppedProofMaxAgeMs:RESTORE_STOPPED_PROOF_MAX_AGE_MS},
      {manifestPath:resolvedManifest,stoppedSystemProof},rebuildStagedProjections(stateRoot,appVersion,clock),clock) : await service.restore({
      manifestPath: resolve(manifestArgument),
      stoppedSystemProof,
    });
    const upgrade = historicalResult?.upgrade ?? (report.schemaVersion < CURRENT_AUTHORITY_SCHEMA_VERSION
      ? await upgradeStorage({stateRoot,processLockRoot,environmentFile:join(repoRoot,".env"),plan:false,backupManifest:pairedSelection?.live.manifestPath},clock) : undefined);
    // Observe credentials only AFTER successful SQLite replacement. Their failure
    // neither authorizes a rollback nor changes the reported restore outcome.
    const credentials = (() => {
      try { return { state: "available" as const, ...protectedSettingsReadback(createCredentialStore({ stateRoot }).read()) }; }
      catch { return { state: "unavailable" as const, code: "credential-store-unavailable" as const }; }
    })();
    const availability = credentials.state === "available"
      ? `credentials: revision ${String(credentials.revision)}; ${Object.entries(credentials.entries).map(([name, entry]) => `${name}=${entry.present ? "present" : "absent"}`).join(" · ")}`
      : "credentials: unavailable — credential-store-unavailable";
    return {
      output: json ? JSON.stringify({ ...report, credentials, ...(upgrade === undefined ? {} : {upgrade}) }, null, 2) : `${formatRestoreReport(report)}\n${availability}${upgrade === undefined ? "" : `\nstorage upgrade: ${upgrade.state} (v${String(upgrade.fromSchemaVersion)} → v${String(upgrade.toSchemaVersion)})`}`,
      exitCode: 0,
    };
  } catch (error) {
    // A refusal is the expected outcome of a running runtime, a tampered
    // backup, or an unreadable manifest, and the operator needs to read it —
    // so it is REPORTED with its whole cause chain and a non-zero status, not
    // rethrown as a stack trace. Nothing is defaulted: every field below is
    // derived from the failure itself. The service marks whether atomic
    // replacement already happened, so a post-swap fsync/report/release error
    // can never be described as an untouched live authority.
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
  const stateRoot = join(repoRoot, isolation.stateRoot);
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
    const service = new OfflineSpanRootRepairService({
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

/**
 * The lock line printed beside a refusal. If the observation ITSELF is what
 * failed, say so rather than printing a shape that implies the locks were read.
 */
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

/**
 * D322: the ONE backup writer. Opens the existing authority (never creates
 * one — a missing database is a refusal, not an empty backup), asks the real
 * `AuthorityBackupService` for a verified backup at the live generation, and
 * prints the manifest it wrote. Safe beside a running dashboard: SQLite's
 * online backup reads a consistent snapshot under WAL.
 */
async function backupCommand(
  isolation: RuntimeIsolation,
  rest: readonly string[],
  clock: Clock,
  repoRoot: string,
): Promise<StorageCommandOutcome> {
  const json = rest.includes("--json");
  const stateRoot = join(repoRoot, isolation.stateRoot);
  const authorityPath = join(stateRoot, "state.db");
  if (!existsSync(authorityPath)) {
    return {
      output: `storage backup REFUSED — no authority database exists at ${basename(stateRoot)}/state.db; `
        + "start the dashboard once to create it, then back it up",
      exitCode: 1,
    };
  }
  const { backupStoppedAuthority } = await import("./upgrade.js");
  const report = await backupStoppedAuthority(stateRoot, clock);
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
            `  manifest ${"pairedManifestPath" in report ? String(report.pairedManifestPath) : `${manifest.backupFileName}.manifest.json`} (restore with: storage restore --from <that manifest>)`,
          ].join("\n"),
      exitCode: 0,
    };

}

export async function composeStorageCommand(
  isolation: RuntimeIsolation,
  args: readonly string[],
  clock: Clock = systemClock,
  repoRoot: string = process.cwd(),
): Promise<StorageCommandOutcome> {
  const [subcommand, ...rest] = args;
  if (subcommand === "upgrade") {
    let timelineSourceDirectory: string | undefined;
    for (let index = 0; index < rest.length; index += 1) {
      const argument = rest[index];
      if (argument === "--plan" || argument === "--json") continue;
      if (argument === "--timeline-from" && timelineSourceDirectory === undefined
        && rest[index + 1] !== undefined && !rest[index + 1]?.startsWith("--")) {
        timelineSourceDirectory = rest[++index];
        continue;
      }
      return { output: `unsupported storage upgrade argument: ${argument ?? "missing"}\n${STORAGE_USAGE}`, exitCode: 2 };
    }
    try {
      const { upgradeStorage } = await import("./upgrade.js");
      const report = await upgradeStorage({ stateRoot: join(repoRoot, isolation.stateRoot),
        processLockRoot: join(repoRoot, isolation.processLockRoot), environmentFile: join(repoRoot, ".env"), plan: rest.includes("--plan"),
        ...(timelineSourceDirectory === undefined ? {} : { timelineSourceDirectory }) }, clock);
      return { output: rest.includes("--json") ? JSON.stringify(report, null, 2) : [
        `storage upgrade: ${report.state} (v${String(report.fromSchemaVersion)} → v${String(report.toSchemaVersion)})`,
        `imported keys: ${report.importedKeys.join(", ")}`,
        `sources: ${report.sourceFiles.join(", ")}`,
        `retained historical exposure: ${report.historicalExposure.join(", ")}`,
        `tombstone backfill: roots ${String(report.tombstoneBackfill.fromRoots)}, reconstructed ${String(report.tombstoneBackfill.fromReconstructedRoots)}, unknown ${String(report.tombstoneBackfill.unknown)}, missing runNumber ${String(report.tombstoneBackfill.missingRunNumber)}`,
        `orphan gate records removed: ${String(report.orphanGateRecordsRemoved)}`,
        "credentials: unchanged",
        `cleanup required in .env: ${report.envKeysToRemove.join(", ")}`,
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
  if (subcommand === "restore") return restoreCommand(isolation, rest, clock, repoRoot);
  if (subcommand === "backup") return backupCommand(isolation, rest, clock, repoRoot);
  if (subcommand === "repair-span-root") return repairSpanRootCommand(isolation, rest, clock, repoRoot);
  if (subcommand !== "doctor") {
    return { output: STORAGE_USAGE, exitCode: subcommand === undefined ? 1 : 2 };
  }
  const json = rest.includes("--json");
  const stateRoot = join(repoRoot, isolation.stateRoot);
  const report = await doctorAuthorityStorage({
    stateRootTrustAnchor: repoRoot,
    stateRoot,
    authorityPath: join(stateRoot, "state.db"),
    backupDirectory: join(stateRoot, "backups", "authority"),
    busyTimeoutMs: 5000,
  }, clock);
  const healthy = report.authority.state === "healthy"
    && report.spanAuthority.state === "reconciled"
    && report.protectedSettings.state === "available";
  return {
    output: json ? JSON.stringify(report, null, 2) : formatReport(report),
    exitCode: healthy ? 0 : 1,
  };
}
