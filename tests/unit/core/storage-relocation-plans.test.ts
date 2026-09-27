import { randomUUID } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { createStorageRelocationPlanReader } from "../../../src/core/storage-relocation-plans.js";
import { executeStorageRelocationCommand } from "../../../src/core/command-kernel.js";
import { manualClock } from "../../../src/domain/clock.js";
import {
  StorageRelocationCommandRequestSchema, storageRelocationDesiredDigest,
  storageRelocationRequestFingerprint,
  type StorageRelocationCommandRequest,
} from "../../../src/domain/commands.js";
import { AuthorityDatabase } from "../../../src/infra/sqlite/authority-database.js";
import { acquireInstallation } from "../../../src/infra/runtime-control/installation.js";
import { acquireRuntimeRestoreAdmission } from "../../../src/infra/sqlite/runtime-process-locks.js";
import { RuntimeAdmission } from "../../../src/infra/runtime-control/admission.js";

const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });

function fixture() {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), "relocation-plan-")));
  cleanups.push(() => rmSync(workspace, { recursive: true, force: true }));
  const pair = { stateRoot: join(workspace, ".tracker"), artifactRoot: join(workspace, ".tracker", "artifacts") };
  const adoption = acquireInstallation(workspace, "exclusive", { defaultPair: pair }); adoption.release();
  const lease = acquireInstallation(workspace, "shared"); cleanups.push(() => lease.release());
  const admission = RuntimeAdmission.fromInstallationLease(lease);
  const clock = manualClock(new Date("2026-09-26T12:00:00.000Z"));
  const database = AuthorityDatabase.open(admission, { path: join(pair.stateRoot, "state.db"), busyTimeoutMs: 250, migrationOwner: "unit-test" }, clock);
  cleanups.push(() => database.close());
  const producer = createStorageRelocationPlanReader({ authority: database, admission, workspace });
  const execute = (value: unknown) => executeStorageRelocationCommand({ authority: database, clock,
    ids: { uuid: randomUUID }, storageRelocationPlans: producer }, value);
  return { workspace, pair, lease, admission, clock, database, producer, execute };
}

