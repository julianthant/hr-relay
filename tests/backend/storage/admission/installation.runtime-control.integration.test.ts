import { createInstallationControlTestWorld } from "../../../support/helpers/backend/installation-control-world.js";
import { randomUUID } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { executeStorageRelocationCommand } from "../../../../src/backend/runs/commands/command-kernel.js";
import { RuntimeAdmission, acquireRecoveryRuntimeRelocation } from "../../../../src/backend/storage/admission/admission.js";
import { acquireInstallation, inspectPendingRelocationRecovery, inspectPendingRelocationStatus, type ExclusiveInstallationLease, type RelocationPlanBinding, type RuntimePair } from "../../../../src/backend/storage/admission/installation.js";
import { createStorageRelocationPlanReader, projectStorageRelocationPlanHistory } from "../../../../src/backend/storage/maintenance/storage-relocation-plans.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../../../src/backend/storage/sqlite/migrations.js";
import { StorageRelocationCommandRequestSchema, storageRelocationDesiredDigest, storageRelocationRequestFingerprint } from "../../../../src/rules/commands/commands.js";
import { NonNegativeIntSchema } from "../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../src/rules/time/clock.js";

const { workspaces, fixture, restore, adoptSynthetic, relocationPlan, prepareDestination, staged, cleanup } = createInstallationControlTestWorld();

