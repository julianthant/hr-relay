// Scratch prototype for #486, never merged: dashboard reads on a read-only worker vs the request thread, on a private store copy.
// Usage: node --import tsx scripts/bench/read-workers.ts <copy-root containing state.db>
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";
import { DatabaseSync } from "node:sqlite";
import { readNotificationSources } from "../../src/backend/app/composition/dashboard/notification-sources.js";
import { RunRecordService } from "../../src/backend/runs/lifecycle/run-record-service.js";
import { createCalendarQuery } from "../../src/backend/runs/queries/calendar.js";
import { queryQueueSummaries } from "../../src/backend/runs/queries/queue-summaries.js";
import { registerRuntimeAdmission } from "../../src/backend/storage/admission/admission-identity.js";
import type { RuntimeAdmission } from "../../src/backend/storage/admission/admission.js";
import { readTimelineRecords } from "../../src/backend/storage/events/timeline-reader.js";
import { applyAuthorityMigrationsAfter, AuthorityDatabase } from "../../src/backend/storage/sqlite/authority-database.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../src/models/config/authority-schema-versions.js";
import { systemClock } from "../../src/rules/time/clock.js";

// shortcut: a prototype-only admission that asserts nothing; the real build admits the worker from the main thread's admission.
function copyAdmission(stateRoot: string, binding: { installationId: string; profileId: string }): RuntimeAdmission {
  const target = { stateRoot, profileBinding: binding, lifetime: {} } as Record<string | symbol, unknown>;
  const admission = new Proxy(target, { get: (object, key) => key in object ? object[key] : () => undefined }) as unknown as RuntimeAdmission;
  registerRuntimeAdmission(admission);
  return admission;
}

function bindingOf(path: string) {
  const raw = new DatabaseSync(path, { readOnly: true });
  try { return raw.prepare("SELECT installation_id AS installationId, profile_id AS profileId FROM database_states WHERE id=1").get() as { installationId: string; profileId: string }; }
  finally { raw.close(); }
}

function openCopy(root: string, readOnly: boolean) {
  const path = join(root, "state.db");
  return AuthorityDatabase.open(copyAdmission(root, bindingOf(path)), { path, busyTimeoutMs: 5000, migrationOwner: "read-workers-bench",
    ...(readOnly ? { openMode: "dashboard-read-worker-read-only-no-migrate" } : {}) });
}

type Args = Record<string, string>;
const uncached = (database: AuthorityDatabase) => new Proxy(database, { get: (target, key) => {
  const value = Reflect.get(target, key, target) as unknown;
  return typeof value === "function" ? (value as (...input: unknown[]) => unknown).bind(target) : value;
} });
const READS: Record<string, (database: AuthorityDatabase, args: Args) => unknown> = {
  queueDay: (database, args) => queryQueueSummaries(database, { fromDay: args.day, toDay: args.day, limit: 500 }),
  search: (database, args) => database.authority.runs.search({ q: args.q ?? "", scope: "all", facets: {}, limit: 51 }),
  calendar: (database, args) => createCalendarQuery(database, systemClock).read({ month: args.day.slice(0, 7), day: args.day }),
  runTimeline: (database, args) => readTimelineRecords(database.authority.timelineEvents, 0, args.runId),
  wholeTimeline: database => readTimelineRecords(database.authority.timelineEvents, 0),
  // A fresh key object per call defeats the change-key cache, so each call measures a miss.
  notificationScan: database => readNotificationSources(uncached(database), new RunRecordService({ database, clock: systemClock,
    ids: { uuid: randomUUID }, publishQueued: () => { throw new Error("read-only"); } })),
  changePosition: database => database.changeKey(),
};

// json: the worker returns the finished response body, so the main thread receives one string instead of an object graph.
type Request = { id: number; read: string; args: Args; json?: boolean };
type Reply = { id: number; result?: unknown; json?: string; error?: string; workerMs: number };

