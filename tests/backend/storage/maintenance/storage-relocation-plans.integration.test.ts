import assert_m0 from "node:assert/strict";
import { randomUUID as randomUUID_m1 } from "node:crypto";
import { copyFileSync as copyFileSync_m1,mkdirSync as mkdirSync_m1,mkdtempSync as mkdtempSync_m1,readFileSync as readFileSync_m0,readFileSync as readFileSync_m1,readdirSync as readdirSync_m1,realpathSync as realpathSync_m1,rmSync as rmSync_m1,unlinkSync as unlinkSync_m1,writeFileSync as writeFileSync_m1 } from "node:fs";
import { tmpdir as tmpdir_m1 } from "node:os";
import { dirname as dirname_m1,join as join_m0,join as join_m1 } from "node:path";
import { expect as expect_m1,it as it_m0,it as it_m1 } from "vitest";
import { resolveConfigWithProvenance as resolveConfigWithProvenance_m1 } from "../../../../src/backend/app/config/resolve.js";
import { executeStorageRelocationCommand as executeStorageRelocationCommand_m1 } from "../../../../src/backend/runs/commands/command-kernel.js";
import { readSettings as readSettings_m0 } from "../../../../src/backend/runtime/settings/settings-runtime.js";
import { RuntimeAdmission as RuntimeAdmission_m1,acquireSharedRuntimeAdmission as acquireSharedRuntimeAdmission_m0 } from "../../../../src/backend/storage/admission/admission.js";
import { acquireInstallation as acquireInstallation_m1 } from "../../../../src/backend/storage/admission/installation.js";
import { createStorageRelocationPlanReader as createStorageRelocationPlanReader_m0,createStorageRelocationPlanReader as createStorageRelocationPlanReader_m1 } from "../../../../src/backend/storage/maintenance/storage-relocation-plans.js";
import { AuthorityDatabase as AuthorityDatabase_m0,AuthorityDatabase as AuthorityDatabase_m1 } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { ArtifactRefSchema as ArtifactRefSchema_m0 } from "../../../../src/models/artifacts/artifacts.js";
import { hostConfigFacts as hostConfigFacts_m1 } from "../../../../src/models/config/host-display.js";
import { NotificationRecordSchema as NotificationRecordSchema_m0 } from "../../../../src/models/notifications/notifications.js";
import {
StorageRelocationCommandRequestSchema as StorageRelocationCommandRequestSchema_m1,storageRelocationDesiredDigest as storageRelocationDesiredDigest_m1,
storageRelocationRequestFingerprint as storageRelocationRequestFingerprint_m1,
type StorageRelocationCommandRequest as StorageRelocationCommandRequest_m1
} from "../../../../src/rules/commands/commands.js";
import { manualClock as manualClock_m1 } from "../../../../src/rules/time/clock.js";
import {
WAL_NOTIFICATION_TITLE as WAL_NOTIFICATION_TITLE_m0,
cleanupFixtureRoots as cleanupFixtureRoots_m0,clock as clock_m0,durableSnapshot as durableSnapshot_m0,installation as installation_m0,
leaveStoppedWal as leaveStoppedWal_m0,
plan as plan_m0,
relocate as relocate_m1
} from "../../../support/helpers/storage/storage-relocation-fixture.js";

import { acquireEntrypointAdmission as acquireEntrypointAdmission_m1 } from "../../../../src/backend/storage/admission/bootstrap-admission.js";


