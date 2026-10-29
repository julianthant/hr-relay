import { profileBrowserClosure } from "../../../../src/backend/runtime/browser/native-profile-probe.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../../../src/backend/storage/sqlite/migrations.js";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { composeStorageCommand } from "../../../../src/backend/app/composition/storage-compose.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { acquireSharedRuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { createContentAddressedArtifactWriter, pendingDiagnosticArtifacts } from "../../../../src/backend/storage/artifacts/content-addressed-artifact-writer.js";
import { upgradeStorage } from "../../../../src/backend/storage/maintenance/upgrade.js";
import { AuthorityDatabase, AuthoritySchemaVersionError } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { acquireRuntimeProcessLock } from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { createFirstInstallCustodyFixture } from "../../../support/helpers/storage/first-install-custody-fixtures.js";
import { createBoundProfileFixture, boundProfileCredentials } from "../../../support/helpers/admission-fixture.js";
import { AuthoritySourceClosureUnprovedError, retainAuthoritySourceClosure } from "../../../../src/backend/storage/source-closure.js";
import { HASH_A } from "../../../support/fixtures/phase1c-contract-fixtures.js";

const retainedFixtureOwners: unknown[] = [];

{

it("uses the existing stopped upgrade maintenance door without changing authority or plan bytes", async () => {
  const profile = await createBoundProfileFixture();
  const root = profile.workspace;
  const clock = manualClock(new Date("2026-01-01T12:00:00.000Z"));
  const admission = profile.admission;
  const profileId = admission.profileBinding.profileId;
  let primary: { error: unknown } | undefined = undefined;
  const stateRoot = admission.stateRoot, artifactRoot = admission.artifactRoot;
  const input = { stateRoot, processLockRoot: join(root, rebuildRuntimeIsolation.processLockRoot), plan: false };
  try {
    const noWork = await composeStorageCommand(rebuildRuntimeIsolation, ["upgrade"], clock, root, admission);
    assert.deepEqual(noWork, { output: `storage upgrade: already-upgraded (v${CURRENT_AUTHORITY_SCHEMA_VERSION} → v${CURRENT_AUTHORITY_SCHEMA_VERSION})
credentials: unchanged`, exitCode: 0 });
    const writer = createContentAddressedArtifactWriter({ admission });
    const ordinary = await writer.stageDiagnostic(Buffer.from("ordinary pending"), { mediaType: "application/json" }, "ordinary"); ordinary.publish();
    const pinned = await writer.stageDiagnostic(Buffer.from("protected pending"), { mediaType: "application/json" }, "pinned"); pinned.publish();
    const before = readdirSync(artifactRoot).sort();
    const databasePath = join(stateRoot, "state.db"), databaseBytes = readFileSync(databasePath);
    const inspection = AuthorityDatabase.inspectExistingReadOnly(admission, databasePath);
    const plan = await upgradeStorage(profileBrowserClosure, admission, { ...input, plan: true }, clock);
    assert.equal(plan.state, "planned"); assert.equal(plan.diagnostics, undefined);
    assert.deepEqual(readdirSync(artifactRoot).sort(), before); assert.deepEqual(readFileSync(databasePath), databaseBytes);
    const live = acquireRuntimeProcessLock({ processLockRoot: input.processLockRoot, name: "live-smoke", pid: process.pid }, clock);
    try { await assert.rejects(upgradeStorage(profileBrowserClosure, admission, input, clock), /runtime-active/u); assert.deepEqual(readdirSync(artifactRoot).sort(), before); }
    finally { live.release(); }
    const report = await upgradeStorage(profileBrowserClosure, admission, input, clock);
    assert.deepEqual(report.diagnostics, { reclaimedStages: 1, retainedStages: 1, capacityWarning: true });
    assert.equal(existsSync(join(artifactRoot, `${ordinary.ref.sha256}.artifact`)), false);
    assert.equal(existsSync(join(artifactRoot, `${pinned.ref.sha256}.artifact`)), true);
    assert.deepEqual(pendingDiagnosticArtifacts(admission), [pinned.ref]);
    const cli = await composeStorageCommand(rebuildRuntimeIsolation, ["upgrade"], clock, root, admission);
    assert.deepEqual(cli, { output: `storage upgrade: already-upgraded (v${CURRENT_AUTHORITY_SCHEMA_VERSION} → v${CURRENT_AUTHORITY_SCHEMA_VERSION})
credentials: unchanged
diagnostic stages: 0 reclaimed, 1 retained; retained evidence remains budget-accounted`, exitCode: 0 });
    assert.deepEqual(readFileSync(databasePath), databaseBytes);
    const after = AuthorityDatabase.inspectExistingReadOnly(admission, databasePath);
    assert.equal(after.authorityGeneration, inspection.authorityGeneration);
    assert.equal(after.authorityContentFingerprint, inspection.authorityContentFingerprint);
    try { admission.release(); profile.machine.release(); }
    catch (error) { throw retainAuthoritySourceClosure([error], { admission, directory: { profile } }); }
    const sharedMachine = acquireSharedRuntimeAdmission(root, profile.lifetime);
    const sharedOwners: { machine: typeof sharedMachine; admission?: ReturnType<typeof sharedMachine.admitProfile>; profile: typeof profile; primary?: unknown } = {
      machine: sharedMachine, profile,
    };
    retainedFixtureOwners.push(sharedOwners);
    let sharedPrimary: { error: unknown } | undefined;
    try {
      const shared = sharedMachine.admitProfile(sharedMachine.issueRegisteredProfileClaim(profileId));
      sharedOwners.admission = shared;
      await assert.rejects(upgradeStorage(profileBrowserClosure, shared, input, clock), /exclusive offline admission required/u);
    } catch (error) { sharedPrimary = { error }; sharedOwners.primary = error; }
    if (!(sharedPrimary?.error instanceof AuthoritySourceClosureUnprovedError)) {
      try { sharedOwners.admission?.release(); sharedMachine.release(); }
      catch (cleanup) {
        throw retainAuthoritySourceClosure(sharedPrimary === undefined ? [cleanup] : [sharedPrimary.error, cleanup], {
          ...(sharedOwners.admission === undefined ? {} : { admission: sharedOwners.admission }), directory: sharedOwners,
        });
      }
    }
    if (sharedPrimary !== undefined) throw sharedPrimary.error;
  } catch (error) { primary = { error }; }
  if (primary?.error instanceof AuthoritySourceClosureUnprovedError) {
    retainedFixtureOwners.push({ profile, primary: primary.error });
    throw primary.error;
  }
  try { await profile.close(); }
  catch (cleanup) {
    throw retainAuthoritySourceClosure(primary === undefined ? [cleanup] : [primary.error, cleanup], { admission, directory: { profile } });
  }
  if (primary !== undefined) throw primary.error;
});
}