type PlanContext = Pick<ReturnType<typeof fixture>, "workspace" | "lease" | "clock" | "producer">;
function target(f: PlanContext, expectedRevision: number) {
  return { installationId: f.lease.locator.installationId, sourceGeneration: f.lease.locator.generation,
    sourcePair: { stateRoot: f.lease.locator.stateRoot, artifactRoot: f.lease.locator.artifactRoot }, expectedRevision };
}
function plan(f: PlanContext, expectedRevision: number, desiredPair = {
  stateRoot: join(f.workspace, "moved-state"), artifactRoot: join(f.workspace, "moved-state", "artifacts"),
}): StorageRelocationCommandRequest {
  const basis = target(f, expectedRevision);
  const request = StorageRelocationCommandRequestSchema.parse({ family: "storage-relocation", type: "plan-storage-relocation",
    commandId: randomUUID(), requestedAt: f.clock.now().toISOString(), requestedBy: "local-operator", source: "settings-surface",
    target: basis, payload: { writeId: randomUUID(), desiredPair,
      desiredDigest: storageRelocationDesiredDigest(basis as StorageRelocationCommandRequest["target"], desiredPair),
      requestFingerprint: "0".repeat(64) } });
  return StorageRelocationCommandRequestSchema.parse({ ...request, payload: { ...request.payload,
    requestFingerprint: storageRelocationRequestFingerprint(request) } });
}
function cancel(f: PlanContext, expectedRevision: number, pending: NonNullable<ReturnType<typeof f.producer.read>["pending"]>): StorageRelocationCommandRequest {
  const request = StorageRelocationCommandRequestSchema.parse({ family: "storage-relocation", type: "cancel-storage-relocation",
    commandId: randomUUID(), requestedAt: f.clock.now().toISOString(), requestedBy: "local-operator", source: "settings-surface",
    target: target(f, expectedRevision), payload: { writeId: randomUUID(), cancelledPlanCommandId: pending.commandId,
      cancelledPlanDigest: pending.desiredDigest, requestFingerprint: "0".repeat(64) } });
  return StorageRelocationCommandRequestSchema.parse({ ...request, payload: { ...request.payload,
    requestFingerprint: storageRelocationRequestFingerprint(request) } });
}
function activateArtifactPlan(f: ReturnType<typeof fixture>, request: StorageRelocationCommandRequest,
  bindingPatch: Partial<{ commandId: string; requestFingerprint: string }> = {}) {
  if (request.type !== "plan-storage-relocation") throw new Error("expected plan");
  f.database.close();
  f.lease.release();
  const held = acquireRuntimeRestoreAdmission({ processLockRoot: join(f.workspace, ".tracker", "locks"), pid: process.pid });
  const moving = acquireInstallation(f.workspace, "exclusive");
  const destination = request.payload.desiredPair;
  const binding = { commandId: request.commandId, revision: request.target.expectedRevision + 1,
    expectedRevision: request.target.expectedRevision, requestFingerprint: request.payload.requestFingerprint,
    desiredDigest: request.payload.desiredDigest, ...bindingPatch };
  const operationId = moving.beginRelocation(destination, binding, held);
  mkdirSync(destination.artifactRoot, { recursive: true, mode: 0o700 });
  copyFileSync(join(moving.locator.artifactRoot, ".runtime-owner.json"), join(destination.artifactRoot, ".runtime-owner.json"));
  const verify = () => ({ operationId, installationId: moving.locator.installationId,
    sourceGeneration: moving.locator.generation,
    source: { stateRoot: moving.locator.stateRoot, artifactRoot: moving.locator.artifactRoot },
    destination, plan: binding, stagingReceiptId: "synthetic-stage", stagingDigest: "a".repeat(64),
    backupReceiptId: "synthetic-backup", backupDigest: "b".repeat(64),
    finalDatabasePath: join(destination.stateRoot, "state.db"),
    configSnapshotId: "11111111-1111-4111-8111-111111111111", configFingerprint: "c".repeat(64),
    authorityVersion: 56 as const, databaseIdentity: "synthetic-authority", managedStateEntries: [] });
  moving.recordVerifiedStage(verify);
  moving.fenceRelocationSource();
  moving.retainRelocationSources();
  moving.switchRelocationLocator(verify);
  moving.settleRelocation(verify);
  moving.release(); held.release();
  const lease = acquireInstallation(f.workspace, "shared");
  cleanups.push(() => lease.release());
  const admission = RuntimeAdmission.fromInstallationLease(lease);
  const database = AuthorityDatabase.open(admission, { path: join(destination.stateRoot, "state.db"),
    busyTimeoutMs: 250, migrationOwner: "unit-test" }, f.clock);
  cleanups.push(() => database.close());
  const producer = createStorageRelocationPlanReader({ authority: database, admission, workspace: f.workspace });
  const execute = (value: unknown) => executeStorageRelocationCommand({ authority: database, clock: f.clock,
    ids: { uuid: randomUUID }, storageRelocationPlans: producer }, value);
  return { workspace: f.workspace, pair: destination, lease, admission, clock: f.clock, database, producer, execute };
}

