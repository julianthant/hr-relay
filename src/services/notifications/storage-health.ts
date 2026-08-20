/**
 * Ref dashboard-surfaces §2.6's storage trigger, produced (D222): "storage degradation …
 * failed backup → `storage`" has named the backup lane a NOTIFICATION since
 * D79b, and until now nothing published it — the every-view storage band was
 * carrying the backup hazard instead, which is exactly the misplacement the
 * operator called out. This watch is the first wired producer: the dashboard
 * composition observes the SAME cheap backup summary the bootstrap serves
 * (`summarizeBackupHealth`) and publishes a `storage-degraded` trigger into
 * the durable inbox when the reading moves into (or between) `stale` and
 * `missing`.
 *
 * Two rules are load-bearing:
 *
 *  1. **A TRANSITION publishes, a standing state does not.** The inbox fold
 *     marks a row unread again on every publish because "a repeat is news
 *     again" (D134) — so publishing the same standing `stale` on every
 *     15-minute tick would make the row unreadable-forever and turn the bell
 *     into the spam §2.6 forbids. The notifier therefore remembers the last
 *     state it successfully REPORTED and publishes only when the observation
 *     differs. Recovery (`current`) is recorded but never published: the
 *     trigger union has no "recovered" arm on purpose, and inventing one here
 *     would be a new decision.
 *  2. **A failed publish forgets nothing.** The remembered state advances only
 *     after the durable row is committed; a publish that throws leaves the
 *     transition pending, so the next observation retries it instead of
 *     silently treating the alert as sent.
 *
 * The authority-unavailable state deliberately has NO arm here: the inbox IS
 * an authority table, so an authority that cannot be written cannot record a
 * notification about its own death. That state stays on the every-view banner
 * (`StorageBanner`), which is exactly why the banner survives this change.
 */
import { z } from "zod";
import { FingerprintSchema, type Fingerprint } from "../../domain/ids.js";
import { sha256Hex } from "../../domain/sha256.js";
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
  /**
   * The last state this notifier successfully REPORTED (or observed as
   * healthy), not merely observed — see the header's rule 2. In-process on
   * purpose: across a restart the dedupe fold makes a re-publish of a standing
   * degraded state a count bump on the existing row, which is an honest
   * "still true after the restart", never a duplicate.
   */
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
