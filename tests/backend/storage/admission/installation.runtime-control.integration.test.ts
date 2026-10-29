import { AuthoritySourceClosureUnprovedError } from "../../../../src/backend/storage/source-closure.js";
import { boundProfileCredentials, createBoundProfileFixture } from '../../../support/helpers/admission-fixture.js';
import { storageTree } from '../../../support/helpers/integration/storage-recovery-fixture.js';
import type { RuntimeLifetimeLock } from "../../../../src/backend/storage/admission/lifetime-lock.js";
import { createInstallationControlTestWorld } from "../../../support/helpers/backend/installation-control-world.js";
import { randomUUID } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, linkSync, mkdirSync, readFileSync, readdirSync, renameSync, rmdirSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";

import { dirname, join } from "node:path";
import { afterEach, expect, it } from "vitest";

import { RuntimeAdmission, acquireRecoveryRuntimeRelocation } from "../../../../src/backend/storage/admission/admission.js";
import { ProfileStorageRelocationUnsupportedError } from "../../../../src/backend/storage/admission/admission-identity.js";
import { acquireInstallation, assertInstallationLease, inspectPendingRelocationRecovery, inspectPendingRelocationStatus, type ExclusiveInstallationLease, type RelocationPlanBinding, type RuntimePair } from "../../../../src/backend/storage/admission/installation.js";
import { createStorageRelocationPlanReader } from "../../../../src/backend/storage/maintenance/storage-relocation-plans.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";

import { storageRelocationDesiredDigest } from "../../../../src/rules/commands/commands.js";
import { CredentialEraseInputSchema } from "../../../../src/models/config/credential-store.js";
import { createCredentialPersistenceFixtures } from "../../../support/helpers/credential-persistence-fixtures.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH } from "../../../../src/models/config/protected-settings.js";
import { NonNegativeIntSchema } from "../../../../src/rules/identity/ids.js";


const { fixture, restore, adoptSynthetic, relocationPlan, prepareDestination, staged, cleanup } = createInstallationControlTestWorld();

afterEach(cleanup);
function currentProfileRelocationPlan(locator: ExclusiveInstallationLease['locator'], destination: RuntimePair): RelocationPlanBinding {
  return { commandId: "11111111-1111-4111-8111-111111111111", revision: 1, expectedRevision: 0,
    requestFingerprint: "a".repeat(64),
    desiredDigest: storageRelocationDesiredDigest({ installationId: locator.installationId,
      sourceGeneration: NonNegativeIntSchema.parse(locator.generation), sourcePair: { stateRoot: locator.stateRoot,
        artifactRoot: locator.artifactRoot }, expectedRevision: NonNegativeIntSchema.parse(0) }, destination) };
}

function currentProfileRelocationSnapshot(workspace: string) {
  const physical: { path: string; device: number; inode: number; mode: number; links: number }[] = [];
  const visit = (path: string): void => {
    const entry = statSync(path);
    physical.push({ path, device: entry.dev, inode: entry.ino, mode: entry.mode, links: entry.nlink });
    if (entry.isDirectory()) for (const name of readdirSync(path).sort()) visit(join(path, name));
  };
  visit(workspace);
  return { physical, bytes: storageTree(workspace) };
}

function settledMove(workspace: string, destination: RuntimePair, lifetime: RuntimeLifetimeLock): { operationId: string; locator: ExclusiveInstallationLease["locator"] } {
  const lease = acquireInstallation(workspace, "exclusive", lifetime);
  const held = restore(workspace);
  try {
    const plan = relocationPlan(lease, destination);
    const operationId = lease.beginRelocation(destination, plan, held);
    expect(lease.readPriorReceipts()).toHaveLength(lease.locator.generation);
    prepareDestination(lease, destination);
    const verify = staged(lease, destination, operationId, plan);
    lease.recordVerifiedStage(verify);
    lease.fenceRelocationSource();
    lease.retainRelocationSources();
    const locator = lease.switchRelocationLocator(verify);
    lease.settleRelocation(verify);
    return { operationId, locator };
  } finally { lease.release(); held.release(); }
}

it.each(["credential key", "erasure journal", "Duo membership"] as const)(
  "revalidates cached profile registry authority after %s changes",
  async (change) => {
    const persistence = createCredentialPersistenceFixtures([], randomUUID(), "2026-10-01T12:01:00.000Z");
    const erasure = change === "erasure journal" ? await persistence.registeredFixture() : undefined;
    const profile = erasure === undefined ? await createBoundProfileFixture() : {
      machine: erasure.machine, admission: erasure.admission, close: persistence.releaseFixtures,
    };
    try {
      if (erasure !== undefined) {
        expect(erasure.store.apply(persistence.request({
          commandId: randomUUID(), writeId: randomUUID(), expectedRevision: erasure.store.read().revision,
          entries: { ucpathPassword: { set: "synthetic-erasure-value" } },
        })).state).toBe("applied");
        expect(erasure.erase(CredentialEraseInputSchema.parse({
          commandId: randomUUID(), commandFingerprint: "b".repeat(64), writeId: randomUUID(),
          expectedRevision: erasure.store.read().revision, protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH,
          updatedAt: "2026-10-01T12:02:00.000Z",
        })).state).toBe("applied");
      }
      const registry = profile.machine.readProfileRegistry();
      expect(profile.machine.readProfileRegistry()).toEqual(registry);
      const id = profile.admission.profileBinding.profileId;
      const machine = join(profile.machine.stateRoot, "machine");
      const target = change === "credential key"
        ? join(machine, "credential-keys", `${id}.json`)
        : join(machine, "erasures", `${id}.json`);
      const duoDirectory = join(machine, "duo-credentials");
      const companion = join(duoDirectory, "unexpected-profile.json");
      const hadDuoDirectory = existsSync(duoDirectory);
      const authority = change === "Duo membership" ? undefined : { path: target, mode: statSync(target).mode & 0o777 };
      try {
        if (change === "Duo membership") {
          mkdirSync(duoDirectory, { recursive: true, mode: 0o700 });
          writeFileSync(companion, "{}", { mode: 0o600 });
        } else if (authority !== undefined) chmodSync(authority.path, 0o644);
        expect(() => profile.machine.readProfileRegistry()).toThrow();
      } finally {
        if (change === "Duo membership") {
          unlinkSync(companion);
          if (!hadDuoDirectory) rmdirSync(duoDirectory);
        } else if (authority !== undefined) chmodSync(authority.path, authority.mode);
      }
      expect(profile.machine.readProfileRegistry()).toEqual(registry);
    } finally { await profile.close(); }
  },
);

