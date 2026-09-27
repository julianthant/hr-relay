import { randomUUID } from "node:crypto";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { executeStorageRelocationCommand } from "../../../src/core/command-kernel.js";
import { createStorageRelocationPlanReader } from "../../../src/core/storage-relocation-plans.js";
import { manualClock } from "../../../src/domain/clock.js";
import { StorageRelocationCommandRequestSchema, storageRelocationDesiredDigest,
  storageRelocationRequestFingerprint } from "../../../src/domain/commands.js";
import { hostConfigFacts } from "../../../src/domain/config/host-display.js";
import { resolveConfigWithProvenance } from "../../../src/domain/config/resolve.js";
import { NonNegativeIntSchema } from "../../../src/domain/ids.js";
import { RuntimeAdmission } from "../../../src/infra/runtime-control/admission.js";
import { acquireInstallation } from "../../../src/infra/runtime-control/installation.js";
import { inspectAuthorityBackupReadOnly } from "../../../src/infra/compat/backup-inspection.js";
import { AuthorityDatabase } from "../../../src/infra/sqlite/authority-database.js";
import { AuthorityBackupService, verifyBackupManifestAtPath } from "../../../src/infra/sqlite/backup-service.js";
import { validateStorageRelocationRestoreCandidate } from "../../../src/infra/sqlite/relocation-restore-candidate.js";
import { acquireRuntimeRestoreAdmission } from "../../../src/infra/sqlite/runtime-process-locks.js";

const clock = manualClock(new Date("2026-09-26T12:00:00.000Z"));
const workspaces: string[] = [];
afterEach(() => { for (const workspace of workspaces.splice(0)) rmSync(workspace, { recursive: true, force: true }); });

