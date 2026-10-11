import assert_m0 from "node:assert/strict";
import { existsSync as existsSync_m0,mkdtempSync as mkdtempSync_m0,mkdtempSync as mkdtempSync_m1,mkdtempSync as mkdtempSync_m2,readdirSync as readdirSync_m0,readFileSync as readFileSync_m0,realpathSync as realpathSync_m0,realpathSync as realpathSync_m2,rmSync as rmSync_m0,rmSync as rmSync_m1,rmSync as rmSync_m2 } from "node:fs";
import { tmpdir as tmpdir_m0,tmpdir as tmpdir_m1,tmpdir as tmpdir_m2 } from "node:os";
import { join as join_m0,join as join_m1,join as join_m2 } from "node:path";
import { DatabaseSync as DatabaseSync_m1 } from "node:sqlite";
import { afterEach as afterEach_m1,afterEach as afterEach_m2,describe as describe_m1,describe as describe_m2,expect as expect_m1,expect as expect_m2,it as it_m0,it as it_m1,it as it_m2,vi } from "vitest";
import { composeStorageCommand as composeStorageCommand_m0 } from "../../../../src/backend/app/composition/storage-compose.js";
import { rebuildRuntimeIsolation as rebuildRuntimeIsolation_m0,rebuildRuntimeIsolation as rebuildRuntimeIsolation_m2 } from "../../../../src/backend/app/config/runtime-isolation.js";
import { acquireSharedRuntimeAdmission as acquireSharedRuntimeAdmission_m0,RuntimeAdmission as RuntimeAdmission_m0,RuntimeAdmission as RuntimeAdmission_m1 } from "../../../../src/backend/storage/admission/admission.js";
import { acquireEntrypointAdmission as acquireEntrypointAdmission_m2 } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { createContentAddressedArtifactWriter as createContentAddressedArtifactWriter_m0,pendingDiagnosticArtifacts as pendingDiagnosticArtifacts_m0 } from "../../../../src/backend/storage/artifacts/content-addressed-artifact-writer.js";
import { upgradeStorage as upgradeStorage_m0 } from "../../../../src/backend/storage/maintenance/upgrade.js";
import { AuthorityDatabase as AuthorityDatabase_m1,AuthorityDatabase as AuthorityDatabase_m2,AuthoritySchemaVersionError as AuthoritySchemaVersionError_m1,AuthorityDatabase as NativeDatabase_m0 } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { acquireRuntimeProcessLock as acquireRuntimeProcessLock_m0,acquireRuntimeProcessLock as acquireRuntimeProcessLock_m2,observeRuntimeLockSnapshot as observeRuntimeLockSnapshot_m2,type RuntimeProcessLockHandle as RuntimeProcessLockHandle_m2 } from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { manualClock as manualClock_m0 } from "../../../../src/rules/time/clock.js";
import { HASH_A as HASH_A_m2 } from "../../../support/fixtures/phase1c-contract-fixtures.js";