it("adopts empty defaults, admits shared readers, and refuses lost locator and owner mismatch", async () => {
  const { workspace, pair, lifetime } = await fixture();
  const first = adoptSynthetic(workspace, pair, lifetime);
  expect(() => assertInstallationLease({ assertHeld() { throw new Error("forged-held-check-must-not-run"); } })).toThrow(/unissued installation lease/u);
  assertInstallationLease(first);
  expect(first.locator.generation).toBe(0);
  expect(() => acquireInstallation(workspace, "shared", lifetime)).toThrow(/lease busy/u);
  first.release();
  expect(() => assertInstallationLease(first)).toThrow(/released/u);
  const one = acquireInstallation(workspace, "shared", lifetime);
  const two = acquireInstallation(workspace, "shared", lifetime);
  expect(one.locator).toEqual(two.locator);
  one.release(); two.release();
  const locator = join(workspace, ".tracker/control", "locator.json");
  unlinkSync(locator);
  expect(() => acquireInstallation(workspace, "exclusive", lifetime, { defaultPair: pair })).toThrow(/locator missing/u);
  expect(existsSync(join(pair.stateRoot, ".runtime-owner.json"))).toBe(true);
});

it("refuses fresh installation without both initializer and verifier before control writes", async () => {
  const { workspace, pair, lifetime } = await fixture();
  expect(() => acquireInstallation(workspace, "exclusive", lifetime, { defaultPair: pair })).toThrow(/requires initializer and verifier/u);
  expect(existsSync(join(workspace, ".tracker/control"))).toBe(false);
  expect(existsSync(pair.stateRoot)).toBe(false);
});

it("freezes issued leases and binds authority to the exact live root and unreleased capability", async () => {
  const { workspace, pair, lifetime } = await fixture();
  const first = adoptSynthetic(workspace, pair, lifetime);
  expect(Object.isFrozen(first)).toBe(true);
  expect(Reflect.set(first, "assertHeld", () => {})).toBe(false);
  const firstAdmission = RuntimeAdmission.fromInstallationLease(first);
  const lockRoot = join(workspace, ".tracker/data", "locks");
  expect(statSync(lockRoot).isDirectory()).toBe(true);
  firstAdmission.assertFixedProcessLockRoot(workspace, lockRoot);
  expect(() => firstAdmission.assertFixedProcessLockRoot(workspace, join(dirname(workspace), "other-locks"))).toThrow(/does not match installation/u);
  const installedPath = join(workspace, ".tracker/control", "installation.json");
  const installedBytes = readFileSync(installedPath);
  const installed = JSON.parse(installedBytes.toString("utf8")) as Record<string, unknown>;
  writeFileSync(installedPath, JSON.stringify({ ...installed, installationId: randomUUID() }));
  expect(() => firstAdmission.assertFixedProcessLockRoot(workspace, lockRoot)).toThrow(/installation changed/u);
  writeFileSync(installedPath, installedBytes);
  first.release();
  const shared = acquireInstallation(workspace, "shared", lifetime);
  expect(shared.readInstallationContext()).toMatchObject({ workspace, locator: shared.locator, receipts: [] });
  expect(Object.isFrozen(shared)).toBe(true);
  expect(Reflect.set(shared, "mode", "exclusive")).toBe(false);
  expect(Reflect.set(shared, "assertHeld", () => {})).toBe(false);
  const admission = RuntimeAdmission.fromInstallationLease(shared);
  expect(admission.lifetime).toBe(lifetime);
  expect(() => admission.assertExclusive()).toThrow(/exclusive offline admission required/u);
  expect(existsSync(join(workspace, ".tracker/control", "leases"))).toBe(false);
  const foreign = await fixture();
  const foreignLease = adoptSynthetic(foreign.workspace, foreign.pair, foreign.lifetime);
  expect(() => acquireInstallation(workspace, "shared", foreign.lifetime)).toThrow(/workspace-unproved/u);
  foreignLease.release();
  shared.assertHeld(); admission.assertLive();
  admission.release();
  expect(() => shared.assertHeld()).toThrow(/installation lease released/u);
  expect(() => admission.assertLive()).toThrow(/released/u);
  const next = acquireInstallation(workspace, "shared", lifetime);
  next.release();
  await lifetime.close();
  expect(() => next.assertHeld()).toThrow(/runtime authority has closed/u);
});

it("binds destination and retained source capabilities to one live relocation operation", async () => {
  let cleanup: () => void | Promise<void> = () => undefined;
  let primary: { error: unknown } | undefined = undefined;
  try {
    const profile = await createBoundProfileFixture();
    cleanup = async () => await profile.close();
    const destination = { stateRoot: join(profile.workspace, 'relocation-target'), artifactRoot: join(profile.workspace, 'relocation-target-artifacts') };
    const held = restore(profile.workspace);
    cleanup = async () => { held.release(); await profile.close(); };

    const before = currentProfileRelocationSnapshot(profile.workspace);
    const registry = profile.machine.readProfileRegistry();
    const source = AuthorityDatabase.inspectExistingReadOnly(profile.admission, profile.path);
    expect(() => profile.machine.beginRelocation(destination, currentProfileRelocationPlan(profile.machine.locator, destination), held))
      .toThrow(ProfileStorageRelocationUnsupportedError);
    expect(AuthorityDatabase.inspectExistingReadOnly(profile.admission, profile.path)).toEqual(source);
    expect(profile.machine.readProfileRegistry()).toEqual(registry);
    expect(currentProfileRelocationSnapshot(profile.workspace)).toEqual(before);
    expect(existsSync(destination.stateRoot)).toBe(false);
    expect(existsSync(destination.artifactRoot)).toBe(false);
    expect(inspectPendingRelocationStatus(profile.workspace)).toBeUndefined();
  } catch (error) { primary = { error }; }
  let cleanupFailure: { error: unknown } | undefined = undefined;
  try { await cleanup(); } catch (error) { cleanupFailure = { error }; }
  if (primary !== undefined) {
    if (cleanupFailure !== undefined) throw new AggregateError([primary.error, cleanupFailure.error], "profile-relocation-test-cleanup-failed", { cause: primary.error });
    throw primary.error;
  }
  if (cleanupFailure !== undefined) throw cleanupFailure.error;
});

