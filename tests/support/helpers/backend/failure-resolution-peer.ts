/** Disposable independent-process writer used only by D's concurrency/refresh proofs. */
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { createProfileRegistry } from "../../../../src/backend/profiles/registry.js";
import { basename, dirname, resolve } from "node:path";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { FailureResolutionCommandSchema } from "../../../../src/rules/commands/commands.js";
import { resolutionKernel } from "../failure-resolution/fixtures.js";
import { NOW } from "../database-foundation/fixtures.js";
const path = process.argv[2]; if (!path) throw new Error("peer database path missing");
const clock = manualClock(new Date(NOW));
const machine = acquireEntrypointAdmission(resolve(dirname(path), "../../../.."), "shared");
const admission = machine.admitProfile(createProfileRegistry(machine).storageClaim(basename(dirname(path))));
const database = AuthorityDatabase.open(admission, { path, busyTimeoutMs: 5000, migrationOwner: "diagnostics-peer" }, clock);
process.send?.({ state: "ready" });
process.once("message", input => {
  try {
    const result = resolutionKernel(database, clock).execute(FailureResolutionCommandSchema.parse(input));
    process.send?.({ state: "result", result });
  } finally { database.close(); admission.release(); machine.release(); process.disconnect?.(); }
});
