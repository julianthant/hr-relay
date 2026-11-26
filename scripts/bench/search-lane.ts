import { execFileSync } from "node:child_process";
import { availableParallelism, loadavg } from "node:os";
import { join } from "node:path";
import { DatabaseSync, StatementSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { Hono } from "hono";
import { z } from "zod";
import type { composeShell } from "../../src/backend/app/composition/dashboard/shell.js";
import type { DashboardReadLanes, LaneReadDefinition } from "../../src/backend/storage/sqlite/dashboard-read-host.js";
import type { DashboardApp } from "../../src/backend/transports/http/routes/api-types.js";
import { runtimeProfiles } from "../../src/models/config/define-runtime-isolation.js";
import { RUNTIME_PROFILE_ENV } from "../../src/models/config/secrets.js";
import { CalendarWireSchema } from "../../src/models/dashboard/calendar.js";
import { CrossDateSearchPageSchema, CrossDateSearchQuerySchema } from "../../src/models/dashboard/search.js";
import { searchPartitionDay } from "../../src/models/dashboard/search-calendar.js";
import { OPERATOR_XLSX_MEDIA_TYPE } from "../../src/models/dashboard/xlsx-export.js";
import { ActorIdSchema, FingerprintSchema } from "../../src/rules/identity/ids.js";
import { systemIdFactory } from "../../src/rules/identity/identifiers.js";
import { systemClock } from "../../src/rules/time/clock.js";

const ProfileSchema = z.enum(["staging", "development"]);
const STALL_LIMIT_MS = 20;
const SAMPLE_MS = 1;

function countMainSqlite() {
  let calls = 0;
  const sqliteMethods = [
    { prototype: DatabaseSync.prototype, names: ["prepare", "exec"] },
    { prototype: StatementSync.prototype, names: ["all", "get", "iterate", "run"] },
  ].flatMap(({ prototype, names }) => names.map(name => {
    const original = Object.getOwnPropertyDescriptor(prototype, name);
    const method: unknown = original?.value;
    if (original === undefined || typeof method !== "function" || original.writable !== true) {
      throw new Error(`search-lane-bench-sqlite-probe-unavailable: ${name}`);
    }
    const counted = new Proxy(method, { apply(target, receiver, args) {
      calls++;
      const result: unknown = Reflect.apply(target, receiver, args);
      return result;
    } });
    return { prototype, name, original, counted };
  }));
  for (const { prototype, name, original, counted } of sqliteMethods) Object.defineProperty(prototype, name, { ...original, value: counted });
  return { count: () => calls, close() {
    for (const { prototype, name, original } of sqliteMethods) Object.defineProperty(prototype, name, original);
  } };
}

async function timedHttp(origin: string, path: string, init?: RequestInit) {
  let lastTick = performance.now(), stallMs = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    stallMs = Math.max(stallMs, now - lastTick - SAMPLE_MS);
    lastTick = now;
  }, SAMPLE_MS);
  try {
    const started = performance.now();
    const response = await fetch(origin + path, init);
    const bytes = Buffer.from(await response.arrayBuffer());
    const requestMs = performance.now() - started;
    await delay(SAMPLE_MS);
    if (!response.ok) throw new Error(`search-lane-bench-http-failed: ${new URL(path, origin).pathname} ${String(response.status)}`);
    return { response, bytes, requestMs, stallMs };
  } finally { clearInterval(timer); }
}