it("recovers only the exact operation through a fresh held fixed restore lease", async () => {
  let cleanup: () => void | Promise<void> = () => undefined;
  let primary: { error: unknown } | undefined = undefined;
  try {
    const profile = await createBoundProfileFixture();
    cleanup = async () => await profile.close();
    const foreign = await createBoundProfileFixture();
    cleanup = async () => { await foreign.close(); await profile.close(); };
    const held = restore(foreign.workspace);
    cleanup = async () => { held.release(); await foreign.close(); await profile.close(); };
    const binding = { installationId: profile.machine.locator.installationId,
    fromGeneration: profile.machine.locator.generation, operationId: randomUUID() };
    profile.admission.release(); profile.machine.release();

    const before = currentProfileRelocationSnapshot(profile.workspace);
    const foreignBefore = currentProfileRelocationSnapshot(foreign.workspace);
    expect(() => acquireRecoveryRuntimeRelocation(profile.workspace, profile.lifetime, binding, held)).toThrow("restore-admission-handle-mismatch");
    expect(currentProfileRelocationSnapshot(profile.workspace)).toEqual(before);
    expect(currentProfileRelocationSnapshot(foreign.workspace)).toEqual(foreignBefore);
    expect(inspectPendingRelocationStatus(profile.workspace)).toBeUndefined();

    const currentHeld = restore(profile.workspace);
    cleanup = async () => { currentHeld.release(); held.release(); await foreign.close(); await profile.close(); };
    const lease = acquireInstallation(profile.workspace, "exclusive", profile.lifetime);
    cleanup = async () => { lease.release(); currentHeld.release(); held.release(); await foreign.close(); await profile.close(); };
    const { workspace: destinationWorkspace } = await fixture();
    const destination = { stateRoot: join(dirname(destinationWorkspace), "recovery-profile-state"),
      artifactRoot: join(dirname(destinationWorkspace), "recovery-profile-artifacts") };
    const plan = currentProfileRelocationPlan(lease.locator, destination);
    const operationId = lease.beginRelocation(destination, plan, currentHeld);
    const recoveryBinding = { installationId: lease.locator.installationId,
      fromGeneration: lease.locator.generation, operationId };
    lease.release();
    const recoveryBefore = currentProfileRelocationSnapshot(profile.workspace);
    const pendingBefore = inspectPendingRelocationStatus(profile.workspace);
    expect(pendingBefore).toMatchObject({ operationId, fromGeneration: recoveryBinding.fromGeneration });
    expect(() => acquireRecoveryRuntimeRelocation(profile.workspace, profile.lifetime, recoveryBinding, currentHeld))
      .toThrow(ProfileStorageRelocationUnsupportedError);
    expect(currentProfileRelocationSnapshot(profile.workspace)).toEqual(recoveryBefore);
    expect(inspectPendingRelocationStatus(profile.workspace)).toEqual(pendingBefore);
    expect(existsSync(destination.stateRoot)).toBe(false);
    expect(existsSync(destination.artifactRoot)).toBe(false);
    const reacquired = acquireInstallation(profile.workspace, "exclusive", profile.lifetime,
      { recoverRelocation: { ...recoveryBinding, restoreAdmission: currentHeld } });
    cleanup = async () => { reacquired.release(); currentHeld.release(); held.release(); await foreign.close(); await profile.close(); };
    reacquired.release();
    expect(currentProfileRelocationSnapshot(profile.workspace)).toEqual(recoveryBefore);
  } catch (error) { primary = { error }; }
  let cleanupFailure: { error: unknown } | undefined = undefined;
  try { await cleanup(); } catch (error) { cleanupFailure = { error }; }
  if (primary !== undefined) {
    if (cleanupFailure !== undefined) throw new AggregateError([primary.error, cleanupFailure.error], "profile-relocation-test-cleanup-failed", { cause: primary.error });
    throw primary.error;
  }
  if (cleanupFailure !== undefined) throw cleanupFailure.error;
});

it("does not silently re-adopt defaults after control is lost", async () => {
  const { workspace, pair, lifetime } = await fixture();
  const first = adoptSynthetic(workspace, pair, lifetime); first.release();
  rmSync(join(workspace, ".tracker/control"), { recursive: true });
  expect(() => acquireInstallation(workspace, "exclusive", lifetime, { defaultPair: pair })).toThrow(/existing ownership witness without locator/u);
});

it("refuses an unexplained v1 completed generation without a receipt chain", async () => {
  const { workspace, pair, lifetime } = await fixture();
  const first = adoptSynthetic(workspace, pair, lifetime); first.release();
  const path = join(workspace, ".tracker/control", "locator.json");
  const locator = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  writeFileSync(path, JSON.stringify({ ...locator, generation: 1 }));
  expect(() => acquireInstallation(workspace, "shared", lifetime)).toThrow(/active locator receipt chain mismatch/u);
});