{


const _afterEachFixture0 = cleanupFixtureRoots_m0;

it_m0("prepares a genuine offline relocation fixture with settings, protected data and managed artifacts", async () => {
try {


  const f = await installation_m0();
  const request = plan_m0(f.workspace, { stateRoot: join_m0(f.root, "new-state"), artifactRoot: join_m0(f.root, "new-artifacts") });
  const admission = acquireSharedRuntimeAdmission_m0(f.workspace);
  try {
    const database = AuthorityDatabase_m0.open(admission, { path: f.authorityPath, busyTimeoutMs: 250,
      migrationOwner: "offline-relocation-fixture" }, clock_m0);
    try {
      const reader = createStorageRelocationPlanReader_m0({ authority: database, admission, workspace: f.workspace });
      assert_m0.equal(reader.read().pending?.commandId, request.commandId);
      assert_m0.equal(readSettings_m0(database.authority).revision, 2);
      assert_m0.equal(ArtifactRefSchema_m0.parse((JSON.parse(readFileSync_m0(f.artifactFile, "utf8")) as { ref: unknown }).ref).sha256,
        f.artifact.sha256);
      assert_m0.ok(readFileSync_m0(f.credentialFile).byteLength > 0);
    } finally { database.close(); }
  } finally { admission.release(); }
  const walNotificationId = leaveStoppedWal_m0(f.workspace, f.authorityPath);
  const before = durableSnapshot_m0(f.authorityPath, f.credentialFile, f.artifactFile);
  assert_m0.equal(before.notifications.length, 1);
  const notification = NotificationRecordSchema_m0.parse(JSON.parse(before.notifications[0] ?? "null") as unknown);
  assert_m0.equal(notification.notificationId, walNotificationId);
  assert_m0.equal(notification.title, WAL_NOTIFICATION_TITLE_m0);
  assert_m0.equal(before.appSettings.length, 1);
  assert_m0.equal(before.commands.length, 3);
  assert_m0.equal(before.audits.length, 3);

} finally {
_afterEachFixture0();
}
});
}

{


const cleanups: Array<() => void> = [];
const _afterEachFixture0 = () => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); };

function fixture() {
  const root = realpathSync_m1(mkdtempSync_m1(join_m1(tmpdir_m1(), "relocation-plan-")));
  const workspace = join_m1(root, "workspace");
  mkdirSync_m1(workspace, { mode: 0o700 });
  cleanups.push(() => rmSync_m1(root, { recursive: true, force: true }));
  const pair = { stateRoot: join_m1(workspace, ".tracker/data"), artifactRoot: join_m1(workspace, ".tracker/data", "artifacts") };
  const adoption = acquireEntrypointAdmission_m1(workspace, "exclusive"); adoption.release();
  const lease = acquireInstallation_m1(workspace, "shared"); cleanups.push(() => lease.release());
  const admission = RuntimeAdmission_m1.fromInstallationLease(lease);
  const clock = manualClock_m1(new Date("2026-09-26T12:00:00.000Z"));
  const database = AuthorityDatabase_m1.open(admission, { path: join_m1(pair.stateRoot, "state.db"), busyTimeoutMs: 250, migrationOwner: "unit-test" }, clock);
  cleanups.push(() => database.close());
  const initial = resolveConfigWithProvenance_m1({}, hostConfigFacts_m1({}), clock, admission);
  database.authority.runtimeConfig.initialize({ configSnapshotId: randomUUID_m1(), revision: 1, fingerprint: initial.fingerprint,
    config: initial.config, provenance: initial.provenance, capturedAt: clock.now().toISOString(), capturedBy: "local-operator" });
  const producer = createStorageRelocationPlanReader_m1({ authority: database, admission, workspace });
  const execute = (value: unknown) => executeStorageRelocationCommand_m1({ authority: database, clock,
    ids: { uuid: randomUUID_m1 }, storageRelocationPlans: producer }, value);
  return { workspace, pair, lease, admission, clock, database, producer, execute };
}