it("requires the entire receipt-backed plan history and activation snapshot in a moved restore candidate", async () => {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), "relocation-candidate-")));
  workspaces.push(workspace);
  const pair = { stateRoot: join(workspace, ".tracker"), artifactRoot: join(workspace, ".tracker", "artifacts") };
  const path = join(pair.stateRoot, "state.db");
  const admission = RuntimeAdmission.acquireInitial(workspace, (candidate, inspection) => {
    const examined = AuthorityDatabase.inspectExistingReadOnly(inspection, path);
    return { kind: "verified-existing", pair: candidate, authorityGeneration: examined.authorityGeneration,
      databaseIdentity: AuthorityDatabase.sourceDatabaseIdentity(path) };
  }, (_candidate, initialization) => {
    AuthorityDatabase.open(initialization, { path, busyTimeoutMs: 250, migrationOwner: "unit-test" }, clock).close();
  });
  const database = AuthorityDatabase.open(admission, { path, busyTimeoutMs: 250, migrationOwner: "unit-test" }, clock);
  const backupDirectory = join(pair.stateRoot, "backups", "authority");
  const backupService = new AuthorityBackupService(admission, database, { directory: backupDirectory }, clock);
  const backup = async () => {
    const report = await backupService.request({ trigger: "operator", requiredGeneration: database.getMeta().authorityGeneration });
    const manifest = report.manifests.at(-1);
    if (manifest === undefined) throw new Error("missing fixture backup");
    return verifyBackupManifestAtPath(admission,
      join(backupDirectory, `${manifest.backupFileName}.manifest.json`), AuthorityDatabase.sourceDatabaseIdentity(path));
  };
  const withoutHistory = await backup();
  expect(validateStorageRelocationRestoreCandidate({ admission, activeAuthorityPath: path,
    verifiedBackup: withoutHistory })).toBeUndefined();
  const producer = createStorageRelocationPlanReader({ authority: database, admission, workspace });
  const destination = { stateRoot: pair.stateRoot, artifactRoot: join(workspace, "moved-artifacts") };
  const target = { installationId: admission.locator.installationId, sourceGeneration: 0, sourcePair: pair, expectedRevision: 0 };
  const draft = StorageRelocationCommandRequestSchema.parse({ family: "storage-relocation", type: "plan-storage-relocation",
    commandId: randomUUID(), requestedAt: clock.now().toISOString(), requestedBy: "local-operator", source: "settings-surface",
    target, payload: { writeId: randomUUID(), desiredPair: destination,
      desiredDigest: storageRelocationDesiredDigest({ ...target, sourceGeneration: NonNegativeIntSchema.parse(0),
        expectedRevision: NonNegativeIntSchema.parse(0) }, destination), requestFingerprint: "0".repeat(64) } });
  const request = StorageRelocationCommandRequestSchema.parse({ ...draft, payload: { ...draft.payload,
    requestFingerprint: storageRelocationRequestFingerprint(draft) } });
  if (request.type !== "plan-storage-relocation") throw new Error("expected plan command");
  expect(executeStorageRelocationCommand({ authority: database, clock, ids: { uuid: randomUUID },
    storageRelocationPlans: producer }, request).state).toBe("applied");
  const withoutSnapshot = await backup();
  const configSnapshotId = randomUUID();
  const resolved = resolveConfigWithProvenance({}, hostConfigFacts({}), clock);
  database.withAuthorityTransaction((repositories) => repositories.configSnapshots.insert({
    configSnapshotId, revision: 1, fingerprint: resolved.fingerprint, config: resolved.config,
    provenance: resolved.provenance, capturedAt: clock.now().toISOString(), capturedBy: "local-operator",
  }));
  database.close(); admission.release();

  const lease = acquireInstallation(workspace, "exclusive");
  const held = acquireRuntimeRestoreAdmission({ processLockRoot: join(workspace, ".tracker", "locks"), pid: process.pid });
  const plan = { commandId: request.commandId, revision: 1, expectedRevision: 0,
    requestFingerprint: request.payload.requestFingerprint, desiredDigest: request.payload.desiredDigest };
  const operationId = lease.beginRelocation(destination, plan, held);
  lease.prepareDestinationRoots();
  const sourceAdmission = RuntimeAdmission.fromInstallationLease(lease);
  const inspection = inspectAuthorityBackupReadOnly(sourceAdmission, path);
  const preparation = { operationId, installationId: lease.locator.installationId, sourceGeneration: 0,
    source: pair, destination, plan, sourceDatabaseIdentity: AuthorityDatabase.sourceDatabaseIdentity(path),
    sourceSchemaVersion: 56 as const, sourceAuthorityGeneration: inspection.authorityGeneration,
    sourceAuthorityContentFingerprint: inspection.authorityContentFingerprint, backupReceiptId: "fixture-before-move",
    backupManifestPath: withoutSnapshot.manifestPath, backupManifestSha256: "1".repeat(64),
    backupFilePath: withoutSnapshot.backupPath, backupFileSha256: withoutSnapshot.manifest.sha256 };
  lease.recordVerifiedPreparation(() => preparation);
  const evidence = { operationId, installationId: lease.locator.installationId, sourceGeneration: 0,
    source: pair, destination, plan, stagingReceiptId: "fixture-stage", stagingDigest: "2".repeat(64),
    backupReceiptId: "fixture-final", backupDigest: "3".repeat(64), finalDatabasePath: path,
    configSnapshotId, configFingerprint: resolved.fingerprint, authorityVersion: 56 as const,
    databaseIdentity: AuthorityDatabase.sourceDatabaseIdentity(path), managedStateEntries: [] };
  lease.recordVerifiedStage(() => evidence);
  lease.fenceRelocationSource(); lease.retainRelocationSources();
  lease.switchRelocationLocator(() => evidence); lease.settleRelocation(() => evidence);
  sourceAdmission.release(); held.release();

  const active = RuntimeAdmission.fromInstallationLease(acquireInstallation(workspace, "exclusive"));
  const current = AuthorityDatabase.open(active, { path, busyTimeoutMs: 250, migrationOwner: "unit-test" }, clock);
  const currentService = new AuthorityBackupService(active, current, { directory: backupDirectory }, clock);
  const report = await currentService.request({ trigger: "operator", requiredGeneration: current.getMeta().authorityGeneration });
  const manifest = report.manifests.at(-1);
  if (manifest === undefined) throw new Error("missing final fixture backup");
  const complete = await verifyBackupManifestAtPath(active,
    join(backupDirectory, `${manifest.backupFileName}.manifest.json`), AuthorityDatabase.sourceDatabaseIdentity(path));
  expect(() => validateStorageRelocationRestoreCandidate({ admission: active, activeAuthorityPath: path,
    verifiedBackup: withoutHistory })).toThrow(/activation receipt has no matching plan command/u);
  expect(() => validateStorageRelocationRestoreCandidate({ admission: active, activeAuthorityPath: path,
    verifiedBackup: withoutSnapshot })).toThrow(/activation snapshot missing/u);
  expect(() => validateStorageRelocationRestoreCandidate({ admission: active,
    activeAuthorityPath: join(workspace, "former", "state.db"), verifiedBackup: complete }))
    .toThrow(/active authority path differs from locator/u);
  expect(validateStorageRelocationRestoreCandidate({ admission: active, activeAuthorityPath: path,
    verifiedBackup: complete })).toMatchObject({ revision: 1, sourceGeneration: 1, pending: null });
  current.close(); active.release();
});