it("binds the first real saved plan at applied revision one and expected revision zero", async () => {
  let cleanup: () => void | Promise<void> = () => undefined;
  let primary: { error: unknown } | undefined = undefined;
  try {
    const profile = await createBoundProfileFixture();
    cleanup = async () => await profile.close();
    let database: AuthorityDatabase;
    try { database = AuthorityDatabase.open(profile.admission, { path: profile.path,
    busyTimeoutMs: 250, migrationOwner: 'current-profile-relocation-preflight' }, undefined, undefined, undefined,
    undefined, boundProfileCredentials(profile.admission)); }
    catch (error) {
    if (error instanceof AuthoritySourceClosureUnprovedError) cleanup = () => { throw error; };
    throw error;
    }
    cleanup = async () => { database.close(); await profile.close(); };

    const registry = profile.machine.readProfileRegistry();
    const source = database.getMeta();
    const before = currentProfileRelocationSnapshot(profile.workspace);
    expect(() => createStorageRelocationPlanReader({ authority: database, admission: profile.admission,
      workspace: profile.workspace })).toThrow(ProfileStorageRelocationUnsupportedError);
    expect(database.getMeta()).toEqual(source);
    expect(profile.machine.readProfileRegistry()).toEqual(registry);
    expect(currentProfileRelocationSnapshot(profile.workspace)).toEqual(before);
    expect(inspectPendingRelocationStatus(profile.workspace)).toBeUndefined();
  } catch (error) { primary = { error }; }
  let cleanupFailure: { error: unknown } | undefined = undefined;
  try { await cleanup(); } catch (error) { cleanupFailure = { error }; }
  if (primary !== undefined) {
    if (cleanupFailure !== undefined) throw new AggregateError([primary.error, cleanupFailure.error], "profile-relocation-test-cleanup-failed", { cause: primary.error });
    throw primary.error;
  }
  if (cleanupFailure !== undefined) throw cleanupFailure.error;
});

it("claims destination roots for one operation and refuses foreign witnesses", async () => {
  let cleanup: () => void | Promise<void> = () => undefined;
  let primary: { error: unknown } | undefined = undefined;
  try {
    const profile = await createBoundProfileFixture();
    cleanup = async () => await profile.close();
    const held = restore(profile.workspace);
    cleanup = async () => { held.release(); await profile.close(); };
    const destination = { stateRoot: join(profile.workspace, 'released-relocation-target'), artifactRoot: join(profile.workspace, 'released-relocation-artifacts') };
    const plan = currentProfileRelocationPlan(profile.machine.locator, destination);
    profile.admission.release(); profile.machine.release();

    const before = currentProfileRelocationSnapshot(profile.workspace);
    expect(() => profile.machine.beginRelocation(destination, plan, held)).toThrow("runtime-admission: missing or released admission");
    expect(currentProfileRelocationSnapshot(profile.workspace)).toEqual(before);
    expect(existsSync(destination.stateRoot)).toBe(false);
    expect(existsSync(destination.artifactRoot)).toBe(false);
    expect(inspectPendingRelocationStatus(profile.workspace)).toBeUndefined();
  } catch (error) { primary = { error }; }
  let cleanupFailure: { error: unknown } | undefined = undefined;
  try { await cleanup(); } catch (error) { cleanupFailure = { error }; }
  if (primary !== undefined) {
    if (cleanupFailure !== undefined) throw new AggregateError([primary.error, cleanupFailure.error], "profile-relocation-test-cleanup-failed", { cause: primary.error });
    throw primary.error;
  }
  if (cleanupFailure !== undefined) throw cleanupFailure.error;
});

it("refuses a retained default-source fence after control and owner markers are lost", async () => {
  const { workspace, pair, lifetime } = await fixture();
  const first = adoptSynthetic(workspace, pair, lifetime); first.release();
  writeFileSync(join(pair.stateRoot, "state.db"), "valid synthetic authority");
  writeFileSync(join(pair.stateRoot, ".runtime-source-fence.json"), "synthetic retained fence", { mode: 0o600 });
  rmSync(join(workspace, ".tracker/control"), { recursive: true });
  unlinkSync(join(pair.stateRoot, ".runtime-owner.json"));
  unlinkSync(join(pair.artifactRoot, ".runtime-owner.json"));
  let verifierCalled = false;
  expect(() => acquireInstallation(workspace, "exclusive", lifetime, { defaultPair: pair, verifyExisting: (candidate) => {
    verifierCalled = true;
    return { kind: "verified-existing", pair: candidate, authorityGeneration: 0, databaseIdentity: "synthetic-database" };
  } })).toThrow(/retained source fence without locator/u);
  expect(verifierCalled).toBe(false);
  expect(existsSync(join(workspace, ".tracker/control", "installation.json"))).toBe(false);
});

it("requires typed validation for existing defaults and refuses interrupted adoption", async () => {
  const { workspace, pair, lifetime } = await fixture();
  mkdirSync(pair.stateRoot, { recursive: true, mode: 0o700 });
  writeFileSync(join(pair.stateRoot, "state.db"), "synthetic");
  expect(() => acquireInstallation(workspace, "exclusive", lifetime, { defaultPair: pair })).toThrow(/requires verifier/u);
  const lease = acquireInstallation(workspace, "exclusive", lifetime, { defaultPair: pair, verifyExisting: (candidate) => ({ kind: "verified-existing", pair: candidate, authorityGeneration: 0, databaseIdentity: "synthetic-identity" }) });
  lease.release();
  const journal = join(workspace, ".tracker/control", "journal.json");
  writeFileSync(journal, JSON.stringify({ schemaVersion: 1, phase: "adopting", installationId: lease.locator.installationId }), { mode: 0o600 });
  expect(() => acquireInstallation(workspace, "shared", lifetime)).toThrow(/unfinished adopting/u);
});

it("adopts owner-owned 0755 existing roots and preflights unsafe 0777 roots before recording installation", async () => {
  const valid = await fixture();
  mkdirSync(valid.pair.stateRoot, { recursive: true, mode: 0o755 });
  mkdirSync(valid.pair.artifactRoot, { mode: 0o755 });
  writeFileSync(join(valid.pair.stateRoot, "state.db"), "synthetic");
  const adopted = acquireInstallation(valid.workspace, "exclusive", valid.lifetime, { defaultPair: valid.pair, verifyExisting: (pair) => {
    expect(Object.isFrozen(pair)).toBe(true);
    return { kind: "verified-existing", pair, authorityGeneration: 3, databaseIdentity: "synthetic-database" };
  } });
  expect(adopted.locator.generation).toBe(0); adopted.release();
  const unsafe = await fixture();
  mkdirSync(unsafe.pair.stateRoot, { recursive: true, mode: 0o700 }); chmodSync(unsafe.pair.stateRoot, 0o777);
  expect(() => acquireInstallation(unsafe.workspace, "exclusive", unsafe.lifetime, { defaultPair: unsafe.pair })).toThrow(/unsafe data root/u);
  expect(existsSync(join(unsafe.workspace, ".tracker/control", "installation.json"))).toBe(false);
  expect(existsSync(join(unsafe.pair.stateRoot, ".runtime-owner.json"))).toBe(false);
});