{

const fixtures: { cleanup(): void }[] = [];
const _afterEachFixture0 = () => {
  vi.restoreAllMocks();
  for (const fixture of fixtures.splice(0)) fixture.cleanup();
};
async function fixture() {
  const profile = await createBoundProfileFixture();
  const credentials = boundProfileCredentials(profile.admission);
  const owner = { profile, closureFailed: false };
  const databases = new Set<AuthorityDatabase>();
  const close = (database: AuthorityDatabase | DatabaseSync, primary?: unknown) => {
    try { database.close(); if (database instanceof AuthorityDatabase) databases.delete(database); }
    catch (error) {
      owner.closureFailed = true;
      const retained = retainAuthoritySourceClosure(primary === undefined ? [error] : [primary, error], { database, admission: profile.admission, directory: { profile } });
      retainedFixtureOwners.push({ owner, database, databases, retained });
      throw retained;
    }
  };
  const open = () => {
    try { const database = AuthorityDatabase.open(profile.admission, {path: profile.path,busyTimeoutMs:250,migrationOwner:"native-test"},
      undefined, undefined, undefined, undefined, credentials); databases.add(database); return database; }
    catch (error) {
      if (error instanceof AuthoritySourceClosureUnprovedError) {
        owner.closureFailed = true; retainedFixtureOwners.push({ owner, error });
      }
      throw error;
    }
  };
  const result = { path: profile.path, open, close, async cleanup() {
    if (owner.closureFailed) return;
    for (const database of databases) close(database);
    try { await profile.close(); }
    catch (error) {
      owner.closureFailed = true;
      const retained = retainAuthoritySourceClosure([error], { admission: profile.admission, directory: { profile } });
      retainedFixtureOwners.push({ owner, databases, retained });
      throw retained;
    }
  } };
  fixtures.push(result);
  return result;
}
describe("native authority admission",()=>{
afterEach(_afterEachFixture0);

  it.each([0,1,48,99])("refuses version %i without rewriting its header or retained rows",async version=>{
    const f=await fixture();f.close(f.open());
    const db=new DatabaseSync(f.path);
    let baseline: ReturnType<ReturnType<DatabaseSync["prepare"]>["all"]>;
    let primary: { error: unknown } | undefined;
    try {
      db.exec(`PRAGMA user_version=${String(version)}`);
      baseline=db.prepare("SELECT * FROM database_upgrades").all();
    } catch (error) { primary = { error }; throw error; }
    finally { f.close(db, primary?.error); }
    expect(f.open).toThrow(AuthoritySchemaVersionError);
    const after=new DatabaseSync(f.path,{readOnly:true});
    let afterPrimary: { error: unknown } | undefined;
    try {expect(after.prepare("PRAGMA user_version").get()?.user_version).toBe(version);
      expect(after.prepare("SELECT * FROM database_upgrades").all()).toEqual(baseline);}
    catch (error) { afterPrimary = { error }; throw error; }
    finally {f.close(after, afterPrimary?.error);}
  });
});
}

{

const roots: string[] = [];
const _afterEachFixture0 = () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); };

describe("first installation worker custody", () => {
afterEach(_afterEachFixture0);

  async function initialFixture() {
    return await createFirstInstallCustodyFixture(roots, HASH_A);
  }
  it("retains blocking first-install custody on an AuthorityDatabase opening callback failure", async () => {
    const f = await initialFixture();
    vi.spyOn(AuthorityDatabase, "open").mockImplementation(() => {
      expect(f.snapshot().processLocks.workers.state).toBe("active"); throw new Error("initial-open-fault");
    });
    expect(f.acquire).toThrow("initial-open-fault");
    expect(f.snapshot().processLocks.workers.state).toBe("active"); f.custody().release(); await f.close();
  });
  it("retains blocking custody through a first-install close fault", async () => {
    const f = await initialFixture();
    const originalClose = Object.getOwnPropertyDescriptor(AuthorityDatabase.prototype, "close")?.value as (this: AuthorityDatabase) => void;
    vi.spyOn(AuthorityDatabase.prototype, "close").mockImplementation(function (this: AuthorityDatabase) {
      expect(f.snapshot().processLocks.workers.state).toBe("active");
      originalClose.call(this); throw new Error("initial-close-unproved");
    });
    expect(f.acquire).toThrow("initial-close-unproved");
    expect(f.snapshot().processLocks.workers.state).toBe("active"); f.custody().release(); await f.close();
  });
});
}
