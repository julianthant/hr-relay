import { BackupHealthSchema, type RestoreCandidate } from "../../models/storage/storage-status.js";
import type { z } from "zod";

export type BackupHealth = z.infer<typeof BackupHealthSchema>;
export type VerifiedRestoreCandidate = Extract<RestoreCandidate, { state: "verified-compatible" }>;

/** What the doctor observed in the backup directory; the health is derived from these on every inspection, never stored. */
export type BackupHealthFacts = Readonly<{
  inspectionFailed: boolean;
  /** The newest candidate by manifest modification time; it decides an invalid verdict. */
  newest: RestoreCandidate | undefined;
  /** The newest verified candidate by creation time. */
  latestVerified: VerifiedRestoreCandidate | undefined;
  manifestCount: number;
  directoryName: string;
}>;

export function backupHealthOf(facts: BackupHealthFacts): BackupHealth {
  if (facts.inspectionFailed) {
    return BackupHealthSchema.parse({ state: "invalid", cause: { code: "backup-invalid",
      summary: "Backup directory inspection is unavailable; no restore selection can be established." } });
  }
  if (facts.newest?.state === "invalid") return BackupHealthSchema.parse({ state: "invalid", cause: facts.newest.cause });
  const latest = facts.latestVerified;
  if (latest === undefined) {
    return BackupHealthSchema.parse(facts.manifestCount === 0
      ? { state: "missing", cause: { code: "backup-missing", summary: `no authority backup manifests exist in ${facts.directoryName}` } }
      : { state: "invalid", cause: { code: "backup-invalid", summary: `no verified compatible authority backup exists in ${facts.directoryName}` } });
  }
  const gap = latest.generationGap;
  if (gap.state === "unavailable" || gap.value === 0) return BackupHealthSchema.parse({ state: "current", latest });
  return BackupHealthSchema.parse({ state: "stale", latest, cause: { code: "backup-stale",
    summary: `latest verified backup is ${String(latest.ageMs)}ms old with authority generation gap ${String(gap.value)}` } });
}
