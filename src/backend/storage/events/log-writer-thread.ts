import { parentPort, workerData } from "node:worker_threads";
import { openLogDatabases } from "../sqlite/profile-local-databases.js";
import { LogWriterRequestSchema, LogWriterStartSchema } from "./log-mutations.js";
import { createLogWriterBatch } from "./log-writer-batch.js";

function run(port: NonNullable<typeof parentPort>) {
  const { statePath, root, maxWaitMs } = LogWriterStartSchema.parse(workerData);
  const databases = openLogDatabases(statePath, root);
  let last = 0;
  try { databases.reconcile(); }
  catch (error) { databases.close(); throw error; }
  const acknowledge = (through: number) => port.postMessage({ kind: "committed", through });
  const batch = createLogWriterBatch(maxWaitMs, databases.apply, acknowledge);
  port.on("message", (raw: unknown) => {
    const request = LogWriterRequestSchema.parse(raw);
    if (request.sequence !== last + 1) throw new Error("log-writer-sequence-gap");
    last = request.sequence;
    if (request.kind === "append") {
      const { mutation } = request;
      const payload = mutation.kind === "append" ? mutation.row.payload : undefined;
      const urgent = mutation.kind !== "append" || (payload?.kind === "span" && payload.event.t === "span.ended" && payload.event.kind === "task");
      batch.append(last, mutation, urgent);
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