/** The same socket-level scenario runs in CI with a signed-in synthetic profile. */
export async function measureSearchLaneHttp(input: Parameters<typeof composeShell>[0] & { readLanes: DashboardReadLanes }, repeats: number) {
  const [{ composeShell }, { registerShellRoutes }, { startDashboardHttpServer }, { failureStatus }] = await Promise.all([
    import("../../src/backend/app/composition/dashboard/shell.js"),
    import("../../src/backend/transports/http/routes/shell.js"),
    import("../../src/backend/transports/http/http-server.js"),
    import("../../src/backend/transports/http/routes/failure-status.js"),
  ]);
  const byDay = new Map<string, number>();
  const today = searchPartitionDay(input.clock.now());
  for (const row of input.database.dashboardHistory().readRunSummaries()) {
    if (row.workflow === "ocr" && row.parent !== null) continue;
    const day = searchPartitionDay(new Date(row.enqueuedAt));
    if (day <= today) byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }
  const busiest = [...byDay].sort(([dayA, countA], [dayB, countB]) => countB - countA || dayB.localeCompare(dayA))[0];
  if (busiest === undefined) throw new Error("search-lane-bench-no-history");
  const [day, runsOnDay] = busiest;
  const month = day.slice(0, 7);
  const query = CrossDateSearchQuerySchema.omit({ cursor: true }).parse({ q: "", facets: { day }, limit: 50 });
  const searchPath = `/api/v1/search?q=&day=${day}&limit=${String(query.limit)}`;
  const calendarPath = `/api/v1/calendar?day=${day}&month=${month}`;
  const sql = countMainSqlite();
  const selectionEnds: number[] = [];
  const readLanes: DashboardReadLanes = { ...input.readLanes,
    async read<Args>(definition: LaneReadDefinition<Args, unknown>, args: Args, options?: Parameters<DashboardReadLanes["read"]>[2]) {
      const reply = await input.readLanes.read(definition, args, options);
      if (definition.name === "search-xlsx-selection") selectionEnds.push(sql.count());
      return reply;
    } };
  try {
    const shell = composeShell({ ...input, readLanes });
    try {
      const expectedCalendar = input.database.dashboardHistory().queryRunCalendar({ day, month, today });
      const app: DashboardApp = new Hono();
      const actor = ActorIdSchema.parse("local-operator");
      app.use("*", async (c, next) => { c.set("requestActorId", actor); await next(); });
      app.onError((error, c) => { const { body, status } = failureStatus(error); return c.json(body, status); });
      registerShellRoutes(app, shell);
      const server = await startDashboardHttpServer({ app, port: 0 });
      try {
        const origin = `http://127.0.0.1:${String(server.port)}`;
        const read = async (path: string) => {
          const before = sql.count();
          const { bytes, requestMs, stallMs } = await timedHttp(origin, path);
          const body: unknown = JSON.parse(bytes.toString("utf8"));
          return { body, requestMs, stallMs, mainSqliteCalls: sql.count() - before };
        };
        const search = [], calendar = [];
        let page;
        for (let index = 0; index <= repeats; index++) {
          const { body: searchBody, ...searchTiming } = await read(searchPath);
          const { body: calendarBody, ...calendarTiming } = await read(calendarPath);
          page = CrossDateSearchPageSchema.parse(searchBody);
          const wire = CalendarWireSchema.parse(calendarBody);
          if (page.totalMatches !== runsOnDay || page.results.length !== Math.min(query.limit, runsOnDay)
            || page.results.some(row => row.partitionDay !== day) || JSON.stringify(wire) !== JSON.stringify(expectedCalendar)) {
            throw new Error("search-lane-bench-busiest-day-mismatch");
          }
          if (index !== 0) { search.push(searchTiming); calendar.push(calendarTiming); }
        }
        if (page === undefined) throw new Error("search-lane-bench-no-search-page");
        const before = sql.count();
        const { response, bytes } = await timedHttp(origin, "/api/v1/exports/xlsx", { method: "POST",
          headers: { "content-type": "application/json" }, body: JSON.stringify({ requestVersion: 3,
            selection: { kind: "search", query, snapshot: { ...page.snapshot, generatedAt: page.generatedAt } } }) });
        const after = sql.count();
        const [selected] = selectionEnds;
        if (selected === undefined || selectionEnds.length !== 1 || response.headers.get("content-type") !== OPERATOR_XLSX_MEDIA_TYPE
          || !response.headers.has("x-operator-export-id") || bytes.readUInt32LE(0) !== 0x04034b50 || after <= selected) {
          throw new Error("search-lane-bench-xlsx-selection-or-write-missing");
        }
        const xlsx = { selectionMainSqliteCalls: selected - before, effectMainSqliteCalls: after - selected };
        const maxStallMs = Math.max(...[...search, ...calendar].map(row => row.stallMs));
        return { day, runsOnDay, search, calendar, xlsx, maxStallMs, stallLimitMs: STALL_LIMIT_MS,
          passed: maxStallMs <= STALL_LIMIT_MS && xlsx.selectionMainSqliteCalls === 0
            && [...search, ...calendar].every(row => row.mainSqliteCalls === 0) };
      } finally { await server.close(); }
    } finally { shell.hub.close(); }
  } finally { sql.close(); }
}

