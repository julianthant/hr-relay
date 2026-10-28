import { runtimeLifetimeLock } from "../../../support/helpers/backend/runtime-lifetime.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, it } from "vitest";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { executeStorageRelocationCommand } from "../../../../src/backend/runs/commands/command-kernel.js";
import { readSettings } from "../../../../src/backend/runtime/settings/settings-runtime.js";
import { RuntimeAdmission, acquireSharedRuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { acquireInstallation } from "../../../../src/backend/storage/admission/installation.js";
import { createStorageRelocationPlanReader } from "../../../../src/backend/storage/maintenance/storage-relocation-plans.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { ArtifactRefSchema } from "../../../../src/models/artifacts/artifacts.js";
import { hostConfigFacts } from "../../../../src/models/config/host-display.js";
import { NotificationRecordSchema } from "../../../../src/models/notifications/notifications.js";
import { StorageRelocationCommandRequestSchema, storageRelocationDesiredDigest, storageRelocationRequestFingerprint, type StorageRelocationCommandRequest } from "../../../../src/rules/commands/commands.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { WAL_NOTIFICATION_TITLE, cleanupFixtureRoots, clock as clock_m0, durableSnapshot, installation, leaveStoppedWal, plan as plan_m0, relocate } from "../../../support/helpers/storage/storage-relocation-fixture.js";

import { acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";

{

const _afterEachFixture0 = cleanupFixtureRoots;

it("prepares a genuine offline relocation fixture with settings, protected data and managed artifacts", async () => {
try {

  const f = await installation();
  const request = plan_m0(f.workspace, f.lifetime, { stateRoot: join(f.root, "new-state"), artifactRoot: join(f.root, "new-artifacts") });
  const admission = acquireSharedRuntimeAdmission(f.workspace, f.lifetime);
  try {
    const database = AuthorityDatabase.open(admission, { path: f.authorityPath, busyTimeoutMs: 250,
      migrationOwner: "offline-relocation-fixture" }, clock_m0);
    try {
      const reader = createStorageRelocationPlanReader({ authority: database, admission, workspace: f.workspace });
      assert.equal(reader.read().pending?.commandId, request.commandId);
      assert.equal(readSettings(database.authority).revision, 2);
      assert.equal(ArtifactRefSchema.parse((JSON.parse(readFileSync(f.artifactFile, "utf8")) as { ref: unknown }).ref).sha256,
        f.artifact.sha256);
      assert.ok(readFileSync(f.credentialFile).byteLength > 0);
    } finally { database.close(); }
  } finally { admission.release(); }
  const walNotificationId = await leaveStoppedWal(f.workspace, f.lifetime, f.authorityPath);
  const before = durableSnapshot(f.authorityPath, f.credentialFile, f.artifactFile);
  assert.equal(before.notifications.length, 1);
  const notification = NotificationRecordSchema.parse(JSON.parse(before.notifications[0] ?? "null") as unknown);
  assert.equal(notification.notificationId, walNotificationId);
  assert.equal(notification.title, WAL_NOTIFICATION_TITLE);
  assert.equal(before.appSettings.length, 1);
  assert.equal(before.commands.length, 3);
  assert.equal(before.audits.length, 3);

} finally {
_afterEachFixture0();
}
});
}

{

const cleanups: Array<() => void> = [];
const _afterEachFixture0 = () => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); };

async function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "relocation-plan-")));
  const workspace = join(root, "workspace");
  mkdirSync(workspace, { mode: 0o700 });
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const pair = { stateRoot: join(workspace, ".tracker/data"), artifactRoot: join(workspace, ".tracker/data", "artifacts") };
  const lifetime = await runtimeLifetimeLock();
  const adoption = acquireEntrypointAdmission(workspace, "exclusive", lifetime); adoption.release();
  const lease = acquireInstallation(workspace, "shared", lifetime); cleanups.push(() => lease.release());
  const admission = RuntimeAdmission.fromInstallationLease(lease);
  const clock = manualClock(new Date("2026-09-26T12:00:00.000Z"));
  const database = AuthorityDatabase.open(admission, { path: join(pair.stateRoot, "state.db"), busyTimeoutMs: 250, migrationOwner: "unit-test" }, clock);
  cleanups.push(() => database.close());
  const initial = resolveConfigWithProvenance({}, hostConfigFacts({}), clock, admission);
  database.authority.runtimeConfig.initialize({ configSnapshotId: randomUUID(), revision: 1, fingerprint: initial.fingerprint,
    config: initial.config, provenance: initial.provenance, capturedAt: clock.now().toISOString(), capturedBy: "local-operator" });
  const producer = createStorageRelocationPlanReader({ authority: database, admission, workspace });
  const execute = (value: unknown) => executeStorageRelocationCommand({ authority: database, clock,
    ids: { uuid: randomUUID }, storageRelocationPlans: producer }, value);
  return { workspace, lifetime, pair, lease, admission, clock, database, producer, execute };
}

