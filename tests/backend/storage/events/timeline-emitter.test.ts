import assert from "node:assert/strict";
import { it } from "vitest";
import { createTimelineEmitter } from "../../../../src/backend/storage/events/timeline-emitter.js";
import { failure,foundationFixture,terminalizeFixtureFailure } from "../../../support/helpers/database-foundation/fixtures.js";

it.each(["failed", "interrupted"] as const)("retains the complete native task %s pair after failure settlement", async outcome => {
  const f = await foundationFixture();
  try {
    const run = f.run;
    const writer = createTimelineEmitter({ repository: f.db.authority.timelineEvents, clock: f.clock, pid: 123 });
    const common = { ts: f.clock.now().toISOString(), workflow: run.envelope.workflow, runId: run.envelope.runId,
      traceId: run.envelope.traceId, attempt: run.envelope.attempt, kind: "task" as const,
      spanPath: `${run.envelope.traceId}/searching#1`, parentSpanPath: run.envelope.traceId };
    writer.emit({ ...common, t: "span.started", name: "Searching" });
    assert.throws(() => writer.emit({ ...common, attempt: run.envelope.attempt + 1,
      t: "span.ended", outcome }), /timeline-event-owner-mismatch/u);
    writer.emit({ ...common, t: "span.ended", outcome });
    terminalizeFixtureFailure(f, run, failure());
    const before = f.db.authority.timelineEvents.page({ runId: run.envelope.runId });
    assert.equal(before.filter(record => record.payload.kind === "span").length, 2);
    assert.equal(f.db.authority.timelineEvents.pruneBefore("2027-01-01"), 0);
    assert.deepEqual(f.db.authority.timelineEvents.page({ runId: run.envelope.runId }), before);
  } finally { await f.dispose(); }
});
