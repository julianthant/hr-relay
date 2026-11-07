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
    assistantManifest: unexpected, executeWorkerPool: unexpected, executeAssistantModelPreference: unexpected },
    projection: { ingestFromTimeline: unexpected, refreshRun: runId => { events.push(runId); } },
    quitAccepted: () => { events.push("quit"); } });
  assert.deepEqual(await service.submit(request), result);
  assert.deepEqual(events, [...runIds, ...(type === "pause-all" ? [] : ["quit"])]);
});