it("rejects unsafe private files, root ownership, and invalid overlap", async () => {
  const { workspace, pair, lifetime } = await fixture();
  expect(() => acquireInstallation(workspace, "exclusive", lifetime, { defaultPair: { stateRoot: pair.stateRoot, artifactRoot: workspace } })).toThrow(/root|overlap|default/u);
  expect(() => acquireInstallation(workspace, "exclusive", lifetime, { defaultPair: { stateRoot: join(dirname(workspace), "other-state"), artifactRoot: join(dirname(workspace), "other-artifacts") } })).toThrow(/known default root pair/u);
  const lease = adoptSynthetic(workspace, pair, lifetime); lease.release();
  const exclusive = acquireInstallation(workspace, "exclusive", lifetime);
  const held = restore(workspace);
  const bad = { stateRoot: join(workspace, ".tracker/control", "new-state"), artifactRoot: join(dirname(workspace), "new-artifacts") };
  expect(() => exclusive.beginRelocation(bad, relocationPlan(exclusive, bad), held)).toThrow(/control overlaps/u);
  exclusive.release(); held.release();
  const locator = join(workspace, ".tracker/control", "locator.json");
  chmodSync(locator, 0o644);
  expect(() => acquireInstallation(workspace, "shared", lifetime)).toThrow(/unsafe file/u);
  chmodSync(locator, 0o600);
  const hardlink = join(dirname(workspace), "locator-hardlink"); linkSync(locator, hardlink);
  expect(() => acquireInstallation(workspace, "shared", lifetime)).toThrow(/unsafe file/u);
  unlinkSync(hardlink);
  const bytes = readFileSync(locator); unlinkSync(locator); symlinkSync(join(pair.stateRoot, ".runtime-owner.json"), locator);
  expect(() => acquireInstallation(workspace, "shared", lifetime)).toThrow(/unsafe file/u);
  unlinkSync(locator); writeFileSync(locator, bytes, { mode: 0o600 });
  const marker = join(pair.stateRoot, ".runtime-owner.json");
  const foreign = JSON.parse(readFileSync(marker, "utf8")) as Record<string, unknown>;
  foreign.installationId = "00000000-0000-4000-8000-000000000000";
  writeFileSync(marker, JSON.stringify(foreign));
  expect(() => acquireInstallation(workspace, "shared", lifetime)).toThrow(/root ownership mismatch/u);
});

it("moves both roots with a fixed lock shell, preserves source bytes, and binds a v2 receipt", async () => {
  const { workspace, pair, lifetime } = await fixture();
  const first = adoptSynthetic(workspace, pair, lifetime); first.release();
  writeFileSync(join(pair.stateRoot, "state.db"), "synthetic source authority");
  writeFileSync(join(pair.artifactRoot, "a.artifact"), "synthetic artifact");
  const lease = acquireInstallation(workspace, "exclusive", lifetime);
  expect(() => Object.assign(lease.locator, { generation: 99 })).toThrow(TypeError);
  const held = restore(workspace);
  const destination = { stateRoot: join(dirname(workspace), "new-state"), artifactRoot: join(dirname(workspace), "new-state", "artifacts") };
  const plan = relocationPlan(lease, destination);
  const operationId = lease.beginRelocation(destination, plan, held);
  destination.stateRoot = join(dirname(workspace), "mutated-state");
  const target = { stateRoot: join(dirname(workspace), "new-state"), artifactRoot: join(dirname(workspace), "new-state", "artifacts") };
  const journal = JSON.parse(readFileSync(join(workspace, ".tracker/control", "journal.json"), "utf8")) as { destination: RuntimePair };
  expect(journal.destination.stateRoot).toBe(target.stateRoot);
  expect(lease.locator.generation).toBe(0);
  prepareDestination(lease, target);
  const verify = staged(lease, target, operationId, plan);
  lease.recordVerifiedStage(verify);
  lease.fenceRelocationSource();
  lease.retainRelocationSources();
  const next = lease.switchRelocationLocator(verify);
  expect(next).toMatchObject({ schemaVersion: 2, generation: 1, stateRootGeneration: 1, artifactRootGeneration: 1 });
  lease.settleRelocation(verify);
  expect(() => lease.beginRelocation({ stateRoot: join(dirname(workspace), "third-state"), artifactRoot: join(dirname(workspace), "third-artifacts") }, plan, held)).toThrow(/one relocation per exclusive lease/u);
  lease.release(); held.release();
  expect(statSync(join(pair.stateRoot, "locks")).isDirectory()).toBe(true);
  expect(statSync(join(pair.stateRoot, "state.db")).isFile()).toBe(true);
  expect(readFileSync(join(pair.stateRoot, "state.db"), "utf8")).toContain("relocation-tombstone");
  expect(statSync(pair.artifactRoot).isFile()).toBe(true);
  const retained = join(workspace, ".tracker", `.data.retained-${operationId}-state`);
  expect(readFileSync(join(retained, "state.db"), "utf8")).toBe("synthetic source authority");
  expect(readFileSync(join(retained, "artifacts", "a.artifact"), "utf8")).toBe("synthetic artifact");
  const reader = acquireInstallation(workspace, "shared", lifetime);
  expect(reader.locator).toEqual(next);
  expect(reader.readRelocationReceipts()).toHaveLength(1);
  reader.release();
});

