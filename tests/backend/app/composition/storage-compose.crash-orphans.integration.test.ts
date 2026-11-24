import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "vitest";
import { composeProfileRuntime, initializeRegisteredPersonStores } from "../../../../src/backend/app/composition/storage-compose.js";
import { acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { RuntimeLifetimeLock } from "../../../../src/backend/storage/admission/lifetime-lock.js";
import { createContentAddressedArtifactWriter } from "../../../../src/backend/storage/artifacts/content-addressed-artifact-writer.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { AuthorityBackupService } from "../../../../src/backend/storage/sqlite/backup-service.js";
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
    return rename(source, target);
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
  } else if (crash === "restore stage") {
    const operation = admission.acquireOfflineMaintenance();
    const restore = new OfflineAuthorityRestoreService(profileBrowserClosure, admission, { authorityPath: path,
      suspectDirectory: join(root, "backups", "suspects"), busyTimeoutMs: 250,
      processLockRoot: join(workspace, rebuildRuntimeIsolation.processLockRoot) }, async () => { kill(); },
      clock, undefined, credentials);
    await restore.restore({ manifestPath }, operation);
  }
  throw new Error("writer did not reach the requested crash point");
`;

const crashPoints = [
  { stage: "backup stage", location: "backups", abandoned: [/^\.authority-.+\.sqlite\.tmp$/u], refuses: false },
  { stage: "backup publish", location: "backups", abandoned: [/^\.authority-.+\.manifest\.json\.tmp$/u, /^authority-.+\.sqlite$/u], refuses: false },
  { stage: "artifact stage", location: "artifacts", abandoned: [/^.+\.tmp$/u], refuses: false },
  { stage: "artifact publish", location: "artifacts", abandoned: [/^.+\.tmp$/u], refuses: false },
  { stage: "credential stage", location: "credentials", abandoned: [/^.+\.canonical\.tmp$/u], refuses: true },
  { stage: "restore stage", location: "profile", abandoned: [/^\.restore-.+\.sqlite\.tmp$/u], refuses: false },
] as const;

it.skipIf(process.platform === "win32").each(crashPoints)("restarts after a hard crash at $stage", async ({ stage, location, abandoned, refuses }) => {
  const profile = await createBoundProfileFixture(), clock = manualClock(new Date(now));
  const profileId = profile.admission.profileBinding.profileId;
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
    const publishedPaths = [backupPath, manifestPath, join(directories.artifacts, `${artifact.sha256}.artifact`), join(directories.credentials, "protected.json")];
    await profile.closeController();
    const published = publishedPaths.map(path => ({ path, bytes: readFileSync(path) }));
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
    if (stage === "artifact publish") {
      const final = entries.find(name => name.endsWith(".artifact"));
      assert.ok(final);
      const path = join(directories.artifacts, final);
      published.push({ path, bytes: readFileSync(path) });
    }

    const lifetime = await RuntimeLifetimeLock.acquire(profile.lifetime.port);
    restart = lifetime;
    const start = () => initializeRegisteredPersonStores(profile.workspace, lifetime, hostFacts, clock);
    if (refuses) await assert.rejects(start, { code: "STORAGE_AUTOMATIC_REPAIR_REFUSED" });
    else {
      await start();
      const machine = acquireEntrypointAdmission(profile.workspace, "shared", restart);
      const runtime = composeProfileRuntime({ admission: machine, clock, hostFacts });
      try {
        const session = runtime.session.signIn({ email: "fixture@ucsd.edu", password: "disposable-fixture-password", at: now });
        assert.equal(session.state, "active");
      } finally { await runtime.close("shutdown"); machine.release(); }
    }
    for (const path of stages) assert.equal(existsSync(path), true, path);
    for (const { path, bytes } of published) assert.deepEqual(readFileSync(path), bytes, path);
  } finally { await restart?.close(); await profile.close(); }
});
