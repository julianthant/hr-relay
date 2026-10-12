




import { planStart } from "../../../../src/backend/runs/start/plan.js";


import { HASH_A, UUID_4 } from "../../fixtures/phase1c-contract-fixtures.js";
import { sequentialIdFactory } from "../../fixtures/phase1f-run-fixtures.js";

import { protectedSecretSource } from "../protected-secret-source.js";
import { separationsDescriptor } from "../registered-workflows.js";
import { AuthorityDatabase } from "../synthetic-storage-admission.js";

import type { Clock } from "../../../../src/rules/time/clock.js";

export function createSeparationStartFixtures(openDatabase: () => AuthorityDatabase, CLOCK: Clock) {
  function plan(submissions: readonly unknown[], dryRun = false) {
    return planStart(
      { protectedSecrets: protectedSecretSource({ timekeeperName: "Synthetic Timekeeper" }), authority: openDatabase(), clock: CLOCK, ids: sequentialIdFactory(), planTtlMs: 600_000 },
      {
        descriptor: separationsDescriptor,
        submissions,
        dryRun,
        priority: "bulk" as const,
        shape: "single" as const,
        configFingerprint: HASH_A,
        configSnapshotId: UUID_4,
        plannedBy: "local-operator",
      },
    );
  }
  return { plan };
}
