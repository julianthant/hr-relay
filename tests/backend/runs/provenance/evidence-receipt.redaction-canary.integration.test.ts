import { testWorkerPorts } from "../../../support/fixtures/run-lifecycle-fixtures.js";

import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { deriveRunEvidenceReceipt } from "../../../../src/backend/runs/provenance/evidence-receipt.js";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";
import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";
import { NOW } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { EXIT_RUN_ID, seedPersonLookupExitRun } from "../../../support/fixtures/receipt-run-fixtures.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";

const databases: AuthorityDatabase[] = [];
const profileFixtures: Awaited<ReturnType<typeof createBoundProfileFixture>>[] = [];

afterEach(async () => {
  for (const database of databases.splice(0)) database.close();
  for (const fixture of profileFixtures.splice(0)) await fixture.close();
});

async function openDatabase(): Promise<AuthorityDatabase> {
  const fixture = await createBoundProfileFixture();
  profileFixtures.push(fixture);
  const database = AuthorityDatabase.open(
    { path: fixture.path, busyTimeoutMs: 250, migrationOwner: "unit-test" },
    manualClock(new Date(NOW)),
  );
  testWorkerPorts(database, manualClock(new Date(NOW)), { path: fixture.path, descriptor: personLookupDescriptor, poolIndex: 1 });
  databases.push(database);
  return database;
}

describe("redaction surface scan — the canary sweep (ref clock-config-secrets §6)", () => {

  it("retains the exit run's supplied person identifiers in its evidence receipt", async () => {

    const database = await openDatabase();
    const seeded = seedPersonLookupExitRun(database);
    const subjectName = "Battistessa, Johnnie";
    assert.ok(
      canonicalJsonStringify(seeded.checkpoints).includes(subjectName),
      "the exit run's checkpoints must actually carry the subject name",
    );

    const receipt = deriveRunEvidenceReceipt({
      descriptor: personLookupDescriptor,
      run: seeded.run,
      result: database.authority.runResults.get(EXIT_RUN_ID),
      checkpoints: seeded.checkpoints,
    }).receipt;
    const serialized = canonicalJsonStringify(receipt);
    assert.ok(serialized.includes(subjectName), "the receipt omitted the retained subject name");
    assert.ok(serialized.includes("Battistessa"), "the receipt omitted the retained surname");
    assert.ok(serialized.includes("nnie"), "the complete subject name must include its final characters");
  });
});
