import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { acquireInstallation, type ExclusiveInstallationLease, type RelocationPlanBinding, type RuntimePair,
  type VerifiedRelocationEvidence } from "../../../src/infra/runtime-control/installation.js";
import { acquireRuntimeRestoreAdmission, type RestoreAdmissionHandle } from "../../../src/infra/sqlite/runtime-process-locks.js";
import { StorageRelocationCommandRequestSchema, storageRelocationDesiredDigest,
  storageRelocationRequestFingerprint } from "../../../src/domain/commands.js";
import { NonNegativeIntSchema } from "../../../src/domain/ids.js";
import { manualClock } from "../../../src/domain/clock.js";
import { RuntimeAdmission } from "../../../src/infra/runtime-control/admission.js";
import { AuthorityDatabase } from "../../../src/infra/sqlite/authority-database.js";
import { createStorageRelocationPlanReader } from "../../../src/core/storage-relocation-plans.js";
import { executeStorageRelocationCommand } from "../../../src/core/command-kernel.js";

const workspaces: string[] = [];
function fixture(): { workspace: string; pair: RuntimePair } {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), "runtime-control-")));
  workspaces.push(workspace);
  return { workspace, pair: { stateRoot: join(workspace, ".tracker"), artifactRoot: join(workspace, ".tracker", "artifacts") } };
}
afterEach(() => { for (const workspace of workspaces.splice(0)) rmSync(workspace, { recursive: true, force: true }); });
async function stopChild(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("owned child did not exit after SIGKILL")), 5000);
    const done = () => { clearTimeout(timeout); resolve(); };
    child.once("exit", done);
    child.kill("SIGKILL");
    if (child.exitCode !== null || child.signalCode !== null) done();
  });
}
function restore(workspace: string): RestoreAdmissionHandle {
  return acquireRuntimeRestoreAdmission({ processLockRoot: join(workspace, ".tracker", "locks"), pid: process.pid });
}
function relocationPlan(lease: ExclusiveInstallationLease, destination: RuntimePair): RelocationPlanBinding {
  return { commandId: "11111111-1111-4111-8111-111111111111", revision: 1, expectedRevision: 0,
    requestFingerprint: "a".repeat(64),
    desiredDigest: storageRelocationDesiredDigest({ installationId: lease.locator.installationId,
      sourceGeneration: NonNegativeIntSchema.parse(lease.locator.generation), sourcePair: { stateRoot: lease.locator.stateRoot,
        artifactRoot: lease.locator.artifactRoot }, expectedRevision: NonNegativeIntSchema.parse(0) }, destination) };
}
function prepareDestination(lease: ExclusiveInstallationLease, destination: RuntimePair): void {
  if (destination.stateRoot !== lease.locator.stateRoot) {
    mkdirSync(destination.stateRoot, { recursive: true, mode: 0o700 });
    copyFileSync(join(lease.locator.stateRoot, ".runtime-owner.json"), join(destination.stateRoot, ".runtime-owner.json"));
    copyFileSync(join(lease.locator.stateRoot, "state.db"), join(destination.stateRoot, "state.db"));
  }
  if (destination.artifactRoot !== lease.locator.artifactRoot) {
    mkdirSync(destination.artifactRoot, { recursive: true, mode: 0o700 });
    copyFileSync(join(lease.locator.artifactRoot, ".runtime-owner.json"), join(destination.artifactRoot, ".runtime-owner.json"));
    copyFileSync(join(lease.locator.artifactRoot, "a.artifact"), join(destination.artifactRoot, "a.artifact"));
  }
}
function staged(lease: ExclusiveInstallationLease, destination: RuntimePair, operationId: string,
  plan: RelocationPlanBinding): () => VerifiedRelocationEvidence {
  const inventory = lease.relocationInventory();
  const pinned = new Set(inventory.pinnedEntries);
  const entryShell = inventory.retentions.find((row) => row.role === "state" && row.strategy !== "whole-root");
  const managedStateEntries = entryShell
    ? readdirSync(lease.locator.stateRoot).filter((name) => ![...(entryShell.strategy === "lock-shell" ? ["locks"] : []),
      ".runtime-owner.json", ".runtime-source-fence.json"].includes(name)
      && !pinned.has(name))
      .map((name) => ({ name, kind: statSync(join(lease.locator.stateRoot, name)).isDirectory() ? "directory" as const : "file" as const })) : [];
  const evidence: VerifiedRelocationEvidence = { operationId, installationId: lease.locator.installationId,
    sourceGeneration: lease.locator.generation, source: { stateRoot: lease.locator.stateRoot, artifactRoot: lease.locator.artifactRoot },
    destination, plan, stagingReceiptId: "synthetic-stage", stagingDigest: "b".repeat(64),
    backupReceiptId: "synthetic-backup", backupDigest: "c".repeat(64), finalDatabasePath: join(destination.stateRoot, "state.db"),
    configSnapshotId: "22222222-2222-4222-8222-222222222222", configFingerprint: "d".repeat(64),
    authorityVersion: 56, databaseIdentity: "synthetic-db", managedStateEntries };
  return () => evidence;
}
function settledMove(workspace: string, destination: RuntimePair): { operationId: string; locator: ExclusiveInstallationLease["locator"] } {
  const lease = acquireInstallation(workspace, "exclusive");
  const held = restore(workspace);
  try {
    const plan = relocationPlan(lease, destination);
    const operationId = lease.beginRelocation(destination, plan, held);
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
  const first = acquireInstallation(workspace, "exclusive", { defaultPair: pair });
  expect(first.locator.generation).toBe(0);
  expect(() => acquireInstallation(workspace, "shared")).toThrow(/lease busy/u);
  first.release();
  const one = acquireInstallation(workspace, "shared");
  const two = acquireInstallation(workspace, "shared");
  expect(one.locator).toEqual(two.locator);
  one.release(); two.release();
  const locator = join(workspace, ".runtime-control", "locator.json");
  unlinkSync(locator);
  expect(() => acquireInstallation(workspace, "exclusive", { defaultPair: pair })).toThrow(/locator missing/u);
  expect(existsSync(join(pair.stateRoot, ".runtime-owner.json"))).toBe(true);
});

