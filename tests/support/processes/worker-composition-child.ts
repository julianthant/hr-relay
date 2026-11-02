import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { z } from "zod";
import { acquireSharedRuntimeAdmission } from "../../../src/backend/storage/admission/admission.js";
import { captureSelectedProfileStorage } from "../../../src/backend/app/composition/storage-compose.js";
import { composeWorkerRuntime } from "../../../src/backend/app/composition/worker-compose.js";
import { rebuildRuntimeIsolation } from "../../../src/backend/app/config/runtime-isolation.js";
import { AuthorityDatabase } from "../../../src/backend/storage/sqlite/authority-database.js";
import { receiveRuntimeLifetimeLock } from "../../../src/backend/storage/admission/lifetime-lock.js";
import { createCredentialStore } from "../../../src/backend/storage/configuration/credential-store.js";
import { readSettings } from "../../../src/backend/runtime/settings/settings-runtime.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { healthyRuntimePreflightRunners } from "../fixtures/preflight-seams.js";
import { happySessionHarness, ManualScheduler } from "../helpers/phase1f-executor-harness.js";
import { duoCeremonyGatesOver } from "../helpers/duo-ceremony-fixtures.js";

const root = z.string().min(1).parse(process.argv[2]), poolIndex = z.coerce.number().int().min(1).max(3).parse(process.argv[3]);
const clock = manualClock(new Date(z.string().datetime().parse(process.argv[4])));
const controller = new AbortController();
const lifetimeLock = await receiveRuntimeLifetimeLock(z.coerce.number().int().positive().parse(process.argv[5]), () => controller.abort(new Error("fixture-parent-disconnected")));
const machine = acquireSharedRuntimeAdmission(root, lifetimeLock);
let child: ReturnType<typeof machine.admitProfile> | undefined, database: AuthorityDatabase | undefined;
let entered = false, proved = false;
try {
  const selected = captureSelectedProfileStorage(machine);
  child = machine.admitProfile(selected.profileId);
  const credentials = createCredentialStore({ admission: child, stateRoot: child.stateRoot,
    });
  database = AuthorityDatabase.open(child, { path: selected.authorityPath, busyTimeoutMs: 5000, migrationOwner: "worker-composition-child" },
    clock, undefined, undefined, undefined, credentials);
  const active = database.authority.runtimeConfig.get(); assert.ok(active);
  const settingsRevision = readSettings(database.authority).revision, identity = statSync(selected.authorityPath);
  const run = once(process, "message");
  process.send?.({ state: "ready", detail: JSON.stringify({ pid: process.pid }) });
  assert.equal((await run)[0], "run");
  entered = true;
  const report = await composeWorkerRuntime({ lifetimeLock, stopSignal: controller.signal, admission: machine, repoRoot: root, isolation: rebuildRuntimeIsolation, env: {}, clock,
    args: ["person-lookup", "--pool-index", String(poolIndex), "--drain"], ids: { uuid: randomUUID },
    preflightRunnerFactory: healthyRuntimePreflightRunners, sessionFactory: happySessionHarness().factory,
    duoCeremony: duoCeremonyGatesOver(database, clock, new ManualScheduler(clock)),
    heartbeatIntervalMs: 600_000,
    write: () => undefined });
  assert.equal(report.closure, "proved");
  const databaseIdentity = database.getSourceDatabaseIdentity();
  database.close(); database = undefined;
  child.release(); child = undefined;
  machine.release(); proved = true;
  const descriptors = spawnSync("lsof", ["-nP", "-a", "-p", String(process.pid), "-Fn"], { encoding: "utf8" });
  assert.equal(descriptors.status, 0);
  assert.equal(descriptors.stderr, "");
  assert.equal(descriptors.stdout.split("\n").some(line => [selected.authorityPath, selected.authorityPath + "-wal", selected.authorityPath + "-shm"].some(path => line === "n" + path)), false);
  process.send?.({ state: "report", detail: JSON.stringify({ pid: process.pid, profileId: selected.profileId,
    databaseIdentity, device: identity.dev, inode: identity.ino,
    configFingerprint: active.configFingerprint, settingsRevision, workerId: report.workerId,
    outcomes: report.outcomes.map(value => value.state), closure: report.closure, stopped: report.stopped }) });
} catch (error) {
  const failureHash = createHash("sha256").update(error instanceof Error ? `${error.name}:${error.message}` : typeof error).digest("hex");
  process.send?.({ state: "failed", detail: JSON.stringify({ code: "worker-composition-child-failed", failureHash }) });
  process.exitCode = 1;
} finally {
  if (!entered) { database?.close(); child?.release(); machine.release(); }
  if (proved || !entered) await lifetimeLock.close();
  if (proved || process.exitCode === 1) process.disconnect?.();
}
