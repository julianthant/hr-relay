
import { execFileSync } from "node:child_process";
import { realpathSync, writeFileSync } from "node:fs";
import { cpus, totalmem } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { applyDashboardDayPatch } from "../../src/dashboard/client/queries/day-state.js";
import {
  DashboardDayWireSchema,
  type DashboardDayWire,
} from "../../src/models/dashboard/projection.js";
import type { DashboardDayPatchSchema } from "../../src/models/dashboard/subscription.js";
import { SpanEventWireSchema } from "../../src/models/events/types.js";
import { readTimelineRecords } from "../../src/backend/storage/events/timeline-reader.js";
import { buildRunDetail, buildRunSection } from "../../src/backend/runs/queries/run-detail.js";
import { PERF_FIXTURE_PROFILE, seedDashboardPerfFixture, type PerfFixture } from "./dashboard-fixture.js";
import { assertStatementCounterObserves, countSqliteStatements } from "./sqlite-statement-counter.js";

/* ── sampling ────────────────────────────────────────────────────────────── */

interface Timing {
  readonly iterations: number;
  readonly medianMs: number;

  readonly p95Ms: number;
}

function timeIt(iterations: number, work: () => void): Timing {
  work(); // discarded warm-up: the first call pays module-level lazy costs
  const samples: number[] = [];
  for (let index = 0; index < iterations; index += 1) {
    const started = performance.now();
    work();
    samples.push(performance.now() - started);
  }
  samples.sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil(0.95 * samples.length));
  return {
    iterations,
    medianMs: round(samples[Math.floor((samples.length - 1) / 2)]),
    p95Ms: round(samples[rank - 1]),
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}




function countDayWireParses<Result>(work: () => Result): { readonly value: Result; readonly parses: number } {
  const schema = DashboardDayWireSchema as unknown as { parse: (input: unknown) => unknown };
  const original = schema.parse.bind(DashboardDayWireSchema);
  // Restore the original own descriptor; deleting parse blindly can erase a real schema method.
  const ownDescriptor = Object.getOwnPropertyDescriptor(schema, "parse");
  let parses = 0;
  Object.defineProperty(schema, "parse", {
    configurable: true,
    enumerable: ownDescriptor?.enumerable ?? false,
    writable: true,
    value: (input: unknown): unknown => {
      parses += 1;
      return original(input);
    },
  });
  try {
    return { value: work(), parses };
  } finally {
    if (ownDescriptor === undefined) delete (schema as Partial<typeof schema>).parse;
    else Object.defineProperty(schema, "parse", ownDescriptor);
  }
}


function selfCheckDayWireParseSpy(wire: DashboardDayWire): void {
  const probe = countDayWireParses(() => DashboardDayWireSchema.parse(wire));
  if (probe.parses !== 1) {
    throw new Error(
      `the day-wire parse spy observed ${String(probe.parses)} parses while this harness performed exactly `
      + "one; it is not installed, and a zero reported for the patch row below would prove nothing",
    );
  }
}

function countSpanEventParses<Result>(work: () => Result): { readonly value: Result; readonly parses: number } {
  const schema = SpanEventWireSchema as unknown as { parse: (input: unknown) => unknown };
  const original = schema.parse.bind(SpanEventWireSchema);
  const ownDescriptor = Object.getOwnPropertyDescriptor(schema, "parse");
  let parses = 0;
  Object.defineProperty(schema, "parse", {
    configurable: true,
    enumerable: ownDescriptor?.enumerable ?? false,
    writable: true,
    value: (input: unknown): unknown => {
      parses += 1;
      return original(input);
    },
  });
  try {
    return { value: work(), parses };
  } finally {
    if (ownDescriptor === undefined) delete (schema as Partial<typeof schema>).parse;
    else Object.defineProperty(schema, "parse", ownDescriptor);
  }
}

function selfCheckSpanEventParseSpy(fixture: PerfFixture): void {
  const record = readTimelineRecords(fixture.database.authority.timelineEvents).records.find((entry) => entry.payload.kind === "span");
  if (record?.payload.kind !== "span") throw new Error("the span parse spy needs one real fixture event");
  const event = record.payload.event;
  const probe = countSpanEventParses(() => SpanEventWireSchema.parse(event));
  if (probe.parses !== 1) {
    throw new Error(
      `the span-event parse spy observed ${String(probe.parses)} parses while the harness performed exactly one; `
      + "a zero on the logs GET would prove nothing",
    );
  }
}

/* ── the report ──────────────────────────────────────────────────────────── */

