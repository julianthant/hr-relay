import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { availableParallelism, loadavg } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";
import { runtimeProfiles } from "../../src/models/config/define-runtime-isolation.js";
import { RUNTIME_PROFILE_ENV } from "../../src/models/config/secrets.js";
import { systemClock } from "../../src/rules/time/clock.js";

/** G2: each shape passes on its own when every run is ready within this time and adds at most this RSS. */
const READY_LIMIT_MS = 5_000;
const ADDED_RSS_LIMIT_BYTES = 350 * 1024 * 1024;
const SETTLE_MS = 500;

const ShapeSchema = z.enum(["A", "B"]);
type Shape = z.infer<typeof ShapeSchema>;
const CopyProfileSchema = z.enum(["staging", "development"]);
const LANES = Object.freeze({ A: ["navigation"], B: ["navigation", "search"] } as const);

const RunSchema = z.strictObject({ shape: ShapeSchema, readyMs: z.number().nonnegative(), firstReadMs: z.number().nonnegative(),
  rssBeforeBytes: z.int().positive(), rssReadyBytes: z.int().positive(), rssAfterReadBytes: z.int().positive(), addedRssBytes: z.int(),
  historyArchive: z.boolean(), cursorOffset: z.int().nonnegative(), timelineHighWater: z.int().nonnegative() });
type Run = z.infer<typeof RunSchema>;

/** One shape in one fresh process: open the copy's store as the dashboard does, then start the real read host. */
async function measure(shape: Shape, workspace: string, lockPort: number): Promise<Run> {
  const [{ acquireRuntimeLifetimeLock }, { acquireEntrypointAdmission }, { createCredentialStore }, { AuthorityDatabase },
    { createDashboardReadHost }, { createDashboardBackgroundReader }] = await Promise.all([
    import("../../src/backend/storage/admission/lifetime-lock.js"),
    import("../../src/backend/storage/admission/bootstrap-admission.js"),
    import("../../src/backend/storage/configuration/credential-store.js"),
    import("../../src/backend/storage/sqlite/authority-database.js"),
    import("../../src/backend/storage/sqlite/dashboard-read-host.js"),
    import("../../src/backend/storage/sqlite/dashboard-background-read-worker.js"),
  ]);
  const lock = await acquireRuntimeLifetimeLock(lockPort);
  try {
    const machine = acquireEntrypointAdmission(workspace, "exclusive", lock);
    try {
      const { activeProfileId } = machine.readProfileRegistry();
      if (activeProfileId === null) throw new Error("read-lanes-bench-sign-in-required: sign in to the copy and quit without signing out");
      const admission = machine.admitProfile(activeProfileId);
      try {
        const credentials = createCredentialStore({ admission, stateRoot: admission.stateRoot });
        const database = AuthorityDatabase.open(admission, { path: join(admission.stateRoot, "state.db"), busyTimeoutMs: 5000,
          migrationOwner: "read-lanes-bench" }, systemClock, undefined, undefined, undefined, credentials);
        try {
          const history = database.dashboardHistory();
          if (history === database) throw new Error("read-lanes-bench-history-required: import history with the profile copy command first");
          const cursorOffset = history.timelineCursorOffset(), timelineHighWater = history.authority.timelineEvents.highWaterMark();
          await delay(SETTLE_MS);
          const rssBeforeBytes = process.memoryUsage.rss();
          const started = performance.now();
          const lanes = createDashboardReadHost({ admission, database, clock: systemClock, lanes: LANES[shape],
            entry: new URL("../../src/backend/app/composition/dashboard/read-lane-entry.js", import.meta.url) });
          try {
            await lanes.ready;
            const readyMs = performance.now() - started;
            const rssReadyBytes = process.memoryUsage.rss();
            const reading = performance.now();
            const page = await createDashboardBackgroundReader(lanes).read({ after: 0, limit: 100, nowMs: systemClock.nowMs() });
            const firstReadMs = performance.now() - reading;
            if (page.through !== timelineHighWater) throw new Error("read-lanes-bench-history-mismatch");
            await delay(SETTLE_MS);
            const rssAfterReadBytes = process.memoryUsage.rss();
            return RunSchema.parse({ shape, readyMs, firstReadMs, rssBeforeBytes, rssReadyBytes, rssAfterReadBytes,
              addedRssBytes: Math.max(rssReadyBytes, rssAfterReadBytes) - rssBeforeBytes, historyArchive: true, cursorOffset, timelineHighWater });
          } finally { await lanes.close(); }
        } finally { database.close(); }
      } finally { admission.release(); }
    } finally { machine.release(); }
  } finally { await lock.close(); }
}

export function summarizeShape(shape: Shape, runs: readonly Run[]) {
  const range = (select: (run: Run) => number) => [Math.min(...runs.map(select)), Math.max(...runs.map(select))];
  const limiters = [
    ...(runs.some(run => run.readyMs > READY_LIMIT_MS) ? ["ready-time"] : []),
    ...(runs.some(run => run.addedRssBytes > ADDED_RSS_LIMIT_BYTES) ? ["added-rss"] : []),
  ];
  return { shape, lanes: LANES[shape], runCount: runs.length, verdict: limiters.length === 0 ? "pass" : "fail", limiters,
    ranges: { readyMs: range(run => run.readyMs), addedRssMiB: range(run => run.addedRssBytes / 1024 / 1024), firstReadMs: range(run => run.firstReadMs) },
    limits: { readyMs: READY_LIMIT_MS, addedRssMiB: ADDED_RSS_LIMIT_BYTES / 1024 / 1024 } };
}

const entryPath = process.argv[1];
if (entryPath !== undefined && pathToFileURL(entryPath).href === import.meta.url) {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: { runs: { type: "string", default: "3" }, shape: { type: "string" } } });
  const [profile] = z.tuple([CopyProfileSchema]).parse(positionals);
  // Runtime isolation and key custody bind the profile at module initialization.
  process.env[RUNTIME_PROFILE_ENV] = profile;
  const { applicationDataWorkspace } = await import("../../src/backend/app/config/runtime-isolation.js");
  const workspace = applicationDataWorkspace(undefined, profile), lockPort = runtimeProfiles[profile].lockPort;
  if (values.shape !== undefined) {
    process.stdout.write(`${JSON.stringify(await measure(ShapeSchema.parse(values.shape), workspace, lockPort))}\n`);
  } else {
    const runs = z.coerce.number().int().min(1).max(10).parse(values.runs);
    const script = fileURLToPath(import.meta.url);
    const results: Record<Shape, Run[]> = { A: [], B: [] };
    // Alternate shapes so host drift touches both; every run is a cold process.
    for (let index = 0; index < runs; index++) {
      for (const shape of ShapeSchema.options) {
        const output = execFileSync(process.execPath, ["--import", "tsx", script, profile, "--shape", shape], { encoding: "utf8" });
        results[shape].push(RunSchema.parse(JSON.parse(output.trim().split("\n").at(-1) ?? "")));
      }
    }
    const report = { gate: "G2", runtime: "tsx (the dashboard:prod backend loader; no packaged build exists)", node: process.version,
      profile, commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), host: { cpus: availableParallelism(), loadavg: loadavg() },
      shapes: ShapeSchema.options.map(shape => summarizeShape(shape, results[shape])), runs: results };
    const path = join(process.cwd(), `read-lanes-g2-${new Date(systemClock.nowMs()).toISOString().replaceAll(":", "-")}.json`);
    writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    process.stdout.write(`${JSON.stringify(report.shapes, null, 2)}\nwrote ${path}\n`);
  }
}
