import { WorkerRuntimeLifetimeLock } from "../../../src/backend/storage/admission/lifetime-lock.js";
import { createInterface } from "node:readline";
import { basename, dirname, join, resolve } from "node:path";

const databasePath = process.argv[2];
if (databasePath === undefined) throw new Error("fence owner needs the database path");
const parentStop = new AbortController();
const lifetime = await WorkerRuntimeLifetimeLock.receive(Number(process.argv[3]), () => parentStop.abort(new Error("fixture-parent-disconnected")));
parentStop.signal.throwIfAborted();
process.stdout.write("ready\n");
const lines = createInterface({ input: process.stdin });
lines.on("line", line => { void fence(line); });
const keepAlive = setInterval(() => undefined, 1000);
parentStop.signal.addEventListener("abort", () => {
  process.exitCode = 1; lines.close(); clearInterval(keepAlive);
  void lifetime.close().catch(error => { setImmediate(() => { throw error; }); });
}, { once: true });

async function fence(line: string): Promise<void> {
  try {
    parentStop.signal.throwIfAborted();
    const input = JSON.parse(line) as { intent?: { fencedAt?: string } };
    const { acquireSharedRuntimeAdmission } = await import("../../../src/backend/storage/admission/admission.js");
    const { createProfileRegistry } = await import("../../../src/backend/profiles/registry.js");
    const { AuthorityDatabase } = await import("../../../src/backend/storage/sqlite/authority-database.js");
    const { registerBoundProfile, boundProfileCredentials } = await import("../helpers/synthetic-database-admission.js");
    const { manualClock } = await import("../../../src/rules/time/clock.js");
    parentStop.signal.throwIfAborted();
    const profileRoot = dirname(databasePath);
    const machine = acquireSharedRuntimeAdmission(resolve(profileRoot, "../../../.."), lifetime);
    const admission = machine.admitProfile(createProfileRegistry(machine).storageClaim(basename(profileRoot)));
    registerBoundProfile(admission, machine);
    const clock = manualClock(new Date(input.intent?.fencedAt ?? "2026-10-01T12:00:00.000Z"));
    const database = AuthorityDatabase.open(admission, { path: join(admission.stateRoot, "state.db"), busyTimeoutMs: 5000, migrationOwner: "unit-test" },
      clock, undefined, undefined, undefined, boundProfileCredentials(admission));
    const result = database.withAuthorityTransaction(() => database.authority.writeIntents.fenceAttempt(input));
    database.close();
    admission.release();
    machine.release();
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ error: error instanceof Error ? error.stack ?? error.message : String(error) })}\n`);
  }
}
