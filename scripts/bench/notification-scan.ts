import { loadavg, availableParallelism } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { isMainThread } from "node:worker_threads";
import { z } from "zod";
import type { RuntimeAdmission } from "../../src/backend/storage/admission/admission.js";
import type { AuthorityDatabase } from "../../src/backend/storage/sqlite/authority-database.js";
import { runtimeProfiles } from "../../src/models/config/define-runtime-isolation.js";
import { RUNTIME_PROFILE_ENV } from "../../src/models/config/secrets.js";
import { RunIdSchema } from "../../src/rules/identity/ids.js";
import { systemClock } from "../../src/rules/time/clock.js";

const SCAN_LIMIT_MS = 100;
const CopyProfileSchema = z.enum(["staging", "development"]);
const entry = process.argv[1];
const cli = isMainThread && entry !== undefined && pathToFileURL(entry).href === import.meta.url
  ? parseArgs({ allowPositionals: true, options: { runs: { type: "string", default: "5" } } }) : undefined;
const profile = cli === undefined ? undefined : z.tuple([CopyProfileSchema]).parse(cli.positionals)[0];
if (profile !== undefined) process.env[RUNTIME_PROFILE_ENV] = profile;

const [{ notificationSourceScan }, { listCanonicalRuns }, { createTrustRunReader }, { createDashboardReadHost, defineLaneRead, runReadLaneWorker }] = await Promise.all([
  import("../../src/backend/app/composition/dashboard/notification-sources.js"),
  import("../../src/backend/runs/queries/canonical-runs.js"),
  import("../../src/backend/runs/trust/canonical-reader.js"),
  import("../../src/backend/storage/sqlite/dashboard-read-host.js"),
]);

export const notificationScanClick = defineLaneRead(import.meta.url, "notification-scan-click", {
  lane: "navigation", priority: "interactive", args: z.strictObject({ runId: RunIdSchema }),
  run({ native }, { runId }) {
    return createTrustRunReader(native).read(runId).state;
  },
});

export const NOTIFICATION_SCAN_BENCH_ENTRY = new URL(import.meta.url);
runReadLaneWorker();

/** The uncached host round trip is a conservative upper bound on the transaction, including its commit. */
export async function measureNotificationScan(admission: RuntimeAdmission, database: AuthorityDatabase, runs: number) {
  const reader = createTrustRunReader(database);
  const [target] = database.authority.runs.listPage({ offset: 0, limit: 1 });
  if (target === undefined) throw new Error("notification-scan-bench-native-runs-required");
  const samples = [];
  for (let sample = 0; sample < runs; sample++) {
    const lanes = createDashboardReadHost({ admission, database, clock: systemClock, lanes: ["navigation"], entry: NOTIFICATION_SCAN_BENCH_ENTRY });
    try {
      await lanes.ready;
      const order: string[] = [];
      const started = systemClock.monotonicMs();
      const scan = lanes.read(notificationSourceScan, {}).then(reply => {
        order.push("scan");
        if (reply.cached) throw new Error("notification-scan-bench-cached-first-scan");
        return systemClock.monotonicMs() - started;
      });
      const clickStarted = systemClock.monotonicMs();
      const click = lanes.read(notificationScanClick, { runId: target.envelope.runId }).then(reply => {
        order.push("click");
        if (JSON.parse(reply.body) !== "present") throw new Error("notification-scan-bench-click-run-missing");
        return systemClock.monotonicMs() - clickStarted;
      });
      const rerun = lanes.read(notificationSourceScan, {}).then(reply => {
        order.push("rerun");
        if (!reply.cached) throw new Error("notification-scan-bench-store-moved");
      });
      const [scanMs, clickMs] = await Promise.all([scan, click, rerun]);
      if (lanes.status().checkpoints.length !== 0) throw new Error("notification-scan-bench-checkpoint-overlap");
      samples.push({ scanMs, clickMs, order });
    } finally { await lanes.close(); }
  }
  const counts = database.withAuthorityReadSnapshot(() => {
    const retained = listCanonicalRuns(reader, "live");
    let failures = 0, receipts = 0;
    for (const { envelope: { runId } } of retained) {
      failures += database.authority.failures.listByRun(runId).length;
      if (database.authority.evidenceReceipts.findByRun(runId) !== undefined) receipts++;
    }
    return { runs: retained.length, failures, receipts, publications: database.authority.notificationPublications.list().length };
  });
  const passed = samples.every(sample => sample.scanMs <= SCAN_LIMIT_MS && sample.order.join(",") === "scan,click,rerun");
  return { gate: "G2-4", passed, scanLimitMs: SCAN_LIMIT_MS, counts, samples };
}

if (cli !== undefined && profile !== undefined) {
  const runs = z.coerce.number().int().min(1).max(10).parse(cli.values.runs);
  const [{ applicationDataWorkspace }, { acquireRuntimeLifetimeLock }, { acquireEntrypointAdmission }, { createCredentialStore }, { AuthorityDatabase }] = await Promise.all([
    import("../../src/backend/app/config/runtime-isolation.js"),
    import("../../src/backend/storage/admission/lifetime-lock.js"),
    import("../../src/backend/storage/admission/bootstrap-admission.js"),
    import("../../src/backend/storage/configuration/credential-store.js"),
    import("../../src/backend/storage/sqlite/authority-database.js"),
  ]);
  const lock = await acquireRuntimeLifetimeLock(runtimeProfiles[profile].lockPort);
  try {
    const machine = acquireEntrypointAdmission(applicationDataWorkspace(undefined, profile), "exclusive", lock);
    try {
      const { activeProfileId } = machine.readProfileRegistry();
      if (activeProfileId === null) throw new Error("notification-scan-bench-sign-in-required");
      const admission = machine.admitProfile(activeProfileId);
      try {
        const credentials = createCredentialStore({ admission, stateRoot: admission.stateRoot });
        const database = AuthorityDatabase.open(admission, { path: join(admission.stateRoot, "state.db"), busyTimeoutMs: 5000,
          migrationOwner: "notification-scan-bench" }, systemClock, undefined, undefined, undefined, credentials);
        try {
          if (database.dashboardHistory() === database) throw new Error("notification-scan-bench-profile-copy-required");
          const host = { cpus: availableParallelism(), loadavg: loadavg() };
          const report = await measureNotificationScan(admission, database, runs);
          process.stdout.write(`${JSON.stringify({ profile, node: process.version, host, ...report }, null, 2)}\n`);
          if (!report.passed) process.exitCode = 1;
        } finally { database.close(); }
      } finally { admission.release(); }
    } finally { machine.release(); }
  } finally { await lock.close(); }
}
