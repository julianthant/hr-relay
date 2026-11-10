import { runSettlementColumns } from "../../../../src/backend/storage/sqlite/run-settlement-row.js";
import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parse } from "csv-parse/sync";
import { createActivityPopulationService, ActivityPopulationError } from "../../../../src/backend/runs/queries/activity-population.js";
import { createRunSearchIndex } from "../../../../src/backend/storage/sqlite/run-search-index.js";
import { runRecordColumns } from "../../../../src/backend/storage/sqlite/run-record-row.js";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-database-admission.js";
import { runRecordOf, uuidOf, traceOf, failureRecordOf, cleanReceiptOf, receiptWithWarningsOf } from "../../../support/helpers/backend/dashboard-harness.js";
import { CONFIG_SNAPSHOT } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { RunResultRecordSchema, deriveRunResultDigest, deriveTerminalDependencyDigest, createRunTerminalEvidenceResult, deriveTerminalFailureDigest } from "../../../../src/models/run/result.js";
import { testRunService } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { historyWorld, historyClock, HISTORY_NOW } from "../../../support/helpers/storage/transaction-history-fixture.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { RunCompletionSchema } from "../../../../src/models/run/completion.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { createTransactionHistory } from "../../../../src/backend/storage/sqlite/transaction-history.js";
import { RunEvidenceReceiptSchema } from "../../../../src/models/trust/evidence.js";

import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";
import { queryActivitySummaries } from "../../../../src/backend/runs/queries/activity-summaries.js";
import { TimelineAppendSchema } from "../../../../src/models/events/timeline.js";

