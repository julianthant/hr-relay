import { createSeededDashboardWorld } from "../../support/helpers/seeded-dashboard-world.js";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { RunEvidenceReceiptSchema } from "../../../src/models/trust/evidence.js";
import { DAY, makeWorld, receiptWithWarningsOf, uuidOf, type DashboardWorld } from "../../support/helpers/backend/dashboard-harness.js";

const { seedWorld } = createSeededDashboardWorld();


const worlds: DashboardWorld[] = [];

function world(...args: Parameters<typeof makeWorld>): DashboardWorld {
  const created = makeWorld(...args);
  worlds.push(created);
  return created;
}

afterEach(() => {
  for (const w of worlds.splice(0)) w.dispose();
});

describe("the queue row's served facts", () => {

  function rowOf(w: DashboardWorld, seed: number) {
    const surface = w.projection.buildDashboardDayWire(DAY).queueSurfaces
      .find((row) => row.runId === uuidOf(seed));
    assert.ok(surface);
    return surface;
  }

  it("three distinct absences, and never a fabricated zero", () => {
    const w = world();
    seedWorld(w);

    const running = rowOf(w, 2).warnings;
    assert.equal(running.state, "absent");
    assert.match(running.state === "absent" ? running.reason : "", /has not produced a terminal result/);

    const noReceipt = rowOf(w, 3).warnings;
    assert.equal(noReceipt.state, "absent");
    assert.match(noReceipt.state === "absent" ? noReceipt.reason : "", /no evidence receipt has been derived/);

    w.authority.receipts.set(uuidOf(3), RunEvidenceReceiptSchema.parse({
      ...receiptWithWarningsOf({ seed: 3, summaries: ["only warning"] }),
      warnings: [],
      confidence: "verified",
      result: "verified-done",
    }));
    const clean = rowOf(w, 3).warnings;
    assert.equal(clean.state, "absent");
    assert.match(clean.state === "absent" ? clean.reason : "", /records no warning/);
  });
});
