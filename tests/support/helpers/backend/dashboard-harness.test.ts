import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe,it } from "vitest";
import { makeWorld,queuedEventOf } from "./dashboard-harness.js";

describe("canonical reader fixture contract", () => {
  it("uses the actual native timeline and admitted snapshot owner without a second event database", async () => {
    const world=await makeWorld();
    try {
      const event=queuedEventOf(world,{seed:4});
      const stored=world.database.authority.runs.get(event.runId);
      assert.ok(stored);
      assert.equal(stored.envelope.configFingerprint,event.configFingerprint);
      assert.equal(world.database.authority.configSnapshots.get(stored.envelope.configSnapshotId)?.fingerprint,event.configFingerprint);
      const rows=world.database.authority.timelineEvents.page({limit:100});
      assert.equal(rows.length,1);
      assert.equal(rows[0]?.payload.kind,"span");
      assert.deepEqual(world.timeline.page({limit:100}),rows);
      assert.equal(existsSync(join(world.stateRoot,"timeline.sqlite")),false);
    }finally{await world.dispose();}
  });
});