type PlanContext = Pick<ReturnType<typeof fixture>, "workspace" | "lease" | "clock" | "producer">;
function target(f: PlanContext, expectedRevision: number) {
  return { installationId: f.lease.locator.installationId, sourceGeneration: f.lease.locator.generation,
    sourcePair: { stateRoot: f.lease.locator.stateRoot, artifactRoot: f.lease.locator.artifactRoot }, expectedRevision };
}
function plan(f: PlanContext, expectedRevision: number, desiredPair = {
  stateRoot: join_m1(dirname_m1(f.workspace), "moved-state"), artifactRoot: join_m1(dirname_m1(f.workspace), "moved-state", "artifacts"),
}): StorageRelocationCommandRequest_m1 {
  const basis = target(f, expectedRevision);
  const request = StorageRelocationCommandRequestSchema_m1.parse({ family: "storage-relocation", type: "plan-storage-relocation",
    commandId: randomUUID_m1(), requestedAt: f.clock.now().toISOString(), requestedBy: "local-operator", source: "settings-surface",
    target: basis, payload: { writeId: randomUUID_m1(), desiredPair,
      desiredDigest: storageRelocationDesiredDigest_m1(basis as StorageRelocationCommandRequest_m1["target"], desiredPair),
      requestFingerprint: "0".repeat(64) } });
  return StorageRelocationCommandRequestSchema_m1.parse({ ...request, payload: { ...request.payload,
    requestFingerprint: storageRelocationRequestFingerprint_m1(request) } });
}
function cancel(f: PlanContext, expectedRevision: number, pending: NonNullable<ReturnType<typeof f.producer.read>["pending"]>): StorageRelocationCommandRequest_m1 {
  const request = StorageRelocationCommandRequestSchema_m1.parse({ family: "storage-relocation", type: "cancel-storage-relocation",
    commandId: randomUUID_m1(), requestedAt: f.clock.now().toISOString(), requestedBy: "local-operator", source: "settings-surface",
    target: target(f, expectedRevision), payload: { writeId: randomUUID_m1(), cancelledPlanCommandId: pending.commandId,
      cancelledPlanDigest: pending.desiredDigest, requestFingerprint: "0".repeat(64) } });
  return StorageRelocationCommandRequestSchema_m1.parse({ ...request, payload: { ...request.payload,
    requestFingerprint: storageRelocationRequestFingerprint_m1(request) } });
}
async function activateArtifactPlan(f: ReturnType<typeof fixture>, request: StorageRelocationCommandRequest_m1) {
  if (request.type !== "plan-storage-relocation") throw new Error("expected plan");
  f.database.close();
  f.lease.release();
  await relocate_m1(f.workspace, request.commandId);
  const destination = request.payload.desiredPair;
  const lease = acquireInstallation_m1(f.workspace, "shared");
  cleanups.push(() => lease.release());
  const admission = RuntimeAdmission_m1.fromInstallationLease(lease);
  const database = AuthorityDatabase_m1.open(admission, { path: join_m1(destination.stateRoot, "state.db"),
    busyTimeoutMs: 250, migrationOwner: "unit-test" }, f.clock);
  cleanups.push(() => database.close());
  const producer = createStorageRelocationPlanReader_m1({ authority: database, admission, workspace: f.workspace });
  const execute = (value: unknown) => executeStorageRelocationCommand_m1({ authority: database, clock: f.clock,
    ids: { uuid: randomUUID_m1 }, storageRelocationPlans: producer }, value);
  return { workspace: f.workspace, pair: destination, lease, admission, clock: f.clock, database, producer, execute };
}

