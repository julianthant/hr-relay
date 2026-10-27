import { createSeededDashboardWorld } from "../seeded-dashboard-world.js";
import { claimEventOf, makeWorld, taskEventsOf, traceOf, uuidOf, type DashboardWorld } from "./dashboard-harness.js";

import { createTimelineEmitter } from "../../../../src/backend/storage/events/timeline-emitter.js";
import { AuthorityDatabase } from "../synthetic-storage-admission.js";
import { join } from "node:path";





export function createRunQueueProjectionTestWorld() {
  const worlds: DashboardWorld[] = [];

  async function world(...args: Parameters<typeof makeWorld>): Promise<DashboardWorld> {
    const created = await makeWorld(...args);
    worlds.push(created);
    return created;
  }

  const { runRecordOf, queuedEventOf, CLAIM, seedWorld } = createSeededDashboardWorld();





  function otherConnection(w: DashboardWorld, pid = 777) {
    const database = AuthorityDatabase.open({ path: join(w.stateRoot, "state.db"),
      busyTimeoutMs: 500, migrationOwner: "projection-peer-fixture" }, w.clock);
    return { database, writer: createTimelineEmitter({ repository: database.authority.timelineEvents, clock: w.clock, pid }) };
  }

  function appendOther(w: DashboardWorld, event: unknown, pid = 777): void {
    const other = otherConnection(w, pid);
    try { other.writer.emit(event); } finally { other.database.close(); }
  }


  /** Exactly the exit run's node walk, at one run attempt. */
  function seedExitRunShape(w: DashboardWorld): void {
    queuedEventOf(w, { seed: 1 });
    claimEventOf(w, 1);
    taskEventsOf(w, 1, "searching", "done");
    taskEventsOf(w, 1, "cross-verify", "done");
    taskEventsOf(w, 1, "active-status", "done");
    taskEventsOf(w, 1, "crm-dates", "skipped", "condition-false");
    w.writer.emit({
      t: "span.ended", kind: "run", ts: w.clock.now().toISOString(), workflow: "person-lookup",
      runId: uuidOf(1), attempt: 1, traceId: traceOf(1), spanPath: traceOf(1), outcome: "done",
    });
    w.authority.put(runRecordOf({
      seed: 1,
      lifecycle: { state: "terminal", outcome: "done", endedAt: "2026-08-03T17:14:30.000Z" },
      version: 3,
    }));
  }

  const cleanup = async () => {
    for (const w of worlds.splice(0)) await w.dispose();
  };
  return { worlds, world, runRecordOf, queuedEventOf, CLAIM, appendOther, seedWorld, otherConnection, seedExitRunShape, cleanup };
}
