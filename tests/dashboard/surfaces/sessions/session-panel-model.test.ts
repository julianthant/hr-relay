// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act } from "react";
import { type Root } from "react-dom/client";
import { afterEach,it } from "vitest";
import { workerTimelineView,type WorkerCardWire } from "../../../../src/dashboard/surfaces/sessions/session-panel-model.js";
import { DashboardDayWireSchema } from "../../../../src/models/dashboard/projection.js";
import { FIXTURE_DAY_WIRE } from "../../../parity/helpers/fixture-day.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
Reflect.set(globalThis, "ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
let root: Root | undefined;
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); });
function card(): WorkerCardWire {
  const idle = FIXTURE_DAY_WIRE.workerCards.find((entry) => entry.state === "idle" && entry.browsers.length > 0); assert.ok(idle);
  return DashboardDayWireSchema.parse({ ...FIXTURE_DAY_WIRE, workerCards: [{ ...idle,
    controls: { basis: { state: "present", value: { leaseGeneration: 3, controlRevision: 7 } }, ownership: { state: "owned" } } }] }).workerCards[0];
}

it("the worker timeline uses only the claimed run's served queue steps", () => {
  const working = FIXTURE_DAY_WIRE.workerCards.find((entry) => entry.currentRun.state === "present");
  assert.ok(working && working.currentRun.state === "present");
  const currentRun = working.currentRun;
  const row = FIXTURE_DAY_WIRE.queueSurfaces.find((entry) => entry.runId === currentRun.runId);
  assert.ok(row?.pipeline.length);
  assert.deepEqual(workerTimelineView(working, FIXTURE_DAY_WIRE.queueSurfaces), { state: "present", steps: row.pipeline });
  assert.deepEqual(workerTimelineView(working, []), { state: "absent", reason: "Run timeline is not served on this day" });
  assert.equal(workerTimelineView(card(), FIXTURE_DAY_WIRE.queueSurfaces).state, "absent");
});