const ReportSchema = z.strictObject({
  measuredAt: z.string(),
  commit: z.string(),
  // Exclude untracked dependency symlinks when comparing the measured tracked tree with its revision.
  trackedTreeClean: z.boolean(),
  machine: z.strictObject({
    node: z.string(),
    platform: z.string(),
    cpu: z.string(),
    cores: z.number().int().positive(),
    memoryGb: z.number(),
  }),
  fixture: z.strictObject({
    day: z.string(),
    dayRunCount: z.number().int(),
    neighbouringRunCount: z.number().int(),
    operationMemberCount: z.number().int(),
    noteLines: z.number().int(),
    noteFiles: z.number().int(),
    noteBytes: z.number().int(),
    receiptCount: z.number().int(),
    seedMs: z.number(),
  }),
  measurements: z.array(z.strictObject({
    id: z.string(),
    label: z.string(),
    auditFinding: z.string(),
    // Omit duration when the finding is a count; zero milliseconds would invent a measurement.
    timing: z.strictObject({
      iterations: z.number().int().positive(),
      medianMs: z.number(),
      p95Ms: z.number(),
    }).optional(),
    counters: z.record(z.string(), z.number()),
    note: z.string(),
  })),
});
type Report = z.infer<typeof ReportSchema>;

export interface DashboardPerformanceStructuralCounters {
  readonly dayWireStatements: number;
  readonly rowPatchDayWireParses: number;
  readonly logsSpanEventParses: number;
  readonly logsFilesInScope: number;
  readonly runSnapshotStatements: number;
  readonly memberPreviewDeltaStatements: number;
}

export const DASHBOARD_PERFORMANCE_STRUCTURAL_BOUNDS = {
  dayWireStatements: 5_569,
  rowPatchDayWireParses: 0,
  logsSpanEventParses: 0,
  logsFilesInScope: 2,
  runSnapshotStatements: 13,
  memberPreviewDeltaStatements: 6,
} as const;

export function assertDashboardPerformanceStructuralBounds(
  actual: DashboardPerformanceStructuralCounters,
): void {
  const bounds = DASHBOARD_PERFORMANCE_STRUCTURAL_BOUNDS;
  const exact: readonly (keyof DashboardPerformanceStructuralCounters)[] = [
    "rowPatchDayWireParses",
    "logsSpanEventParses",
  ];
  for (const key of exact) {
    if (actual[key] !== bounds[key]) {
      throw new Error(`dashboard performance ${key} must equal ${String(bounds[key])}; measured ${String(actual[key])}`);
    }
  }
  const maximum: readonly (keyof DashboardPerformanceStructuralCounters)[] = [
    "dayWireStatements",
    "logsFilesInScope",
    "runSnapshotStatements",
    "memberPreviewDeltaStatements",
  ];
  for (const key of maximum) {
    if (actual[key] > bounds[key]) {
      throw new Error(`dashboard performance ${key} must be at most ${String(bounds[key])}; measured ${String(actual[key])}`);
    }
  }
}

function structuralCounters(measurements: Report["measurements"]): DashboardPerformanceStructuralCounters {
  const counter = (id: string, name: string): number => {
    const measurement = measurements.find((candidate) => candidate.id === id);
    if (measurement === undefined) throw new Error(`dashboard performance report is missing measurement ${id}`);
    const value = measurement.counters[name];
    if (value === undefined) throw new Error(`dashboard performance measurement ${id} is missing counter ${name}`);
    return value;
  };
  return {
    dayWireStatements: counter("day-wire", "sqliteStatements"),
    rowPatchDayWireParses: counter("row-patch", "dayWireSchemaParses"),
    logsSpanEventParses: counter("logs-section", "spanEventSchemaParses"),
    logsFilesInScope: counter("logs-section", "corpusFilesInScope"),
    runSnapshotStatements: counter("run-snapshot", "sqliteStatements"),
    memberPreviewDeltaStatements: counter("member-preview", "previewDeltaStatements"),
  };
}

function gitFacts(): { commit: string; trackedTreeClean: boolean } {
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const status = execFileSync(
    "git",
    ["status", "--porcelain", "--untracked-files=no"],
    { encoding: "utf8" },
  ).trim();
  return { commit, trackedTreeClean: status === "" };
}

