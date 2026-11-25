import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { availableParallelism, loadavg } from "node:os";
import { join } from "node:path";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";
import { runtimeProfiles } from "../../src/models/config/define-runtime-isolation.js";
import { RUNTIME_PROFILE_ENV } from "../../src/models/config/secrets.js";
import { systemClock } from "../../src/rules/time/clock.js";

/** G1: main-thread stall per SSE snapshot and per GET, and the lane's whole-day build against the request thread's. */
const STALL_LIMIT_MS = 20;
const BUILD_RATIO_LIMIT = 1.3;
const SAMPLES = 5;
const SETTLE_MS = 300;

const CopyProfileSchema = z.enum(["staging", "development"]);
const SampleSchema = z.strictObject({ wallMs: z.number().nonnegative(), stallMs: z.number().nonnegative() });
const RunSchema = z.strictObject({
  day: z.iso.date(), dayRuns: z.int().nonnegative(), timelineHighWater: z.int().nonnegative(),
  /** Lane boot to ready, which includes the replica's cold fold; the first lane read reports whether it found the fold done. */
  laneReadyMs: z.number().nonnegative(), coldFoldMs: z.number().nonnegative(), foldBeforeReady: z.boolean(),
  /** The whole-day build, first read after the fold: on the lane (round trip) and on the request thread. */
  laneBuildMs: z.number().nonnegative(), requestThreadBuildMs: z.number().nonnegative(),
  stampMs: z.array(z.number().nonnegative()), sse: z.array(SampleSchema), get: z.array(SampleSchema), bodyBytes: z.int().positive(),
});
type Run = z.infer<typeof RunSchema>;

/** Runs `work` while sampling the event loop; the stall is the longest the loop was held. */
async function stalled<T>(work: () => Promise<T>): Promise<{ result: T; wallMs: number; stallMs: number }> {
  const histogram = monitorEventLoopDelay({ resolution: 1 });
  histogram.enable();
  const started = performance.now();
  const result = await work();
  const wallMs = performance.now() - started;
  // One more turn so a stall at the very end is sampled.
  await delay(2);
  histogram.disable();
  return { result, wallMs, stallMs: histogram.max / 1e6 };
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") reject(new Error("queue-day-bench-listen"));
      else resolve(address.port);
    });
  });
}