it("does not silently re-adopt defaults after control is lost", () => {
  const { workspace, pair } = fixture();
  const first = acquireInstallation(workspace, "exclusive", { defaultPair: pair }); first.release();
  rmSync(join(workspace, ".runtime-control"), { recursive: true });
  expect(() => acquireInstallation(workspace, "exclusive", { defaultPair: pair })).toThrow(/existing ownership witness without locator/u);
});

it("refuses an unexplained v1 completed generation without a receipt chain", () => {
  const { workspace, pair } = fixture();
  const first = acquireInstallation(workspace, "exclusive", { defaultPair: pair }); first.release();
  const path = join(workspace, ".runtime-control", "locator.json");
  const locator = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  writeFileSync(path, JSON.stringify({ ...locator, generation: 1 }));
  expect(() => acquireInstallation(workspace, "shared")).toThrow(/active locator receipt chain mismatch/u);
});

it("binds the first real saved plan at applied revision one and expected revision zero", () => {
  const { workspace, pair } = fixture();
  const adopted = acquireInstallation(workspace, "exclusive", { defaultPair: pair }); adopted.release();
  const planning = acquireInstallation(workspace, "shared");
  const clock = manualClock(new Date("2026-09-26T12:00:00.000Z"));
  const admission = RuntimeAdmission.fromInstallationLease(planning);
  const database = AuthorityDatabase.open(admission, { path: join(pair.stateRoot, "state.db"),
    busyTimeoutMs: 250, migrationOwner: "unit-test" }, clock);
  const producer = createStorageRelocationPlanReader({ authority: database, admission, workspace });
  const destination = { stateRoot: join(workspace, "planned-state"), artifactRoot: join(workspace, "planned-artifacts") };
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
  database.close(); planning.release();
  const lease = acquireInstallation(workspace, "exclusive");
  const held = restore(workspace);
  const binding: RelocationPlanBinding = { commandId: request.commandId, revision: view.revision,
    expectedRevision: request.target.expectedRevision, requestFingerprint: view.pending?.requestFingerprint ?? "",
    desiredDigest: view.pending?.desiredDigest ?? "" };
  expect(lease.beginRelocation(destination, binding, held)).toMatch(/^[0-9a-f-]{36}$/u);
  lease.release(); held.release();
});