const range = { from: "2026-10-01", to: "2026-10-01" };
const at = "2026-10-01T12:00:00.000Z";
const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const dispose of cleanup.splice(0)) await dispose(); });
async function fixture() {
  const profile = await createBoundProfileFixture();
  const { path } = profile;
  const clock = manualClock(new Date(at));
  const database = AuthorityDatabase.open({ path, busyTimeoutMs: 500, migrationOwner: "activity-population-test" }, clock);
  database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
  const raw = new DatabaseSync(path);
  raw.exec("PRAGMA foreign_keys=ON");
  const search = createRunSearchIndex(raw);
  search.installTracking();
  const publish = () => {
    let state = search.rebuild({ restart: true, limit: 500 }, database.getMeta().authorityGeneration, at);
    while (state.state === "building") state = search.rebuild({ restart: false, limit: 500 }, database.getMeta().authorityGeneration, at);
  };
  const add = (seed: number, options: Omit<Parameters<typeof runRecordOf>[0], "seed"> = {}, failureCode = "FIXTURE_FAILURE") => {
    const lifecycle = options.lifecycle;
    const requestedEnqueue = options.enqueuedAt;
    const missingTiming = lifecycle !== undefined && typeof lifecycle === "object" && lifecycle !== null && "endedAt" in lifecycle && typeof lifecycle.endedAt === "string" && lifecycle.endedAt < at;
    const isCancelled = lifecycle !== undefined && typeof lifecycle === "object" && lifecycle !== null && "outcome" in lifecycle && lifecycle.outcome === "cancelled";
    const source = runRecordOf({ seed, enqueuedAt: missingTiming ? "2026-10-01T11:00:00.000Z" : at, dryRun: true, displayName: `Person ${seed}`, ...options, ...(isCancelled ? { lifecycle: { state: "queued" } } : {}) });
    let record = RunRecordSchema.parse({ ...source, envelope: { ...source.envelope, enqueuedAt: requestedEnqueue ?? at } });
    let result;
    let failure;
    if (record.lifecycle.state === "terminal" && record.lifecycle.outcome === "done") {
      const output = { schemaHash: "a".repeat(64), value: {} };
      result = RunResultRecordSchema.parse({ runId: record.envelope.runId, workflowId: record.envelope.workflow, attempt: 1,
        descriptorVersion: record.envelope.descriptorVersion, contractFingerprint: record.envelope.contractFingerprint,
        configFingerprint: record.envelope.configFingerprint, configSnapshotId: record.envelope.configSnapshotId,
        resultSchemaHash: output.schemaHash, result: output, resultDigest: deriveRunResultDigest(output),
        dependencies: [], dependencyDigest: deriveTerminalDependencyDigest([]), createdAt: record.lifecycle.endedAt });
      record = RunRecordSchema.parse({ ...record, completion: { ...record.completion, resultDigest: result.resultDigest } });
    }
    if (record.lifecycle.state === "terminal" && record.lifecycle.outcome === "failed") {
      const terminalLifecycle = record.lifecycle;
      const completion = RunCompletionSchema.parse(record.completion);
      failure = failureRecordOf({ seed, code: failureCode, workflow: record.envelope.workflow });
      record = RunRecordSchema.parse({ ...record, lifecycle: { ...record.lifecycle, errorSummary: failure.summary, diagnosticSafetyVersion: failure.diagnosticSafetyVersion } });
      result = createRunTerminalEvidenceResult(record, { kind: "failed-evidence", failureDigest: deriveTerminalFailureDigest(failure),
        authorization: { kind: "failed", runId: record.envelope.runId, workflowId: record.envelope.workflow,
          attempt: record.envelope.attempt, descriptorVersion: record.envelope.descriptorVersion, contractFingerprint: record.envelope.contractFingerprint,
          expectedVersion: completion.expectedVersion, claim: completion.claim, authorizedAt: terminalLifecycle.endedAt, failureId: failure.failureId } });

    }
    const row = runRecordColumns(record);
    raw.prepare(`INSERT INTO runs(${Object.keys(row).join(",")}) VALUES(${Object.keys(row).map(() => "?").join(",")})`).run(...Object.values(row));
    if (failure !== undefined) raw.prepare("INSERT INTO run_failures(id,run_id,fingerprint,code,payload_json,resolution_json,resolution_version,created_at) VALUES(?,?,?,?,?,?,1,?)")
        .run(failure.failureId, failure.runId, failure.fingerprint, failure.code, canonicalJsonStringify(failure), '{"status":"unresolved","version":1}', failure.occurredAt);
    if (result !== undefined) {
      const settlement = runSettlementColumns(record, result);
      raw.prepare(`INSERT INTO run_results (${Object.keys(settlement).join(",")}) VALUES (${Object.keys(settlement).map(() => "?").join(",")})`)
        .run(...Object.values(settlement));
    }
    if (isCancelled) {
      publish();
      const outcome = testRunService(database, clock).transition({ commandId: uuidOf(seed + 1000), runId: record.envelope.runId, expectedVersion: record.version, lifecycle });
      expect(outcome.state).toBe("applied");
    }
    return record;
  };
  const input = { database, clock, descriptors: { resolve: () => undefined }, ledger: createTransactionHistory(database.authority), timeZone: "UTC" };
  const service = createActivityPopulationService(input);
  cleanup.push(async () => { raw.close(); database.close(); await profile.close(); });
  return { database, clock, raw, add, publish, service, input };
}
const done = (ms: number) => ({ state: "terminal" as const, outcome: "done" as const, endedAt: new Date(Date.parse(at) + ms).toISOString() });
const cancelled = (ms: number) => ({ state: "terminal" as const, outcome: "cancelled" as const, endedAt: new Date(Date.parse(at) + ms).toISOString() });

