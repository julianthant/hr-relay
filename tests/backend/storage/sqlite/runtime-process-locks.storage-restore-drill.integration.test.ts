import { testProcessImport } from "../../../support/compiled-process.js";
import { ERROR_CATALOG } from "../../../../src/models/failures/error-catalog.js";
import { createStorageRestoreTestWorld } from "../../../support/helpers/backend/storage-restore-world.js";
import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "vitest";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { acquireRuntimeProcessLock, acquireRuntimeRestoreAdmission, observeProcessIdentity, observeRuntimeLockSnapshot } from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { NOW, WRITE_ATTEMPT, WRITE_INTENT_ATTEMPTING } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { scaledMs } from "../../../support/time-scale.js";

const {CLOCK, composeStorageCommand, drillPaths, attemptingDrillPaths, open, takeBackup, corrupt, pretendAliveIdentity, deadPid, cleanup } = createStorageRestoreTestWorld();


afterEach(cleanup);

const oldBuildRefusalMembers = new Set([
  "refuses while a live process holds a runtime lock, and touches nothing",
  "refuses restore while any worker process is alive",
]);
async function prepareRestoreFixture() {
  const { paths, database, closeDatabase } = await attemptingDrillPaths();
  const manifestPath = await takeBackup(database, paths);
  closeDatabase(); corrupt(paths);
  return { paths, manifestPath, corrupted: readFileSync(paths.authorityPath) };
}
let oldBuildFixture: Awaited<ReturnType<typeof prepareRestoreFixture>> | undefined;
let currentFixture: Awaited<ReturnType<typeof prepareRestoreFixture>> | undefined;
beforeEach(async ({ task }) => {
  oldBuildFixture = undefined; currentFixture = undefined;
  if (oldBuildRefusalMembers.has(task.name)) oldBuildFixture = await prepareRestoreFixture();
});
beforeEach(async ({ task }) => {
  if (oldBuildRefusalMembers.has(task.name)) currentFixture = await prepareRestoreFixture();
});
function captureOldArtifacts(root: string) {
  return readdirSync(root, { recursive: true }).map(String).sort().map(name => {
    const path = join(root, name), info = lstatSync(path);
    assert.equal(info.isSymbolicLink(), false);
    return { name, device: info.dev, inode: info.ino, mode: info.mode, owner: info.uid,
      links: info.nlink, size: info.size, modified: info.mtimeMs, changed: info.ctimeMs,
      bytes: info.isFile() ? readFileSync(path) : undefined };
  });
}
async function assertOldBuildRefusal(fixture: Awaited<ReturnType<typeof prepareRestoreFixture>>) {
  const artifacts = captureOldArtifacts(fixture.paths.processLockRoot);
  assert.ok(artifacts.length > 0);
  const refused = await composeStorageCommand(rebuildRuntimeIsolation,
    ["restore", "--from", fixture.manifestPath], CLOCK, fixture.paths.repoRoot);
  assert.equal(refused.exitCode, 1);
  assert.equal(refused.output, `authority restore REFUSED — ${ERROR_CATALOG.RUNTIME_OLD_BUILD_ARTIFACTS.text}\nthe live authority database was not modified`);
  assert.deepEqual(captureOldArtifacts(fixture.paths.processLockRoot), artifacts);
  assert.deepEqual(readFileSync(fixture.paths.authorityPath), fixture.corrupted);
  assert.equal(existsSync(join(fixture.paths.stateRoot, "backups", "suspects")), false);
}
async function assertCurrentRestore(fixture: Awaited<ReturnType<typeof prepareRestoreFixture>>) {
  const { paths, manifestPath } = fixture;
  const after = await composeStorageCommand(rebuildRuntimeIsolation,
    ["restore", "--from", manifestPath], CLOCK, paths.repoRoot);
  assert.equal(after.exitCode, 0, after.output);
  paths.renewAfterRestore();
  const restored = open(paths);
  try {
    assert.equal(restored.authority.writeIntents.get(WRITE_INTENT_ATTEMPTING.writeIntentId)?.status, 'attempting');
    assert.deepEqual(restored.authority.writeAttempts.get(WRITE_ATTEMPT.writeAttemptId), WRITE_ATTEMPT);
    assert.equal(restored.authority.runs.get(WRITE_INTENT_ATTEMPTING.runId)?.envelope.attempt,
      WRITE_INTENT_ATTEMPTING.runAttempt);
  } finally { restored.close(); }
}

