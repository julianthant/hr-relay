import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { composeStorageCommand } from "../../../../src/backend/app/composition/storage-compose.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { acquireSharedRuntimeAdmission, RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { createContentAddressedArtifactWriter, pendingDiagnosticArtifacts } from "../../../../src/backend/storage/artifacts/content-addressed-artifact-writer.js";
import { upgradeStorage } from "../../../../src/backend/storage/maintenance/upgrade.js";
import { AuthorityDatabase, AuthoritySchemaVersionError } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { acquireRuntimeProcessLock } from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { createFirstInstallCustodyFixture } from "../../../support/helpers/storage/first-install-custody-fixtures.js";
import { HASH_A } from "../../../support/fixtures/phase1c-contract-fixtures.js";

{

it("uses the existing stopped upgrade maintenance door without changing authority or plan bytes", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "diagnostic-maintenance-")));
  const clock = manualClock(new Date("2026-01-01T12:00:00.000Z"));
  const admission = RuntimeAdmission.acquireInitial(root, (pair, inspection) => ({ kind: "verified-existing", pair,
    authorityGeneration: AuthorityDatabase.inspectExistingReadOnly(inspection, join(pair.stateRoot, "state.db")).authorityGeneration,
    databaseIdentity: AuthorityDatabase.sourceDatabaseIdentity(join(pair.stateRoot, "state.db")) }), (pair, initialization) => {
    AuthorityDatabase.open(initialization, { path: join(pair.stateRoot, "state.db"), busyTimeoutMs: 250, migrationOwner: "diagnostic-maintenance" }, clock).close();
  });
  const stateRoot = admission.stateRoot, artifactRoot = admission.artifactRoot;
  const input = { stateRoot, processLockRoot: join(root, rebuildRuntimeIsolation.processLockRoot), plan: false };
  try {
    const noWork = await composeStorageCommand(rebuildRuntimeIsolation, ["upgrade"], clock, root, admission);
    assert.deepEqual(noWork, { output: "storage upgrade: already-upgraded (v5 → v5)\ncredentials: unchanged", exitCode: 0 });
    const writer = createContentAddressedArtifactWriter({ admission });
    const ordinary = await writer.stageDiagnostic(Buffer.from("ordinary pending"), { mediaType: "application/json" }, "ordinary"); ordinary.publish();
    const pinned = await writer.stageDiagnostic(Buffer.from("protected pending"), { mediaType: "application/json" }, "pinned"); pinned.publish();
    const before = readdirSync(artifactRoot).sort();
    const databasePath = join(stateRoot, "state.db"), databaseBytes = readFileSync(databasePath);
    const inspection = AuthorityDatabase.inspectExistingReadOnly(admission, databasePath);
    const plan = await upgradeStorage(admission, { ...input, plan: true }, clock);
    assert.equal(plan.state, "planned"); assert.equal(plan.diagnostics, undefined);
    assert.deepEqual(readdirSync(artifactRoot).sort(), before); assert.deepEqual(readFileSync(databasePath), databaseBytes);
    const live = acquireRuntimeProcessLock({ processLockRoot: input.processLockRoot, name: "live-smoke", pid: process.pid }, clock);
    try { await assert.rejects(upgradeStorage(admission, input, clock), /runtime-active/u); assert.deepEqual(readdirSync(artifactRoot).sort(), before); }
    finally { live.release(); }
    const report = await upgradeStorage(admission, input, clock);
    assert.deepEqual(report.diagnostics, { reclaimedStages: 1, retainedStages: 1, capacityWarning: true });
    assert.equal(existsSync(join(artifactRoot, `${ordinary.ref.sha256}.artifact`)), false);
    assert.equal(existsSync(join(artifactRoot, `${pinned.ref.sha256}.artifact`)), true);
    assert.deepEqual(pendingDiagnosticArtifacts(admission), [pinned.ref]);
    const cli = await composeStorageCommand(rebuildRuntimeIsolation, ["upgrade"], clock, root, admission);
    assert.deepEqual(cli, { output: "storage upgrade: already-upgraded (v5 → v5)\ncredentials: unchanged\ndiagnostic stages: 0 reclaimed, 1 retained; retained evidence remains budget-accounted", exitCode: 0 });
    assert.deepEqual(readFileSync(databasePath), databaseBytes);
    const after = AuthorityDatabase.inspectExistingReadOnly(admission, databasePath);
    assert.equal(after.authorityGeneration, inspection.authorityGeneration);
    assert.equal(after.authorityContentFingerprint, inspection.authorityContentFingerprint);
    admission.release();
    const shared = acquireSharedRuntimeAdmission(root);
    try { await assert.rejects(upgradeStorage(shared, input, clock), /exclusive offline admission required/u); }
    finally { shared.release(); }
  } finally { admission.release(); rmSync(root, { recursive: true, force: true }); }
});
}

{

const roots:string[]=[];
const _afterEachFixture0 = ()=>{vi.restoreAllMocks();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});};
function fixture() {
  const root=mkdtempSync(join(tmpdir(),"relay-native-authority-"));roots.push(root);
  const path=join(root,"authority.sqlite");
  const admission=RuntimeAdmission.syntheticFixture(path);
  const open=()=>AuthorityDatabase.open(admission,{path,busyTimeoutMs:250,migrationOwner:"native-test"});
  return {path,open,admission};
}
describe("native authority admission",()=>{
afterEach(_afterEachFixture0);

  it.each([0,1,48,99])("refuses version %i without rewriting its header or retained rows",version=>{
    const f=fixture();f.open().close();
    const db=new DatabaseSync(f.path);db.exec(`PRAGMA user_version=${String(version)}`);
    const baseline=db.prepare("SELECT * FROM database_upgrades").all();db.close();
    expect(f.open).toThrow(AuthoritySchemaVersionError);
    const after=new DatabaseSync(f.path,{readOnly:true});
    try {expect(after.prepare("PRAGMA user_version").get()?.user_version).toBe(version);
      expect(after.prepare("SELECT * FROM database_upgrades").all()).toEqual(baseline);}
    finally {after.close();}
  });
});
}

{

const roots: string[] = [];
const _afterEachFixture0 = () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); };

describe("first installation worker custody", () => {
afterEach(_afterEachFixture0);

  function initialFixture() {
    return createFirstInstallCustodyFixture(roots, HASH_A);
  }
  it("retains blocking first-install custody on an AuthorityDatabase opening callback failure", () => {
    const f = initialFixture();
    vi.spyOn(AuthorityDatabase, "open").mockImplementation(() => {
      expect(f.snapshot().processLocks.workers.state).toBe("active"); throw new Error("initial-open-fault");
    });
    expect(f.acquire).toThrow("initial-open-fault");
    expect(f.snapshot().processLocks.workers.state).toBe("active"); f.custody().release();
  });
  it("retains blocking custody through a first-install close fault", () => {
    const f = initialFixture();
    const originalClose = Object.getOwnPropertyDescriptor(AuthorityDatabase.prototype, "close")?.value as (this: AuthorityDatabase) => void;
    vi.spyOn(AuthorityDatabase.prototype, "close").mockImplementation(function (this: AuthorityDatabase) {
      expect(f.snapshot().processLocks.workers.state).toBe("active");
      originalClose.call(this); throw new Error("initial-close-unproved");
    });
    expect(f.acquire).toThrow("initial-close-unproved");
    expect(f.snapshot().processLocks.workers.state).toBe("active"); f.custody().release();
  });
});
}
