import { EVENT_STREAM_RETENTION_DAYS } from "../../../../models/events/retention.js";
import { localDatePart } from "../../../../rules/time/clock.js";
import type { createOperatorProjection } from "./queue.js";
import type { Clock } from "../../../../rules/time/clock.js";
import { createNoteTimelineWriter } from "../../../storage/events/note-timeline-writer.js";
import { AuthorityDatabase } from "../../../storage/sqlite/index.js";
import { type StartupCleanup } from "./runtime-contracts.js";

const TIMELINE_POLL_MS = 250;

// Notification polling has its own cadence; leases can change without spans.
export const GATE_PARK_WATCH_MS = 5_000;



export function composeDashboardTimeline(input: { database: AuthorityDatabase; clock: Clock; loggingRepository: Parameters<typeof createNoteTimelineWriter>[0]["repository"]; projection: ReturnType<typeof createOperatorProjection>; startupCleanups: StartupCleanup[] }) {
  const { database, clock, loggingRepository, projection, startupCleanups } = input;
  const noteWriter = createNoteTimelineWriter({ repository: loggingRepository, clock });

  // Ordinary timeline and notes retain their 30-day append-day window.
  // Confirmed operation events remain until explicit owner deletion.
  database.authority.timelineEvents.pruneBefore(localDatePart(new Date(
    clock.nowMs() - EVENT_STREAM_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  )));

  // Fold whatever span history already exists before serving a single count.
  projection.rebuildFromTimeline();
  const initialHealth = projection.health();
  if (initialHealth.state === "degraded") {
    throw new Error(`dashboard refused to start over a degraded projection: ${initialHealth.lastError ?? "unknown"}`);
  }
  // Read the shared SQLite cursor; process-local notifications cannot guarantee event delivery.
  const timelineTimer = setInterval(() => {
    projection.ingestFromTimeline();
    // Lease transitions need authority polling because they need not emit spans.
    database.reconcileWorkerControlMilestones(clock.now().toISOString());
    projection.reconcileWorkerAuthority();
  }, TIMELINE_POLL_MS);
  timelineTimer.unref();
  startupCleanups.push(() => clearInterval(timelineTimer));


  return { noteWriter, timelineTimer };
}
