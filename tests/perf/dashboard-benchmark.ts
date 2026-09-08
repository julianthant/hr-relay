/**
 * `npm run perf:dashboard` — the §7.4 measurement instrument.
 *
 * It seeds ONE deterministic world (`dashboard-fixture.ts`: 1,240 rows on one
 * day, a 108-member operation, 20,800 note lines, three neighbouring days) and
 * times the five hot paths the 2026-08-20 architecture audit named, through the
 * PRODUCTION functions the BFF calls — no browser, no HTTP, no re-implementation:
 *
 *   A  `buildDashboardDayWire(day)`          — audit P2/P4, the whole day snapshot
 *   B  `applyDashboardDayPatch(day, patch)`  — audit P1, one SSE row patch
 *   C  `buildRunSection(run, "logs")`        — audit P3, one logs GET
 *   D  `archiveSnapshots.snapshot(run)`      — audit P3, the version-bump freeze
 *   E  `queueSurface(operation)` vs a single — audit P2, the member preview
 *
 * Every timing is the median and p95 of `--iterations` measured runs after one
 * discarded warm-up. Every query count is exact and taken once, because the
 * seeded world is deterministic and a count that varied between iterations
 * would mean the measurement had a side effect.
 *
 * These are BEFORE numbers. Track D's D4/D5 re-run this same command against the
 * same seed, and the delta is the evidence those rows owe
 * (`ref frontend-backend-integration` §7.4, D264).
 */
import { execFileSync } from "node:child_process";
import { realpathSync, statSync, writeFileSync } from "node:fs";
import { cpus, totalmem } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { applyDashboardDayPatch } from "../../src/dashboard/client/day-state.js";
import {
  DashboardDayWireSchema,
  type DashboardDayWire,
} from "../../src/domain/dashboard/projection.js";
import type { DashboardDayPatchSchema } from "../../src/domain/dashboard/subscription.js";
import {
  listEventStreamFiles,
  readEventStreamLines,
  readScopedEventStreamLines,
  scopedEventStreamFiles,
} from "../../src/infra/events/jsonl-streams.js";
import { SpanEventWireSchema } from "../../src/events/types.js";
import { readTimelineRecords } from "../../src/infra/events/timeline-reader.js";
import { buildRunSection, runNotePartitionScope } from "../../src/server/dashboard/queries/run-detail.js";
import { PERF_FIXTURE_PROFILE, seedDashboardPerfFixture, type PerfFixture } from "./dashboard-fixture.js";
import { assertStatementCounterObserves, countSqliteStatements } from "./sqlite-statement-counter.js";

/* ── sampling ────────────────────────────────────────────────────────────── */

