import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { createClientDayFixtures } from "../../../support/helpers/dashboard/client-day-fixtures.js";
import { createRowStore } from "../../../../src/dashboard/client/subscriptions/row-store.js";
import { subscribeDashboardDay } from "../../../../src/dashboard/client/subscriptions/subscription.js";
import type { DashboardTransport, SseMessage, StreamHandle } from "../../../../src/dashboard/client/transport.js";
import { StreamRowSchema, type StreamRow } from "../../../../src/models/dashboard/subscription.js";

import { createDashboardClient } from "../../../../src/dashboard/client/index.js";
import { FIXTURE_IDS } from "../../../support/helpers/dashboard/mock-world/fixture-queue.js";
import { createFixtureBff } from "../../../support/helpers/dashboard/fixture-bff.js";
import { readRunPanel } from "../../../support/helpers/dashboard/serve-run-panel.js";

const DAY = "2026-08-03";
const HASH_D = "d".repeat(64);
const RUN_A = "3b8f0a1e-2c4d-4e6f-8a9b-0c1d2e3f4a5b";
const RUN_B = "4c9a1b2f-3d5e-4f70-9bac-1d2e3f4a5b6c";
const { surfaceOf, dayOf } = createClientDayFixtures(DAY, HASH_D);

const refusal = (runId: string, message: string): StreamRow => StreamRowSchema.parse({ model: "run-panel", key: runId,
  value: { state: "refused", error: { state: "error", code: "RUN_NOT_FOUND", message, retryable: false } } });
const hello = (cursor: string) => ({ type: "hello", wireVersion: 1, descriptorHash: HASH_D, projectionGeneration: 7, cursor });
const snapshot = (cursor: string, rows: readonly StreamRow[]) => ({ type: "snapshot", topic: "dashboard-day", cursor, position: 0, rows,
  payload: { ...dayOf([surfaceOf(RUN_A, 1, "EID 10873698", "queued")], cursor), projectionGeneration: 7 } });
const change = (cursor: string, after: string, rows: readonly StreamRow[]) => ({ type: "change", topic: "dashboard-day", cursor, after, position: 0, rows });

interface Opened { readonly path: string; readonly lastEventId: string | undefined; push(envelope: object): void }

function harness(run?: string) {
  const opened: Opened[] = [];
  const states: string[] = [];
  const order: string[] = [];
  const rows = createRowStore();
  const transport = { openStream(path: string, options: Readonly<{ lastEventId?: string; onMessage: (message: SseMessage) => void }>): StreamHandle {
    opened.push({ path, lastEventId: options.lastEventId, push: envelope => options.onMessage({ data: JSON.stringify(envelope) }) });
    return { close: () => undefined, done: new Promise<void>(() => undefined) };
  } } as unknown as DashboardTransport;
  const subscription = subscribeDashboardDay({ transport, day: DAY, rows, ...(run === undefined ? {} : { run }),
    onDay: () => { order.push(`day:${rows.runPanel(RUN_A) === undefined ? "no-panel" : "panel"}`); }, onState: state => { states.push(state.state); } });
  return { opened, order, rows, states, subscription };
}