type PlanContext = Pick<Awaited<ReturnType<typeof fixture>>, "workspace" | "lease" | "clock" | "producer">;
function target(f: PlanContext, expectedRevision: number) {
  return { installationId: f.lease.locator.installationId, sourceGeneration: f.lease.locator.generation,
    sourcePair: { stateRoot: f.lease.locator.stateRoot, artifactRoot: f.lease.locator.artifactRoot }, expectedRevision };
}
function plan(f: PlanContext, expectedRevision: number, desiredPair = {
  stateRoot: join(dirname(f.workspace), "moved-state"), artifactRoot: join(dirname(f.workspace), "moved-state", "artifacts"),
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
async function activateArtifactPlan(f: Awaited<ReturnType<typeof fixture>>, request: StorageRelocationCommandRequest) {
  if (request.type !== "plan-storage-relocation") throw new Error("expected plan");
  f.database.close();
  f.lease.release();
  await relocate(f.workspace, f.lifetime, request.commandId);
  const destination = request.payload.desiredPair;
  const lease = acquireInstallation(f.workspace, "shared", f.lifetime);
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

it("persists immutable planned intent, exact retry, cancel revision, and readback without changing the locator", async () => {
try {

  const f = await fixture();
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
  const next = plan(f, 2, { stateRoot: f.pair.stateRoot, artifactRoot: join(dirname(f.workspace), "moved-artifacts") });
  expect(f.execute(next).state).toBe("applied");
  expect(f.producer.read()).toMatchObject({ revision: 3, pending: { commandId: next.commandId } });
  expect(f.lease.locator).toMatchObject({ generation: 0, ...f.pair });
  expect(f.database.authority.commands.listStorageRelocationCommands()).toHaveLength(3);

} finally {
_afterEachFixture0();
}
});

it("refuses stale CAS, reused write identity, and mismatched request or desired digest without a row", async () => {
try {

  const f = await fixture();
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

} finally {
_afterEachFixture0();
}
});

it("refuses divergent command identity and cancellation of a different plan", async () => {
try {

  const f = await fixture();
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

} finally {
_afterEachFixture0();
}
});

it("admits artifact-only intent and refuses stranded nested artifacts or unsafe path overlap", async () => {
try {

  const f = await fixture();
  const artifactOnly = plan(f, 0, { stateRoot: f.pair.stateRoot, artifactRoot: join(dirname(f.workspace), "new-artifacts") });
  expect(f.execute(artifactOnly).state).toBe("applied");
  const nestedArtifactOnly = plan(f, 1, { stateRoot: f.pair.stateRoot, artifactRoot: join(f.pair.stateRoot, "new-artifacts") });
  expect(() => f.execute(nestedArtifactOnly)).toThrow(/destination is inside workspace/u);
  const impossible = plan(f, 1, { stateRoot: join(dirname(f.workspace), "new-state"), artifactRoot: f.pair.artifactRoot });
  expect(() => f.execute(impossible)).toThrow(/strand nested artifacts/u);
  const overlapping = plan(f, 1, { stateRoot: join(f.pair.stateRoot, "nested"), artifactRoot: join(dirname(f.workspace), "other-artifacts") });
  expect(() => f.execute(overlapping)).toThrow(/destination is inside workspace/u);
  const relative = plan(f, 1, { stateRoot: "relative", artifactRoot: join(dirname(f.workspace), "other-artifacts") });
  expect(() => f.execute(relative)).toThrow(/canonical absolute/u);
  expect(f.producer.read().revision).toBe(1);

} finally {
_afterEachFixture0();
}
});

it("refuses incomplete and divergent immutable history, including locator identity drift", async () => {
try {

  const f = await fixture();
  const orphan = plan(f, 0);
  f.database.withAuthorityTransaction((repositories) => { repositories.commands.insert(orphan); });
  expect(() => f.producer.read()).toThrow(/missing command audit/u);
  const counterfeit = Object.create(RuntimeAdmission.prototype) as RuntimeAdmission;
  expect(() => createStorageRelocationPlanReader({ authority: f.database, admission: counterfeit,
    workspace: f.workspace })).toThrow(/runtime-admission: required/u);

} finally {
_afterEachFixture0();
}
});

it("refuses duplicate or gap revisions", async () => {
try {

  const f = await fixture();
  const first = plan(f, 0); f.execute(first);
  const duplicate = plan(f, 0);
  f.database.withAuthorityTransaction((repositories) => { repositories.commands.insert(duplicate); });
  expect(() => f.producer.read()).toThrow(/duplicate or gap plan revision/u);
  const g = await fixture();
  const gap = plan(g, 2);
  g.database.withAuthorityTransaction((repositories) => { repositories.commands.insert(gap); });
  expect(() => g.producer.read()).toThrow(/duplicate or gap plan revision/u);

} finally {
_afterEachFixture0();
}
});

it("refuses mismatched or multiple command audits", async () => {
try {

  const f = await fixture();
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
  const g = await fixture();
  const valid = plan(g, 0); g.execute(valid);
  const audit = g.database.authority.commandAudits.findByCommand(valid.commandId);
  if (audit === undefined) throw new Error("expected audit");
  expect(() => g.database.withAuthorityTransaction((repositories) => {
    repositories.commandAudits.insert({ ...audit, auditId: randomUUID() });
  })).toThrow(/command-audit-outcome-conflict/u);
  expect(g.database.authority.commandAudits.findByCommand(valid.commandId)).toEqual(audit);
  expect(g.producer.read().revision).toBe(1);

} finally {
_afterEachFixture0();
}
});

it("projects one global command revision across a completed receipt and new plan and cancel", async () => {
try {

  const f = await fixture();
  const destination = { stateRoot: f.pair.stateRoot, artifactRoot: join(dirname(f.workspace), "moved-artifacts") };
  const first = plan(f, 0, destination);
  expect(f.execute(first).state).toBe("applied");
  const active = await activateArtifactPlan(f, first);
  expect(active.producer.read()).toMatchObject({ revision: 1, sourceGeneration: 1,
    sourcePair: destination, pending: null });
  const next = plan(active, 1, { stateRoot: destination.stateRoot, artifactRoot: join(dirname(f.workspace), "later-artifacts") });
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

} finally {
_afterEachFixture0();
}
});

it("refuses a receipt bound to a different plan despite a valid control receipt chain", async () => {
try {

  const f = await fixture();
  const first = plan(f, 0, { stateRoot: f.pair.stateRoot, artifactRoot: join(dirname(f.workspace), "moved-artifacts") });
  f.execute(first);
  const active = await activateArtifactPlan(f, first);
  const directory = join(f.workspace, ".tracker/control", "relocation-receipts");
  const path = join(directory, readdirSync(directory)[0]);
  const bytes = readFileSync(path, "utf8");
  const receipt = JSON.parse(bytes) as { plan: { commandId: string } };
  writeFileSync(path, JSON.stringify({ ...receipt, plan: { ...receipt.plan, commandId: randomUUID() } }));
  expect(() => active.producer.read()).toThrow(/relocation receipt evidence mismatch/u);

} finally {
_afterEachFixture0();
}
});

it("refuses missing receipts and corrupt historical audits after activation", async () => {
try {

  const f = await fixture();
  const first = plan(f, 0, { stateRoot: f.pair.stateRoot, artifactRoot: join(dirname(f.workspace), "moved-artifacts") });
  f.execute(first);
  const active = await activateArtifactPlan(f, first);
  const audit = active.database.authority.commandAudits.findByCommand(first.commandId);
  if (audit === undefined) throw new Error("expected audit");
  expect(() => active.database.withAuthorityTransaction((repositories) => {
    repositories.commandAudits.insert({ ...audit, auditId: randomUUID() });
  })).toThrow(/command-audit-outcome-conflict/u);
  expect(active.database.authority.commandAudits.findByCommand(first.commandId)).toEqual(audit);
  expect(active.producer.read().revision).toBe(1);
  const receiptDirectory = join(f.workspace, ".tracker/control", "relocation-receipts");
  unlinkSync(join(receiptDirectory, readdirSync(receiptDirectory)[0]));
  expect(() => active.producer.read()).toThrow(/active locator receipt chain mismatch/u);
  const after = plan(active, 1);
  expect(() => active.producer.validate(after)).toThrow(/active locator receipt chain mismatch/u);

} finally {
_afterEachFixture0();
}
});

it("refuses duplicate or rewound control receipts before projecting command history", async () => {
try {

  const f = await fixture();
  const first = plan(f, 0, { stateRoot: f.pair.stateRoot, artifactRoot: join(dirname(f.workspace), "moved-artifacts") });
  f.execute(first);
  const active = await activateArtifactPlan(f, first);
  const directory = join(f.workspace, ".tracker/control", "relocation-receipts");
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

} finally {
_afterEachFixture0();
}
});

it("checks admission liveness for read, project, and validate", async () => {
try {

  const f = await fixture();
  const request = plan(f, 0);
  f.lease.release();
  expect(() => f.producer.read()).toThrow(/released/u);
  expect(() => f.producer.project(f.database.authority)).toThrow(/released/u);
  expect(() => f.producer.validate(request)).toThrow(/released/u);

} finally {
_afterEachFixture0();
}
});

it("refuses a missing, malformed, or drifting locator after plan reader creation", async () => {
try {

  for (const failure of ["missing", "malformed", "drift"] as const) {
    const f = await fixture();
    expect(f.producer.read()).toMatchObject({ revision: 0, pending: null });
    const locatorPath = join(f.workspace, ".tracker/control", "locator.json");
    if (failure === "missing") unlinkSync(locatorPath);
    else if (failure === "malformed") writeFileSync(locatorPath, "{");
    else {
      const alternateArtifactRoot = join(dirname(f.workspace), "alternate-artifacts");
      mkdirSync(alternateArtifactRoot, { mode: 0o700 });
      copyFileSync(join(f.pair.artifactRoot, ".runtime-owner.json"), join(alternateArtifactRoot, ".runtime-owner.json"));
      const locator = JSON.parse(readFileSync(locatorPath, "utf8")) as Record<string, unknown>;
      writeFileSync(locatorPath, JSON.stringify({ ...locator, artifactRoot: alternateArtifactRoot }));
    }
    const expected = failure === "missing" ? /locator missing/u
      : failure === "drift" ? /admitted locator changed/u : /./u;
    expect(() => f.producer.read()).toThrow(expected);
    expect(() => f.producer.validate(plan(f, 0))).toThrow(expected);
  }

} finally {
_afterEachFixture0();
}
});
}