it("refuses a retained default-source fence after control and owner markers are lost", () => {
  const { workspace, pair } = fixture();
  const first = acquireInstallation(workspace, "exclusive", { defaultPair: pair }); first.release();
  writeFileSync(join(pair.stateRoot, "state.db"), "valid synthetic authority");
  writeFileSync(join(pair.stateRoot, ".runtime-source-fence.json"), "synthetic retained fence", { mode: 0o600 });
  rmSync(join(workspace, ".runtime-control"), { recursive: true });
  unlinkSync(join(pair.stateRoot, ".runtime-owner.json"));
  unlinkSync(join(pair.artifactRoot, ".runtime-owner.json"));
  let verifierCalled = false;
  expect(() => acquireInstallation(workspace, "exclusive", { defaultPair: pair, verifyExisting: (candidate) => {
    verifierCalled = true;
    return { kind: "verified-existing", pair: candidate, authorityGeneration: 0, databaseIdentity: "synthetic-database" };
  } })).toThrow(/retained source fence without locator/u);
  expect(verifierCalled).toBe(false);
  expect(existsSync(join(workspace, ".runtime-control", "installation.json"))).toBe(false);
});

it("requires typed validation for existing defaults and refuses interrupted adoption", () => {
  const { workspace, pair } = fixture();
  mkdirSync(pair.stateRoot, { mode: 0o700 });
  writeFileSync(join(pair.stateRoot, "state.db"), "synthetic");
  expect(() => acquireInstallation(workspace, "exclusive", { defaultPair: pair })).toThrow(/requires verifier/u);
  const lease = acquireInstallation(workspace, "exclusive", { defaultPair: pair, verifyExisting: (candidate) => ({ kind: "verified-existing", pair: candidate, authorityGeneration: 0, databaseIdentity: "synthetic-identity" }) });
  lease.release();
  const journal = join(workspace, ".runtime-control", "journal.json");
  writeFileSync(journal, JSON.stringify({ schemaVersion: 1, phase: "adopting", installationId: lease.locator.installationId }), { mode: 0o600 });
  expect(() => acquireInstallation(workspace, "shared")).toThrow(/unfinished adopting/u);
});

it("adopts owner-owned 0755 existing roots and preflights unsafe 0777 roots before recording installation", () => {
  const valid = fixture();
  mkdirSync(valid.pair.stateRoot, { mode: 0o755 });
  mkdirSync(valid.pair.artifactRoot, { mode: 0o755 });
  writeFileSync(join(valid.pair.stateRoot, "state.db"), "synthetic");
  const adopted = acquireInstallation(valid.workspace, "exclusive", { defaultPair: valid.pair, verifyExisting: (pair) => {
    expect(Object.isFrozen(pair)).toBe(true);
    return { kind: "verified-existing", pair, authorityGeneration: 3, databaseIdentity: "synthetic-database" };
  } });
  expect(adopted.locator.generation).toBe(0); adopted.release();
  const unsafe = fixture();
  mkdirSync(unsafe.pair.stateRoot, { mode: 0o700 }); chmodSync(unsafe.pair.stateRoot, 0o777);
  expect(() => acquireInstallation(unsafe.workspace, "exclusive", { defaultPair: unsafe.pair })).toThrow(/unsafe data root/u);
  expect(existsSync(join(unsafe.workspace, ".runtime-control", "installation.json"))).toBe(false);
  expect(existsSync(join(unsafe.pair.stateRoot, ".runtime-owner.json"))).toBe(false);
});

