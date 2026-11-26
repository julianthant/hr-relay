import { failureStatus } from "../../../../../src/backend/transports/http/routes/failure-status.js";
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
    const data = composeDataQueries(deps);
    registerDataRoutes(app, () => data);
    app.onError((error, c) => {
      const { status, body } = failureStatus(error);
      return c.json(body, status);
    });
    const path = "/api/v1/runs/" + source.envelope.runId;
    const response = await app.request(path + "/context-data");
    assert.equal(response.status, 200);
    const section = RunDetailSectionResponseSchema.parse(await response.json());
    assert.equal(section.section, "context-data");
    if (section.section !== "context-data") throw new Error("wrong section");
    assert.equal(section.payload.runId, source.envelope.runId);
    assert.equal(section.payload.entries.find((entry) => entry.label === "Invited on")?.valueRedacted, "PRIOR_RUN_VALUE");
    assert.equal(JSON.stringify(section).includes("CURRENT_RUN_VALUE"), false);

    const attempts = await app.request(path + "/context-attempts");
    assert.equal(attempts.status, 200);
    assert.equal(await attempts.text(), JSON.stringify(data.contextAttempts(source.envelope.runId)));
    for (const kind of ["context-data", "context-attempts"]) {
      const malformed = await app.request(`${path}/${kind}?unexpected=unused`);
      assert.equal(malformed.status, 400, kind);
      assert.match(await malformed.text(), /"code":"SCHEMA_INVALID"/u);
    }
  });
});

it("requires a complete rerun-values query while retaining the exact absent-source response", async () => {
  const current = await world();
  const app: DashboardApp = new Hono();
  registerDataRoutes(app, () => composeDataQueries(depsOf(current)));
  const path = "/api/v1/runs/00000000-0000-4000-8000-000000000001/rerun-values?expectedVersion=1";
  const valid = await app.request(path);
  assert.equal(valid.status, 404);
  assert.equal(await valid.text(), '{"state":"refused","code":"target-not-found"}');
  for (const suffix of ["&extra=unused", "&expectedVersion=1"]) {
    const response = await app.request(path + suffix);
    assert.equal(response.status, 400, suffix);
    assert.equal(await response.text(), '{"error":"RERUN_VALUES_REQUEST_INVALID"}');
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
});
