/** Storage-owned test composition: real doctor route; fixture shell/settings/SSE/static responses. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer, request as httpRequest, type Server } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { existsSync, readFileSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { Hono } from "hono";
import { systemClock } from "../../../src/rules/time/clock.js";
import { acquireEntrypointAdmission } from "../../../src/backend/storage/admission/bootstrap-admission.js";
import { runOfflineAuthorityRestoreRecovery } from "../../../src/backend/app/composition/storage-compose.js";
import { createFixtureBff, startFixtureServer, type FixtureServer } from "./fixture-bff.js";
import { assertParityBundleIsCurrent, PARITY_DIST_DIR, readBundleStamp } from "./bundle.js";
import { registerStorageRoutes } from "../../../src/backend/transports/http/routes/storage.js";
import type { DashboardApp } from "../../../src/backend/transports/http/routes/api-types.js";
import { acquireRecoveryRuntimeRestore, type RuntimeAdmission } from "../../../src/backend/storage/admission/admission.js";
import { doctorAuthorityStorage } from "../../../src/backend/storage/sqlite/storage-doctor.js";
import { acquireRuntimeRestoreAdmission, type RestoreAdmissionHandle, acquireRuntimeProcessLock, type RuntimeProcessLockHandle } from "../../../src/backend/storage/sqlite/runtime-process-locks.js";

export async function storageRecoveryTarget() {
  const repoRoot = realpathSync(mkdtempSync(join(tmpdir(), "parity-native-restore-")));
  const clock = systemClock;
  const sourceUrl = (path: string) => pathToFileURL(join(process.cwd(), path)).href;
  const code = `
    import { readFileSync, renameSync, copyFileSync } from "node:fs";
    import { join } from "node:path";
    const { systemClock } = await import(${JSON.stringify(sourceUrl("src/rules/time/clock.ts"))});
    const { acquireEntrypointAdmission } = await import(${JSON.stringify(sourceUrl("src/backend/storage/admission/bootstrap-admission.ts"))});
    const { AuthorityDatabase } = await import(${JSON.stringify(sourceUrl("src/backend/storage/sqlite/authority-database.ts"))});
    const { AuthorityBackupService } = await import(${JSON.stringify(sourceUrl("src/backend/storage/sqlite/backup-service.ts"))});
    const { OfflineAuthorityRestoreService } = await import(${JSON.stringify(sourceUrl("src/backend/storage/sqlite/offline-restore.ts"))});
    const { createCredentialStore } = await import(${JSON.stringify(sourceUrl("src/backend/storage/configuration/credential-store.ts"))});
    const { PROTECTED_SETTINGS_SCHEMA_HASH } = await import(${JSON.stringify(sourceUrl("src/models/config/protected-settings.ts"))});
    const { observeRuntimeLockSnapshot } = await import(${JSON.stringify(sourceUrl("src/backend/storage/sqlite/runtime-process-locks.ts"))});
    const { RecoveryStopProofStore } = await import(${JSON.stringify(sourceUrl("src/backend/storage/sqlite/recovery-stop-proof.ts"))});
    const workspace = process.argv[1], admission = acquireEntrypointAdmission(workspace, "exclusive"), root = admission.stateRoot;
    const path = join(root, "state.db"), directory = join(root, "backups", "authority"), processLockRoot = join(root, "locks");
    const database = AuthorityDatabase.open(admission, { path, busyTimeoutMs: 500, migrationOwner: "parity-native-restore" });
    const credentialResult = createCredentialStore({admission, stateRoot: root}).apply({commandId: "00000000-0000-4000-8000-000000089750",
      commandFingerprint: "a".repeat(64), expectedRevision: 1, protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH,
      writeId: "00000000-0000-4000-8000-000000089751", updatedAt: systemClock.now().toISOString(),
      entries: {ucpathPassword: {set: "SYNTHETIC_STORAGE_PROOF_NEVER_REAL"}}});
    if (credentialResult.state !== "applied") throw new Error("synthetic-credential-refused");
    const backup = await new AuthorityBackupService(admission, database, {directory}).request({trigger: "operator", requiredGeneration: database.getMeta().authorityGeneration});
    database.close();
    const manifestPath = join(directory, backup.manifests[0].backupFileName + ".manifest.json");
    const sourceDatabaseIdentity = AuthorityDatabase.sourceDatabaseIdentity(path);
    const proofs = new RecoveryStopProofStore({processLockRoot, maxProofAgeMs: 60000});
    proofs.recordRuntimeState(observeRuntimeLockSnapshot({processLockRoot, sourceDatabaseIdentity}));
    const stoppedSystemProof = proofs.issue({observedBy: "local-operator", sourceDatabaseIdentity});
    const restore = new OfflineAuthorityRestoreService(admission, {authorityPath: path, suspectDirectory: join(root, "backups", "suspects"),
      processLockRoot, busyTimeoutMs: 500, stoppedProofMaxAgeMs: 60000}, async () => {}, undefined,
      {copyFile: copyFileSync, atomicReplace(source, destination) {
        renameSync(source, destination); copyFileSync(destination, source);
        const journal = JSON.parse(readFileSync(join(workspace, ".tracker", "control", "journal.json"), "utf8"));
        process.send({root, authorityPath: path, manifestPath, stagedPath: source, operationId: journal.restore.operationId, sourceDatabaseIdentity});
        const wait = new Int32Array(new SharedArrayBuffer(4));
        for (;;) Atomics.wait(wait, 0, 0, 1000);
      }});
    await restore.restore({manifestPath, stoppedSystemProof});
  `;
  const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code, repoRoot],
    {cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe", "ipc"]});
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
  } catch (error) { startupError = error; } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise<void>(resolve => child.once("exit", () => resolve()));
      child.kill("SIGKILL"); await exited;
    }
  }
  if (startupError !== undefined) { rmSync(repoRoot, {recursive: true, force: true}); throw startupError instanceof Error ? startupError : new Error("native-restore-fixture-startup-failed", {cause: startupError}); }
  assert.ok(ready);
  const {root, authorityPath, manifestPath, stagedPath, operationId, sourceDatabaseIdentity} = ready;
  const processLockRoot = join(root, "locks");
  const journalPath = join(repoRoot, ".tracker", "control", "journal.json");
  assert.equal(existsSync(journalPath), true);
  assert.throws(() => acquireEntrypointAdmission(repoRoot, "shared"), /unfinished restoring/u);
  const credentialPath = join(root, "credentials", "protected.json");
  const credentialBytes = readFileSync(credentialPath);
  let diagnosticAdmission: RuntimeAdmission | undefined, restoreHandle: RestoreAdmissionHandle | undefined;
  const acquireDiagnostic = () => {
    if (diagnosticAdmission !== undefined) return diagnosticAdmission;
    if (existsSync(journalPath)) {
      restoreHandle = acquireRuntimeRestoreAdmission({processLockRoot, pid: process.pid}, clock);
      try { diagnosticAdmission = acquireRecoveryRuntimeRestore(repoRoot, operationId, restoreHandle).admission; }
      catch (error) { restoreHandle.release(); restoreHandle = undefined; throw error; }
    } else diagnosticAdmission = acquireEntrypointAdmission(repoRoot, "shared");
    return diagnosticAdmission;
  };
  acquireDiagnostic();
  const doctorOptions = {stateRootTrustAnchor: repoRoot, stateRoot: root, authorityPath,
    backupDirectory: join(root, "backups", "authority"), busyTimeoutMs: 500};
  const readDoctor = () => doctorAuthorityStorage(acquireDiagnostic(), doctorOptions, clock);
  let server: Server | undefined, shell: FixtureServer | undefined, lock: RuntimeProcessLockHandle | undefined;
  let baseUrl: string | undefined;
  const requests: {method: string; path: string}[] = [];
  const stop = async () => {
    if (server !== undefined) {
      server.closeAllConnections();
      await new Promise<void>((yes, no) => server?.close(error => error ? no(error) : yes())); server = undefined;
    }
    await shell?.close(); shell = undefined;
    lock?.release(); lock = undefined; baseUrl = undefined;
    try { diagnosticAdmission?.release(); }
    finally { diagnosticAdmission = undefined; restoreHandle?.release(); restoreHandle = undefined; }
  };
  const start = async () => {
    assert.equal(server, undefined);
    assertParityBundleIsCurrent();
    // This diagnostic host intentionally works while normal writable startup refuses the marker.
    const admission = acquireDiagnostic();
    lock = acquireRuntimeProcessLock({processLockRoot, name: "server", pid: process.pid}, clock);
    try {
      shell = await startFixtureServer({distDir: PARITY_DIST_DIR, bundle: {proof: "working-tree"}});
      const app: DashboardApp = new Hono();
      registerStorageRoutes(app, {storage: {admission, doctorOptions, clock,
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
        const upstream = httpRequest(new URL(path, fixtureUrl), {method}, response => {
          res.writeHead(response.statusCode ?? 502, response.headers); response.pipe(res);
        });
        upstream.on("error", () => { if (!res.headersSent) res.writeHead(502); res.end(); });
        res.on("close", () => upstream.destroy()); req.pipe(upstream);
      });
      await new Promise<void>(yes => server?.listen(0, "127.0.0.1", yes));
      const address = server.address(); assert.ok(address && typeof address !== "string");
      baseUrl = `http://127.0.0.1:${String(address.port)}`;
      return baseUrl;
    } catch (error) { await stop(); throw error; }
  };
  const restore = async () => {
    assert.equal(server, undefined, "stop the owned service before recovery");
    await stop();
    const settled = await runOfflineAuthorityRestoreRecovery(repoRoot, ["--operation", operationId,
      "--from", manifestPath, "--outcome", "replaced", "--json"], clock);
    assert.equal(settled.report.state, "settled");
    assert.equal(existsSync(journalPath), false);
    assert.deepEqual(readFileSync(stagedPath), readFileSync(authorityPath));
    assert.deepEqual(readFileSync(credentialPath), credentialBytes);
    rmSync(stagedPath);
    assert.equal(existsSync(stagedPath), false);
    assert.deepEqual(readFileSync(credentialPath), credentialBytes);
    const admission = acquireEntrypointAdmission(repoRoot, "shared");
    admission.release();
    const result = {exitCode: 0, output: JSON.stringify(settled.report)};
    return result;
  };
  return {root, repoRoot, manifestPath, stagedPath, requests, readDoctor, start, stop, restore,
    get baseUrl() { assert.ok(baseUrl); return baseUrl; },
    provenance: () => ({bundle: readBundleStamp(PARITY_DIST_DIR), sourceDatabaseIdentity,
      manifestSha256: createHash("sha256").update(readFileSync(manifestPath)).digest("hex"),
      storageRoute: "registerStorageRoutes -> buildStorageDoctor -> doctorAuthorityStorage",
      surroundingFixtures: "All non-storage API responses, shell/settings, SSE and static transport use createFixtureBff/startFixtureServer; static bytes are the bound working-tree production bundle.",
      runtimeScope: "Diagnostic host over disposable storage, not the full production runtime.", pid: process.pid}),
    dispose: async () => { await stop(); rmSync(repoRoot, {recursive: true, force: true}); }};
}
