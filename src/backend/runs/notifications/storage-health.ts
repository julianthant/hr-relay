/**
 * Retained D222 compatibility helper; D322 retired its production caller.
 * Production health observations live in dashboard/compose/notification-health.ts
 * and require actual failure evidence plus durable episode identities. Missing
 * or stale unrequested backups are not production notification sources.
 * This helper retries failed calls but cannot identify a new durable episode;
 * the inbox treats a repeated event as the same source.
 */
import { z } from "zod";
import { FingerprintSchema, type Fingerprint } from "../../../domain/ids.js";
import { sha256Hex } from "../../../domain/sha256.js";
import type { NotificationInbox, NotificationPublishReport } from "./inbox.js";

export const BackupHealthStateSchema = z.enum(["current", "stale", "missing"]);
export type BackupHealthState = z.infer<typeof BackupHealthStateSchema>;

/**
 * The dedupe/link identity of one backup-health reading. Derived from the
 * closed state alone — deliberately not from a manifest name or an instant —
 * so every `stale` episode folds into the ONE row that already said it
 * (count/lastSeenAt advance, D134) instead of minting a new inbox item per
 * episode.
 */
export function backupHealthDiagnosticFingerprint(input: unknown): Fingerprint {
  const state = BackupHealthStateSchema.exclude(["current"]).parse(input);
  return FingerprintSchema.parse(sha256Hex(`hrauto:storage-health:backup:v1\0${state}`));
}

export type BackupHealthObservationReport =
  | Readonly<{ published: false; state: BackupHealthState }>
  | Readonly<{ published: true; state: BackupHealthState; report: NotificationPublishReport }>;

export interface BackupHealthNotifier {
  /** Takes `unknown` and parses: the closed summary enum is the boundary. */
  observed(state: unknown): Promise<BackupHealthObservationReport>;
}

export function createBackupHealthNotifier(
  dependencies: Readonly<{ inbox: Pick<NotificationInbox, "publish"> }>,
): BackupHealthNotifier {
  // Advance only after a successful publication; failures remain retryable.
  let reported: BackupHealthState | undefined;
  return Object.freeze({
    async observed(input: unknown): Promise<BackupHealthObservationReport> {
      const state = BackupHealthStateSchema.parse(input);
      if (state === "current" || state === reported) {
        reported = state;
        return { published: false, state };
      }
      const report = await dependencies.inbox.publish({
        kind: "storage-degraded",
        concern: "backup",
        // `stale` degrades the restore point; `missing` means there is none,
        // which is the harder fact and carries the harder word.
        state: state === "stale" ? "degraded" : "failed",
        diagnosticFingerprint: backupHealthDiagnosticFingerprint(state),
      });
      reported = state;
      return { published: true, state, report };
    },
  });
}
