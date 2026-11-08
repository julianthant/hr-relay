// @vitest-environment jsdom
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { appliedWorkerStartupToast, workerStartupToast } from "../../../../src/dashboard/app/commands/worker-startup-toast.js";
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