describe("selected Analytics population", () => {
  it("keeps zero, missing, successful-root timing and terminal duration separate with explicit evidence", async () => {
    const f = await fixture();
    f.add(1, { lifecycle: done(0) });
    f.add(2, { lifecycle: done(1200) });
    f.add(3, { lifecycle: done(-1) });
    f.add(4, { lifecycle: cancelled(10000) });
    const failure = failureRecordOf({ seed: 10, code: "FIXTURE_FAILURE" });
    f.add(10, { lifecycle: { state: "terminal", outcome: "failed", endedAt: "2026-10-01T12:00:05.000Z", failureId: failure.failureId } });
    f.add(5, { lifecycle: done(90000), parentSeed: 1 });
    f.add(6, { workflow: "missing-timing", lifecycle: done(-1) });
    f.add(7, { workflow: "no-success" });
    f.add(8, { workflow: "separations" });
    f.add(9, { workflow: "separations", shape: "operation-member", parentSeed: 8 });
    f.publish();
    const selected = f.service.read(range);
    expect(selected.population).toHaveLength(9);
    expect(selected.successfulTiming).toEqual([
      { workflowId: "missing-timing", totalMs: null, measured: 0, unmeasured: 1 },
      { workflowId: "no-success", totalMs: null, measured: 0, unmeasured: 0 },
      { workflowId: "person-lookup", totalMs: 1200, measured: 2, unmeasured: 1 },
      { workflowId: "separations", totalMs: null, measured: 0, unmeasured: 0 },
    ]);
    expect(selected.report.workflows.map(row => ({ workflowId: row.workflowId, typicalTime: row.typicalTime, needsAttention: row.needsAttention }))).toEqual([
      { workflowId: "missing-timing", needsAttention: 0, typicalTime: { measure: "successful-root-run-mean", measuredRuns: 0, unmeasuredRuns: 1, meanMs: { state: "absent", reason: "no successful root run in range carries a duration" } } },
      { workflowId: "no-success", needsAttention: 0, typicalTime: { measure: "successful-root-run-mean", measuredRuns: 0, unmeasuredRuns: 0, meanMs: { state: "absent", reason: "no successful root run in range carries a duration" } } },
      { workflowId: "person-lookup", needsAttention: 1, typicalTime: { measure: "successful-root-run-mean", measuredRuns: 2, unmeasuredRuns: 1, meanMs: { state: "present", value: 600 } } },
      { workflowId: "separations", needsAttention: 0, typicalTime: { measure: "successful-root-run-mean", measuredRuns: 0, unmeasuredRuns: 0, meanMs: { state: "absent", reason: "no successful root run in range carries a duration" } } },
    ]);
    expect(selected.report.failures[0].sentence).toBe("This failure code is not in the current catalog. Review the recorded local evidence.");
    expect(selected.report.durations.totalMs).toBe(106200);
    expect(selected.report.durations.measuredRuns).toBe(5);
    expect(selected.report.durations.unmeasuredRuns).toBe(2);
    expect(selected.report.people).toMatchObject({ state: "absent", unavailableRows: 2 });
    expect(selected.population.every(row => row.readback === null)).toBe(true);
    expect(JSON.stringify(selected.population)).not.toContain("identity");
    expect(f.service.readSelected(range, selected.snapshot.token, { metric: "failed", page: 0 }).browse?.rows.map(row => row.runId)).toEqual([uuidOf(10)]);
    const browse = f.service.readSelected(range, selected.snapshot.token, { metric: "timed", page: 0 }).browse;
    expect(browse?.rows.map(row => row.runId)).toEqual([uuidOf(1), uuidOf(2)]);
  });

  it("serves a failed step, a mixed-outcome day and the median duration", async () => {
    const f = await fixture();
    const searching = personLookupDescriptor.timeline.find(category => category.label === "Search for person");
    const nodeId = searching?.nodes[0]?.id;
    expect(nodeId).toBeTruthy();
    if (nodeId === undefined) throw new Error("person lookup search step has no node");
    const day2 = "2026-10-02T12:00:00.000Z";
    f.add(43, { lifecycle: done(1000) });
    const failure = failureRecordOf({ seed: 40, code: "SESSION_LOST" });
    const failed = f.add(40, { lifecycle: { state: "terminal", outcome: "failed", endedAt: new Date(Date.parse(at) + 4000).toISOString(), failureId: failure.failureId } }, "SESSION_LOST");
    f.add(42, { lifecycle: { state: "parked-gate", gateId: "operator-review", parkedAt: at, resumeAt: nodeId } });
    f.add(41, { enqueuedAt: day2, lifecycle: { state: "terminal", outcome: "done", endedAt: new Date(Date.parse(day2) + 3000).toISOString() } });
    f.add(44, { enqueuedAt: day2, lifecycle: { state: "terminal", outcome: "done", endedAt: new Date(Date.parse(day2) + 9000).toISOString() } });
    f.publish();
    const spanPath = `${traceOf(40)}/${nodeId}#1.1`;
    const startedAt = new Date(Date.parse(at) + 1000).toISOString();
    const endedAt = new Date(Date.parse(at) + 4000).toISOString();
    const span = { workflow: "person-lookup", pid: 1, runId: failed.envelope.runId, attempt: 1, traceId: failed.envelope.traceId, spanPath };
    for (const [seed, event] of [[9100, { t: "span.started", kind: "task", name: "SESSION_LOST", ts: startedAt, ...span }], [9101, { t: "span.ended", kind: "task", outcome: "failed", ts: endedAt, ...span }]] as const) {
      f.database.authority.timelineEvents.append(TimelineAppendSchema.parse({
        schemaVersion: 1, eventId: uuidOf(seed), workflow: "person-lookup", scope: { kind: "run", runId: failed.envelope.runId },
        occurredAt: event.ts, recordedAt: event.ts, retentionDate: "2026-10-01", source: { kind: "native" },
        payload: { kind: "span", event },
      }));
    }
    const report = queryActivitySummaries(f.database, { from: "2026-10-01", to: "2026-10-02", generatedAt: at }, {
      descriptors: { resolve: workflow => workflow === "person-lookup" ? personLookupDescriptor : undefined },
      ledger: { foldActivityRange: () => ({ systems: [] }) },
      timeZone: "UTC",
    });
    expect(report.outcomeSplit).toEqual({ done: 3, failed: 1, attention: 1 });
    expect(report.days).toEqual([
      { day: "2026-10-01", runs: 3, outcomes: { done: 1, failed: 1, attention: 1 }, typicalTime: { measuredRuns: 2, medianMs: { state: "present", value: 1000 } } },
      { day: "2026-10-02", runs: 2, outcomes: { done: 2, failed: 0, attention: 0 }, typicalTime: { measuredRuns: 2, medianMs: { state: "present", value: 3000 } } },
    ]);
    expect(report.typicalMedian).toEqual({ measuredRuns: 4, medianMs: { state: "present", value: 3000 } });
    expect(report.durations.medianMs).toEqual({ state: "present", value: 3000 });
    expect(report.workflows.map(row => row.failedAt)).toEqual([[{ state: "known", nodeId, title: "Search for person", runs: 1 }]]);
  });

  it("keeps failure codes distinct per workflow with catalog prose and registered or absent labels", async () => {
    const f = await fixture();
    for (const [seed, workflow] of [[20, "person-lookup"], [21, "retired-workflow"]] as const) {
      const failure = failureRecordOf({ seed, code: "FIXTURE_FAILURE" });
      f.add(seed, { workflow, lifecycle: { state: "terminal", outcome: "failed", endedAt: at, failureId: failure.failureId } }, "INTERNAL_FAILURE");
    }
    f.publish();
    const report = createActivityPopulationService({ ...f.input, descriptors: { resolve: workflow => workflow === "person-lookup" ? personLookupDescriptor : undefined } }).read(range).report;
    expect(report.failures).toEqual(["person-lookup", "retired-workflow"].map((workflowId, index) => ({ workflowId,
      code: "INTERNAL_FAILURE", sentence: "Relay could not complete this request. Review the recorded local evidence before trying again.", runs: 1, transient: 0,
      sample: [uuidOf(index + 20)], registration: workflowId === "person-lookup"
        ? { state: "registered", label: "Person Lookup", code: "pl", categoryId: "search" }
        : { state: "unregistered", reason: `workflow ${workflowId} is no longer registered; its label and category are unavailable` } })));
    expect(report.workflows.map(row => row.needsAttention)).toEqual([1, 1]);
  });

  it("pages the full range and browses exact metrics, search, sorting and selected run membership", async () => {
    const f = await fixture();
    for (let seed = 1; seed <= 506; seed++) f.add(seed);
    f.add(507, { lifecycle: done(1000), displayName: "Zebra 10" });
    f.add(508, { lifecycle: done(2000), displayName: "Zebra 2" });
    f.add(509, { lifecycle: done(-1), displayName: "Zebra 1" });
    f.add(510, { lifecycle: { state: "terminal", outcome: "interrupted", endedAt: at } });
    f.publish();
    const selected = f.service.read(range);
    expect(selected.population).toHaveLength(510);
    expect(selected.report.statuses.find(row => row.status === "queued")?.sample.length).toBeLessThan(506);
    const outstanding = f.service.readSelected(range, selected.snapshot.token, { metric: "outstanding", page: 25 }).browse;
    expect(outstanding).toMatchObject({ total: 507, totalMatches: 507, start: 500 });
    expect(outstanding?.rows).toHaveLength(7);
    expect(outstanding?.rows.at(-1)?.status).toBe("blocked");
    const request = { metric: "completed", page: 0, query: "  ZEBRA  ", sort: { column: "name", direction: "ascending" }, run: uuidOf(508) };
    const browse = f.service.readSelected(range, selected.snapshot.token, request).browse;
    expect(browse?.rows.map(row => row.title)).toEqual(["Zebra 1", "Zebra 2", "Zebra 10"]);
    expect(browse?.run?.runId).toBe(uuidOf(508));
    expect(browse?.identity).toMatchObject({ ...range, token: selected.snapshot.token, browse: request });
    const descending = f.service.readSelected(range, selected.snapshot.token, { metric: "completed", page: 0, sort: { column: "duration", direction: "descending" } }).browse;
    expect(descending?.rows.map(row => row.durationMs)).toEqual([2000, 1000, null]);
    const ascending = f.service.readSelected(range, selected.snapshot.token, { metric: "completed", page: 0, sort: { column: "duration", direction: "ascending" } }).browse;
    expect(ascending?.rows.map(row => row.durationMs)).toEqual([1000, 2000, null]);
    expect(ascending?.identity.digest).not.toBe(descending?.identity.digest);
    expect(f.service.readSelected(range, selected.snapshot.token, { metric: "completed", page: 0, query: `zebra ${uuidOf(508)}` }).browse?.rows).toHaveLength(1);
    for (const invalid of [{ metric: "outstanding", page: 26 }, { metric: "completed", page: 0, run: uuidOf(1) }, { metric: "completed", page: 0, workflow: "absent" }, { metric: "completed", page: -1 }, { metric: "completed", page: 0, query: 1 }, { metric: "other", page: 0 }]) expect(() => f.service.readSelected(range, selected.snapshot.token, invalid)).toThrow(ActivityPopulationError);
    expect(f.service.readSelected(range, selected.snapshot.token, { metric: "failed", page: 0 }).browse?.total).toBe(0);
  });

  it("exports the exact complete snapshot and refuses population-only rename with unchanged aggregates", async () => {
    const f = await fixture(); const record = f.add(1, { displayName: "=Formula" }); f.publish();
    const selected = f.service.read(range);
    const exported = f.service.exportSelected(range, selected.snapshot.token);
    expect(exported.selection).toEqual(selected);
    expect(exported.csv).toContain("'=Formula");
    const rows: string[][] = parse(exported.csv, { relax_column_count: true, skip_empty_lines: true });
    expect(rows.some(row => row[0] === record.envelope.runId && row[2] === "'=Formula")).toBe(true);
    const changed = runRecordColumns({ ...record, displayName: "Renamed" });
    f.raw.prepare("UPDATE runs SET lifecycle_json=? WHERE id=?").run(changed.lifecycle_json, record.envelope.runId);
    f.publish();
    const current = f.service.read(range);
    expect(current.report).toEqual(selected.report);
    expect(current.snapshot.populationDigest).not.toBe(selected.snapshot.populationDigest);
    expect(() => f.service.exportSelected(range, selected.snapshot.token)).toThrow("The selected Analytics population has changed");
  });

  it("keeps summary, workflow, population and export readback counts bound to verified receipts", async () => {
    const f = await fixture();
    for (let seed = 1; seed <= 4; seed++) f.add(seed, { lifecycle: done(1000) });
    const partial = RunEvidenceReceiptSchema.parse({ ...cleanReceiptOf({ seed: 4 }), confidence: "partial", result: "partial" });
    for (const receipt of [cleanReceiptOf({ seed: 1 }), receiptWithWarningsOf({ seed: 2, summaries: ["Synthetic warning"] }), partial]) {
      f.raw.prepare("INSERT INTO run_receipts(id,run_id,settlement_version,workflow,attempt,result,confidence,failure_id,payload_json,created_at) VALUES(?,?,(SELECT settlement_version FROM run_results WHERE run_id=?),?,?,?,?,NULL,?,?)")
        .run(receipt.receiptId, receipt.runId, receipt.runId, receipt.workflowId, receipt.attempt, receipt.result, receipt.confidence, canonicalJsonStringify(receipt), receipt.generatedAt);
    }
    f.publish();
    const selected = f.service.read(range);
    expect(selected.population.map(row => [row.readback, row.receiptResult, row.warningCount])).toEqual([[true, "verified-done", 0], [false, "done-with-warnings", 1], [null, null, null], [false, "partial", 0]]);
    const completion = { readBack: 1, warnings: 1, warningsUnknown: 2 };
    expect(selected.report.completion).toEqual(completion);
    expect(selected.report.workflows).toHaveLength(1);
    expect(selected.report.workflows[0]?.completion).toEqual(completion);
    expect(selected.report.completion.readBack).toBe(selected.population.filter(row => row.status === "done" && row.readback === true).length);
    const exported = f.service.exportSelected(range, selected.snapshot.token);
    expect(exported.selection).toEqual(selected);
    const rows: string[][] = parse(exported.csv, { relax_column_count: true, skip_empty_lines: true });
    expect(rows.find(row => row[0] === "Read back")).toEqual(["Read back", "1"]);
    expect(rows.find(row => row[0] === "Warnings")).toEqual(["Warnings", "1"]);
    expect(rows.find(row => row[0] === "Warnings unread")).toEqual(["Warnings unread", "2"]);
    expect(rows.find(row => row[0] === "person-lookup")?.slice(4, 8)).toEqual(["4", "1", "1", "2"]);
    expect(rows.filter(row => selected.population.some(run => run.runId === row[0])).map(row => [row[0], row[8], row[11], row[12]])).toEqual([
      [uuidOf(1), "true", "verified-done", "0"], [uuidOf(2), "false", "done-with-warnings", "1"],
      [uuidOf(3), "Unavailable", "Unavailable", "Unavailable"], [uuidOf(4), "false", "partial", "0"],
    ]);
  });

  it("keeps independently confirmed production and test transactions separate from runs", async () => {
    const f = await historyWorld(); cleanup.push(async () => await f.dispose());
    f.commit(1, { confirmedAt: HISTORY_NOW, instance: "prod" });
    f.commit(2, { confirmedAt: HISTORY_NOW, instance: "test" });
    const service = createActivityPopulationService({ database: f.database, clock: historyClock, descriptors: { resolve: () => undefined }, ledger: f.history });
    const selected = service.read({ from: "2026-09-09", to: "2026-09-09" });
    expect(selected.report.ledger.systems).toEqual([{ system: "ucpath", entries: 2, prod: 1, test: 1 }]);
    expect(selected.population).toHaveLength(0);
    expect(service.exportSelected({ from: "2026-09-09", to: "2026-09-09" }, selected.snapshot.token).csv).toContain("ucpath,2,1,1");
  });

  it("refuses tampering, range/source/generation changes, expiry and process recreation", async () => {
    const f = await fixture(); f.add(1); f.publish();
    const selected = f.service.read(range);
    for (const token of [undefined, null, `${selected.snapshot.token}x`, selected.report.snapshot.token]) expect(() => f.service.readSelected(range, token)).toThrow(expect.objectContaining({ code: "ACTIVITY_SNAPSHOT_INVALID_OR_EXPIRED" }));
    expect(() => f.service.readSelected({ ...range, to: "2026-10-02" }, selected.snapshot.token)).toThrow(expect.objectContaining({ code: "ACTIVITY_SNAPSHOT_STALE_OR_SELECTION_MISMATCH" }));
    expect(() => f.service.read({ from: "bad", to: range.to })).toThrow(ActivityPopulationError);
    expect(() => createActivityPopulationService(f.input).exportSelected(range, selected.snapshot.token)).toThrow(expect.objectContaining({ code: "ACTIVITY_SNAPSHOT_INVALID_OR_EXPIRED" }));
    const spy = vi.spyOn(f.database, "getSourceDatabaseIdentity").mockReturnValue("b".repeat(64));
    expect(() => f.service.readSelected(range, selected.snapshot.token)).toThrow(expect.objectContaining({ code: "ACTIVITY_SNAPSHOT_STALE_OR_SELECTION_MISMATCH" })); spy.mockRestore();
    f.database.authority.runs.enqueue(runRecordOf({ seed: 2, enqueuedAt: at, dryRun: true }));
    expect(() => f.service.readSelected(range, selected.snapshot.token)).toThrow(expect.objectContaining({ code: "ACTIVITY_SNAPSHOT_STALE_OR_SELECTION_MISMATCH" }));
    const fresh = f.service.read(range); f.clock.advanceWall(15 * 60_000);
    expect(() => f.service.exportSelected(range, fresh.snapshot.token)).toThrow(expect.objectContaining({ code: "ACTIVITY_SNAPSHOT_INVALID_OR_EXPIRED" }));
  });
});
