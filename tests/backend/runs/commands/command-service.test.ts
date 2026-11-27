import { randomUUID } from "node:crypto";
import { RunWorkerStartupError, type RunWorkerCapacity } from "../../../../src/backend/runs/commands/run-worker-capacity.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH } from "../../../../src/models/config/protected-settings.js";
import { SETTINGS_SCHEMA_HASH, deriveSettingsPatchFingerprint } from "../../../../src/models/config/settings.js";
import { ERROR_CATALOG } from "../../../../src/models/failures/error-catalog.js";
import assert from "node:assert/strict";
import { it } from "vitest";
import { createDashboardCommandService } from "../../../../src/backend/runs/commands/command-service.js";
import { createOperatorCommandIngress } from "../../../../src/backend/runs/commands/operator-command-ingress.js";
import { CommandRequestSchema, CommandResultSchema } from "../../../../src/rules/commands/commands.js";
import { manualClock } from "../../../../src/rules/time/clock.js";

it("routes admitted ordinary Settings commands to the worker and protected commands to the kernel", async () => {
  const base = { family: "settings", source: "settings-surface", requestedBy: "local-operator",
    requestedAt: "2026-11-02T12:00:00.000Z", target: { expectedRevision: 1 } };
  const patch = { "preferences.notifications.sound": { set: "none" } };
  const ordinary = CommandRequestSchema.parse({ ...base, commandId: randomUUID(), type: "apply-settings",
    payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveSettingsPatchFingerprint(patch), patch } });
  const protectedCommand = CommandRequestSchema.parse({ ...base, commandId: randomUUID(), type: "apply-protected-settings",
    payload: { protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH, writeId: randomUUID(), entries: { sharepointOnboardingRosterUrl: { clear: true } } } });
  const result = CommandResultSchema.parse({ state: "applied", commandId: ordinary.commandId, affectedTargets: [{ family: "settings", revision: 2 }],
    restartRequired: false, settingsRevision: 2, settingsFingerprint: "a".repeat(64) });
  const protectedResult = CommandResultSchema.parse({ state: "rejected", commandId: protectedCommand.commandId, code: "invalid-state", message: "Refused" });
  const held = Promise.withResolvers<typeof result>();
  const unexpected = () => { throw new Error("unexpected command route"); };
  const ingress = createOperatorCommandIngress({ clock: manualClock(new Date(base.requestedAt)), journal: { get: () => undefined },
    protectedCommandAcceptedAt: () => undefined, bulkAcceptances: { withTransaction: unexpected },
    resolveIdentityGateAnswer: unexpected, resolveGateArmAnswer: unexpected });
  const service = createDashboardCommandService({
    kernel: { execute(input) { assert.deepEqual(input, { ...protectedCommand, source: "dashboard" }); return protectedResult; },
      assistantAvailability: unexpected, assistantManifest: unexpected, executeStart: unexpected, executeWorkerPool: unexpected,
      executeAssistantModelPreference: unexpected },
    projection: { ingestFromTimeline: unexpected, refreshRun: unexpected },
    executeOrdinarySettings(command) { assert.deepEqual(command, { ...ordinary, source: "dashboard" }); return held.promise; },
  });

  const submitted = ingress.submit(ordinary, accepted => service.submit(accepted));
  assert.deepEqual(await ingress.submit(protectedCommand, accepted => service.submit(accepted)), protectedResult);
  held.resolve(result);
  assert.deepEqual(await submitted, result);
});

