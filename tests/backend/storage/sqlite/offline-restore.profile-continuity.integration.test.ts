import { AuthorityDatabase as FixtureAuthorityDatabase } from "../../../support/helpers/synthetic-database-admission.js";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { acquireRecoveryRuntimeRestore, ProfileStorageRelocationUnsupportedError, RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { seedAtomicWriteOwner } from "../../../support/helpers/timeline-write-fixture.js";
import { fenceWriteFixture } from "../../../support/helpers/write-fence-fixture.js";
import { ATOMIC_WRITE_COMMIT, WRITE_INTENT_ATTEMPTING, WRITE_ATTEMPT } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { runClaim } from "../../../../src/models/run/record.js";
import { deriveWriteAuthorityReason } from "../../../../src/rules/write-safety/write-authority-reason.js";
import { executeSettingsCommand } from "../../../../src/backend/runs/commands/command-kernel.js";
import { createSettingsApplicationExecutor } from "../../../../src/backend/runs/commands/settings-service.js";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { SETTINGS_SCHEMA_HASH, deriveSettingsPatchFingerprint } from "../../../../src/models/config/settings.js";
import { manualClock, systemClock, type Clock } from "../../../../src/rules/time/clock.js";
import type { OfflineRestoreAdmissionFactory } from "../../../../src/backend/storage/sqlite/offline-restore.js";
import { spawn } from "node:child_process";
import { CredentialEraseInputSchema } from "../../../../src/models/config/credential-store.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync, rmSync, readdirSync, lstatSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it, vi } from "vitest";
import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";
import { createCredentialStore, captureCredentialErasureHead, verifyCredentialErasureHead } from "../../../../src/backend/storage/configuration/credential-store.js";
import { createProfileRegistry } from "../../../../src/backend/profiles/registry.js";
import { createProfileSession } from "../../../../src/backend/profiles/profile-session.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { AuthorityBackupService } from "../../../../src/backend/storage/sqlite/backup-service.js";
import { OfflineAuthorityRestoreService, OfflineRestoreFailure, settleInterruptedAuthorityRestore } from "../../../../src/backend/storage/sqlite/offline-restore.js";
import { RecoveryStopProofStore } from "../../../../src/backend/storage/sqlite/recovery-stop-proof.js";
import { acquireRuntimeProcessLock, acquireRuntimeRestoreAdmission, observeRuntimeLockSnapshot } from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH } from "../../../../src/models/config/protected-settings.js";

function world(clock: Clock = systemClock) {
  const fixture = createBoundProfileFixture();
  const profileId = fixture.admission.profileBinding.profileId;
  const journalPath = join(fixture.machine.stateRoot, "machine", "erasures", profileId + ".json");
  const processLockRoot = join(fixture.workspace, rebuildRuntimeIsolation.processLockRoot);
  let admission = fixture.admission;
  const renew = () => { admission = fixture.machine.admitProfile(createProfileRegistry(fixture.machine).storageClaim(profileId)); return admission; };
  const store = () => createCredentialStore({ admission, stateRoot: fixture.stateRoot, erasureJournalAdmission: fixture.machine, erasureJournalPath: journalPath });
  const newSession = () => createProfileSession({ admission: fixture.machine, machineRoot: fixture.machine.stateRoot,
    activity: { hasUnquiescedWork: () => false }, backupPaths: () => [], loginDataPaths: () => [] });
  let currentSession = newSession();
  const session = () => currentSession;
  const signIn = () => {
    currentSession = newSession();
    const result = currentSession.signIn({ email: "fixture@example.edu", password: "disposable-fixture-password", at: "2026-10-21T12:00:00.000Z" });
    assert.equal(result.state, "active");
    if (result.state !== "active") throw new Error("fixture-sign-in-refused");
    renew(); return result;
  };
  const backup = async () => {
    const database = AuthorityDatabase.open(admission, { path: fixture.path, busyTimeoutMs: 250, migrationOwner: "restore-continuity" }, clock);
    try {
      const report = await new AuthorityBackupService(admission, database, { directory: join(fixture.stateRoot, "backups", "authority") }, clock)
        .request({ trigger: "operator", requiredGeneration: database.getMeta().authorityGeneration });
      const manifest = report.manifests[0];
      assert.ok(manifest);
      return join(fixture.stateRoot, "backups", "authority", manifest.backupFileName + ".manifest.json");
    } finally { database.close(); }
  };
  const proof = () => {
    const sourceDatabaseIdentity = AuthorityDatabase.sourceDatabaseIdentity(fixture.path);
    const proofs = new RecoveryStopProofStore({ processLockRoot, maxProofAgeMs: 60_000 }, clock);
    proofs.recordRuntimeState(observeRuntimeLockSnapshot({ processLockRoot, sourceDatabaseIdentity }, clock));
    return proofs.issue({ observedBy: "local-operator", sourceDatabaseIdentity });
  };
  const restore = (projection: (path: string) => Promise<void> = async () => {}, replace = renameSync, factory?: OfflineRestoreAdmissionFactory) => new OfflineAuthorityRestoreService(admission,
    { authorityPath: fixture.path, suspectDirectory: join(fixture.stateRoot, "backups", "suspects"), busyTimeoutMs: 250, processLockRoot, stoppedProofMaxAgeMs: 60_000 },
    projection, clock, { copyFile: copyFileSync, atomicReplace: replace }, factory, store());
  return { ...fixture, profileId, journalPath, processLockRoot, renew, store, session, signIn, backup, proof, restore, current: () => admission };
}