describe("corruption → degraded → restore → rebuild, through the CLI", () => {

  it("refuses while a live process holds a runtime lock, and touches nothing", async () => {
    assert.ok(oldBuildFixture && currentFixture);
    const held = acquireRuntimeProcessLock(
      { processLockRoot: oldBuildFixture.paths.processLockRoot, name: "server", pid: process.pid }, CLOCK);
    try { await assertOldBuildRefusal(oldBuildFixture); }
    finally { held.release(); }
    await assertOldBuildRefusal(oldBuildFixture);
    await assertCurrentRestore(currentFixture);
  });

  it("admits concurrent worker processes under one aggregate restore lock", async () => {
    const paths = await drillPaths();
    const first = acquireRuntimeProcessLock(
      {
        processLockRoot: paths.processLockRoot,
        name: "workers",
        workerId: "person-lookup-worker-1",
        pid: process.pid,
      },
      CLOCK,
    );
    const second = acquireRuntimeProcessLock(
      {
        processLockRoot: paths.processLockRoot,
        name: "workers",
        workerId: "person-lookup-worker-2",
        pid: process.pid,
      },
      CLOCK,
    );
    try {
      const snapshot = observeRuntimeLockSnapshot(
        {
          processLockRoot: paths.processLockRoot,
          sourceDatabaseIdentity: "a".repeat(64),
        },
        CLOCK,
      );
      assert.deepEqual(snapshot.processLocks.workers, {
        state: "active",
        generation: 3,
        pid: process.pid,
      });
    } finally {
      second.release();
      first.release();
    }
  });

  it("unwinds a worker that loses the check/write race to restore admission", async () => {
    const paths = await drillPaths();
    let restoreAdmission: ReturnType<typeof acquireRuntimeRestoreAdmission> | undefined;
    assert.throws(
      () => acquireRuntimeProcessLock({
        processLockRoot: paths.processLockRoot,
        name: "workers",
        workerId: "person-lookup-worker-2",
        pid: process.pid,
      }, CLOCK, {
        afterInitialAdmissionCheck: () => {
          restoreAdmission = acquireRuntimeRestoreAdmission({
            processLockRoot: paths.processLockRoot,
            pid: process.pid,
          }, CLOCK);
        },
      }),
      /restore admission .* is held by live pid/u,
    );
    try {
      const snapshot = observeRuntimeLockSnapshot(
        { processLockRoot: paths.processLockRoot, sourceDatabaseIdentity: "a".repeat(64) },
        CLOCK,
      );
      assert.deepEqual(snapshot.processLocks.workers, { state: "stopped", generation: 2 });
    } finally {
      restoreAdmission?.release();
    }
  });

  it("refuses malformed restore admission and archives crashed ownership", async () => {
    const malformedPaths = await drillPaths();
    mkdirSync(malformedPaths.processLockRoot, { recursive: true });
    writeFileSync(join(malformedPaths.processLockRoot, "restore-admission.lock.json"), "{}\n");
    assert.throws(
      () => acquireRuntimeProcessLock({
        processLockRoot: malformedPaths.processLockRoot,
        name: "workers",
        workerId: "person-lookup-worker-1",
        pid: process.pid,
      }, CLOCK),
      /restore admission record .* is malformed/u,
    );

    const stalePaths = await drillPaths();
    acquireRuntimeRestoreAdmission({
      processLockRoot: stalePaths.processLockRoot,
      pid: deadPid(),
    }, CLOCK, { observeProcessIdentity: pretendAliveIdentity });
    const replacement = acquireRuntimeRestoreAdmission({
      processLockRoot: stalePaths.processLockRoot,
      pid: process.pid,
    }, CLOCK);
    assert.equal(
      readdirSync(join(stalePaths.processLockRoot, "restore-admission-history")).length,
      1,
    );
    replacement.release();
    assert.equal(
      readdirSync(join(stalePaths.processLockRoot, "restore-admission-history")).length,
      2,
    );
  });

  it("advances the aggregate generation whenever a worker starts or restarts", async () => {
    const paths = await drillPaths();
    const observe = () => observeRuntimeLockSnapshot(
      { processLockRoot: paths.processLockRoot, sourceDatabaseIdentity: "a".repeat(64) },
      CLOCK,
    ).processLocks.workers.generation;
    assert.equal(observe(), 1);
    const first = acquireRuntimeProcessLock({
      processLockRoot: paths.processLockRoot,
      name: "workers",
      workerId: "person-lookup-worker-1",
      pid: deadPid(),
    }, CLOCK, { observeProcessIdentity: pretendAliveIdentity });
    assert.equal(observe(), 2);
    first.release();
    const restarted = acquireRuntimeProcessLock({
      processLockRoot: paths.processLockRoot,
      name: "workers",
      workerId: "person-lookup-worker-1",
      pid: deadPid(),
    }, CLOCK, { observeProcessIdentity: pretendAliveIdentity });
    assert.equal(observe(), 3);
    restarted.release();
  });

  it("retries release after its first durable write attempt fails", async () => {
    const paths = await drillPaths();
    let nowCalls = 0;
    const failFirstReleaseClock = {
      ...CLOCK,
      now: (): Date => {
        nowCalls += 1;
        return nowCalls === 2 ? new Date(Number.NaN) : new Date(NOW);
      },
    };
    const held = acquireRuntimeProcessLock({
      processLockRoot: paths.processLockRoot,
      name: "workers",
      workerId: "person-lookup-worker-1",
      pid: process.pid,
    }, failFirstReleaseClock);
    assert.throws(() => held.release(), /Invalid time value/u);
    assert.doesNotThrow(() => held.release());
    const snapshot = observeRuntimeLockSnapshot(
      { processLockRoot: paths.processLockRoot, sourceDatabaseIdentity: "a".repeat(64) },
      CLOCK,
    );
    assert.deepEqual(snapshot.processLocks.workers, { state: "stopped", generation: 2 });
  });

  it("retries singleton release after its first durable write attempt fails", async () => {
    const paths = await drillPaths();
    let nowCalls = 0;
    const failFirstReleaseClock = {
      ...CLOCK,
      now: (): Date => {
        nowCalls += 1;
        return nowCalls === 2 ? new Date(Number.NaN) : new Date(NOW);
      },
    };
    const held = acquireRuntimeProcessLock(
      { processLockRoot: paths.processLockRoot, name: "server", pid: process.pid },
      failFirstReleaseClock,
    );
    assert.throws(() => held.release(), /Invalid time value/u);
    assert.doesNotThrow(() => held.release());
    const snapshot = observeRuntimeLockSnapshot(
      { processLockRoot: paths.processLockRoot, sourceDatabaseIdentity: "a".repeat(64) },
      CLOCK,
    );
    assert.deepEqual(snapshot.processLocks.server, { state: "stopped", generation: 2 });
  });

  it("refuses restore while any worker process is alive", async () => {
    assert.ok(oldBuildFixture && currentFixture);
    const held = acquireRuntimeProcessLock({ processLockRoot: oldBuildFixture.paths.processLockRoot,
      name: "workers", workerId: "person-lookup-worker-2", pid: process.pid }, CLOCK);
    try { await assertOldBuildRefusal(oldBuildFixture); }
    finally { held.release(); }
    await assertOldBuildRefusal(oldBuildFixture);
    await assertCurrentRestore(currentFixture);
  });

  it("fails loud on a malformed worker process-lock record", async () => {
    const paths = await drillPaths();
    const workersRoot = join(paths.processLockRoot, "workers");
    mkdirSync(workersRoot, { recursive: true, mode:0o700 });
    writeFileSync(join(workersRoot, "broken.lock.json"), "{}\n",{mode:0o600});

    assert.throws(
      () => observeRuntimeLockSnapshot(
        {
          processLockRoot: paths.processLockRoot,
          sourceDatabaseIdentity: "a".repeat(64),
        },
        CLOCK,
      ),
      /worker process-lock record broken\.lock\.json is malformed or unsafe/u,
    );
  });

  it("refuses a second live holder of one role lock", async () => {
    const paths = await drillPaths();
    const first = acquireRuntimeProcessLock(
      { processLockRoot: paths.processLockRoot, name: "server", pid: process.pid },
      CLOCK,
    );
    assert.throws(
      () => acquireRuntimeProcessLock(
        { processLockRoot: paths.processLockRoot, name: "server", pid: process.pid },
        CLOCK,
      ),
      /server process lock is held by live pid/u,
    );
    first.release();
    // Released, the next acquire takes the NEXT generation — that advance is
    // what fences a stopped-system proof issued before the restart.
    const second = acquireRuntimeProcessLock(
      { processLockRoot: paths.processLockRoot, name: "server", pid: process.pid },
      CLOCK,
    );
    assert.equal(second.generation, 3);
    second.release();
  });

  it("admits exactly one singleton under 16-process contention and never observes it stopped", async () => {
    const paths = await drillPaths();
    const contenderCount = 16;
    const readyDirectory = join(paths.repoRoot, "contenders-ready");
    const startPath = join(paths.repoRoot, "contenders-start");
    const releasePath = join(paths.repoRoot, "contenders-release");
    mkdirSync(readyDirectory);
    const fixturePath = join(
      process.cwd(),
      "tests",
      "support", "processes",
      "runtime-lock-contender.ts",
    );
    const children: ChildProcessWithoutNullStreams[] = [];
    const outputs: string[] = [];
    for (let index = 0; index < contenderCount; index += 1) {
      const child = spawn(process.execPath, [
        "--import",
        testProcessImport(),
        fixturePath,
        paths.processLockRoot,
        readyDirectory,
        startPath,
        releasePath,
        String(index),
      ], { stdio: ["pipe", "pipe", "pipe"] });
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => outputs.push(chunk));
      child.stderr.on("data", (chunk: string) => outputs.push(`STDERR ${chunk}`));
      children.push(child);
    }
    try {
      await waitFor(() => readdirSync(readyDirectory).length === contenderCount, outputs);
      writeFileSync(startPath, "start\n", { flag: "wx" });
      await waitFor(
        () => outputs.join("").match(/^(?:ADMITTED|REFUSED) /gmu)?.length === contenderCount,
        outputs,
      );
      // Admission is printed before the child finishes its read-only snapshot.
      // Wait for that distinct observation, then retain the active-state assertion.
      await waitFor(() => /^SNAPSHOT \S+$/mu.test(outputs.join("")), outputs);
      const output = outputs.join("");
      assert.equal(output.match(/^ADMITTED /gmu)?.length, 1, output);
      assert.equal(output.match(/^REFUSED /gmu)?.length, contenderCount - 1, output);
      assert.match(output, /^ADMITTED \S+ \d+ 2$/mu);
      assert.match(output, /^SNAPSHOT active$/mu);
      const snapshot = observeRuntimeLockSnapshot({
        processLockRoot: paths.processLockRoot,
        sourceDatabaseIdentity: "a".repeat(64),
      });
      assert.equal(snapshot.processLocks.server.state, "active", output);
    } finally {
      if (!existsSync(startPath)) writeFileSync(startPath, "start\n", { flag: "wx" });
      if (!existsSync(releasePath)) writeFileSync(releasePath, "release\n", { flag: "wx" });
      await Promise.all(children.map(waitForExit));
    }
    const next = acquireRuntimeProcessLock(
      { processLockRoot: paths.processLockRoot, name: "server", pid: process.pid },
      CLOCK,
    );
    assert.equal(next.generation, 3);
    next.release();
  }, scaledMs(30_000));

  it("keeps one live process identity stable when the caller timezone changes", async () => {
    const paths = await drillPaths();
    const priorTimezone = process.env["TZ"];
    let held: ReturnType<typeof acquireRuntimeProcessLock> | undefined;
    try {
      process.env["TZ"] = "America/Los_Angeles";
      const first = observeProcessIdentity(process.pid);
      held = acquireRuntimeProcessLock(
        { processLockRoot: paths.processLockRoot, name: "server", pid: process.pid },
        CLOCK,
      );

      process.env["TZ"] = "Pacific/Honolulu";
      const second = observeProcessIdentity(process.pid);
      const snapshot = observeRuntimeLockSnapshot(
        { processLockRoot: paths.processLockRoot, sourceDatabaseIdentity: "a".repeat(64) },
        CLOCK,
      );

      assert.deepEqual(second, first);
      assert.deepEqual(snapshot.processLocks.server, {
        state: "active",
        generation: 2,
        pid: process.pid,
      });
      if (process.platform === "darwin" && second.state === "alive") {
        assert.match(second.identity.startToken, /^\d+$/u);
      }
    } finally {
      held?.release();
      if (priorTimezone === undefined) delete process.env["TZ"];
      else process.env["TZ"] = priorTimezone;
    }
  });

  it("treats a reused pid with a different OS start identity as a crashed owner", async () => {
    const paths = await drillPaths();
    const originalIdentity = Object.freeze({ platform: "darwin" as const, startToken: "birth-a" });
    const reusedIdentity = Object.freeze({ platform: "darwin" as const, startToken: "birth-b" });
    acquireRuntimeProcessLock(
      { processLockRoot: paths.processLockRoot, name: "server", pid: process.pid },
      CLOCK,
      { observeProcessIdentity: () => ({ state: "alive", identity: originalIdentity }) },
    );
    const snapshot = observeRuntimeLockSnapshot(
      { processLockRoot: paths.processLockRoot, sourceDatabaseIdentity: "a".repeat(64) },
      CLOCK,
      { observeProcessIdentity: () => ({ state: "alive", identity: reusedIdentity }) },
    );
    assert.deepEqual(snapshot.processLocks.server, { state: "stopped", generation: 2 });
  });

  it("archives restore admission when its pid was reused by a different process birth", async () => {
    const paths = await drillPaths();
    const originalIdentity = Object.freeze({ platform: "darwin" as const, startToken: "birth-a" });
    const reusedIdentity = Object.freeze({ platform: "darwin" as const, startToken: "birth-b" });
    acquireRuntimeRestoreAdmission(
      { processLockRoot: paths.processLockRoot, pid: process.pid },
      CLOCK,
      { observeProcessIdentity: () => ({ state: "alive", identity: originalIdentity }) },
    );
    const replacement = acquireRuntimeRestoreAdmission(
      { processLockRoot: paths.processLockRoot, pid: process.pid },
      CLOCK,
      { observeProcessIdentity: () => ({ state: "alive", identity: reusedIdentity }) },
    );
    assert.equal(readdirSync(join(paths.processLockRoot, "restore-admission-history")).length, 1);
    replacement.release();
  });
});

async function waitFor(predicate: () => boolean, diagnostics: readonly string[]): Promise<void> {
  const deadline = Date.now() + scaledMs(20_000);
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error(`timed out waiting for lock contenders:\n${diagnostics.join("")}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function waitForExit(child: ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null) {
      if (child.exitCode === 0) resolve();
      else reject(new Error(`runtime-lock contender exited with code ${String(child.exitCode)}`));
      return;
    }
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(
        `runtime-lock contender exited with code ${String(code)} signal ${signal ?? "none"}`,
      ));
    });
  });
}
