import { QueueSurfaceWireSchema } from "../../../../src/models/dashboard/projection.js";

export function createAwaitingQueueFixtures(RUN_ID: string, HASH_A: string, HASH_B: string, NOW: string) {
  function surface(input: Record<string, unknown>) {
    return QueueSurfaceWireSchema.parse({
      runId: RUN_ID,
      itemId: "99999999-9999-4999-8999-999999999999",
      workflowId: "person-lookup",
      traceId: "pl-120000-1111",
      attempt: 1,
      lineage: { state: "root" },
      actorId: "local-operator",
      appVersion: { state: "present", value: "1.0.0" },
      descriptorVersion: 1,
      descriptorHash: HASH_A,
      configFingerprint: HASH_B,
      resolvedInstances: [],
      dryRun: false,
      priority: "interactive",
      runNumber: { state: "present", value: 1 },
      containment: "root",
      linkedRuns: [],
      session: { state: "absent", reason: "This fixture has no run session." },
      facts: { state: "absent", reason: "run is running and has not produced a terminal result" },
      startedAt: NOW,
      updatedAt: NOW,
      endedAt: { state: "absent", reason: "run has not ended" },
      gateOpenedAt: { state: "absent", reason: "no gate has opened on this run" },
      displayName: { state: "absent", reason: "the operator has not renamed this run" },
      title: "Jordan Reyes",
      subtitle: { state: "absent", reason: "no second identifier" },
      liveMessage: { state: "absent", reason: "no message" },
      warnings: { state: "absent", reason: "no warning set has been derived" },
      pipeline: [],
      panelKind: "run",
      availableSections: ["logs"],
      actions: [],
      rowRevision: 1,
      surfaceKind: "single",
      status: "awaiting-approval",
      ...input,
    });
  }
  return { surface };
}
