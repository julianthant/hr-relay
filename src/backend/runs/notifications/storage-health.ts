// Compatibility-only backup notifier; production observations come from dashboard composition.
import { z } from "zod";
import { FingerprintSchema, type Fingerprint } from "../../../rules/identity/ids.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import type { NotificationInbox, NotificationPublishReport } from "./inbox.js";

const BackupHealthStateSchema = z.enum(["current", "stale", "missing"]);
type BackupHealthState = z.infer<typeof BackupHealthStateSchema>;


export function backupHealthDiagnosticFingerprint(input: unknown): Fingerprint {
  const state = BackupHealthStateSchema.exclude(["current"]).parse(input);
  return FingerprintSchema.parse(sha256Hex(`hrauto:storage-health:backup:v1\0${state}`));
}

type BackupHealthObservationReport =
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
