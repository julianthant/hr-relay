import { prepareStoppedBackupClosure } from "../../../../src/backend/storage/maintenance/profile-inventory.js";
import { type OfflineMaintenanceOperation } from "../../../../src/backend/storage/admission/lifetime-lock.js";
import { boundProfileCredentials, createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";
import { profileBrowserClosure, DEFAULT_BROWSER_LAUNCHER } from "../../../../src/backend/runtime/browser/native-profile-probe.js";
import { createBrowserSessionFactoryFixtures } from "../../../support/helpers/browser/session-factory-fixtures.js";
import { withSmokeWorker } from "../../../../scripts/verify/browser-login.js";
import { credentialKeyCustody } from "../../../../src/backend/storage/configuration/credential-key-custody.js";
import { retainAuthoritySourceClosure, hasUnprovedSourceClosure } from "../../../../src/backend/storage/source-closure.js";
import { FingerprintSchema } from "../../../../src/rules/identity/ids.js";
import assert from "node:assert/strict";
import { chmodSync, copyFileSync, existsSync, linkSync, lstatSync, renameSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { AuthoritySchemaVersionError } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { admitDirectWorker } from "../../../../src/backend/storage/sqlite/worker-slots.js";
import { bindWorkerProcessAdmission } from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { deleteOwnedBrowserProfile, probeClosedBrowserProfile, workerProfileDirectory } from "../../../../src/backend/runtime/browser/browser-session-factory.js";
import { join } from "node:path";
import { it, vi } from "vitest";
import { z } from "zod";
import { composeSelectedProfileStorage } from "../../../../src/backend/app/composition/storage-compose.js";
import { composeProfileClosureInventory, composeStoppedControlCredentialInventory, scanProfileCredentialCopy } from "../../../../src/backend/app/composition/profile-credential-inventory.js";
import { appendEmergencyFault } from "../../../../src/backend/logs/emergency-faults.js";
import { backupStoppedAuthority, releaseStoppedMachineControlUpgrade } from "../../../../src/backend/storage/maintenance/upgrade.js";
import { inspectAuthorityBackupReadOnly } from "../../../../src/backend/storage/sqlite/backup-inspection.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../../../src/backend/storage/sqlite/migrations.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { AuthorityBackupService, verifyBackupManifestAtPath, verifyStoppedBackupManifestAtPath } from "../../../../src/backend/storage/sqlite/backup-service.js";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { CanonicalCredentialHeadSchema, CredentialMaintenanceHold } from "../../../../src/backend/storage/configuration/canonical-credential-store.js";
import { createHistoricalIncompleteProfileFixture, historicalIncompleteProfileFields } from "../../../support/fixtures/storage/historical-incomplete-profile-fixture.js";
import { readStoppedCredentialConversion } from "../../../../src/backend/storage/configuration/credential-conversion.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { scaledMs } from "../../../support/time-scale.js";


async function fixture(f?: Awaited<ReturnType<typeof createBoundProfileFixture>>) {
  f ??= await createBoundProfileFixture();
  const clock = manualClock(new Date("2026-10-21T12:00:00.000Z"));
  const credentials = boundProfileCredentials(f.admission);
  const context = composeSelectedProfileStorage({ machineAdmission: f.machine, admission: f.admission, credentials, clock, hostFacts: { primaryDisplay: null } });
  const before = credentials.read();
  const capturedSecrets = [before.entries.ucpathUserId?.value, before.entries.ucpathPassword?.value].filter((value): value is string => value !== undefined);
  assert.equal(capturedSecrets.length, 2);
  const inventory = composeProfileClosureInventory({ admission: f.admission, database: context.database, clock, hostFacts: { primaryDisplay: null } });
  return { ...f, clock, context, capturedSecrets, inventory,
    async cleanup() { await context.account.close(); context.database.close(); await f.close(); },
  };
}

function nativeKey(f: Awaited<ReturnType<typeof fixture>>) {
  const head = CanonicalCredentialHeadSchema.parse(JSON.parse(readFileSync(join(f.machine.stateRoot, "machine", "credential-keys", `${f.admission.profileBinding.profileId}.json`), "utf8")));
  return credentialKeyCustody.read(head.key);
}
const heldStoppedInventories = new Set<object>();
async function stoppedFixture(archivedAuthorityVersion?: 6 | 7 | 8, archivedAuthorityCopy?: "password" | "native-key") {
  const f = await createHistoricalIncompleteProfileFixture({ ...(archivedAuthorityVersion === undefined ? {} : { archivedAuthorityVersion }),
    ...(archivedAuthorityCopy === undefined ? {} : { archivedAuthorityCopy }) }), clock = manualClock(new Date("2026-11-01T12:00:00.000Z"));
  const held: { f: typeof f; owners: unknown[] } = { f, owners: [] }; heldStoppedInventories.add(held);
  const maintenance = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace, f.lifetime); held.owners.push(maintenance);
  const control = maintenance.beginStoppedMachineControlUpgrade(maintenance.maintenanceOperation()), claim = control.profileInventory(f.profileId);
  const source = RuntimeAdmission.forStoppedControlInventory(claim), inventories: ReturnType<typeof composeStoppedControlCredentialInventory>[] = [];
  held.owners.push(control, source, inventories);
  let uncertain: unknown;
  const guarded = <T>(read: () => T): T => {
    try { return read(); } catch (error) { if (hasUnprovedSourceClosure(error)) uncertain = error; throw error; }
  };
  return { ...f, clock, maintenance, claim, source,
    inspect() { return guarded(() => { const inventory = composeStoppedControlCredentialInventory({ claim, clock, hostFacts: { primaryDisplay: null } }); inventories.push(inventory); return inventory; }); },
    revalidate(inventory: ReturnType<typeof composeStoppedControlCredentialInventory>) { return guarded(() => readStoppedCredentialConversion(inventory.proof, claim)); },
    verifyArchive(path: string) { return guarded(() => verifyStoppedBackupManifestAtPath(source, path)); },
    inspectPrimary() { return guarded(() => inspectAuthorityBackupReadOnly(source, f.databasePath)); },
    async cleanup() { if (uncertain !== undefined) throw retainAuthoritySourceClosure([uncertain], { admission: held }); releaseStoppedMachineControlUpgrade(control, maintenance.maintenanceOperation(), false, { inventories, admission: maintenance }); source.release(); maintenance.release(); await f.close(); heldStoppedInventories.delete(held); },
  };
}
function causeHas(error: unknown, message: string): boolean {
  if (hasUnprovedSourceClosure(error)) throw error instanceof Error ? error : new AggregateError([error], "source-closure-unproved", { cause: error });
  return error instanceof Error && (error.message === message || causeHas(error.cause, message)
    || error instanceof AggregateError && error.errors.some((nested: unknown) => causeHas(nested, message)));
}

for (const version of [7, 8] as const) it(`qualifies a genuine bound SQL${version} archive under stopped conversion without downgrading the live primary`, async () => {
  const f = await stoppedFixture(version);
  try {
    const archive = f.archive; assert.ok(archive);
    const paths = [f.databasePath, f.protectedPath, f.keyPath, f.controlPath, f.registryPath, archive.path, archive.manifestPath], before = paths.map(path => readFileSync(path));
    assert.equal(f.inspectPrimary().schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
    const verified = f.verifyArchive(archive.manifestPath);
    assert.equal(verified.manifest.schemaVersion, version); assert.equal(verified.manifest.profileId, f.profileId);
    assert.equal(verified.manifest.installationId, f.source.profileBinding.installationId);
    const inventory = f.inspect(); f.revalidate(inventory);
    assert.throws(() => f.source.assertCredentialRead(), /profile-control-upgrade-credential-read-refused/u);
    assert.deepEqual(paths.map(path => readFileSync(path)), before);
  } finally { await f.cleanup(); }
});

it("holds a real unbound SQL6 archive without inferring profile identity from its path", async () => {
  const f = await stoppedFixture(6);
  try {
    const archive = f.archive; assert.ok(archive); assert.equal(archive.manifest.installationId, undefined); assert.equal(archive.manifest.profileId, undefined);
    const paths = [f.databasePath, f.protectedPath, f.keyPath, archive.path, archive.manifestPath], before = paths.map(path => readFileSync(path));
    assert.throws(() => f.inspect(), error => error instanceof CredentialMaintenanceHold && error.code === "CREDENTIAL_CONVERSION_UNSUPPORTED"
      && error.cause instanceof Error && error.cause.name === "ZodError");
    assert.deepEqual(paths.map(path => readFileSync(path)), before);
  } finally { await f.cleanup(); }
});

for (const change of ["bytes", "size", "schema", "source", "manifest-binding", "symlink", "hardlink", "mode", "foreign-database"] as const)
  it(`refuses ${change} archive substitution at the actual stopped verifier and preserves all sources`, async () => {
    const f = await stoppedFixture(7), foreign = change === "foreign-database" ? await stoppedFixture(7) : undefined;
    try {
      const archive = f.archive; assert.ok(archive);
      const clean = f.inspect(); f.revalidate(clean);
      const primaryPaths = [f.databasePath, f.protectedPath, f.keyPath, f.controlPath, f.registryPath], primary = primaryPaths.map(path => readFileSync(path));
      if (change === "bytes") { const bytes = readFileSync(archive.path), index = bytes.length - 1, prior = bytes[index]; assert.ok(prior !== undefined); bytes[index] = prior ^ 1; writeFileSync(archive.path, bytes); }
      if (change === "size") writeFileSync(archive.manifestPath, JSON.stringify({ ...archive.manifest, byteSize: archive.manifest.byteSize + 1 }));
      if (change === "schema") writeFileSync(archive.manifestPath, JSON.stringify({ ...archive.manifest, schemaVersion: 8, verification: { ...archive.manifest.verification, schemaVersion: 8 } }));
      if (change === "source") writeFileSync(archive.manifestPath, JSON.stringify({ ...archive.manifest, sourceDatabaseIdentity: "e".repeat(64) }));
      if (change === "manifest-binding") { const profileId = randomUUID(); writeFileSync(archive.manifestPath, JSON.stringify({ ...archive.manifest, profileId, verification: { ...archive.manifest.verification, profileId } })); }
      if (change === "symlink" || change === "hardlink") {
        const original = join(f.workspace, "original-archive.sqlite"); renameSync(archive.path, original);
        if (change === "symlink") symlinkSync(original, archive.path); else linkSync(original, archive.path);
      }
      if (change === "mode") chmodSync(archive.path, 0o644);
      if (change === "foreign-database") {
        assert.ok(foreign?.archive); copyFileSync(foreign.archive.path, archive.path);
        writeFileSync(archive.manifestPath, JSON.stringify({ ...foreign.archive.manifest, backupFileName: archive.manifest.backupFileName,
          sourceDatabaseIdentity: archive.manifest.sourceDatabaseIdentity, installationId: archive.manifest.installationId, profileId: archive.manifest.profileId,
          verification: { ...foreign.archive.manifest.verification, installationId: archive.manifest.installationId, profileId: archive.manifest.profileId } }));
      }
      const mutated = [readFileSync(archive.path), readFileSync(archive.manifestPath)], stat = lstatSync(archive.path);
      const expected = change === "bytes" ? "profile-maintenance-backup-digest-mismatch" : change === "source" ? "profile-maintenance-backup-source-mismatch"
        : change === "manifest-binding" || change === "foreign-database" ? "backup-profile-binding-mismatch"
          : change === "symlink" || change === "hardlink" ? "authority-readonly-source-unsafe" : "profile-maintenance-backup-identity-invalid";
      const refuses = (error: unknown): boolean => {
        if (hasUnprovedSourceClosure(error)) throw error instanceof Error ? error : new AggregateError([error], "source-closure-unproved", { cause: error });
        return change === "schema" ? error instanceof AuthoritySchemaVersionError && error.schemaVersion === 7 : causeHas(error, expected);
      };
      assert.throws(() => f.verifyArchive(archive.manifestPath), refuses);
      assert.throws(() => f.revalidate(clean), refuses);
      assert.deepEqual(primaryPaths.map(path => readFileSync(path)), primary);
      assert.deepEqual([readFileSync(archive.path), readFileSync(archive.manifestPath)], mutated);
      assert.equal(lstatSync(archive.path).ino, stat.ino); assert.equal(lstatSync(archive.path).mode, stat.mode);
    } finally { await foreign?.cleanup(); await f.cleanup(); }
  });

for (const copy of ["clean", "password", "native-key"] as const) it(`assesses a genuinely verified historical SQL archive containing ${copy} workbook data`, async () => {
  const f = await stoppedFixture(7, copy === "clean" ? undefined : copy);
  try {
    const archive = f.archive; assert.ok(archive);
    assert.equal(f.verifyArchive(archive.manifestPath).manifest.schemaVersion, 7);
    if (copy !== "clean") {
      const key = credentialKeyCustody.read(JSON.parse(readFileSync(f.keyPath, "utf8")));
      assert.equal(readFileSync(archive.path).includes(copy === "password" ? historicalIncompleteProfileFields.password : key.key), true);
    }
    const paths = [f.databasePath, f.keyPath, f.protectedPath, f.controlPath, f.registryPath, archive.path, archive.manifestPath], before = paths.map(path => readFileSync(path));
    if (copy === "clean") { const inventory = f.inspect(); f.revalidate(inventory); }
    else assert.throws(() => f.inspect(), error => causeHas(error, "credential-maintenance-copy-capture-incomplete"));
    assert.deepEqual(paths.map(path => readFileSync(path)), before);
  } finally { await f.cleanup(); }
});

for (const mutation of ["forged-source-version", "missing-source-table", "extra-source-table"] as const) it(`rejects ${mutation} before accepting a backup into credential inventory`, async () => {
  const f = await fixture();
  try {
    const report = await new AuthorityBackupService(f.admission, f.context.database,
      { directory: join(f.stateRoot, "backups", "authority") }, f.clock).request({ trigger: "operator", requiredGeneration: f.context.database.getMeta().authorityGeneration });
    const manifest = report.manifests[0]; assert.ok(manifest);
    const path = join(f.stateRoot, "backups", "authority", manifest.backupFileName);
    const manifestPath = `${path}.manifest.json`;
    await f.inventory.prepare();
    const protectedPath = join(f.stateRoot, "credentials", "protected.json"), protectedBefore = readFileSync(protectedPath);
    const sourceBefore = f.context.database.getMeta();
    if (mutation === "forged-source-version") {
      writeFileSync(manifestPath, JSON.stringify({ ...manifest, schemaVersion: 7,
        verification: { ...manifest.verification, schemaVersion: 7 } }), { mode: 0o600 });
    } else {
      const raw = new DatabaseSync(path);
      try { raw.exec(mutation === "missing-source-table" ? "PRAGMA foreign_keys=OFF; DROP TABLE assistant_actions" : "CREATE TABLE unowned_authority(id TEXT)"); }
      finally { raw.close(); }
      const bytes = readFileSync(path);
      writeFileSync(manifestPath, JSON.stringify({ ...manifest, byteSize: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex") }), { mode: 0o600 });
    }
    await assert.rejects(verifyBackupManifestAtPath(f.admission, manifestPath), error => mutation === "forged-source-version"
      ? error instanceof AuthoritySchemaVersionError && error.schemaVersion === CURRENT_AUTHORITY_SCHEMA_VERSION
      : error instanceof Error && error.message === "authority-native-schema-shape-mismatch");
    assert.deepEqual(f.context.database.getMeta(), sourceBefore);
    assert.equal(readFileSync(protectedPath).equals(protectedBefore), true);
  } finally { await f.cleanup(); }
});

for (const problem of ["extra-file", "contained-symlink", "unreferenced-backup"] as const) it(`refuses stopped conversion inventory with ${problem}`, async () => {
  const f = await stoppedFixture();
  try {
    const clean = f.inspect(); f.revalidate(clean);
    if (problem === "extra-file") writeFileSync(join(f.profileRoot, "unowned.json"), "{}", { mode: 0o600 });
    if (problem === "contained-symlink") symlinkSync(f.protectedPath, join(f.profileRoot, "credentials", "copy.json"));
    if (problem === "unreferenced-backup") {
      mkdirSync(join(f.profileRoot, "backups", "authority"), { recursive: true, mode: 0o700 });
      writeFileSync(join(f.profileRoot, "backups", "authority", "unowned.sqlite"), "synthetic", { mode: 0o600 });
    }
    const paths = [f.protectedPath, f.keyPath, f.databasePath, f.controlPath], before = paths.map(path => readFileSync(path));
    assert.throws(() => f.revalidate(clean), error => causeHas(error, problem === "unreferenced-backup"
      ? "credential-maintenance-backup-membership-unproved" : problem === "extra-file" ? "profile-inventory-unowned-entry" : "profile-inventory-path-unsafe"));
    assert.deepEqual(paths.map(path => readFileSync(path)), before);
  } finally { await f.cleanup(); }
});

for (const encoding of ["utf8", "utf16le", "utf16be"] as const) it(`detects ${encoding} synthetic credential bytes crossing the 64 KiB read boundary`, () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "profile-copy-scan-"))), path = join(root, "copy.bin");
  const captured = "synthetic-boundary-capture";
  const bytes = encoding === "utf8" ? Buffer.from(captured, "utf8") : Buffer.from(captured, "utf16le");
  if (encoding === "utf16be") bytes.swap16();
  try {
    writeFileSync(path, Buffer.concat([Buffer.alloc(64 * 1024 - 3, 0x78), bytes, Buffer.alloc(17, 0x79)]), { mode: 0o600 });
    assert.equal(scanProfileCredentialCopy(path, [captured]).containsSecret, true);
    assert.equal(scanProfileCredentialCopy(path, ["different-synthetic-capture"]).containsSecret, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

for (const content of ["clean", "escaped-value", "escaped-key-material", "escaped-shadowed", "malformed"] as const)
  it(`inspects stopped predecessor boot JSONL with ${content} content`, async () => {
    const f = await stoppedFixture();
    try {
      const error = new Error("synthetic boot failure"); error.stack = undefined;
      appendEmergencyFault({ stateRoot: f.profileRoot, build: "synthetic", code: "DATABASE_WRITER_UNAVAILABLE", error, now: f.clock.now() });
      const path = join(f.profileRoot, "logs", "boot.jsonl"), record = z.looseObject({ payload: z.looseObject({ event: z.looseObject({ message: z.string() }) }) }).parse(JSON.parse(readFileSync(path, "utf8")));
      const key = credentialKeyCustody.read(JSON.parse(readFileSync(f.keyPath, "utf8")));
      const secret = content === "escaped-key-material" ? key.key : historicalIncompleteProfileFields.password;
      if (content !== "clean" && content !== "malformed") {
        record.payload.event.message = secret;
        const encoded = [...secret].map(character => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`).join("");
        const replacement = content === "escaped-shadowed" ? `"${encoded}","message":"clean"` : `"${encoded}"`;
        const text = JSON.stringify(record).replace(JSON.stringify(secret), replacement); assert.equal(text.includes(secret), false);
        writeFileSync(path, text + "\n");
      }
      if (content === "malformed") writeFileSync(path, "{invalid}\n");
      const paths = [path, f.protectedPath, f.keyPath, f.databasePath, f.controlPath], before = paths.map(path => readFileSync(path));
      if (content === "clean") { const inventory = f.inspect(); f.revalidate(inventory); }
      else assert.throws(() => f.inspect(), error => causeHas(error, "credential-maintenance-copy-capture-incomplete"));
      assert.deepEqual(paths.map(path => readFileSync(path)), before);
    } finally { await f.cleanup(); }
  });

for (const content of ["clean", "escaped-key", "escaped-shadowed", "key-material", "malformed"] as const) it(`closes retained native browser resources while preserving ${content} JSON bytes`, async () => {
  const f = await fixture();
  const native=createBrowserSessionFactoryFixtures(f.clock,randomUUID(),{schedule:()=>({cancel(){}})}).fakeLauncher();
  const launch=vi.spyOn(DEFAULT_BROWSER_LAUNCHER,"launch").mockImplementation(input=>native.launcher.launch(input));
  let worker: ReturnType<typeof bindWorkerProcessAdmission> | undefined;
  let primary:{error:unknown}|undefined;
  try {
    const processLockRoot = join(f.workspace, "inventory-process-locks");
    worker = bindWorkerProcessAdmission({ processLockRoot, authorityPath: f.path, pid: process.pid, clock: f.clock,
      open: () => f.context.database, close: () => undefined,
      admit: () => f.context.database.withAuthorityTransaction(repositories => admitDirectWorker(repositories, {
    commandId: randomUUID(), workflow: "person-lookup", poolIndex: 1, expectedPoolVersion: 0, processId: process.pid,
    now: f.clock.now().toISOString()
}, randomUUID()).workerId),
    });
    const started = f.context.database.authority.workerLeases.start({ workerId: worker.workerId, workflow: "person-lookup", browserSystems: ["crm"],
      processId: process.pid, requestedBy: "local-operator", now: f.clock.now().toISOString() });
    assert.equal(started.state, "started");
    const custody = f.context.database.readProfileResourceCustody(), slot = custody.slots[0], config = custody.configSnapshots[0], lease = custody.leases[0];
    assert.ok(slot); assert.ok(config); assert.ok(lease);
    const directory = workerProfileDirectory({ profileRoot: config.config.paths.browserProfileRoot, slotOrdinal: slot.ordinal, system: "crm" });
    f.context.database.authority.workerControls.observe({ workerId: worker.workerId, leaseGeneration: lease.leaseGeneration,
      sessionId: randomUUID(), system: "crm", configFingerprint: config.fingerprint, signInFingerprint: config.fingerprint,
      browserMode: "headless", profileDirectory: directory, acceptDownloads: false, exclusive: false, health: "closed",
      observedAt: f.clock.now().toISOString(), openedAt: f.clock.now().toISOString(), profileRevision: 1 });
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const key = nativeKey(f);
    const path = join(directory, "Preferences"), secret = content === "key-material" ? key.key : f.capturedSecrets[1]; assert.ok(secret);
    const escaped = [...secret].map(character => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`).join("");
    const text = content === "clean" ? '{"profile":{"name":"Synthetic"}}' : content === "malformed" ? "{invalid}" : content === "escaped-shadowed" ? `{"synthetic":"${escaped}","synthetic":"clean"}` : `{"${escaped}":"synthetic"}`;
    assert.equal(text.includes(secret), false);
    writeFileSync(path, text, { mode: 0o600 });
    const stopped = f.context.database.authority.workerLeases.reportLifecycle({workerId:worker.workerId,leaseGeneration:lease.leaseGeneration,
      lifecycle:{state:"stopped",startedAt:lease.lifecycle.startedAt,stoppedAt:f.clock.now().toISOString(),reason:"shutdown"},now:f.clock.now().toISOString()});
    assert.equal(stopped.state,"applied");
    assert.equal(f.context.database.authority.workerLeases.get(worker.workerId)?.lifecycle.state,"stopped");
    worker.processLock.release();worker=undefined;
    await f.inventory.prepare();
    assert.equal(native.contextClosed(),true);assert.equal(native.launches().length,1);
    assert.equal(readFileSync(path,"utf8"),text);
  } catch(error){primary={error};}
  try{launch.mockRestore();worker?.processLock.release();await f.cleanup();}
  catch(error){throw new AggregateError(primary===undefined?[error]:[primary.error,error],"browser-json-fixture-cleanup-failed",{cause:error});}
  if(primary!==undefined)throw primary.error;
});

for (const encoding of ["raw", "base64", "utf16le", "utf16be"] as const) it(`detects private stable key ${encoding} across the copy chunk boundary`, async () => {
  const f = await fixture(), path = join(f.stateRoot, "synthetic-copy.bin");
  try {
    const key = nativeKey(f);
    const bytes = encoding === "raw" ? Buffer.from(key.key, "base64") : Buffer.from(key.key, encoding === "base64" ? "utf8" : "utf16le");
    if (encoding === "utf16be") bytes.swap16();
    writeFileSync(path, Buffer.concat([Buffer.alloc(64 * 1024 - 3, 0x78), bytes, Buffer.alloc(17, 0x79)]), { mode: 0o600 });
    const scan = { containsKey: (value: unknown) => value instanceof Uint8Array && Buffer.from(value).includes(bytes), keyScanOverlap: 4095 };
    assert.equal(scanProfileCredentialCopy(path, [], scan).containsSecret, true);
    writeFileSync(path, Buffer.alloc(64 * 1024 + 100, 0x78), { mode: 0o600 });
    assert.equal(scanProfileCredentialCopy(path, [], scan).containsSecret, false);
  } finally { await f.cleanup(); }
});


for(const purpose of ["logout","backup"] as const)it(`accepts completed verification cleanup with removed scratch directory for ${purpose}`,async()=>{
  const f=await fixture(),lock=f.lifetime,profileRunId=randomUUID();
  const smokeRoot=join(f.stateRoot,"scratch","live-smoke",profileRunId,"browsers");
  const native=createBrowserSessionFactoryFixtures(f.clock,randomUUID(),{schedule:()=>({cancel(){}})}).fakeLauncher();
  let stopped:RuntimeAdmission|undefined,restore:OfflineMaintenanceOperation|undefined;
  let primary:{error:unknown}|undefined;
  try{
    await withSmokeWorker(f.context.database,async slot=>{
      const directory=workerProfileDirectory({profileRoot:smokeRoot,slotOrdinal:slot.ordinal,system:"crm"});
      mkdirSync(directory,{recursive:true,mode:0o700});
      await probeClosedBrowserProfile({profileRoot:smokeRoot,launch:{profileDirectory:directory,extensionDirectory:"",downloadsPath:directory,viewport:{width:800,height:600},timeoutMs:1000},
        clock:f.clock,scheduler:{schedule:()=>({cancel(){}})},closeProofMs:1000,signal:new AbortController().signal,launcher:native.launcher});
      assert.equal(native.contextClosed(),true);
      const snapshot=f.context.database.readProfileResourceCustody().configSnapshots[0];assert.ok(snapshot);
      f.context.database.authority.workerControls.observe({workerId:slot.workerId,leaseGeneration:1,sessionId:randomUUID(),system:"crm",configFingerprint:snapshot.fingerprint,
        signInFingerprint:snapshot.fingerprint,browserMode:"headless",profileDirectory:directory,acceptDownloads:false,exclusive:false,health:"closed",
        observedAt:f.clock.now().toISOString(),openedAt:f.clock.now().toISOString(),profileRevision:1});
      deleteOwnedBrowserProfile(smokeRoot,join(smokeRoot,`w${slot.ordinal}`));assert.equal(existsSync(directory),false);
    },f.clock,{lock,...f.admission.profileBinding,profileRunId,system:"crm",credentialKey:FingerprintSchema.parse("a".repeat(64))});
    const facts=f.context.database.readProfileResourceCustody();assert.equal(facts.verificationProfiles[0]?.cleanup,"closed");
    await f.context.account.close();
    if(purpose==="logout"){
      await f.inventory.prepare();assert.equal(f.context.database.readProfileResourceCustody().verificationProfiles[0]?.cleanup,"closed");
    }else{
      const profileId=f.admission.profileBinding.profileId;f.context.database.close();f.admission.release();
      const processLockRoot=join(f.workspace,rebuildRuntimeIsolation.processLockRoot);
      restore=f.machine.acquireOfflineMaintenance();
      const stoppedAdmission=await f.machine.forStoppedProfileUpgrade(profileBrowserClosure, profileId,restore,f.clock,{primaryDisplay:null});stopped=stoppedAdmission;
      const heldRestore = restore;
      const report=await prepareStoppedBackupClosure(profileBrowserClosure, stoppedAdmission, heldRestore, f.clock, processLockRoot).then(closure => backupStoppedAuthority(closure, stoppedAdmission, f.stateRoot, f.clock, processLockRoot, heldRestore));
      assert.equal(report.state,"verified");assert.equal(report.manifests.length,1);
    }
  }catch(error){primary={error};}
  try{stopped?.release();restore?.release();await f.cleanup();}
  catch(error){throw new AggregateError(primary===undefined?[error]:[primary.error,error],"verification-cleanup-fixture-close-failed",{cause:error});}
  if(primary!==undefined)throw primary.error;
}, scaledMs(30000));