it("rejects unsafe private files, root ownership, and invalid overlap", () => {
  const { workspace, pair } = fixture();
  expect(() => acquireInstallation(workspace, "exclusive", { defaultPair: { stateRoot: pair.stateRoot, artifactRoot: workspace } })).toThrow(/root|overlap|default/u);
  expect(() => acquireInstallation(workspace, "exclusive", { defaultPair: { stateRoot: join(workspace, "other-state"), artifactRoot: join(workspace, "other-artifacts") } })).toThrow(/known default root pair/u);
  const lease = acquireInstallation(workspace, "exclusive", { defaultPair: pair }); lease.release();
  const exclusive = acquireInstallation(workspace, "exclusive");
  const held = restore(workspace);
  const bad = { stateRoot: join(workspace, ".runtime-control", "new-state"), artifactRoot: join(workspace, "new-artifacts") };
  expect(() => exclusive.beginRelocation(bad, relocationPlan(exclusive, bad), held)).toThrow(/control overlaps/u);
  exclusive.release(); held.release();
  const locator = join(workspace, ".runtime-control", "locator.json");
  chmodSync(locator, 0o644);
  expect(() => acquireInstallation(workspace, "shared")).toThrow(/unsafe file/u);
  chmodSync(locator, 0o600);
  const hardlink = join(workspace, "locator-hardlink"); linkSync(locator, hardlink);
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
  const first = acquireInstallation(workspace, "exclusive", { defaultPair: pair }); first.release();
  writeFileSync(join(pair.stateRoot, "state.db"), "synthetic source authority");
  writeFileSync(join(pair.artifactRoot, "a.artifact"), "synthetic artifact");
  const lease = acquireInstallation(workspace, "exclusive");
  expect(() => Object.assign(lease.locator, { generation: 99 })).toThrow(TypeError);
  const held = restore(workspace);
  const destination = { stateRoot: join(workspace, "new-state"), artifactRoot: join(workspace, "new-state", "artifacts") };
  const plan = relocationPlan(lease, destination);
  const operationId = lease.beginRelocation(destination, plan, held);
  destination.stateRoot = join(workspace, "mutated-state");
  const target = { stateRoot: join(workspace, "new-state"), artifactRoot: join(workspace, "new-state", "artifacts") };
  const journal = JSON.parse(readFileSync(join(workspace, ".runtime-control", "journal.json"), "utf8")) as { destination: RuntimePair };
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
  expect(() => lease.beginRelocation({ stateRoot: join(workspace, "third-state"), artifactRoot: join(workspace, "third-artifacts") }, plan, held)).toThrow(/one relocation per exclusive lease/u);
  lease.release(); held.release();
  expect(statSync(join(pair.stateRoot, "locks")).isDirectory()).toBe(true);
  expect(statSync(join(pair.stateRoot, "state.db")).isFile()).toBe(true);
  expect(readFileSync(join(pair.stateRoot, "state.db"), "utf8")).toContain("relocation-tombstone");
  expect(statSync(pair.artifactRoot).isFile()).toBe(true);
  const retained = join(workspace, `.tracker.retained-${operationId}-state`);
  expect(readFileSync(join(retained, "state.db"), "utf8")).toBe("synthetic source authority");
  expect(readFileSync(join(retained, "artifacts", "a.artifact"), "utf8")).toBe("synthetic artifact");
  const reader = acquireInstallation(workspace, "shared");
  expect(reader.locator).toEqual(next);
  expect(reader.readRelocationReceipts()).toHaveLength(1);
  reader.release();
});

it("resumes fenced, retained, and switched journals only with an exact held restore admission", () => {
  const { workspace, pair } = fixture();
  const initial = acquireInstallation(workspace, "exclusive", { defaultPair: pair }); initial.release();
  writeFileSync(join(pair.stateRoot, "state.db"), "synthetic source authority");
  writeFileSync(join(pair.artifactRoot, "a.artifact"), "synthetic artifact");
  const moving = acquireInstallation(workspace, "exclusive");
  const held = restore(workspace);
  const destination = { stateRoot: join(workspace, "new-state"), artifactRoot: join(workspace, "new-artifacts") };
  const plan = relocationPlan(moving, destination);
  const operationId = moving.beginRelocation(destination, plan, held);
  expect(() => moving.switchRelocationLocator(staged(moving, destination, operationId, plan))).toThrow(/retained source required/u);
  prepareDestination(moving, destination);
  const verify = staged(moving, destination, operationId, plan);
  moving.recordVerifiedStage(verify);
  moving.fenceRelocationSource();
  expect(existsSync(join(pair.stateRoot, ".runtime-source-fence.json"))).toBe(true);
  moving.release(); held.release();
  expect(() => acquireInstallation(workspace, "shared")).toThrow(/unfinished fenced/u);
  const resumedHeld = restore(workspace);
  const request = { installationId: initial.locator.installationId, fromGeneration: 0, operationId, restoreAdmission: resumedHeld };
  const resume = acquireInstallation(workspace, "exclusive", { recoverRelocation: request });
  resume.retainRelocationSources();
  const retainedJournal = readFileSync(join(workspace, ".runtime-control", "journal.json"));
  const next = resume.switchRelocationLocator(verify);
  expect(next.generation).toBe(1);
  resume.release(); resumedHeld.release();
  writeFileSync(join(workspace, ".runtime-control", "journal.json"), retainedJournal);
  expect(() => acquireInstallation(workspace, "shared")).toThrow(/unfinished retained/u);
  const finalHeld = restore(workspace);
  const afterSwitchCrash = acquireInstallation(workspace, "exclusive", { recoverRelocation: { ...request, restoreAdmission: finalHeld } });
  expect(afterSwitchCrash.switchRelocationLocator(verify)).toEqual(next);
  afterSwitchCrash.settleRelocation(verify);
  afterSwitchCrash.release(); finalHeld.release();
  const reader = acquireInstallation(workspace, "shared");
  expect(reader.locator).toEqual(next); reader.release();
});

