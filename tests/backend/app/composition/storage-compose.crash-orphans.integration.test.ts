import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "vitest";
import { composeProfileRuntime, initializeRegisteredPersonStores } from "../../../../src/backend/app/composition/storage-compose.js";
import { createProfileRegistry } from "../../../../src/backend/profiles/registry.js";
import { acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { RuntimeLifetimeLock } from "../../../../src/backend/storage/admission/lifetime-lock.js";
import { createContentAddressedArtifactWriter } from "../../../../src/backend/storage/artifacts/content-addressed-artifact-writer.js";
import { readLocalDebugLog } from "../../../../src/backend/storage/events/local-debug-log.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { AuthorityBackupService, backupLogPaths } from "../../../../src/backend/storage/sqlite/backup-service.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { testProcessImport } from "../../../support/compiled-process.js";
import { boundProfileCredentials, createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";
import { credentialKeychainTestEnvironment } from "../../../support/helpers/credential-keychain-fake.js";

const now = "2026-11-02T12:00:00.000Z";
const hostFacts = { primaryDisplay: null };

const writer = `
  import fs from "node:fs";
  import { syncBuiltinESMExports } from "node:module";
  import { join } from "node:path";
  import { rebuildRuntimeIsolation } from "./src/backend/app/config/runtime-isolation.ts";
  import { profileBrowserClosure } from "./src/backend/runtime/browser/profile-browser-closure.ts";
  import { acquireEntrypointAdmission } from "./src/backend/storage/admission/bootstrap-admission.ts";
  import { RuntimeLifetimeLock } from "./src/backend/storage/admission/lifetime-lock.ts";
  import { createContentAddressedArtifactWriter } from "./src/backend/storage/artifacts/content-addressed-artifact-writer.ts";
  import { createCanonicalCredentials } from "./src/backend/storage/configuration/canonical-credential-store.ts";
  import { createCredentialStore } from "./src/backend/storage/configuration/credential-store.ts";
  import { AuthorityDatabase } from "./src/backend/storage/sqlite/authority-database.ts";
  import { AuthorityBackupService } from "./src/backend/storage/sqlite/backup-service.ts";
  import { OfflineAuthorityRestoreService } from "./src/backend/storage/sqlite/offline-restore.ts";
  import { manualClock } from "./src/rules/time/clock.ts";

  const [crash, workspace, port, profileId, manifestPath, now] = process.argv.slice(1);
  const clock = manualClock(new Date(now));
  const lifetime = await RuntimeLifetimeLock.acquire(Number(port));
  const machine = acquireEntrypointAdmission(workspace, "exclusive", lifetime);
  const admission = machine.admitProfile(profileId);
  const root = admission.stateRoot, path = join(root, "state.db");
  const credentials = createCredentialStore({ admission, stateRoot: root });
  const kill = () => process.kill(process.pid, "SIGKILL");
  const rename = fs.renameSync;
  fs.renameSync = (source, target) => {
    if (crash === "backup publish" && source.endsWith(".manifest.json.tmp")) kill();
    if (crash === "credential stage" && target === join(root, "credentials", "protected.json")) kill();
    rename(source, target);
    if (crash === "backup complete" && source.endsWith(".manifest.json.tmp")) kill();
  };
  syncBuiltinESMExports();

  if (crash.startsWith("backup")) {
    const database = AuthorityDatabase.open(admission, { path, busyTimeoutMs: 250, migrationOwner: "crash-orphans-writer" },
      clock, undefined, undefined, undefined, credentials);
    const source = {
      getMeta: () => database.getMeta(),
      getSourceDatabaseIdentity: () => database.getSourceDatabaseIdentity(),
      async onlineBackupTo(destination) {
        const pages = await database.onlineBackupTo(destination);
        if (crash === "backup stage") kill();
        return pages;
      },
    };
    await new AuthorityBackupService(admission, source, { directory: join(root, "backups", "authority") }, clock)
      .request({ trigger: "schema-migration", requiredGeneration: database.getMeta().authorityGeneration });
  } else if (crash.startsWith("artifact")) {
    const target = crash === "artifact stage" ? "temp-synced" : "published";
    await createContentAddressedArtifactWriter({ admission, injectFault(step) { if (step === target) kill(); } })
      .put(new TextEncoder().encode("interrupted artifact"), { mediaType: "text/plain" });
  } else if (crash === "credential stage") {
    const owner = createCanonicalCredentials(admission), current = owner.readRecord("protected");
    owner.replaceRecord("protected", current.revision, current.value);
  } else if (crash.startsWith("restore")) {
    const operation = admission.acquireOfflineMaintenance();
    const restore = new OfflineAuthorityRestoreService(profileBrowserClosure, admission, { authorityPath: path,
      suspectDirectory: join(root, "backups", "suspects"), busyTimeoutMs: 250,
      processLockRoot: join(workspace, rebuildRuntimeIsolation.processLockRoot) }, async () => { if (crash === "restore stage") kill(); },
      clock, { copyFile: fs.copyFileSync, atomicReplace: kill }, credentials);
    await restore.restore({ manifestPath }, operation);
  }
  throw new Error("writer did not reach the requested crash point");
`;

const crashPoints = [
  { stage: "backup stage", location: "backups", abandoned: [/^\.authority-.+\.sqlite\.tmp$/u] },
  { stage: "backup publish", location: "backups", abandoned: [/^\.authority-.+\.manifest\.json\.tmp$/u, /^authority-.+\.sqlite$/u] },
  { stage: "backup complete", location: "backups", abandoned: [] },
  { stage: "artifact stage", location: "artifacts", abandoned: [/^.+\.tmp$/u] },
  { stage: "artifact publish", location: "artifacts", abandoned: [/^.+\.tmp$/u] },
  { stage: "credential stage", location: "credentials", abandoned: [/^.+\.canonical\.tmp$/u] },
  { stage: "restore stage", location: "profile", abandoned: [/^\.restore-.+\.sqlite\.tmp$/u] },
  { stage: "restore journal", location: "profile", abandoned: [] },
] as const;

function repairNotices(machineRoot: string) {
  const log = readLocalDebugLog(machineRoot);
  assert.equal(log.state, "present");
  return log.records.flatMap(({ payload }) => payload.kind === "debug" && payload.event.area === "profile-startup-repair"
    && payload.event.reason === "unfinished-store-stages-cleared" ? [payload.event] : []);
}

function automaticRepairRefusedFor(error: unknown, cause: string): boolean {
  return error instanceof Error && "code" in error && error.code === "STORAGE_AUTOMATIC_REPAIR_REFUSED"
    && error.cause instanceof Error && "code" in error.cause && error.cause.code === cause;
}

it.skipIf(process.platform === "win32").each(crashPoints)("restarts after a hard crash at $stage", async ({ stage, location, abandoned }) => {
  const profile = await createBoundProfileFixture(), clock = manualClock(new Date(now));
  const profileId = profile.admission.profileBinding.profileId, machineRoot = profile.machine.stateRoot;
  const restoreJournal = join(profile.workspace, ".tracker", "control", "journal.json");
  const directories = { profile: profile.stateRoot, credentials: join(profile.stateRoot, "credentials"),
    backups: join(profile.stateRoot, "backups", "authority"), artifacts: profile.admission.artifactRoot };
  let restart: RuntimeLifetimeLock | undefined;
  try {
    const database = AuthorityDatabase.open(profile.admission, { path: profile.path, busyTimeoutMs: 250, migrationOwner: "crash-orphans-fixture" },
      clock, undefined, undefined, undefined, boundProfileCredentials(profile.admission));
    const manifest = await (async () => {
      try {
        const report = await new AuthorityBackupService(profile.admission, database, { directory: directories.backups }, clock)
          .request({ trigger: "schema-migration", requiredGeneration: database.getMeta().authorityGeneration });
        assert.ok(report.manifests[0]); return report.manifests[0];
      } finally { database.close(); }
    })();
    const backupPath = join(directories.backups, manifest.backupFileName), manifestPath = `${backupPath}.manifest.json`;
    const artifact = await createContentAddressedArtifactWriter({ admission: profile.admission })
      .put(new TextEncoder().encode("published artifact"), { mediaType: "text/plain" });
    const publishedPaths = [backupPath, manifestPath, join(directories.artifacts, `${artifact.sha256}.artifact`), join(directories.credentials, "protected.json"), ...backupLogPaths(backupPath)];
    await profile.closeController();
    const published = publishedPaths.map(path => ({ path, bytes: readFileSync(path) }));
    const retain = (path: string) => published.push({ path, bytes: readFileSync(path) });
    const before = new Set(readdirSync(directories[location]));

    const result = spawnSync(process.execPath, ["--import", testProcessImport(), "--input-type=module", "--eval", writer,
      stage, profile.workspace, String(profile.lifetime.port), profileId, manifestPath, now],
    { encoding: "utf8", env: credentialKeychainTestEnvironment(process.env), timeout: 20_000 });
    assert.equal(result.error, undefined);
    assert.equal(result.signal, "SIGKILL", result.stderr);
    const entries = readdirSync(directories[location]).filter(name => !before.has(name));
    const stages = abandoned.map(pattern => {
      const matches = entries.filter(name => pattern.test(name));
      assert.equal(matches.length, 1, `${String(pattern)} in ${entries.join(", ")}`);
      return join(directories[location], matches[0]);
    });
    if (stage === "backup complete") {
      const finished = entries.find(name => name.endsWith(".sqlite"));
      assert.ok(finished);
      const finishedPath = join(directories.backups, finished);
      retain(finishedPath);
      retain(`${finishedPath}.manifest.json`);
      for (const log of backupLogPaths(finishedPath)) retain(log);
    } else if (stage === "artifact publish") {
      const final = entries.find(name => name.endsWith(".artifact"));
      assert.ok(final);
      retain(join(directories.artifacts, final));
    }
    if (stage.startsWith("restore")) {
      const suspects = join(profile.stateRoot, "backups", "suspects");
      const suspect = readdirSync(suspects).find(name => name.endsWith(".sqlite"));
      assert.ok(suspect);
      retain(join(suspects, suspect));
    }
    let unsafeLink: string | undefined;
    if (stage === "artifact stage") {
      const live = join(directories.artifacts, `${artifact.sha256}.${process.pid}.${randomUUID()}.tmp`);
      writeFileSync(live, "stage with a live PID", { mode: 0o600 }); retain(live);
      unsafeLink = join(directories.artifacts, `${artifact.sha256}.${result.pid}.${randomUUID()}.tmp`);
      symlinkSync(publishedPaths[2], unsafeLink);
    }
    let restoreStage: string | undefined;
    if (stage === "restore journal") {
      const name = entries.find(entry => /^\.restore-.+\.sqlite\.tmp$/u.test(entry));
      assert.ok(name);
      restoreStage = join(profile.stateRoot, name);
      assert.equal(existsSync(restoreJournal), true);
    } else if (stage === "restore stage") {
      const scratch = join(profile.stateRoot, "scratch");
      const logStage = readdirSync(scratch).find(name => /^\.restore-.+\.logs$/u.test(name));
      assert.ok(logStage);
      assert.deepEqual(readdirSync(join(scratch, logStage)).sort(), ["dashboard.db", "timeline.db"]);
      assert.equal(existsSync(restoreJournal), false);
      stages.push(join(scratch, logStage));
      const unknown = join(profile.stateRoot, ".restore-unknown.sqlite.tmp");
      writeFileSync(unknown, "unproved restore stage", { mode: 0o600 }); retain(unknown);
    }

    const lifetime = await RuntimeLifetimeLock.acquire(profile.lifetime.port);
    restart = lifetime;
    if (restoreStage !== undefined && process.platform !== "darwin") {
      retain(restoreStage);
      retain(restoreJournal);
      await assert.rejects(() => initializeRegisteredPersonStores(profile.workspace, lifetime, hostFacts, clock),
        (error: unknown) => automaticRepairRefusedFor(error, "PROFILE_RESTORE_BROWSER_CUSTODY_UNPROVED"));
      for (const { path, bytes } of published) assert.deepEqual(readFileSync(path), bytes, path);
      return;
    }
    await initializeRegisteredPersonStores(profile.workspace, lifetime, hostFacts, clock);
    const machine = acquireEntrypointAdmission(profile.workspace, "shared", lifetime);
    const runtime = composeProfileRuntime({ admission: machine, clock, hostFacts });
    try {
      const session = runtime.session.signIn({ email: "fixture@ucsd.edu", password: "disposable-fixture-password", at: now });
      assert.equal(session.state, "active");
    } finally { await runtime.close("shutdown"); machine.release(); }
    for (const path of stages) assert.equal(existsSync(path), false, path);
    if (unsafeLink !== undefined) assert.equal(lstatSync(unsafeLink).isSymbolicLink(), true);
    if (restoreStage !== undefined) {
      assert.equal(existsSync(restoreStage), false);
      assert.equal(existsSync(restoreJournal), false);
    }
    const notices = repairNotices(machineRoot);
    assert.deepEqual(notices.map(notice => notice.message), stages.length === 0 ? [] : ["Cleared unfinished storage files."]);
    if (stage === "artifact stage") {
      await lifetime.close();
      restart = await RuntimeLifetimeLock.acquire(profile.lifetime.port);
      await initializeRegisteredPersonStores(profile.workspace, restart, hostFacts, clock);
      assert.deepEqual(repairNotices(machineRoot), notices);
    }
    for (const { path, bytes } of published) assert.deepEqual(readFileSync(path), bytes, path);
  } finally { await restart?.close(); await profile.close(); }
});

it.skipIf(process.platform === "win32")("keeps the startup refusal for an unrecognized canonical stage", async () => {
  const profile = await createBoundProfileFixture(), clock = manualClock(new Date(now));
  const profileId = profile.admission.profileBinding.profileId;
  const current = join(profile.stateRoot, "credentials", "protected.json");
  const unknown = join(profile.stateRoot, "credentials", `.${profileId}.unknown.canonical.tmp`);
  let restart: RuntimeLifetimeLock | undefined;
  try {
    await profile.closeController();
    const bytes = readFileSync(current);
    writeFileSync(unknown, "unrecognized credential sibling", { mode: 0o600 });
    const lifetime = await RuntimeLifetimeLock.acquire(profile.lifetime.port);
    restart = lifetime;
    await assert.rejects(() => initializeRegisteredPersonStores(profile.workspace, lifetime, hostFacts, clock),
      (error: unknown) => automaticRepairRefusedFor(error, "CREDENTIAL_OPERATION_PENDING"));
    assert.equal(readFileSync(unknown, "utf8"), "unrecognized credential sibling");
    assert.deepEqual(readFileSync(current), bytes);
  } finally { await restart?.close(); await profile.close(); }
});

it.skipIf(process.platform === "win32")("keeps an unsafe backup stage without holding another person's store", async () => {
  const first = await createBoundProfileFixture(), clock = manualClock(new Date(now));
  let restart: RuntimeLifetimeLock | undefined;
  try {
    createProfileRegistry(first.machine).advanceSession(null);
    first.admission.release();
    first.machine.release();
    const second = await createBoundProfileFixture({ workspace: first.workspace, lifetime: first.lifetime, email: "second@ucsd.edu" });
    await second.closeController();
    await first.closeController();
    const backupRoot = join(second.stateRoot, "backups", "authority");
    mkdirSync(backupRoot, { mode: 0o700, recursive: true });
    const unsafe = join(backupRoot, `.authority-${randomUUID()}.sqlite.tmp`);
    const authority = readFileSync(second.path);
    symlinkSync(second.path, unsafe);

    restart = await RuntimeLifetimeLock.acquire(first.lifetime.port);
    await initializeRegisteredPersonStores(first.workspace, restart, hostFacts, clock);
    const machine = acquireEntrypointAdmission(first.workspace, "shared", restart);
    const runtime = composeProfileRuntime({ admission: machine, clock, hostFacts });
    try {
      const signIn = (email: string) => runtime.session.signIn({ email, password: "disposable-fixture-password", at: now });
      assert.throws(() => signIn("second@ucsd.edu"), { code: "STORAGE_AUTOMATIC_REPAIR_REFUSED" });
      assert.equal(signIn("fixture@ucsd.edu").state, "active");
    } finally { await runtime.close("shutdown"); machine.release(); }
    assert.equal(lstatSync(unsafe).isSymbolicLink(), true);
    assert.deepEqual(readFileSync(second.path), authority);
  } finally { await restart?.close(); await first.close(); }
});