for (const type of ["pause-all", "pause-all-and-quit"] as const) it(`${type} refreshes every acknowledged run before notifying quit`, async () => {
  const commandId = "a1000000-0000-4000-8000-000000000001";
  const runIds = ["a1000000-0000-4000-8000-000000000002", "a1000000-0000-4000-8000-000000000003"];
  const request = CommandRequestSchema.parse({ commandId, family: "application", type, requestedBy: "local-operator",
    source: "dashboard", requestedAt: "2026-11-02T12:00:00.000Z", target: { runtimeGeneration: 1 },
    payload: { targets: runIds.map(runId => ({ runId, expectedVersion: 1 })), ...(type === "pause-all" ? {} : { confirmed: true }) } });
  const events: string[] = [];
  const unexpected = () => { throw new Error("unexpected kernel route"); };
  const result = CommandResultSchema.parse({ state: "applied", commandId,
    affectedTargets: [{ family: "application", runtimeGeneration: 1 }] });
  const service = createDashboardCommandService({ kernel: { execute: () => result, assistantAvailability: unexpected,
    assistantManifest: unexpected, executeStart: unexpected, executeWorkerPool: unexpected, executeAssistantModelPreference: unexpected },
    projection: { ingestFromTimeline: unexpected, refreshRun: runId => { events.push(runId); } },
    quitAccepted: () => { events.push("quit"); } });
  assert.deepEqual(await service.submit(request), result);
  assert.deepEqual(events, [...runIds, ...(type === "pause-all" ? [] : ["quit"])]);
});

const runId = "b1000000-0000-4000-8000-000000000001";
const resume = (type: "resume" | "pause" | "cancel" = "resume") => CommandRequestSchema.parse({ commandId: randomUUID(), family: "run", type,
  requestedBy: "local-operator", source: "assistant", requestedAt: "2026-11-08T12:00:00.000Z", target: { runId, expectedVersion: 1 } });
const applied = (commandId: string, state: "applied" | "already-applied" = "applied") => CommandResultSchema.parse({ state, commandId,
  affectedTargets: [{ family: "run", runId }] });
function capacityService(ensure: RunWorkerCapacity["ensure"]) {
  const executions: string[] = [], publications: string[] = [];
  const unexpected = () => { throw new Error("unexpected kernel route"); };
  const service = createDashboardCommandService({ kernel: { execute(input) {
    const request = CommandRequestSchema.parse(input); executions.push(request.commandId); return applied(request.commandId);
  }, executeStart: unexpected, assistantAvailability: unexpected, assistantManifest: unexpected, executeWorkerPool: unexpected, executeAssistantModelPreference: unexpected },
  projection: { ingestFromTimeline() { publications.push("timeline"); }, refreshRun(id) { publications.push(id); } },
  startWorkerCapacity: { workflowOf: () => "person-lookup", ensure, detach: () => { throw new Error("a consumed action detaches no worker startup"); }, startupPending: () => false } });
  return { service, executions, publications };
}

it.each(["applied", "already-applied"] as const)("completes a consumed %s Resume without executing or publishing it again", async state => {
  const command = resume(), result = applied(command.commandId, state), seen: unknown[] = [];
  const h = capacityService(async (request, outcome) => { seen.push([request, outcome]); });
  assert.deepEqual(await h.service.completeConsumed(command, result), result);
  assert.deepEqual(seen, [[command, result]]);
  assert.deepEqual(h.executions, []); assert.deepEqual(h.publications, []);
  h.service.publish(command, result);
  assert.deepEqual(h.publications, state === "applied" ? [runId] : []);
});

it("does not ensure capacity for unconsumed results or nonqueueing actions", async () => {
  const h = capacityService(async () => { throw new Error("capacity must not run"); }), command = resume();
  for (const result of [
    CommandResultSchema.parse({ state: "rejected", commandId: command.commandId, code: "invalid-state", message: "refused" }),
    CommandResultSchema.parse({ state: "pending", commandId: command.commandId }),
    CommandResultSchema.parse({ state: "conflict", commandId: command.commandId, currentVersion: 2, message: "moved" }),
    CommandResultSchema.parse({ state: "confirmation-required", commandId: command.commandId, warningDigest: "a".repeat(64), message: "confirm" }),
  ]) assert.deepEqual(await h.service.completeConsumed(command, result), result);
  for (const type of ["pause", "cancel"] as const) {
    const request = resume(type), result = applied(request.commandId);
    assert.deepEqual(await h.service.completeConsumed(request, result), result);
  }
  assert.deepEqual(h.executions, []); assert.deepEqual(h.publications, []);
});