it("resumes fenced, retained, and switched journals only with an exact held restore admission", async () => {
  const { workspace, pair, lifetime } = await fixture();
  const initial = adoptSynthetic(workspace, pair, lifetime); initial.release();
  writeFileSync(join(pair.stateRoot, "state.db"), "synthetic source authority");
  writeFileSync(join(pair.artifactRoot, "a.artifact"), "synthetic artifact");
  const moving = acquireInstallation(workspace, "exclusive", lifetime);
  const held = restore(workspace);
  const destination = { stateRoot: join(dirname(workspace), "new-state"), artifactRoot: join(dirname(workspace), "new-artifacts") };
  const plan = relocationPlan(moving, destination);
  const operationId = moving.beginRelocation(destination, plan, held);
  prepareDestination(moving, destination);
  expect(() => moving.switchRelocationLocator(staged(moving, destination, operationId, plan))).toThrow(/retained source required/u);
  const verify = staged(moving, destination, operationId, plan);
  moving.recordVerifiedStage(verify);
  moving.fenceRelocationSource();
  expect(inspectPendingRelocationStatus(workspace)).toEqual({ operationId, phase: "fenced", fromGeneration: 0 });
  expect(existsSync(join(pair.stateRoot, ".runtime-source-fence.json"))).toBe(true);
  moving.release(); held.release();
  expect(() => acquireInstallation(workspace, "shared", lifetime)).toThrow(/unfinished fenced/u);
  const resumedHeld = restore(workspace);
  const request = { installationId: initial.locator.installationId, fromGeneration: 0, operationId, restoreAdmission: resumedHeld };
  expect(() => inspectPendingRelocationRecovery(workspace, randomUUID(), resumedHeld)).toThrow(/recovery operation binding mismatch/u);
  expect(inspectPendingRelocationRecovery(workspace, operationId, resumedHeld)).toEqual({
    installationId: initial.locator.installationId, fromGeneration: 0, operationId,
  });
  const resume = acquireInstallation(workspace, "exclusive", lifetime, { recoverRelocation: request });
  expect(() => inspectPendingRelocationRecovery(workspace, operationId, resumedHeld)).toThrow(/lease busy/u);
  resume.retainRelocationSources();
  expect(inspectPendingRelocationStatus(workspace)).toEqual({ operationId, phase: "retained", fromGeneration: 0 });
  const retainedJournal = readFileSync(join(workspace, ".tracker/control", "journal.json"));
  const next = resume.switchRelocationLocator(verify);
  expect(next.generation).toBe(1);
  resume.release(); resumedHeld.release();
  writeFileSync(join(workspace, ".tracker/control", "journal.json"), retainedJournal);
  expect(() => acquireInstallation(workspace, "shared", lifetime)).toThrow(/unfinished retained/u);
  const finalHeld = restore(workspace);
  const afterSwitchCrash = acquireInstallation(workspace, "exclusive", lifetime, { recoverRelocation: { ...request, restoreAdmission: finalHeld } });
  expect(afterSwitchCrash.switchRelocationLocator(verify)).toEqual(next);
  afterSwitchCrash.settleRelocation(verify);
  afterSwitchCrash.release(); finalHeld.release();
  expect(inspectPendingRelocationStatus(workspace)).toBeUndefined();
  const absentRestore = restore(workspace);
  expect(() => inspectPendingRelocationRecovery(workspace, operationId, absentRestore)).toThrow(/ENOENT|journal/u);
  absentRestore.release();
  const reader = acquireInstallation(workspace, "shared", lifetime);
  expect(reader.locator).toEqual(next); reader.release();
});

it("keeps the source fence as a negative witness if its journal is lost", async () => {
  const { workspace, pair, lifetime } = await fixture();
  const initial = adoptSynthetic(workspace, pair, lifetime); initial.release();
  writeFileSync(join(pair.stateRoot, "state.db"), "synthetic");
  writeFileSync(join(pair.artifactRoot, "a.artifact"), "synthetic");
  const moving = acquireInstallation(workspace, "exclusive", lifetime);
  const held = restore(workspace);
  const destination = { stateRoot: join(dirname(workspace), "moved-state"), artifactRoot: join(dirname(workspace), "moved-artifacts") };
  const plan = relocationPlan(moving, destination);
  const operationId = moving.beginRelocation(destination, plan, held);
  prepareDestination(moving, destination);
  moving.recordVerifiedStage(staged(moving, destination, operationId, plan));
  moving.fenceRelocationSource();
  moving.release(); held.release();
  unlinkSync(join(workspace, ".tracker/control", "journal.json"));
  expect(() => acquireInstallation(workspace, "shared", lifetime)).toThrow(/fenced source/u);
  expect(() => inspectPendingRelocationStatus(workspace)).toThrow(/fenced source/u);
});

it("moves artifacts alone without advancing the state marker epoch", async () => {
  const { workspace, pair, lifetime } = await fixture();
  const initial = adoptSynthetic(workspace, pair, lifetime); initial.release();
  writeFileSync(join(pair.stateRoot, "state.db"), "state remains");
  writeFileSync(join(pair.artifactRoot, "a.artifact"), "artifact remains");
  const destination = { stateRoot: pair.stateRoot, artifactRoot: join(dirname(workspace), "external-artifacts") };
  const result = settledMove(workspace, destination, lifetime);
  expect(result.locator).toMatchObject({ generation: 1, stateRootGeneration: 0, artifactRootGeneration: 1 });
  expect(readFileSync(join(pair.stateRoot, "state.db"), "utf8")).toBe("state remains");
  expect(statSync(pair.artifactRoot).isFile()).toBe(true);
  const retained = join(pair.stateRoot, `.artifacts.retained-${result.operationId}-artifact`);
  expect(readFileSync(join(retained, "a.artifact"), "utf8")).toBe("artifact remains");
  const reader = acquireInstallation(workspace, "shared", lifetime);
  expect(reader.readRelocationReceipts()).toHaveLength(1);
  reader.release();
});

it("pins prior artifact tombstone and retained witness when state moves later", async () => {
  const { workspace, pair, lifetime } = await fixture();
  const initial = adoptSynthetic(workspace, pair, lifetime); initial.release();
  writeFileSync(join(pair.stateRoot, "state.db"), "state source");
  writeFileSync(join(pair.artifactRoot, "a.artifact"), "artifact source");
  const first = settledMove(workspace, { stateRoot: pair.stateRoot, artifactRoot: join(dirname(workspace), "external-artifacts") }, lifetime);
  const oldRetained = join(pair.stateRoot, `.artifacts.retained-${first.operationId}-artifact`);
  const second = settledMove(workspace, { stateRoot: join(dirname(workspace), "moved-state"), artifactRoot: join(dirname(workspace), "external-artifacts") }, lifetime);
  expect(second.locator).toMatchObject({ generation: 2, stateRootGeneration: 2, artifactRootGeneration: 1 });
  expect(readFileSync(join(oldRetained, "a.artifact"), "utf8")).toBe("artifact source");
  expect(readFileSync(pair.artifactRoot, "utf8")).toContain("relocation-tombstone");
  const current = acquireInstallation(workspace, "shared", lifetime);
  const receipts = current.readRelocationReceipts();
  expect(receipts).toHaveLength(2);
  expect(receipts[1]?.pinnedEntries).toEqual([".artifacts.retained-" + first.operationId + "-artifact", "artifacts"]);
  current.release();
});