it_m1("persists immutable planned intent, exact retry, cancel revision, and readback without changing the locator", async () => {
try {


  const f = fixture();
  const first = plan(f, 0);
  if (first.type !== "plan-storage-relocation") throw new Error("test fixture is not a plan");
  expect_m1(f.execute(first)).toMatchObject({ state: "applied", commandId: first.commandId });
  const planned = f.producer.read();
  expect_m1(planned).toMatchObject({ revision: 1, pending: { commandId: first.commandId, desiredPair: first.payload.desiredPair } });
  expect_m1(f.execute(first)).toEqual(f.database.authority.commandAudits.findByCommand(first.commandId)?.result);
  expect_m1(f.producer.read().revision).toBe(1);
  const cancelled = cancel(f, 1, planned.pending!);
  expect_m1(f.execute(cancelled).state).toBe("applied");
  expect_m1(f.producer.read()).toMatchObject({ revision: 2, pending: null });
  expect_m1(f.execute(cancelled).state).toBe("applied");
  const next = plan(f, 2, { stateRoot: f.pair.stateRoot, artifactRoot: join_m1(dirname_m1(f.workspace), "moved-artifacts") });
  expect_m1(f.execute(next).state).toBe("applied");
  expect_m1(f.producer.read()).toMatchObject({ revision: 3, pending: { commandId: next.commandId } });
  expect_m1(f.lease.locator).toMatchObject({ generation: 0, ...f.pair });
  expect_m1(f.database.authority.commands.listStorageRelocationCommands()).toHaveLength(3);

} finally {
_afterEachFixture0();
}
});

it_m1("refuses stale CAS, reused write identity, and mismatched request or desired digest without a row", async () => {
try {


  const f = fixture();
  const first = plan(f, 0); f.execute(first);
  const stale = plan(f, 0);
  expect_m1(f.execute(stale)).toMatchObject({ state: "conflict", currentVersion: 1 });
  const reuse = plan(f, 1);
  expect_m1(() => f.execute({ ...reuse, payload: { ...reuse.payload, writeId: first.payload.writeId } })).toThrow(/fingerprint mismatch/u);
  const reused = StorageRelocationCommandRequestSchema_m1.parse({ ...reuse, payload: { ...reuse.payload, writeId: first.payload.writeId,
    requestFingerprint: "0".repeat(64) } });
  const validReuse = StorageRelocationCommandRequestSchema_m1.parse({ ...reused, payload: { ...reused.payload,
    requestFingerprint: storageRelocationRequestFingerprint_m1(reused) } });
  expect_m1(() => f.execute(validReuse)).toThrow(/write id reused/u);
  expect_m1(() => f.execute({ ...reuse, payload: { ...reuse.payload, desiredDigest: "0".repeat(64) } })).toThrow(/fingerprint mismatch/u);
  const badDigest = StorageRelocationCommandRequestSchema_m1.parse({ ...reuse, payload: { ...reuse.payload, desiredDigest: "0".repeat(64), requestFingerprint: "0".repeat(64) } });
  expect_m1(() => f.execute({ ...badDigest, payload: { ...badDigest.payload,
    requestFingerprint: storageRelocationRequestFingerprint_m1(badDigest) } })).toThrow(/desired digest mismatch/u);
  expect_m1(f.database.authority.commands.listStorageRelocationCommands()).toHaveLength(1);

} finally {
_afterEachFixture0();
}
});

it_m1("refuses divergent command identity and cancellation of a different plan", async () => {
try {


  const f = fixture();
  const first = plan(f, 0); f.execute(first);
  const altered = plan(f, 1);
  const duplicateId = StorageRelocationCommandRequestSchema_m1.parse({ ...altered, commandId: first.commandId,
    payload: { ...altered.payload, requestFingerprint: "0".repeat(64) } });
  const divergent = StorageRelocationCommandRequestSchema_m1.parse({ ...duplicateId, payload: { ...duplicateId.payload,
    requestFingerprint: storageRelocationRequestFingerprint_m1(duplicateId) } });
  expect_m1(() => f.execute(divergent)).toThrow(/command|identity/u);
  const pending = f.producer.read().pending;
  if (pending === null) throw new Error("expected plan");
  const wrong = cancel(f, 1, pending);
  const wrongPlan = StorageRelocationCommandRequestSchema_m1.parse({ ...wrong, payload: { ...wrong.payload,
    cancelledPlanDigest: "0".repeat(64), requestFingerprint: "0".repeat(64) } });
  const cancelledOther = StorageRelocationCommandRequestSchema_m1.parse({ ...wrongPlan, payload: { ...wrongPlan.payload,
    requestFingerprint: storageRelocationRequestFingerprint_m1(wrongPlan) } });
  expect_m1(() => f.execute(cancelledOther)).toThrow(/cancel does not match/u);
  expect_m1(f.producer.read().revision).toBe(1);

} finally {
_afterEachFixture0();
}
});

