import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { z } from "zod";
import type { Clock } from "../../domain/clock.js";
import { systemClock } from "../../domain/clock.js";
import { AuthorityDatabase } from "./authority-database.js";
import { storageHealthCauseFromError } from "./authority-boot.js";
import { verifyBackupManifestAtPath } from "./backup-service.js";
import {
  BackupHealthSchema,
  RestoreCandidateSchema,
  StorageDoctorReportSchema,
  StorageHealthCauseSchema,
  type AuthorityCopyInspection,
  type RestoreCandidate,
  type StorageDoctorReport,
} from "./recovery-contracts.js";

export const StorageDoctorOptionsSchema = z.strictObject({
  authorityPath: z.string().min(1),
  backupDirectory: z.string().min(1),
  maxBackupAgeMs: z.number().int().positive(),
  busyTimeoutMs: z.number().int().positive(),
});

type CandidateWithMtime = Readonly<{
  candidate: RestoreCandidate;
  modifiedMs: number;
}>;

function backupInvalidCause(error: unknown) {
  return StorageHealthCauseSchema.parse({
    code: "backup-invalid",
    summary: error instanceof Error ? error.message : String(error),
  });
}

async function inspectCandidates(
  directory: string,
  sourceDatabaseIdentity: string,
  authorityInspection: AuthorityCopyInspection | undefined,
  clock: Clock,
): Promise<readonly CandidateWithMtime[]> {
  if (!existsSync(directory)) return [];
  const manifestNames = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".manifest.json"))
    .map(({ name }) => name)
    .sort();
  const candidates: CandidateWithMtime[] = [];
  for (const manifestFileName of manifestNames) {
    const manifestPath = join(directory, manifestFileName);
    const modifiedMs = statSync(manifestPath).mtimeMs;
    try {
      const verified = await verifyBackupManifestAtPath(manifestPath, sourceDatabaseIdentity);
      const ageMs = clock.nowMs() - Date.parse(verified.manifest.createdAt);
      if (ageMs < 0) throw new Error(`backup manifest ${manifestFileName} was created in the future`);
      const generationGap = authorityInspection === undefined
        ? { state: "unavailable" as const, reason: "live authority generation is unavailable" }
        : {
            state: "known" as const,
            value: Math.max(0, authorityInspection.authorityGeneration - verified.manifest.authorityGeneration),
          };
      candidates.push({
        modifiedMs,
        candidate: RestoreCandidateSchema.parse({
          state: "verified-compatible",
          manifestFileName,
          backupFileName: verified.manifest.backupFileName,
          createdAt: verified.manifest.createdAt,
          authorityGeneration: verified.manifest.authorityGeneration,
          ageMs,
          generationGap,
        }),
      });
    } catch (error) {
      candidates.push({
        modifiedMs,
        candidate: RestoreCandidateSchema.parse({
          state: "invalid",
          manifestFileName,
          cause: backupInvalidCause(error),
        }),
      });
    }
  }
  return candidates.sort((left, right) => right.modifiedMs - left.modifiedMs);
}

export async function doctorAuthorityStorage(input: unknown, clock: Clock = systemClock): Promise<StorageDoctorReport> {
  const options = StorageDoctorOptionsSchema.parse(input);
  const authorityPath = resolve(options.authorityPath);
  const backupDirectory = resolve(options.backupDirectory);
  const sourceDatabaseIdentity = AuthorityDatabase.sourceDatabaseIdentity(authorityPath);
  let authorityInspection: AuthorityCopyInspection | undefined;
  let authorityCause: ReturnType<typeof storageHealthCauseFromError> | undefined;
  try {
    authorityInspection = AuthorityDatabase.inspectExistingReadOnly(authorityPath, options.busyTimeoutMs);
  } catch (error) {
    authorityCause = storageHealthCauseFromError(error);
  }

  const candidates = await inspectCandidates(
    backupDirectory,
    sourceDatabaseIdentity,
    authorityInspection,
    clock,
  );
  const first = candidates[0];
  const latestVerified = candidates
    .filter((entry): entry is CandidateWithMtime & { candidate: Extract<RestoreCandidate, { state: "verified-compatible" }> } => (
      entry.candidate.state === "verified-compatible"
    ))
    .sort((left, right) => Date.parse(right.candidate.createdAt) - Date.parse(left.candidate.createdAt))[0];

  let backup: z.infer<typeof BackupHealthSchema>;
  if (first?.candidate.state === "invalid") {
    backup = BackupHealthSchema.parse({ state: "invalid", cause: first.candidate.cause });
  } else if (latestVerified === undefined) {
    backup = BackupHealthSchema.parse({
      state: candidates.length === 0 ? "missing" : "invalid",
      cause: StorageHealthCauseSchema.parse({
        code: candidates.length === 0 ? "backup-missing" : "backup-invalid",
        summary: candidates.length === 0
          ? `no authority backup manifests exist in ${basename(backupDirectory)}`
          : `no verified compatible authority backup exists in ${basename(backupDirectory)}`,
      }),
    });
  } else {
    const generationGap = latestVerified.candidate.generationGap;
    const stale = latestVerified.candidate.ageMs > options.maxBackupAgeMs
      || generationGap.state === "known" && generationGap.value > 0;
    const gapSummary = generationGap.state === "known"
      ? String(generationGap.value)
      : generationGap.reason;
    backup = BackupHealthSchema.parse(stale
      ? {
          state: "stale",
          latest: latestVerified.candidate,
          cause: StorageHealthCauseSchema.parse({
            code: "backup-stale",
            summary: `latest verified backup is ${String(latestVerified.candidate.ageMs)}ms old with authority generation gap ${gapSummary}`,
          }),
        }
      : { state: "current", latest: latestVerified.candidate });
  }

  if (authorityInspection === undefined && authorityCause === undefined) {
    throw new Error("authority doctor produced neither an inspection nor a failure cause");
  }
  return StorageDoctorReportSchema.parse({
    kind: "authority-storage-doctor",
    mode: "read-only",
    checkedAt: clock.now().toISOString(),
    sourceDatabaseIdentity,
    authority: authorityInspection === undefined
      ? { state: "degraded", cause: authorityCause }
      : { state: "healthy", inspection: authorityInspection },
    counts: authorityInspection === undefined
      ? { state: "unavailable", cause: authorityCause }
      : { state: "available", values: authorityInspection.counts },
    backup,
    restoreCandidates: candidates.map(({ candidate }) => candidate),
  });
}
