import { createInterface } from "node:readline";
import { basename, dirname, join, resolve } from "node:path";

const databasePath = process.argv[2];
if (databasePath === undefined) throw new Error("fence owner needs the database path");
process.stdout.write("ready\n");
createInterface({ input: process.stdin }).on("line", line => { void fence(line); });
setInterval(() => undefined, 1000);

async function fence(line: string): Promise<void> {
  try {
    const input = JSON.parse(line) as { intent?: { fencedAt?: string } };
    const { acquireEntrypointAdmission } = await import("../../../src/backend/storage/admission/bootstrap-admission.js");
    const { createProfileRegistry } = await import("../../../src/backend/profiles/registry.js");
    const { AuthorityDatabase } = await import("../../../src/backend/storage/sqlite/authority-database.js");
    const { registerBoundProfile, boundProfileCredentials } = await import("../helpers/synthetic-database-admission.js");
    const { manualClock } = await import("../../../src/rules/time/clock.js");
    const profileRoot = dirname(databasePath);
    const machine = acquireEntrypointAdmission(resolve(profileRoot, "../../../.."), "shared");
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
