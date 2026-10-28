import { createCredentialStore } from "../../../src/backend/storage/configuration/credential-store.js";
import { CanonicalFailureTerminalizeRequestSchema } from "../../../src/backend/storage/sqlite/run-store-contracts.js";
import { personLookupDescriptor } from "../helpers/registered-workflows.js";
import { once } from "node:events";
import { readSync } from "node:fs";
import { WorkerRuntimeLifetimeLock } from "../../../src/backend/storage/admission/lifetime-lock.js";
import { z } from "zod";
import { RunRecordService, CreateRunRequestSchema } from "../../../src/backend/runs/lifecycle/run-record-service.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { RuntimeConfigClaimTokenSchema } from "../../../src/models/config/runtime-generation.js";
import { WorkerClaimLifetimeSchema } from "../../../src/models/run/worker.js";
import { CommandIdSchema, RunIdSchema, WorkerIdSchema, WorkflowIdSchema } from "../../../src/rules/identity/ids.js";
import { AuthorityDatabase } from "../../../src/backend/storage/sqlite/authority-database.js";
import { acquireSharedRuntimeAdmission } from "../../../src/backend/storage/admission/admission.js";
import { createProfileRegistry } from "../../../src/backend/profiles/registry.js";
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
const admission = machine.admitProfile(createProfileRegistry(machine).storageClaim(basename(dirname(data.path))));
const credentials = createCredentialStore({ admission, stateRoot: admission.stateRoot, erasureJournalAdmission: machine,
  erasureJournalPath: resolve(machine.stateRoot, "machine", "erasures", `${admission.profileBinding.profileId}.json`) });
const database = AuthorityDatabase.open(admission, { path: data.path, busyTimeoutMs: 250, migrationOwner: "race-proof" },
  clock, undefined, { afterFailureStorageStep: (step) => { if (step === "failure") pause(); } }, { afterClaimSelection: pause }, credentials);
const service = new RunRecordService({ database, clock, ids: { uuid: () => data.runId }, publishQueued: () => undefined },
  { afterCreateReservation: pause });
let closing: Promise<void> | undefined;
closeOwned = () => closing ??= (async () => {
  database.close(); admission.release(); machine.release();
  await lifetime.close();
  if (process.connected) {
    if (process.disconnect === undefined) throw new Error("race worker parent channel disappeared");
    process.disconnect();
  }
})();
process.on("message", (input: unknown) => {
  const message = z.enum(["run", "close"]).parse(input);
  if (message === "close") {
    void closeOwned().catch(error => { setImmediate(() => { throw error; }); });
    return;
  }
  try {
    const outcome = data.operation.kind === "create"
      ? service.create(data.operation.request) : data.operation.kind === "claim" ? service.claimNext(data.operation.request)
        : service.terminalize({ kind: "failure", ...data.operation.request }, personLookupDescriptor);
    send({ type: "result", outcome });
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    send({ type: "error", message: error.message });
  }
});
send({ type: "ready" });
