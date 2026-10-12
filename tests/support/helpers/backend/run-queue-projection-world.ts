import { createSeededDashboardWorld } from "../seeded-dashboard-world.js";
import { makeWorld, type DashboardWorld } from "./dashboard-harness.js";

import { createTimelineEmitter } from "../../../../src/backend/storage/events/timeline-emitter.js";
import { AuthorityDatabase } from "../synthetic-storage-admission.js";
import { join } from "node:path";





export function createRunQueueProjectionTestWorld() {
  const worlds: DashboardWorld[] = [];

  function world(...args: Parameters<typeof makeWorld>): DashboardWorld {
    const created = makeWorld(...args);
    worlds.push(created);
    return created;
  }

  const { runRecordOf, queuedEventOf, CLAIM, seedWorld } = createSeededDashboardWorld();





  function otherConnection(w: DashboardWorld, pid = 777) {
    const database = AuthorityDatabase.open({ path: join(w.stateRoot, "authority.db"),
      busyTimeoutMs: 500, migrationOwner: "projection-peer-fixture" }, w.clock);
    return { database, writer: createTimelineEmitter({ repository: database.authority.timelineEvents, clock: w.clock, pid }) };
  }

  function appendOther(w: DashboardWorld, event: unknown, pid = 777): void {
    const other = otherConnection(w, pid);
    try { other.writer.emit(event); } finally { other.database.close(); }
  }


  const cleanup = () => {
    for (const w of worlds.splice(0)) w.dispose();
  };
  return { worlds, world, runRecordOf, queuedEventOf, CLAIM, appendOther, seedWorld, otherConnection, cleanup };
}