it("uses a witness shell after both roots move, artifacts move again, then state moves", async () => {
  const { workspace, pair, lifetime } = await fixture();
  const initial = adoptSynthetic(workspace, pair, lifetime); initial.release();
  writeFileSync(join(pair.stateRoot, "state.db"), "state source");
  writeFileSync(join(pair.artifactRoot, "a.artifact"), "artifact source");
  const firstState = join(dirname(workspace), "first-state");
  const firstArtifacts = join(firstState, "artifacts");
  settledMove(workspace, { stateRoot: firstState, artifactRoot: firstArtifacts }, lifetime);
  const second = settledMove(workspace, { stateRoot: firstState, artifactRoot: join(dirname(workspace), "second-artifacts") }, lifetime);
  const oldRetained = join(firstState, `.artifacts.retained-${second.operationId}-artifact`);
  const third = settledMove(workspace, { stateRoot: join(dirname(workspace), "third-state"), artifactRoot: join(dirname(workspace), "second-artifacts") }, lifetime);
  expect(third.locator).toMatchObject({ generation: 3, stateRootGeneration: 3, artifactRootGeneration: 2 });
  expect(statSync(firstState).isDirectory()).toBe(true);
  expect(readFileSync(join(firstState, "state.db"), "utf8")).toContain("relocation-tombstone");
  expect(readFileSync(firstArtifacts, "utf8")).toContain("relocation-tombstone");
  expect(readFileSync(join(oldRetained, "a.artifact"), "utf8")).toBe("artifact source");
  const current = acquireInstallation(workspace, "shared", lifetime);
  const receipts = current.readRelocationReceipts();
  expect(receipts).toHaveLength(3);
  expect(receipts[2]?.retentions.find((row) => row.role === "state")?.strategy).toBe("witness-shell");
  current.release();
});

it("moves state alone after artifacts are disjoint and retains per-root epochs", async () => {
  const { workspace, pair, lifetime } = await fixture();
  const initial = adoptSynthetic(workspace, pair, lifetime); initial.release();
  writeFileSync(join(pair.stateRoot, "state.db"), "state remains");
  writeFileSync(join(pair.artifactRoot, "a.artifact"), "artifact remains");
  const invalid = acquireInstallation(workspace, "exclusive", lifetime);
  const invalidRestore = restore(workspace);
  const stranded = { stateRoot: join(dirname(workspace), "stranded-state"), artifactRoot: pair.artifactRoot };
  expect(() => invalid.beginRelocation(stranded, relocationPlan(invalid, stranded), invalidRestore)).toThrow(/strand nested artifacts/u);
  invalid.release(); invalidRestore.release();
  const first = settledMove(workspace, { stateRoot: join(dirname(workspace), "first-state"), artifactRoot: join(dirname(workspace), "external-artifacts") }, lifetime);
  expect(first.locator).toMatchObject({ stateRootGeneration: 1, artifactRootGeneration: 1 });
  const second = settledMove(workspace, { stateRoot: join(dirname(workspace), "second-state"), artifactRoot: join(dirname(workspace), "external-artifacts") }, lifetime);
  expect(second.locator).toMatchObject({ generation: 2, stateRootGeneration: 2, artifactRootGeneration: 1 });
  expect(statSync(join(dirname(workspace), "first-state")).isFile()).toBe(true);
  expect(readFileSync(join(dirname(workspace), `.first-state.retained-${second.operationId}-state`, "state.db"), "utf8")).toBe("state remains");
  const reader = acquireInstallation(workspace, "shared", lifetime);
  expect(reader.readRelocationReceipts()).toHaveLength(2);
  reader.release();
});

