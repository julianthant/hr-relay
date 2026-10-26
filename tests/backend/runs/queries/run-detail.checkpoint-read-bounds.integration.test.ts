import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { afterEach, it } from "vitest";
import { buildRunDetail, type RunDetailQueryDeps } from "../../../../src/backend/runs/queries/run-detail.js";
import { RunCheckpointRecordSchema } from "../../../../src/models/workflow/checkpoint.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { HASH_A } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { makeWorld, queuedEventOf, runRecordOf, uuidOf, type DashboardWorld } from "../../../support/helpers/backend/dashboard-harness.js";
import { assertStatementCounterObserves, countSqliteStatements } from "../../../perf/sqlite-statement-counter.js";
import { readTimelineRecords } from "../../../../src/backend/storage/events/timeline-reader.js";
import { TimelinePageRequestSchema } from "../../../../src/models/events/timeline.js";

const worlds: DashboardWorld[] = [];
afterEach(() => { for (const world of worlds.splice(0)) world.dispose(); });

it("keeps checkpoint reads fixed as timeline nodes and checkpoint executions grow", () => {
  const w = makeWorld();
  worlds.push(w);
  queuedEventOf(w, { seed: 1 });
  for (const attempt of [2, 3]) {
    const source = runRecordOf({ seed: attempt + 1, attempt });
    w.database.authority.runs.enqueue(RunRecordSchema.parse({ ...source, envelope: { ...source.envelope, itemId: uuidOf(5001) } }));
  }
  w.authority.put(runRecordOf({ seed: 1, lifecycle: { state: "terminal", outcome: "done", endedAt: w.clock.now().toISOString() } }));
  const checkpoints = w.database.authority.runCheckpoints;
  const nodes = [{ id: "subject", label: "Subject" }];
  const deps: RunDetailQueryDeps = {
    runReader: w.runReader, timeline: w.timeline, stateRoot: w.stateRoot, projection: w.projection,
    authority: { ...w.authority,
      listCheckpoints: (workflow, item) => checkpoints.listByItem(workflow, item),
      latestCheckpoint: (workflow, item, node) => checkpoints.latest(workflow, item, node),
    },
    descriptors: { resolve: () => ({ version: 1, contractFingerprint: HASH_A, subjectProjection: { nodeId: "subject", fieldPath: "name" }, timeline: [{ key: "read", label: "Read", nodes }] }) },
  };
  function store(nodeId: string, attempt: number, claimGeneration: number, runSeed = attempt + 1): void {
    checkpoints.insert(RunCheckpointRecordSchema.parse({
      workflowId: "person-lookup", itemId: uuidOf(5001), nodeId, attempt, claimGeneration, runId: uuidOf(runSeed),
      output: { schemaHash: HASH_A, value: { name: `Name ${String(attempt)}.${String(claimGeneration)}` } },
      descriptorVersion: 1, contractFingerprint: HASH_A, implFingerprint: HASH_A, provenance: [], writtenAt: w.clock.now().toISOString(),
    }));
  }
  store("subject", 2, 1);
  assertStatementCounterObserves({ prepareProbe: () => checkpoints.latest("person-lookup", uuidOf(5001), "subject") });
  function countCheckpointRead() {
    const native = readTimelineRecords(w.timeline, 0, uuidOf(1));
    w.projection.runFold(uuidOf(1));
    const timeline = { ...w.timeline, withReadSnapshot: <T>(read: () => T) => read(), highWaterMark: () => native.cursor, page: (input: Parameters<typeof w.timeline.page>[0]) => {
      const request = TimelinePageRequestSchema.parse(input);
      return native.records.filter(record => record.cursor > request.after && record.cursor <= (request.through ?? native.cursor)).slice(0, request.limit);
    } };
    return countSqliteStatements(() => buildRunDetail({ ...deps, timeline }, uuidOf(1)));
  }
  const before = countCheckpointRead();
  for (let index = 0; index < 20; index += 1) {
    const id = `read-${String(index)}`;
    nodes.push({ id, label: id });
    store(id, 2, 1);
    store(id, 3, 1);
    store(id, 3, 2);
  }
  store("subject", 3, 1);
  store("subject", 3, 2);
  store("subject", 2, 3);
  nodes.push({ id: "own", label: "Own" }, { id: "missing", label: "Missing" });
  store("own", 1, 1, 1);
  const after = countCheckpointRead();
  assert.equal(after.count.statements, before.count.statements);
  assert.equal(after.count.statements, 1);
  assert.equal(after.value.header.title, "Name 3.2");
  const members = after.value.timeline.steps?.[0]?.members;
  assert.equal(members?.length, 23);
  for (const member of members?.slice(0, 21) ?? []) {
    assert.equal(member.state, "replayed");
    assert.deepEqual(member.replayedFrom, { attempt: 3, claimGeneration: 2 });
  }
  assert.equal(members?.[21]?.state, "pending");
  assert.equal(members?.[22]?.state, "pending");
  const unneeded = countSqliteStatements(() => buildRunDetail({ ...deps, descriptors: { resolve: () => undefined } }, uuidOf(1)));
  assert.equal(unneeded.count.statements, 0);

  const raw = new DatabaseSync(join(w.stateRoot, "state.db"));
  try {
    const trigger = raw.prepare("SELECT sql FROM sqlite_schema WHERE name='run_checkpoints_immutable'").get();
    assert.equal(typeof trigger?.sql, "string");
    raw.exec("DROP TRIGGER run_checkpoints_immutable");
    try {
      raw.prepare("UPDATE run_checkpoints SET output_digest=? WHERE node_id=? AND attempt=? AND claim_generation=?")
        .run("b".repeat(64), "subject", 3, 2);
    } finally { raw.exec(String(trigger?.sql)); }
    assert.throws(() => buildRunDetail(deps, uuidOf(1)), /run_checkpoints-row-output_digest-mismatch/u);
  } finally { raw.close(); }
});
