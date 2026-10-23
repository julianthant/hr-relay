import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { initialSettingsFileRecord } from "../../../../src/models/config/settings.js";
import { copyFileSync, existsSync, readFileSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { it, vi } from "vitest";
import { z } from "zod";
import { composeProfileRuntime } from "../../../../src/backend/app/composition/storage-compose.js";
import { composeProfileCredentialRepairInventory, composeProfilePendingLogoutInventory } from "../../../../src/backend/app/composition/profile-credential-inventory.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { createProfileSession } from "../../../../src/backend/profiles/profile-session.js";
import { createProfileRegistry } from "../../../../src/backend/profiles/registry.js";
import { appendEmergencyFault } from "../../../../src/backend/logs/emergency-faults.js";
import { acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { createCredentialStore, preparePendingLogoutInventory, readForErasure } from "../../../../src/backend/storage/configuration/credential-store.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { acquireRuntimeProcessLock } from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { LogoutOperationSchema } from "../../../../src/models/profiles/profile.js";
import { CredentialEraseInputSchema } from "../../../../src/models/config/credential-store.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH } from "../../../../src/models/config/protected-settings.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { createBoundProfileFixture, readAuthenticatedCredentialFixture } from "../../../support/helpers/admission-fixture.js";

function fixture() {
  const f = createBoundProfileFixture(), clock = manualClock(new Date("2026-10-21T12:00:00.000Z"));
  // This busy answer admits cancellation only; the restarted canonical owner proves closure.
  const session = createProfileSession({ machineRoot: f.machine.stateRoot, admission: f.machine, activity: { hasUnquiescedWork: () => true } });
  const active = session.signIn({ email: "fixture@example.edu", password: "disposable-fixture-password", at: clock.now().toISOString() });
  assert.equal(active.state, "active"); if (active.state !== "active") throw new Error("fixture activation refused");
  clock.advanceWall(60_000);
  const held = session.logOut(active.token, { at: clock.now().toISOString() });
  assert.equal(held.state, "cancelling"); if (held.state !== "cancelling") throw new Error("fixture cancellation refused"); assert.ok(held.operationId);
  const operationPath = join(f.machine.stateRoot, "machine", "operations", `${held.operationId}.json`);
  const readOperation = () => LogoutOperationSchema.parse(JSON.parse(readFileSync(operationPath, "utf8")));
  session.close();
  const owner = f.machine.admitProfile(createProfileRegistry(f.machine).settlementClaim(held.operationId));
  const actualInventory = composeProfilePendingLogoutInventory({ machine: f.machine, admission: owner, clock, hostFacts: { primaryDisplay: null } });
  const store = createCredentialStore({ admission: owner, stateRoot: f.stateRoot, erasureJournalAdmission: f.machine,
    erasureJournalPath: join(f.machine.stateRoot, "machine", "erasures", `${active.profileId}.json`), pendingLogoutInventory: actualInventory,
    repairInventory: composeProfileCredentialRepairInventory({ machine: f.machine, admission: owner, clock, hostFacts: { primaryDisplay: null } }) });
  return { f, owner, store, clock, operationPath, readOperation, profileId: active.profileId,
    restart() {
      owner.release(); f.admission.release(); f.machine.release();
      const machine = acquireEntrypointAdmission(f.workspace, "exclusive");
      const runtime = composeProfileRuntime({ admission: machine, clock, hostFacts: { primaryDisplay: null },
        processLockRoot: join(f.workspace, rebuildRuntimeIsolation.processLockRoot) });
      return { machine, runtime, async close() { await runtime.close(); machine.release(); f.close(); } };
    },
    close() { owner.release(); f.close(); } };
}

for (const phase of ["early", "captured", "incomplete", "journal", "erased"] as const) it(`finishes genuine cold ${phase} cancellation without ordinary authority or replacement erasure identity`, async () => {
  const f = fixture();
  let operation = f.readOperation();
  if (phase === "early") appendEmergencyFault({ stateRoot: f.f.stateRoot, code: "SYNTHETIC", build: "fixture", error: new Error("synthetic diagnostic"), now: f.clock.now() });
  else {
    operation = LogoutOperationSchema.parse({ ...operation, phase: phase === "incomplete" ? "incomplete" : "erasing", commandId: randomUUID(), writeId: randomUUID(),
      expectedRevision: readForErasure(f.store, operation.operationId).revision });
    f.f.machine.publishProfileOperation(operation);
    if (phase === "journal") {
      const interrupted = new Error("synthetic erasure-journal interruption");
      const crashing = createCredentialStore({ admission: f.owner, stateRoot: f.f.stateRoot, erasureJournalAdmission: f.f.machine,
        erasureJournalPath: join(f.f.machine.stateRoot, "machine", "erasures", `${f.profileId}.json`),
        hooks: { afterErasureJournal: () => { throw interrupted; } },
        repairInventory: composeProfileCredentialRepairInventory({ machine: f.f.machine, admission: f.owner, clock: f.clock, hostFacts: { primaryDisplay: null } }) });
      assert.throws(() => crashing.erase(CredentialEraseInputSchema.parse({ commandId: operation.commandId, writeId: operation.writeId,
        expectedRevision: operation.expectedRevision, commandFingerprint: "b".repeat(64), protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH, updatedAt: operation.at })), error => error === interrupted);
      assert.equal(existsSync(join(f.f.workspace, ".tracker", "control", "profile-publication.json")), true);
    }
    if (phase === "erased") assert.equal(f.store.erase(CredentialEraseInputSchema.parse({ commandId: operation.commandId, writeId: operation.writeId,
      expectedRevision: operation.expectedRevision, commandFingerprint: "b".repeat(64), protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH, updatedAt: operation.at })).state, "applied");
  }
  const before = AuthorityDatabase.readProfileMaintenanceInventory(f.owner), selection = f.f.machine.readProfileRegistry();
  const stopped = f.restart();
  try {
    assert.throws(() => stopped.runtime.selectedContext("unissued"));
    const result = stopped.runtime.session.resumeLogout(operation.operationId);
    assert.equal(result.state, "wiped"); if (result.state !== "wiped") throw new Error("cold closure did not finish");
    assert.equal(result.inventory.logoutComplete, true);
    assert.equal(existsSync(f.operationPath), false);
    const registry = stopped.machine.readProfileRegistry(), row = registry.profiles.find(value => value.profileId === f.profileId);
    assert.equal(registry.activeProfileId, null); assert.equal(registry.sessionGeneration, selection.sessionGeneration);
    assert.equal(row?.credentialState, "wiped"); assert.equal(row?.lifecycle, "ready");
    assert.throws(() => stopped.runtime.selectedContext("unissued"));
    const payload = z.object({ record: z.object({ revision: z.number(), entries: z.object({ ucpathUserId: z.unknown().optional(), ucpathPassword: z.unknown().optional() }) }),
      latestRequest: z.object({ kind: z.literal("erase"), request: CredentialEraseInputSchema }) }).parse(readAuthenticatedCredentialFixture(stopped.machine.stateRoot, f.profileId));
    assert.equal(payload.record.entries.ucpathUserId, undefined); assert.equal(payload.record.entries.ucpathPassword, undefined);
    assert.equal(payload.latestRequest.request.updatedAt, operation.at);
    if (phase !== "early") {
      assert.equal(payload.latestRequest.request.commandId, operation.commandId); assert.equal(payload.latestRequest.request.writeId, operation.writeId);
      assert.equal(payload.latestRequest.request.expectedRevision, operation.expectedRevision);
    }
    const settled = stopped.machine.admitProfile(createProfileRegistry(stopped.machine).storageClaim(f.profileId));
    try { assert.equal(AuthorityDatabase.readProfileMaintenanceInventory(settled).authorityGeneration, before.authorityGeneration); }
    finally { settled.release(); }
  } finally { await stopped.close(); }
});

it("refuses incomplete late captured values with a surviving clean canonical log instead of blessing tombstones", async () => {
  const f = fixture();
  let operation = f.readOperation();
  operation = LogoutOperationSchema.parse({ ...operation, phase: "erasing", commandId: randomUUID(), writeId: randomUUID(), expectedRevision: readForErasure(f.store, operation.operationId).revision });
  f.f.machine.publishProfileOperation(operation);
  assert.equal(f.store.erase(CredentialEraseInputSchema.parse({ commandId: operation.commandId, writeId: operation.writeId, expectedRevision: operation.expectedRevision,
    commandFingerprint: "b".repeat(64), protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH, updatedAt: operation.at })).state, "applied");
  appendEmergencyFault({ stateRoot: f.f.stateRoot, code: "SYNTHETIC", build: "fixture", error: new Error("synthetic diagnostic"), now: f.clock.now() });
  const protectedPath = join(f.f.stateRoot, "credentials", "protected.json"), priorProtected = readFileSync(protectedPath), priorOperation = readFileSync(f.operationPath);
  const stopped = f.restart();
  try {
    assert.throws(() => stopped.runtime.session.resumeLogout(operation.operationId), /credential-maintenance-copy-capture-incomplete/u);
    assert.equal(readFileSync(protectedPath).equals(priorProtected), true);
    assert.equal(readFileSync(f.operationPath).equals(priorOperation), true);
    assert.equal(stopped.machine.readProfileRegistry().profiles.find(row => row.profileId === f.profileId)?.lifecycle, "cancelling");
  } finally { await stopped.close(); }
});

for (const mutation of ["copy", "process-root", "key", "head"] as const) it(`revalidates actual ${mutation} membership around constructor-owned private inspection`, () => {
  const f = fixture(), operation = f.readOperation();
  const actual = composeProfilePendingLogoutInventory({ machine: f.f.machine, admission: f.owner, clock: f.clock, hostFacts: { primaryDisplay: null } });
  let restore: (() => void) | undefined, mutated = false;
  const store = createCredentialStore({ admission: f.owner, stateRoot: f.f.stateRoot, erasureJournalAdmission: f.f.machine,
    erasureJournalPath: join(f.f.machine.stateRoot, "machine", "erasures", `${f.profileId}.json`),
    pendingLogoutInventory: (purpose, current, copies) => {
      const proof = actual(purpose, current, copies);
      if (mutation === "copy" || mutation === "process-root") {
        const path = join(mutation === "copy" ? f.f.stateRoot : join(f.f.workspace, rebuildRuntimeIsolation.processLockRoot), "unexpected-copy");
        writeFileSync(path, "synthetic", { mode: 0o600 }); restore = () => unlinkSync(path);
      } else {
        const path = mutation === "key" ? join(f.f.machine.stateRoot, "machine", "credential-keys", `${f.profileId}.json`)
          : join(f.f.machine.stateRoot, "machine", "erasures", `${f.profileId}.json.authority`);
        if (mutation === "head" && !existsSync(path)) {
          writeFileSync(path, "{}", { mode: 0o600 }); restore = () => unlinkSync(path);
        } else {
          const retained = `${path}.retained`; renameSync(path, retained); copyFileSync(retained, path); restore = () => { unlinkSync(path); renameSync(retained, path); };
        }
      }
      mutated = true;
      return proof;
    } });
  const before = readFileSync(join(f.f.stateRoot, "credentials", "protected.json"));
  try {
    assert.throws(() => preparePendingLogoutInventory(store, operation));
    assert.equal(mutated, true, "actual canonical inventory must succeed before the injected mutation");
    assert.equal(readFileSync(join(f.f.stateRoot, "credentials", "protected.json")).equals(before), true);
    assert.equal(f.readOperation().commandId, undefined);
  } finally { restore?.(); f.close(); }
});

it("rejects a genuine live process record and an unavailable observation before any erase identity is captured", () => {
  const f = fixture(), operation = f.readOperation();
  const lock = acquireRuntimeProcessLock({ processLockRoot: join(f.f.workspace, rebuildRuntimeIsolation.processLockRoot), name: "workers", pid: process.pid,
    admission: { kind: "unbound-worker", authorityPath: f.f.path } }, f.clock);
  const kill = process.kill.bind(process);
  try {
    assert.throws(() => preparePendingLogoutInventory(f.store, operation), /process-custody-unproved/u);
    const observationFailure = new Error("synthetic OS observation unavailable");
    vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
      if (pid === process.pid && signal === 0) throw observationFailure;
      return kill(pid, signal);
    });
    assert.throws(() => preparePendingLogoutInventory(f.store, operation));
    assert.equal(f.readOperation().commandId, undefined);
  } finally { vi.restoreAllMocks(); lock.release(); f.close(); }
});


