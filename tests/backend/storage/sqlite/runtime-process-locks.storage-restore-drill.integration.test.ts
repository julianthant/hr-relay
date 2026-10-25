import { createStorageRestoreTestWorld } from "../../../support/helpers/backend/storage-restore-world.js";
import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import {existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { acquireRuntimeProcessLock, acquireRuntimeRestoreAdmission, observeProcessIdentity, observeRuntimeLockSnapshot } from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { NOW, WRITE_ATTEMPT, WRITE_INTENT_ATTEMPTING } from "../../../support/fixtures/phase1c-contract-fixtures.js";

const {CLOCK, composeStorageCommand, drillPaths, attemptingDrillPaths, open, takeBackup, corrupt, pretendAliveIdentity, deadPid, cleanup } = createStorageRestoreTestWorld();


afterEach(cleanup);

describe("corruption → degraded → restore → rebuild, through the CLI", () => {

  it("refuses while a live process holds a runtime lock, and touches nothing", async () => {
    const { paths, database, closeDatabase } = await attemptingDrillPaths();
    const manifestPath = await takeBackup(database, paths);
    closeDatabase();
    corrupt(paths);
    const corrupted = readFileSync(paths.authorityPath);

    // This test process IS a live pid, which is exactly the condition.
    const held = acquireRuntimeProcessLock(
      { processLockRoot: paths.processLockRoot, name: "server", pid: process.pid },
      CLOCK,
    );
    try {
      const refused = await composeStorageCommand(
        rebuildRuntimeIsolation,
        ["restore", "--from", manifestPath],
        CLOCK,
        paths.repoRoot,
      );
      assert.equal(refused.exitCode, 1);
      assert.match(refused.output, /authority restore REFUSED/u);
      assert.match(refused.output, new RegExp(`server process lock generation 2 is active for pid ${String(process.pid)}`, "u"));
      assert.match(refused.output, /the live authority database was not modified/u);
      assert.match(refused.output, new RegExp(`server=ACTIVE pid ${String(process.pid)}`, "u"));
      assert.equal(readFileSync(paths.authorityPath).equals(corrupted), true);
      assert.equal(existsSync(join(paths.stateRoot, "backups", "suspects")), false);
    } finally {
      held.release();
    }


    const after = await composeStorageCommand(
      rebuildRuntimeIsolation,
      ["restore", "--from", manifestPath],
      CLOCK,
      paths.repoRoot,
    );
    assert.equal(after.exitCode, 0, after.output);
    paths.renewAfterRestore();
    const restored = open(paths);
    try {
      assert.equal(restored.authority.writeIntents.get(WRITE_INTENT_ATTEMPTING.writeIntentId)?.status, 'attempting');
      assert.deepEqual(restored.authority.writeAttempts.get(WRITE_ATTEMPT.writeAttemptId), WRITE_ATTEMPT);
      assert.equal(restored.authority.runs.get(WRITE_INTENT_ATTEMPTING.runId)?.envelope.attempt,
        WRITE_INTENT_ATTEMPTING.runAttempt);
    } finally { restored.close(); }
  });

  it("admits concurrent worker processes under one aggregate restore lock", () => {
    const paths = drillPaths();
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

  it("unwinds a worker that loses the check/write race to restore admission", () => {
    const paths = drillPaths();
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

  it("refuses malformed restore admission and archives crashed ownership", () => {
    const malformedPaths = drillPaths();
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

    const stalePaths = drillPaths();
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

  it("advances the aggregate generation whenever a worker starts or restarts", () => {
    const paths = drillPaths();
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

  it("retries release after its first durable write attempt fails", () => {
    const paths = drillPaths();
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

  it("retries singleton release after its first durable write attempt fails", () => {
    const paths = drillPaths();
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
    const { paths, database, closeDatabase } = await attemptingDrillPaths();
    const manifestPath = await takeBackup(database, paths);
    closeDatabase();
    corrupt(paths);
    const corrupted = readFileSync(paths.authorityPath);
    const held = acquireRuntimeProcessLock({
      processLockRoot: paths.processLockRoot,
      name: "workers",
      workerId: "person-lookup-worker-2",
      pid: process.pid,
    }, CLOCK);
    try {
      const refused = await composeStorageCommand(
        rebuildRuntimeIsolation,
        ["restore", "--from", manifestPath],
        CLOCK,
        paths.repoRoot,
      );
      assert.equal(refused.exitCode, 1);
      assert.match(refused.output, new RegExp(
        `workers=ACTIVE pid ${String(process.pid)} \\(generation ${String(held.generation)}\\)`,
        "u",
      ));
      assert.equal(readFileSync(paths.authorityPath).equals(corrupted), true);
    } finally {
      held.release();
    }
  });

  it("fails loud on a malformed worker process-lock record", () => {
    const paths = drillPaths();
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

  it("refuses a second live holder of one role lock", () => {
    const paths = drillPaths();
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
    const paths = drillPaths();
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
        "tsx",
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
  }, 30_000);

  it("keeps one live process identity stable when the caller timezone changes", () => {
    const paths = drillPaths();
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

  it("treats a reused pid with a different OS start identity as a crashed owner", () => {
    const paths = drillPaths();
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

  it("archives restore admission when its pid was reused by a different process birth", () => {
    const paths = drillPaths();
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
  const deadline = Date.now() + 20_000;
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
