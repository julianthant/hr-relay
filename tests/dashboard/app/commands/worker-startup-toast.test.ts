// @vitest-environment jsdom
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { appliedWorkerStartupToast, stoppedWorkerToasts, unconfirmedBulkWorkerToast, workerStartupToast, workflowWorkersStopped } from "../../../../src/dashboard/app/commands/worker-startup-toast.js";
import { DashboardDayWireSchema } from "../../../../src/models/dashboard/projection.js";
import { FIXTURE_DAY_WIRE, FIXTURE_NOW } from "../../../mocks/helpers/fixture-day.js";
import { runLaunchAppliedToast } from "../../../../src/dashboard/surfaces/run-start/run-launch-model.js";
import type { RunWorkerStartupFailure } from "../../../../src/rules/commands/commands.js";

const MESSAGE = "Your run is queued. Worker startup did not complete; review this run and Sessions. Do not start the run again.";

function startup(state: "refused" | "unknown", message = MESSAGE): RunWorkerStartupFailure {
  return { state, code: "RUN_QUEUED_WORKER_UNAVAILABLE", message, detail: "spawn" };
}

const refused = startup("refused");
const unknown = startup("unknown");

describe("applied worker startup toast", () => {
  it("uses Start's warning for an applied Resume, Retry or Recover", () => {
    for (const type of ["resume", "retry", "recover-run"]) {
      assert.deepEqual(appliedWorkerStartupToast({ family: "run", type }, { state: "applied", workerStartup: refused }), workerStartupToast(refused));
      assert.deepEqual(appliedWorkerStartupToast({ family: "run", type }, { state: "applied", workerStartup: unknown }), {
        tone: "warning", title: "Run queued; worker status unknown", description: MESSAGE,
      });
    }
    assert.deepEqual(runLaunchAppliedToast({ label: "Separations", rerun: false, workerStartup: refused }), workerStartupToast(refused));
  });

  it("stays quiet when the applied command has a worker", () => {
    assert.equal(appliedWorkerStartupToast({ family: "run", type: "resume" }, { state: "applied" }), undefined);
    assert.equal(appliedWorkerStartupToast({ family: "run", type: "retry" }, { state: "already-applied" }), undefined);
    assert.equal(appliedWorkerStartupToast({ family: "run", type: "recover-run" }, { state: "applied" }), undefined);
    assert.equal(appliedWorkerStartupToast({ family: "run", type: "pause" }, { state: "applied", workerStartup: refused }), undefined);
    assert.equal(runLaunchAppliedToast({ label: "Separations", count: 1, rerun: false }).title, "Run started");
  });

  it("repeats the warning for an already-applied queueing command", () => {
    assert.deepEqual(appliedWorkerStartupToast({ family: "run", type: "resume" }, { state: "already-applied", workerStartup: refused }), workerStartupToast(refused));
  });

  it("counts Resume all runs that have no worker in one toast", () => {
    const results = [
      { outcome: "applied", workerStartup: refused },
      { outcome: "applied" },
      { outcome: "applied", workerStartup: refused },
      { outcome: "refused" },
    ];
    assert.deepEqual(appliedWorkerStartupToast({ family: "run", type: "resume", targets: [{}, {}, {}, {}] }, { state: "vector", results }), {
      tone: "warning", title: "2 runs queued; worker unavailable", description: MESSAGE,
    });
    assert.deepEqual(appliedWorkerStartupToast({ family: "run", type: "resume", targets: [{}] }, { state: "vector", results: [{ outcome: "applied", workerStartup: unknown }] }), {
      tone: "warning", title: "1 run queued; worker status unknown", description: MESSAGE,
    });
    assert.equal(appliedWorkerStartupToast({ family: "run", type: "resume", targets: [{}, {}] }, { state: "vector", results: [{ outcome: "applied" }, { outcome: "applied" }] }), undefined);
    assert.equal(appliedWorkerStartupToast({ family: "run", type: "cancel", targets: [{}] }, { state: "vector", results: [{ outcome: "applied", workerStartup: refused }] }), undefined);
  });

  it("warns for applied Resume all runs when another run keeps the batch unconfirmed", () => {
    const request = { family: "run", type: "resume", targets: [{}, {}] };
    const reply = { state: "vector", results: [{ outcome: "applied", workerStartup: refused }, { outcome: "refused" }] };
    const warning = { tone: "warning" as const, title: "1 run queued; worker unavailable", description: MESSAGE };
    assert.deepEqual(unconfirmedBulkWorkerToast(request, reply, false), warning);
    assert.equal(unconfirmedBulkWorkerToast(request, reply, true), undefined);
    assert.deepEqual(appliedWorkerStartupToast(request, reply), warning);
  });

  it("uses the unknown title when any Resume all run has an unknown worker", () => {
    const results = [
      { outcome: "applied", workerStartup: startup("refused", "Worker refused.") },
      { outcome: "applied", workerStartup: startup("unknown", "Worker unknown.") },
    ];
    assert.deepEqual(appliedWorkerStartupToast({ family: "run", type: "retry", targets: [{}, {}] }, { state: "vector", results }), {
      tone: "warning", title: "2 runs queued; worker status unknown",
    });
  });
});

describe("stopped worker toast", () => {
  const label = (workflowId: string) => workflowId === "person-lookup" ? "Person Lookup" : workflowId;
  const queued = FIXTURE_DAY_WIRE.queueSurfaces.filter(row => row.workflowId === "person-lookup" && row.status === "queued");
  const day = (stopReason: "crashed" | "operator" | undefined, rows = queued) => DashboardDayWireSchema.parse({ ...FIXTURE_DAY_WIRE, queueSurfaces: rows,
    workerCards: FIXTURE_DAY_WIRE.workerCards.filter(card => card.workflowId === "person-lookup").map(card => stopReason === undefined ? card
      : { ...card, state: "failed", stopReason, endedAt: FIXTURE_NOW, browsers: [], currentRun: { state: "absent", reason: "no current run" } }) });

  it("names the stopped worker while its workflow has queued runs no worker can take", () => {
    assert.ok(queued.length > 1);
    assert.deepEqual(stoppedWorkerToasts(day("crashed"), label), [{ tone: "warning", title: `${String(queued.length)} runs queued; worker unavailable`,
      description: "Person Lookup worker crashed. Retry it in Sessions." }]);
    assert.deepEqual(stoppedWorkerToasts(day("operator", queued.slice(0, 1)), label), [{ tone: "warning", title: "Run queued; worker unavailable",
      description: "Person Lookup worker stopped by you. Retry it in Sessions." }]);
  });

  it("stays quiet while a worker can still take the run, or nothing waits", () => {
    assert.deepEqual(stoppedWorkerToasts(day(undefined), label), []);
    assert.deepEqual(stoppedWorkerToasts(day("crashed", []), label), []);
    const paused = queued.map(row => ({ ...row, pause: { state: "paused", commandId: "00000000-0000-4000-8000-000000000123", requestedAt: FIXTURE_NOW, pausedAt: FIXTURE_NOW } }));
    assert.deepEqual(stoppedWorkerToasts(day("crashed", DashboardDayWireSchema.shape.queueSurfaces.parse(paused)), label), []);
  });

  it("reports the stop reason only while every worker of the workflow has stopped", () => {
    assert.equal(workflowWorkersStopped(day("crashed"), "person-lookup"), "crashed");
    assert.equal(workflowWorkersStopped(day(undefined), "person-lookup"), undefined);
    assert.equal(workflowWorkersStopped(day("crashed"), "no-such-workflow"), undefined);
  });
});
