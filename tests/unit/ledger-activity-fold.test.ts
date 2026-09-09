/** Activity shape stays stable; confirmed database history replaces file folding. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { afterEach, describe, it } from "vitest";
import { localDatePart } from "../../src/domain/clock.js";
import { historyWorld, historicalWorld } from "./transaction-history-fixture.js";
const cleanup: (() => void)[] = [];
afterEach(() => { for (const dispose of cleanup.splice(0)) dispose(); });
const instant = "2026-08-03T18:30:00.000Z"; const day = localDatePart(new Date(instant));
function world() { const w = historyWorld(); cleanup.push(() => w.dispose()); return w; }
describe("Activity confirmed transaction fold", () => {
  it("answers an empty block when nothing was confirmed", () => { assert.deepEqual(world().history.foldActivityRange(day, day), { systems: [] }); });
  it("folds system/instance and orders by count then system id", () => {
    const w = world();
    for (const [index, system, instance] of [[1, "ucpath", "prod"], [2, "ucpath", "prod"], [3, "ucpath", "test"], [4, "kuali", "prod"], [5, "crm", "test"]] as const) w.commit(index, { system, instance, confirmedAt: instant });
    assert.deepEqual(w.history.foldActivityRange(day, day), { systems: [{ system: "ucpath", entries: 3, prod: 2, test: 1 }, { system: "crm", entries: 1, prod: 0, test: 1 }, { system: "kuali", entries: 1, prod: 1, test: 0 }] });
  });
  it("uses the confirmation's local day across a UTC midnight", () => {
    const w = world(); const boundary = "2026-08-04T01:30:00.000Z"; w.commit(11, { confirmedAt: boundary });
    assert.equal(w.history.foldActivityRange(localDatePart(new Date(boundary)), localDatePart(new Date(boundary))).systems[0].entries, 1);
  });
  it("excludes outside confirmations and includes them in an expanded window", () => {
    const w = world(); w.commit(12, { confirmedAt: instant }); w.commit(13, { confirmedAt: "2026-08-06T18:30:00.000Z" });
    assert.equal(w.history.foldActivityRange(day, day).systems[0].entries, 1); assert.equal(w.history.foldActivityRange(day, "2026-08-07").systems[0].entries, 2);
  });
  it.each(["malformed", "wrong-shape", "wrong-system"] as const)("refuses %s historical input before counts can change", async (fault) => {
    const w = historicalWorld({ files: true }); cleanup.push(() => w.dispose()); const file = w.lines[0];
    let text = "{not json\n";
    if (fault === "wrong-shape") text = '{"seq":0}\n';
    if (fault === "wrong-system") { const value = JSON.parse(file.text) as { payload: { system: string } }; value.payload.system = "kuali"; text = `${JSON.stringify(value)}\n`; }
    writeFileSync(file.path, text); await w.backup(); await assert.rejects(w.upgrade(), /timeline-source-/u);
  });
  it("refuses a backwards range", () => { assert.throws(() => world().history.foldActivityRange("2026-08-05", "2026-08-01"), /ends before it starts/u); });
});
