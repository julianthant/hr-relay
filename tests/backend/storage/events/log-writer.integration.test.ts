import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { it } from "vitest";
import { createWorkerLogChannel } from "../../../../src/backend/runtime/workers/worker-child-channel.js";
import { createWorkerLogReceiver } from "../../../../src/backend/runtime/workers/worker-ipc-router.js";
import { WorkerLogMessageSchema } from "../../../../src/backend/runtime/workers/worker-messages.js";
import { startLogWriter } from "../../../../src/backend/storage/events/log-writer.js";
import { createNoteTimelineWriter } from "../../../../src/backend/storage/events/note-timeline-writer.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { deriveItemId } from "../../../../src/rules/identity/identifiers.js";
import { openAuthorityHarness, personLookupQueuedRun } from "../../../support/helpers/phase1f-executor-harness.js";

it("copies only committed notes and recovers committed state rows whose worker disappears before delivery", async () => {
  const { database, clock, path, stateRoot, dispose } = await openAuthorityHarness();
  const faults: Error[] = [];
  const writer = startLogWriter({ statePath: path, root: stateRoot, onFault: error => faults.push(error) });
  const child = createWorkerLogChannel();
  const unbind = database.bindLogPublisher(child.publish);
  const notes = createNoteTimelineWriter({ repository: database.authority.timelineEvents, clock });
  const emit = (message: string) => notes.emitNote({ workflow: "person-lookup",
    address: { workerId: "person-lookup-worker-1", spanPath: "worker" }, level: "step", message });
  const read = (db: DatabaseSync) => db.prepare("SELECT cursor,id,payload_json FROM timeline_events ORDER BY cursor").all();
  try {
    await writer.ready;
    assert.throws(() => database.withAuthorityTransaction(() => {
      emit("rolled back note");
      throw new Error("synthetic rollback");
    }), /synthetic rollback/u);
    emit("queued before connection");
    let flushed = false;
    const waiting = child.flush().then(() => { flushed = true; });
    await Promise.resolve();
    assert.equal(flushed, false);
    const received: number[] = [];
    child.attach(raw => {
      const message = WorkerLogMessageSchema.parse(raw);
      if (message.kind === "worker-log-append") {
        received.push(message.seq);
        writer.publish({ kind: "append", row: message.row }, error => {
          if (error !== undefined) child.fail(error);
          else child.receive({ kind: "worker-log-ack", throughSeq: message.seq });
        });
      } else {
        void writer.flush().then(() => child.receive({
          kind: "worker-log-flushed", requestId: message.requestId, throughSeq: message.throughSeq,
        }), child.fail);
      }
    });
    emit("sent without blocking");
    assert.deepEqual(received, [1, 2]);
    await waiting;
    await child.flush();
    using state = new DatabaseSync(path, { readOnly: true });
    using timeline = new DatabaseSync(join(stateRoot, "timeline.db"), { readOnly: true });
    assert.deepEqual(read(timeline), read(state));
    unbind();
    emit("committed before child exit");
    assert.equal(read(state).length, read(timeline).length + 1);
    await writer.reconcile();
    assert.deepEqual(read(timeline), read(state));
    assert.deepEqual(faults, []);
  } finally {
    unbind();
    try { await writer.close(); } finally { await dispose(); }
  }
});

it("preserves each run's state order when four runs send interleaved notes", async () => {
  const { database, clock, path, stateRoot, dispose } = await openAuthorityHarness();
  const writer = startLogWriter({ statePath: path, root: stateRoot, onFault: () => {} });
  const channels = Array.from({ length: 4 }, () => {
    const child = createWorkerLogChannel();
    const receiver = createWorkerLogReceiver(writer, message => child.receive(message), child.fail);
    child.attach(message => receiver.receive(message));
    return { child, receiver };
  });
  const channelByRun = new Map<string, ReturnType<typeof createWorkerLogChannel>>();
  const unbind = database.bindLogPublisher(mutation => {
    if (mutation.kind === "append" && mutation.row.scope.kind === "run") channelByRun.get(mutation.row.scope.runId)?.publish(mutation);
  });
  try {
    await writer.ready;
    const notes = createNoteTimelineWriter({ repository: database.authority.timelineEvents, clock });
    const runs = Array.from({ length: 4 }, (_, index) => {
      const run = RunRecordSchema.parse(personLookupQueuedRun({ runId: randomUUID(),
        itemId: deriveItemId("person-lookup", `test-log-run-${index}`) }));
      database.authority.runs.enqueue(run);
      channelByRun.set(run.envelope.runId, channels[index].child);
      return run;
    });
    const messages = ["first", "second", "third"];
    await Promise.all(runs.map(async ({ envelope }) => {
      for (const message of messages) {
        await Promise.resolve();
        notes.emitNote({ workflow: envelope.workflow, address: {
          runId: envelope.runId, attempt: envelope.attempt, traceId: envelope.traceId, spanPath: envelope.traceId,
        }, level: "step", message });
      }
    }));
    await Promise.all(channels.map(({ child }) => child.drain()));
    assert.ok(channels.every(({ receiver }) => receiver.drained));
    const receiver = createWorkerLogReceiver(writer, () => {}, () => {});
    const row = database.authority.timelineEvents.page({}).find(event => event.payload.kind === "note");
    assert.ok(row);
    assert.throws(() => receiver.receive({ kind: "worker-log-append", seq: 2, row }), /worker-log-sequence-gap/u);
    assert.throws(() => receiver.receive({ kind: "worker-log-flush", requestId: randomUUID(), throughSeq: 1 }),
      /worker-log-flush-sequence-invalid/u);
    using timeline = new DatabaseSync(join(stateRoot, "timeline.db"), { readOnly: true });
    const read = timeline.prepare("SELECT json_extract(payload_json,'$.payload.note.message') AS message FROM timeline_events WHERE run_id=? AND kind='note' ORDER BY cursor");
    for (const { envelope } of runs) assert.deepEqual(read.all(envelope.runId).map(row => row.message), messages);
  } finally {
    unbind();
    try { await writer.close(); } finally { await dispose(); }
  }
});
