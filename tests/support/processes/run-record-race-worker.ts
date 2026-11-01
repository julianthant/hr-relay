import { createCredentialStore } from "../../../src/backend/storage/configuration/credential-store.js";
import { randomUUID } from "node:crypto";
import { registerBoundProfile, unregisterBoundProfile } from "../helpers/synthetic-database-admission.js";
import { testWorkerLifetime, testWorkerPorts } from "../fixtures/run-lifecycle-fixtures.js";
import { CanonicalFailureTerminalizeRequestSchema } from "../../../src/backend/storage/sqlite/run-store-contracts.js";
import { personLookupDescriptor } from "../helpers/registered-workflows.js";
import { once } from "node:events";
import { readSync } from "node:fs";
import { WorkerRuntimeLifetimeLock } from "../../../src/backend/storage/admission/lifetime-lock.js";
import { z } from "zod";
import { RunRecordService, CreateRunRequestSchema, requireLifecycleApplied } from "../../../src/backend/runs/lifecycle/run-record-service.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { RuntimeConfigClaimTokenSchema } from "../../../src/models/config/runtime-generation.js";
import { WorkerClaimLifetimeSchema } from "../../../src/models/run/worker.js";
import { CommandIdSchema, RunIdSchema, WorkerIdSchema, WorkflowIdSchema } from "../../../src/rules/identity/ids.js";
import { AuthorityDatabase } from "../../../src/backend/storage/sqlite/authority-database.js";
import { acquireSharedRuntimeAdmission } from "../../../src/backend/storage/admission/admission.js";
import { basename, dirname, resolve } from "node:path";

const parentStop = new AbortController();
const lifetime = await WorkerRuntimeLifetimeLock.receive(z.coerce.number().int().positive().parse(process.argv[2]), () => parentStop.abort(new Error("fixture-parent-disconnected")));
parentStop.signal.throwIfAborted();
let closeOwned: () => Promise<void> = () => lifetime.close();
parentStop.signal.addEventListener("abort", () => {
  process.exitCode = 1;
  void closeOwned().catch(error => { setImmediate(() => { throw error; }); });
}, { once: true });
if (process.send === undefined) throw new Error("race worker requires its parent channel");
const send = process.send.bind(process);
send({ type: "inherited" });
const request: unknown = (await once(process, "message"))[0];
const data = z.strictObject({
  path: z.string(), now: z.iso.datetime(), runId: RunIdSchema,
  operation: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("own-terminal-failure"), runtimeConfig: RuntimeConfigClaimTokenSchema }),
    z.strictObject({ kind: z.literal("terminal-failure"), request: CanonicalFailureTerminalizeRequestSchema }),
    z.strictObject({ kind: z.literal("create"), request: CreateRunRequestSchema }),
    z.strictObject({ kind: z.literal("claim"), request: z.strictObject({
      commandId: CommandIdSchema, workflow: WorkflowIdSchema, workerId: WorkerIdSchema,
      workerLifetime: WorkerClaimLifetimeSchema, runtimeConfig: RuntimeConfigClaimTokenSchema,
    }) }),
  ]),
}).parse(request);
parentStop.signal.throwIfAborted();
let released = false;
const pause = () => {
  send({ type: "reserved" });
  if (released) return;
  const byte = Buffer.alloc(1);
  for (;;) {
    try {
      if (readSync(0, byte, 0, 1, null) !== 1 || byte[0] !== 1) throw new Error("race worker transaction release is invalid");
      released = true;
      return;
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || !["EAGAIN", "EWOULDBLOCK", "EINTR"].includes(String(error.code))) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
};
const clock = manualClock(new Date(data.now));
const machine = acquireSharedRuntimeAdmission(resolve(dirname(data.path), "../../../.."), lifetime);
const admission = machine.admitProfile(basename(dirname(data.path)));
const credentials = createCredentialStore({ admission, stateRoot: admission.stateRoot,
  });
const database = AuthorityDatabase.open(admission, { path: data.path, busyTimeoutMs: 250, migrationOwner: "race-proof" },
  clock, undefined, { afterFailureStorageStep: (step) => { if (step === "failure") pause(); } },
  { afterClaimSelection: () => { if (data.operation.kind === "claim") pause(); } }, credentials);
const service = new RunRecordService({ database, clock, ids: { uuid: () => data.runId }, publishQueued: () => undefined },
  { afterCreateReservation: pause });
if (data.operation.kind === "own-terminal-failure") {
  registerBoundProfile(admission, machine);
  testWorkerPorts(database, clock, { path: data.path, descriptor: personLookupDescriptor, poolIndex: 2 });
  const owner = testWorkerLifetime(database, personLookupDescriptor.id, 2);
  const claimed = requireLifecycleApplied(service.claimNext({ commandId: randomUUID(), workflow: personLookupDescriptor.id,
    workerId: owner.workerId, workerLifetime: owner.workerLifetime, runtimeConfig: data.operation.runtimeConfig }));
  if (claimed.envelope.runId !== data.runId) throw new Error("race-worker-claimed-another-run");
  const claim = { workerId: owner.workerId, claimGeneration: claimed.claimGeneration };
  requireLifecycleApplied(service.workerTransition({ commandId: randomUUID(), runId: data.runId, claim,
    lifecycle: { state: "validating", workerId: owner.workerId, claimedAt: data.now, heartbeatAt: data.now } }));
  requireLifecycleApplied(service.workerTransition({ commandId: randomUUID(), runId: data.runId, claim,
    lifecycle: { state: "running", workerId: owner.workerId, claimedAt: data.now, heartbeatAt: data.now, currentNodeId: "crm-dates" } }));
}
let terminalRequest: z.infer<typeof CanonicalFailureTerminalizeRequestSchema> | undefined;
let closing: Promise<void> | undefined;
closeOwned = () => closing ??= (async () => {
  database.close();
  if (data.operation.kind === "own-terminal-failure") unregisterBoundProfile(admission);
  admission.release(); machine.release();
  await lifetime.close();
  if (process.connected) {
    if (process.disconnect === undefined) throw new Error("race worker parent channel disappeared");
    process.disconnect();
  }
})();
process.on("message", (input: unknown) => {
  const message = z.union([z.enum(["run", "close"]), z.strictObject({ type: z.literal("terminal-failure"),
    request: CanonicalFailureTerminalizeRequestSchema })]).parse(input);
  if (typeof message === "object") {
    if (data.operation.kind !== "own-terminal-failure" || terminalRequest !== undefined
      || message.request.terminal.authorization.runId !== data.runId) throw new Error("race-worker-terminal-request-refused");
    terminalRequest = message.request;
    return;
  }
  if (message === "close") {
    void closeOwned().catch(error => { setImmediate(() => { throw error; }); });
    return;
  }
  try {
    if (data.operation.kind === "own-terminal-failure" && terminalRequest === undefined) throw new Error("race-worker-terminal-request-required");
    const outcome = data.operation.kind === "create"
      ? service.create(data.operation.request) : data.operation.kind === "claim" ? service.claimNext(data.operation.request)
        : service.terminalize({ kind: "failure", ...(data.operation.kind === "terminal-failure" ? data.operation.request : terminalRequest) }, personLookupDescriptor);
    send({ type: "result", outcome });
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    send({ type: "error", message: error.message });
  }
});
send({ type: "ready" });