it("persists immutable planned intent, exact retry, cancel revision, and readback without changing the locator", () => {
  const f = fixture();
  const first = plan(f, 0);
  if (first.type !== "plan-storage-relocation") throw new Error("test fixture is not a plan");
  expect(f.execute(first)).toMatchObject({ state: "applied", commandId: first.commandId });
  const planned = f.producer.read();
  expect(planned).toMatchObject({ revision: 1, pending: { commandId: first.commandId, desiredPair: first.payload.desiredPair } });
  expect(f.execute(first)).toEqual(f.database.authority.commandAudits.findByCommand(first.commandId)?.result);
  expect(f.producer.read().revision).toBe(1);
  const cancelled = cancel(f, 1, planned.pending!);
  expect(f.execute(cancelled).state).toBe("applied");
  expect(f.producer.read()).toMatchObject({ revision: 2, pending: null });
  expect(f.execute(cancelled).state).toBe("applied");
  const next = plan(f, 2, { stateRoot: f.pair.stateRoot, artifactRoot: join(f.workspace, "moved-artifacts") });
  expect(f.execute(next).state).toBe("applied");
  expect(f.producer.read()).toMatchObject({ revision: 3, pending: { commandId: next.commandId } });
  expect(f.lease.locator).toMatchObject({ generation: 0, ...f.pair });
  expect(f.database.authority.commands.listStorageRelocationCommands()).toHaveLength(3);
});

it("refuses stale CAS, reused write identity, and mismatched request or desired digest without a row", () => {
  const f = fixture();
  const first = plan(f, 0); f.execute(first);
  const stale = plan(f, 0);
  expect(f.execute(stale)).toMatchObject({ state: "conflict", currentVersion: 1 });
  const reuse = plan(f, 1);
  expect(() => f.execute({ ...reuse, payload: { ...reuse.payload, writeId: first.payload.writeId } })).toThrow(/fingerprint mismatch/u);
  const reused = StorageRelocationCommandRequestSchema.parse({ ...reuse, payload: { ...reuse.payload, writeId: first.payload.writeId,
    requestFingerprint: "0".repeat(64) } });
  const validReuse = StorageRelocationCommandRequestSchema.parse({ ...reused, payload: { ...reused.payload,
    requestFingerprint: storageRelocationRequestFingerprint(reused) } });
  expect(() => f.execute(validReuse)).toThrow(/write id reused/u);
  expect(() => f.execute({ ...reuse, payload: { ...reuse.payload, desiredDigest: "0".repeat(64) } })).toThrow(/fingerprint mismatch/u);
  const badDigest = StorageRelocationCommandRequestSchema.parse({ ...reuse, payload: { ...reuse.payload, desiredDigest: "0".repeat(64), requestFingerprint: "0".repeat(64) } });
  expect(() => f.execute({ ...badDigest, payload: { ...badDigest.payload,
    requestFingerprint: storageRelocationRequestFingerprint(badDigest) } })).toThrow(/desired digest mismatch/u);
  expect(f.database.authority.commands.listStorageRelocationCommands()).toHaveLength(1);
});

it("refuses divergent command identity and cancellation of a different plan", () => {
  const f = fixture();
  const first = plan(f, 0); f.execute(first);
  const altered = plan(f, 1);
  const duplicateId = StorageRelocationCommandRequestSchema.parse({ ...altered, commandId: first.commandId,
    payload: { ...altered.payload, requestFingerprint: "0".repeat(64) } });
  const divergent = StorageRelocationCommandRequestSchema.parse({ ...duplicateId, payload: { ...duplicateId.payload,
    requestFingerprint: storageRelocationRequestFingerprint(duplicateId) } });
  expect(() => f.execute(divergent)).toThrow(/command|identity/u);
  const pending = f.producer.read().pending;
  if (pending === null) throw new Error("expected plan");
  const wrong = cancel(f, 1, pending);
  const wrongPlan = StorageRelocationCommandRequestSchema.parse({ ...wrong, payload: { ...wrong.payload,
    cancelledPlanDigest: "0".repeat(64), requestFingerprint: "0".repeat(64) } });
  const cancelledOther = StorageRelocationCommandRequestSchema.parse({ ...wrongPlan, payload: { ...wrongPlan.payload,
    requestFingerprint: storageRelocationRequestFingerprint(wrongPlan) } });
  expect(() => f.execute(cancelledOther)).toThrow(/cancel does not match/u);
  expect(f.producer.read().revision).toBe(1);
});