interface Timing {
  readonly iterations: number;
  readonly medianMs: number;
  /** Nearest-rank p95 over the samples — at small `iterations` this IS the slowest. */
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

/* ── the zod parse spy (audit P1) ────────────────────────────────────────── */

/**
 * Counts `DashboardDayWireSchema.parse` calls while `work` runs.
 *
 * The whole P1 finding was that a SINGLE-ROW patch re-validated the WHOLE day,
 * so the number that matters is not the milliseconds alone — it is the count,
 * and the thing counted is 1,240 rows wide. The spy installs an own property
 * that shadows zod's prototype method.
 *
 * **After D4 the honest answer is ZERO**, which is exactly the answer a broken
 * spy also gives — so this window may not assert its own result. Its liveness
 * is proved separately by `selfCheckDayWireParseSpy`, against a parse the
 * harness performs itself and therefore knows happened; only then is a zero
 * from this window reportable. Asserting `parses > 0` here, as this harness did
 * while the whole-day parse existed, would now be a check that can only fail.
 */
function countDayWireParses<Result>(work: () => Result): { readonly value: Result; readonly parses: number } {
  const schema = DashboardDayWireSchema as unknown as { parse: (input: unknown) => unknown };
  const original = schema.parse.bind(DashboardDayWireSchema);
  // Restore whatever was there — an OWN descriptor if zod defines `parse` per
  // instance, and nothing at all if it lives on the prototype. Blind-deleting
  // would strip the method itself in the first case, leaving every later parse
  // in this process broken.
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

/**
 * The parse window's own precondition, in the same shape as
 * `selfCheckStatementCounter`: it must observe a `DashboardDayWireSchema.parse`
 * this harness KNOWS it performed, before any zero taken through it is
 * reported. Without this, a spy that failed to install (a future zod defining
 * `parse` unwritably, a frozen schema object) would print `dayWireSchemaParses
 * 0` for the D4 row and read as the improvement rather than as a broken
 * instrument.
 */
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
  /**
   * Whether the TRACKED tree matches `commit`. Untracked files are excluded on
   * purpose: a git worktree carries an untracked `node_modules` symlink, and a
   * baseline that reported every worktree as dirty would say nothing.
   */
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
    /**
     * Absent for a measurement whose finding is a COUNT, not a duration. An
     * optional field rather than a zeroed one: `0.00 ms` in a baseline table
     * is a number somebody will later compare against.
     */
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
  readonly archiveFreezeStatements: number;
  readonly memberPreviewDeltaStatements: number;
}

export const DASHBOARD_PERFORMANCE_STRUCTURAL_BOUNDS = {
  dayWireStatements: 5_569,
  rowPatchDayWireParses: 0,
  logsSpanEventParses: 0,
  logsFilesInScope: 2,
  archiveFreezeStatements: 13,
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
    "archiveFreezeStatements",
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
    archiveFreezeStatements: counter("archive-freeze", "sqliteStatements"),
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
  const files = listEventStreamFiles(fixture.stateRoot, "notes");
  return {
    files: files.length,
    lines: readEventStreamLines(fixture.stateRoot, "notes").length,
    bytes: files.reduce((sum, file) => sum + statSync(file.path).size, 0),
  };
}

/**
 * The partitions ONE logs GET is allowed to open, taken through the production
 * decision function (`runNotePartitionScope`) rather than re-derived here — a
 * benchmark that re-implemented the rule would report the rule it wrote, not
 * the one the BFF applies.
 *
 * It is still a derived fact and not a syscall-level observation, for the
 * reason the baseline paragraph already gives: Node snapshots ESM named
 * imports of `node:fs` and no in-process counter can honestly watch that read.
 * `…Available` above is the whole corpus; `…InScope` is what the reader may
 * touch, and the gap between the two is the D5 finding stated as a count.
 */
function noteScopeForMeasuredRun(fixture: PerfFixture, runId: string): { files: number; lines: number } {
  const row = fixture.runDetail.projection.runFold(runId);
  const authority = fixture.runDetail.authority.getRun(runId);
  if (row === undefined || authority === undefined) {
    throw new Error(
      `run ${runId} has no fold or no authority record; the logs scope it bounds cannot be reported`,
    );
  }
  const scope = runNotePartitionScope(runId, row, authority);
  return {
    files: scopedEventStreamFiles(fixture.stateRoot, "notes", scope).length,
    lines: readScopedEventStreamLines(fixture.stateRoot, "notes", scope).length,
  };
}

function rejectedSpanScopeForMeasuredRun(fixture: PerfFixture, runId: string): { files: number; lines: number } {
  const row = fixture.runDetail.projection.runFold(runId);
  const authority = fixture.runDetail.authority.getRun(runId);
  if (row === undefined || authority === undefined) throw new Error(`run ${runId} has no span scope authority`);
  const scope = runNotePartitionScope(runId, row, authority);
  return {
    files: scopedEventStreamFiles(fixture.stateRoot, "spans", scope).length,
    lines: readScopedEventStreamLines(fixture.stateRoot, "spans", scope).length,
  };
}

/* ── the self-check (finding 1) ──────────────────────────────────────────── */

/**
 * The counting window's own precondition: it must observe a statement it
 * knows was executed, BEFORE this harness reports any count taken through it.
 * A bypassed `DatabaseSync.prototype.prepare` patch (a future Node routing
 * statements a different way, a runtime that freezes the prototype) would
 * otherwise print `sqliteStatements 0` for every row below — a check that
 * cannot fail, and exactly the kind this repository bans.
 */
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
  // The day-wire path is the one this section leads with (P2/P4) — assert its
  // own counter directly, not only through the shared self-check probe, so a
  // regression specific to THIS call site cannot hide behind a passing probe
  // taken on a different query.
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
      `run ${measuredRun} served an empty logs page; the P3 scan would be timed over a run with no `
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
    fixture.archiveSnapshots.snapshot(fixture.sampleRunIds[sampleIndex % fixture.sampleRunIds.length]);
    sampleIndex += 1;
  });
  const freezeCount = countSqliteStatements(() => fixture.archiveSnapshots.snapshot(fixture.sampleRunIds[0]));

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
        // A fixture fact (how many rows the seeded day wire holds), not an
        // observation of how many rows `applyDashboardDayPatch` revalidated —
        // it would print the same 1,240 after D4 scopes the patch, unlike
        // `dayWireSchemaParses` below, which really is counted per call.
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
        // The corpus's SIZE (a fixture fact from `noteCorpus`, taken independently
        // of the timed call), not an in-process OBSERVATION of what
        // `noteLinesForRun` actually read — Node snapshots ESM named imports of
        // `node:fs`, so there is no seam to wrap the reader through the way
        // `countSqliteStatements` wraps `DatabaseSync.prototype.prepare`. As long
        // as `noteLinesForRun` stays unscoped (true of this commit — read the
        // source, not this counter, to re-confirm) these equal what it reads; once
        // D5 scopes the reader they would print the same numbers regardless, which
        // is exactly why they are named `…Available` and not `…Scanned`/`…Read`.
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
      id: "archive-freeze",
      label: "`archiveSnapshots.snapshot(run)` — the version-bump freeze, per run",
      auditFinding: "P3",
      timing: freezeTiming,
      counters: {
        sqliteStatements: freezeCount.count.statements,
        projectedDayMs: round(freezeTiming.medianMs * PERF_FIXTURE_PROFILE.dayRunCount),
      },
      note: `per RUN; a version bump over this day freezes ${String(PERF_FIXTURE_PROFILE.dayRunCount)} of `
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
    assertDashboardPerformanceStructuralBounds(structuralCounters(report.measurements));

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
  } finally {
    fixture.close();
  }
}

const entryPath = process.argv[1];
if (entryPath !== undefined
  && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(entryPath))) {
  runDashboardBenchmark();
}
