/** Disposable independent-process writer used only by D's concurrency/refresh proofs. */
import { AuthorityDatabase } from "../../../src/infra/sqlite/authority-database.js";
import { manualClock } from "../../../src/domain/clock.js";
import { FailureResolutionCommandSchema } from "../../../src/domain/commands.js";
import { resolutionKernel } from "./fixtures.js";
import { NOW } from "../database-foundation/fixtures.js";
const path = process.argv[2]; if (!path) throw new Error("peer database path missing");
const clock = manualClock(new Date(NOW));
const database = AuthorityDatabase.open({ path, busyTimeoutMs: 5000, migrationOwner: "diagnostics-peer" }, clock);
process.send?.({ state: "ready" });
process.once("message", input => {
  try {
    const result = resolutionKernel(database, clock).execute(FailureResolutionCommandSchema.parse(input));
    process.send?.({ state: "result", result });
  } finally { database.close(); process.disconnect?.(); }
});