function noteCorpus(fixture: PerfFixture): { files: number; lines: number; bytes: number } {
  const records = readTimelineRecords(fixture.database.authority.timelineEvents).records.filter(record => record.payload.kind === "note");
  return { files: records.length === 0 ? 0 : 1, lines: records.length, bytes: records.reduce((sum, record) => sum + Buffer.byteLength(JSON.stringify(record)), 0) };
}
function noteScopeForMeasuredRun(fixture: PerfFixture, runId: string): { files: number; lines: number } {
  const records = readTimelineRecords(fixture.database.authority.timelineEvents, 0, runId).records.filter(record => record.payload.kind === "note");
  return { files: records.length === 0 ? 0 : 1, lines: records.length };
}
function rejectedSpanScopeForMeasuredRun(fixture: PerfFixture, runId: string): { files: number; lines: number } {
  const records = readTimelineRecords(fixture.database.authority.timelineEvents, 0, runId).records.filter(record => record.payload.kind === "span");
  return { files: records.length === 0 ? 0 : 1, lines: records.length };
}

/* ── the self-check (finding 1) ──────────────────────────────────────────── */


function selfCheckStatementCounter(fixture: PerfFixture): void {
  assertStatementCounterObserves({
    prepareProbe: () => {
      fixture.database.authority.runs.get(fixture.runIds.measuredRun);
    },
  });
}

/* ── the five measurements ───────────────────────────────────────────────── */

type Patch = z.infer<typeof DashboardDayPatchSchema>;

/** One REAL single-row patch, taken off the projection's own change feed. */
function captureRowPatch(fixture: PerfFixture): Patch {
  let captured: Patch | undefined;
  const unsubscribe = fixture.projection.onChange((change) => {
    if (change.kind === "patch" && change.day === PERF_FIXTURE_PROFILE.day) captured = change.patch;
  });
  try {
    fixture.projection.refreshRun(fixture.runIds.measuredRun);
  } finally {
    unsubscribe();
  }
  if (captured === undefined) {
    throw new Error(
      `refreshing run ${fixture.runIds.measuredRun} emitted no single-row patch for `
      + `${PERF_FIXTURE_PROFILE.day}; the SSE fold cannot be measured against a patch nothing produced`,
    );
  }
  return captured;
}

