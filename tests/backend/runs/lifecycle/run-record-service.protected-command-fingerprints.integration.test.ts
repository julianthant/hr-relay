import { createRunRecordServiceTestWorld } from "../../../support/helpers/backend/run-record-service-world.js";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { requireLifecycleApplied } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { NOW, UUID_5, UUID_6 } from "../../../support/fixtures/phase1c-contract-fixtures.js";

const {fixture, created, cleanup } = createRunRecordServiceTestWorld();

afterEach(cleanup);

describe("protected canonical command fingerprints", () => {

  it("binds protected input identity and safe facts in current create journals", async () => {
    const journals = async (emplId: string, memo = "ordinary fact", sourceId = "10000000-0000-4000-8000-000000000001") => {
      const f = await fixture();
      const request = { ...f.request, input: { ...f.request.input, raw: { emplId, memo },
        parsed: { ...f.request.input.parsed, value: { emplId, memo }, protectedBindings: [{
          kind: "test-data-local" as const, inputPath: "emplId" as const, name: "personLookupCanaryEid" as const, sourceId }] } } };
      const run = created(f.service, request);
      assert.deepEqual(run.input.raw, { emplId, memo });
      const generation = f.database.getMeta().authorityGeneration;
      assert.equal(f.service.create(request).state, "applied-already");
      assert.equal(f.database.getMeta().authorityGeneration, generation);
      const terminal = requireLifecycleApplied(f.service.transition({ commandId: UUID_5,
        runId: run.envelope.runId, expectedVersion: run.version,
        lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW } }));
      const deletion={runId:terminal.envelope.runId,expectedVersion:terminal.version,commandId:UUID_6};
      assert.equal(f.service.delete(deletion).state,"deleted");
      assert.equal(f.service.delete(deletion).state,"applied-already");
      return [request.commandId].map((commandId) => {
        const journal = f.database.authority.lifecycleJournal.getCommand(commandId);
        assert.ok(journal && "requestFingerprint" in journal);
        return journal.requestFingerprint;
      });
    };
    assert.deepEqual(await journals("10812345"), await journals("10854321"));
    const original = await journals("10812345");
    const changedFact = await journals("10812345", "changed ordinary fact");
    const changedIdentity = await journals("10812345", "ordinary fact", "10000000-0000-4000-8000-000000000002");
    original.forEach((fingerprint, index) => {
      assert.notEqual(fingerprint, changedFact[index]);
      assert.notEqual(fingerprint, changedIdentity[index]);
    });
  });
});