it("recovers an interrupted lock-shell entry rename with its exact journal manifest", async () => {
  const { workspace, pair, lifetime } = await fixture();
  const initial = adoptSynthetic(workspace, pair, lifetime); initial.release();
  writeFileSync(join(pair.stateRoot, "state.db"), "old authority");
  writeFileSync(join(pair.artifactRoot, "a.artifact"), "old artifact");
  const lease = acquireInstallation(workspace, "exclusive", lifetime);
  const held = restore(workspace);
  const destination = { stateRoot: join(dirname(workspace), "new-state"), artifactRoot: join(dirname(workspace), "new-artifacts") };
  const plan = relocationPlan(lease, destination);
  const operationId = lease.beginRelocation(destination, plan, held);
  prepareDestination(lease, destination);
  const verify = staged(lease, destination, operationId, plan);
  lease.recordVerifiedStage(verify);
  lease.fenceRelocationSource();
  const control = join(workspace, ".tracker/control");
  const journalPath = join(control, "journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as Record<string, unknown>;
  writeFileSync(journalPath, JSON.stringify({ ...journal, phase: "retaining" }), { mode: 0o600 });
  const retained = join(workspace, ".tracker", `.data.retained-${operationId}-state`);
  mkdirSync(retained, { mode: 0o700 });
  copyFileSync(join(pair.stateRoot, ".runtime-owner.json"), join(retained, ".runtime-owner.json"));
  copyFileSync(join(pair.stateRoot, ".runtime-source-fence.json"), join(retained, ".runtime-source-fence.json"));
  renameSync(join(pair.stateRoot, "state.db"), join(retained, "state.db"));
  lease.release(); held.release();
  expect(() => acquireInstallation(workspace, "shared", lifetime)).toThrow(/unfinished retaining/u);
  const recoveredHeld = restore(workspace);
  const recovered = acquireInstallation(workspace, "exclusive", lifetime, { recoverRelocation: {
    installationId: initial.locator.installationId, fromGeneration: 0, operationId, restoreAdmission: recoveredHeld,
  } });
  recovered.retainRelocationSources();
  expect(readFileSync(join(pair.stateRoot, "state.db"), "utf8")).toContain("relocation-tombstone");
  recovered.switchRelocationLocator(verify);
  recovered.settleRelocation(verify);
  recovered.release(); recoveredHeld.release();
  const reader = acquireInstallation(workspace, "shared", lifetime);
  expect(reader.locator.generation).toBe(1); reader.release();
});

it("refuses tampered completed receipts and recreated retained sources", async () => {
  const { workspace, pair, lifetime } = await fixture();
  const initial = adoptSynthetic(workspace, pair, lifetime); initial.release();
  writeFileSync(join(pair.stateRoot, "state.db"), "old authority");
  writeFileSync(join(pair.artifactRoot, "a.artifact"), "old artifact");
  const result = settledMove(workspace, { stateRoot: pair.stateRoot, artifactRoot: join(dirname(workspace), "new-artifacts") }, lifetime);
  const receiptDirectory = join(workspace, ".tracker/control", "relocation-receipts");
  const receiptPath = join(receiptDirectory, readdirSync(receiptDirectory)[0]);
  const bytes = readFileSync(receiptPath);
  const receipt = JSON.parse(bytes.toString()) as Record<string, unknown>;
  writeFileSync(receiptPath, JSON.stringify({ ...receipt, operationId: "33333333-3333-4333-8333-333333333333" }));
  expect(() => acquireInstallation(workspace, "shared", lifetime)).toThrow(/receipt chain mismatch/u);
  writeFileSync(receiptPath, bytes);
  unlinkSync(pair.artifactRoot);
  mkdirSync(pair.artifactRoot, { mode: 0o700 });
  expect(() => acquireInstallation(workspace, "shared", lifetime)).toThrow(/tombstone|unsafe/u);
  if (result.locator.schemaVersion !== 2) throw new Error("expected v2 locator");
  expect(result.locator.artifactRootGeneration).toBe(1);
});

it("refuses a missing retained source after a completed move", async () => {
  const { workspace, pair, lifetime } = await fixture();
  const initial = adoptSynthetic(workspace, pair, lifetime); initial.release();
  writeFileSync(join(pair.stateRoot, "state.db"), "source");
  writeFileSync(join(pair.artifactRoot, "a.artifact"), "artifact");
  const moved = settledMove(workspace, { stateRoot: pair.stateRoot, artifactRoot: join(dirname(workspace), "new-artifacts") }, lifetime);
  rmSync(join(pair.stateRoot, `.artifacts.retained-${moved.operationId}-artifact`), { recursive: true });
  expect(() => acquireInstallation(workspace, "shared", lifetime)).toThrow(/retained|unsafe|ENOENT/u);
});

it("reads only prior receipts when first and later operations publish their own receipt before journal clear", async () => {
  const { workspace, pair, lifetime } = await fixture();
  const initial = adoptSynthetic(workspace, pair, lifetime); initial.release();
  writeFileSync(join(pair.stateRoot, "state.db"), "source");
  writeFileSync(join(pair.artifactRoot, "a.artifact"), "artifact");
  const lease = acquireInstallation(workspace, "exclusive", lifetime);
  const held = restore(workspace);
  const destination = { stateRoot: pair.stateRoot, artifactRoot: join(dirname(workspace), "new-artifacts") };
  const plan = relocationPlan(lease, destination);
  const operationId = lease.beginRelocation(destination, plan, held);
  prepareDestination(lease, destination);
  const verify = staged(lease, destination, operationId, plan);
  lease.recordVerifiedStage(verify);
  lease.fenceRelocationSource();
  lease.retainRelocationSources();
  lease.switchRelocationLocator(verify);
  const control = join(workspace, ".tracker/control");
  const journalBytes = readFileSync(join(control, "journal.json"));
  lease.settleRelocation(verify);
  const receipts = readdirSync(join(control, "relocation-receipts"));
  expect(receipts).toHaveLength(1);
  lease.release(); held.release();
  writeFileSync(join(control, "journal.json"), journalBytes, { mode: 0o600 });
  expect(() => acquireInstallation(workspace, "shared", lifetime)).toThrow(/unfinished switched/u);
  const resumedHeld = restore(workspace);
  const resumed = acquireInstallation(workspace, "exclusive", lifetime, { recoverRelocation: {
    installationId: initial.locator.installationId, fromGeneration: 0, operationId, restoreAdmission: resumedHeld,
  } });
  expect(resumed.readPriorReceipts()).toEqual([]);
  resumed.settleRelocation(verify);
  resumed.release(); resumedHeld.release();
  expect(readdirSync(join(control, "relocation-receipts"))).toEqual(receipts);
  expect(existsSync(join(control, "journal.json"))).toBe(false);

  const later = acquireInstallation(workspace, "exclusive", lifetime);
  const laterHeld = restore(workspace);
  const laterDestination = { stateRoot: join(dirname(workspace), "later-state"), artifactRoot: destination.artifactRoot };
  const laterPlan = relocationPlan(later, laterDestination);
  const laterOperationId = later.beginRelocation(laterDestination, laterPlan, laterHeld);
  expect(later.readPriorReceipts()).toHaveLength(1);
  prepareDestination(later, laterDestination);
  const laterVerify = staged(later, laterDestination, laterOperationId, laterPlan);
  later.recordVerifiedStage(laterVerify);
  later.fenceRelocationSource();
  later.retainRelocationSources();
  later.switchRelocationLocator(laterVerify);
  const laterJournalBytes = readFileSync(join(control, "journal.json"));
  later.settleRelocation(laterVerify);
  later.release(); laterHeld.release();
  writeFileSync(join(control, "journal.json"), laterJournalBytes, { mode: 0o600 });
  const laterResumedHeld = restore(workspace);
  const laterResumed = acquireInstallation(workspace, "exclusive", lifetime, { recoverRelocation: {
    installationId: initial.locator.installationId, fromGeneration: 1, operationId: laterOperationId,
    restoreAdmission: laterResumedHeld,
  } });
  expect(laterResumed.readPriorReceipts().map((receipt) => receipt.operationId)).toEqual([operationId]);
  laterResumed.settleRelocation(laterVerify);
  laterResumed.release(); laterResumedHeld.release();
});