function measure(fixture: PerfFixture, iterations: number): Report["measurements"] {
  const { day } = PERF_FIXTURE_PROFILE;
  const { measuredRun, operationRun, singleRun } = fixture.runIds;

  /* A — the whole day snapshot. */
  const dayWireTiming = timeIt(iterations, () => {
    fixture.projection.buildDashboardDayWire(day);
  });
  const dayWireCount = countSqliteStatements(() => fixture.projection.buildDashboardDayWire(day));
  const wire: DashboardDayWire = dayWireCount.value;
  if (wire.queueSurfaces.length !== PERF_FIXTURE_PROFILE.dayRunCount) {
    throw new Error(
      `the day wire served ${String(wire.queueSurfaces.length)} surfaces, not the declared `
      + `${String(PERF_FIXTURE_PROFILE.dayRunCount)}; every number below would be about a different day`,
    );
  }

  if (dayWireCount.count.statements === 0) {
    throw new Error(
      "the SQLite statement counter observed 0 statements while building the day wire; a bypassed "
      + "`DatabaseSync.prototype.prepare` patch would print `sqliteStatements 0` as if every query had "
      + "vanished — refusing to report a fabricated zero",
    );
  }

  /* B — one SSE row patch, folded by the client's own state function. */
  const patch = captureRowPatch(fixture);
  const patchTiming = timeIt(iterations, () => {
    applyDashboardDayPatch(wire, patch);
  });
  selfCheckDayWireParseSpy(wire);
  const patchParses = countDayWireParses(() => applyDashboardDayPatch(wire, patch));

  /* C — one logs GET. */
  const logsTiming = timeIt(iterations, () => {
    buildRunSection(fixture.runDetail, measuredRun, "logs");
  });
  selfCheckSpanEventParseSpy(fixture);
  const logsParseCount = countSpanEventParses(() => buildRunSection(fixture.runDetail, measuredRun, "logs"));
  const logsSection = logsParseCount.value;
  if (logsSection.section !== "logs") {
    throw new Error(
      `the logs section of ${measuredRun} came back as ${logsSection.section}; there is nothing to time`,
    );
  }
  if (logsSection.payload.notes.length === 0) {
    throw new Error(
      `run ${measuredRun} served an empty logs page; the logs scan would be timed over a run with no `
      + "notes, which is not the read the finding is about",
    );
  }
  const corpus = noteCorpus(fixture);
  const corpusInScope = noteScopeForMeasuredRun(fixture, measuredRun);
  const rejectedSpanScope = rejectedSpanScopeForMeasuredRun(fixture, measuredRun);
  const indexedSpanRows = fixture.runDetail.projection.runLogSnapshot(measuredRun).entries.length;

  /* D — the version-bump freeze, per run, over a five-run sample. */
  let sampleIndex = 0;
  const freezeTiming = timeIt(iterations * fixture.sampleRunIds.length, () => {
    buildRunDetail(fixture.runDetail, fixture.sampleRunIds[sampleIndex % fixture.sampleRunIds.length]);
    sampleIndex += 1;
  });
  const freezeCount = countSqliteStatements(() => buildRunDetail(fixture.runDetail, fixture.sampleRunIds[0]));

  /* E — the member preview, as the delta between a group row and a single row. */
  const groupRow = countSqliteStatements(() => fixture.projection.queueSurface(operationRun));
  const singleRow = countSqliteStatements(() => fixture.projection.queueSurface(singleRun));
  if (groupRow.value === undefined || singleRow.value === undefined) {
    throw new Error("the group or the control single row has no fold; the preview delta cannot be measured");
  }

  return [
    {
      id: "day-wire",
      label: "`buildDashboardDayWire` — the whole day snapshot",
      auditFinding: "P2 / P4",
      timing: dayWireTiming,
      counters: {
        rows: wire.queueSurfaces.length,
        sqliteStatements: dayWireCount.count.statements,
        sqliteStatementsPerRow: round(dayWireCount.count.statements / wire.queueSurfaces.length),
      },
      note: "one snapshot; the SSE hub builds the same payload again on every resnapshot",
    },
    {
      id: "row-patch",
      label: "`applyDashboardDayPatch` — one SSE single-row patch",
      auditFinding: "P1",
      timing: patchTiming,
      counters: {

        rowsAvailable: wire.queueSurfaces.length,
        dayWireSchemaParses: patchParses.parses,
      },
      note: "one row changed; `dayWireSchemaParses` is how many times that ONE call re-validated the "
        + "whole day (`rowsAvailable` rows) — 1 before D4, 0 after it, with the spy's liveness proved "
        + "separately so a zero is a measurement and not a broken instrument",
    },
    {
      id: "logs-section",
      label: "`buildRunSection(run, \"logs\")` — one logs GET",
      auditFinding: "P3",
      timing: logsTiming,
      counters: {
        notesServed: logsSection.payload.notes.length,

        corpusLinesAvailable: corpus.lines,
        corpusBytesAvailable: corpus.bytes,
        corpusFilesAvailable: corpus.files,
        corpusLinesInScope: corpusInScope.lines,
        corpusFilesInScope: corpusInScope.files,
        rejectedSpanLinesInScope: rejectedSpanScope.lines,
        rejectedSpanFilesInScope: rejectedSpanScope.files,
        spanEventSchemaParses: logsParseCount.parses,
        indexedSpanRowsExamined: indexedSpanRows,
      },
      note: "`corpus…Available` is the whole corpus, unchanged by D5; `corpus…InScope` is what "
        + "`noteLinesForRun` may open for THIS run, taken through the production "
        + "`runNotePartitionScope`. `rejectedSpan…InScope` is the span corpus the rejected L3 query parsed; "
        + "the live-checked `spanEventSchemaParses` is the replacement query's measured parse count",
    },
    {
      id: "run-snapshot",
      label: "`buildRunDetail(run)` — the current native snapshot, per run",
      auditFinding: "P3",
      timing: freezeTiming,
      counters: {
        sqliteStatements: freezeCount.count.statements,
        projectedDayMs: round(freezeTiming.medianMs * PERF_FIXTURE_PROFILE.dayRunCount),
      },
      note: `per RUN; reading every current run over this day snapshots ${String(PERF_FIXTURE_PROFILE.dayRunCount)} of `
        + "them, and `projectedDayMs` is that multiplication, not a measured total",
    },
    {
      id: "member-preview",
      label: "`queueSurface` — a 108-member operation vs a single row",
      auditFinding: "P2",
      counters: {
        operationRowStatements: groupRow.count.statements,
        singleRowStatements: singleRow.count.statements,
        previewDeltaStatements: groupRow.count.statements - singleRow.count.statements,
        members: PERF_FIXTURE_PROFILE.operationMemberCount,
      },
      note: "the delta is `#memberPreview`'s authority joins, paid on every day wire and every SSE "
        + "snapshot. Before D5 it walked EVERY member (getRun + latestCheckpoint) and then "
        + "`.slice(0, 3)`; it now joins only the members it can name, so the delta no longer scales "
        + "with `members`",
    },
  ];
}