/** One cold process: open the copy's store as the dashboard does, start the real lane, and frame the busiest day. */
async function measure(workspace: string, lockPort: number, requestedDay: string | undefined): Promise<Run> {
  const { acquireRuntimeLifetimeLock } = await import("../../src/backend/storage/admission/lifetime-lock.js");
  const { acquireEntrypointAdmission } = await import("../../src/backend/storage/admission/bootstrap-admission.js");
  const { createCredentialStore } = await import("../../src/backend/storage/configuration/credential-store.js");
  const { AuthorityDatabase } = await import("../../src/backend/storage/sqlite/authority-database.js");
  const { createDashboardReadHost } = await import("../../src/backend/storage/sqlite/dashboard-read-host.js");
  const { createOperatorProjection } = await import("../../src/backend/app/composition/dashboard/queue.js");
  const { composeQueueSummaries } = await import("../../src/backend/app/composition/dashboard/queue-summaries.js");
  const { composeNotificationReads } = await import("../../src/backend/app/composition/dashboard/notification-wiring.js");
  const { RunRecordService } = await import("../../src/backend/runs/lifecycle/run-record-service.js");
  const { createTransactionHistory } = await import("../../src/backend/storage/sqlite/transaction-history.js");
  const { READABLE_WORKFLOW_MODULES, DESCRIPTORS, descriptorSetHash } = await import("../../src/backend/app/registries/workflow-registry.js");
  const { createDashboardStreamHub } = await import("../../src/backend/transports/http/subscriptions/dashboard-stream.js");
  const { sseSerialize } = await import("../../src/backend/transports/http/subscriptions/sse-response.js");
  const { systemIdFactory } = await import("../../src/rules/identity/identifiers.js");
  const lock = await acquireRuntimeLifetimeLock(lockPort);
  try {
    const machine = acquireEntrypointAdmission(workspace, "exclusive", lock);
    try {
      const { activeProfileId } = machine.readProfileRegistry();
      if (activeProfileId === null) throw new Error("queue-day-bench-sign-in-required: sign in to the copy and quit without signing out");
      const admission = machine.admitProfile(activeProfileId);
      try {
        const credentials = createCredentialStore({ admission, stateRoot: admission.stateRoot });
        const database = AuthorityDatabase.open(admission, { path: join(admission.stateRoot, "state.db"), busyTimeoutMs: 5000,
          migrationOwner: "queue-day-bench" }, systemClock, undefined, undefined, undefined, credentials);
        try {
          const history = database.dashboardHistory();
          if (history === database) throw new Error("queue-day-bench-history-required: import history with the profile copy command first");
          const descriptors = { resolve: (id: string) => READABLE_WORKFLOW_MODULES.find(module => module.descriptor.id === id)?.descriptor };
          const reader = new RunRecordService({ database: history, clock: systemClock, ids: systemIdFactory,
            publishQueued: () => { throw new Error("queue-day-bench-read-only"); }, resolveDescriptor: descriptors.resolve });
          const servedReader = { read: reader.read.bind(reader), list: reader.list.bind(reader), withRunTreeSnapshot: reader.withRunTreeSnapshot.bind(reader),
            summaries: { ...composeQueueSummaries(history), activity: () => { throw new Error("queue-day-bench-activity-unserved"); } } };
          const appVersion = z.object({ version: z.string() }).parse(JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"))).version;
          const options = { database: history, stateRoot: admission.stateRoot, clock: systemClock, appVersion,
            descriptorSetHash: descriptorSetHash(DESCRIPTORS.map(descriptor => descriptor.contractFingerprint)), ledger: createTransactionHistory(history.authority),
            descriptors, reader: servedReader, listNotifications: composeNotificationReads(database, history).list, workerMembers: () => [] };

          // The request thread's cold fold, then its whole-day build of the busiest day: today's GET path.
          const folding = performance.now();
          const local = createOperatorProjection(options);
          local.ingestFromTimeline();
          const coldFoldMs = performance.now() - folding;
          const day = requestedDay ?? busiestDay(local);
          const building = performance.now();
          const today = local.buildDashboardDayWire(day);
          const requestThreadBuildMs = performance.now() - building;
          const timelineHighWater = history.authority.timelineEvents.highWaterMark();

          await delay(SETTLE_MS);
          const booting = performance.now();
          const lanes = createDashboardReadHost({ admission, database, clock: systemClock, lanes: ["navigation"],
            entry: new URL("../../src/backend/app/composition/dashboard/read-lane-entry.js", import.meta.url) });
          try {
            await lanes.ready;
            const laneReadyMs = performance.now() - booting;
            const main = createOperatorProjection({ ...options, readLanes: lanes });
            main.ingestFromTimeline();
            // The first lane read of the day: a replica that had not folded before ready would fold here, inside this read.
            const reading = performance.now();
            const first = await main.requestDashboardDay(day);
            const laneBuildMs = performance.now() - reading;
            const foldBeforeReady = first.facts.position === main.position() && laneBuildMs < coldFoldMs;

            const stampMs: number[] = [];
            for (let index = 0; index < SAMPLES; index++) {
              const stamping = performance.now();
              main.stampDay(day, first, first.dispatchCursor);
              stampMs.push(performance.now() - stamping);
            }

            const server = createServer((request, response) => {
              const url = new URL(request.url ?? "/", "http://127.0.0.1");
              if (url.pathname === "/api/v1/dashboard") {
                void main.servedDashboardDay(day).then(body => {
                  response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "private, no-cache" });
                  response.end(body);
                }, (error: unknown) => { response.writeHead(500); response.end(String(error)); });
                return;
              }
              const hub = createDashboardStreamHub({ projection: main, backfillGaps: { detected: () => Promise.reject(new Error("queue-day-bench-gap")) } });
              void hub.connect({ day }).then(connection => {
                response.writeHead(200, { "Content-Type": "text/event-stream" });
                for (const envelope of connection.initial) response.write(sseSerialize(envelope));
                response.end();
                connection.close();
                hub.close();
              }, (error: unknown) => { response.writeHead(500); response.end(String(error)); hub.close(); });
            });
            const port = await listen(server);
            try {
              const get: Run["get"] = [], sse: Run["sse"] = [];
              let bodyBytes = 0;
              for (let index = 0; index < SAMPLES; index++) {
                const served = await stalled(async () => (await fetch(`http://127.0.0.1:${String(port)}/api/v1/dashboard`)).arrayBuffer());
                bodyBytes = served.result.byteLength;
                get.push({ wallMs: served.wallMs, stallMs: served.stallMs });
                const streamed = await stalled(async () => (await fetch(`http://127.0.0.1:${String(port)}/stream`)).arrayBuffer());
                sse.push({ wallMs: streamed.wallMs, stallMs: streamed.stallMs });
              }
              return RunSchema.parse({ day, dayRuns: today.queueSurfaces.length, timelineHighWater, laneReadyMs, coldFoldMs, foldBeforeReady,
                laneBuildMs, requestThreadBuildMs, stampMs, sse, get, bodyBytes });
            } finally { await new Promise(resolve => server.close(resolve)); }
          } finally { await lanes.close(); }
        } finally { database.close(); }
      } finally { admission.release(); }
    } finally { machine.release(); }
  } finally { await lock.close(); }
}

