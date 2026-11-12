import "./fake-keychain-entry.js";
import { execFileSync } from "node:child_process";
import { realpathSync, writeFileSync } from "node:fs";
import { cpus, hostname, tmpdir, totalmem } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { createDebugEventWriter } from "../../src/backend/logs/debug-events.js";
import { queryQueueSummaries } from "../../src/backend/runs/queries/queue-summaries.js";
import { systemClock } from "../../src/rules/time/clock.js";
import { seedStorageReadFixture, STORAGE_READ_NOTES_PER_RUN, type StorageReadFixture } from "./storage-read-fixture.js";
import { assertStatementCounterObserves, traceSqliteStatements, type PreparedStatementTrace } from "./sqlite-statement-counter.js";

export const STORAGE_READ_SIZES = Object.freeze([100, 1_000, 10_000] as const);
export const STORAGE_READ_MIN_ITERATIONS = 20;

/** The three dashboard reads that re-check the store, each checked against what it must return. */
export const STORAGE_READS = Object.freeze({
  "queue-list": {
    read: (fixture: StorageReadFixture) => queryQueueSummaries(fixture.reader, { limit: 50 }),
    served: (value: unknown, fixture: StorageReadFixture) => {
      const items = z.object({ items: z.array(z.unknown()) }).parse(value).items.length;
      if (items !== Math.min(50, fixture.runCount)) throw new Error(`the queue list served ${String(items)} rows`);
      return items;
    },
  },
  "run-search": {
    read: (fixture: StorageReadFixture) => fixture.reader.authority.runs.search({ q: "pl-", scope: "trace", facets: {}, limit: 25 }),
    served: (value: unknown, fixture: StorageReadFixture) => {
      const matches = z.object({ totalMatches: z.number() }).parse(value).totalMatches;
      if (matches !== fixture.runCount) throw new Error(`run search matched ${String(matches)} of ${String(fixture.runCount)} runs`);
      return matches;
    },
  },
  "workflow-summaries": {
    read: (fixture: StorageReadFixture) => fixture.reader.summaryWorkflows(),
    served: (value: unknown) => {
      const workflows = z.array(z.string()).parse(value);
      if (workflows.length !== 2) throw new Error(`workflow summaries named ${workflows.join(", ")}`);
      return workflows.length;
    },
  },
});
export type StorageReadId = keyof typeof STORAGE_READS;

const DATA_VERSION = "PRAGMA data_version";
// `#validateExternalQuerySources` reads data_version, then `validateAuthorityRecordSchemas` opens with this statement.
const CHECK_FIRST_STATEMENT = "SELECT search_state FROM database_states WHERE id=1";

interface CheckWindow {
  readonly ms: number;
  readonly statements: number;
  readonly prepareMs: number;
}

/** Finds the one whole-store check inside a traced read, between the data_version reads that open and close it. */
export function wholeStoreCheck(statements: readonly PreparedStatementTrace[]): CheckWindow {
  const openings = statements.flatMap((statement, index) =>
    statement.sql === DATA_VERSION && statements[index + 1]?.sql.trim() === CHECK_FIRST_STATEMENT ? [index] : []);
  if (openings.length !== 1) {
    throw new Error(`the timed read ran the whole-store check ${String(openings.length)} times, not once; its numbers would not be about the check`);
  }
  const opening = openings[0];
  const closing = statements.findIndex((statement, index) => index > opening && statement.sql === DATA_VERSION);
  if (closing === -1) throw new Error("the whole-store check never read data_version again, so it did not finish validating");
  const inside = statements.slice(opening + 1, closing);
  return {
    ms: statements[closing].endedAt - statements[opening].startedAt,
    statements: inside.length,
    prepareMs: inside.reduce((sum, statement) => sum + statement.endedAt - statement.startedAt, 0),
  };
}

export interface Distribution { readonly medianMs: number; readonly p95Ms: number; readonly minMs: number; readonly maxMs: number }