it.each(["submit", "bulk"] as const)("serializes consumed Resume capacity with the same workflow's %s capacity", async route => {
  const first = resume(), second = resume(), events: string[] = [];
  let release = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  const h = capacityService(async request => {
    if (request.commandId === first.commandId) { events.push("first-enter"); await gate; events.push("first-exit"); }
    else events.push("second");
  });
  const pending = h.service.completeConsumed(first, applied(first.commandId));
  const next = route === "submit" ? h.service.submit(second) : h.service.executeBulk({ commandId: second.commandId,
    bulkCommandId: second.commandId, requestedAt: second.requestedAt, requestedBy: "local-operator", source: "dashboard",
    family: "run", type: "resume", targets: [{ runId, expectedVersion: 1 }], mode: "best-effort" });
  assert.deepEqual(events, ["first-enter"]);
  release(); await pending; await next;
  assert.deepEqual(events, ["first-enter", "first-exit", "second"]);
  assert.equal(h.executions.length, 1);
  assert.notEqual(h.executions[0], first.commandId);
});

it.each(["refused", "unknown"] as const)("retains an applied consumed Resume when capacity is %s", async state => {
  const command = resume(), result = applied(command.commandId);
  const failure = { state, code: "RUN_QUEUED_WORKER_UNAVAILABLE" as const, message: ERROR_CATALOG.RUN_QUEUED_WORKER_UNAVAILABLE.text, detail: "private diagnostic" };
  const h = capacityService(async () => { throw new RunWorkerStartupError(failure); });
  assert.deepEqual(await h.service.completeConsumed(command, result), { ...result, workerStartup: failure });
  assert.deepEqual(h.executions, []);
});
for (const capacityMode of ["absent", "workflow", "unknown-workflow"] as const) {
  for (const state of ["applied", "already-applied", "rejected"] as const) {
    it(`Start uses async admission with ${capacityMode} capacity and ${state} settlement`, async () => {
      const commandId = "a1000000-0000-4000-8000-000000000001", fingerprint = "a".repeat(64);
      const request = CommandRequestSchema.parse({ commandId, family: "start", type: "start-run", requestedBy: "local-operator",
        source: "dashboard", requestedAt: "2026-11-02T12:00:00.000Z",
        target: { workflowId: "person-lookup", startPlanId: "a1000000-0000-4000-8000-000000000002", expectedVersion: 1 },
        payload: { descriptorFingerprint: fingerprint, configFingerprint: fingerprint, ingressSchemaHash: fingerprint,
          canonicalInputSchemaHash: fingerprint, inputFingerprint: fingerprint } });
      const result = CommandResultSchema.parse(state === "rejected"
        ? { state, commandId, code: "capability-unavailable", message: "controlled readiness refusal" }
        : { state, commandId, affectedTargets: [{ family: "start", workflowId: "person-lookup", startPlanId: "a1000000-0000-4000-8000-000000000002", expectedVersion: 1 }] });
      const events: string[] = [];
      const unexpected = (): never => { throw new Error("unexpected synchronous or unrelated kernel route"); };
      let finishCapacity: () => void = () => undefined;
      const capacityHeld = new Promise<void>(resolve => { finishCapacity = resolve; });
      const service = createDashboardCommandService({ kernel: { execute: unexpected, executeStart: async input => {
        assert.deepEqual(input, request); events.push("start"); await Promise.resolve(); events.push("settled"); return result;
      }, assistantAvailability: unexpected, assistantManifest: unexpected, executeWorkerPool: unexpected, executeAssistantModelPreference: unexpected },
      projection: { ingestFromTimeline: () => { events.push("projection"); }, refreshRun: unexpected },
      ...(capacityMode === "absent" ? {} : { startWorkerCapacity: {
        workflowOf: () => capacityMode === "unknown-workflow" ? undefined : "person-lookup",
        ensure: async (_request, settlement) => { assert.deepEqual(settlement, result); events.push("capacity"); await capacityHeld; events.push("capacity settled"); },
        detach: () => { events.push("detached"); }, startupPending: () => false,
      } }) });
      assert.deepEqual(await service.submit(request), result);
      events.push("replied");
      finishCapacity(); await new Promise(resolve => { setImmediate(resolve); });
      const capacity = capacityMode === "workflow" && state !== "rejected";
      assert.deepEqual(events, ["start", "settled", ...(state === "applied" ? ["projection"] : []), ...(capacity ? ["capacity", "detached"] : []),
        "replied", ...(capacity ? ["capacity settled"] : [])]);
    });
  }
}