it("keeps the source fence as a negative witness if its journal is lost", () => {
  const { workspace, pair } = fixture();
  const initial = acquireInstallation(workspace, "exclusive", { defaultPair: pair }); initial.release();
  writeFileSync(join(pair.stateRoot, "state.db"), "synthetic");
  writeFileSync(join(pair.artifactRoot, "a.artifact"), "synthetic");
  const moving = acquireInstallation(workspace, "exclusive");
  const held = restore(workspace);
  const destination = { stateRoot: join(workspace, "moved-state"), artifactRoot: join(workspace, "moved-artifacts") };
  const plan = relocationPlan(moving, destination);
  const operationId = moving.beginRelocation(destination, plan, held);
  prepareDestination(moving, destination);
  moving.recordVerifiedStage(staged(moving, destination, operationId, plan));
  moving.fenceRelocationSource();
  moving.release(); held.release();
  unlinkSync(join(workspace, ".runtime-control", "journal.json"));
  expect(() => acquireInstallation(workspace, "shared")).toThrow(/fenced source/u);
});

it("moves artifacts alone without advancing the state marker epoch", () => {
  const { workspace, pair } = fixture();
  const initial = acquireInstallation(workspace, "exclusive", { defaultPair: pair }); initial.release();
  writeFileSync(join(pair.stateRoot, "state.db"), "state remains");
  writeFileSync(join(pair.artifactRoot, "a.artifact"), "artifact remains");
  const destination = { stateRoot: pair.stateRoot, artifactRoot: join(workspace, "external-artifacts") };
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
  const initial = acquireInstallation(workspace, "exclusive", { defaultPair: pair }); initial.release();
  writeFileSync(join(pair.stateRoot, "state.db"), "state source");
  writeFileSync(join(pair.artifactRoot, "a.artifact"), "artifact source");
  const first = settledMove(workspace, { stateRoot: pair.stateRoot, artifactRoot: join(workspace, "external-artifacts") });
  const oldRetained = join(pair.stateRoot, `.artifacts.retained-${first.operationId}-artifact`);
  const second = settledMove(workspace, { stateRoot: join(workspace, "moved-state"), artifactRoot: join(workspace, "external-artifacts") });
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
  const initial = acquireInstallation(workspace, "exclusive", { defaultPair: pair }); initial.release();
  writeFileSync(join(pair.stateRoot, "state.db"), "state source");
  writeFileSync(join(pair.artifactRoot, "a.artifact"), "artifact source");
  const firstState = join(workspace, "first-state");
  const firstArtifacts = join(firstState, "artifacts");
  settledMove(workspace, { stateRoot: firstState, artifactRoot: firstArtifacts });
  const second = settledMove(workspace, { stateRoot: firstState, artifactRoot: join(workspace, "second-artifacts") });
  const oldRetained = join(firstState, `.artifacts.retained-${second.operationId}-artifact`);
  const third = settledMove(workspace, { stateRoot: join(workspace, "third-state"), artifactRoot: join(workspace, "second-artifacts") });
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
  const initial = acquireInstallation(workspace, "exclusive", { defaultPair: pair }); initial.release();
  writeFileSync(join(pair.stateRoot, "state.db"), "state remains");
  writeFileSync(join(pair.artifactRoot, "a.artifact"), "artifact remains");
  const invalid = acquireInstallation(workspace, "exclusive");
  const invalidRestore = restore(workspace);
  const stranded = { stateRoot: join(workspace, "stranded-state"), artifactRoot: pair.artifactRoot };
  expect(() => invalid.beginRelocation(stranded, relocationPlan(invalid, stranded), invalidRestore)).toThrow(/strand nested artifacts/u);
  invalid.release(); invalidRestore.release();
  const first = settledMove(workspace, { stateRoot: join(workspace, "first-state"), artifactRoot: join(workspace, "external-artifacts") });
  expect(first.locator).toMatchObject({ stateRootGeneration: 1, artifactRootGeneration: 1 });
  const second = settledMove(workspace, { stateRoot: join(workspace, "second-state"), artifactRoot: join(workspace, "external-artifacts") });
  expect(second.locator).toMatchObject({ generation: 2, stateRootGeneration: 2, artifactRootGeneration: 1 });
  expect(statSync(join(workspace, "first-state")).isFile()).toBe(true);
  expect(readFileSync(join(workspace, `.first-state.retained-${second.operationId}-state`, "state.db"), "utf8")).toBe("state remains");
  const reader = acquireInstallation(workspace, "shared");
  expect(reader.readRelocationReceipts()).toHaveLength(2);
  reader.release();
});