function distribution(samples: readonly number[]): Distribution {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (rank: number) => round(sorted[Math.min(sorted.length - 1, Math.max(0, rank))]);
  return { medianMs: at(Math.floor((sorted.length - 1) / 2)), p95Ms: at(Math.ceil(0.95 * sorted.length) - 1), minMs: at(0), maxMs: at(sorted.length - 1) };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export interface ReadMeasurement {
  readonly read: StorageReadId;
  readonly runCount: number;
  readonly iterations: number;
  readonly total: Distribution;
  readonly check: Distribution;
  readonly query: Distribution;
  /** Share of the whole read's time spent inside `prepare()`, median over iterations. */
  readonly prepareShare: number;
  readonly checkPrepareShare: number;
  /** Prepared statements inside the check in every timed read; one value means every read did the same work. */
  readonly checkStatements: readonly number[];
  readonly served: number;
}

/** Each timed read follows a debug event the second connection committed, so `PRAGMA data_version` has moved. */
export function measureStorageRead(fixture: StorageReadFixture, read: StorageReadId, iterations: number, appendMs: number[]): ReadMeasurement {
  const subject = STORAGE_READS[read];
  const debugEvents = createDebugEventWriter({ repository: fixture.writer.authority.timelineEvents, clock: fixture.clock, build: "0.1.0" });
  const total: number[] = [], check: number[] = [], query: number[] = [], prepareShare: number[] = [], checkPrepareShare: number[] = [];
  const checkStatements = new Set<number>();
  let served = 0;
  for (let index = 0; index < iterations; index += 1) {
    const appendStarted = systemClock.monotonicMs();
    const appended = debugEvents.emit({ category: "http", phase: "failed", correlationId: `storage-read-${read}-${String(index)}` });
    appendMs.push(systemClock.monotonicMs() - appendStarted);
    if (appended.state !== "inserted") throw new Error(`the second connection's debug event was ${appended.state}, so nothing was committed`);
    const started = systemClock.monotonicMs();
    const traced = traceSqliteStatements(() => subject.read(fixture));
    const elapsed = systemClock.monotonicMs() - started;
    served = subject.served(traced.value, fixture);
    const window = wholeStoreCheck(traced.statements);
    const prepareMs = traced.statements.reduce((sum, statement) => sum + statement.endedAt - statement.startedAt, 0);
    total.push(elapsed);
    check.push(window.ms);
    query.push(elapsed - window.ms);
    prepareShare.push(prepareMs / elapsed);
    checkPrepareShare.push(window.prepareMs / window.ms);
    checkStatements.add(window.statements);
  }
  const median = (values: readonly number[]) => Math.round([...values].sort((a, b) => a - b)[Math.floor((values.length - 1) / 2)] * 1000) / 1000;
  return {
    read, runCount: fixture.runCount, iterations,
    total: distribution(total), check: distribution(check), query: distribution(query),
    prepareShare: median(prepareShare), checkPrepareShare: median(checkPrepareShare),
    checkStatements: [...checkStatements].sort((a, b) => a - b), served,
  };
}

/** Log-log slope of the median from the smallest to the largest size: ~0 flat, ~1 linear, above that worse. */
export function growth(points: readonly { runCount: number; medianMs: number }[]): { slope: number; verdict: "flat" | "sublinear" | "linear" | "worse than linear" } {
  const first = points[0], last = points[points.length - 1];
  const slope = Math.round(Math.log(last.medianMs / first.medianMs) / Math.log(last.runCount / first.runCount) * 100) / 100;
  const verdict = slope < 0.2 ? "flat" : slope < 0.8 ? "sublinear" : slope <= 1.2 ? "linear" : "worse than linear";
  return { slope, verdict };
}

function probe(command: string, args: readonly string[]): string {
  try {
    return execFileSync(command, args, { encoding: "utf8" });
  } catch (error) {
    throw new Error(`the disk probe \`${command} ${args.join(" ")}\` failed; the baseline must name the disk it ran on`, { cause: error });
  }
}

function field(output: string, name: string, source: string): string {
  const value = new RegExp(`^\\s*${name}:\\s*(.+)$`, "mu").exec(output)?.[1]?.trim();
  if (value === undefined || value === "") throw new Error(`\`${source}\` reported no ${name}`);
  return value;
}

/** The volume that holds the fixtures' temporary stores, and on macOS the physical disk behind it. */
function disk(): string {
  const volume = probe("df", ["-P", realpathSync(tmpdir())]).trim().split("\n").at(-1)?.split(/\s+/u)[0];
  if (volume === undefined || !volume.startsWith("/dev/")) throw new Error(`\`df -P\` named no device for ${tmpdir()}`);
  if (process.platform !== "darwin") return volume;
  const info = probe("diskutil", ["info", volume]);
  const store = field(info, "APFS Physical Store", `diskutil info ${volume}`).replace(/s\d+$/u, "");
  const media = field(probe("diskutil", ["info", store]), "Device / Media Name", `diskutil info ${store}`);
  return `${media} (${field(info, "File System Personality", `diskutil info ${volume}`)}, solid state ${field(info, "Solid State", `diskutil info ${volume}`)})`;
}

function machine() {
  const cpu = cpus();
  if (cpu[0] === undefined) throw new Error("os.cpus() reported no CPU");
  return { host: hostname(), cpu: cpu[0].model, cores: cpu.length, memoryGb: round(totalmem() / 1024 ** 3),
    node: process.version, platform: `${process.platform}-${process.arch}`, disk: disk() };
}

export async function runStorageReadBenchmark(): Promise<void> {
  const argv = process.argv.slice(2);
  const flag = (name: string) => { const index = argv.indexOf(name); return index === -1 ? undefined : argv[index + 1]; };
  const iterations = z.coerce.number().int().min(STORAGE_READ_MIN_ITERATIONS).parse(flag("--iterations") ?? STORAGE_READ_MIN_ITERATIONS);
  const jsonPath = flag("--json");
  const host = machine();
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const trackedTreeClean = execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { encoding: "utf8" }).trim() === "";
  const measurements: ReadMeasurement[] = [];
  const appends: { runCount: number; append: Distribution }[] = [];
  const seeds: { runCount: number; seedMs: number }[] = [];
  for (const runCount of STORAGE_READ_SIZES) {
    const fixture = await seedStorageReadFixture(runCount);
    try {
      assertStatementCounterObserves({ prepareProbe: () => { fixture.reader.authority.runs.get("00000000-0000-4000-8000-000000000001"); } });
      seeds.push({ runCount, seedMs: round(fixture.seedMs) });
      const appendMs: number[] = [];
      for (const read of Object.keys(STORAGE_READS) as StorageReadId[]) {
        measureStorageRead(fixture, read, 1, []); // discarded warm-up: module-level lazy costs
        measurements.push(measureStorageRead(fixture, read, iterations, appendMs));
      }
      appends.push({ runCount, append: distribution(appendMs) });
    } finally {
      await fixture.close();
    }
  }
  const growthByRead = Object.fromEntries((Object.keys(STORAGE_READS) as StorageReadId[]).map(read => [read,
    growth(measurements.filter(entry => entry.read === read).map(entry => ({ runCount: entry.runCount, medianMs: entry.total.medianMs })))]));
  const report = { measuredAt: systemClock.now().toISOString(), commit, trackedTreeClean, machine: host, iterations,
    fixture: { sizes: STORAGE_READ_SIZES, timelineEventsPerRun: 1 + STORAGE_READ_NOTES_PER_RUN, seeds }, measurements, appends, growth: growthByRead };

  const cell = (value: Distribution) => `${value.medianMs.toFixed(2)} / ${value.p95Ms.toFixed(2)}`;
  const lines = [
    "", `## Storage read baseline — ${commit.slice(0, 8)}${trackedTreeClean ? "" : " + UNCOMMITTED CHANGES"}`, "",
    `Host ${report.machine.host} · ${report.machine.cpu} · ${String(report.machine.cores)} cores · ${String(report.machine.memoryGb)} GB · `
    + `disk ${report.machine.disk} · node ${report.machine.node}. ${String(iterations)} timed reads per row after one discarded warm-up; `
    + "each read follows a debug event committed by a second connection.", "",
    "| Read | Runs | total ms median / p95 | check ms | query ms | prepare share (read / check) | check statements |",
    "|---|---|---|---|---|---|---|",
    ...measurements.map(entry => `| ${entry.read} | ${entry.runCount.toLocaleString("en-US")} | ${cell(entry.total)} | ${cell(entry.check)} | ${cell(entry.query)} `
      + `| ${(entry.prepareShare * 100).toFixed(1)}% / ${(entry.checkPrepareShare * 100).toFixed(1)}% | ${entry.checkStatements.join(", ")} |`),
    "", "| Debug event append | Runs | ms median / p95 |", "|---|---|---|",
    ...appends.map(entry => `| second connection | ${entry.runCount.toLocaleString("en-US")} | ${cell(entry.append)} |`),
    "", `Growth 100 → 10,000 runs (log-log slope of median total): ${Object.entries(growthByRead).map(([read, value]) => `${read} ${String(value.slope)} (${value.verdict})`).join(" · ")}`,
    `Seeded: ${seeds.map(seed => `${seed.runCount.toLocaleString("en-US")} runs in ${String(seed.seedMs)} ms`).join(" · ")}`, "",
  ];
  process.stdout.write(lines.join("\n"));
  if (jsonPath !== undefined) writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

const entryPath = process.argv[1];
if (entryPath !== undefined && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(entryPath))) {
  await runStorageReadBenchmark();
}
