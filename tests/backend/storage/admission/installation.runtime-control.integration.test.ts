import { randomUUID } from "node:crypto";
import { chmodSync,existsSync,linkSync,mkdirSync,readFileSync,rmSync,statSync,symlinkSync,unlinkSync,writeFileSync } from "node:fs";
import { dirname,join } from "node:path";
import { afterEach,expect,it } from "vitest";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { acquireInstallation,assertInstallationLease } from "../../../../src/backend/storage/admission/installation.js";
import { createInstallationControlTestWorld } from "../../../support/helpers/backend/installation-control-world.js";


const { fixture, adoptSynthetic, cleanup } = createInstallationControlTestWorld();

afterEach(cleanup);
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
  expect(shared.readInstallationContext()).toMatchObject({ workspace, locator: shared.locator });
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
  expect(() => acquireInstallation(workspace, "shared", lifetime)).toThrow(/generation/u);
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
