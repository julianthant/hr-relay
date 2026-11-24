import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, lstatSync, mkdtempSync, realpathSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { connect, createServer } from "node:net";
import { availableParallelism, loadavg, userInfo } from "node:os";
import { basename, dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import type { Page, Response } from "playwright";
import { z } from "zod";
import { ConfigSchema, type EditableSettingsOverride } from "../../src/models/config/schema.js";
import { readRuntimeProfile, workerBootstrapEnvironment } from "../../src/models/config/secrets.js";
import { systemClock } from "../../src/rules/time/clock.js";
import type { HeadlessCopySession } from "../profiles/headless-copy-signin.js";

const windowMs = 10 * 60 * 1000;
const sampleMs = 20;
const stallMs = 100;
const busyLimit = 2;
const rssFlatBytes = 16 * 1024 * 1024;

const StallsSchema = z.strictObject({ count: z.int().nonnegative(), longestMs: z.number().nonnegative(), totalMs: z.number().nonnegative() });
const ProbeSchema = z.strictObject({ pid: z.int().positive(), start: z.iso.datetime(), end: z.iso.datetime(),
  elapsedMs: z.number().positive(), stalls: StallsSchema, busyPercent: z.number().nonnegative(),
  threadCpuMicros: z.int().nonnegative(), probeCpuMicros: z.int().nonnegative(),
  rssStartBytes: z.int().positive(), rssEndBytes: z.int().positive() });
type Probe = z.infer<typeof ProbeSchema>;
type IdleMetrics = Pick<Probe, "stalls" | "busyPercent" | "rssStartBytes" | "rssEndBytes"> & { readonly errors: number };

export function summarizeIdleRuns(runs: readonly [IdleMetrics, IdleMetrics]) {
  const range = (select: (run: IdleMetrics) => number) => {
    const values = runs.map(select);
    return [Math.min(...values), Math.max(...values)];
  };
  const ranges = { stallCount: range(run => run.stalls.count), longestStallMs: range(run => run.stalls.longestMs),
    totalStallMs: range(run => run.stalls.totalMs), busyPercent: range(run => run.busyPercent),
    rssDeltaBytes: range(run => run.rssEndBytes - run.rssStartBytes) };
  const limiters = [
    ...(runs.some(run => run.stalls.count > 0) ? ["event-loop-stalls"] : []),
    ...(runs.some(run => run.busyPercent >= busyLimit) ? ["backend-thread-cpu"] : []),
  ];
  const errors = runs.reduce((total, run) => total + run.errors, 0);
  const passes = (run: IdleMetrics) => run.stalls.count === 0 && run.busyPercent < busyLimit;
  const flat = (run: IdleMetrics) => Math.abs(run.rssEndBytes - run.rssStartBytes) <= rssFlatBytes;
  return { verdict: errors > 0 ? "inconclusive" : limiters.length > 0 ? "targets-missed" : "targets-met",
    runCount: runs.length, limiters, ranges, rssStayedFlat: runs.every(flat),
    repeatability: errors > 0 ? "inconclusive" : passes(runs[0]) === passes(runs[1]) && flat(runs[0]) === flat(runs[1]) ? "consistent" : "mixed", errors };
}

export function compareIdleRuns(base: ReturnType<typeof summarizeIdleRuns>, target: ReturnType<typeof summarizeIdleRuns>) {
  if (base.errors > 0 || target.errors > 0) return "inconclusive";
  const metrics = ["stallCount", "longestStallMs", "totalStallMs", "busyPercent"] as const;
  const separated = metrics.some(metric => base.ranges[metric][1] < target.ranges[metric][0] || target.ranges[metric][1] < base.ranges[metric][0]);
  return separated ? "inconclusive-until-limiter-profiled" : "no-measurable-difference";
}

export function assertHeadlessCopySettings(settings: EditableSettingsOverride | undefined): void {
  if (settings === undefined || !(settings.browser?.headless ?? ConfigSchema.shape.browser.parse(undefined).headless)) {
    throw new Error("idle-benchmark-copy-headless-required");
  }
}

export function serveBackendProbe(path: string) {
  let start: { iso: string; monotonicMs: number; cpu: ReturnType<typeof process.threadCpuUsage>; rss: number } | undefined;
  let timer: NodeJS.Timeout | undefined, last = 0;
  let probeCpuMicros = 0;
  const stalls = { count: 0, longestMs: 0, totalMs: 0 };
  const sample = (now: number) => {
    const late = now - last - sampleMs;
    last = now;
    if (late <= stallMs) return;
    stalls.count++;
    stalls.longestMs = Math.max(stalls.longestMs, late);
    stalls.totalMs += late;
  };
  const server = createServer({ allowHalfOpen: true }, connection => {
    let command = "";
    connection.setEncoding("utf8");
    connection.on("data", (chunk: string) => {
      command += chunk;
      if (command.length > 6) connection.destroy();
    });
    connection.on("error", () => { connection.destroy(); });
    connection.on("end", () => {
      if (command === "start" && start === undefined) {
        start = { iso: systemClock.now().toISOString(), monotonicMs: systemClock.monotonicMs(), cpu: process.threadCpuUsage(), rss: process.memoryUsage.rss() };
        last = start.monotonicMs;
        timer = setInterval(() => {
          const beforeSample = process.threadCpuUsage();
          sample(systemClock.monotonicMs());
          const sampleCpu = process.threadCpuUsage(beforeSample);
          probeCpuMicros += sampleCpu.user + sampleCpu.system;
        }, sampleMs);
        timer.unref();
        connection.end("started");
      } else if (command === "finish" && start !== undefined && timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
        const now = systemClock.monotonicMs(), elapsedMs = now - start.monotonicMs;
        sample(now);
        const cpu = process.threadCpuUsage(start.cpu);
        const threadCpuMicros = cpu.user + cpu.system;
        connection.end(JSON.stringify({ pid: process.pid, start: start.iso, end: systemClock.now().toISOString(), elapsedMs, stalls,
          threadCpuMicros, probeCpuMicros, busyPercent: (threadCpuMicros - probeCpuMicros) / (elapsedMs * 10),
          rssStartBytes: start.rss, rssEndBytes: process.memoryUsage.rss() }));
      } else connection.end("refused");
    });
  });
  return server.listen(path).unref();
}

export function probe(path: string, command: "start" | "finish", signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect({ path }, () => { socket.end(command); });
    const abort = () => { socket.destroy(new Error("idle-benchmark-interrupted")); };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    let body = "";
    socket.setEncoding("utf8");
    socket.setTimeout(30_000, () => { socket.destroy(new Error("idle-benchmark-probe-timeout")); });
    socket.on("data", (chunk: string) => {
      body += chunk;
      if (body.length > 4096) socket.destroy(new Error("idle-benchmark-probe-invalid"));
    });
    socket.on("error", reject);
    socket.on("close", failed => {
      signal.removeEventListener("abort", abort);
      if (!failed) resolve(body);
    });
  });
}

