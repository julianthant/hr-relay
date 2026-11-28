import { parentPort, workerData } from "node:worker_threads";
import { openLogDatabases } from "../sqlite/profile-local-databases.js";
import { LogWriterRequestSchema, LogWriterStartSchema, type DebugAppendResult, type LogMutation, type LogWriterRequest } from "./log-mutations.js";
import { createLogWriterBatch } from "./log-writer-batch.js";

function run(port: NonNullable<typeof parentPort>) {
  const { statePath, root, maxWaitMs } = LogWriterStartSchema.parse(workerData);
  const databases = openLogDatabases(statePath, root, true);
  let last = 0;
  try { databases.reconcile(); }
  catch (error) { databases.close(); throw error; }
  const debug: { sequence: number; eventId: string; result: DebugAppendResult }[] = [];
  const acknowledge = (through: number) => {
    port.postMessage({ kind: "committed", through, debug });
    debug.length = 0;
  };
  const batch = createLogWriterBatch<Extract<LogWriterRequest, { kind: "append" }>>(maxWaitMs, entries => {
    const records = entries.flatMap(({ mutation }) => mutation.kind === "append-debug" ? [mutation.record] : []);
    const committed = records.length === 0 ? [] : databases.commitDebug(records);
    let index = 0;
    const mutations = entries.flatMap<LogMutation>(({ mutation, sequence }) => {
      if (mutation.kind !== "append-debug") return [mutation];
      const outcome = committed[index++];
      if (outcome === undefined) throw new Error("log-writer-debug-outcome-missing");
      debug.push({ sequence, eventId: mutation.record.eventId, result: outcome.result });
      return outcome.row === undefined ? [] : [{ kind: "append", row: outcome.row }];
    });
    if (mutations.length > 0) databases.apply(mutations);
  }, acknowledge);
  port.on("message", (raw: unknown) => {
    const request = LogWriterRequestSchema.parse(raw);
    if (request.sequence !== last + 1) throw new Error("log-writer-sequence-gap");
    last = request.sequence;
    if (request.kind === "append") {
      const { mutation } = request;
      const payload = mutation.kind === "append" ? mutation.row.payload : undefined;
      const urgent = (mutation.kind !== "append" && mutation.kind !== "append-debug")
        || (payload?.kind === "span" && payload.event.t === "span.ended" && payload.event.kind === "task");
      batch.append(last, request, urgent);
      return;
    }
    if (request.kind === "flush") { batch.flush(last); return; }
    batch.drain();
    if (request.kind === "reconcile") databases.reconcile();
    else databases.close();
    acknowledge(last);
    if (request.kind === "close") port.close();
  });
  port.postMessage({ kind: "ready" });
}

if (parentPort !== null) run(parentPort);
