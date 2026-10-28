import { runtimeLifetimeLock } from "./runtime-lifetime.js";
import type { RuntimeLifetimeLock } from "../../../../src/backend/storage/admission/lifetime-lock.js";
import assert from "node:assert/strict";
import { acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../../../src/backend/storage/sqlite/migrations.js";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { acquireInstallation, type ExclusiveInstallationLease, type RelocationPlanBinding, type RuntimePair, type VerifiedRelocationEvidence, type VerifiedRelocationPreparation } from "../../../../src/backend/storage/admission/installation.js";
import { acquireRuntimeRestoreAdmission, type RestoreAdmissionHandle } from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { hostConfigFacts } from "../../../../src/models/config/host-display.js";
import { ConfigSnapshotWriteSchema } from "../../../../src/models/config/snapshot.js";
import { storageRelocationDesiredDigest } from "../../../../src/rules/commands/commands.js";
import { NonNegativeIntSchema } from "../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";





export function createInstallationControlTestWorld() {
  const workspaces: string[] = [];

  async function fixture(): Promise<{ workspace: string; pair: RuntimePair; lifetime: RuntimeLifetimeLock }> {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "runtime-control-")));
    workspaces.push(root);
    const lifetime = await runtimeLifetimeLock();
    const workspace = join(root, "workspace");
    mkdirSync(workspace, { mode: 0o700 });
    mkdirSync(join(workspace, ".tracker"), { mode: 0o700 });
    return { workspace, lifetime, pair: { stateRoot: join(workspace, ".tracker/data"), artifactRoot: join(workspace, ".tracker/data", "artifacts") } };
  }

  function restore(workspace: string): RestoreAdmissionHandle {
    return acquireRuntimeRestoreAdmission({ processLockRoot: join(workspace, ".tracker/data", "locks"), pid: process.pid });
  }

  function adoptSynthetic(workspace: string, pair: RuntimePair, lifetime: RuntimeLifetimeLock): ExclusiveInstallationLease {
    const machine = acquireEntrypointAdmission(workspace, "exclusive", lifetime);
    assert.equal(machine.stateRoot, pair.stateRoot);
    assert.equal(machine.artifactRoot, pair.artifactRoot);
    machine.release();
    return acquireInstallation(workspace, "exclusive", lifetime);
  }

  function relocationPlan(lease: ExclusiveInstallationLease, destination: RuntimePair): RelocationPlanBinding {
    return { commandId: "11111111-1111-4111-8111-111111111111", revision: 1, expectedRevision: 0,
      requestFingerprint: "a".repeat(64),
      desiredDigest: storageRelocationDesiredDigest({ installationId: lease.locator.installationId,
        sourceGeneration: NonNegativeIntSchema.parse(lease.locator.generation), sourcePair: { stateRoot: lease.locator.stateRoot,
          artifactRoot: lease.locator.artifactRoot }, expectedRevision: NonNegativeIntSchema.parse(0) }, destination) };
  }

  function prepareDestination(lease: ExclusiveInstallationLease, destination: RuntimePair): void {
    lease.prepareDestinationRoots();
    if (destination.stateRoot !== lease.locator.stateRoot) {
      copyFileSync(join(lease.locator.stateRoot, "state.db"), join(destination.stateRoot, "state.db"));
    }
    if (destination.artifactRoot !== lease.locator.artifactRoot) {
      copyFileSync(join(lease.locator.artifactRoot, "a.artifact"), join(destination.artifactRoot, "a.artifact"));
    }
  }

  function staged(lease: ExclusiveInstallationLease, destination: RuntimePair, operationId: string,
    plan: RelocationPlanBinding): () => VerifiedRelocationEvidence {
    if (lease.relocationInventory().phase === "preparing") {
      const preparation: VerifiedRelocationPreparation = { operationId, installationId: lease.locator.installationId,
        sourceGeneration: lease.locator.generation, source: { stateRoot: lease.locator.stateRoot,
          artifactRoot: lease.locator.artifactRoot }, destination, plan,
        sourceDatabaseIdentity: "e".repeat(64), sourceSchemaVersion: CURRENT_AUTHORITY_SCHEMA_VERSION, sourceAuthorityGeneration: 0,
        sourceAuthorityContentFingerprint: "f".repeat(64), backupReceiptId: "synthetic-preupgrade-backup",
        backupManifestPath: join(lease.locator.stateRoot, "backups", "authority", "preupgrade.manifest.json"),
        backupManifestSha256: "1".repeat(64),
        backupFilePath: join(lease.locator.stateRoot, "backups", "authority", "preupgrade.sqlite"),
        backupFileSha256: "2".repeat(64) };
      lease.recordVerifiedPreparation(() => preparation);
    }
    const inventory = lease.relocationInventory();
    const pinned = new Set(inventory.pinnedEntries);
    const entryShell = inventory.retentions.find((row) => row.role === "state" && row.strategy !== "whole-root");
    const managedStateEntries = entryShell
      ? readdirSync(lease.locator.stateRoot).filter((name) => ![...(entryShell.strategy === "lock-shell" ? ["locks"] : []),
        ".runtime-owner.json", ".runtime-source-fence.json"].includes(name)
        && !pinned.has(name))
        .map((name) => ({ name, kind: statSync(join(lease.locator.stateRoot, name)).isDirectory() ? "directory" as const : "file" as const })) : [];
    const ordinary = resolveConfigWithProvenance({}, hostConfigFacts({}), manualClock(new Date("2026-09-26T12:00:00.000Z")));
    const config = { ...ordinary.config, paths: { ...ordinary.config.paths,
      stateRoot: destination.stateRoot, artifactRoot: destination.artifactRoot } };
    const fingerprint = createHash("sha256").update(canonicalJsonStringify(config)).digest("hex");
    const evidence: VerifiedRelocationEvidence = { operationId, installationId: lease.locator.installationId,
      sourceGeneration: lease.locator.generation, source: { stateRoot: lease.locator.stateRoot, artifactRoot: lease.locator.artifactRoot },
      destination, plan, stagingReceiptId: "synthetic-stage", stagingDigest: "b".repeat(64),
      backupReceiptId: "synthetic-backup", backupDigest: "c".repeat(64), finalDatabasePath: join(destination.stateRoot, "state.db"),
      configSnapshotId: "22222222-2222-4222-8222-222222222222", configFingerprint: fingerprint,
      authorityVersion: CURRENT_AUTHORITY_SCHEMA_VERSION, databaseIdentity: "synthetic-db", managedStateEntries };
    lease.recordActivationIntent(() => ({ operationId, installationId: lease.locator.installationId,
      sourceGeneration: lease.locator.generation, source: { stateRoot: lease.locator.stateRoot,
        artifactRoot: lease.locator.artifactRoot }, destination, plan,
      stageAuthority: { manifestPath: join(lease.locator.stateRoot, "backups", "authority", "stage.manifest.json"),
        manifestSha256: "1".repeat(64), backupPath: join(lease.locator.stateRoot, "backups", "authority", "stage.sqlite"),
        backupSha256: "2".repeat(64) },
      nativeDestinationPath: join(destination.stateRoot, "state.db"),
      nativeDestinationSha256: destination.stateRoot === lease.locator.stateRoot ? null : "2".repeat(64),
      preAuthorityGeneration: 0, preAuthorityContentFingerprint: "3".repeat(64),
      managedInventoryDigest: "4".repeat(64), settingsRevision: 1, settingsFingerprint: "5".repeat(64),
      priorActive: null, snapshot: ConfigSnapshotWriteSchema.parse({ configSnapshotId: evidence.configSnapshotId, revision: 1,
        fingerprint, capturedAt: "2026-09-26T12:00:00.000Z", capturedBy: "local-operator",
        config, provenance: ordinary.provenance }) }));
    return () => evidence;
  }
  const cleanup = () => { for (const workspace of workspaces.splice(0)) rmSync(workspace, { recursive: true, force: true }); };
  return { workspaces, fixture, restore, adoptSynthetic, relocationPlan, prepareDestination, staged, cleanup };
}