it_m1("admits artifact-only intent and refuses stranded nested artifacts or unsafe path overlap", async () => {
try {


  const f = fixture();
  const artifactOnly = plan(f, 0, { stateRoot: f.pair.stateRoot, artifactRoot: join_m1(dirname_m1(f.workspace), "new-artifacts") });
  expect_m1(f.execute(artifactOnly).state).toBe("applied");
  const nestedArtifactOnly = plan(f, 1, { stateRoot: f.pair.stateRoot, artifactRoot: join_m1(f.pair.stateRoot, "new-artifacts") });
  expect_m1(() => f.execute(nestedArtifactOnly)).toThrow(/destination is inside workspace/u);
  const impossible = plan(f, 1, { stateRoot: join_m1(dirname_m1(f.workspace), "new-state"), artifactRoot: f.pair.artifactRoot });
  expect_m1(() => f.execute(impossible)).toThrow(/strand nested artifacts/u);
  const overlapping = plan(f, 1, { stateRoot: join_m1(f.pair.stateRoot, "nested"), artifactRoot: join_m1(dirname_m1(f.workspace), "other-artifacts") });
  expect_m1(() => f.execute(overlapping)).toThrow(/destination is inside workspace/u);
  const relative = plan(f, 1, { stateRoot: "relative", artifactRoot: join_m1(dirname_m1(f.workspace), "other-artifacts") });
  expect_m1(() => f.execute(relative)).toThrow(/canonical absolute/u);
  expect_m1(f.producer.read().revision).toBe(1);

} finally {
_afterEachFixture0();
}
});

it_m1("refuses incomplete and divergent immutable history, including locator identity drift", async () => {
try {


  const f = fixture();
  const orphan = plan(f, 0);
  f.database.withAuthorityTransaction((repositories) => { repositories.commands.insert(orphan); });
  expect_m1(() => f.producer.read()).toThrow(/missing command audit/u);
  const counterfeit = Object.create(RuntimeAdmission_m1.prototype) as RuntimeAdmission_m1;
  expect_m1(() => createStorageRelocationPlanReader_m1({ authority: f.database, admission: counterfeit,
    workspace: f.workspace })).toThrow(/runtime-admission: required/u);

} finally {
_afterEachFixture0();
}
});

it_m1("refuses duplicate or gap revisions", async () => {
try {


  const f = fixture();
  const first = plan(f, 0); f.execute(first);
  const duplicate = plan(f, 0);
  f.database.withAuthorityTransaction((repositories) => { repositories.commands.insert(duplicate); });
  expect_m1(() => f.producer.read()).toThrow(/duplicate or gap plan revision/u);
  const g = fixture();
  const gap = plan(g, 2);
  g.database.withAuthorityTransaction((repositories) => { repositories.commands.insert(gap); });
  expect_m1(() => g.producer.read()).toThrow(/duplicate or gap plan revision/u);

} finally {
_afterEachFixture0();
}
});

