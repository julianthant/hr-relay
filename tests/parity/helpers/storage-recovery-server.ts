import { testProcessImport } from "../../support/compiled-process.js";
import { type OfflineMaintenanceOperation, RuntimeLifetimeLock } from "../../../src/backend/storage/admission/lifetime-lock.js";
import { createBoundProfileFixture } from '../../support/helpers/admission-fixture.js';
import { RuntimeAdmission as CanonicalRuntimeAdmission, acquireRecoveryRuntimeRestore, type RuntimeAdmission } from "../../../src/backend/storage/admission/admission.js";
import { AuthoritySourceClosureUnprovedError, retainAuthoritySourceClosure } from '../../../src/backend/storage/source-closure.js';
/** Storage-owned test composition: real doctor route; fixture shell/settings/SSE/static responses. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer, request as httpRequest, type Server } from "node:http";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { Hono } from "hono";
import { systemClock } from "../../../src/rules/time/clock.js";
import { acquireEntrypointAdmission } from "../../../src/backend/storage/admission/bootstrap-admission.js";
import { runOfflineAuthorityRestoreRecovery } from "../../../src/backend/app/composition/storage-compose.js";
import { createFixtureBff, startFixtureServer, type FixtureServer } from "../../support/helpers/dashboard/fixture-bff.js";
import { assertParityBundleIsCurrent, PARITY_DIST_DIR, readBundleStamp } from "./bundle.js";
import { registerStorageRoutes } from "../../../src/backend/transports/http/routes/storage.js";
import type { DashboardApp } from "../../../src/backend/transports/http/routes/api-types.js";
import { doctorAuthorityStorage } from "../../../src/backend/storage/sqlite/storage-doctor.js";
import { createCredentialStore } from "../../../src/backend/storage/configuration/credential-store.js";

const retainedStorageRecoveryOwners = new Set<object>();

export async function storageRecoveryTarget() {
  const fixture = await createBoundProfileFixture();
  const repoRoot = fixture.workspace, profileId = fixture.admission.profileBinding.profileId;
  const held: { fixture: typeof fixture; child?: ReturnType<typeof spawn>; admission?: RuntimeAdmission; machine?: RuntimeAdmission;
    restore?: OfflineMaintenanceOperation; server?: Server; shell?: FixtureServer; competing?: RuntimeAdmission;
    lifetime?: RuntimeLifetimeLock; primary?: unknown } = { fixture };
  retainedStorageRecoveryOwners.add(held);
  try {
  const port = fixture.lifetime.port;
  await fixture.closeController();
  const clock = systemClock;
  const sourceUrl = (path: string) => pathToFileURL(join(process.cwd(), path)).href;
  const code = `const { join } = await import("node:path");
    const { readFileSync, renameSync, copyFileSync } = await import("node:fs");
    const { rebuildRuntimeIsolation } = await import(${JSON.stringify(sourceUrl('src/backend/app/config/runtime-isolation.ts'))});



    const { systemClock } = await import(${JSON.stringify(sourceUrl("src/rules/time/clock.ts"))});
    const { RuntimeAdmission } = await import(${JSON.stringify(sourceUrl('src/backend/storage/admission/admission.ts'))});
    const { AuthorityDatabase } = await import(${JSON.stringify(sourceUrl("src/backend/storage/sqlite/authority-database.ts"))});
    const { AuthorityBackupService } = await import(${JSON.stringify(sourceUrl("src/backend/storage/sqlite/backup-service.ts"))});
    const { OfflineAuthorityRestoreService } = await import(${JSON.stringify(sourceUrl("src/backend/storage/sqlite/offline-restore.ts"))});
    const { profileBrowserClosure } = await import(${JSON.stringify(sourceUrl("src/backend/runtime/browser/native-profile-probe.ts"))});
    const { createCredentialStore } = await import(${JSON.stringify(sourceUrl("src/backend/storage/configuration/credential-store.ts"))});
    const { PROTECTED_SETTINGS_SCHEMA_HASH } = await import(${JSON.stringify(sourceUrl("src/models/config/protected-settings.ts"))});
    const { observeRuntimeLockSnapshot } = await import(${JSON.stringify(sourceUrl("src/backend/storage/sqlite/runtime-process-locks.ts"))});
        const { RuntimeLifetimeLock } = await import(${JSON.stringify(sourceUrl('src/backend/storage/admission/lifetime-lock.ts'))});
    const lifetime = await RuntimeLifetimeLock.acquire(Number(process.argv[3]));
    const workspace = process.argv[1], machine = RuntimeAdmission.acquireMachine(workspace, 'exclusive', lifetime);
    const admission = machine.admitProfile(process.argv[2]), root = admission.stateRoot;
    const path = join(root, "state.db"), directory = join(root, "backups", "authority"), processLockRoot = join(workspace, rebuildRuntimeIsolation.processLockRoot);
    const credentials = createCredentialStore({ admission, stateRoot: root, erasureJournalAdmission: machine, erasureJournalPath: join(machine.stateRoot, "machine", "erasures", \`\${admission.profileBinding.profileId}.json\`) });
    const database = AuthorityDatabase.open(admission, { path, busyTimeoutMs: 500, migrationOwner: "parity-native-restore" }, systemClock, undefined, undefined, undefined, credentials);
    const credentialResult = credentials.apply({commandId: "00000000-0000-4000-8000-000000089750",
      commandFingerprint: "a".repeat(64), expectedRevision: credentials.read().revision, protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH,
      writeId: "00000000-0000-4000-8000-000000089751", updatedAt: systemClock.now().toISOString(),
      entries: {ucpathPassword: {set: "SYNTHETIC_STORAGE_PROOF_NEVER_REAL"}}});
    if (credentialResult.state !== "applied") throw new Error("synthetic-credential-refused");
    const backup = await new AuthorityBackupService(admission, database, {directory}).request({trigger: "operator", requiredGeneration: database.getMeta().authorityGeneration});
    database.close();
    const manifestPath = join(directory, backup.manifests[0].backupFileName + ".manifest.json");
    const sourceDatabaseIdentity = AuthorityDatabase.sourceDatabaseIdentity(admission.authorityBackupExpectedSource());

    const operation = admission.acquireOfflineMaintenance();
    const restore = new OfflineAuthorityRestoreService(profileBrowserClosure, admission, {authorityPath: path, suspectDirectory: join(root, "backups", "suspects"),
      processLockRoot, busyTimeoutMs: 500}, async () => {}, undefined,
      {copyFile: copyFileSync, atomicReplace(source, destination) {
        renameSync(source, destination); copyFileSync(destination, source);
        const journal = JSON.parse(readFileSync(join(workspace, ".tracker", "control", "journal.json"), "utf8"));
        process.send({root, authorityPath: path, manifestPath, stagedPath: source, operationId: journal.restore.operationId, sourceDatabaseIdentity});
        const wait = new Int32Array(new SharedArrayBuffer(4));
        for (;;) Atomics.wait(wait, 0, 0, 1000);
      }}, credentials);
    await restore.restore({ manifestPath }, operation);
  `;
  const child = spawn(process.execPath, ["--import", testProcessImport(), "--input-type=module", "-e", code, repoRoot, profileId, String(port)],
    { detached: true,cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe", "ipc"]});
  held.child = child;
  const childClosed = new Promise<void>(resolve => child.once('close', () => resolve()));
  let recoveryCompleted = false;
  const Ready = z.strictObject({root: z.string(), authorityPath: z.string(), manifestPath: z.string(),
    stagedPath: z.string(), operationId: z.uuid(), sourceDatabaseIdentity: z.string()});
  let ready: z.infer<typeof Ready> | undefined;
  let startupError: unknown;
  try {
    ready = await new Promise<z.infer<typeof Ready>>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("native-restore-fixture-start-timeout")), 15_000);
      const clear = () => clearTimeout(timeout);
      child.once("message", clear); child.once("exit", clear); child.once("error", error => { clear(); reject(error); });
      let output = "";
      child.stderr?.on("data", value => { output += String(value); });
      child.once("message", value => { try { resolve(Ready.parse(value)); } catch (error) { reject(error instanceof Error ? error : new Error(String(error))); } });
      child.once("exit", status => reject(new Error(`restore fixture exited ${String(status)}: ${output}`)));
    });
  } catch (error) { startupError = error; }
  const processFailures: unknown[] = [];
  try {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await childClosed;
    if (child.pid !== undefined) for (const pid of [child.pid, -child.pid]) {
      try { process.kill(pid, 0); throw new Error('storage-recovery-child-still-live'); }
      catch (error) { if (!(error instanceof Error) || !('code' in error) || error.code !== 'ESRCH') throw error; }
    }
  } catch (error) { processFailures.push(error); }
  if (startupError !== undefined || processFailures.length > 0) {
    throw retainAuthoritySourceClosure(startupError === undefined ? processFailures : [startupError, ...processFailures], { admission: held });
  }

  assert.ok(ready);
  const lifetime = await RuntimeLifetimeLock.acquire(port); held.lifetime = lifetime;
  const {root, authorityPath, manifestPath, stagedPath, operationId, sourceDatabaseIdentity} = ready;
  const journalPath = join(repoRoot, ".tracker", "control", "journal.json");
  assert.equal(existsSync(journalPath), true);
  assert.throws(() => { held.competing = acquireEntrypointAdmission(repoRoot, "shared", lifetime); }, /unfinished restoring/u);
  const credentialPath = join(root, "credentials", "protected.json");
  const credentialBytes = readFileSync(credentialPath);
  let diagnosticAdmission: RuntimeAdmission | undefined, diagnosticMachine: RuntimeAdmission | undefined, restoreHandle: OfflineMaintenanceOperation | undefined;
  const acquireDiagnostic = () => {
    if (held.primary instanceof AuthoritySourceClosureUnprovedError) throw held.primary;
    try {
    if (diagnosticAdmission !== undefined) return diagnosticAdmission;
    if (existsSync(journalPath)) {
      restoreHandle = lifetime.beginOfflineMaintenance(repoRoot); held.restore = restoreHandle;
      try { diagnosticAdmission = acquireRecoveryRuntimeRestore(repoRoot, lifetime, operationId, restoreHandle).admission; held.admission = diagnosticAdmission; }
      catch (error) { held.primary = error; throw retainAuthoritySourceClosure([error], { admission: held }); }
    } else {
      diagnosticMachine = CanonicalRuntimeAdmission.acquireMachine(repoRoot, 'shared', lifetime); held.machine = diagnosticMachine;
      diagnosticAdmission = diagnosticMachine.admitProfile(profileId); held.admission = diagnosticAdmission;
    }
    return diagnosticAdmission;

    } catch (error) {
      const failure = retainAuthoritySourceClosure([error], { admission: held });
      held.primary = failure;
      throw failure;
    }
  };
  acquireDiagnostic();
  const doctorOptions = {stateRootTrustAnchor: repoRoot, stateRoot: root, authorityPath,
    backupDirectory: join(root, "backups", "authority"), busyTimeoutMs: 500};
  const readDoctor = () => {
    if (held.primary instanceof AuthoritySourceClosureUnprovedError) throw held.primary;
    try { return doctorAuthorityStorage(acquireDiagnostic(), doctorOptions, clock); }
    catch (error) { const failure = retainAuthoritySourceClosure([error], { admission: held }); held.primary = failure; throw failure; }
  };
  let server: Server | undefined, shell: FixtureServer | undefined;
  let baseUrl: string | undefined;
  const requests: {method: string; path: string}[] = [];
  let stopPromise: Promise<void> | undefined, stopFailure: Error | undefined;
  const stop = async () => {
    if (held.primary instanceof AuthoritySourceClosureUnprovedError) return Promise.reject(held.primary);
    if (stopPromise !== undefined) return stopPromise;
    stopPromise = (async () => {
      try {
        if (server !== undefined) {
          server.closeAllConnections();
          await new Promise<void>((yes, no) => server?.close(error => error ? no(error) : yes())); server = undefined;
        }
        await shell?.close(); shell = undefined; baseUrl = undefined;
        restoreHandle?.release(); restoreHandle = undefined;
        diagnosticAdmission?.release(); diagnosticAdmission = undefined;
        diagnosticMachine?.release(); diagnosticMachine = undefined;
      } catch (error) { held.primary = error; stopFailure = retainAuthoritySourceClosure([error], { admission: held }); throw stopFailure; }
    })();
    return stopPromise;
  };
  const start = async () => {
    if (held.primary instanceof AuthoritySourceClosureUnprovedError) throw held.primary;
    if (stopFailure !== undefined) throw stopFailure;
    stopPromise = undefined;
    assert.equal(server, undefined);
    assertParityBundleIsCurrent();
    // This diagnostic host intentionally works while normal writable startup refuses the marker.
    const admission = acquireDiagnostic();
    if (restoreHandle !== undefined) {
      admission.assertExclusive();
      assert.throws(() => { held.competing = CanonicalRuntimeAdmission.acquireMachine(repoRoot, "shared", lifetime); },
        /offline-maintenance-unissued/u);
    }
    try {
      shell = await startFixtureServer({distDir: PARITY_DIST_DIR, bundle: {proof: "working-tree"}});
      held.shell = shell;
      const app: DashboardApp = new Hono();
      const credentials = restoreHandle === undefined && diagnosticMachine !== undefined
        ? createCredentialStore({ admission, stateRoot: root, erasureJournalAdmission: diagnosticMachine,
          erasureJournalPath: join(diagnosticMachine.stateRoot, "machine", "erasures", `${profileId}.json`) })
        : undefined;
      registerStorageRoutes(app, {storage: {admission, credentials, doctorOptions, clock,
      serviceState: () => ({state: "never-run", reason: "This diagnostic host runs no automatic backups."})}});
      app.route("/", createFixtureBff().app);
      const fixtureUrl = shell.baseUrl;
      server = createServer((req, res) => {
        const method = req.method ?? "GET", path = req.url ?? "/";
        requests.push({method, path});
        if (path === "/storage-proof-paused.html") { res.writeHead(200, {"content-type": "text/html"}).end("<!doctype html><title>Storage proof paused</title>"); return; }
        if (path.startsWith("/api/")) {
          if (method !== "GET") { res.writeHead(405).end("Read-only storage proof"); return; }
          void Promise.resolve(app.request(`http://127.0.0.1${path}`)).then(async response => {
            res.writeHead(response.status, Object.fromEntries(response.headers));
            res.end(Buffer.from(await response.arrayBuffer()));
          }).catch(() => { res.writeHead(500).end("Storage proof request failed"); });
          return;
        }
        const target = new URL(path, fixtureUrl);
        if (!path.startsWith("/") || path.startsWith("//") || target.origin !== new URL(fixtureUrl).origin) { res.writeHead(400).end("Same-origin paths only"); return; }
        const upstream = httpRequest({hostname: new URL(fixtureUrl).hostname, port: new URL(fixtureUrl).port, path: target.pathname + target.search, method}, response => {
          res.writeHead(response.statusCode ?? 502, response.headers); response.pipe(res);
        });
        upstream.on("error", () => { if (!res.headersSent) res.writeHead(502); res.end(); });
        res.on("close", () => upstream.destroy()); req.pipe(upstream);
      });
      held.server = server;
      await new Promise<void>(yes => server?.listen(0, "127.0.0.1", yes));
      const address = server.address(); assert.ok(address && typeof address !== "string");
      baseUrl = `http://127.0.0.1:${String(address.port)}`;
      return baseUrl;
    } catch (error) { held.primary = error; throw retainAuthoritySourceClosure([error], { admission: held }); }
  };
  const restore = async () => {
    if (held.primary instanceof AuthoritySourceClosureUnprovedError) throw held.primary;
    try {
    assert.equal(server, undefined, "stop the owned service before recovery");
    await stop();
    const settled = await runOfflineAuthorityRestoreRecovery(repoRoot, ["--operation", operationId,
      "--from", manifestPath, "--outcome", "replaced", "--json"], lifetime, clock);
    assert.equal(settled.report.state, "settled");
    assert.equal(existsSync(journalPath), false);
    assert.deepEqual(readFileSync(stagedPath), readFileSync(authorityPath));
    assert.deepEqual(readFileSync(credentialPath), credentialBytes);
    rmSync(stagedPath);
    assert.equal(existsSync(stagedPath), false);
    assert.deepEqual(readFileSync(credentialPath), credentialBytes);
    const machine = CanonicalRuntimeAdmission.acquireMachine(repoRoot, 'shared', lifetime); held.machine = machine;
    const admission = machine.admitProfile(profileId); held.admission = admission;
    admission.release(); machine.release();
    recoveryCompleted = true;
    const result = {exitCode: 0, output: JSON.stringify(settled.report)};
    return result;

    } catch (error) {
      const failure = retainAuthoritySourceClosure([error], { admission: held });
      held.primary = failure;
      throw failure;
    }
  };
  return {root, repoRoot, manifestPath, stagedPath, requests, readDoctor, start, stop, restore,
    get baseUrl() { assert.ok(baseUrl); return baseUrl; },
    provenance: () => ({bundle: readBundleStamp(PARITY_DIST_DIR), sourceDatabaseIdentity,
      manifestSha256: createHash("sha256").update(readFileSync(manifestPath)).digest("hex"),
      storageRoute: "registerStorageRoutes -> buildStorageDoctor -> doctorAuthorityStorage",
      surroundingFixtures: "All non-storage API responses, shell/settings, SSE and static transport use createFixtureBff/startFixtureServer; static bytes are the bound working-tree production bundle.",
      runtimeScope: "Diagnostic host over disposable storage, not the full production runtime.", pid: process.pid}),
    dispose: async () => {
      try { await stop(); if (recoveryCompleted) { await lifetime.close(); await fixture.close(); retainedStorageRecoveryOwners.delete(held); } }
      catch (error) { held.primary = error; throw retainAuthoritySourceClosure([error], { admission: held }); }
    }};

  } catch (error) { held.primary = error; throw retainAuthoritySourceClosure([error], { admission: held }); }
}
