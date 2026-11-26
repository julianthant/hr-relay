import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "vitest";
import { createCopySamples, sampleWorkerId, type CopySampleSession } from "../../../../../src/backend/app/composition/dashboard/copy-samples.js";
import type { CommandKernel } from "../../../../../src/backend/runs/commands/command-kernel.js";
import { WorkerSlotRecordSchema, type WorkerSlotRecord } from "../../../../../src/models/run/worker-slot.js";
import { CommandResultSchema } from "../../../../../src/rules/commands/commands.js";

const sampleRun = randomUUID(), realRun = randomUUID();
const startedAt = "2026-11-24T19:00:00.000Z";
const session = (ordinal: number, state: CopySampleSession["state"], extra: Partial<CopySampleSession> = {}): CopySampleSession => ({
  workflow: "person-lookup", ordinal, state, startedAt, browsers: [{ system: "ucpath", health: "authenticated", duo: false }], ...extra });
const sessions = [
  session(9001, "busy", { runId: sampleRun, browsers: [{ system: "ucpath", health: "starting", duo: true }] }),
  session(9002, "idle"), session(9003, "starting"), session(9004, "stopping"), session(9005, "stopped"),
];

function fixture(realSlots: readonly WorkerSlotRecord[] = []) {
  const forwarded: unknown[] = [];
  let changes = 0;
  const pending = (request: unknown) => { forwarded.push(request); return CommandResultSchema.parse({ state: "pending", commandId: randomUUID() }); };
  const unused = () => { throw new Error("unused kernel member"); };
  const kernel: CommandKernel = { assistantAvailability: unused, assistantManifest: unused, execute: pending,
    executeStart: async () => unused(), executeWorkerPool: async request => pending(request), executeAssistantModelPreference: async () => unused() };
  const samples = createCopySamples({ stored: { runIds: [sampleRun], sessions: sessions.map(payload => ({ workerId: sampleWorkerId(payload), payload })) },
    realSlots: () => realSlots, changed: () => { changes++; } });
  return { samples, guarded: samples.guard(kernel), forwarded, changes: () => changes };
}

const envelope = () => ({ commandId: randomUUID(), requestedAt: startedAt, requestedBy: "local-operator", source: "queue-row" });

it("refuses every run, gate and failure action on a sample run before the kernel", () => {
  const { guarded, forwarded } = fixture();
  const requests = [
    ...["pause", "cancel", "resume", "retry", "recover-run", "bump", "delete", "rename"].map(type => ({ ...envelope(), family: "run", type, target: { runId: sampleRun, expectedVersion: 1 } })),
    { ...envelope(), family: "gate", type: "resolve-gate", target: { runId: sampleRun, gateId: "review", expectedVersion: 1 }, payload: {} },
    { ...envelope(), family: "failure-resolution", type: "annotate-failure", target: { runId: sampleRun, failureId: randomUUID() }, payload: {} },
  ];
  for (const request of requests) {
    assert.deepEqual(guarded.execute(request), { state: "rejected", commandId: request.commandId, code: "SAMPLE_RUN_REFUSED", message: "Sample run: nothing runs." });
  }
  assert.deepEqual(forwarded, []);
  const real = { ...envelope(), family: "run", type: "pause", target: { runId: realRun, expectedVersion: 1 } };
  guarded.execute(real);
  assert.deepEqual(forwarded, [real]);
});

it("refuses Rerun values for a sample run only", () => {
  const { samples } = fixture();
  assert.deepEqual(samples.rerunValues({ runId: sampleRun, expectedVersion: 1 }), { state: "refused", code: "sample-run" });
  assert.equal(samples.rerunValues({ runId: realRun, expectedVersion: 1 }), undefined);
});