it_m1("refuses mismatched or multiple command audits", async () => {
try {


  const f = fixture();
  const command = plan(f, 0);
  f.database.withAuthorityTransaction((repositories) => {
    repositories.commands.insert(command);
    repositories.commandAudits.insert({ auditId: randomUUID_m1(), request: command, completedAt: f.clock.now().toISOString(),
      result: { state: "applied", commandId: command.commandId,
        affectedTargets: [{ family: "storage-relocation", revision: 2 }] },
      versionChanges: [{ target: { family: "storage-relocation", revision: 2 }, before: 0, after: 2 }],
      affectedDependencyIds: [] });
  });
  expect_m1(() => f.producer.read()).toThrow(/command audit mismatch/u);
  const g = fixture();
  const valid = plan(g, 0); g.execute(valid);
  const audit = g.database.authority.commandAudits.findByCommand(valid.commandId);
  if (audit === undefined) throw new Error("expected audit");
  expect_m1(() => g.database.withAuthorityTransaction((repositories) => {
    repositories.commandAudits.insert({ ...audit, auditId: randomUUID_m1() });
  })).toThrow(/command-audit-outcome-conflict/u);
  expect_m1(g.database.authority.commandAudits.findByCommand(valid.commandId)).toEqual(audit);
  expect_m1(g.producer.read().revision).toBe(1);

} finally {
_afterEachFixture0();
}
});

it_m1("projects one global command revision across a completed receipt and new plan and cancel", async () => {
try {


  const f = fixture();
  const destination = { stateRoot: f.pair.stateRoot, artifactRoot: join_m1(dirname_m1(f.workspace), "moved-artifacts") };
  const first = plan(f, 0, destination);
  expect_m1(f.execute(first).state).toBe("applied");
  const active = await activateArtifactPlan(f, first);
  expect_m1(active.producer.read()).toMatchObject({ revision: 1, sourceGeneration: 1,
    sourcePair: destination, pending: null });
  const next = plan(active, 1, { stateRoot: destination.stateRoot, artifactRoot: join_m1(dirname_m1(f.workspace), "later-artifacts") });
  expect_m1(active.execute(next).state).toBe("applied");
  const pending = active.producer.read().pending;
  if (pending === null) throw new Error("expected new pending plan");
  expect_m1(pending.commandId).toBe(next.commandId);
  const cancelled = cancel(active, 2, pending);
  expect_m1(active.execute(cancelled).state).toBe("applied");
  expect_m1(active.producer.read()).toMatchObject({ revision: 3, sourceGeneration: 1, pending: null });
  expect_m1(active.database.authority.commands.listStorageRelocationCommands().map((row) => row.commandId))
    .toEqual([first.commandId, next.commandId, cancelled.commandId]);
  expect_m1(active.database.authority.commandAudits.findByCommand(first.commandId)?.result.state).toBe("applied");

} finally {
_afterEachFixture0();
}
});

it_m1("refuses a receipt bound to a different plan despite a valid control receipt chain", async () => {
try {


  const f = fixture();
  const first = plan(f, 0, { stateRoot: f.pair.stateRoot, artifactRoot: join_m1(dirname_m1(f.workspace), "moved-artifacts") });
  f.execute(first);
  const active = await activateArtifactPlan(f, first);
  const directory = join_m1(f.workspace, ".tracker/control", "relocation-receipts");
  const path = join_m1(directory, readdirSync_m1(directory)[0]);
  const bytes = readFileSync_m1(path, "utf8");
  const receipt = JSON.parse(bytes) as { plan: { commandId: string } };
  writeFileSync_m1(path, JSON.stringify({ ...receipt, plan: { ...receipt.plan, commandId: randomUUID_m1() } }));
  expect_m1(() => active.producer.read()).toThrow(/relocation receipt evidence mismatch/u);

} finally {
_afterEachFixture0();
}
});

it_m1("refuses missing receipts and corrupt historical audits after activation", async () => {
try {


  const f = fixture();
  const first = plan(f, 0, { stateRoot: f.pair.stateRoot, artifactRoot: join_m1(dirname_m1(f.workspace), "moved-artifacts") });
  f.execute(first);
  const active = await activateArtifactPlan(f, first);
  const audit = active.database.authority.commandAudits.findByCommand(first.commandId);
  if (audit === undefined) throw new Error("expected audit");
  expect_m1(() => active.database.withAuthorityTransaction((repositories) => {
    repositories.commandAudits.insert({ ...audit, auditId: randomUUID_m1() });
  })).toThrow(/command-audit-outcome-conflict/u);
  expect_m1(active.database.authority.commandAudits.findByCommand(first.commandId)).toEqual(audit);
  expect_m1(active.producer.read().revision).toBe(1);
  const receiptDirectory = join_m1(f.workspace, ".tracker/control", "relocation-receipts");
  unlinkSync_m1(join_m1(receiptDirectory, readdirSync_m1(receiptDirectory)[0]));
  expect_m1(() => active.producer.read()).toThrow(/active locator receipt chain mismatch/u);
  const after = plan(active, 1);
  expect_m1(() => active.producer.validate(after)).toThrow(/active locator receipt chain mismatch/u);

} finally {
_afterEachFixture0();
}
});

