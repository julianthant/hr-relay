import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, afterEach, describe, it } from "vitest";
import { createDebugEventWriter } from "../../../../src/backend/logs/debug-events.js";
import { createTimelineEmitter } from "../../../../src/backend/storage/events/timeline-emitter.js";
import { RunRecordSchema, type RunRecord } from "../../../../src/models/run/record.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { CONFIG_SNAPSHOT, NOW } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { createProfileFixtureSet, type BoundProfileStorageFixture } from "../../../support/helpers/admission-fixture.js";
import { AuthorityDatabase, doctorAuthorityStorage } from "../../../support/helpers/synthetic-storage-admission.js";

const profiles = createProfileFixtureSet();
const heldProfiles: BoundProfileStorageFixture[] = [];
afterAll(() => profiles.close());
afterEach(async () => {
  for (const profile of heldProfiles.splice(0)) await profile.close();
});
const clock = manualClock(new Date(NOW));
/** The whole-timeline cap the doctor used to refuse at: `timeline-doctor-payload-limit-exceeded: 16777216 bytes`. */
const OLD_WHOLE_TIMELINE_BYTES = 16 * 1024 * 1024;
const PAGE_ROWS = 500;

function run(index: number): RunRecord {
  return RunRecordSchema.parse({
    ...QUEUED_RUN,
    envelope: {
      ...QUEUED_RUN.envelope,
      runId: randomUUID(), itemId: randomUUID(), traceId: `pl-120000-${String(index).padStart(4, "0")}`,
      priority: "interactive", dryRun: true, resolvedInstance: { ucpath: "prod" },
      configSnapshotId: CONFIG_SNAPSHOT.configSnapshotId, configFingerprint: CONFIG_SNAPSHOT.fingerprint,
    },
  });
}

function rootEvent(record: RunRecord) {
  const e = record.envelope;
  return {
    t: "run.queued", kind: "run", ts: e.enqueuedAt, workflow: e.workflow,
    runId: e.runId, attempt: e.attempt, traceId: e.traceId, spanPath: e.traceId,
    itemId: e.itemId, shape: e.shape, priority: e.priority, dryRun: e.dryRun,
    actorId: "local-operator", title: "Redacted test run",
    descriptorVersion: e.descriptorVersion, contractFingerprint: e.contractFingerprint,
    resolvedInstance: e.resolvedInstance, configFingerprint: e.configFingerprint,
    configSnapshotId: e.configSnapshotId,
  };
}

function taskSpan(record: RunRecord, t: "span.started" | "span.ended", index: number) {
  const e = record.envelope;
  return {
    t, kind: "task", ts: NOW, workflow: e.workflow, runId: e.runId, attempt: e.attempt, traceId: e.traceId,
    spanPath: `${e.traceId}/searching#${String(index)}`, parentSpanPath: e.traceId,
    ...(t === "span.started" ? { name: "searching" } : { outcome: "done" }),
  };
}

const AUTHORITY_RECONSTRUCTION = {
  kind: "authority-reconstruction", repairedAt: NOW, sourceAuthorityGeneration: 0,
  sourceAuthorityFingerprint: "a".repeat(64), priorStreamBytes: 0, priorStreamSha256: "b".repeat(64),
} as const;

async function store(runs: readonly RunRecord[], write: (emit: (event: Readonly<Record<string, unknown>>) => void, database: AuthorityDatabase) => void) {
  const profile = await profiles.create(); heldProfiles.push(profile);
  const root = profile.stateRoot, authorityPath = profile.path;
  const database = AuthorityDatabase.open({ path: authorityPath, busyTimeoutMs: 500, migrationOwner: "timeline-volume-test" }, clock);
  try {
    database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
    for (const record of runs) database.authority.runs.enqueue(record);
    const emitter = createTimelineEmitter({ repository: database.authority.timelineEvents, clock, pid: 4242 });
    write((event) => emitter.emit(event), database);
  } finally {
    database.close();
  }
  const raw = new DatabaseSync(authorityPath, { readOnly: true });
  const totals = (() => {
    try {
      return raw.prepare(`SELECT sum(length(CAST(payload_json AS BLOB))) AS bytes,
        sum(kind NOT IN ('debug','note')) AS inspected FROM timeline_events`).get() as { bytes: number; inspected: number };
    } finally { raw.close(); }
  })();
  return {
    totals,
    doctor: () => doctorAuthorityStorage({
      stateRootTrustAnchor: root, stateRoot: root, authorityPath,
      backupDirectory: join(root, "backups", "authority"), busyTimeoutMs: 500,
    }, clock),
  };
}

describe("storage doctor on a long-lived timeline", () => {
  it("stays healthy and reconciles every run past the old 16 MiB timeline cap", async () => {
    const runs = Array.from({ length: PAGE_ROWS + 20 }, (_, index) => run(index));
    const f = await store(runs, (emit, database) => {
      for (const record of runs) emit(rootEvent(record));
      const debug = createDebugEventWriter({ repository: database.authority.timelineEvents, clock, build: "test", writeStderr() {} });
      for (let bytes = 0; bytes <= OLD_WHOLE_TIMELINE_BYTES; bytes += 60_000) {
        debug.emit({ category: "boot", phase: "failed", correlationId: randomUUID(), area: "diagnostic-retention",
          reason: "purge-failed", message: "m".repeat(60_000) });
      }
    });
    assert.ok(f.totals.bytes > OLD_WHOLE_TIMELINE_BYTES, String(f.totals.bytes));
    assert.ok(f.totals.inspected > PAGE_ROWS, String(f.totals.inspected));
    const report = await f.doctor();
    assert.equal(report.authority.state, "healthy");
    assert.deepEqual(report.spanAuthority, { state: "reconciled", streamRunCount: runs.length, liveRunCount: runs.length, deleted: [] });
  });

  it("replays more than a page of pre-root events against a repaired root", async () => {
    const record = run(0);
    const pairs = PAGE_ROWS / 2 + 10;
    const prepare = (endBeforeStart: boolean) => store([record], (emit) => {
      for (let index = 1; index <= pairs; index += 1) {
        emit(taskSpan(record, "span.started", index));
        emit(taskSpan(record, "span.ended", index));
      }
      if (endBeforeStart) emit(taskSpan(record, "span.ended", pairs + 1));
      emit({ ...rootEvent(record), repair: AUTHORITY_RECONSTRUCTION });
    });
    const clean = await prepare(false);
    assert.ok(clean.totals.inspected > PAGE_ROWS + 1, String(clean.totals.inspected));
    assert.deepEqual((await clean.doctor()).spanAuthority, { state: "reconciled", streamRunCount: 1, liveRunCount: 1, deleted: [] });
    const defect = (await (await prepare(true)).doctor()).spanAuthority;
    assert.equal(defect.state, "degraded");
    assert.match(JSON.stringify(defect), /ends before its matching start/u);
  });
});
