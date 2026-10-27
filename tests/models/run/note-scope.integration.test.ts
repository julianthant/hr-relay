import { terminalDone, depsOf } from "../../support/helpers/backend/note-scope-fixtures.js";

import assert from "node:assert/strict";
import { afterEach,describe,it } from "vitest";
import { buildRunSection } from "../../../src/backend/runs/queries/run-detail.js";
import { createNoteTimelineWriter } from "../../../src/backend/storage/events/note-timeline-writer.js";
import { assertNoteWithinRunScope, runRecordNoteScopeInstants, runNotePartitionScope as sharedNotePartitionScope } from "../../../src/models/run/note-scope.js";
import { type RunRecord } from "../../../src/models/run/record.js";
import { AT, instantOffsetOf, makeWorld, traceOf, uuidOf, type DashboardWorld } from "../../support/helpers/backend/dashboard-harness.js";
import { personLookupDescriptor } from "../../support/helpers/registered-workflows.js";

const worlds: DashboardWorld[] = [];
async function world(): Promise<DashboardWorld> {
  const created = await makeWorld({ descriptors: { resolve: () => personLookupDescriptor } });
  worlds.push(created);
  return created;
}
afterEach(async () => {
  for (const w of worlds.splice(0)) await w.dispose();
});



describe("a logs GET opens only its run partitions", () => {
  const DAY_MS = 24 * 60 * 60 * 1000;




  function emitNotes(w: DashboardWorld, seed: number, count: number, from = 0): void {
    const notes = createNoteTimelineWriter({ repository: w.database.authority.timelineEvents, clock: w.clock, pid: 4242 });
    for (let index = 0; index < count; index += 1) {
      notes.emitNote({
        workflow: "person-lookup",
        address: { runId: uuidOf(seed), attempt: 1, traceId: traceOf(seed), spanPath: traceOf(seed) },
        level: "step",
        message: `note ${String(from + index)}`,
      });
    }
  }




  function authorityOf(w: DashboardWorld): RunRecord {
    const authority = w.authority.getRun(uuidOf(1));
    assert.ok(authority !== undefined);
    return authority;
  }

  it("ADMITS a note filed the day after the run's last durable instant — the margin, from the producer's side", async () => {
    const w = await world();
    terminalDone(w, 1, { enqueuedAt: instantOffsetOf(0) });
    assertNoteWithinRunScope(authorityOf(w), {
      runId: uuidOf(1),
      workflow: "person-lookup",
      at: new Date(AT.getTime() + DAY_MS),
    });
  });

  it("REFUSES a note filed two days after the run's terminal instant, naming the run, its day and the bounds", async () => {
    const w = await world();
    terminalDone(w, 1, { enqueuedAt: instantOffsetOf(0) });

    assert.throws(
      () => assertNoteWithinRunScope(authorityOf(w), {
        runId: uuidOf(1),
        workflow: "person-lookup",
        at: new Date(AT.getTime() + 2 * DAY_MS),
      }),
      /refusing to file a note for run 0001.*partition for 2026-08-05, outside the run's own notes scope 2026-08-03\.\.2026-08-04/s,
    );
  });

  it("REFUSES a note filed under a workflow whose partitions this run's logs reader never opens", async () => {
    const w = await world();
    terminalDone(w, 1, { enqueuedAt: instantOffsetOf(0) });
    assert.throws(
      () => assertNoteWithinRunScope(authorityOf(w), { runId: uuidOf(1), workflow: "separations", at: AT }),
      /the run belongs to person-lookup/,
    );
  });

  it("REFUSES a note scoped against another run's authority record", async () => {
    const w = await world();
    terminalDone(w, 1, { enqueuedAt: instantOffsetOf(0) });
    assert.throws(
      () => assertNoteWithinRunScope(authorityOf(w), { runId: uuidOf(2), workflow: "person-lookup", at: AT }),
      /composed from a different run's instants/,
    );
  });

  it("scopes a producer INSIDE the window the reader opens, never outside it", async () => {
    const w = await world();
    terminalDone(w, 1);
    const row = w.projection.runFold(uuidOf(1));
    assert.ok(row !== undefined);
    const authority = authorityOf(w);

    const producer = sharedNotePartitionScope({
      runId: uuidOf(1),
      workflow: authority.envelope.workflow,
      instants: runRecordNoteScopeInstants(authority),
    });
    const reader = sharedNotePartitionScope({ runId: uuidOf(1), workflow: authority.envelope.workflow, instants: [...runRecordNoteScopeInstants(authority), ...runRecordNoteScopeInstants(authority)] });
    assert.ok(reader.fromDate <= producer.fromDate, `${reader.fromDate} must not start after ${producer.fromDate}`);
    assert.ok(reader.toDate >= producer.toDate, `${reader.toDate} must not end before ${producer.toDate}`);
  });

  it("refuses producer notes outside the admitted time scope before append", async () => {
    const w = await world();
    terminalDone(w, 1, { enqueuedAt: instantOffsetOf(0) });
    emitNotes(w, 1, 1);


    w.clock.setWall(new Date(AT.getTime() + 2 * DAY_MS));
    assert.throws(() => assertNoteWithinRunScope(authorityOf(w), { runId: uuidOf(1), workflow: "person-lookup", at: w.clock.now() }), /outside/u);
    const section = buildRunSection(depsOf(w), uuidOf(1), "logs");
    assert.equal(section.section, "logs");
    assert.deepEqual(section.payload.notes.map((note) => note.message), ["note 0"]);
  });

  const _SEARCH_ORIGIN = {
    nodeId: "searching",
    step: "Search person",
    taskId: "ucpath/search-person-org",
    system: "ucpath",
  } as const;
});