it("recovers an interrupted lock-shell entry rename with its exact journal manifest", () => {
  const { workspace, pair } = fixture();
  const initial = acquireInstallation(workspace, "exclusive", { defaultPair: pair }); initial.release();
  writeFileSync(join(pair.stateRoot, "state.db"), "old authority");
  writeFileSync(join(pair.artifactRoot, "a.artifact"), "old artifact");
  const lease = acquireInstallation(workspace, "exclusive");
  const held = restore(workspace);
  const destination = { stateRoot: join(workspace, "new-state"), artifactRoot: join(workspace, "new-artifacts") };
  const plan = relocationPlan(lease, destination);
  const operationId = lease.beginRelocation(destination, plan, held);
  prepareDestination(lease, destination);
  const verify = staged(lease, destination, operationId, plan);
  lease.recordVerifiedStage(verify);
  lease.fenceRelocationSource();
  const control = join(workspace, ".runtime-control");
  const journalPath = join(control, "journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as Record<string, unknown>;
  writeFileSync(journalPath, JSON.stringify({ ...journal, phase: "retaining" }), { mode: 0o600 });
  const retained = join(workspace, `.tracker.retained-${operationId}-state`);
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
  const initial = acquireInstallation(workspace, "exclusive", { defaultPair: pair }); initial.release();
  writeFileSync(join(pair.stateRoot, "state.db"), "old authority");
  writeFileSync(join(pair.artifactRoot, "a.artifact"), "old artifact");
  const result = settledMove(workspace, { stateRoot: pair.stateRoot, artifactRoot: join(workspace, "new-artifacts") });
  const receiptDirectory = join(workspace, ".runtime-control", "relocation-receipts");
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
  const initial = acquireInstallation(workspace, "exclusive", { defaultPair: pair }); initial.release();
  writeFileSync(join(pair.stateRoot, "state.db"), "source");
  writeFileSync(join(pair.artifactRoot, "a.artifact"), "artifact");
  const moved = settledMove(workspace, { stateRoot: pair.stateRoot, artifactRoot: join(workspace, "new-artifacts") });
  rmSync(join(pair.stateRoot, `.artifacts.retained-${moved.operationId}-artifact`), { recursive: true });
  expect(() => acquireInstallation(workspace, "shared")).toThrow(/retained|unsafe|ENOENT/u);
});

it("settles an exact receipt again after a crash before journal clear", () => {
  const { workspace, pair } = fixture();
  const initial = acquireInstallation(workspace, "exclusive", { defaultPair: pair }); initial.release();
  writeFileSync(join(pair.stateRoot, "state.db"), "source");
  writeFileSync(join(pair.artifactRoot, "a.artifact"), "artifact");
  const lease = acquireInstallation(workspace, "exclusive");
  const held = restore(workspace);
  const destination = { stateRoot: pair.stateRoot, artifactRoot: join(workspace, "new-artifacts") };
  const plan = relocationPlan(lease, destination);
  const operationId = lease.beginRelocation(destination, plan, held);
  prepareDestination(lease, destination);
  const verify = staged(lease, destination, operationId, plan);
  lease.recordVerifiedStage(verify);
  lease.fenceRelocationSource();
  lease.retainRelocationSources();
  lease.switchRelocationLocator(verify);
  const control = join(workspace, ".runtime-control");
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
  resumed.settleRelocation(verify);
  resumed.release(); resumedHeld.release();
  expect(readdirSync(join(control, "relocation-receipts"))).toEqual(receipts);
  expect(existsSync(join(control, "journal.json"))).toBe(false);
});

it("refuses a duplicate managed entry in a partially retained lock shell", () => {
  const { workspace, pair } = fixture();
  const initial = acquireInstallation(workspace, "exclusive", { defaultPair: pair }); initial.release();
  writeFileSync(join(pair.stateRoot, "state.db"), "source");
  writeFileSync(join(pair.artifactRoot, "a.artifact"), "artifact");
  const lease = acquireInstallation(workspace, "exclusive");
  const held = restore(workspace);
  const destination = { stateRoot: join(workspace, "new-state"), artifactRoot: join(workspace, "new-artifacts") };
  const plan = relocationPlan(lease, destination);
  const operationId = lease.beginRelocation(destination, plan, held);
  prepareDestination(lease, destination);
  lease.recordVerifiedStage(staged(lease, destination, operationId, plan));
  lease.fenceRelocationSource();
  const journalPath = join(workspace, ".runtime-control", "journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as Record<string, unknown>;
  writeFileSync(journalPath, JSON.stringify({ ...journal, phase: "retaining" }), { mode: 0o600 });
  const retained = join(workspace, `.tracker.retained-${operationId}-state`);
  mkdirSync(retained, { mode: 0o700 });
  copyFileSync(join(pair.stateRoot, ".runtime-owner.json"), join(retained, ".runtime-owner.json"));
  copyFileSync(join(pair.stateRoot, ".runtime-source-fence.json"), join(retained, ".runtime-source-fence.json"));
  copyFileSync(join(pair.stateRoot, "state.db"), join(retained, "state.db"));
  expect(() => lease.retainRelocationSources()).toThrow(/duplicate retained managed entry|tombstone/u);
  expect(readFileSync(join(pair.stateRoot, "state.db"), "utf8")).toBe("source");
  lease.release(); held.release();
});

it("recovers empty and first-witness retained shells, but refuses foreign entries", () => {
  for (const partial of ["empty", "marker", "foreign"] as const) {
    const { workspace, pair } = fixture();
    const initial = acquireInstallation(workspace, "exclusive", { defaultPair: pair }); initial.release();
    writeFileSync(join(pair.stateRoot, "state.db"), "source");
    writeFileSync(join(pair.artifactRoot, "a.artifact"), "artifact");
    const lease = acquireInstallation(workspace, "exclusive");
    const held = restore(workspace);
    const destination = { stateRoot: join(workspace, "new-state"), artifactRoot: join(workspace, "new-artifacts") };
    const plan = relocationPlan(lease, destination);
    const operationId = lease.beginRelocation(destination, plan, held);
    prepareDestination(lease, destination);
    const verify = staged(lease, destination, operationId, plan);
    lease.recordVerifiedStage(verify);
    lease.fenceRelocationSource();
    const journalPath = join(workspace, ".runtime-control", "journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as Record<string, unknown>;
    writeFileSync(journalPath, JSON.stringify({ ...journal, phase: "retaining" }), { mode: 0o600 });
    const retained = join(workspace, `.tracker.retained-${operationId}-state`);
    mkdirSync(retained, { mode: 0o700 });
    if (partial === "marker") copyFileSync(join(pair.stateRoot, ".runtime-owner.json"), join(retained, ".runtime-owner.json"));
    if (partial === "foreign") writeFileSync(join(retained, "foreign"), "unknown");
    lease.release(); held.release();
    const recoveredHeld = restore(workspace);
    const recovered = acquireInstallation(workspace, "exclusive", { recoverRelocation: {
      installationId: initial.locator.installationId, fromGeneration: 0, operationId, restoreAdmission: recoveredHeld,
    } });
    if (partial === "foreign") {
      expect(() => recovered.retainRelocationSources()).toThrow(/ambiguous retained shell/u);
      expect(readFileSync(join(pair.stateRoot, "state.db"), "utf8")).toBe("source");
    } else {
      recovered.retainRelocationSources();
      recovered.switchRelocationLocator(verify);
      recovered.settleRelocation(verify);
      expect(existsSync(join(workspace, ".runtime-control", "journal.json"))).toBe(false);
    }
    recovered.release(); recoveredHeld.release();
  }
});

it("refuses unknown managed state entries before source fencing", () => {
  const { workspace, pair } = fixture();
  const initial = acquireInstallation(workspace, "exclusive", { defaultPair: pair }); initial.release();
  writeFileSync(join(pair.stateRoot, "state.db"), "source");
  writeFileSync(join(pair.artifactRoot, "a.artifact"), "artifact");
  const lease = acquireInstallation(workspace, "exclusive");
  const held = restore(workspace);
  const destination = { stateRoot: join(workspace, "new-state"), artifactRoot: join(workspace, "new-artifacts") };
  const plan = relocationPlan(lease, destination);
  const operationId = lease.beginRelocation(destination, plan, held);
  prepareDestination(lease, destination);
  const verify = staged(lease, destination, operationId, plan);
  writeFileSync(join(pair.stateRoot, "unlisted.log"), "unknown");
  expect(() => lease.recordVerifiedStage(verify)).toThrow(/managed state entry membership mismatch/u);
  expect(existsSync(join(pair.stateRoot, ".runtime-source-fence.json"))).toBe(false);
  lease.release(); held.release();
});

it("refuses a mutex left by a crashed child without automatic reaping", async () => {
  const { workspace, pair } = fixture();
  const lease = acquireInstallation(workspace, "exclusive", { defaultPair: pair }); lease.release();
  const mutex = join(workspace, ".runtime-control", "admission-mutex");
  const child = spawn(process.execPath, ["--input-type=module", "-e", `import { mkdirSync, writeFileSync } from 'node:fs'; mkdirSync(${JSON.stringify(mutex)}, {mode:0o700}); writeFileSync(${JSON.stringify(join(mutex, "owner.json"))}, JSON.stringify({schemaVersion:1,acquisitionId:'00000000-0000-4000-8000-000000000000',phase:'admitting',pid:process.pid,processIdentity:{platform:process.platform,startToken:'synthetic'}}), {mode:0o600}); process.stdout.write('READY\\n'); setInterval(()=>{},1000);`], { stdio: ["ignore", "pipe", "pipe"] });
  try {
    await new Promise<void>((resolve, reject) => { child.stdout?.once("data", (data: Buffer) => data.toString().includes("READY") ? resolve() : reject(new Error(String(data)))); child.once("error", reject); child.once("exit", (code) => reject(new Error(`child exited ${String(code)}`))); });
  } finally { await stopChild(child); }
  expect(() => acquireInstallation(workspace, "shared")).toThrow(/admission mutex busy or abandoned; offline recovery required/u);
});

it("ignores a dead process lease after a crash outside the mutex", async () => {
  const { workspace, pair } = fixture();
  const initial = acquireInstallation(workspace, "exclusive", { defaultPair: pair }); initial.release();
  const moduleUrl = new URL("../../../src/infra/runtime-control/installation.ts", import.meta.url).href;
  const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `import { acquireInstallation } from ${JSON.stringify(moduleUrl)}; acquireInstallation(${JSON.stringify(workspace)}, 'shared'); process.stdout.write('READY\\n'); setInterval(() => {}, 1000);`], { stdio: ["ignore", "pipe", "pipe"] });
  try {
    await new Promise<void>((resolve, reject) => { child.stdout?.once("data", (data: Buffer) => data.toString().includes("READY") ? resolve() : reject(new Error(String(data)))); child.once("error", reject); child.once("exit", (code) => reject(new Error(`child exited ${String(code)}`))); });
    expect(() => acquireInstallation(workspace, "exclusive")).toThrow(/lease busy/u);
  } finally { await stopChild(child); }
  const afterCrash = acquireInstallation(workspace, "exclusive"); afterCrash.release();
});

it("serializes simultaneous shared and exclusive child-process admission", async () => {
  const { workspace, pair } = fixture();
  const initial = acquireInstallation(workspace, "exclusive", { defaultPair: pair }); initial.release();
  const gate = join(workspace, "go");
  const moduleUrl = new URL("../../../src/infra/runtime-control/installation.ts", import.meta.url).href;
  const launch = (mode: "shared" | "exclusive") => spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `import { existsSync } from 'node:fs'; import { acquireInstallation } from ${JSON.stringify(moduleUrl)}; const tick=setInterval(()=>{if(!existsSync(${JSON.stringify(gate)}))return;clearInterval(tick);try{acquireInstallation(${JSON.stringify(workspace)},${JSON.stringify(mode)});process.stdout.write('ACQUIRED');setInterval(()=>{},1000);}catch(error){process.stdout.write('REFUSED:'+String(error));}},1);`], { stdio: ["ignore", "pipe", "pipe"] });
  const shared = launch("shared");
  const exclusive = launch("exclusive");
  try {
    const output = (child: typeof shared) => new Promise<string>((resolve, reject) => { child.stdout?.once("data", (data: Buffer) => resolve(data.toString())); child.once("error", reject); child.once("exit", (code) => reject(new Error(`child exited ${String(code)}`))); });
    const sharedOutput = output(shared);
    const exclusiveOutput = output(exclusive);
    writeFileSync(gate, "go");
    const results = await Promise.all([sharedOutput, exclusiveOutput]);
    expect(results.filter((result) => result === "ACQUIRED")).toHaveLength(1);
    expect(results.filter((result) => result.startsWith("REFUSED:") && result.includes("runtime-control:"))).toHaveLength(1);
  } finally {
    await Promise.all([stopChild(shared), stopChild(exclusive)]);
  }
});
