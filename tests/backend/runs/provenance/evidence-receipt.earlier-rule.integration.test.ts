import assert from "node:assert/strict";
import { afterEach, it } from "vitest";
import { createReceiptService } from "../../../../src/backend/runs/trust/receipt-service.js";
import { createCapabilityWiringTestWorld } from "../../../support/helpers/backend/capability-wiring-world.js";
import { createOcrReviewWorld } from "../../../support/helpers/backend/ocr-review-world.js";

const world = createOcrReviewWorld();
afterEach(world.cleanup);

it("reads the settled receipt after its workflow removes a delegated node", async () => {
  const f = await world.fixture({ record: true, release: true });
  assert.equal(f.canonical.kernel.execute(f.command("correct-ocr-record", 1)).state, "applied");
  assert.equal(f.canonical.kernel.execute(f.approval()).state, "applied");
  await f.canonical.execute(f.run, new AbortController().signal);

  const runId = f.run.envelope.runId;
  const deps = { database: f.database, runReader: f.canonical.lifecycle };
  const original = f.root.descriptor;
  const stored = createReceiptService({ ...deps, descriptors: [original] }).ensureReceipt(runId);
  const result = f.database.authority.runResults.get(runId);
  assert.ok(result?.dependencies.some(dep => dep.state === "delegation-resolved" || dep.state === "child-resolved"));
  assert.deepEqual(f.database.authority.evidenceReceipts.findByRun(runId), stored);

  const wiring = createCapabilityWiringTestWorld();
  const revised = wiring.fixtureDescriptor(original.id, original.code, wiring.providersOnlyContract);
  assert.notEqual(revised.contractFingerprint, stored.descriptorFingerprint);
  const reader = createReceiptService({ ...deps, descriptors: [revised] });
  assert.deepEqual(reader.ensure(runId), { state: "existing", receipt: stored });
});
