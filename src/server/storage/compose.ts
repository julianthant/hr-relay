/**
 * `rebuild:cli storage doctor` (doc 03 §2.5): the read-only recovery report
 * from the command line. It opens NOTHING read-write — the doctor inspects
 * the authority copy read-only and re-verifies backup bytes — and its exit
 * code is scriptable: 0 only when authority is healthy AND a verified
 * current backup exists; 1 otherwise, with the reasons printed.
 *
 * The live backup service's last-run state belongs to the dashboard process
 * and is served on its Settings surface / doctor route; this process cannot
 * see it and does not pretend to.
 */
import { join } from "node:path";
import type { RuntimeIsolation } from "../../config/define-runtime-isolation.js";
import type { Clock } from "../../domain/clock.js";
import { systemClock } from "../../domain/clock.js";
import { doctorAuthorityStorage } from "../../infra/sqlite/index.js";
import type { StorageDoctorReport } from "../../infra/sqlite/recovery-contracts.js";
import {
  AUTHORITY_BACKUP_MAX_AGE_MS,
} from "../dashboard/compose.js";

export interface StorageCommandOutcome {
  readonly output: string;
  readonly exitCode: number;
}

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

export async function composeStorageCommand(
  isolation: RuntimeIsolation,
  args: readonly string[],
  clock: Clock = systemClock,
): Promise<StorageCommandOutcome> {
  const [subcommand, ...rest] = args;
  if (subcommand !== "doctor") {
    return {
      output: [
        "usage: storage doctor [--json]",
        "  doctor  read-only authority + backup health report (doc 03 §2.5); exit 0 only when",
        "          authority is healthy AND a verified current backup exists",
      ].join("\n"),
      exitCode: subcommand === undefined ? 1 : 2,
    };
  }
  const json = rest.includes("--json");
  const stateRoot = join(process.cwd(), isolation.stateRoot);
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