async function measureCopy(profile: z.infer<typeof ProfileSchema>, repeats: number) {
  const [{ applicationDataWorkspace }, { acquireRuntimeLifetimeLock }, { acquireEntrypointAdmission }, { createCredentialStore },
    { AuthorityDatabase }, { createComposedDashboardReadHost }, { createContentAddressedArtifactWriter }, { READABLE_WORKFLOW_MODULES }] = await Promise.all([
    import("../../src/backend/app/config/runtime-isolation.js"), import("../../src/backend/storage/admission/lifetime-lock.js"),
    import("../../src/backend/storage/admission/bootstrap-admission.js"), import("../../src/backend/storage/configuration/credential-store.js"),
    import("../../src/backend/storage/sqlite/authority-database.js"), import("../../src/backend/app/composition/dashboard/runtime-resources.js"),
    import("../../src/backend/storage/artifacts/content-addressed-artifact-writer.js"), import("../../src/backend/app/registries/workflow-registry.js"),
  ]);
  const workspace = applicationDataWorkspace(undefined, profile);
  const lock = await acquireRuntimeLifetimeLock(runtimeProfiles[profile].lockPort);
  try {
    const machine = acquireEntrypointAdmission(workspace, "exclusive", lock);
    try {
      const { activeProfileId } = machine.readProfileRegistry();
      if (activeProfileId === null) throw new Error("search-lane-bench-sign-in-required");
      const admission = machine.admitProfile(activeProfileId);
      try {
        const credentials = createCredentialStore({ admission, stateRoot: admission.stateRoot });
        const clock = systemClock;
        const database = AuthorityDatabase.open(admission, { path: join(admission.stateRoot, "state.db"), busyTimeoutMs: 5000,
          migrationOwner: "search-lane-bench" }, clock, undefined, undefined, undefined, credentials);
        try {
          if (database.dashboardHistory() === database) throw new Error("search-lane-bench-history-required: import history with profile-copy first");
          const readLanes = createComposedDashboardReadHost({ admission, database, clock });
          try {
            const artifacts = createContentAddressedArtifactWriter({ admission });
            await Promise.all([artifacts.ready, readLanes.ready]);
            const unused = (): never => { throw new Error("unexpected search benchmark dependency"); };
            return await measureSearchLaneHttp({ database, readLanes, clock, artifacts, ids: systemIdFactory,
              descriptors: { resolve: id => READABLE_WORKFLOW_MODULES.find(module => module.descriptor.id === id)?.descriptor },
              projection: { onChange: () => () => {}, health: unused, requestDashboardDay: unused, stampDay: unused, foldCursor: unused, whenFolded: unused, recordPublishedDay: unused,
                generation: unused, cursor: unused, takeCursor: unused, position: unused, descriptorSetHash: unused, runFold: unused },
              activity: { read: unused, readSelected: unused }, appVersion: "benchmark",
              actorLabel: unused, descriptorSetHash: FingerprintSchema.parse("0".repeat(64)), preflightReport: unused,
              workbookCompatibility: unused, backfillGaps: { detected: unused } }, repeats);
          } finally { await readLanes.close(); }
        } finally { database.close(); }
      } finally { admission.release(); }
    } finally { machine.release(); }
  } finally { await lock.close(); }
}

const entryPath = process.argv[1];
if (entryPath !== undefined && pathToFileURL(entryPath).href === import.meta.url) {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: { runs: { type: "string", default: "5" } } });
  const [profile] = z.tuple([ProfileSchema]).parse(positionals);
  const repeats = z.coerce.number().int().min(1).max(20).parse(values.runs);
  process.env[RUNTIME_PROFILE_ENV] = profile;
  const result = await measureCopy(profile, repeats);
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  process.stdout.write(`${JSON.stringify({ gate: "G3", profile, commit, node: process.version,
    host: { cpus: availableParallelism(), loadavg: loadavg() }, ...result }, null, 2)}\n`);
  if (!result.passed) process.exitCode = 1;
}