{


it_m0("uses the existing stopped upgrade maintenance door without changing authority or plan bytes", async () => {
  const root = realpathSync_m0(mkdtempSync_m0(join_m0(tmpdir_m0(), "diagnostic-maintenance-")));
  const clock = manualClock_m0(new Date("2026-01-01T12:00:00.000Z"));
  const admission = RuntimeAdmission_m0.acquireInitial(root, (pair, inspection) => ({ kind: "verified-existing", pair,
    authorityGeneration: NativeDatabase_m0.inspectExistingReadOnly(inspection, join_m0(pair.stateRoot, "state.db")).authorityGeneration,
    databaseIdentity: NativeDatabase_m0.sourceDatabaseIdentity(join_m0(pair.stateRoot, "state.db")) }), (pair, initialization) => {
    NativeDatabase_m0.open(initialization, { path: join_m0(pair.stateRoot, "state.db"), busyTimeoutMs: 250, migrationOwner: "diagnostic-maintenance" }, clock).close();
  });
  const stateRoot = admission.stateRoot, artifactRoot = admission.artifactRoot;
  const input = { stateRoot, processLockRoot: join_m0(root, rebuildRuntimeIsolation_m0.processLockRoot), plan: false };
  try {
    const noWork = await composeStorageCommand_m0(rebuildRuntimeIsolation_m0, ["upgrade"], clock, root, admission);
    assert_m0.deepEqual(noWork, { output: "storage upgrade: already-upgraded (v1 → v1)\ncredentials: unchanged", exitCode: 0 });
    const writer = createContentAddressedArtifactWriter_m0({ admission });
    const ordinary = await writer.stageDiagnostic(Buffer.from("ordinary pending"), { mediaType: "application/json" }, "ordinary"); ordinary.publish();
    const pinned = await writer.stageDiagnostic(Buffer.from("protected pending"), { mediaType: "application/json" }, "pinned"); pinned.publish();
    const before = readdirSync_m0(artifactRoot).sort();
    const databasePath = join_m0(stateRoot, "state.db"), databaseBytes = readFileSync_m0(databasePath);
    const inspection = NativeDatabase_m0.inspectExistingReadOnly(admission, databasePath);
    const plan = await upgradeStorage_m0(admission, { ...input, plan: true }, clock);
    assert_m0.equal(plan.state, "planned"); assert_m0.equal(plan.diagnostics, undefined);
    assert_m0.deepEqual(readdirSync_m0(artifactRoot).sort(), before); assert_m0.deepEqual(readFileSync_m0(databasePath), databaseBytes);
    const live = acquireRuntimeProcessLock_m0({ processLockRoot: input.processLockRoot, name: "live-smoke", pid: process.pid }, clock);
    try { await assert_m0.rejects(upgradeStorage_m0(admission, input, clock), /runtime-active/u); assert_m0.deepEqual(readdirSync_m0(artifactRoot).sort(), before); }
    finally { live.release(); }
    const report = await upgradeStorage_m0(admission, input, clock);
    assert_m0.deepEqual(report.diagnostics, { reclaimedStages: 1, retainedStages: 1, capacityWarning: true });
    assert_m0.equal(existsSync_m0(join_m0(artifactRoot, `${ordinary.ref.sha256}.artifact`)), false);
    assert_m0.equal(existsSync_m0(join_m0(artifactRoot, `${pinned.ref.sha256}.artifact`)), true);
    assert_m0.deepEqual(pendingDiagnosticArtifacts_m0(admission), [pinned.ref]);
    const cli = await composeStorageCommand_m0(rebuildRuntimeIsolation_m0, ["upgrade"], clock, root, admission);
    assert_m0.deepEqual(cli, { output: "storage upgrade: already-upgraded (v1 → v1)\ncredentials: unchanged\ndiagnostic stages: 0 reclaimed, 1 retained; retained evidence remains budget-accounted", exitCode: 0 });
    assert_m0.deepEqual(readFileSync_m0(databasePath), databaseBytes);
    const after = NativeDatabase_m0.inspectExistingReadOnly(admission, databasePath);
    assert_m0.equal(after.authorityGeneration, inspection.authorityGeneration);
    assert_m0.equal(after.authorityContentFingerprint, inspection.authorityContentFingerprint);
    admission.release();
    const shared = acquireSharedRuntimeAdmission_m0(root);
    try { await assert_m0.rejects(upgradeStorage_m0(shared, input, clock), /exclusive offline admission required/u); }
    finally { shared.release(); }
  } finally { admission.release(); rmSync_m0(root, { recursive: true, force: true }); }
});
}

