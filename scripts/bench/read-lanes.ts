import { execFileSync } from "node:child_process";
import { constants, cpSync, lstatSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism, loadavg, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual, parseArgs } from "node:util";
import { z } from "zod";
import { runtimeProfiles } from "../../src/models/config/define-runtime-isolation.js";
import { RUNTIME_PROFILE_ENV } from "../../src/models/config/secrets.js";
import { systemClock } from "../../src/rules/time/clock.js";

/** G2: each shape passes on its own when every run is ready within this time and adds at most this RSS. */
const READY_LIMIT_MS = 5_000;
const ADDED_RSS_LIMIT_BYTES = 350 * 1024 * 1024;
const SETTLE_MS = 500;
const CLONE_PREFIX = "relay-read-lanes-";

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
            const reader = createDashboardBackgroundReader(lanes);
            const page = await reader.read({ after: 0, limit: 100, nowMs: systemClock.nowMs() });
            const firstReadMs = performance.now() - reading;
            if (page.through !== timelineHighWater) throw new Error("read-lanes-bench-history-mismatch");
            await delay(SETTLE_MS);
            const rssAfterReadBytes = process.memoryUsage.rss();
            const boundary = { after: Math.max(0, cursorOffset - 3), through: timelineHighWater, limit: 100 };
            const mixed = await reader.read({ ...boundary, nowMs: systemClock.nowMs() });
            if (!isDeepStrictEqual(page.records, history.authority.timelineEvents.page({ ...boundary, after: 0 }))
              || !isDeepStrictEqual(mixed.records, history.authority.timelineEvents.page(boundary))) {
              throw new Error("read-lanes-bench-timeline-records-mismatch");
            }
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

/** The development or staging runtime must be stopped throughout the state copy. */
async function cloneProfile(workspace: string, target: string, lockPort: number) {
  const { acquireRuntimeLifetimeLock } = await import("../../src/backend/storage/admission/lifetime-lock.js");
  const { rebindControlWorkspace } = await import("../verify/prelogin-rehearsal.js");
  const lock = await acquireRuntimeLifetimeLock(lockPort);
  try {
    cpSync(join(workspace, ".tracker"), join(target, ".tracker"), {
      recursive: true, mode: constants.COPYFILE_FICLONE,
      filter(source) {
        if (lstatSync(source).isSymbolicLink()) throw new Error("read-lanes-bench-clone-symlink");
        return true;
      },
    });
    rebindControlWorkspace(target, target);
  } finally { await lock.close(); }
}

const entryPath = process.argv[1];
if (entryPath !== undefined && pathToFileURL(entryPath).href === import.meta.url) {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: {
    runs: { type: "string", default: "3" }, shape: { type: "string" }, "fresh-copy": { type: "boolean" }, "cloned-workspace": { type: "string" },
  } });
  const [profile] = z.tuple([CopyProfileSchema]).parse(positionals);
  // Runtime isolation and key custody bind the profile at module initialization.
  process.env[RUNTIME_PROFILE_ENV] = profile;
  const { applicationDataWorkspace } = await import("../../src/backend/app/config/runtime-isolation.js");
  const workspace = applicationDataWorkspace(undefined, profile), lockPort = runtimeProfiles[profile].lockPort;
  const cloneRoot = realpathSync(tmpdir());
  const clonedWorkspace = values["cloned-workspace"];
  if (clonedWorkspace !== undefined && (values.shape === undefined || dirname(clonedWorkspace) !== cloneRoot
    || !basename(clonedWorkspace).startsWith(CLONE_PREFIX) || realpathSync(clonedWorkspace) !== clonedWorkspace)) {
    throw new Error("read-lanes-bench-clone-refused");
  }
  if (values.shape !== undefined) {
    if (values["fresh-copy"]) throw new Error("read-lanes-bench-fresh-copy-requires-both-shapes");
    process.stdout.write(`${JSON.stringify(await measure(ShapeSchema.parse(values.shape), clonedWorkspace ?? workspace, lockPort))}\n`);
  } else {
    const runs = z.coerce.number().int().min(1).max(10).parse(values.runs);
    const script = fileURLToPath(import.meta.url);
    const results: Record<Shape, Run[]> = { A: [], B: [] };
    const clone = values["fresh-copy"] ? mkdtempSync(join(cloneRoot, CLONE_PREFIX)) : undefined;
    try {
      if (clone !== undefined) await cloneProfile(workspace, clone, lockPort);
      const cloneArgs = clone === undefined ? [] : ["--cloned-workspace", clone];
      // Alternate shapes so host drift touches both; every run is a cold process.
      for (let index = 0; index < runs; index++) {
        for (const shape of ShapeSchema.options) {
          const output = execFileSync(process.execPath, ["--import", "tsx", script, profile, "--shape", shape, ...cloneArgs], { encoding: "utf8" });
          results[shape].push(RunSchema.parse(JSON.parse(output.trim().split("\n").at(-1) ?? "")));
        }
      }
    } finally { if (clone !== undefined) rmSync(clone, { recursive: true, force: true }); }
    const report = { gate: "G2", runtime: "tsx (the dashboard:prod backend loader; no packaged build exists)", node: process.version,
      profile, freshCopy: clone !== undefined, commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      host: { cpus: availableParallelism(), loadavg: loadavg() },
      shapes: ShapeSchema.options.map(shape => summarizeShape(shape, results[shape])), runs: results };
    const path = join(process.cwd(), `read-lanes-g2-${new Date(systemClock.nowMs()).toISOString().replaceAll(":", "-")}.json`);
    writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    process.stdout.write(`${JSON.stringify(report.shapes, null, 2)}\nwrote ${path}\n`);
  }
}
