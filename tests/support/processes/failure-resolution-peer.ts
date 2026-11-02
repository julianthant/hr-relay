/** Disposable independent-process writer used only by D's concurrency/refresh proofs. */
import { AuthorityDatabase } from "../../../src/backend/storage/sqlite/authority-database.js";
import { acquireSharedRuntimeAdmission } from "../../../src/backend/storage/admission/admission.js";
import { WorkerRuntimeLifetimeLock } from "../../../src/backend/storage/admission/lifetime-lock.js";
import { createCredentialStore } from "../../../src/backend/storage/configuration/credential-store.js";
import { basename, dirname, resolve } from "node:path";
import { manualClock } from "../../../src/rules/time/clock.js";
import { FailureResolutionCommandSchema } from "../../../src/rules/commands/commands.js";
import { resolutionKernel } from "../helpers/failure-resolution/fixtures.js";
import { NOW } from "../helpers/database-foundation/fixtures.js";
const path = process.argv[2]; if (!path) throw new Error("peer database path missing");
const parentStop = new AbortController();
const lifetime = await WorkerRuntimeLifetimeLock.receive(Number(process.argv[3]), () => parentStop.abort(new Error("fixture-parent-disconnected")));
parentStop.signal.throwIfAborted();
const clock = manualClock(new Date(NOW));
const machine = acquireSharedRuntimeAdmission(resolve(dirname(path), "../../../.."), lifetime);
const admission = machine.admitProfile(basename(dirname(path)));
const credentials = createCredentialStore({ admission, stateRoot: admission.stateRoot,
  });
const database = AuthorityDatabase.open(admission, { path, busyTimeoutMs: 5000, migrationOwner: "diagnostics-peer" }, clock, undefined, undefined, undefined, credentials);
let closing: Promise<void> | undefined;
const close = (): Promise<void> => closing ??= (async () => {
  database.close(); admission.release(); machine.release();
  await lifetime.close();
  if (process.connected) {
    if (process.disconnect === undefined) throw new Error("diagnostic peer parent channel disappeared");
    process.disconnect();
  }
})();
parentStop.signal.addEventListener("abort", () => {
  process.exitCode = 1;
  void close().catch(error => { setImmediate(() => { throw error; }); });
}, { once: true });
process.send?.({ state: "ready" });
process.once("message", input => {
  try {
    const result = resolutionKernel(database, clock).execute(FailureResolutionCommandSchema.parse(input));
    process.send?.({ state: "result", result });
  } finally { void close().catch(error => { setImmediate(() => { throw error; }); }); }
});