if (!isMainThread && parentPort !== null) {
  const port = parentPort;
  const database = openCopy(String(workerData.root), true);
  port.on("message", (request: Request | null) => {
    if (request === null) { database.close(); port.close(); return; }
    const started = performance.now();
    try {
      const result = READS[request.read](database, request.args);
      port.postMessage((request.json === true ? { id: request.id, json: JSON.stringify(result), workerMs: performance.now() - started }
        : { id: request.id, result, workerMs: performance.now() - started }) satisfies Reply);
    } catch (error) { port.postMessage({ id: request.id, error: String(error), workerMs: performance.now() - started } satisfies Reply); }
  });
  port.postMessage({ id: 0, workerMs: 0 } satisfies Reply);
}

/** Shape A is one of these; shape B is two. Interactive requests jump the queue; a newer request for a view replaces its queued one. */
function createReadWorker(root: string) {
  const worker = new Worker(new URL(import.meta.url), { workerData: { root }, execArgv: process.execArgv });
  const ready = new Promise<void>(resolve => worker.once("message", () => resolve()));
  const queue: { view: string; interactive: boolean; request: Request; done: PromiseWithResolvers<Reply> }[] = [];
  let busy: Request | undefined, next = 1;
  const pump = () => {
    if (busy !== undefined) return;
    const index = queue.findIndex(entry => entry.interactive), entry = queue.splice(index === -1 ? 0 : index, 1)[0];
    if (entry === undefined) return;
    busy = entry.request;
    worker.once("message", (reply: Reply) => { busy = undefined; entry.done.resolve(reply); pump(); });
    worker.postMessage(entry.request);
  };
  return {
    ready,
    read(view: string, read: string, args: Args, interactive = true, json = false): Promise<Reply> {
      for (const [index, entry] of queue.entries()) if (entry.view === view) {
        queue.splice(index, 1);
        entry.done.resolve({ id: entry.request.id, error: "superseded", workerMs: 0 });
      }
      const done = Promise.withResolvers<Reply>();
      queue.push({ view, interactive, request: { id: next++, read, args, json }, done });
      pump();
      return done.promise;
    },
    close: () => { worker.postMessage(null); return new Promise<void>(resolve => worker.once("exit", () => resolve())); },
  };
}

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const fmt = (values: number[]) => `${median(values).toFixed(1)} [${Math.min(...values).toFixed(1)}–${Math.max(...values).toFixed(1)}]`;

/** run may return the click's own click-to-content when other reads share the window. */
async function measure(label: string, run: () => Promise<unknown> | unknown, repeats: number) {
  const elapsed: number[] = [], stalls: number[] = [];
  for (let index = 0; index < repeats + 1; index++) {
    const histogram = monitorEventLoopDelay({ resolution: 1 });
    // A 1 ms timer measures how late the loop wakes while the read is outstanding.
    let worst = 0, last = performance.now();
    const probe = setInterval(() => { const now = performance.now(); worst = Math.max(worst, now - last - 1); last = now; }, 1);
    histogram.enable();
    await new Promise(resolve => setImmediate(resolve));
    last = performance.now();
    const started = performance.now();
    const own = await run();
    const took = typeof own === "number" ? own : performance.now() - started;
    await new Promise(resolve => setTimeout(resolve, 5));
    clearInterval(probe); histogram.disable();
    if (index === 0) continue; // first run warms caches and statements
    elapsed.push(took); stalls.push(Math.max(worst, histogram.max / 1e6 - 1));
  }
  return { label, clickToContent: fmt(elapsed), mainStall: fmt(stalls) };
}

