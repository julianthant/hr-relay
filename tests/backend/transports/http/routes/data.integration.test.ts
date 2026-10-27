import { createRunDetailTestWorld } from "../../../../support/helpers/backend/run-detail-world.js";
import { Hono } from "hono";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { composeDataQueries } from "../../../../../src/backend/app/composition/dashboard/data.js";
import type { DashboardApp } from "../../../../../src/backend/transports/http/routes/api-types.js";
import { registerDataRoutes } from "../../../../../src/backend/transports/http/routes/data.js";
import { RunDetailSectionResponseSchema } from "../../../../../src/models/dashboard/run-detail.js";
import { RunRecordSchema } from "../../../../../src/models/run/record.js";
import { runRecordOf } from "../../../../support/helpers/backend/dashboard-harness.js";

const {world, depsOf, sourceRun, checkpointFor, storeCheckpoint, cleanup } = createRunDetailTestWorld();

afterEach(cleanup);

describe("read-only Context Data projection", () => {

  it("serves prior-run data through the production section route with exact source identity", async () => {
    const current = await world();
    const source = sourceRun(current, { seed: 21, attempt: 1, claimGeneration: 1 });
    const laterBase = runRecordOf({ seed: 22, attempt: 2, claimGeneration: 1 });
    const later = RunRecordSchema.parse({
      ...laterBase,
      envelope: { ...laterBase.envelope, itemId: source.envelope.itemId, retryOf: source.envelope.runId },
    });
    current.database.authority.runs.enqueue(later);
    storeCheckpoint(current, checkpointFor(source, { outputValue: {
      invitedOn: { state: "present", value: "PRIOR_RUN_VALUE" },
    } }));
    storeCheckpoint(current, checkpointFor(later, { outputValue: {
      invitedOn: { state: "present", value: "CURRENT_RUN_VALUE" },
    } }));
    const deps = depsOf(current);
    const app: DashboardApp = new Hono();
    registerDataRoutes(app, () => composeDataQueries(deps));
    const response = await app.request("/api/v1/runs/" + source.envelope.runId + "/context-data");
    assert.equal(response.status, 200);
    const section = RunDetailSectionResponseSchema.parse(await response.json());
    assert.equal(section.section, "context-data");
    if (section.section !== "context-data") throw new Error("wrong section");
    assert.equal(section.payload.runId, source.envelope.runId);
    assert.equal(section.payload.entries.find((entry) => entry.label === "Invited on")?.valueRedacted, "PRIOR_RUN_VALUE");
    assert.equal(JSON.stringify(section).includes("CURRENT_RUN_VALUE"), false);
  });
});