it("admits artifact-only intent and refuses stranded nested artifacts or unsafe path overlap", () => {
  const f = fixture();
  const artifactOnly = plan(f, 0, { stateRoot: f.pair.stateRoot, artifactRoot: join(f.workspace, "new-artifacts") });
  expect(f.execute(artifactOnly).state).toBe("applied");
  const nestedArtifactOnly = plan(f, 1, { stateRoot: f.pair.stateRoot, artifactRoot: join(f.pair.stateRoot, "new-artifacts") });
  expect(() => f.execute(nestedArtifactOnly)).toThrow(/overlaps a source root/u);
  const impossible = plan(f, 1, { stateRoot: join(f.workspace, "new-state"), artifactRoot: f.pair.artifactRoot });
  expect(() => f.execute(impossible)).toThrow(/strand nested artifacts/u);
  const overlapping = plan(f, 1, { stateRoot: join(f.pair.stateRoot, "nested"), artifactRoot: join(f.workspace, "other-artifacts") });
  expect(() => f.execute(overlapping)).toThrow(/overlaps a source root/u);
  const relative = plan(f, 1, { stateRoot: "relative", artifactRoot: join(f.workspace, "other-artifacts") });
  expect(() => f.execute(relative)).toThrow(/canonical absolute/u);
  expect(f.producer.read().revision).toBe(1);
});

it("refuses incomplete and divergent immutable history, including locator identity drift", () => {
  const f = fixture();
  const orphan = plan(f, 0);
  f.database.withAuthorityTransaction((repositories) => { repositories.commands.insert(orphan); });
  expect(() => f.producer.read()).toThrow(/missing command audit/u);
  const counterfeit = Object.create(RuntimeAdmission.prototype) as RuntimeAdmission;
  expect(() => createStorageRelocationPlanReader({ authority: f.database, admission: counterfeit,
    workspace: f.workspace })).toThrow(/runtime-admission: required/u);
});

it("refuses duplicate or gap revisions", () => {
  const f = fixture();
  const first = plan(f, 0); f.execute(first);
  const duplicate = plan(f, 0);
  f.database.withAuthorityTransaction((repositories) => { repositories.commands.insert(duplicate); });
  expect(() => f.producer.read()).toThrow(/duplicate or gap plan revision/u);
  const g = fixture();
  const gap = plan(g, 2);
  g.database.withAuthorityTransaction((repositories) => { repositories.commands.insert(gap); });
  expect(() => g.producer.read()).toThrow(/duplicate or gap plan revision/u);
});

it("refuses mismatched or multiple command audits", () => {
  const f = fixture();
  const command = plan(f, 0);
  f.database.withAuthorityTransaction((repositories) => {
    repositories.commands.insert(command);
    repositories.commandAudits.insert({ auditId: randomUUID(), request: command, completedAt: f.clock.now().toISOString(),
      result: { state: "applied", commandId: command.commandId,
        affectedTargets: [{ family: "storage-relocation", revision: 2 }] },
      versionChanges: [{ target: { family: "storage-relocation", revision: 2 }, before: 0, after: 2 }],
      affectedDependencyIds: [] });
  });
  expect(() => f.producer.read()).toThrow(/command audit mismatch/u);
  const g = fixture();
  const valid = plan(g, 0); g.execute(valid);
  const audit = g.database.authority.commandAudits.findByCommand(valid.commandId);
  if (audit === undefined) throw new Error("expected audit");
  g.database.withAuthorityTransaction((repositories) => {
    repositories.commandAudits.insert({ ...audit, auditId: randomUUID() });
  });
  expect(() => g.producer.read()).toThrow(/recorded audits/u);
});

