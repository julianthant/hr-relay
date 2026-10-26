import { createCrossDateSearchService } from "../../../../src/backend/runs/queries/search.js";
import { testWorkerLifetime, testWorkerPorts } from "../../fixtures/run-lifecycle-fixtures.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { separationsDescriptor } from "../registered-workflows.js";
import { RunRecordSchema, type RunRecord } from "../../../../src/models/run/record.js";
import type { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/index.js";
import { runRecordOf, type SeedRunInput } from "./dashboard-harness.js";


export function insertMeasuredSearchRun(database: AuthorityDatabase, input: SeedRunInput & { authorityPath: string }): RunRecord {
  const base = runRecordOf({
    ...input,
    workflow: "separations",
    shape: "single",
    dryRun: true,
    lifecycle: { state: "queued" },
  });
  const clock = manualClock(new Date(base.envelope.enqueuedAt));
  testWorkerPorts(database, clock, { path: input.authorityPath, descriptor: separationsDescriptor, poolIndex: 1 });
  const active = database.authority.runtimeConfig.get();
  if (active === undefined) throw new Error("search fixture settings admission missing");
  const queued = RunRecordSchema.parse({
    ...base,
    envelope: {
      ...base.envelope,
      configSnapshotId: active.configSnapshotId,
      configFingerprint: active.configFingerprint,
      descriptorVersion: separationsDescriptor.version,
      contractFingerprint: separationsDescriptor.contractFingerprint,
      resolvedInstance: {
        kuali: "prod",
        "new-kronos": "prod",
        ucpath: "prod",
      },
    },
  });
  database.authority.runs.enqueue(queued);
  const now = new Date(Date.parse(queued.envelope.enqueuedAt)).toISOString();
  const workerId = database.authority.workerSlots.list("separations").find(slot => slot.poolIndex === 1 && slot.retiredAt === null)?.workerId;
  if (workerId === undefined) throw new Error("search fixture worker admission missing");
  const claimMember1 = database.authority.workerSlots.get(workerId);
  if (claimMember1 === undefined) throw new Error("fixture-claim-member-required");
  const workerLifetime = testWorkerLifetime(database, "separations", claimMember1.poolIndex).workerLifetime;
  const claimed = database.authority.runs.claimNext({ workerLifetime, workflow: "separations", workerId, now });
  if (claimed.state !== "claimed") throw new Error("measured search fixture was not claimed");
  const claim = { workerId, claimGeneration: claimed.run.claimGeneration };
  const held = { workerId, workerLifetime, claimedAt: now, heartbeatAt: now };
  const validating = database.authority.runs.transition({
    runId: queued.envelope.runId,
    expectedVersion: claimed.run.version,
    claim,
    lifecycle: { state: "validating", ...held },
    now,
  });
  if (validating.state !== "applied") throw new Error("measured search fixture did not enter validating");
  const running = database.authority.runs.transition({
    runId: queued.envelope.runId,
    expectedVersion: validating.run.version,
    claim,
    lifecycle: { state: "running", ...held },
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

export function measuredSearchService(
  database: AuthorityDatabase,
  dependencies: Omit<Parameters<typeof createCrossDateSearchService>[0], "authority">,
) {
  return createCrossDateSearchService({
    ...dependencies,
    authority: {
      readSnapshot: (read) => database.withAuthorityReadSnapshot(() => read({
        authorityGeneration: database.getMeta().authorityGeneration,
        searchRuns: (input) => database.authority.runs.search(input),
      })),
    },
  });
}