it_m1("refuses duplicate or rewound control receipts before projecting command history", async () => {
try {


  const f = fixture();
  const first = plan(f, 0, { stateRoot: f.pair.stateRoot, artifactRoot: join_m1(dirname_m1(f.workspace), "moved-artifacts") });
  f.execute(first);
  const active = await activateArtifactPlan(f, first);
  const directory = join_m1(f.workspace, ".tracker/control", "relocation-receipts");
  const name = readdirSync_m1(directory)[0];
  const path = join_m1(directory, name);
  const bytes = readFileSync_m1(path);
  const duplicate = join_m1(directory, `000000000002-${name.slice(13)}`);
  copyFileSync_m1(path, duplicate);
  expect_m1(() => active.producer.read()).toThrow(/receipt chain mismatch/u);
  unlinkSync_m1(duplicate);
  const record = JSON.parse(bytes.toString()) as Record<string, unknown>;
  writeFileSync_m1(path, JSON.stringify({ ...record, toGeneration: 0 }));
  expect_m1(() => active.producer.read()).toThrow(/receipt chain mismatch/u);
  writeFileSync_m1(path, bytes);
  expect_m1(active.producer.read()).toMatchObject({ revision: 1, sourceGeneration: 1, pending: null });

} finally {
_afterEachFixture0();
}
});

it_m1("checks admission liveness for read, project, and validate", async () => {
try {


  const f = fixture();
  const request = plan(f, 0);
  f.lease.release();
  expect_m1(() => f.producer.read()).toThrow(/released/u);
  expect_m1(() => f.producer.project(f.database.authority)).toThrow(/released/u);
  expect_m1(() => f.producer.validate(request)).toThrow(/released/u);

} finally {
_afterEachFixture0();
}
});

it_m1("refuses a missing, malformed, or drifting locator after plan reader creation", async () => {
try {


  for (const failure of ["missing", "malformed", "drift"] as const) {
    const f = fixture();
    expect_m1(f.producer.read()).toMatchObject({ revision: 0, pending: null });
    const locatorPath = join_m1(f.workspace, ".tracker/control", "locator.json");
    if (failure === "missing") unlinkSync_m1(locatorPath);
    else if (failure === "malformed") writeFileSync_m1(locatorPath, "{");
    else {
      const alternateArtifactRoot = join_m1(dirname_m1(f.workspace), "alternate-artifacts");
      mkdirSync_m1(alternateArtifactRoot, { mode: 0o700 });
      copyFileSync_m1(join_m1(f.pair.artifactRoot, ".runtime-owner.json"), join_m1(alternateArtifactRoot, ".runtime-owner.json"));
      const locator = JSON.parse(readFileSync_m1(locatorPath, "utf8")) as Record<string, unknown>;
      writeFileSync_m1(locatorPath, JSON.stringify({ ...locator, artifactRoot: alternateArtifactRoot }));
    }
    const expected = failure === "missing" ? /locator missing/u
      : failure === "drift" ? /admitted locator changed/u : /./u;
    expect_m1(() => f.producer.read()).toThrow(expected);
    expect_m1(() => f.producer.validate(plan(f, 0))).toThrow(expected);
  }

} finally {
_afterEachFixture0();
}
});
}
