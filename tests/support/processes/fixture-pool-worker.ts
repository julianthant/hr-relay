import { randomUUID } from "node:crypto";
import { existsSync, watch, writeFileSync } from "node:fs";
import { join } from "node:path";
import { captureSelectedProfileStorage } from "../../../src/backend/app/composition/storage-compose.js";
import { composeWorkerRuntime } from "../../../src/backend/app/composition/worker-compose.js";
import { rebuildRuntimeIsolation } from "../../../src/backend/app/config/runtime-isolation.js";
import { WorkerParentMessageSchema } from "../../../src/backend/runtime/workers/worker-messages.js";
import { acquireSharedRuntimeAdmission } from "../../../src/backend/storage/admission/admission.js";
import { WorkerRuntimeLifetimeLock } from "../../../src/backend/storage/admission/lifetime-lock.js";
import { createCredentialStore } from "../../../src/backend/storage/configuration/credential-store.js";
import { AuthorityDatabase } from "../../../src/backend/storage/sqlite/authority-database.js";
import { PositiveIntSchema } from "../../../src/rules/identity/ids.js";
import { systemClock } from "../../../src/rules/time/clock.js";
import { healthyRuntimePreflightRunners } from "../fixtures/preflight-seams.js";
import { duoCeremonyGatesOver } from "../helpers/duo-ceremony-fixtures.js";
import { healthyCrmDriver, healthyUcpathDriver, sessionFactoryHarness } from "../helpers/phase1f-executor-harness.js";

// A pool worker on the production worker runtime and IPC with fixture browser sessions. With a barrier directory it marks
// `entered-<pid>`, `stop-<reason>-<pid>` and `exit-<code>-<pid>`, and holds each UCPath search until `release` exists.
const [portRaw, barrier, subcommand, ...args] = process.argv.slice(2);
if (portRaw === undefined || barrier === undefined || subcommand !== "worker") {
  throw new Error(`fixture-pool-worker refused argv ${JSON.stringify(process.argv.slice(2))}; expected <runtime-port> <barrier|-> worker <workflow-id> ...`);
}
const mark = (name: string): void => { if (barrier !== "-") writeFileSync(join(barrier, `${name}-${String(process.pid)}`), ""); };
const held = async (): Promise<void> => {
  mark("entered");
  const release = join(barrier, "release");
  await new Promise<void>(resolve => {
    const observer = watch(barrier, () => { if (existsSync(release)) { observer.close(); resolve(); } });
    if (existsSync(release)) { observer.close(); resolve(); }
  });
};
process.on("message", (raw: unknown) => {
  const message = WorkerParentMessageSchema.safeParse(raw);
  if (message.success && message.data.kind === "worker-stop") mark(`stop-${message.data.reason}`);
});
process.on("exit", code => { mark(`exit-${String(code)}`); });

const controller = new AbortController();
const lock = await WorkerRuntimeLifetimeLock.receive(PositiveIntSchema.parse(Number(portRaw)), () => { controller.abort(new Error("fixture-parent-disconnected")); });
try {
  const machine = acquireSharedRuntimeAdmission(lock.workspace, lock);
  const selected = captureSelectedProfileStorage(machine), profile = machine.admitProfile(selected.profileId);
  const database = AuthorityDatabase.open(profile, { path: selected.authorityPath, busyTimeoutMs: 5000, migrationOwner: "fixture-pool-worker" }, systemClock,
    undefined, undefined, undefined, createCredentialStore({ admission: profile, stateRoot: profile.stateRoot }));
  try {
    const ucpath = () => {
      const driver = healthyUcpathDriver();
      return barrier === "-" ? driver : { ...driver, async searchPersonOrg(input: Parameters<typeof driver.searchPersonOrg>[0]) { await held(); return driver.searchPersonOrg(input); } };
    };
    const report = await composeWorkerRuntime({ lifetimeLock: lock, stopSignal: controller.signal, admission: machine, repoRoot: lock.workspace, isolation: rebuildRuntimeIsolation,
      env: {}, args, ids: { uuid: randomUUID }, preflightRunnerFactory: healthyRuntimePreflightRunners,
      sessionFactory: sessionFactoryHarness({ ucpath, crm: () => healthyCrmDriver() }).factory, duoCeremony: duoCeremonyGatesOver(database, systemClock) });
    if (report.closure === "unproved") process.exitCode = 1;
  } finally { database.close(); profile.release(); machine.release(); }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
}
process.exit(typeof process.exitCode === "number" ? process.exitCode : 0);