describe("subscription run panel rows", () => {
  it("opens the stream with the selected run and applies rows from a snapshot before the day", () => {
    const h = harness(RUN_A);
    assert.equal(h.opened.length, 1);
    assert.equal(h.opened[0]?.path, `/events/v1?topics=dashboard-day:${DAY},run:${RUN_A}`);
    h.opened[0]?.push(hello("pc:5"));
    h.opened[0]?.push(snapshot("pc:5", [refusal(RUN_A, "first")]));
    assert.deepEqual(h.order, ["day:panel"]);
    assert.equal(h.rows.runPanel(RUN_A)?.state, "refused");
  });

  it("empties the store on reset-required, so no panel read before it answers a decision", () => {
    const h = harness(RUN_A);
    const stream = h.opened[0];
    stream?.push(hello("pc:5"));
    stream?.push(snapshot("pc:5", [refusal(RUN_A, "first")]));
    assert.equal(h.rows.runPanel(RUN_A)?.state, "refused");
    stream?.push({ type: "reset-required", reason: "cursor-expired", cursor: "pc:5" });
    assert.equal(h.rows.runPanel(RUN_A), undefined);
  });

  it("empties the store on a cursor gap", () => {
    const h = harness(RUN_A);
    const stream = h.opened[0];
    stream?.push(hello("pc:5"));
    stream?.push(snapshot("pc:5", [refusal(RUN_A, "first")]));
    stream?.push(change("pc:9", "pc:8", [refusal(RUN_A, "after the gap")]));
    assert.equal(h.rows.runPanel(RUN_A), undefined);
  });

  it("empties the store when a hello announces a new projection generation", () => {
    const h = harness(RUN_A);
    h.opened[0]?.push(hello("pc:5"));
    h.opened[0]?.push(snapshot("pc:5", [refusal(RUN_A, "first")]));
    assert.equal(h.rows.runPanel(RUN_A)?.state, "refused");
    h.opened[0]?.push({ ...hello("pc:5"), projectionGeneration: 8 });
    assert.equal(h.rows.runPanel(RUN_A), undefined);
  });

  it("reports a reset to the mounted day when a hello announces a new generation", () => {
    const h = harness(RUN_A);
    h.opened[0]?.push(hello("pc:5"));
    h.opened[0]?.push(snapshot("pc:5", [refusal(RUN_A, "first")]));
    h.states.length = 0;
    h.opened[0]?.push({ ...hello("pc:5"), projectionGeneration: 8 });
    assert.deepEqual(h.states, ["connecting"], "the hello carries no health yet, so the reset is all that is reported");
  });

  it("opens with the day alone when no run is selected, and ignores an id that is not a run id", () => {
    assert.equal(harness().opened[0]?.path, `/events/v1?topics=dashboard-day:${DAY}`);
    assert.equal(harness("not-a-run").opened[0]?.path, `/events/v1?topics=dashboard-day:${DAY}`);
  });

  it("replaces the held panel with each change, drops a replayed one, and keeps the day cursor for a rows-only change", () => {
    const h = harness(RUN_A);
    const stream = h.opened[0];
    stream?.push(hello("pc:5"));
    stream?.push(snapshot("pc:5", [refusal(RUN_A, "first")]));
    stream?.push(change("pc:6", "pc:5", [refusal(RUN_A, "second")]));
    const held = h.rows.runPanel(RUN_A);
    assert.equal(held?.state === "refused" ? held.error.message : "", "second");
    stream?.push(change("pc:6", "pc:5", [refusal(RUN_A, "replayed")]));
    const again = h.rows.runPanel(RUN_A);
    assert.equal(again?.state === "refused" ? again.error.message : "", "second");
    assert.equal(h.order.length, 1, "a rows-only change does not re-announce the day");
  });

  it("reopens once with the new topics, resuming from the held cursor, and drops the previous run's panel", () => {
    const h = harness(RUN_A);
    h.opened[0]?.push(hello("pc:5"));
    h.opened[0]?.push(snapshot("pc:5", [refusal(RUN_A, "first")]));
    h.subscription.select(RUN_B);
    assert.equal(h.opened.length, 2);
    assert.equal(h.opened[1]?.path, `/events/v1?topics=dashboard-day:${DAY},run:${RUN_B}`);
    assert.equal(h.opened[1]?.lastEventId, "pc:5");
    assert.equal(h.rows.runPanel(RUN_A), undefined);
    h.opened[1]?.push(hello("pc:6"));
    h.opened[1]?.push(change("pc:6", "pc:5", [refusal(RUN_B, "other")]));
    assert.equal(h.rows.runPanel(RUN_B)?.state, "refused");
    h.subscription.select(RUN_B);
    assert.equal(h.opened.length, 2, "selecting the open run again opens nothing");
  });

  it("opens nothing for a run that was closed, and closes the run's topic when none is selected", () => {
    const h = harness(RUN_A);
    h.opened[0]?.push(hello("pc:5"));
    h.opened[0]?.push(snapshot("pc:5", []));
    h.subscription.select(undefined);
    assert.equal(h.opened[1]?.path, `/events/v1?topics=dashboard-day:${DAY}`);
    h.opened[1]?.push(hello("pc:5"));
    h.opened[1]?.push(change("pc:6", "pc:5", [refusal(RUN_A, "late")]));
    assert.equal(h.rows.runPanel(RUN_A), undefined, "a row for a run that is not open is never held");
  });
});

