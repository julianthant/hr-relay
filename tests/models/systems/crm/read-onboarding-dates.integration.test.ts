import { createRunIntegrationTestWorld } from "../../../support/helpers/run-integration-world.js";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { afterEach, describe, it } from "vitest";
import { ReadOnboardingDatesOutputSchema } from "../../../../src/models/systems/crm/read-onboarding-dates.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { HASH_B, NOW } from "../../../support/fixtures/phase1c-contract-fixtures.js";

const { roots, databases, openDatabase, startRunning, resultRequest } = createRunIntegrationTestWorld();


afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("atomic success terminal authority", () => {

  it("rejects not-run evidence contradicted by a stored checkpoint for the terminal attempt", () => {
    const database = openDatabase();
    const running = startRunning(database);
    const { result, authorization, factoryAuthorization } = resultRequest(database, running);
    const crmDates = ReadOnboardingDatesOutputSchema.parse({
      emplId: "10873698",
      invitedOn: { state: "present", value: "2026-06-01" },
      startsOn: { state: "present", value: "2026-07-15" },
      completedOn: { state: "absent", reason: "CRM history has no Completed transition" },
    });
    database.authority.runCheckpoints.insert({
      workflowId: running.envelope.workflow,
      itemId: running.envelope.itemId,
      nodeId: "crm-dates",
      attempt: running.envelope.attempt,
      claimGeneration: 1,
      runId: running.envelope.runId,
      output: {
        schemaHash: deriveSchemaHash(ReadOnboardingDatesOutputSchema, "output"),
        value: crmDates,
      },
      descriptorVersion: running.envelope.descriptorVersion,
      contractFingerprint: running.envelope.contractFingerprint,
      implFingerprint: HASH_B,
      provenance: [{ path: "emplId", source: "live", observedAt: NOW, originalObservedAt: NOW }],
      writtenAt: NOW,
    });
    assert.throws(
      () => database.terminalizeSuccess({ result, authorization }, factoryAuthorization),
      /marked condition-false but has a stored checkpoint/,
    );
  });
});
