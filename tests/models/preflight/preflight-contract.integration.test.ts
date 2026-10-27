import assert from "node:assert/strict";
import { it } from "vitest";
import { RuntimeCapabilitySchema } from "../../../src/models/preflight/preflight-contract.js";
import { runtimeFixture } from "../../support/fixtures/preflight/runtime-fixture.js";
it("runs the production factory and doctor with healthy private inputs", async () => {
  const f = await runtimeFixture(RuntimeCapabilitySchema.options);
  try { const report = await f.report(); assert.deepEqual(report.results.filter(result=>result.status!=="pass"), []); }
  finally {await f.close();}
});