function childJob(script: string) {
  const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (bytes: Buffer) => { output += bytes.toString("utf8"); });
  // Child diagnostics remain private; parent reports only exit and fixed protocol tokens.
  child.stderr.resume();
  const done = new Promise<number | null>((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
  return { child, done, output: () => output };
}
async function waitForFile(path: string) {
  const deadline = Date.now() + 10_000;
  while (!existsSync(path)) {
    if (Date.now() > deadline) throw new Error("synthetic-child-barrier-unreached");
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

describe("profile restore continuity", () => {
  it("restores matching canonical SQLite without rolling credentials/control back, invalidates old context and admits a fresh child", async () => {
    const f = world();
    try {
      const store = f.store(), protectedBefore = readFileSync(join(f.stateRoot, "credentials", "protected.json"));
      const manifestPath = await f.backup();
      const before = f.machine.readProfileRegistry().sessionGeneration;
      const old = f.current();
      const result = await f.restore().restore({ manifestPath, stoppedSystemProof: f.proof() });
      assert.equal(result.state, "restored");
      assert.deepEqual(readFileSync(join(f.stateRoot, "credentials", "protected.json")), protectedBefore);
      assert.equal(f.machine.readProfileRegistry().sessionGeneration, before + 1);
      assert.throws(() => store.read());
      assert.throws(() => AuthorityDatabase.open(old, { path: f.path, busyTimeoutMs: 250, migrationOwner: "restore-old-context" }), /profile-restore-context-expired/);
      const fresh = f.renew();
      const database = AuthorityDatabase.open(fresh, { path: f.path, busyTimeoutMs: 250, migrationOwner: "restore-fresh-context" });
      assert.equal(database.getMeta().profileId, f.profileId); database.close();
      assert.ok(f.store().read().entries.ucpathPassword);
    } finally { f.close(); }
  });

  it("preserves genuine saved settings and safely parked UNKNOWN write identities through canonical restore", async () => {
    const f = world();
    try {
      const options = { path: f.path, busyTimeoutMs: 250, migrationOwner: "restore-settings-unknown" };
      let database = FixtureAuthorityDatabase.open(options, undefined, undefined, undefined, undefined, f.store());
      let expected: unknown;
      const settingsCommandId = randomUUID();
      try {
        seedAtomicWriteOwner(database, ATOMIC_WRITE_COMMIT, f.path, 2);
        fenceWriteFixture(database, { intent: WRITE_INTENT_ATTEMPTING, attempt: WRITE_ATTEMPT }, f.path);
        const run = database.authority.runs.get(WRITE_INTENT_ATTEMPTING.runId);
        assert.ok(run); const claim = runClaim(run); assert.ok(claim);
        const now = "2026-10-21T12:00:00.000Z";
        database.authority.writeIntents.parkAttempt({ writeIntentId: WRITE_INTENT_ATTEMPTING.writeIntentId, generation: 1, expectedVersion: 1,
          code: "unknown", message: "synthetic-unresolved-submit", authorityReason: deriveWriteAuthorityReason("recovery-probe-unknown", "probe", "synthetic-unresolved-submit"), now });
        assert.equal(database.authority.runs.transition({ runId: run.envelope.runId, expectedVersion: run.version,
          claim: { workerId: claim.workerId, claimGeneration: claim.claimGeneration }, lifecycle: { state: "parked-write", writeIntentId: WRITE_INTENT_ATTEMPTING.writeIntentId,
            intentGeneration: 1, parkedAt: now, code: "unknown", message: "synthetic-unresolved-submit" }, now }).state, "applied");
        const patch = { "concurrency.defaultWorkers": { set: 3 } };
        const settings = createSettingsApplicationExecutor(value => resolveConfigWithProvenance(value, { primaryDisplay: null }, systemClock), f.store());
        const result = executeSettingsCommand({ authority: database, clock: systemClock, ids: { uuid: randomUUID }, settings },
          { family: "settings", type: "apply-settings", commandId: settingsCommandId, requestedAt: now, requestedBy: "local-operator", source: "settings-surface",
            target: { expectedRevision: 1 }, payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveSettingsPatchFingerprint(patch), patch } });
        assert.equal(result.state, "applied");
        expected = { settings: database.authority.settingsCurrent.get(), command: database.authority.commands.get(settingsCommandId),
          audit: database.authority.commandAudits.findByCommand(settingsCommandId), intent: database.authority.writeIntents.get(WRITE_INTENT_ATTEMPTING.writeIntentId),
          attempt: database.authority.writeAttempts.get(WRITE_ATTEMPT.writeAttemptId), run: database.authority.runs.get(WRITE_INTENT_ATTEMPTING.runId) };
      } finally { database.close(); }
      const manifestPath = await f.backup();
      await f.restore().restore({ manifestPath, stoppedSystemProof: f.proof() });
      database = AuthorityDatabase.open(f.renew(), options, undefined, undefined, undefined, undefined, f.store());
      try {
        assert.deepEqual({ settings: database.authority.settingsCurrent.get(), command: database.authority.commands.get(settingsCommandId),
          audit: database.authority.commandAudits.findByCommand(settingsCommandId), intent: database.authority.writeIntents.get(WRITE_INTENT_ATTEMPTING.writeIntentId),
          attempt: database.authority.writeAttempts.get(WRITE_ATTEMPT.writeAttemptId), run: database.authority.runs.get(WRITE_INTENT_ATTEMPTING.runId) }, expected);
        assert.equal(database.authority.writeIntents.get(WRITE_INTENT_ATTEMPTING.writeIntentId)?.status, "parked");
        assert.equal(database.authority.runs.get(WRITE_INTENT_ATTEMPTING.runId)?.lifecycle.state, "parked-write");
      } finally { database.close(); }
    } finally { f.close(); }
  });

  it("refuses a foreign physical origin even with matching profile UUIDs before staging", async () => {
    const f = world();
    try {
      const manifestPath = await f.backup();
      const document = JSON.parse(readFileSync(manifestPath, "utf8")) as { sourceDatabaseIdentity: string };
      document.sourceDatabaseIdentity = "f".repeat(64);
      writeFileSync(manifestPath, JSON.stringify(document), { mode: 0o600 });
      const bytes = readFileSync(f.path);
      await assert.rejects(f.restore().restore({ manifestPath, stoppedSystemProof: f.proof() }), /different authority database/);
      assert.deepEqual(readFileSync(f.path), bytes);
      assert.equal(existsSync(join(f.workspace, ".tracker", "control", "journal.json")), false);
    } finally { f.close(); }
  });

  it.each(["journal", "anchor", "both"] as const)("refuses %s rollback against independent current control", async kind => {
    const f = world();
    try {
      const active = f.signIn();
      assert.equal(f.session().logOut(active.token, { at: "2026-10-21T12:01:00.000Z" }).state, "wiped");
      const oldJournal = readFileSync(f.journalPath), oldAnchor = readFileSync(f.journalPath + ".authority");
      const again = f.signIn();
      assert.equal(f.session().logOut(again.token, { at: "2026-10-21T12:02:00.000Z" }).state, "wiped");
      f.signIn();
      if (kind !== "anchor") writeFileSync(f.journalPath, oldJournal, { mode: 0o600 });
      if (kind !== "journal") writeFileSync(f.journalPath + ".authority", oldAnchor, { mode: 0o600 });
      if (kind === "both") {
        const anchor = JSON.parse(oldAnchor.toString("utf8")) as { epoch: number; device: number; inode: number };
        const journal = JSON.parse(oldJournal.toString("utf8")) as { epoch: number };
        const file = lstatSync(f.journalPath);
        anchor.device = file.dev; anchor.inode = file.ino;
        writeFileSync(f.journalPath + ".authority", JSON.stringify(anchor), { mode: 0o600 });
        assert.equal(anchor.epoch, journal.epoch);
        assert.equal(anchor.device, file.dev); assert.equal(anchor.inode, file.ino);
      }
      const bytes = readFileSync(f.path);
      assert.throws(() => f.store().read());
      assert.throws(() => captureCredentialErasureHead(f.store()));
      assert.deepEqual(readFileSync(f.path), bytes);
    } finally { f.close(); }
  });

  it("settles an interrupted erase through its exact original command before restoring availability", () => {
    const f = world();
    try {
      const session = createProfileSession({ admission: f.machine, machineRoot: f.machine.stateRoot,
        activity: { hasUnquiescedWork: () => false }, backupPaths: () => [], loginDataPaths: () => [],
        credentialHooks: { afterErasureJournal: () => { throw new Error("synthetic-interrupted-erasure"); } } });
      const active = session.signIn({ email: "fixture@example.edu", password: "disposable-fixture-password", at: "2026-10-21T12:00:00.000Z" });
      assert.equal(active.state, "active"); if (active.state !== "active") throw new Error("fixture-sign-in-refused");
      assert.throws(() => session.logOut(active.token, { at: "2026-10-21T12:01:00.000Z" }), /synthetic-interrupted-erasure/);
      const intentPath = join(f.workspace, ".tracker", "control", "profile-publication.json");
      const intent = JSON.parse(readFileSync(intentPath, "utf8")) as { kind: string; request: { commandId: string; writeId: string; expectedRevision: number } };
      assert.equal(intent.kind, "erasure");
      const operations = f.machine.readProfileRegistry();
      assert.equal(operations.profiles.find(row => row.profileId === f.profileId)?.lifecycle, "cancelling");
      const directory = join(f.machine.stateRoot, "machine", "operations");
      const files = readdirSync(directory).filter(name => name.endsWith(".json"));
      assert.equal(files.length, 1);
      const path = join(directory, files[0]);
      const operation = JSON.parse(readFileSync(path, "utf8")) as { operationId: string; commandId: string; writeId: string; expectedRevision: number };
      assert.deepEqual({ commandId: operation.commandId, writeId: operation.writeId, expectedRevision: operation.expectedRevision }, { commandId: intent.request.commandId, writeId: intent.request.writeId, expectedRevision: intent.request.expectedRevision });
      assert.throws(() => f.store().read());
      assert.equal(f.session().resumeLogout(operation.operationId).state, "wiped");
      assert.equal(existsSync(intentPath), false);
      const document = JSON.parse(readFileSync(join(f.stateRoot, "credentials", "protected.json"), "utf8")) as { history: { receipt: { commandId: string; writeId: string } }[] };
      assert.equal(document.history.filter(entry => entry.receipt.commandId === operation.commandId).length, 1);
      assert.equal(document.history.at(-1)?.receipt.writeId, operation.writeId);
      assert.equal(readFileSync(join(f.stateRoot, "credentials", "protected.json")).includes(Buffer.from("disposable-fixture-password")), false);
    } finally { f.close(); }
  });

  it.each(["missing-control", "foreign-control", "registry-and-profile", "missing-binding"] as const)("refuses %s before restore payload effects", async kind => {
    const f = world();
    try {
      const manifestPath = await f.backup();
      const databaseBytes = readFileSync(f.path);
      let expectedBefore = databaseBytes;
      const control = join(f.workspace, ".tracker", "control", "profile-registry.json");
      if (kind === "missing-control") rmSync(control);
      if (kind === "foreign-control") {
        const document = JSON.parse(readFileSync(control, "utf8")) as { installationId: string };
        document.installationId = randomUUID(); writeFileSync(control, JSON.stringify(document), { mode: 0o600 });
      }
      if (kind === "registry-and-profile") {
        const path = join(f.machine.stateRoot, "machine", "profiles.json"), protectedPath = join(f.stateRoot, "credentials", "protected.json");
        const registryBytes = readFileSync(path), protectedBytes = readFileSync(protectedPath);
        f.signIn();
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { backupFileName: string };
        const backupPath = join(f.stateRoot, "backups", "authority", manifest.backupFileName);
        expectedBefore = readFileSync(backupPath);
        copyFileSync(backupPath, f.path);
        writeFileSync(protectedPath, protectedBytes, { mode: 0o600 });
        writeFileSync(path, registryBytes, { mode: 0o600 });
      }
      if (kind === "missing-binding") { rmSync(f.path); writeFileSync(f.path, "invalid-synthetic-sqlite", { mode: 0o600 }); }
      const before = readFileSync(f.path);
      await assert.rejects(async () => f.restore().restore({ manifestPath, stoppedSystemProof: f.proof() }));
      assert.deepEqual(readFileSync(f.path), before);
      if (kind !== "missing-binding") assert.deepEqual(before, expectedBefore);
      assert.equal(existsSync(join(f.workspace, ".tracker", "control", "journal.json")), false);
    } finally { f.close(); }
  });

  it("refuses whole-machine restore and relocation without an independent retained continuity witness", async () => {
    const f = world();
    try {
      const manifestPath = await f.backup(), before = readFileSync(f.path);
      assert.throws(() => new OfflineAuthorityRestoreService(f.machine,
        { authorityPath: f.path, suspectDirectory: join(f.stateRoot, "backups", "suspects"), busyTimeoutMs: 250, processLockRoot: f.processLockRoot, stoppedProofMaxAgeMs: 60_000 }, async () => {}), /profile-bound-authority-required/);
      assert.throws(() => f.machine.assertStorageRelocationSupported(), ProfileStorageRelocationUnsupportedError);
      assert.deepEqual(readFileSync(f.path), before);
      assert.ok(existsSync(manifestPath));
      assert.equal(existsSync(join(f.workspace, ".tracker", "control", "journal.json")), false);
    } finally { f.close(); }
  });

  it("preserves external tombstones through SQLite restore and strips restored old credential plaintext", async () => {
    const f = world();
    try {
      const manifestPath = await f.backup();
      const old = readFileSync(join(f.stateRoot, "credentials", "protected.json"));
      const active = f.signIn();
      assert.equal(f.session().logOut(active.token, { at: "2026-10-21T12:01:00.000Z" }).state, "wiped");
      f.signIn();
      const journal = readFileSync(f.journalPath), anchor = readFileSync(f.journalPath + ".authority");
      const current = readFileSync(join(f.stateRoot, "credentials", "protected.json"));
      await f.restore().restore({ manifestPath, stoppedSystemProof: f.proof() });
      assert.deepEqual(readFileSync(f.journalPath), journal);
      assert.deepEqual(readFileSync(f.journalPath + ".authority"), anchor);
      assert.deepEqual(readFileSync(join(f.stateRoot, "credentials", "protected.json")), current);
      f.renew();
      writeFileSync(join(f.stateRoot, "credentials", "protected.json"), old, { mode: 0o600 });
      const repaired = f.store().read();
      assert.equal(repaired.entries.ucpathPassword, undefined);
      assert.equal(repaired.entries.ucpathUserId, undefined);
      assert.deepEqual(readFileSync(f.journalPath), journal);
    } finally { f.close(); }
  });

  it("refuses erased evidence changed during staging and retains unchanged SQLite", async () => {
    const f = world();
    try {
      const manifestPath = await f.backup(), bytes = readFileSync(f.path);
      const service = f.restore(async () => {
        writeFileSync(f.journalPath, "{}", { mode: 0o600 });
        writeFileSync(f.journalPath + ".authority", "{}", { mode: 0o600 });
      });
      await assert.rejects(service.restore({ manifestPath, stoppedSystemProof: f.proof() }));
      assert.deepEqual(readFileSync(f.path), bytes);
    } finally { f.close(); }
  });

  it("refuses copied/fabricated opaque heads and an ordinary arbitrary erase identity", () => {
    const f = world();
    try {
      const store = f.store(), head = captureCredentialErasureHead(store);
      assert.throws(() => verifyCredentialErasureHead({ ...head }, f.stateRoot, f.journalPath, f.current().profileBinding), /unissued/);
      const before = readFileSync(join(f.stateRoot, "credentials", "protected.json"));
      assert.throws(() => store.erase(CredentialEraseInputSchema.parse({ commandId: randomUUID(), writeId: randomUUID(), commandFingerprint: "b".repeat(64), expectedRevision: store.read().revision,
        updatedAt: "2026-10-21T12:00:00.000Z", protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH })));
      assert.deepEqual(readFileSync(join(f.stateRoot, "credentials", "protected.json")), before);
      assert.equal(existsSync(f.journalPath), false);
    } finally { f.close(); }
  });

  it("reports the replaced outcome after a rename that throws and refuses ordinary reuse", async () => {
    const f = world();
    try {
      const manifestPath = await f.backup();
      await assert.rejects(f.restore(async () => {}, (source, target) => {
        renameSync(source, target);
        throw new Error("synthetic-replace-after-effect");
      }).restore({ manifestPath, stoppedSystemProof: f.proof() }), error => error instanceof OfflineRestoreFailure && error.authorityState === "replaced");
      assert.throws(() => f.current().assertProfileRuntime());
    } finally { f.close(); }
  });
  it("refuses a genuinely stale stopped proof before staging", async () => {
    const clock = manualClock(new Date("2026-10-21T12:00:00.000Z")), f = world(clock);
    try {
      const manifestPath = await f.backup(), stoppedSystemProof = f.proof(), bytes = readFileSync(f.path);
      clock.advanceWall(60_001);
      await assert.rejects(f.restore().restore({ manifestPath, stoppedSystemProof }), /stale/);
      assert.deepEqual(readFileSync(f.path), bytes);
      assert.equal(existsSync(join(f.workspace, ".tracker", "control", "journal.json")), false);
    } finally { f.close(); }
  });

  it("refuses a live real worker after a stopped proof was issued", async () => {
    const f = world();
    let worker: ReturnType<typeof acquireRuntimeProcessLock> | undefined;
    try {
      const manifestPath = await f.backup(), stoppedSystemProof = f.proof(), bytes = readFileSync(f.path);
      worker = acquireRuntimeProcessLock({ processLockRoot: f.processLockRoot, name: "workers", workerId: "synthetic-restore-worker", pid: process.pid });
      await assert.rejects(f.restore().restore({ manifestPath, stoppedSystemProof }));
      assert.deepEqual(readFileSync(f.path), bytes);
      assert.equal(existsSync(join(f.workspace, ".tracker", "control", "journal.json")), false);
    } finally { worker?.release(); f.close(); }
  });

  it("retains suspect and exact restore intent when replacement outcome is unobservable", async () => {
    const f = world();
    try {
      const manifestPath = await f.backup();
      await assert.rejects(f.restore(async () => {}, (source, target) => {
        renameSync(source, target); rmSync(target); throw new Error("synthetic-replacement-outcome-unobservable");
      }).restore({ manifestPath, stoppedSystemProof: f.proof() }), error => error instanceof OfflineRestoreFailure && error.authorityState === "authority-state-uncertain");
      const intent = JSON.parse(readFileSync(join(f.workspace, ".tracker", "control", "journal.json"), "utf8")) as { restore: { suspectPath: string; operationId: string } };
      assert.ok(existsSync(intent.restore.suspectPath));
      assert.ok(intent.restore.operationId);
      assert.throws(() => f.current().assertProfileRuntime());
      assert.throws(() => f.machine.readProfileRegistry());
    } finally { f.close(); }
  });

  it("retains strict unproved companion evidence when settlement fails after replacement", async () => {
    const f = world();
    try {
      const manifestPath = await f.backup();
      await assert.rejects(f.restore(async () => {}, (source, target) => {
        renameSync(source, target); writeFileSync(String(target) + "-wal", "synthetic-unproved-companion", { mode: 0o600 });
      }).restore({ manifestPath, stoppedSystemProof: f.proof() }), error => error instanceof OfflineRestoreFailure && error.authorityState === "replaced");
      const intent = JSON.parse(readFileSync(join(f.workspace, ".tracker", "control", "journal.json"), "utf8")) as { restore: { suspectPath: string } };
      assert.ok(existsSync(intent.restore.suspectPath));
      assert.equal(readFileSync(f.path + "-wal", "utf8"), "synthetic-unproved-companion");
      assert.throws(() => f.current().assertProfileRuntime());
    } finally { f.close(); }
  });

  it("recovers interrupted registry invalidation exactly once without rerunning replacement", async () => {
    const f = world();
    let restoreHandle: ReturnType<typeof acquireRuntimeRestoreAdmission> | undefined;
    let recovery: ReturnType<typeof acquireRecoveryRuntimeRestore> | undefined;
    let freshMachine: RuntimeAdmission | undefined;
    const registryPath = join(f.machine.stateRoot, "machine", "profiles.json"), journalPath = join(f.workspace, ".tracker", "control", "journal.json");
    const originalRename = fs.renameSync;
    try {
      const manifestPath = await f.backup(), beforeGeneration = f.machine.readProfileRegistry().sessionGeneration;
      let interrupted = false, replacements = 0;
      vi.spyOn(fs, "renameSync").mockImplementation((source, target) => {
        originalRename(source, target);
        if (!interrupted && String(target) === registryPath && existsSync(journalPath)) {
          const pending = JSON.parse(readFileSync(journalPath, "utf8")) as { invalidation?: unknown };
          if (pending.invalidation !== undefined) { interrupted = true; throw new Error("synthetic-invalidation-after-registry-rename"); }
        }
      });
      syncBuiltinESMExports();
      try {
        await assert.rejects(f.restore(async () => {}, (source, target) => { replacements += 1; originalRename(source, target); })
          .restore({ manifestPath, stoppedSystemProof: f.proof() }), error => error instanceof OfflineRestoreFailure && error.authorityState === "replaced");
      } finally { vi.restoreAllMocks(); syncBuiltinESMExports(); }
      assert.equal(interrupted, true); assert.equal(replacements, 1);
      const pending = JSON.parse(readFileSync(journalPath, "utf8")) as { restore: { operationId: string }; invalidation: { document: { sessionGeneration: number } } };
      assert.equal(pending.invalidation.document.sessionGeneration, beforeGeneration + 1);
      assert.equal((JSON.parse(readFileSync(registryPath, "utf8")) as { sessionGeneration: number }).sessionGeneration, beforeGeneration + 1);
      f.machine.release();
      restoreHandle = acquireRuntimeRestoreAdmission({ processLockRoot: f.processLockRoot, pid: process.pid });
      recovery = acquireRecoveryRuntimeRestore(f.workspace, pending.restore.operationId, restoreHandle);
      const recoveredAdmission = recovery.admission;
      assert.throws(() => recoveredAdmission.assertWritable());
      assert.throws(() => recoveredAdmission.assertProfileRuntime());
      assert.throws(() => AuthorityDatabase.open(recoveredAdmission, { path: f.path, busyTimeoutMs: 250, migrationOwner: "restore-recovery-new-work" }));
      const beforeWrong = readFileSync(journalPath), databaseBytes = readFileSync(f.path);
      const companionBytes = () => ["-wal", "-shm"].map(suffix => existsSync(f.path + suffix) ? readFileSync(f.path + suffix) : undefined);
      const beforeCompanions = companionBytes();
      await assert.rejects(settleInterruptedAuthorityRestore({ admission: recovery.admission, operationId: pending.restore.operationId,
        manifestPath, outcome: "unchanged", processLockRoot: f.processLockRoot, stoppedSystemProof: f.proof(), restoreAdmission: restoreHandle }));
      assert.deepEqual(readFileSync(journalPath), beforeWrong); assert.deepEqual(readFileSync(f.path), databaseBytes);
      assert.deepEqual(companionBytes(), beforeCompanions);
      assert.equal((await settleInterruptedAuthorityRestore({ admission: recovery.admission, operationId: pending.restore.operationId,
        manifestPath, outcome: "replaced", processLockRoot: f.processLockRoot, stoppedSystemProof: f.proof(), restoreAdmission: restoreHandle })).state, "settled");
      assert.equal(replacements, 1); assert.equal(existsSync(journalPath), false);
      restoreHandle.release(); restoreHandle = undefined; recovery.admission.release(); recovery = undefined;
      freshMachine = RuntimeAdmission.acquireMachine(f.workspace, "exclusive");
      assert.equal(freshMachine.readProfileRegistry().sessionGeneration, beforeGeneration + 1);
      const fresh = freshMachine.admitProfile(createProfileRegistry(freshMachine).storageClaim(f.profileId));
      const database = AuthorityDatabase.open(fresh, { path: f.path, busyTimeoutMs: 250, migrationOwner: "restore-recovered-fresh" }); database.close(); fresh.release();
    } finally {
      vi.restoreAllMocks(); syncBuiltinESMExports();
      restoreHandle?.release(); recovery?.admission.release(); freshMachine?.release(); f.close();
    }
  });

  it("reports replaced and retains real process admission when exclusive release is unproved", async () => {
    const f = world();
    let held: ReturnType<typeof acquireRuntimeRestoreAdmission> | undefined;
    let archiveCollision: string | undefined;
    try {
      const manifestPath = await f.backup();
      const factory: OfflineRestoreAdmissionFactory = (input, clock) => {
        held = acquireRuntimeRestoreAdmission(input, clock);
        const history = join(f.processLockRoot, "restore-admission-history");
        mkdirSync(history, { recursive: true, mode: 0o700 });
        archiveCollision = join(history, `${held.admissionId}.lock.json`);
        mkdirSync(archiveCollision, { mode: 0o700 });
        return held;
      };
      await assert.rejects(f.restore(async () => {}, renameSync, factory).restore({ manifestPath, stoppedSystemProof: f.proof() }),
        error => error instanceof OfflineRestoreFailure && error.authorityState === "replaced" && error.message.includes("release failed"));
      assert.ok(existsSync(join(f.processLockRoot, "restore-admission.lock.json")));
      assert.throws(() => acquireRuntimeProcessLock({ processLockRoot: f.processLockRoot, name: "workers", workerId: "synthetic-after-restore", pid: process.pid }));
      assert.throws(() => f.current().assertProfileRuntime());
    } finally { if (archiveCollision !== undefined) rmSync(archiveCollision, { recursive: true }); held?.release(); f.close(); }
  });

  it.each(["erase", "restore"] as const)("excludes a real concurrent %s owner through the same installation lease", async held => {
    const f = world();
    let owner: ReturnType<typeof childJob> | undefined, competitor: ReturnType<typeof childJob> | undefined;
    const ready = join(f.workspace, "child-ready"), release = join(f.workspace, "child-release");
    try {
      const manifestPath = await f.backup();
      const databaseBytes = readFileSync(f.path);
      f.machine.release();
      const imports = `
        import { existsSync,writeFileSync } from 'node:fs';
        import { join } from 'node:path';
        import { acquireEntrypointAdmission } from './src/backend/storage/admission/bootstrap-admission.ts';
        import { createProfileSession } from './src/backend/profiles/profile-session.ts';
        import { createProfileRegistry } from './src/backend/profiles/registry.ts';
        import { createCredentialStore } from './src/backend/storage/configuration/credential-store.ts';
        import { OfflineAuthorityRestoreService } from './src/backend/storage/sqlite/offline-restore.ts';
        import { AuthorityDatabase } from './src/backend/storage/sqlite/authority-database.ts';
        import { RecoveryStopProofStore } from './src/backend/storage/sqlite/recovery-stop-proof.ts';
        import { acquireRuntimeProcessLock, acquireRuntimeRestoreAdmission, observeRuntimeLockSnapshot } from './src/backend/storage/sqlite/runtime-process-locks.ts';
        const workspace=${JSON.stringify(f.workspace)},profileId=${JSON.stringify(f.profileId)},manifestPath=${JSON.stringify(manifestPath)};
        const ready=${JSON.stringify(ready)},release=${JSON.stringify(release)},processLockRoot=${JSON.stringify(f.processLockRoot)};
      `;
      const barrier = `writeFileSync(ready,'ready',{mode:0o600});const deadline=Date.now()+10000;while(!existsSync(release)){if(Date.now()>deadline)throw new Error('barrier-timeout');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);}`;
      const erase = `const machine=acquireEntrypointAdmission(workspace,'shared');try {
        const session=createProfileSession({admission:machine,machineRoot:machine.stateRoot,activity:{hasUnquiescedWork:()=>false},backupPaths:()=>[],loginDataPaths:()=>[],credentialHooks:{afterErasureJournal:()=>{${barrier}}}});
        const active=session.signIn({email:'fixture@example.edu',password:'disposable-fixture-password',at:'2026-10-21T12:00:00.000Z'});
        if(active.state!=='active')throw new Error('activation-refused');
        const result=session.logOut(active.token,{at:'2026-10-21T12:01:00.000Z'});if(result.state!=='wiped')throw new Error('erase-not-wiped');
      }finally{machine.release();}process.stdout.write('OWNER_DONE');`;
      const restore = `const machine=acquireEntrypointAdmission(workspace,'exclusive');try {
        const child=machine.admitProfile(createProfileRegistry(machine).storageClaim(profileId));const root=child.stateRoot,path=join(root,'state.db');
        const store=createCredentialStore({admission:child,stateRoot:root,erasureJournalAdmission:machine,erasureJournalPath:join(machine.stateRoot,'machine','erasures',profileId+'.json')});
        const identity=AuthorityDatabase.sourceDatabaseIdentity(path),proofs=new RecoveryStopProofStore({processLockRoot,maxProofAgeMs:60000});
        proofs.recordRuntimeState(observeRuntimeLockSnapshot({processLockRoot,sourceDatabaseIdentity:identity}));const proof=proofs.issue({observedBy:'local-operator',sourceDatabaseIdentity:identity});
        const service=new OfflineAuthorityRestoreService(child,{authorityPath:path,suspectDirectory:join(root,'backups','suspects'),busyTimeoutMs:250,processLockRoot,stoppedProofMaxAgeMs:60000},async()=>{${barrier}},undefined,undefined,undefined,store);
        await service.restore({manifestPath,stoppedSystemProof:proof});
      }finally{machine.release();}process.stdout.write('OWNER_DONE');`;
      owner = childJob(imports + (held === "erase" ? erase : restore));
      await waitForFile(ready);
      const mode = held === "erase" ? "exclusive" : "shared";
      competitor = childJob(imports + `let refused=false;try{const machine=acquireEntrypointAdmission(workspace,'${mode}');machine.release();}catch(error){if(error instanceof Error && error.message==='runtime-control: installation lease busy')refused=true;else throw error;}if(!refused)throw new Error('competing-owner-admitted');process.stdout.write('REFUSED');`);
      assert.equal(await competitor.done, 0);
      assert.equal(competitor.output(), "REFUSED");
      assert.deepEqual(readFileSync(f.path), databaseBytes);
      writeFileSync(release, "release", { mode: 0o600 });
      assert.equal(await owner.done, 0);
      assert.equal(owner.output(), "OWNER_DONE");
    } finally {
      writeFileSync(release, "release", { mode: 0o600 });
      for (const job of [owner, competitor]) if (job !== undefined && job.child.exitCode === null) { job.child.kill(); await job.done; }
      rmSync(ready, { force: true }); rmSync(release, { force: true });
      f.close();
    }
  });

});