/* ── rendering ───────────────────────────────────────────────────────────── */

function markdownTable(report: Report): string {
  const lines = [
    "| # | Path | Audit | median ms | p95 ms | Counters |",
    "|---|---|---|---|---|---|",
  ];
  for (const [index, measurement] of report.measurements.entries()) {
    const counters = Object.entries(measurement.counters)
      .map(([key, value]) => `${key} ${value.toLocaleString("en-US")}`)
      .join(" · ");
    const timing = measurement.timing === undefined
      ? ["—", "—"]
      : [measurement.timing.medianMs.toFixed(2), measurement.timing.p95Ms.toFixed(2)];
    lines.push(
      `| ${String(index + 1)} | ${measurement.label} | ${measurement.auditFinding} `
      + `| ${timing[0]} | ${timing[1]} | ${counters} |`,
    );
  }
  return lines.join("\n");
}

export function runDashboardBenchmark(): void {
  const argv = process.argv.slice(2);
  const iterationsFlag = argv.indexOf("--iterations");
  const iterations = iterationsFlag === -1
    ? 7
    : z.coerce.number().int().min(5).parse(argv[iterationsFlag + 1]);
  const jsonFlag = argv.indexOf("--json");
  const jsonPath = jsonFlag === -1 ? undefined : z.string().min(1).parse(argv[jsonFlag + 1]);

  const seedStarted = performance.now();
  const fixture = seedDashboardPerfFixture();
  const seedMs = round(performance.now() - seedStarted);
  try {
    // Finding 1: the counter must prove it can see a statement BEFORE this
    // harness reports any count taken through it.
    selfCheckStatementCounter(fixture);
    const corpus = noteCorpus(fixture);
    const git = gitFacts();
    const cpu = cpus();
    const report = ReportSchema.parse({
      measuredAt: new Date().toISOString(),
      commit: git.commit,
      trackedTreeClean: git.trackedTreeClean,
      machine: {
        node: process.version,
        platform: `${process.platform}-${process.arch}`,
        cpu: cpu[0]?.model ?? "unknown",
        cores: cpu.length,
        memoryGb: round(totalmem() / 1024 ** 3),
      },
      fixture: {
        day: PERF_FIXTURE_PROFILE.day,
        dayRunCount: fixture.seeded.dayRunCount,
        neighbouringRunCount: fixture.seeded.neighbouringRunCount,
        operationMemberCount: fixture.seeded.operationMemberCount,
        noteLines: fixture.seeded.noteLines,
        noteFiles: corpus.files,
        noteBytes: corpus.bytes,
        receiptCount: fixture.seeded.receiptCount,
        seedMs,
      },
      measurements: measure(fixture, iterations),
    });

    const summary = [
      "",
      `## Dashboard §7.4 baseline — ${report.commit.slice(0, 8)}${report.trackedTreeClean ? "" : " + UNCOMMITTED CHANGES"}`,
      "",
      `Fixture: ${report.fixture.dayRunCount.toLocaleString("en-US")} rows on ${report.fixture.day} `
      + `(one ${String(report.fixture.operationMemberCount)}-member operation), `
      + `${report.fixture.neighbouringRunCount.toLocaleString("en-US")} rows on three neighbouring days, `
      + `${report.fixture.noteLines.toLocaleString("en-US")} note lines in `
      + `${String(report.fixture.noteFiles)} files (${(report.fixture.noteBytes / 1024 / 1024).toFixed(2)} MB), `
      + `${String(report.fixture.receiptCount)} derived receipts. Seeded in ${String(report.fixture.seedMs)} ms.`,
      "",
      `Machine: ${report.machine.cpu} · ${String(report.machine.cores)} cores · `
      + `${String(report.machine.memoryGb)} GB · node ${report.machine.node} · ${report.machine.platform}.`,
      `Iterations: ${String(iterations)} measured after one discarded warm-up; a row with no duration `
      + "is a count-only finding.",
      "",
      markdownTable(report),
      "",
    ].join("\n");
    process.stdout.write(summary);

    if (jsonPath !== undefined) {
      writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
      process.stdout.write(`\nwrote ${jsonPath}\n`);
    } else {
      process.stdout.write(`\n${JSON.stringify(report, null, 2)}\n`);
    }
    assertDashboardPerformanceStructuralBounds(structuralCounters(report.measurements));
  } finally {
    fixture.close();
  }
}

const entryPath = process.argv[1];
if (entryPath !== undefined
  && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(entryPath))) {
  runDashboardBenchmark();
}