const archiveRoot = (stateRoot: string) => join(stateRoot, "files", "imported-history.sqlite");

async function measureTabs(session: HeadlessCopySession, socket: string) {
  const { context, origin, signal, stateRoot } = session;
  const { openReadOnlyDatabase } = await import("../../src/backend/storage/sqlite/readonly-authority-snapshot.js");
  let errors = 0;
  const fail = () => { errors++; };
  const api = (url: string) => {
    const path = new URL(url).pathname;
    return path.startsWith("/api/") || path === "/events/v1";
  };
  context.on("requestfailed", request => { if (api(request.url()) || new URL(request.url()).origin !== origin) fail(); });
  context.on("response", response => { if (api(response.url()) && response.status() >= 400) fail(); });
  const pages = [session.page, await context.newPage(), await context.newPage()];
  for (const page of pages) await openDashboard(page);
  if (context.pages().length !== 3) throw new Error("idle-benchmark-tab-count-invalid");
  const startLoad = loadavg()[0];
  if (await probe(socket, "start", signal) !== "started") throw new Error("idle-benchmark-probe-refused");
  await delay(windowMs, undefined, { signal });
  const measured = ProbeSchema.parse(JSON.parse(await probe(socket, "finish", signal)));
  if (measured.elapsedMs < windowMs) throw new Error("idle-benchmark-window-incomplete");
  if (context.pages().length !== 3 || pages.some(page => page.isClosed() || page.url() !== `${origin}/`)) fail();
  const endLoad = loadavg()[0];
  const { pid, ...metrics } = measured;
  const database = openReadOnlyDatabase(join(stateRoot, "state.db"), 250);
  try {
    // The served store coalesces >200 ms diagnostics. Keep these alongside the complete >100 ms probe.
    const table = database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='debug_events'").get() === undefined
      ? "timeline_events" : "debug_events";
    const storeStalls = StallsSchema.parse(database.prepare(`SELECT count(*) AS count, coalesce(max(duration),0) AS longestMs,
      coalesce(sum(duration),0) AS totalMs FROM (SELECT json_extract(payload_json,'$.payload.event.durationMs') AS duration FROM ${table}
      WHERE recorded_at BETWEEN ? AND ? AND json_extract(payload_json,'$.payload.event.pid')=?
      AND json_extract(payload_json,'$.payload.event.reason')='event-loop-stall') WHERE duration>?`)
      .get(metrics.start, metrics.end, pid, stallMs));
    return { ...metrics, storeStalls, errors, tabs: pages.length, startLoad, endLoad };
  } finally { database.close(); }

  async function openDashboard(page: Page): Promise<void> {
    page.on("pageerror", fail);
    page.on("crash", fail);
    const successful = (path: string) => (response: Response) => new URL(response.url()).pathname === path && response.ok();
    await Promise.all([
      page.waitForResponse(successful("/api/v1/bootstrap"), { timeout: 60_000 }),
      page.waitForResponse(successful("/events/v1"), { timeout: 60_000 }),
      page.goto(origin, { waitUntil: "domcontentloaded" }),
    ]);
    await page.getByRole("complementary", { name: "Workspace" }).waitFor({ timeout: 60_000 });
  }
}