{

const roots:string[]=[];
const _afterEachFixture0 = ()=>{vi.restoreAllMocks();for(const root of roots.splice(0))rmSync_m1(root,{recursive:true,force:true});};
function fixture() {
  const root=mkdtempSync_m1(join_m1(tmpdir_m1(),"relay-native-authority-"));roots.push(root);
  const path=join_m1(root,"authority.sqlite");
  const admission=RuntimeAdmission_m1.syntheticFixture(path);
  const open=()=>AuthorityDatabase_m1.open(admission,{path,busyTimeoutMs:250,migrationOwner:"native-test"});
  return {path,open,admission};
}
describe_m1("native authority admission",()=>{
afterEach_m1(_afterEachFixture0);

  it_m1.each([0,2,48,99])("refuses version %i without rewriting its header or retained rows",version=>{
    const f=fixture();f.open().close();
    const db=new DatabaseSync_m1(f.path);db.exec(`PRAGMA user_version=${String(version)}`);
    const baseline=db.prepare("SELECT * FROM database_upgrades").all();db.close();
    expect_m1(f.open).toThrow(AuthoritySchemaVersionError_m1);
    const after=new DatabaseSync_m1(f.path,{readOnly:true});
    try {expect_m1(after.prepare("PRAGMA user_version").get()?.user_version).toBe(version);
      expect_m1(after.prepare("SELECT * FROM database_upgrades").all()).toEqual(baseline);}
    finally {after.close();}
  });
});
}

{

const roots: string[] = [];
const _afterEachFixture0 = () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) rmSync_m2(root, { recursive: true, force: true }); };

describe_m2("first installation worker custody", () => {
afterEach_m2(_afterEachFixture0);

  function initialFixture() {
    const workspace = realpathSync_m2(mkdtempSync_m2(join_m2(tmpdir_m2(), "relay-first-worker-"))); roots.push(workspace);
    const root = join_m2(workspace, rebuildRuntimeIsolation_m2.processLockRoot);
    const authorityPath = join_m2(workspace, rebuildRuntimeIsolation_m2.stateRoot, "state.db");
    let custody: RuntimeProcessLockHandle_m2 | undefined;
    const snapshot = () => observeRuntimeLockSnapshot_m2({ processLockRoot: root, sourceDatabaseIdentity: HASH_A_m2 });
    const acquire = () => acquireEntrypointAdmission_m2(workspace, "shared", pair => {
      expect_m2(join_m2(pair.stateRoot, "state.db")).toBe(authorityPath);
      custody ??= acquireRuntimeProcessLock_m2({ processLockRoot: root, name: "workers", pid: process.pid,
        admission: { kind: "unbound-worker", authorityPath } });
    });
    return { root, authorityPath, snapshot, acquire, custody: () => {
      if (custody === undefined) throw new Error("missing first-install custody"); return custody;
    } };
  }
  it_m2("retains blocking first-install custody on an AuthorityDatabase opening callback failure", () => {
    const f = initialFixture();
    vi.spyOn(AuthorityDatabase_m2, "open").mockImplementation(() => {
      expect_m2(f.snapshot().processLocks.workers.state).toBe("active"); throw new Error("initial-open-fault");
    });
    expect_m2(f.acquire).toThrow("initial-open-fault");
    expect_m2(f.snapshot().processLocks.workers.state).toBe("active"); f.custody().release();
  });
  it_m2("retains blocking custody through a first-install close fault", () => {
    const f = initialFixture();
    const originalClose = Object.getOwnPropertyDescriptor(AuthorityDatabase_m2.prototype, "close")?.value as (this: AuthorityDatabase_m2) => void;
    vi.spyOn(AuthorityDatabase_m2.prototype, "close").mockImplementation(function (this: AuthorityDatabase_m2) {
      expect_m2(f.snapshot().processLocks.workers.state).toBe("active");
      originalClose.call(this); throw new Error("initial-close-unproved");
    });
    expect_m2(f.acquire).toThrow("initial-close-unproved");
    expect_m2(f.snapshot().processLocks.workers.state).toBe("active"); f.custody().release();
  });
});
}