it("refuses a symlink at the actual saved browser root before erasure or database effects", () => {
  const f = fixture(), operation = f.readOperation(), facts = AuthorityDatabase.readProfileMaintenanceInventory(f.owner);
  const settings = facts.settingsAuthority.state === "never-initialized" ? initialSettingsFileRecord().settings
    : facts.settingsAuthority.record.saved?.settings ?? facts.settingsAuthority.record.initialization.settings.settings;
  const browserRoot = resolveConfigWithProvenance(settings, { primaryDisplay: null }, f.clock,
    { stateRoot: f.f.stateRoot, artifactRoot: f.owner.artifactRoot }).config.paths.browserProfileRoot;
  symlinkSync(join(f.f.stateRoot, "credentials"), browserRoot, "dir");
  try {
    assert.throws(() => preparePendingLogoutInventory(f.store, operation));
    assert.equal(f.readOperation().commandId, undefined);
  } finally {
    unlinkSync(browserRoot);
    assert.equal(AuthorityDatabase.readProfileMaintenanceInventory(f.owner).authorityGeneration, facts.authorityGeneration);
    f.close();
  }
});

it("refuses the unreleased process record of an actual exited child without inventing an idle owner", async () => {
  const f = fixture(), child = spawn(process.execPath, ["-e", "process.stdout.write('ready');setInterval(()=>{},1000)"], { stdio: ["ignore", "pipe", "pipe"] });
  let lock: ReturnType<typeof acquireRuntimeProcessLock> | undefined;
  try {
    await once(child.stdout, "data"); assert.ok(child.pid);
    lock = acquireRuntimeProcessLock({ processLockRoot: join(f.f.workspace, rebuildRuntimeIsolation.processLockRoot), name: "workers", pid: child.pid,
      admission: { kind: "unbound-worker", authorityPath: f.f.path } }, f.clock);
    const exited = once(child, "exit"); child.kill("SIGTERM"); await exited;
    assert.throws(() => preparePendingLogoutInventory(f.store, f.readOperation()), /process-custody-unproved/u);
    assert.equal(f.readOperation().commandId, undefined);
  } finally {
    if (child.exitCode === null && child.signalCode === null) { const exited = once(child, "exit"); child.kill("SIGTERM"); await exited; }
    lock?.release(); f.close();
  }
});
