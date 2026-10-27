import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { it } from "vitest";
import { z } from "zod";
import { workerBootstrapEnvironment } from "../../../../src/models/config/secrets.js";
import { inspectRuntimeProcessOrphans, observeProcessIdentity, WorkerProcessLockFileSchema } from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { createHistoricalFlatProfileFixture } from "../../../support/fixtures/storage/historical-flat-profile-fixture.js";

for (const unknownWrite of [false, true]) it(`dispatches actual secure-bootstrap recovery plan/apply with UNKNOWN=${String(unknownWrite)}`, () => {
  const f = createHistoricalFlatProfileFixture({ closedBrowser: true, unknownWrite });
  try {
    const module = pathToFileURL(join(process.cwd(), "src/backend/storage/sqlite/runtime-process-locks.ts")).href;
    const script = `import { acquireRuntimeProcessLock } from ${JSON.stringify(module)};
      const held = acquireRuntimeProcessLock({ processLockRoot: process.argv[1], name: "workers", workerId: "synthetic-cli-worker", pid: process.pid });
      process.stdout.write(held.acquisitionId);`;
    const owner = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script, f.processLockRoot],
      { encoding: "utf8", timeout: 20_000, env: workerBootstrapEnvironment() });
    assert.equal(owner.error, undefined); assert.equal(owner.status, 0, owner.stderr);
    const acquisition = z.uuid().parse(owner.stdout.trim()), originalPath = join(f.processLockRoot, "workers", `${acquisition}.lock.json`);
    const original = WorkerProcessLockFileSchema.parse(JSON.parse(readFileSync(originalPath, "utf8")));
    assert.equal(original.pid, owner.pid); assert.equal(observeProcessIdentity(original.pid).state, "gone");
    cpSync(join(process.cwd(), "src"), join(f.workspace, "src"), { recursive: true });
    mkdirSync(join(f.workspace, "scripts/dev"), { recursive: true });
    cpSync(join(process.cwd(), "scripts/dev/secure-env-bootstrap.ts"), join(f.workspace, "scripts/dev/secure-env-bootstrap.ts"));
    mkdirSync(join(f.workspace, "config"));
    for (const name of ["runtime-isolation.json", "test-data.json", "dashboard-workflow-sources.json"]) cpSync(join(process.cwd(), "config", name), join(f.workspace, "config", name));
    symlinkSync(dirname(dirname(fileURLToPath(import.meta.resolve("tsx/package.json")))), join(f.workspace, "node_modules"));
    const before = [originalPath, f.databasePath, f.protectedPath].map(path => ({ path, bytes: readFileSync(path), inode: statSync(path).ino }));
    const command = (args: string[]) => spawnSync(process.execPath,
      ["--import", "tsx", "scripts/dev/secure-env-bootstrap.ts", "cli", "storage", "recover-worker-process", "--acquisition", acquisition, ...args],
      { cwd: f.workspace, encoding: "utf8", timeout: 20_000, env: workerBootstrapEnvironment() });
    const lockNames = readdirSync(f.processLockRoot), controlNames = readdirSync(join(f.workspace, ".tracker/control"));
    const planned = command(["--plan", "--json"]);
    assert.equal(planned.error, undefined); assert.equal(planned.status, 0, planned.stderr);
    const plan = z.object({ state: z.literal("planned"), authorized: z.literal(false), captureDigest: z.string().length(64),
      nativeClosure: z.literal("apply-proof-required") }).parse(JSON.parse(planned.stdout));
    assert.deepEqual(readdirSync(f.processLockRoot), lockNames); assert.deepEqual(readdirSync(join(f.workspace, ".tracker/control")), controlNames);
    const invalid = command(["--apply", "--capture", "0".repeat(64), "--json"]);
    assert.equal(invalid.error, undefined); assert.notEqual(invalid.status, 0);
    assert.match(invalid.stderr, /WORKER_PROCESS_RECOVERY_REFUSED/u); assert.equal(invalid.stdout, "");
    const applied = command(["--apply", "--capture", plan.captureDigest, "--json"]);
    assert.equal(applied.error, undefined);
    if (unknownWrite) {
      assert.notEqual(applied.status, 0); assert.match(applied.stderr, /WORKER_PROCESS_RECOVERY_REFUSED/u); assert.equal(applied.stdout, "");
      assert.equal(existsSync(join(f.processLockRoot, "worker-process-recovery", `${acquisition}.json`)), false);
      assert.equal(inspectRuntimeProcessOrphans(f.processLockRoot).staleWorkerRecords, 1);
    } else {
      assert.equal(applied.status, 0, applied.stderr);
      const result = z.object({ state: z.literal("recovered"), acquisitionId: z.literal(acquisition), receiptPath: z.string() }).parse(JSON.parse(applied.stdout));
      assert.equal(existsSync(result.receiptPath), true);
      assert.equal(inspectRuntimeProcessOrphans(f.processLockRoot).staleWorkerRecords, 0);
    }
    for (const source of before) { assert.deepEqual(readFileSync(source.path), source.bytes); assert.equal(statSync(source.path).ino, source.inode); }
    assert.equal(WorkerProcessLockFileSchema.parse(JSON.parse(readFileSync(originalPath, "utf8"))).releasedAt, null);
    assert.equal(existsSync(join(f.processLockRoot, "restore-admission.lock.json")), false);
    assert.deepEqual(readdirSync(join(f.workspace, ".tracker/control/leases")), []);
    process.stdout.write(`${JSON.stringify({ recoveryCliProof: { unknownWrite, planExit: planned.status,
      changedCaptureExit: invalid.status, applyExit: applied.status, originalPreserved: true, custodyReleased: true } })}\n`);
  } finally { f.close(); }
});
