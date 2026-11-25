import { randomUUID } from "node:crypto";
import { DEBUG_EVENT_RETENTION_DAYS, EVENT_STREAM_RETENTION_DAYS } from "../../../../models/events/retention.js";
import { ArtifactRefSchema } from "../../../../models/artifacts/artifacts.js";
import { localDatePart } from "../../../../rules/time/clock.js";
import type { createOperatorProjection } from "./queue.js";
import type { Clock } from "../../../../rules/time/clock.js";
import { createNoteTimelineWriter } from "../../../storage/events/note-timeline-writer.js";
import { createDashboardBackgroundReader } from "../../../storage/sqlite/dashboard-background-read-worker.js";
import { AuthorityDatabase } from "../../../storage/sqlite/index.js";
import { type StartupCleanup } from "./runtime-contracts.js";
import { createDiagnosticRetentionSweep, type DiagnosticRetentionSweepDependencies } from "../../../logs/diagnostics/diagnostic-retention.js";
import type { createDebugEventWriter } from "../../../logs/debug-events.js";
import type { RuntimeAdmission } from "../../../storage/admission/admission.js";
import { inspectArtifactDeletionFile } from "../../../storage/artifacts/content-addressed-artifact-writer.js";

const TIMELINE_POLL_MS = 250;
const RETENTION_SWEEP_MS = 24 * 60 * 60 * 1000;

export const GATE_PARK_WATCH_MS = 1_000;