describe("an invalid run panel in a day envelope", () => {
  async function servedPanel() {
    const { app } = createFixtureBff();
    const client = createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async (url, init) => app.request(url, init) });
    return { key: FIXTURE_IDS.openGateRun, panel: await readRunPanel(client, FIXTURE_IDS.openGateRun) };
  }

  it("refuses the panel whose logs name another run, keeps the queue live, and recovers on the next valid panel", async () => {
    const { key, panel } = await servedPanel();
    const h = harness(key);
    const stream = h.opened[0];
    stream?.push(hello("pc:5"));
    stream?.push({ type: "health", state: "live" });
    const foreign = { model: "run-panel", key, value: { ...panel, logs: { ...panel.logs, runId: RUN_B } } };
    assert.equal(StreamRowSchema.safeParse(foreign).success, false, "the wire schema rejects this panel");
    stream?.push({ ...snapshot("pc:5", []), rows: [foreign] });
    assert.equal(h.states.includes("stopped"), false, "the day stream is not stopped");
    assert.equal(h.order.length, 1, "the day in the same envelope is applied");
    const refused = h.rows.runPanel(key);
    assert.equal(refused?.state, "refused");
    assert.equal(refused?.state === "refused" ? refused.error.code : "", "LOGS_IDENTITY_REFUSED");

    // The queue keeps taking days on the same connection, and the next valid panel replaces the refusal.
    stream?.push(snapshot("pc:6", []));
    assert.equal(h.order.length, 2, "a later day is still applied");
    stream?.push(change("pc:7", "pc:6", [StreamRowSchema.parse({ model: "run-panel", key, value: panel })]));
    assert.equal(h.rows.runPanel(key)?.state, "available");
    assert.equal(h.opened.length, 1, "nothing reconnected");
    assert.equal(h.states.at(-1), "live");
  });

  it("isolates an invalid panel of a run the stream has not selected: nothing is held and the queue stays live", async () => {
    const { key, panel } = await servedPanel();
    const foreign = { model: "run-panel", key, value: { ...panel, logs: { ...panel.logs, runId: RUN_B } } };
    for (const selected of [undefined, RUN_A]) {
      const h = harness(selected);
      h.opened[0]?.push(hello("pc:5"));
      h.opened[0]?.push({ ...snapshot("pc:5", []), rows: [foreign] });
      assert.equal(h.states.includes("stopped"), false);
      assert.equal(h.order.length, 1, "the day is applied");
      assert.equal(h.rows.runPanel(key), undefined, "a row for a run that is not open is never held");
    }
  });

  const refusedValue = { state: "refused", error: { state: "error", code: "RUN_NOT_FOUND", message: "gone", retryable: false } };
  const STRICT: Record<string, unknown> = {
    "a null row": null,
    "a row that is not an object": "run-panel",
    "an unknown model": { model: "run-timeline", key: RUN_A, value: refusedValue },
    "a missing model": { key: RUN_A, value: refusedValue },
    "an invalid run id": { model: "run-panel", key: "not-a-run", value: refusedValue },
    "a missing run id": { model: "run-panel", value: refusedValue },
    "an unknown panel state": { model: "run-panel", key: RUN_A, value: { state: "pending" } },
    "a missing value": { model: "run-panel", key: RUN_A },
    "an extra row field": { model: "run-panel", key: RUN_A, value: refusedValue, extra: true },
  };
  for (const [name, row] of Object.entries(STRICT)) for (const selected of [RUN_A, RUN_B, undefined]) {
    it(`stops the stream on ${name}, with ${selected === RUN_A ? "that run" : selected === undefined ? "no run" : "another run"} selected`, () => {
      const h = harness(selected);
      h.opened[0]?.push(hello("pc:5"));
      h.opened[0]?.push({ ...snapshot("pc:5", []), rows: [row] });
      assert.equal(h.states.at(-1), "stopped", "a row that is not an identifiable panel is a protocol error");
      assert.equal(h.order.length, 0, "its envelope applies nothing");
      assert.equal(h.rows.runPanel(RUN_A), undefined);
    });
  }

  it("still stops on an invalid day beside a valid panel", () => {
    const h = harness(RUN_A);
    h.opened[0]?.push(hello("pc:5"));
    h.opened[0]?.push({ ...snapshot("pc:5", [refusal(RUN_A, "first")]), payload: { day: DAY } });
    assert.equal(h.states.at(-1), "stopped", "the day envelope itself is still validated");
  });
});
