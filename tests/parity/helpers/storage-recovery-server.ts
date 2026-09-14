/** Storage-owned test composition: real doctor route; fixture shell/settings/SSE/static responses. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer, request as httpRequest, type Server } from "node:http";
import { dirname, join } from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { Hono } from "hono";
import { archiveFixture, attachFile } from "../../unit/archive-transfer/fixtures.js";
import { createFixtureBff, startFixtureServer, type FixtureServer } from "./fixture-bff.js";
import { assertParityBundleIsCurrent, PARITY_DIST_DIR, readBundleStamp } from "./bundle.js";
import { registerStorageRoutes } from "../../../src/server/dashboard/routes/storage.js";
import type { DashboardApp } from "../../../src/server/dashboard/routes/api-types.js";
import { backupStoppedAuthority } from "../../../src/server/storage/upgrade.js";
import { composeStorageCommand } from "../../../src/server/storage/compose.js";
import { rebuildRuntimeIsolation } from "../../../src/config/runtime-isolation.js";
import { AuthorityDatabase } from "../../../src/infra/sqlite/authority-database.js";
import { restoreLifecyclePair, verifyLifecyclePair } from "../../../src/infra/sqlite/lifecycle-storage.js";
import { RecoveryStopProofStore } from "../../../src/infra/sqlite/recovery-stop-proof.js";
import { acquireRuntimeProcessLock, observeRuntimeLockSnapshot, type RuntimeProcessLockHandle } from "../../../src/infra/sqlite/runtime-process-locks.js";
import { createCredentialStore } from "../../../src/infra/config/credential-store.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH } from "../../../src/domain/config/protected-settings.js";

export async function storageRecoveryTarget() {
  const f = archiveFixture({repositoryLayout: true});
  const root = f.base.root, repoRoot = dirname(root), clock = f.base.clock;
  writeFileSync(join(repoRoot, "package.json"), JSON.stringify({name: "synthetic-storage-proof", version: "0.1.0"}));
  const {file, bytes} = attachFile(f.database, root, f.base.run.envelope.runId, 89720);
  f.terminal();
  assert.equal(f.kernel.execute(f.applyRequest(f.plan())).state, "applied");
  const credentials = createCredentialStore({stateRoot: root}).apply({commandId: "00000000-0000-4000-8000-000000089750",
    commandFingerprint: "a".repeat(64), expectedRevision: 1, protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH,
    writeId: "00000000-0000-4000-8000-000000089751", updatedAt: clock.now().toISOString(),
    entries: {ucpathPassword: {set: "SYNTHETIC_STORAGE_PROOF_NEVER_REAL"}}});
  assert.equal(credentials.state, "applied");
  f.database.close();
  const backup = await backupStoppedAuthority(root, clock);
  assert.ok("pairedManifestPath" in backup);
  const manifestPath = backup.pairedManifestPath;
  const verified = await verifyLifecyclePair(manifestPath);
  const processLockRoot = join(root, "locks");
  const sourceDatabaseIdentity = AuthorityDatabase.sourceDatabaseIdentity(f.base.path);
  const options = {authorityPath: f.base.path, suspectDirectory: join(root, "suspects"), busyTimeoutMs: 500,
    processLockRoot, stoppedProofMaxAgeMs: 60000};
  const proof = () => {
    const store = new RecoveryStopProofStore({processLockRoot, maxProofAgeMs: 60000}, clock);
    store.recordRuntimeState(observeRuntimeLockSnapshot({processLockRoot, sourceDatabaseIdentity}, clock));
    return store.issue({observedBy: "local-operator", sourceDatabaseIdentity});
  };
  await assert.rejects(restoreLifecyclePair(options, {manifestPath, stoppedSystemProof: proof()}, async () => {}, clock,
    step => { if (step === "archive") throw new Error("synthetic-pair-interruption"); }), /lifecycle-restore-incomplete/u);
  assert.equal(existsSync(join(root, ".lifecycle-restore.json")), true);
  assert.throws(() => AuthorityDatabase.open({path: f.base.path, busyTimeoutMs: 500, migrationOwner: "browser-proof"}, clock), /lifecycle-restore-incomplete/u);
  const credentialPath = join(root, "credentials", "protected.json");
  const credentialBytes = readFileSync(credentialPath);
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
  };
  const start = async () => {
    assert.equal(server, undefined);
    assertParityBundleIsCurrent();
    // This diagnostic host intentionally works while normal writable startup refuses the marker.
    lock = acquireRuntimeProcessLock({processLockRoot, name: "server", pid: process.pid}, clock);
    try {
      shell = await startFixtureServer({distDir: PARITY_DIST_DIR, bundle: {proof: "working-tree"}});
      const app: DashboardApp = new Hono();
      registerStorageRoutes(app, {storage: {doctorOptions: {stateRootTrustAnchor: repoRoot, stateRoot: root,
        authorityPath: f.base.path, backupDirectory: verified.root, busyTimeoutMs: 500}, clock,
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
    const result = await composeStorageCommand(rebuildRuntimeIsolation, ["restore", "--from", manifestPath, "--json"], clock, repoRoot);
    assert.equal(result.exitCode, 0, result.output);
    assert.equal(existsSync(join(root, ".lifecycle-restore.json")), false);
    assert.deepEqual(readFileSync(credentialPath), credentialBytes);
    assert.deepEqual(readFileSync(join(root, "archive-files", file.digest)), bytes);
    return result;
  };
  return {root, repoRoot, manifestPath, requests, start, stop, restore,
    get baseUrl() { assert.ok(baseUrl); return baseUrl; },
    provenance: () => ({bundle: readBundleStamp(PARITY_DIST_DIR), sourceDatabaseIdentity,
      manifestSha256: createHash("sha256").update(readFileSync(manifestPath)).digest("hex"),
      storageRoute: "registerStorageRoutes -> buildStorageDoctor -> doctorAuthorityStorage",
      surroundingFixtures: "All non-storage API responses, shell/settings, SSE and static transport use createFixtureBff/startFixtureServer; static bytes are the bound working-tree production bundle.",
      runtimeScope: "Diagnostic host over disposable storage, not the full production runtime.", pid: process.pid}),
    dispose: async () => { await stop(); f.dispose(); }};
}