afterEach(cleanup);
function settledMove(workspace: string, destination: RuntimePair): { operationId: string; locator: ExclusiveInstallationLease["locator"] } {
  const lease = acquireInstallation(workspace, "exclusive");
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

it("adopts empty defaults, admits shared readers, and refuses lost locator and owner mismatch", () => {
  const { workspace, pair } = fixture();
  const first = adoptSynthetic(workspace, pair);
  expect(first.locator.generation).toBe(0);
  expect(() => acquireInstallation(workspace, "shared")).toThrow(/lease busy/u);
  first.release();
  const one = acquireInstallation(workspace, "shared");
  const two = acquireInstallation(workspace, "shared");
  expect(one.locator).toEqual(two.locator);
  one.release(); two.release();
  const locator = join(workspace, ".tracker/control", "locator.json");
  unlinkSync(locator);
  expect(() => acquireInstallation(workspace, "exclusive", { defaultPair: pair })).toThrow(/locator missing/u);
  expect(existsSync(join(pair.stateRoot, ".runtime-owner.json"))).toBe(true);
});

it("refuses fresh installation without both initializer and verifier before control writes", () => {
  const { workspace, pair } = fixture();
  expect(() => acquireInstallation(workspace, "exclusive", { defaultPair: pair })).toThrow(/requires initializer and verifier/u);
  expect(existsSync(join(workspace, ".tracker/control"))).toBe(false);
  expect(existsSync(pair.stateRoot)).toBe(false);
});

it("freezes issued leases and refuses a changed on-disk lease mode", () => {
  const { workspace, pair } = fixture();
  const first = adoptSynthetic(workspace, pair);
  expect(Object.isFrozen(first)).toBe(true);
  expect(Reflect.set(first, "assertHeld", () => {})).toBe(false);
  const firstAdmission = RuntimeAdmission.fromInstallationLease(first);
  const lockRoot = join(workspace, ".tracker/data", "locks");
  mkdirSync(lockRoot, { mode: 0o700 });
  firstAdmission.assertFixedProcessLockRoot(workspace, lockRoot);
  expect(() => firstAdmission.assertFixedProcessLockRoot(workspace, join(dirname(workspace), "other-locks"))).toThrow(/does not match installation/u);
  const installedPath = join(workspace, ".tracker/control", "installation.json");
  const installedBytes = readFileSync(installedPath);
  const installed = JSON.parse(installedBytes.toString("utf8")) as Record<string, unknown>;
  writeFileSync(installedPath, JSON.stringify({ ...installed, installationId: randomUUID() }));
  expect(() => firstAdmission.assertFixedProcessLockRoot(workspace, lockRoot)).toThrow(/installation changed/u);
  writeFileSync(installedPath, installedBytes);
  first.release();
  const shared = acquireInstallation(workspace, "shared");
  expect(shared.readInstallationContext()).toMatchObject({ workspace, locator: shared.locator, receipts: [] });
  expect(Object.isFrozen(shared)).toBe(true);
  expect(Reflect.set(shared, "mode", "exclusive")).toBe(false);
  expect(Reflect.set(shared, "assertHeld", () => {})).toBe(false);
  const admission = RuntimeAdmission.fromInstallationLease(shared);
  expect(() => admission.assertExclusive()).toThrow(/exclusive offline admission required/u);
  const leasePath = join(workspace, ".tracker/control", "leases", readdirSync(join(workspace, ".tracker/control", "leases"))[0]);
  const original = readFileSync(leasePath);
  const parsed = JSON.parse(original.toString("utf8")) as Record<string, unknown>;
  writeFileSync(leasePath, JSON.stringify({ ...parsed, mode: "exclusive" }));
  expect(() => admission.assertLive()).toThrow(/lease identity changed/u);
  writeFileSync(leasePath, original);
  admission.release();
});

it("binds destination and retained source capabilities to one live relocation operation", () => {
  const { workspace, pair } = fixture();
  const first = adoptSynthetic(workspace, pair); first.release();
  expect(inspectPendingRelocationStatus(workspace)).toBeUndefined();
  writeFileSync(join(pair.stateRoot, "state.db"), "synthetic source authority");
  writeFileSync(join(pair.artifactRoot, "a.artifact"), "synthetic artifact");
  const lease = acquireInstallation(workspace, "exclusive");
  const admission = RuntimeAdmission.fromInstallationLease(lease);
  const held = restore(workspace);
  const destination = { stateRoot: join(dirname(workspace), "new-state"), artifactRoot: join(dirname(workspace), "new-artifacts") };
  const plan = relocationPlan(lease, destination);
  const syntheticWorkspace = realpathSync(mkdtempSync(join(tmpdir(), "runtime-synthetic-")));
  workspaces.push(syntheticWorkspace);
  const syntheticState = join(syntheticWorkspace, "state");
  const syntheticArtifacts = join(syntheticWorkspace, "artifacts");
  mkdirSync(syntheticState); mkdirSync(syntheticArtifacts);
  const synthetic = RuntimeAdmission.syntheticRoots(syntheticState, syntheticArtifacts);
  expect(synthetic.readInstallationContext()).toBeUndefined();
  expect(() => synthetic.beginRelocation(destination, plan, held)).toThrow(/exclusive installation (relocation )?authority/u);
  synthetic.release();
  const operation = admission.beginRelocation(destination, plan, held);
  expect(() => admission.readInstallationContext()).toThrow(/pending relocation/u);
  expect(() => operation.destinationAdmission().readInstallationContext()).toThrow(/installation context authority/u);
  expect(operation.verifiedSourceControlEntries()).toMatchObject({ source: pair,
    state: [".runtime-owner.json", "locks"], artifact: [".runtime-owner.json"] });
  expect(operation.inventory()).toMatchObject({ operationId: operation.operationId, source: pair, destination, plan, phase: "preparing" });
  expect(operation.inventory().evidence).toBeUndefined();
  expect(operation.readPriorReceipts()).toHaveLength(0);
  const child = operation.destinationAdmission();
  expect(child.stateRoot).toBe(destination.stateRoot);
  expect(child.artifactRoot).toBe(destination.artifactRoot);
  expect(() => operation.sourceVerificationAdmission()).toThrow(/fully retained source required/u);
  prepareDestination(lease, destination);
  child.assertAuthorityDatabase(join(destination.stateRoot, "state.db"));
  expect(() => child.assertAuthorityDatabase(":memory:")).toThrow(/outside admission/u);
  expect(() => child.assertAuthorityDatabase(join(pair.stateRoot, "state.db"))).toThrow(/outside admission/u);
  expect(() => operation.recordVerifiedStage(() => { throw new Error("stage verifier must not run"); }))
    .toThrow(/activation intent required/u);
  const verify = staged(lease, destination, operation.operationId, plan);
  const preparation = operation.inventory().preparation;
  const activationIntent = operation.inventory().activationIntent;
  if (activationIntent === undefined) throw new Error("activation intent missing");
  expect(operation.inventory().phase).toBe("activating");
  expect(operation.inventory().evidence).toBeUndefined();
  operation.recordActivationIntent(() => activationIntent);
  expect(() => operation.recordActivationIntent(() => ({ ...activationIntent,
    managedInventoryDigest: "f".repeat(64) }))).toThrow(/activation intent changed/u);
  expect(preparation).toMatchObject({ sourceSchemaVersion: CURRENT_AUTHORITY_SCHEMA_VERSION, backupManifestSha256: "1".repeat(64),
    backupFileSha256: "2".repeat(64) });
  if (preparation === undefined) throw new Error("preparation missing");
  operation.recordVerifiedPreparation(() => preparation);
  expect(() => operation.recordVerifiedPreparation(() => ({ ...preparation,
    backupManifestSha256: "3".repeat(64) }))).toThrow(/verified preparation changed/u);
  operation.recordVerifiedStage(verify);
  const stagedEvidence = verify();
  expect(operation.inventory().evidence).toEqual(stagedEvidence);
  expect(Object.isFrozen(operation.inventory().evidence?.managedStateEntries)).toBe(true);
  operation.fenceRelocationSource();
  expect(operation.inventory().evidence).toEqual(stagedEvidence);
  expect(operation.verifiedSourceControlEntries().artifact).toContain(".runtime-source-fence.json");
  operation.retainRelocationSources();
  expect(operation.inventory().evidence).toEqual(stagedEvidence);
  const source = operation.sourceVerificationAdmission();
  expect(operation.verifiedSourceControlEntries().source).toEqual({
    stateRoot: source.stateRoot, artifactRoot: source.artifactRoot,
  });
  expect(source.stateRoot).toBe(join(workspace, ".tracker", `.data.retained-${operation.operationId}-state`));
  expect(source.artifactRoot).toBe(join(source.stateRoot, "artifacts"));
  source.assertStateRoot(join(source.stateRoot, "state.db"));
  source.assertArtifactRoot(join(source.artifactRoot, "a.artifact"));
  expect(() => source.assertWritable()).toThrow(/read-only/u);
  expect(() => source.assertReadOnlyAuthorityDatabase(join(source.stateRoot, "state.db"))).toThrow(/authority unavailable/u);
  held.release();
  expect(() => operation.inventory()).toThrow(/restore-admission|restore admission|ENOENT/u);
  expect(() => operation.readPriorReceipts()).toThrow(/restore-admission|restore admission|ENOENT/u);
  expect(() => child.assertLive()).toThrow(/restore-admission|restore admission|ENOENT/u);
  expect(() => source.assertLive()).toThrow(/restore-admission|restore admission|ENOENT/u);
  admission.release();
});

it("recovers only the exact operation through a fresh held fixed restore lease", () => {
  const { workspace, pair } = fixture();
  const first = adoptSynthetic(workspace, pair); first.release();
  writeFileSync(join(pair.stateRoot, "state.db"), "synthetic source authority");
  writeFileSync(join(pair.artifactRoot, "a.artifact"), "synthetic artifact");
  const lease = acquireInstallation(workspace, "exclusive");
  const admission = RuntimeAdmission.fromInstallationLease(lease);
  const held = restore(workspace);
  const destination = { stateRoot: join(dirname(workspace), "new-state"), artifactRoot: join(dirname(workspace), "new-artifacts") };
  const operation = admission.beginRelocation(destination, relocationPlan(lease, destination), held);
  prepareDestination(lease, destination);
  staged(lease, destination, operation.operationId, operation.inventory().plan);
  const originalPreparation = operation.inventory().preparation;
  const originalEvidence = operation.inventory().evidence;
  if (originalPreparation === undefined) throw new Error("preparation missing");
  const binding = { installationId: lease.locator.installationId, fromGeneration: lease.locator.generation, operationId: operation.operationId };
  admission.release(); held.release();
  const resumedHeld = restore(workspace);
  const journalPath = join(workspace, ".tracker/control", "journal.json");
  const originalJournal = readFileSync(journalPath, "utf8");
  const changedJournal = JSON.parse(originalJournal) as Record<string, unknown>;
  const originalIntent = changedJournal.activationIntent as Record<string, unknown>;
  const originalSnapshot = originalIntent.snapshot as Record<string, unknown>;
  const originalConfig = originalSnapshot.config as Record<string, unknown>;
  writeFileSync(journalPath, JSON.stringify({ ...changedJournal, activationIntent: { ...originalIntent,
    snapshot: { ...originalSnapshot, config: { ...originalConfig, paths: {
      ...(originalConfig.paths as Record<string, unknown>), artifactRoot: join(dirname(workspace), "changed") } } } } }));
  expect(() => inspectPendingRelocationRecovery(workspace, operation.operationId, resumedHeld))
    .toThrow(/config-snapshot-fingerprint-mismatch/u);
  expect(() => inspectPendingRelocationStatus(workspace)).toThrow(/config-snapshot-fingerprint-mismatch/u);
  writeFileSync(journalPath, originalJournal);
  expect(() => acquireRecoveryRuntimeRelocation(workspace, { ...binding, operationId: randomUUID() }, resumedHeld)).toThrow(/recovery|operation/u);
  const recovered = acquireRecoveryRuntimeRelocation(workspace, binding, resumedHeld);
  expect(recovered.operation.inventory().destination).toEqual(destination);
  expect(recovered.operation.inventory().preparation).toEqual(originalPreparation);
  expect(recovered.operation.inventory().evidence).toEqual(originalEvidence);
  recovered.operation.recordVerifiedPreparation(() => originalPreparation);
  expect(() => recovered.operation.recordVerifiedPreparation(() => ({ ...originalPreparation,
    backupFileSha256: "4".repeat(64) }))).toThrow(/verified preparation changed/u);
  const child = recovered.operation.destinationAdmission();
  recovered.admission.release();
  expect(() => child.assertLive()).toThrow(/released admission/u);
  resumedHeld.release();
});

it("does not silently re-adopt defaults after control is lost", () => {
  const { workspace, pair } = fixture();
  const first = adoptSynthetic(workspace, pair); first.release();
  rmSync(join(workspace, ".tracker/control"), { recursive: true });
  expect(() => acquireInstallation(workspace, "exclusive", { defaultPair: pair })).toThrow(/existing ownership witness without locator/u);
});

it("refuses an unexplained v1 completed generation without a receipt chain", () => {
  const { workspace, pair } = fixture();
  const first = adoptSynthetic(workspace, pair); first.release();
  const path = join(workspace, ".tracker/control", "locator.json");
  const locator = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  writeFileSync(path, JSON.stringify({ ...locator, generation: 1 }));
  expect(() => acquireInstallation(workspace, "shared")).toThrow(/active locator receipt chain mismatch/u);
});

it("binds the first real saved plan at applied revision one and expected revision zero", () => {
  const { workspace, pair } = fixture();
  const adopted = RuntimeAdmission.acquireInitial(workspace, (candidate, inspection) => {
    const path = join(candidate.stateRoot, "state.db");
    const inspected = AuthorityDatabase.inspectExistingReadOnly(inspection, path);
    return { kind: "verified-existing", pair: candidate, authorityGeneration: inspected.authorityGeneration,
      databaseIdentity: AuthorityDatabase.sourceDatabaseIdentity(path) };
  }, (candidate, initialization) => {
    const database = AuthorityDatabase.open(initialization, { path: join(candidate.stateRoot, "state.db"),
      busyTimeoutMs: 250, migrationOwner: "unit-test" });
    try {
      expect(() => database.withAuthorityTransaction(() => database.authority.commands.assertIdentity({
        family: "worker-browser", type: "plan-worker-count", commandId: randomUUID(),
        requestedAt: "2026-09-26T12:00:00.000Z", requestedBy: "local-operator", source: "dashboard",
        target: { workflowId: "person-lookup", expectedVersion: 0 }, payload: { desiredWorkers: 1 },
      }))).toThrow(/fresh initialization path is outside database authority/u);
      expect(existsSync(join(candidate.stateRoot, "credentials"))).toBe(false);
      expect(existsSync(join(candidate.stateRoot, "credential-erasures"))).toBe(false);
    } finally { database.close(); }
  });
  adopted.release();
  const planning = acquireInstallation(workspace, "shared");
  const clock = manualClock(new Date("2026-09-26T12:00:00.000Z"));
  const admission = RuntimeAdmission.fromInstallationLease(planning);
  const database = AuthorityDatabase.open(admission, { path: join(pair.stateRoot, "state.db"),
    busyTimeoutMs: 250, migrationOwner: "unit-test" }, clock);
  const producer = createStorageRelocationPlanReader({ authority: database, admission, workspace });
  const destinationRoot = fixture().workspace;
  const destination = { stateRoot: join(destinationRoot, "planned-state"), artifactRoot: join(destinationRoot, "planned-artifacts") };
  const request = StorageRelocationCommandRequestSchema.parse({ family: "storage-relocation",
    type: "plan-storage-relocation", commandId: randomUUID(), requestedAt: clock.now().toISOString(),
    requestedBy: "local-operator", source: "settings-surface",
    target: { installationId: planning.locator.installationId, sourceGeneration: 0, sourcePair: pair, expectedRevision: 0 },
    payload: { writeId: randomUUID(), desiredPair: destination, desiredDigest: storageRelocationDesiredDigest({
      installationId: planning.locator.installationId, sourceGeneration: NonNegativeIntSchema.parse(0),
      sourcePair: pair, expectedRevision: NonNegativeIntSchema.parse(0) }, destination),
      requestFingerprint: "0".repeat(64) } });
  if (request.type !== "plan-storage-relocation") throw new Error("expected plan");
  const signed = StorageRelocationCommandRequestSchema.parse({ ...request,
    payload: { ...request.payload, requestFingerprint: storageRelocationRequestFingerprint(request) } });
  expect(executeStorageRelocationCommand({ authority: database, clock, ids: { uuid: randomUUID },
    storageRelocationPlans: producer }, signed)).toMatchObject({ state: "applied" });
  const view = producer.read();
  expect(view.revision).toBe(1);
  expect(view.pending?.commandId).toBe(request.commandId);
  expect(projectStorageRelocationPlanHistory(database.authority, planning.locator, [], workspace)).toEqual(view);
  expect(() => projectStorageRelocationPlanHistory(database.authority,
    { ...planning.locator, generation: 1 }, [], workspace)).toThrow(/projected plan epoch differs/u);
  database.close(); planning.release();
  const lease = acquireInstallation(workspace, "exclusive");
  const held = restore(workspace);
  const binding: RelocationPlanBinding = { commandId: request.commandId, revision: view.revision,
    expectedRevision: request.target.expectedRevision, requestFingerprint: view.pending?.requestFingerprint ?? "",
    desiredDigest: view.pending?.desiredDigest ?? "" };
  expect(lease.beginRelocation(destination, binding, held)).toMatch(/^[0-9a-f-]{36}$/u);
  lease.release(); held.release();
});

it("claims destination roots for one operation and refuses foreign witnesses", () => {
  const { workspace, pair } = fixture();
  const initial = adoptSynthetic(workspace, pair); initial.release();
  const lease = acquireInstallation(workspace, "exclusive");
  const held = restore(workspace);
  const destination = { stateRoot: join(dirname(workspace), "next-state"), artifactRoot: join(dirname(workspace), "next-state", "artifacts") };
  const operationId = lease.beginRelocation(destination, relocationPlan(lease, destination), held);
  mkdirSync(destination.stateRoot);
  writeFileSync(join(destination.stateRoot, "foreign"), "unrelated");
  expect(() => lease.prepareDestinationRoots()).toThrow(/unowned (nested )?destination content/u);
  unlinkSync(join(destination.stateRoot, "foreign"));
  lease.prepareDestinationRoots();
  const stateMarkerPath = join(destination.stateRoot, ".runtime-owner.json");
  const artifactMarkerPath = join(destination.artifactRoot, ".runtime-owner.json");
  const stateMarker = readFileSync(stateMarkerPath, "utf8");
  expect(JSON.parse(stateMarker)).toMatchObject({ schemaVersion: 2, operationId, role: "state" });
  expect(JSON.parse(readFileSync(artifactMarkerPath, "utf8"))).toMatchObject({ schemaVersion: 2, operationId, role: "artifact" });
  lease.prepareDestinationRoots();
  unlinkSync(artifactMarkerPath);
  lease.prepareDestinationRoots();
  writeFileSync(stateMarkerPath, JSON.stringify({ ...JSON.parse(stateMarker) as Record<string, unknown>, operationId: randomUUID() }));
  expect(() => lease.prepareDestinationRoots()).toThrow(/destination marker operation mismatch/u);
  writeFileSync(stateMarkerPath, stateMarker);
  const sourceMarkerPath = join(pair.stateRoot, ".runtime-owner.json");
  const sourceMarker = readFileSync(sourceMarkerPath, "utf8");
  writeFileSync(sourceMarkerPath, JSON.stringify({ ...JSON.parse(sourceMarker) as Record<string, unknown>, role: "artifact" }));
  expect(() => lease.verifiedSourceControlEntries()).toThrow(/root ownership mismatch/u);
  writeFileSync(sourceMarkerPath, sourceMarker);
  expect(lease.verifiedSourceControlEntries().state).toContain(".runtime-owner.json");
  held.release();
  expect(() => lease.prepareDestinationRoots()).toThrow(/restore admission|ENOENT/u);
  lease.release();
});

it("refuses a retained default-source fence after control and owner markers are lost", () => {
  const { workspace, pair } = fixture();
  const first = adoptSynthetic(workspace, pair); first.release();
  writeFileSync(join(pair.stateRoot, "state.db"), "valid synthetic authority");
  writeFileSync(join(pair.stateRoot, ".runtime-source-fence.json"), "synthetic retained fence", { mode: 0o600 });
  rmSync(join(workspace, ".tracker/control"), { recursive: true });
  unlinkSync(join(pair.stateRoot, ".runtime-owner.json"));
  unlinkSync(join(pair.artifactRoot, ".runtime-owner.json"));
  let verifierCalled = false;
  expect(() => acquireInstallation(workspace, "exclusive", { defaultPair: pair, verifyExisting: (candidate) => {
    verifierCalled = true;
    return { kind: "verified-existing", pair: candidate, authorityGeneration: 0, databaseIdentity: "synthetic-database" };
  } })).toThrow(/retained source fence without locator/u);
  expect(verifierCalled).toBe(false);
  expect(existsSync(join(workspace, ".tracker/control", "installation.json"))).toBe(false);
});

it("requires typed validation for existing defaults and refuses interrupted adoption", () => {
  const { workspace, pair } = fixture();
  mkdirSync(pair.stateRoot, { recursive: true, mode: 0o700 });
  writeFileSync(join(pair.stateRoot, "state.db"), "synthetic");
  expect(() => acquireInstallation(workspace, "exclusive", { defaultPair: pair })).toThrow(/requires verifier/u);
  const lease = acquireInstallation(workspace, "exclusive", { defaultPair: pair, verifyExisting: (candidate) => ({ kind: "verified-existing", pair: candidate, authorityGeneration: 0, databaseIdentity: "synthetic-identity" }) });
  lease.release();
  const journal = join(workspace, ".tracker/control", "journal.json");
  writeFileSync(journal, JSON.stringify({ schemaVersion: 1, phase: "adopting", installationId: lease.locator.installationId }), { mode: 0o600 });
  expect(() => acquireInstallation(workspace, "shared")).toThrow(/unfinished adopting/u);
});

it("adopts owner-owned 0755 existing roots and preflights unsafe 0777 roots before recording installation", () => {
  const valid = fixture();
  mkdirSync(valid.pair.stateRoot, { recursive: true, mode: 0o755 });
  mkdirSync(valid.pair.artifactRoot, { mode: 0o755 });
  writeFileSync(join(valid.pair.stateRoot, "state.db"), "synthetic");
  const adopted = acquireInstallation(valid.workspace, "exclusive", { defaultPair: valid.pair, verifyExisting: (pair) => {
    expect(Object.isFrozen(pair)).toBe(true);
    return { kind: "verified-existing", pair, authorityGeneration: 3, databaseIdentity: "synthetic-database" };
  } });
  expect(adopted.locator.generation).toBe(0); adopted.release();
  const unsafe = fixture();
  mkdirSync(unsafe.pair.stateRoot, { recursive: true, mode: 0o700 }); chmodSync(unsafe.pair.stateRoot, 0o777);
  expect(() => acquireInstallation(unsafe.workspace, "exclusive", { defaultPair: unsafe.pair })).toThrow(/unsafe data root/u);
  expect(existsSync(join(unsafe.workspace, ".tracker/control", "installation.json"))).toBe(false);
  expect(existsSync(join(unsafe.pair.stateRoot, ".runtime-owner.json"))).toBe(false);
});

it("rejects unsafe private files, root ownership, and invalid overlap", () => {
  const { workspace, pair } = fixture();
  expect(() => acquireInstallation(workspace, "exclusive", { defaultPair: { stateRoot: pair.stateRoot, artifactRoot: workspace } })).toThrow(/root|overlap|default/u);
  expect(() => acquireInstallation(workspace, "exclusive", { defaultPair: { stateRoot: join(dirname(workspace), "other-state"), artifactRoot: join(dirname(workspace), "other-artifacts") } })).toThrow(/known default root pair/u);
  const lease = adoptSynthetic(workspace, pair); lease.release();
  const exclusive = acquireInstallation(workspace, "exclusive");
  const held = restore(workspace);
  const bad = { stateRoot: join(workspace, ".tracker/control", "new-state"), artifactRoot: join(dirname(workspace), "new-artifacts") };
  expect(() => exclusive.beginRelocation(bad, relocationPlan(exclusive, bad), held)).toThrow(/control overlaps/u);
  exclusive.release(); held.release();
  const locator = join(workspace, ".tracker/control", "locator.json");
  chmodSync(locator, 0o644);
  expect(() => acquireInstallation(workspace, "shared")).toThrow(/unsafe file/u);
  chmodSync(locator, 0o600);
  const hardlink = join(dirname(workspace), "locator-hardlink"); linkSync(locator, hardlink);
  expect(() => acquireInstallation(workspace, "shared")).toThrow(/unsafe file/u);
  unlinkSync(hardlink);
  const bytes = readFileSync(locator); unlinkSync(locator); symlinkSync(join(pair.stateRoot, ".runtime-owner.json"), locator);
  expect(() => acquireInstallation(workspace, "shared")).toThrow(/unsafe file/u);
  unlinkSync(locator); writeFileSync(locator, bytes, { mode: 0o600 });
  const marker = join(pair.stateRoot, ".runtime-owner.json");
  const foreign = JSON.parse(readFileSync(marker, "utf8")) as Record<string, unknown>;
  foreign.installationId = "00000000-0000-4000-8000-000000000000";
  writeFileSync(marker, JSON.stringify(foreign));
  expect(() => acquireInstallation(workspace, "shared")).toThrow(/root ownership mismatch/u);
});

it("moves both roots with a fixed lock shell, preserves source bytes, and binds a v2 receipt", () => {
  const { workspace, pair } = fixture();
  const first = adoptSynthetic(workspace, pair); first.release();
  writeFileSync(join(pair.stateRoot, "state.db"), "synthetic source authority");
  writeFileSync(join(pair.artifactRoot, "a.artifact"), "synthetic artifact");
  const lease = acquireInstallation(workspace, "exclusive");
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
  const reader = acquireInstallation(workspace, "shared");
  expect(reader.locator).toEqual(next);
  expect(reader.readRelocationReceipts()).toHaveLength(1);
  reader.release();
});

it("resumes fenced, retained, and switched journals only with an exact held restore admission", () => {
  const { workspace, pair } = fixture();
  const initial = adoptSynthetic(workspace, pair); initial.release();
  writeFileSync(join(pair.stateRoot, "state.db"), "synthetic source authority");
  writeFileSync(join(pair.artifactRoot, "a.artifact"), "synthetic artifact");
  const moving = acquireInstallation(workspace, "exclusive");
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
  expect(() => acquireInstallation(workspace, "shared")).toThrow(/unfinished fenced/u);
  const resumedHeld = restore(workspace);
  const request = { installationId: initial.locator.installationId, fromGeneration: 0, operationId, restoreAdmission: resumedHeld };
  expect(() => inspectPendingRelocationRecovery(workspace, randomUUID(), resumedHeld)).toThrow(/recovery operation binding mismatch/u);
  expect(inspectPendingRelocationRecovery(workspace, operationId, resumedHeld)).toEqual({
    installationId: initial.locator.installationId, fromGeneration: 0, operationId,
  });
  const resume = acquireInstallation(workspace, "exclusive", { recoverRelocation: request });
  expect(() => inspectPendingRelocationRecovery(workspace, operationId, resumedHeld)).toThrow(/lease busy/u);
  resume.retainRelocationSources();
  expect(inspectPendingRelocationStatus(workspace)).toEqual({ operationId, phase: "retained", fromGeneration: 0 });
  const retainedJournal = readFileSync(join(workspace, ".tracker/control", "journal.json"));
  const next = resume.switchRelocationLocator(verify);
  expect(next.generation).toBe(1);
  resume.release(); resumedHeld.release();
  writeFileSync(join(workspace, ".tracker/control", "journal.json"), retainedJournal);
  expect(() => acquireInstallation(workspace, "shared")).toThrow(/unfinished retained/u);
  const finalHeld = restore(workspace);
  const afterSwitchCrash = acquireInstallation(workspace, "exclusive", { recoverRelocation: { ...request, restoreAdmission: finalHeld } });
  expect(afterSwitchCrash.switchRelocationLocator(verify)).toEqual(next);
  afterSwitchCrash.settleRelocation(verify);
  afterSwitchCrash.release(); finalHeld.release();
  expect(inspectPendingRelocationStatus(workspace)).toBeUndefined();
  const absentRestore = restore(workspace);
  expect(() => inspectPendingRelocationRecovery(workspace, operationId, absentRestore)).toThrow(/ENOENT|journal/u);
  absentRestore.release();
  const reader = acquireInstallation(workspace, "shared");
  expect(reader.locator).toEqual(next); reader.release();
});

it("keeps the source fence as a negative witness if its journal is lost", () => {
  const { workspace, pair } = fixture();
  const initial = adoptSynthetic(workspace, pair); initial.release();
  writeFileSync(join(pair.stateRoot, "state.db"), "synthetic");
  writeFileSync(join(pair.artifactRoot, "a.artifact"), "synthetic");
  const moving = acquireInstallation(workspace, "exclusive");
  const held = restore(workspace);
  const destination = { stateRoot: join(dirname(workspace), "moved-state"), artifactRoot: join(dirname(workspace), "moved-artifacts") };
  const plan = relocationPlan(moving, destination);
  const operationId = moving.beginRelocation(destination, plan, held);
  prepareDestination(moving, destination);
  moving.recordVerifiedStage(staged(moving, destination, operationId, plan));
  moving.fenceRelocationSource();
  moving.release(); held.release();
  unlinkSync(join(workspace, ".tracker/control", "journal.json"));
  expect(() => acquireInstallation(workspace, "shared")).toThrow(/fenced source/u);
  expect(() => inspectPendingRelocationStatus(workspace)).toThrow(/fenced source/u);
});

it("moves artifacts alone without advancing the state marker epoch", () => {
  const { workspace, pair } = fixture();
  const initial = adoptSynthetic(workspace, pair); initial.release();
  writeFileSync(join(pair.stateRoot, "state.db"), "state remains");
  writeFileSync(join(pair.artifactRoot, "a.artifact"), "artifact remains");
  const destination = { stateRoot: pair.stateRoot, artifactRoot: join(dirname(workspace), "external-artifacts") };
  const result = settledMove(workspace, destination);
  expect(result.locator).toMatchObject({ generation: 1, stateRootGeneration: 0, artifactRootGeneration: 1 });
  expect(readFileSync(join(pair.stateRoot, "state.db"), "utf8")).toBe("state remains");
  expect(statSync(pair.artifactRoot).isFile()).toBe(true);
  const retained = join(pair.stateRoot, `.artifacts.retained-${result.operationId}-artifact`);
  expect(readFileSync(join(retained, "a.artifact"), "utf8")).toBe("artifact remains");
  const reader = acquireInstallation(workspace, "shared");
  expect(reader.readRelocationReceipts()).toHaveLength(1);
  reader.release();
});

it("pins prior artifact tombstone and retained witness when state moves later", () => {
  const { workspace, pair } = fixture();
  const initial = adoptSynthetic(workspace, pair); initial.release();
  writeFileSync(join(pair.stateRoot, "state.db"), "state source");
  writeFileSync(join(pair.artifactRoot, "a.artifact"), "artifact source");
  const first = settledMove(workspace, { stateRoot: pair.stateRoot, artifactRoot: join(dirname(workspace), "external-artifacts") });
  const oldRetained = join(pair.stateRoot, `.artifacts.retained-${first.operationId}-artifact`);
  const second = settledMove(workspace, { stateRoot: join(dirname(workspace), "moved-state"), artifactRoot: join(dirname(workspace), "external-artifacts") });
  expect(second.locator).toMatchObject({ generation: 2, stateRootGeneration: 2, artifactRootGeneration: 1 });
  expect(readFileSync(join(oldRetained, "a.artifact"), "utf8")).toBe("artifact source");
  expect(readFileSync(pair.artifactRoot, "utf8")).toContain("relocation-tombstone");
  const current = acquireInstallation(workspace, "shared");
  const receipts = current.readRelocationReceipts();
  expect(receipts).toHaveLength(2);
  expect(receipts[1]?.pinnedEntries).toEqual([".artifacts.retained-" + first.operationId + "-artifact", "artifacts"]);
  current.release();
});

it("uses a witness shell after both roots move, artifacts move again, then state moves", () => {
  const { workspace, pair } = fixture();
  const initial = adoptSynthetic(workspace, pair); initial.release();
  writeFileSync(join(pair.stateRoot, "state.db"), "state source");
  writeFileSync(join(pair.artifactRoot, "a.artifact"), "artifact source");
  const firstState = join(dirname(workspace), "first-state");
  const firstArtifacts = join(firstState, "artifacts");
  settledMove(workspace, { stateRoot: firstState, artifactRoot: firstArtifacts });
  const second = settledMove(workspace, { stateRoot: firstState, artifactRoot: join(dirname(workspace), "second-artifacts") });
  const oldRetained = join(firstState, `.artifacts.retained-${second.operationId}-artifact`);
  const third = settledMove(workspace, { stateRoot: join(dirname(workspace), "third-state"), artifactRoot: join(dirname(workspace), "second-artifacts") });
  expect(third.locator).toMatchObject({ generation: 3, stateRootGeneration: 3, artifactRootGeneration: 2 });
  expect(statSync(firstState).isDirectory()).toBe(true);
  expect(readFileSync(join(firstState, "state.db"), "utf8")).toContain("relocation-tombstone");
  expect(readFileSync(firstArtifacts, "utf8")).toContain("relocation-tombstone");
  expect(readFileSync(join(oldRetained, "a.artifact"), "utf8")).toBe("artifact source");
  const current = acquireInstallation(workspace, "shared");
  const receipts = current.readRelocationReceipts();
  expect(receipts).toHaveLength(3);
  expect(receipts[2]?.retentions.find((row) => row.role === "state")?.strategy).toBe("witness-shell");
  current.release();
});

it("moves state alone after artifacts are disjoint and retains per-root epochs", () => {
  const { workspace, pair } = fixture();
  const initial = adoptSynthetic(workspace, pair); initial.release();
  writeFileSync(join(pair.stateRoot, "state.db"), "state remains");
  writeFileSync(join(pair.artifactRoot, "a.artifact"), "artifact remains");
  const invalid = acquireInstallation(workspace, "exclusive");
  const invalidRestore = restore(workspace);
  const stranded = { stateRoot: join(dirname(workspace), "stranded-state"), artifactRoot: pair.artifactRoot };
  expect(() => invalid.beginRelocation(stranded, relocationPlan(invalid, stranded), invalidRestore)).toThrow(/strand nested artifacts/u);
  invalid.release(); invalidRestore.release();
  const first = settledMove(workspace, { stateRoot: join(dirname(workspace), "first-state"), artifactRoot: join(dirname(workspace), "external-artifacts") });
  expect(first.locator).toMatchObject({ stateRootGeneration: 1, artifactRootGeneration: 1 });
  const second = settledMove(workspace, { stateRoot: join(dirname(workspace), "second-state"), artifactRoot: join(dirname(workspace), "external-artifacts") });
  expect(second.locator).toMatchObject({ generation: 2, stateRootGeneration: 2, artifactRootGeneration: 1 });
  expect(statSync(join(dirname(workspace), "first-state")).isFile()).toBe(true);
  expect(readFileSync(join(dirname(workspace), `.first-state.retained-${second.operationId}-state`, "state.db"), "utf8")).toBe("state remains");
  const reader = acquireInstallation(workspace, "shared");
  expect(reader.readRelocationReceipts()).toHaveLength(2);
  reader.release();
});

it("recovers an interrupted lock-shell entry rename with its exact journal manifest", () => {
  const { workspace, pair } = fixture();
  const initial = adoptSynthetic(workspace, pair); initial.release();
  writeFileSync(join(pair.stateRoot, "state.db"), "old authority");
  writeFileSync(join(pair.artifactRoot, "a.artifact"), "old artifact");
  const lease = acquireInstallation(workspace, "exclusive");
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
  expect(() => acquireInstallation(workspace, "shared")).toThrow(/unfinished retaining/u);
  const recoveredHeld = restore(workspace);
  const recovered = acquireInstallation(workspace, "exclusive", { recoverRelocation: {
    installationId: initial.locator.installationId, fromGeneration: 0, operationId, restoreAdmission: recoveredHeld,
  } });
  recovered.retainRelocationSources();
  expect(readFileSync(join(pair.stateRoot, "state.db"), "utf8")).toContain("relocation-tombstone");
  recovered.switchRelocationLocator(verify);
  recovered.settleRelocation(verify);
  recovered.release(); recoveredHeld.release();
  const reader = acquireInstallation(workspace, "shared");
  expect(reader.locator.generation).toBe(1); reader.release();
});

it("refuses tampered completed receipts and recreated retained sources", () => {
  const { workspace, pair } = fixture();
  const initial = adoptSynthetic(workspace, pair); initial.release();
  writeFileSync(join(pair.stateRoot, "state.db"), "old authority");
  writeFileSync(join(pair.artifactRoot, "a.artifact"), "old artifact");
  const result = settledMove(workspace, { stateRoot: pair.stateRoot, artifactRoot: join(dirname(workspace), "new-artifacts") });
  const receiptDirectory = join(workspace, ".tracker/control", "relocation-receipts");
  const receiptPath = join(receiptDirectory, readdirSync(receiptDirectory)[0]);
  const bytes = readFileSync(receiptPath);
  const receipt = JSON.parse(bytes.toString()) as Record<string, unknown>;
  writeFileSync(receiptPath, JSON.stringify({ ...receipt, operationId: "33333333-3333-4333-8333-333333333333" }));
  expect(() => acquireInstallation(workspace, "shared")).toThrow(/receipt chain mismatch/u);
  writeFileSync(receiptPath, bytes);
  unlinkSync(pair.artifactRoot);
  mkdirSync(pair.artifactRoot, { mode: 0o700 });
  expect(() => acquireInstallation(workspace, "shared")).toThrow(/tombstone|unsafe/u);
  if (result.locator.schemaVersion !== 2) throw new Error("expected v2 locator");
  expect(result.locator.artifactRootGeneration).toBe(1);
});

it("refuses a missing retained source after a completed move", () => {
  const { workspace, pair } = fixture();
  const initial = adoptSynthetic(workspace, pair); initial.release();
  writeFileSync(join(pair.stateRoot, "state.db"), "source");
  writeFileSync(join(pair.artifactRoot, "a.artifact"), "artifact");
  const moved = settledMove(workspace, { stateRoot: pair.stateRoot, artifactRoot: join(dirname(workspace), "new-artifacts") });
  rmSync(join(pair.stateRoot, `.artifacts.retained-${moved.operationId}-artifact`), { recursive: true });
  expect(() => acquireInstallation(workspace, "shared")).toThrow(/retained|unsafe|ENOENT/u);
});

it("reads only prior receipts when first and later operations publish their own receipt before journal clear", () => {
  const { workspace, pair } = fixture();
  const initial = adoptSynthetic(workspace, pair); initial.release();
  writeFileSync(join(pair.stateRoot, "state.db"), "source");
  writeFileSync(join(pair.artifactRoot, "a.artifact"), "artifact");
  const lease = acquireInstallation(workspace, "exclusive");
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
  expect(() => acquireInstallation(workspace, "shared")).toThrow(/unfinished switched/u);
  const resumedHeld = restore(workspace);
  const resumed = acquireInstallation(workspace, "exclusive", { recoverRelocation: {
    installationId: initial.locator.installationId, fromGeneration: 0, operationId, restoreAdmission: resumedHeld,
  } });
  expect(resumed.readPriorReceipts()).toEqual([]);
  resumed.settleRelocation(verify);
  resumed.release(); resumedHeld.release();
  expect(readdirSync(join(control, "relocation-receipts"))).toEqual(receipts);
  expect(existsSync(join(control, "journal.json"))).toBe(false);

  const later = acquireInstallation(workspace, "exclusive");
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
  const laterResumed = acquireInstallation(workspace, "exclusive", { recoverRelocation: {
    installationId: initial.locator.installationId, fromGeneration: 1, operationId: laterOperationId,
    restoreAdmission: laterResumedHeld,
  } });
  expect(laterResumed.readPriorReceipts().map((receipt) => receipt.operationId)).toEqual([operationId]);
  laterResumed.settleRelocation(laterVerify);
  laterResumed.release(); laterResumedHeld.release();
});