it("hands a Start's failing capacity step to its owner, which settles it after the reply", async () => {
  const commandId = "a1000000-0000-4000-8000-000000000001", fingerprint = "a".repeat(64);
  const request = CommandRequestSchema.parse({ commandId, family: "start", type: "start-run", requestedBy: "local-operator",
    source: "dashboard", requestedAt: "2026-11-02T12:00:00.000Z",
    target: { workflowId: "person-lookup", startPlanId: "a1000000-0000-4000-8000-000000000002", expectedVersion: 1 },
    payload: { descriptorFingerprint: fingerprint, configFingerprint: fingerprint, ingressSchemaHash: fingerprint,
      canonicalInputSchemaHash: fingerprint, inputFingerprint: fingerprint } });
  const result = CommandResultSchema.parse({ state: "applied", commandId, affectedTargets: [{ family: "start", workflowId: "person-lookup",
    startPlanId: "a1000000-0000-4000-8000-000000000002", expectedVersion: 1 }] });
  const unexpected = (): never => { throw new Error("unexpected kernel route"); };
  const closed = new Error("pool authority closed"), detached: Promise<void>[] = [];
  const service = createDashboardCommandService({ kernel: { execute: unexpected, executeStart: () => Promise.resolve(result),
    assistantAvailability: unexpected, assistantManifest: unexpected, executeWorkerPool: unexpected, executeAssistantModelPreference: unexpected },
  projection: { ingestFromTimeline: () => undefined, refreshRun: unexpected },
  startWorkerCapacity: { workflowOf: () => "person-lookup", ensure: () => Promise.reject(closed), detach: work => { detached.push(work); }, startupPending: () => false } });
  assert.deepEqual(await service.submit(request), result);
  assert.equal(detached.length, 1);
  await assert.rejects(detached[0] ?? Promise.resolve(), closed);
});

it("admits Starts of one workflow one at a time without waiting for the first Start's worker capacity", async () => {
  const fingerprint = "a".repeat(64), events: string[] = [];
  const start = (tail: string) => CommandRequestSchema.parse({ commandId: `a1000000-0000-4000-8000-00000000000${tail}`, family: "start", type: "start-run",
    requestedBy: "local-operator", source: "dashboard", requestedAt: "2026-11-02T12:00:00.000Z",
    target: { workflowId: "person-lookup", startPlanId: `b1000000-0000-4000-8000-00000000000${tail}`, expectedVersion: 1 },
    payload: { descriptorFingerprint: fingerprint, configFingerprint: fingerprint, ingressSchemaHash: fingerprint,
      canonicalInputSchemaHash: fingerprint, inputFingerprint: fingerprint } });
  const unexpected = (): never => { throw new Error("unexpected kernel route"); };
  const service = createDashboardCommandService({ kernel: { execute: unexpected, executeStart: async input => {
    const request = CommandRequestSchema.parse(input); if (request.family !== "start") throw new Error("not a start");
    events.push(`admit ${request.commandId.slice(-1)}`); await new Promise(resolve => { setImmediate(resolve); }); events.push(`commit ${request.commandId.slice(-1)}`);
    return CommandResultSchema.parse({ state: "applied", commandId: request.commandId, affectedTargets: [{ family: "start", ...request.target }] });
  }, assistantAvailability: unexpected, assistantManifest: unexpected, executeWorkerPool: unexpected, executeAssistantModelPreference: unexpected },
  projection: { ingestFromTimeline: () => undefined, refreshRun: unexpected },
  startWorkerCapacity: { workflowOf: () => "person-lookup", ensure: async request => { events.push(`capacity ${request.commandId.slice(-1)}`); await new Promise(() => undefined); },
    detach: () => undefined, startupPending: () => false } });
  const replies = await Promise.all([service.submit(start("1")), service.submit(start("2"))]);
  assert.deepEqual(replies.map(reply => reply.state), ["applied", "applied"]);
  // The second Start admits after the first commits; its capacity queues behind the first one's, which stays open.
  assert.deepEqual(events.filter(event => !event.startsWith("capacity")), ["admit 1", "commit 1", "admit 2", "commit 2"]);
  assert.deepEqual(events.filter(event => event.startsWith("capacity")), ["capacity 1"]);
});
