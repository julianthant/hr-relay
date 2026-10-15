import { DashboardDayWireSchema, type DashboardDayWire } from "../../../../src/models/dashboard/projection.js";

export function createClientDayFixtures(DAY: string, HASH_D: string) {
  function surfaceOf(runId: string, rowRevision: number, title: string, status: string): Record<string, unknown> {
    return {
    surfaceKind: "single",
    runId,
    itemId: "9c8b7a6d-5e4f-43a2-9b8c-7d6e5f4a3b2c",
    workflowId: "person-lookup",
    traceId: "pl-104233-3b8f",
    attempt: 1,
    lineage: { state: "root" },
    actorId: "local-operator",
    appVersion: { state: "present", value: "0.1.0" },
    descriptorVersion: 1,
    descriptorHash: HASH_D,
    configFingerprint: HASH_D,
    resolvedInstances: [{ system: "ucpath", instance: "prod" }],
    dryRun: false,
  priority: "interactive",
  runNumber: { state: "present", value: 1 },
  session: { state: "absent", reason: "This fixture has no run session." },
  containment: "root",
  linkedRuns: [],
  facts: { state: "absent", reason: "run is running and has not produced a terminal result" },
    startedAt: "2026-08-03T17:00:00.000Z",
    updatedAt: "2026-08-03T17:00:00.000Z",
    endedAt: { state: "absent", reason: "run is running" },
    gateOpenedAt: { state: "absent", reason: "no gate has opened on this run" },
    displayName: { state: "absent", reason: "the operator has not renamed this run" },
    title,
    subtitle: { state: "absent", reason: "none planned" },
    status,
    liveMessage: { state: "absent", reason: "no producer authors a live progress sentence on this wire" },
    warnings: { state: "absent", reason: "this run has produced no terminal result" },
    pipeline: [],
    panelKind: "run",
    availableSections: ["logs"],
    // No served controls: this fixture exercises patch application, not the
    // action projection, and an empty list is a real answer on the wire.
    actions: [],
    rowRevision,
  };
  }

  function dayOf(surfaces: readonly Record<string, unknown>[], cursor: string): DashboardDayWire {
    return DashboardDayWireSchema.parse({
      day: DAY,
      descriptorHash: HASH_D,
      projectionGeneration: 7,
      snapshotCursor: cursor,
      monthCounts: [{ day: DAY, count: surfaces.length }],
      workflowCounts: surfaces.length === 0
        ? []
        : [{ workflowId: "person-lookup", count: surfaces.length, statusCounts: [{ status: "queued", count: surfaces.length }] }],
      statusCounts: surfaces.length === 0 ? [] : [{ status: "queued", count: surfaces.length }],
      queueSurfaces: surfaces,
      workerCards: [], workerAuthority: { state: "present", members: [] }, workerOperations: [],
      workerPools: [],
      notifications: [],
    });
  }
  return { surfaceOf, dayOf };
}