/** The day with the most runs over the last twelve months, read from each month's day counts. */
function busiestDay(projection: { buildDashboardDayWire(day: string): { monthCounts: readonly { day: string; count: number }[] } }): string {
  let best: { day: string; count: number } | undefined;
  const now = new Date(systemClock.nowMs());
  for (let back = 0; back < 12; back++) {
    const month = new Date(now.getFullYear(), now.getMonth() - back, 1);
    const day = `${String(month.getFullYear())}-${String(month.getMonth() + 1).padStart(2, "0")}-01`;
    for (const count of projection.buildDashboardDayWire(day).monthCounts) if (best === undefined || count.count > best.count) best = count;
  }
  if (best === undefined) throw new Error("queue-day-bench-no-runs");
  return best.day;
}

export function summarize(runs: readonly Run[]) {
  const all = (select: (run: Run) => readonly number[]) => runs.flatMap(select);
  const range = (values: readonly number[]) => [Math.min(...values), Math.max(...values)];
  const sseStall = all(run => run.sse.map(sample => sample.stallMs)), getStall = all(run => run.get.map(sample => sample.stallMs));
  const ratios = runs.map(run => run.laneBuildMs / run.requestThreadBuildMs);
  const limiters = [
    ...(Math.max(...sseStall) > STALL_LIMIT_MS ? ["sse-stall"] : []),
    ...(Math.max(...getStall) > STALL_LIMIT_MS ? ["get-stall"] : []),
    ...(Math.max(...ratios) > BUILD_RATIO_LIMIT ? ["lane-build-ratio"] : []),
    ...(runs.some(run => !run.foldBeforeReady) ? ["fold-after-ready"] : []),
  ];
  return { verdict: limiters.length === 0 ? "pass" : "fail", limiters, runCount: runs.length,
    ranges: { sseStallMs: range(sseStall), getStallMs: range(getStall), laneBuildRatio: range(ratios), laneBuildMs: range(runs.map(run => run.laneBuildMs)),
      requestThreadBuildMs: range(runs.map(run => run.requestThreadBuildMs)), laneReadyMs: range(runs.map(run => run.laneReadyMs)),
      coldFoldMs: range(runs.map(run => run.coldFoldMs)), stampMs: range(all(run => run.stampMs)),
      sseWallMs: range(all(run => run.sse.map(sample => sample.wallMs))), getWallMs: range(all(run => run.get.map(sample => sample.wallMs))) },
    limits: { stallMs: STALL_LIMIT_MS, laneBuildRatio: BUILD_RATIO_LIMIT } };
}

const entryPath = process.argv[1];
if (entryPath !== undefined && pathToFileURL(entryPath).href === import.meta.url) {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: { runs: { type: "string", default: "3" }, day: { type: "string" },
    child: { type: "boolean", default: false } } });
  const [profile] = z.tuple([CopyProfileSchema]).parse(positionals);
  const day = values.day === undefined ? undefined : z.iso.date().parse(values.day);
  // Runtime isolation and key custody bind the profile at module initialization.
  process.env[RUNTIME_PROFILE_ENV] = profile;
  const { applicationDataWorkspace } = await import("../../src/backend/app/config/runtime-isolation.js");
  const workspace = applicationDataWorkspace(undefined, profile), lockPort = runtimeProfiles[profile].lockPort;
  if (values.child) {
    process.stdout.write(`${JSON.stringify(await measure(workspace, lockPort, day))}\n`);
  } else {
    const count = z.coerce.number().int().min(1).max(10).parse(values.runs);
    const script = fileURLToPath(import.meta.url);
    const runs: Run[] = [];
    // Every run is a cold process, so each lane boot and fold starts from nothing.
    for (let index = 0; index < count; index++) {
      const output = execFileSync(process.execPath, ["--import", "tsx", script, profile, "--child", ...(day === undefined ? [] : ["--day", day])], { encoding: "utf8" });
      runs.push(RunSchema.parse(JSON.parse(output.trim().split("\n").at(-1) ?? "")));
    }
    const report = { gate: "G1", runtime: "tsx (the dashboard:prod backend loader)", node: process.version, profile,
      commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), host: { cpus: availableParallelism(), loadavg: loadavg() },
      summary: summarize(runs), runs };
    const path = join(process.cwd(), `queue-day-g1-${new Date(systemClock.nowMs()).toISOString().replaceAll(":", "-")}.json`);
    writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    process.stdout.write(`${JSON.stringify(report.summary, null, 2)}\nwrote ${path}\n`);
  }
}
