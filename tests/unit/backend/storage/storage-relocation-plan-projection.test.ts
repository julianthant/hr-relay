import { describe, expect, it } from "vitest";
import {
  CommandAuditRecordSchema,
  StorageRelocationCommandRequestSchema,
  storageRelocationDesiredDigest,
  storageRelocationRequestFingerprint,
  type CommandAuditRecord,
  type StorageRelocationCommandRequest,
} from "../../../../src/domain/commands.js";
import { FingerprintSchema, NonNegativeIntSchema } from "../../../../src/domain/ids.js";
import {
  projectStorageRelocationPlanHistory,
  type StorageRelocationEpoch,
  type StorageRelocationHistoryRepositories,
} from "../../../../src/backend/storage/storage-relocation-plans.js";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const WORKSPACE = "/tmp/hr-storage-plan-projection";
const EPOCH: StorageRelocationEpoch = {
  installationId: uuid(1), generation: 0,
  stateRoot: `${WORKSPACE}/.tracker`, artifactRoot: `${WORKSPACE}/.tracker/artifacts`,
};
const NOW = "2026-10-01T12:00:00.000Z";
const ZERO_FINGERPRINT = FingerprintSchema.parse("0".repeat(64));

function plan(expectedRevision: number, ordinal: number, desiredPair = {
  stateRoot: "/tmp/hr-storage-plan-projection-moved", artifactRoot: "/tmp/hr-storage-plan-projection-moved/artifacts",
}): StorageRelocationCommandRequest {
  const target = { installationId: EPOCH.installationId,
    sourceGeneration: NonNegativeIntSchema.parse(EPOCH.generation),
    sourcePair: { stateRoot: EPOCH.stateRoot, artifactRoot: EPOCH.artifactRoot },
    expectedRevision: NonNegativeIntSchema.parse(expectedRevision) };
  const draft = StorageRelocationCommandRequestSchema.parse({ family: "storage-relocation", type: "plan-storage-relocation",
    commandId: uuid(10 + ordinal), requestedAt: NOW, requestedBy: "local-operator", source: "settings-surface", target,
    payload: { writeId: uuid(20 + ordinal), desiredPair,
      desiredDigest: storageRelocationDesiredDigest(target, desiredPair), requestFingerprint: ZERO_FINGERPRINT } });
  return StorageRelocationCommandRequestSchema.parse({ ...draft,
    payload: { ...draft.payload, requestFingerprint: storageRelocationRequestFingerprint(draft) } });
}

function cancel(expectedRevision: number, ordinal: number, pending: Extract<StorageRelocationCommandRequest, { type: "plan-storage-relocation" }>) {
  const draft = StorageRelocationCommandRequestSchema.parse({ family: "storage-relocation", type: "cancel-storage-relocation",
    commandId: uuid(30 + ordinal), requestedAt: NOW, requestedBy: "local-operator", source: "settings-surface",
    target: { installationId: EPOCH.installationId, sourceGeneration: EPOCH.generation,
      sourcePair: { stateRoot: EPOCH.stateRoot, artifactRoot: EPOCH.artifactRoot }, expectedRevision },
    payload: { writeId: uuid(40 + ordinal), cancelledPlanCommandId: pending.commandId,
      cancelledPlanDigest: pending.payload.desiredDigest, requestFingerprint: ZERO_FINGERPRINT } });
  return StorageRelocationCommandRequestSchema.parse({ ...draft,
    payload: { ...draft.payload, requestFingerprint: storageRelocationRequestFingerprint(draft) } });
}

function audit(request: StorageRelocationCommandRequest, revision: number): CommandAuditRecord {
  const target = { family: "storage-relocation" as const, revision };
  return CommandAuditRecordSchema.parse({ auditId: uuid(100 + revision), request, completedAt: NOW,
    result: { state: "applied", commandId: request.commandId, affectedTargets: [target] },
    versionChanges: [{ target, before: revision - 1, after: revision }], affectedDependencyIds: [] });
}

function repositories(commands: readonly StorageRelocationCommandRequest[], audits: readonly CommandAuditRecord[]): StorageRelocationHistoryRepositories {
  return {
    commands: { listStorageRelocationCommands: () => [...commands] },
    commandAudits: { findByCommand: commandId => audits.find(row => row.request.commandId === commandId) },
  };
}

describe("pure storage relocation history projection", () => {
  it("projects empty history and a matching plan/cancel pair at the exact revision", () => {
    expect(projectStorageRelocationPlanHistory(repositories([], []), EPOCH, [], WORKSPACE))
      .toEqual({ revision: 0, installationId: EPOCH.installationId, sourceGeneration: 0,
        sourcePair: { stateRoot: EPOCH.stateRoot, artifactRoot: EPOCH.artifactRoot }, pending: null });
    const planned = plan(0, 1);
    if (planned.type !== "plan-storage-relocation") throw new Error("expected plan command");
    const cancelled = cancel(1, 2, planned);
    const view = projectStorageRelocationPlanHistory(repositories([planned, cancelled], [audit(planned, 1), audit(cancelled, 2)]), EPOCH, [], WORKSPACE);
    expect(view).toMatchObject({ revision: 2, pending: null, sourceGeneration: 0, sourcePair: { stateRoot: EPOCH.stateRoot, artifactRoot: EPOCH.artifactRoot } });
    expect(Object.isFrozen(view)).toBe(true);
  });

  it("refuses a gap in the durable plan revision sequence", () => {
    const skipped = plan(1, 3);
    expect(() => projectStorageRelocationPlanHistory(repositories([skipped], []), EPOCH, [], WORKSPACE))
      .toThrow(/duplicate or gap plan revision/u);
  });

  it("refuses request fingerprint and desired destination digest drift independently", () => {
    const original = plan(0, 4);
    const staleFingerprint = StorageRelocationCommandRequestSchema.parse({
      ...original, payload: { ...original.payload, desiredDigest: ZERO_FINGERPRINT },
    });
    expect(() => projectStorageRelocationPlanHistory(repositories([staleFingerprint], []), EPOCH, [], WORKSPACE))
      .toThrow(/request fingerprint mismatch/u);
    const changed = StorageRelocationCommandRequestSchema.parse({ ...original,
      payload: { ...original.payload, desiredDigest: ZERO_FINGERPRINT, requestFingerprint: ZERO_FINGERPRINT } });
    const rebound = StorageRelocationCommandRequestSchema.parse({ ...changed,
      payload: { ...changed.payload, requestFingerprint: storageRelocationRequestFingerprint(changed) } });
    expect(() => projectStorageRelocationPlanHistory(repositories([rebound], []), EPOCH, [], WORKSPACE))
      .toThrow(/desired digest mismatch/u);
  });

  it("refuses an audit whose applied revision differs from the command sequence", () => {
    const request = plan(0, 5);
    expect(() => projectStorageRelocationPlanHistory(repositories([request], [audit(request, 2)]), EPOCH, [], WORKSPACE))
      .toThrow(/command audit mismatch/u);
  });
});
