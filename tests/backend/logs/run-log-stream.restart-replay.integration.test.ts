import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { it } from "vitest";
import { createRunLogStreamStore } from "../../../src/backend/logs/run-log-stream.js";
import { createTimelineRepository } from "../../../src/backend/storage/sqlite/timeline-repository.js";
import { SQLITE_MIGRATIONS } from "../../../src/backend/storage/sqlite/migrations.js";
import { RunLogsStreamHub } from "../../../src/backend/transports/http/subscriptions/run-logs-stream.js";
import type { RunQueueProjection } from "../../../src/backend/runs/projections/run-queue-projection.js";
import { ConfirmedActionEventSchema, confirmedStepOccurrence } from "../../../src/models/events/confirmed-action.js";
import type { RunRecord } from "../../../src/models/run/record.js";

const RUN = "11111111-1111-4111-8111-111111111111", HASH = "a".repeat(64), AT = "2026-10-02T12:00:00.000Z";
const authority = { envelope: { runId: RUN, traceId: "fpo-120000-0002", attempt: 1, contractFingerprint: HASH } } as RunRecord;
const projection = { onChange: () => () => {}, cursor: () => "pc:1", generation: () => 1 } as unknown as RunQueueProjection;
function source(path: string, initialize: boolean) {
  const database = new DatabaseSync(path, { enableForeignKeyConstraints: false });
  if (initialize) for (const migration of SQLITE_MIGRATIONS) for (const sql of migration.statements) database.exec(sql);
  const repository = createTimelineRepository({ database, assertOwner: () => {}, read: work => work(), mutate: work => work().result });
  const store = createRunLogStreamStore(repository);
  const hub = new RunLogsStreamHub({ store, projection, readRun: () => ({ disposition: "live", run: authority }) });
  const append = (stream: string, sequence: number) => {
    const action = { runId: RUN, definitionFingerprint: HASH, nodeId: "first", taskId: "ucpath/read-write-fixture",
      attempt: 1, claimGeneration: 1, taskAttempt: 1, invocationId: "first-operation", occurrencePath: ["first"],
      logicalActionId: "read-field", occurrence: sequence, logicalSessionId: "local-session", state: "started" as const };
    const event = ConfirmedActionEventSchema.parse({ version: 1, kind: "trace", state: "started", eventId: `${stream}/${String(sequence)}`,
      workerId: "fixture-worker-1", workerStreamId: stream, sequence, traceId: authority.envelope.traceId,
      stepOccurrence: confirmedStepOccurrence(action), action, source: { kind: "headless", system: "service" }, occurredAt: AT, recordedAt: AT });
    repository.append({ schemaVersion: 1, eventId: randomUUID(), workflow: "person-lookup", scope: { kind: "run", runId: RUN },
      occurredAt: AT, recordedAt: AT, retentionDate: "2026-10-02", source: { kind: "native" }, payload: { kind: "note", note: {
        ts: AT, workflow: "person-lookup", pid: 1, runId: RUN, attempt: 1, traceId: authority.envelope.traceId,
        spanPath: "first", level: "step", message: "read", confirmedAction: event } } });
  };
  const catchUp = () => { for (let count = 0; count < 30; count++) { hub.poll(); if (!hub.stats().recovering) return; } throw new Error("catch-up-bound"); };
  return { database, repository, hub, append, catchUp, close: () => { hub.close(); database.close(); } };
}
it.each(["gap", "regression"] as const)("replays more than 4096 real retained streams after restart and authenticates a retired head before a %s", kind => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "run-log-heads-")), path = join(root, "timeline.db");
  let active = source(path, true);
  try {
    for (let stream = 0; stream < 4200; stream++) active.append(`stream-${stream}`, 1);
    active.catchUp();
    assert.equal(active.hub.stats().degraded, false); assert.equal(active.hub.stats().ordinal, 4200);
    active.close(); active = source(path, false); active.catchUp();
    assert.equal(active.hub.stats().degraded, false); assert.equal(active.hub.stats().ordinal, 4200);
    const connected = active.hub.connect({ runId: RUN });
    const snapshot = connected.initial.find(item => item.source === "run-logs" && item.type === "snapshot");
    assert.ok(snapshot?.source === "run-logs"); assert.equal(snapshot.snapshot?.events.length, 200);
    connected.close();
    active.append("stream-0", 2); active.hub.poll();
    assert.equal(active.hub.stats().degraded, false, "retired head is resynchronized from its authenticated predecessor");
    for (let stream = 4200; stream < 8400; stream++) active.append(`stream-${stream}`, 1);
    active.catchUp();
    active.append("stream-0", kind === "gap" ? 4 : 1); active.hub.poll();
    assert.equal(active.hub.stats().lastError, kind === "gap" ? "run-log-worker-sequence-gap" : "run-log-worker-sequence-regressed");
  } finally { active.close(); rmSync(root, { recursive: true, force: true }); }
});

it("authenticates mirrored predecessor columns when resynchronizing a retired stream", () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "run-log-head-corrupt-")), path = join(root, "timeline.db");
  const f = source(path, true);
  try {
    for (let stream = 0; stream < 4200; stream++) f.append(`stream-${stream}`, 1);
    f.catchUp();
    const triggers = f.database.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' AND tbl_name='timeline_events'").all();
    for (const trigger of triggers) {
      assert.equal(typeof trigger.name, "string");
      f.database.exec(`DROP TRIGGER ${String(trigger.name)}`);
    }
    f.database.prepare("UPDATE timeline_events SET recorded_at=? WHERE cursor=1").run("2026-10-02T13:00:00.000Z");
    for (const trigger of triggers) { assert.equal(typeof trigger.sql, "string"); f.database.exec(String(trigger.sql)); }
    f.append("stream-0", 2); f.hub.poll();
    assert.equal(f.hub.stats().lastError, "timeline-event-column-mismatch");
  } finally { f.close(); rmSync(root, { recursive: true, force: true }); }
});

it.each([0, 1000, 10000])("does bounded predecessor query work with %s unrelated retained streams", count => {
  const f = source(":memory:", true);
  let identityReads = 0;
  f.database.function("json_extract", { deterministic: true }, (json, path) => {
    if (path === "$.payload.note.confirmedAction.workerStreamId") identityReads += 1;
    let value: unknown = JSON.parse(String(json));
    for (const key of String(path).slice(2).split(".")) {
      if (value === null || typeof value !== "object") return null;
      value = Reflect.get(value, key);
    }
    return typeof value === "string" || typeof value === "number" ? value : null;
  });
  try {
    f.append("target", 1);
    for (let index = 0; index < count; index++) f.append(`unrelated-${String(index)}`, 1);
    f.append("target", 2);
    identityReads = 0;
    const heads = f.repository.confirmedActionHeads({ workerStreamIds: ["absent", "target", "target"], before: count + 3 });
    assert.equal(heads.length, 1);
    assert.equal(heads[0].cursor, count + 2);
    assert.ok(identityReads <= 2, `predecessor lookup evaluated ${String(identityReads)} unrelated identities`);
  } finally { f.close(); }
});
