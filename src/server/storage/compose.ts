/**
 * `rebuild:cli storage doctor` and `rebuild:cli storage restore` (doc 03
 * §2.5).
 *
 * `doctor` is the read-only recovery report. It opens NOTHING read-write —
 * the doctor inspects the authority copy read-only and re-verifies backup
 * bytes — and its exit code is scriptable: 0 only when authority is healthy
 * AND a verified current backup exists; 1 otherwise, with the reasons
 * printed.
 *
 * `restore` (D181) is the other half, and it is deliberately the ONLY writing
 * arm of this command family. It never picks a backup: the operator names the
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
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import type { RuntimeIsolation } from "../../config/define-runtime-isolation.js";
import { DESCRIPTORS, SERVER_REGISTRY } from "../../control/workflow-registry.js";
import type { Clock } from "../../domain/clock.js";
import { systemClock } from "../../domain/clock.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../domain/ids.js";
import {
  AuthorityDatabase,
  OfflineAuthorityRestoreService,
  RecoveryStopProofStore,
  doctorAuthorityStorage,
} from "../../infra/sqlite/index.js";
import { observeRuntimeLockSnapshot } from "../../infra/sqlite/runtime-process-locks.js";
import type {
  OfflineRestoreReport,
  RecoveryRuntimeLockSnapshot,
  StorageDoctorReport,
} from "../../infra/sqlite/recovery-contracts.js";
import {
  AUTHORITY_BACKUP_MAX_AGE_MS,
  descriptorSetHash,
} from "../dashboard/compose.js";
import { createRunQueueProjection } from "../dashboard/projectors/run-queue-projection.js";

export interface StorageCommandOutcome {
  readonly output: string;
  readonly exitCode: number;
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
  "       storage restore --from <manifest.json> [--json]",
  "  doctor   read-only authority + backup health report (doc 03 §2.5); exit 0 only when",
  "           authority is healthy AND a verified current backup exists",
  "  restore  quarantine the suspect authority and swap in one EXACT verified backup,",
  "           rebuilding projections against the staged copy first; the runtime must be",
  "           stopped and the manifest is never chosen for you",
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
  if (report.counts.state === "available") {
    const values = report.counts.values;
    lines.push(
      `pending: commands ${String(values.pendingCommands)} · write intents ${String(values.unresolvedWriteIntents)} `
      + `· leases ${String(values.leases)} · outbox ${String(values.durableOutbox)} `
      + `· terminal outbox ${String(values.runTerminalOutbox)} · provider reservations ${String(values.providerReservations)} `
      + `· artifact outbox ${String(values.artifactOutbox)} · capture finalizations ${String(values.captureFinalizationOutboxes)}`,
    );
  } else {
    lines.push(`pending: unavailable — ${report.counts.cause.code}: ${report.counts.cause.summary}`);
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
    `projections rebuilt: ${String(report.projectionRebuilt)} · `
    + `authority preserved across rebuild: ${String(report.authorityPreservedAcrossProjectionRebuild)}`,
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
 * Fold the staged copy's span history back into its projection tables.
 *
 * It runs against the STAGED database, never the live one, and it touches only
 * `runs_view`/`spans`/`gates`/`notes` — `OfflineAuthorityRestoreService`
 * re-inspects afterwards and aborts the whole restore if the authority
 * fingerprint or generation moved, so a projector that reached an authority
 * table would fail the restore rather than corrupt it.
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
        stateRoot,
        clock,
        appVersion,
        descriptorSetHash: setHash,
        authority: {
          getRun: (runId) => staged.authority.runs.get(runId),
          listNotifications: (actorId) => staged.authority.notifications.listByActor(actorId),
          isArchived: (runId) => staged.authority.archivedRuns.isArchived(runId),
          getFailure: (failureId) => staged.authority.failures.get(failureId),
          getReceipt: (runId) => staged.authority.evidenceReceipts.findByRun(runId),
        },
        descriptors: { resolve: (workflowId: string) => SERVER_REGISTRY[workflowId]?.descriptor },
        projectionStore: staged,
      });
      projection.rebuildFromJsonl();
      const health = projection.health();
      if (health.state === "degraded") {
        // `rebuildFromJsonl` never throws — it records. Restoring onto a
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
    const report = await service.restore({
      manifestPath: resolve(manifestArgument),
      stoppedSystemProof,
    });
    return {
      output: json ? JSON.stringify(report, null, 2) : formatRestoreReport(report),
      exitCode: 0,
    };
  } catch (error) {
    // A refusal is the expected outcome of a running runtime, a tampered
    // backup, or an unreadable manifest, and the operator needs to read it —
    // so it is REPORTED with its whole cause chain and a non-zero status, not
    // rethrown as a stack trace. Nothing is defaulted: every field below is
    // derived from the failure itself, and the live authority is untouched
    // because the service preserves and swaps only after every check passed.
    const snapshotLine = describeLocksForRefusal(processLockRoot, sourceDatabaseIdentity, clock);
    return {
      output: [
        `authority restore REFUSED — ${messageChain(error)}`,
        `process locks: ${snapshotLine}`,
        "the live authority database was not modified",
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

export async function composeStorageCommand(
  isolation: RuntimeIsolation,
  args: readonly string[],
  clock: Clock = systemClock,
  repoRoot: string = process.cwd(),
): Promise<StorageCommandOutcome> {
  const [subcommand, ...rest] = args;
  if (subcommand === "restore") return restoreCommand(isolation, rest, clock, repoRoot);
  if (subcommand !== "doctor") {
    return { output: STORAGE_USAGE, exitCode: subcommand === undefined ? 1 : 2 };
  }
  const json = rest.includes("--json");
  const stateRoot = join(repoRoot, isolation.stateRoot);
  const report = await doctorAuthorityStorage({
    authorityPath: join(stateRoot, "state.db"),
    backupDirectory: join(stateRoot, "backups", "authority"),
    maxBackupAgeMs: AUTHORITY_BACKUP_MAX_AGE_MS,
    busyTimeoutMs: 5000,
  }, clock);
  const healthy = report.authority.state === "healthy" && report.backup.state === "current";
  return {
    output: json ? JSON.stringify(report, null, 2) : formatReport(report),
    exitCode: healthy ? 0 : 1,
  };
}