it("serves each sample worker state, holds the Duo wait, and never forwards a sample worker command", async () => {
  const { samples, guarded, forwarded, changes } = fixture();
  assert.deepEqual(samples.views().map(view => [view.state, view.activity?.state]),
    [["running", "busy"], ["running", "idle"], ["starting", undefined], ["stopping", undefined], ["exited", undefined]]);
  const busy = sampleWorkerId(sessions[0]), idle = sampleWorkerId(sessions[1]);
  assert.deepEqual(samples.leases(busy), [{ system: "ucpath", since: startedAt }]);
  assert.deepEqual(samples.leases(idle), []);
  assert.deepEqual(samples.views().at(-1)?.browsers.map(browser => browser.health), ["authenticated"]);

  const control = (type: string, workerId: string) => ({ ...envelope(), family: "worker-browser", type,
    target: { workerId, workflowId: "person-lookup", lifetimeId: randomUUID(), expectedVersion: 1 } });
  const before = samples.views().find(view => view.member.workerId === busy)?.lifetimeId;
  assert.equal((await guarded.executeWorkerPool(control("stop-worker", busy))).state, "applied");
  const stopped = samples.views().find(view => view.member.workerId === busy);
  assert.equal(stopped?.state, "exited");
  assert.notEqual(stopped?.lifetimeId, before);
  assert.deepEqual(samples.leases(busy), []);
  assert.equal((await guarded.executeWorkerPool(control("remove-worker", busy))).state, "applied");
  assert.equal(samples.slots().some(slot => slot.workerId === busy), false);
  assert.equal(changes(), 2);
  assert.equal((await guarded.executeWorkerPool(control("pause-worker", idle))).state, "rejected");
  assert.deepEqual(forwarded, []);
});

it("refuses a sample worker that shares a real worker's identity", () => {
  const workerId = sampleWorkerId(sessions[1]);
  const real = WorkerSlotRecordSchema.parse({ workerId, workflow: "person-lookup", ordinal: 9002, poolIndex: 1, paused: false, retiredAt: null, createdAt: startedAt, updatedAt: startedAt });
  assert.throws(() => fixture([real]), /copy-sample-worker-collision/u);
});

it("refuses a typed gate answer on a sample run before any gate resolver", () => {
  const { samples } = fixture();
  for (const type of ["answer-identity-gate", "answer-gate-arm"]) {
    const answer = { ...envelope(), family: "gate", type, target: { runId: sampleRun, gateId: "review", expectedVersion: 1 }, payload: { arm: "approve" } };
    assert.equal(samples.refuseRun(answer)?.code, "SAMPLE_RUN_REFUSED");
  }
  assert.equal(samples.refuseRun({ ...envelope(), family: "run", type: "pause", target: { runId: realRun, expectedVersion: 1 } }), undefined);
});

it("refuses a sample rerun source before its Start plan runs preflight or reads credentials", async () => {
  const { samples } = fixture();
  const calls: string[] = [];
  const plans = samples.guardStartPlans({
    prepare: async () => { calls.push("prepare"); }, plan: () => { calls.push("plan"); }, previewWarnings: () => { calls.push("warnings"); },
  });
  const sample = { workflowId: "person-lookup", rerunSource: { runId: sampleRun } };
  await assert.rejects(plans.prepare(sample, new AbortController().signal), { name: "SampleRunRefusedError", message: "Sample run: nothing runs." });
  assert.throws(() => plans.plan(sample), { name: "SampleRunRefusedError" });
  assert.throws(() => plans.previewWarnings({ workflowId: "person-lookup", source: { runId: sampleRun } }), { name: "SampleRunRefusedError" });
  assert.deepEqual(calls, []);
  await plans.prepare({ workflowId: "person-lookup", rerunSource: { runId: realRun } }, new AbortController().signal);
  plans.plan({ workflowId: "person-lookup" });
  assert.deepEqual(calls, ["prepare", "plan"]);
});

it("refuses a card whose run is not seeded", () => {
  const orphan = session(9010, "busy", { runId: realRun });
  assert.throws(() => createCopySamples({ stored: { runIds: [sampleRun], sessions: [{ workerId: sampleWorkerId(orphan), payload: orphan }] },
    realSlots: () => [], changed: () => undefined }), /copy-sample-session-run-unknown/u);
});