it("projects one global command revision across a completed receipt and new plan and cancel", () => {
  const f = fixture();
  const destination = { stateRoot: f.pair.stateRoot, artifactRoot: join(f.workspace, "moved-artifacts") };
  const first = plan(f, 0, destination);
  expect(f.execute(first).state).toBe("applied");
  const active = activateArtifactPlan(f, first);
  expect(active.producer.read()).toMatchObject({ revision: 1, sourceGeneration: 1,
    sourcePair: destination, pending: null });
  const next = plan(active, 1, { stateRoot: destination.stateRoot, artifactRoot: join(f.workspace, "later-artifacts") });
  expect(active.execute(next).state).toBe("applied");
  const pending = active.producer.read().pending;
  if (pending === null) throw new Error("expected new pending plan");
  expect(pending.commandId).toBe(next.commandId);
  const cancelled = cancel(active, 2, pending);
  expect(active.execute(cancelled).state).toBe("applied");
  expect(active.producer.read()).toMatchObject({ revision: 3, sourceGeneration: 1, pending: null });
  expect(active.database.authority.commands.listStorageRelocationCommands().map((row) => row.commandId))
    .toEqual([first.commandId, next.commandId, cancelled.commandId]);
  expect(active.database.authority.commandAudits.findByCommand(first.commandId)?.result.state).toBe("applied");
});

it("refuses a receipt bound to a different plan despite a valid control receipt chain", () => {
  const f = fixture();
  const first = plan(f, 0, { stateRoot: f.pair.stateRoot, artifactRoot: join(f.workspace, "moved-artifacts") });
  f.execute(first);
  const active = activateArtifactPlan(f, first, { commandId: randomUUID() });
  expect(() => active.producer.read()).toThrow(/activation receipt does not match pending plan/u);
});

it("refuses missing receipts and corrupt historical audits after activation", () => {
  const f = fixture();
  const first = plan(f, 0, { stateRoot: f.pair.stateRoot, artifactRoot: join(f.workspace, "moved-artifacts") });
  f.execute(first);
  const active = activateArtifactPlan(f, first);
  const audit = active.database.authority.commandAudits.findByCommand(first.commandId);
  if (audit === undefined) throw new Error("expected audit");
  active.database.withAuthorityTransaction((repositories) => {
    repositories.commandAudits.insert({ ...audit, auditId: randomUUID() });
  });
  expect(() => active.producer.read()).toThrow(/recorded audits/u);
  const receiptDirectory = join(f.workspace, ".runtime-control", "relocation-receipts");
  unlinkSync(join(receiptDirectory, readdirSync(receiptDirectory)[0]));
  expect(() => active.producer.read()).toThrow(/active locator receipt chain mismatch/u);
  const after = plan(active, 1);
  expect(() => active.producer.validate(after)).toThrow(/active locator receipt chain mismatch/u);
});

it("refuses duplicate or rewound control receipts before projecting command history", () => {
  const f = fixture();
  const first = plan(f, 0, { stateRoot: f.pair.stateRoot, artifactRoot: join(f.workspace, "moved-artifacts") });
  f.execute(first);
  const active = activateArtifactPlan(f, first);
  const directory = join(f.workspace, ".runtime-control", "relocation-receipts");
  const name = readdirSync(directory)[0];
  const path = join(directory, name);
  const bytes = readFileSync(path);
  const duplicate = join(directory, `000000000002-${name.slice(13)}`);
  copyFileSync(path, duplicate);
  expect(() => active.producer.read()).toThrow(/receipt chain mismatch/u);
  unlinkSync(duplicate);
  const record = JSON.parse(bytes.toString()) as Record<string, unknown>;
  writeFileSync(path, JSON.stringify({ ...record, toGeneration: 0 }));
  expect(() => active.producer.read()).toThrow(/receipt chain mismatch/u);
  writeFileSync(path, bytes);
  expect(active.producer.read()).toMatchObject({ revision: 1, sourceGeneration: 1, pending: null });
});

it("checks admission liveness for read, project, and validate", () => {
  const f = fixture();
  const request = plan(f, 0);
  f.lease.release();
  expect(() => f.producer.read()).toThrow(/released/u);
  expect(() => f.producer.project(f.database.authority)).toThrow(/released/u);
  expect(() => f.producer.validate(request)).toThrow(/released/u);
});
