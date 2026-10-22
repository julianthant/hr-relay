import { CanonicalFailureTerminalizeRequestSchema } from "../../../src/backend/storage/sqlite/run-store-contracts.js";
import { personLookupDescriptor } from "../helpers/registered-workflows.js";
import { parentPort, workerData } from "node:worker_threads";
import { z } from "zod";
import { RunRecordService, CreateRunRequestSchema } from "../../../src/backend/runs/lifecycle/run-record-service.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { RuntimeConfigClaimTokenSchema } from "../../../src/models/config/runtime-generation.js";
import { CommandIdSchema, RunIdSchema, WorkerIdSchema, WorkflowIdSchema } from "../../../src/rules/identity/ids.js";
import { AuthorityDatabase } from "../../../src/backend/storage/sqlite/authority-database.js";
import { acquireEntrypointAdmission } from "../../../src/backend/storage/admission/bootstrap-admission.js";
import { createProfileRegistry } from "../../../src/backend/profiles/registry.js";
import { basename, dirname, resolve } from "node:path";

const data = z.strictObject({
  path: z.string(), now: z.iso.datetime(), runId: RunIdSchema,
  release: z.instanceof(SharedArrayBuffer),
  operation: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("terminal-failure"), request: CanonicalFailureTerminalizeRequestSchema }),
    z.strictObject({ kind: z.literal("create"), request: CreateRunRequestSchema }),
    z.strictObject({ kind: z.literal("claim"), request: z.strictObject({
      commandId: CommandIdSchema, workflow: WorkflowIdSchema, workerId: WorkerIdSchema,
      runtimeConfig: RuntimeConfigClaimTokenSchema,
    }) }),
  ]),
}).parse(workerData);
const port = parentPort;
if (port === null) throw new Error("race worker requires its parent channel");
const pause = () => {
  port.postMessage({ type: "reserved" });
  const gate = new Int32Array(data.release);
  Atomics.wait(gate, 0, 0);
};
const clock = manualClock(new Date(data.now));
const machine = acquireEntrypointAdmission(resolve(dirname(data.path), "../../../.."), "shared");
const admission = machine.admitProfile(createProfileRegistry(machine).storageClaim(basename(dirname(data.path))));
const database = AuthorityDatabase.open(admission, { path: data.path, busyTimeoutMs: 250, migrationOwner: "race-proof" },
  clock, undefined, { afterFailureStorageStep: (step) => { if (step === "failure") pause(); } }, { afterClaimSelection: pause });
const service = new RunRecordService({ database, clock, ids: { uuid: () => data.runId }, publishQueued: () => undefined },
  { afterCreateReservation: pause });
port.on("message", (input: unknown) => {
  const message = z.enum(["run", "close"]).parse(input);
  if (message === "close") {
    database.close();
    admission.release();
    machine.release();
    port.close();
    return;
  }
  try {
    const outcome = data.operation.kind === "create"
      ? service.create(data.operation.request) : data.operation.kind === "claim" ? service.claimNext(data.operation.request)
        : service.terminalize({ kind: "failure", ...data.operation.request }, personLookupDescriptor);
    port.postMessage({ type: "result", outcome });
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    port.postMessage({ type: "error", message: error.message });
  }
});
port.postMessage({ type: "ready" });