if (isMainThread) {
  const root = process.argv[2];
  if (root === undefined) throw new Error("usage: read-workers.ts <copy-root>");
  // Upgrade the copy the way backup import does: raw connection, the stored migrations, then the version stamp.
  const raw = new DatabaseSync(join(root, "state.db"), { enableForeignKeyConstraints: true, defensive: true });
  const version = (raw.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
  if (version !== CURRENT_AUTHORITY_SCHEMA_VERSION) {
    raw.exec("BEGIN EXCLUSIVE");
    applyAuthorityMigrationsAfter(raw, version, { now: new Date().toISOString(), binding: bindingOf(join(root, "state.db")),
      captureFile: () => { throw new Error("copy-upgrade-artifact-unavailable"); } });
    raw.prepare("UPDATE database_states SET schema_version=? WHERE id=1").run(CURRENT_AUTHORITY_SCHEMA_VERSION);
    raw.exec(`PRAGMA user_version=${String(CURRENT_AUTHORITY_SCHEMA_VERSION)}; COMMIT`);
  }
  raw.close();
  openCopy(root, false).close();
  const main = openCopy(root, true);
  const probe = new DatabaseSync(join(root, "state.db"), { readOnly: true });
  const day = (probe.prepare("SELECT local_day AS day FROM runs GROUP BY local_day ORDER BY count(*) DESC LIMIT 1").get() as { day: string }).day;
  const runId = (probe.prepare("SELECT run_id AS runId FROM timeline_events WHERE run_id IS NOT NULL GROUP BY run_id ORDER BY count(*) DESC LIMIT 1").get() as { runId: string }).runId;
  const counts = probe.prepare("SELECT (SELECT count(*) FROM runs) AS runs, (SELECT count(*) FROM timeline_events) AS events, (SELECT user_version FROM pragma_user_version) AS schema").get();
  probe.close();
  const args: Args = { day, runId, q: "a" };
  const repeats = Number(process.env.REPEATS ?? 7);
  process.stdout.write(`copy: ${JSON.stringify(counts)} busiest day ${day}, largest run ${runId}\n`);

  const rssBefore = process.memoryUsage().rss, launched = performance.now();
  const one = createReadWorker(root);
  await one.ready;
  const startMs = performance.now() - launched;
  for (const read of Object.keys(READS)) await one.read(read, read, args);
  const rssOne = process.memoryUsage().rss;
  const two = [createReadWorker(root), createReadWorker(root)];
  await Promise.all(two.map(worker => worker.ready));
  for (const worker of two) for (const read of Object.keys(READS)) await worker.read(read, read, args);
  process.stdout.write(`worker start ${startMs.toFixed(0)} ms; rss +${((rssOne - rssBefore) / 2 ** 20).toFixed(0)} MiB for one warmed worker, +${((process.memoryUsage().rss - rssOne) / 2 ** 20).toFixed(0)} MiB for two more\n`);
  const rows: { read: string; shape: string; clickToContent: string; mainStall: string; bytes: number }[] = [];
  const viaWorker = (target: ReturnType<typeof createReadWorker>, read: string, json: boolean) => async () => {
    const reply = await target.read(read, read, args, true, json);
    if (reply.error !== undefined) throw new Error(reply.error);
    // The route would hand reply.json to the response as is; the object path still serializes on the main thread.
    return reply.json ?? JSON.stringify(reply.result);
  };
  for (const read of Object.keys(READS)) {
    const bytes = Buffer.byteLength(JSON.stringify(READS[read](main, args)) ?? "");
    rows.push({ read, shape: "request thread", bytes, ...await measure(read, () => JSON.stringify(READS[read](main, args)), repeats) },
      { read, shape: "worker, object reply", bytes, ...await measure(read, viaWorker(one, read, false), repeats) },
      { read, shape: "worker, string reply", bytes, ...await measure(read, viaWorker(one, read, true), repeats) });
  }
  // A background notification scan has started and Search has asked for its calendar when the operator clicks a Queue day.
  // Shape A sends all three to one worker. Shape B sends search and calendar to the search worker, the rest to the navigation worker.
  const contention = (navigation: ReturnType<typeof createReadWorker>, search: ReturnType<typeof createReadWorker>) => async () => {
    const scan = navigation.read("notifications", "notificationScan", args, false, true);
    const calendar = search.read("calendar", "calendar", args, true, true), clicked = performance.now();
    await navigation.read("queue", "queueDay", args, true, true);
    const own = performance.now() - clicked;
    await Promise.all([scan, calendar]);
    return own;
  };
  const scenario = "queueDay click during scan + calendar";
  rows.push({ read: scenario, shape: "request thread", bytes: 0, ...await measure(scenario, () => {
    READS.notificationScan(main, args); READS.calendar(main, args); return JSON.stringify(READS.queueDay(main, args)); }, repeats) },
  { read: scenario, shape: "one worker (A)", bytes: 0, ...await measure(scenario, contention(one, one), repeats) },
  { read: scenario, shape: "two workers (B)", bytes: 0, ...await measure(scenario, contention(two[0], two[1]), repeats) });
  process.stdout.write(`${JSON.stringify({ repeats, rows }, null, 2)}\n`);
  main.close();
  await Promise.all([one.close(), ...two.map(worker => worker.close())]);
}