export function composeDashboardTimeline(input: { database: AuthorityDatabase; clock: Clock; loggingRepository: Parameters<typeof createNoteTimelineWriter>[0]["repository"]; projection: ReturnType<typeof createOperatorProjection>; startupCleanups: StartupCleanup[]; admission: RuntimeAdmission; lifecycle: DiagnosticRetentionSweepDependencies["lifecycle"]; debugEvents: Pick<ReturnType<typeof createDebugEventWriter>, "emit"> }) {
  const { database, clock, loggingRepository, projection, startupCleanups, admission, lifecycle, debugEvents } = input;
  const noteWriter = createNoteTimelineWriter({ repository: loggingRepository, clock });

  // Ordinary timeline and notes retain their 30-day append-day window, unpinned debug entries their shorter one.
  // Confirmed operation events remain until explicit owner deletion.
  const cutoff = (days: number) => localDatePart(new Date(clock.nowMs() - days * 24 * 60 * 60 * 1000));
  const pruneTimeline = () => database.authority.timelineEvents.pruneBefore(cutoff(EVENT_STREAM_RETENTION_DAYS));
  const pruneDebug = () => database.authority.timelineEvents.pruneDebugBefore(cutoff(DEBUG_EVENT_RETENTION_DAYS));
  pruneTimeline();
  pruneDebug();

  const reportRetentionFailure = (area: string, error: unknown) => debugEvents.emit({
    category: "boot", phase: "failed", correlationId: randomUUID(), area, reason: "purge-failed",
    message: error instanceof Error ? error.message : String(error),
  });
  const retention = createDiagnosticRetentionSweep({ authority: database.authority, clock, lifecycle });
  const sweepDiagnostics = () => {
    try {
      const { purged } = database.sweepOrdinaryDiagnostics(clock.now().toISOString());
      const eligible = purged.filter(bundleId => {
        const bundle = database.authority.diagnosticBundles.get(bundleId);
        if (bundle === undefined) throw new Error(`diagnostic-retention-bundle-missing: ${bundleId}`);
        // Shared or pending bytes still need their association for a later sweep.
        for (const attachment of bundle.attachments) {
          try {
            inspectArtifactDeletionFile(admission, ArtifactRefSchema.parse({ id: attachment.artifactId,
              sha256: attachment.digest, bytes: attachment.byteLength, mediaType: attachment.mediaType }));
          } catch (error) {
            if (error instanceof Error && "code" in error && error.code === "ENOENT") continue;
            throw error;
          }
          return false;
        }
        return true;
      });
      retention.sweep(eligible);
    } catch (error) {
      reportRetentionFailure("diagnostic-retention", error);
    }
  };
  sweepDiagnostics();
  const diagnosticRetentionTimer = setInterval(() => {
    try {
      if (pruneTimeline() > 0) projection.rebuildFromTimeline();
    } catch (error) {
      reportRetentionFailure("timeline-retention", error);
    }
    try { pruneDebug(); } catch (error) { reportRetentionFailure("debug-retention", error); }
    sweepDiagnostics();
  }, RETENTION_SWEEP_MS);
  diagnosticRetentionTimer.unref();
  startupCleanups.push(() => clearInterval(diagnosticRetentionTimer));

  // Capture positions before the initial fold so a peer commit during startup remains visible.
  const workerTables = ["runs", "deleted_runs", "worker_slots", "worker_pools", "run_batches", "auth_leases", "write_intents"] as const;
  const revision = database.trackAuthorityTables(["timeline_events", ...workerTables], "poll-hint");
  const workerRevision = database.trackAuthorityTables(workerTables, "poll-hint");
  const startupTimelineRevision = database.trackAuthorityTables(["timeline_events"], "poll-hint");
  let key: string | { state: "retry" } = JSON.stringify(database.capturedChangeKey());
  const startupWorkers = workerRevision();
  let startupTimeline = startupTimelineRevision();
  let observed = revision();
  let lastWall = clock.nowMs(), leaseExpiry = Infinity;
  let safetyAt = clock.monotonicMs() + 60_000;

  // Fold whatever span history already exists before serving a single count.
  projection.rebuildFromTimeline();
  const initialHealth = projection.health();
  if (initialHealth.state === "degraded") {
    throw new Error(`dashboard refused to start over a degraded projection: ${initialHealth.lastError ?? "unknown"}`);
  }
  const reader = createDashboardBackgroundReader(admission, database);
  let pending: Promise<void> | undefined, stopped = false, checkAfterRead = false, initialRead = true;
  const startRead = (now: number, workersAtStart: number | undefined) => {
    const workerRevisionState = () => {
      const current = workerRevision();
      return { readUnchanged: current !== undefined && current === workersAtStart,
        startupUnchanged: current !== undefined && current === startupWorkers };
    };
    pending = projection.pollBackground(request => reader.read(request), now, workerRevisionState).then(expiry => {
      if (expiry === undefined) {
        key = { state: "retry" };
        checkAfterRead = true;
      } else leaseExpiry = expiry;
    }).catch((error: unknown) => {
      if (stopped) return;
      // A normal commit can supersede paged worker facts while the admitted timeline remains live.
      if (error instanceof Error && error.message === "dashboard-background-worker-cursor-stale") key = { state: "retry" };
      else projection.backgroundReadFailed(error);
    }).finally(() => {
      pending = undefined;
      initialRead = false;
      if (checkAfterRead && !stopped) {
        checkAfterRead = false;
        check();
      }
    });
    return pending;
  };
  function check() {
    if (stopped) return;
    try {
      const current = JSON.stringify(database.capturedChangeKey());
      const now = clock.nowMs(), elapsed = clock.monotonicMs();
      const safety = elapsed >= safetyAt;
      const leaseDue = now >= leaseExpiry || now < lastWall;
      const degraded = projection.health().state === "degraded";
      if (current === key && !safety && !leaseDue && !degraded) {
        lastWall = now;
        return;
      }
      if (pending !== undefined) {
        checkAfterRead = true;
        // Initial worker validation can take longer than the timeline's publication deadline.
        if (initialRead && !degraded && current !== key) {
          const nextTimeline = startupTimelineRevision();
          if (nextTimeline === undefined || nextTimeline !== startupTimeline) projection.ingestFromTimeline();
          startupTimeline = nextTimeline;
        }
        return;
      }
      lastWall = now;
      const next = revision();
      if (safety || leaseDue || degraded || typeof key !== "string" || next === undefined || next !== observed) void startRead(now, workerRevision());
      key = current;
      observed = next;
      if (safety) safetyAt = elapsed + 60_000;
    } catch (error) {
      projection.backgroundReadFailed(error);
    }
  }
  void startRead(lastWall, startupWorkers);
  const timelineTimer = setInterval(check, TIMELINE_POLL_MS);
  timelineTimer.unref();
  const settled = async () => { while (pending !== undefined) await pending; };
  const stopTimeline = async () => {
    stopped = true;
    clearInterval(timelineTimer);
    await reader.close({ cancelPending: true });
    await settled();
  };
  startupCleanups.push(stopTimeline);
  return { noteWriter, timelineTimer, diagnosticRetentionTimer, settled, stopTimeline };
}
