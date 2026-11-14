import assert from "node:assert/strict";
import { it } from "vitest";
import { createDashboardCommandService } from "../../../../src/backend/runs/commands/command-service.js";
import { CommandRequestSchema, CommandResultSchema } from "../../../../src/rules/commands/commands.js";

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
      const service = createDashboardCommandService({ kernel: { execute: unexpected, executeStart: async input => {
        assert.deepEqual(input, request); events.push("start"); await Promise.resolve(); events.push("settled"); return result;
      }, assistantAvailability: unexpected, assistantManifest: unexpected, executeWorkerPool: unexpected, executeAssistantModelPreference: unexpected },
      projection: { ingestFromTimeline: () => { events.push("projection"); }, refreshRun: unexpected },
      ...(capacityMode === "absent" ? {} : { startWorkerCapacity: {
        workflowOf: () => capacityMode === "unknown-workflow" ? undefined : "person-lookup",
        ensure: async (_request, settlement) => { assert.deepEqual(settlement, result); events.push("capacity"); },
      } }) });
      assert.deepEqual(await service.submit(request), result);
      assert.deepEqual(events, ["start", "settled", ...(state === "applied" ? ["projection"] : []),
        ...(capacityMode === "workflow" && state !== "rejected" ? ["capacity"] : [])]);
    });
  }
}