async function runBenchmark() {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: { base: { type: "string" } } });
  const shaSchema = z.string().regex(/^[0-9a-f]{40}$/u);
  const [target] = z.tuple([shaSchema]).parse(positionals);
  const base = shaSchema.optional().parse(values.base);
  if (process.platform !== "darwin") throw new Error("idle-benchmark-host-refused");
  if (target === base) throw new Error("idle-benchmark-base-matches-target");
  const { checkoutGit, developmentCopyCheckout, withHeadlessCopySignin } = await import("../profiles/headless-copy-signin.js");
  const { acquireRuntimeLifetimeLock } = await import("../../src/backend/storage/admission/lifetime-lock.js");
  const { runtimeProfiles } = await import("../../src/models/config/define-runtime-isolation.js");
  const { noSymlinkAncestry } = await import("../../src/backend/storage/configuration/credential-safe-file.js");
  const { openReadOnlyDatabase } = await import("../../src/backend/storage/sqlite/readonly-authority-snapshot.js");
  const { readAppSettings } = await import("../../src/backend/storage/sqlite/settings-storage.js");
  const checkout = developmentCopyCheckout();
  if (realpathSync(process.cwd()) === checkout) throw new Error("idle-benchmark-use-separate-checkout");
  const stop = new AbortController();
  const interrupt = () => { stop.abort(new Error("idle-benchmark-interrupted")); };
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);
  let inputDigest: string | undefined;
  try {
    checkoutGit(checkout, ["fetch", "--prune", "origin"]);
    const comparison = base === undefined ? undefined : await runSha(base);
    const result = await runSha(target);
    const report = { schemaVersion: 1, sampleIntervalMs: sampleMs, requestedWindowMs: windowMs, stallThresholdMs: stallMs,
      threadBusyLimitPercent: busyLimit, rssFlatToleranceBytes: rssFlatBytes, logicalCpus: availableParallelism(), node: process.version,
      target: result, ...(comparison === undefined ? {} : { base: comparison }),
      comparison: comparison === undefined ? "not-requested" : compareIdleRuns(comparison.verdict, result.verdict) };
    const output = join(process.cwd(), `idle-three-tab-${target.slice(0, 12)}-${systemClock.nowMs().toString()}.json`);
    writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    process.stdout.write(`Idle benchmark result written to ${output}\n`);
    if (result.verdict.verdict === "inconclusive" || comparison?.verdict.verdict === "inconclusive") process.exitCode = 1;
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
  }

  async function runSha(sha: string) {
    stop.signal.throwIfAborted();
    const lock = await acquireRuntimeLifetimeLock(runtimeProfiles.development.lockPort);
    try {
      developmentCopyCheckout();
      checkoutGit(checkout, ["cat-file", "-e", `${sha}:scripts/profiles/copy-signin.ts`]);
      checkoutGit(checkout, ["checkout", "--detach", sha]);
      if (checkoutGit(checkout, ["rev-parse", "HEAD"]) !== sha) throw new Error("idle-benchmark-sha-mismatch");
      const dependencies = lstatSync(join(checkout, "node_modules"), { throwIfNoEntry: false });
      if (dependencies !== undefined && !dependencies.isDirectory()) throw new Error("idle-benchmark-copy-dependencies-refused");
      execFileSync("npm", ["ci"], { cwd: checkout, env: workerBootstrapEnvironment(), stdio: "inherit" });
    } finally { await lock.close(); }
    const runs = [await runOnce(sha), await runOnce(sha)] as const;
    return { sha, runs, verdict: summarizeIdleRuns(runs) };
  }

  async function runOnce(sha: string) {
    stop.signal.throwIfAborted();
    const directory = mkdtempSync(join(realpathSync("/tmp"), "relay-idle-"));
    const socket = join(directory, "probe.sock");
    try {
      if (Buffer.byteLength(socket) >= 104) throw new Error("idle-benchmark-probe-path-too-long");
      const preload = new URL(import.meta.url);
      preload.searchParams.set("socket", socket);
      return await withHeadlessCopySignin(async session => {
        const digest = createHash("sha256");
        for await (const chunk of createReadStream(archiveRoot(session.stateRoot))) {
          if (!Buffer.isBuffer(chunk)) throw new Error("idle-benchmark-history-read-invalid");
          digest.update(chunk);
        }
        const current = digest.digest("hex");
        inputDigest ??= current;
        if (inputDigest !== current) throw new Error("idle-benchmark-imported-history-changed");
        return await measureTabs(session, socket);
      }, { signal: stop.signal, expectedSha: sha, backendPreload: preload, beforeStart({ stateRoot, installationId, profileId }) {
        const history = archiveRoot(stateRoot), local = join(stateRoot, "state.db");
        for (const path of [history, local, `${local}-wal`, `${local}-shm`]) {
          const stat = lstatSync(path, { throwIfNoEntry: false });
          if (stat === undefined && path !== history && path !== local) continue;
          if (!noSymlinkAncestry(dirname(path), new Map()) || !stat?.isFile() || stat.nlink !== 1) throw new Error("idle-benchmark-copy-file-refused");
        }
        const archive = openReadOnlyDatabase(history, 250);
        try {
          const binding = z.strictObject({ installation_id: z.uuid(), profile_id: z.uuid() }).parse(archive.prepare("SELECT installation_id, profile_id FROM history_header").get());
          if (binding.installation_id !== installationId || binding.profile_id !== profileId
            || archive.prepare("SELECT 1 FROM runs LIMIT 1").get() === undefined
            || archive.prepare("SELECT 1 FROM runs WHERE state IS NOT 'terminal' LIMIT 1").get() !== undefined) throw new Error("idle-benchmark-imported-history-refused");
        } finally { archive.close(); }
        const database = openReadOnlyDatabase(local, 250);
        try {
          const settings = readAppSettings(database);
          assertHeadlessCopySettings(settings?.saved?.settings ?? settings?.initialization.settings.settings);
          if (database.prepare("SELECT 1 FROM runs WHERE state IS NOT 'terminal' LIMIT 1").get() !== undefined) throw new Error("idle-benchmark-active-copy-runs");
        } finally { database.close(); }
      } });
    } finally {
      if (lstatSync(socket, { throwIfNoEntry: false })?.isSocket()) unlinkSync(socket);
      rmdirSync(directory);
    }
  }
}

const entryPath = process.argv[1];
if (entryPath !== undefined && pathToFileURL(entryPath).href === import.meta.url) {
  try { await runBenchmark(); }
  catch (error) {
    const code = error instanceof Error && /^(?:idle-benchmark|copy-signin)-[a-z-]+$/u.test(error.message) ? error.message : "idle-benchmark-failed";
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  }
} else {
  const socket = new URL(import.meta.url).searchParams.get("socket");
  if (socket !== null && readRuntimeProfile() === "development" && process.argv[2] === "--owned-backend"
    && process.argv[3] === "development" && process.argv.length === 4
    && entryPath === join(userInfo().homedir, "Projects", "hr-relay-dev", "scripts", "profiles", "copy-signin.ts")) {
    const directory = dirname(socket);
    if (basename(socket) !== "probe.sock" || !/^relay-idle-[\w-]{6}$/u.test(basename(directory)) || dirname(directory) !== realpathSync("/tmp")
      || realpathSync(directory) !== directory || (lstatSync(directory).mode & 0o777) !== 0o700) throw new Error("idle-benchmark-probe-path-refused");
    serveBackendProbe(socket);
  }
}
