import { randomUUID } from "node:crypto";
import { EVENT_STREAM_RETENTION_DAYS } from "../../../../models/events/retention.js";
import { ArtifactRefSchema } from "../../../../models/artifacts/artifacts.js";
import { localDatePart } from "../../../../rules/time/clock.js";
import type { createOperatorProjection } from "./queue.js";
import type { Clock } from "../../../../rules/time/clock.js";
import { createNoteTimelineWriter } from "../../../storage/events/note-timeline-writer.js";
import { AuthorityDatabase } from "../../../storage/sqlite/index.js";
import { type StartupCleanup } from "./runtime-contracts.js";
import { createDiagnosticRetentionSweep, type DiagnosticRetentionSweepDependencies } from "../../../logs/diagnostics/diagnostic-retention.js";
import type { createDebugEventWriter } from "../../../logs/debug-events.js";
import type { RuntimeAdmission } from "../../../storage/admission/admission.js";
import { inspectArtifactDeletionFile } from "../../../storage/artifacts/content-addressed-artifact-writer.js";

const TIMELINE_POLL_MS = 250;
const DIAGNOSTIC_RETENTION_SWEEP_MS = 24 * 60 * 60 * 1000;

// Notification polling has its own cadence; leases can change without spans.
export const GATE_PARK_WATCH_MS = 5_000;



export function composeDashboardTimeline(input: { database: AuthorityDatabase; clock: Clock; loggingRepository: Parameters<typeof createNoteTimelineWriter>[0]["repository"]; projection: ReturnType<typeof createOperatorProjection>; startupCleanups: StartupCleanup[]; admission: RuntimeAdmission; lifecycle: DiagnosticRetentionSweepDependencies["lifecycle"]; debugEvents: Pick<ReturnType<typeof createDebugEventWriter>, "emit"> }) {
  const { database, clock, loggingRepository, projection, startupCleanups, admission, lifecycle, debugEvents } = input;
  const noteWriter = createNoteTimelineWriter({ repository: loggingRepository, clock });

  // Ordinary timeline and notes retain their 30-day append-day window.
  // Confirmed operation events remain until explicit owner deletion.
  database.authority.timelineEvents.pruneBefore(localDatePart(new Date(
    clock.nowMs() - EVENT_STREAM_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  )));

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
      debugEvents.emit({ category: "boot", phase: "failed", correlationId: randomUUID(),
        area: "diagnostic-retention", reason: "purge-failed",
        message: error instanceof Error ? error.message : String(error) });
    }
  };
  sweepDiagnostics();
  const diagnosticRetentionTimer = setInterval(sweepDiagnostics, DIAGNOSTIC_RETENTION_SWEEP_MS);
  diagnosticRetentionTimer.unref();
  startupCleanups.push(() => clearInterval(diagnosticRetentionTimer));

  // Fold whatever span history already exists before serving a single count.
  projection.rebuildFromTimeline();
  const initialHealth = projection.health();
  if (initialHealth.state === "degraded") {
    throw new Error(`dashboard refused to start over a degraded projection: ${initialHealth.lastError ?? "unknown"}`);
  }
  // Read the shared SQLite cursor; process-local notifications cannot guarantee event delivery.
  const timelineTimer = setInterval(() => {
    projection.ingestFromTimeline();
    projection.reconcileWorkerAuthority();
  }, TIMELINE_POLL_MS);
  timelineTimer.unref();
  startupCleanups.push(() => clearInterval(timelineTimer));


  return { noteWriter, timelineTimer, diagnosticRetentionTimer };
}
