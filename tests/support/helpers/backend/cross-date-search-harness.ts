import { RunRecordSchema, type RunRecord } from "../../../../src/models/run/record.js";
import type { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/index.js";
import { runRecordOf, type SeedRunInput } from "./dashboard-harness.js";

/** One strict authority row shaped exactly like the sanitized D283 search corpus. */
export function insertMeasuredSearchRun(database: AuthorityDatabase, input: SeedRunInput): RunRecord {
  const base = runRecordOf({
    ...input,
    workflow: "separations",
    shape: "single",
    dryRun: true,
    lifecycle: { state: "queued" },
  });
  const queued = RunRecordSchema.parse({
    ...base,
    envelope: {
      ...base.envelope,
      resolvedInstance: {
        kuali: "prod",
        "new-kronos": "prod",
        ucpath: "prod",
      },
    },
  });
  database.authority.runs.enqueue(queued);
  const now = new Date(Date.parse(queued.envelope.enqueuedAt)).toISOString();
  const workerId = "search-corpus-worker";
  const claimed = database.authority.runs.claimNext({ workflow: "separations", workerId, now });
  if (claimed.state !== "claimed") throw new Error("measured search fixture was not claimed");
  const claim = { workerId, claimGeneration: claimed.run.claimGeneration };
  const validating = database.authority.runs.transition({
    runId: queued.envelope.runId,
    expectedVersion: claimed.run.version,
    claim,
    lifecycle: { state: "validating", workerId, claimedAt: now, heartbeatAt: now },
    now,
  });
  if (validating.state !== "applied") throw new Error("measured search fixture did not enter validating");
  const running = database.authority.runs.transition({
    runId: queued.envelope.runId,
    expectedVersion: validating.run.version,
    claim,
    lifecycle: { state: "running", workerId, claimedAt: now, heartbeatAt: now },
    now,
  });
  if (running.state !== "applied") throw new Error("measured search fixture did not enter running");
  const parked = database.authority.runs.transition({
    runId: queued.envelope.runId,
    expectedVersion: running.run.version,
    claim,
    lifecycle: {
      state: "parked-gate",
      gateId: "search-review",
      parkedAt: now,
      resumeAt: "resume-search",
    },
    now,
  });
  if (parked.state !== "applied") throw new Error("measured search fixture did not enter parked-gate");
  return parked.run;
}
