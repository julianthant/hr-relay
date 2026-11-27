import { IntakeSessionWireSchema } from "../../../../../src/models/intake/wire.js";
import { afterAll, afterEach, it } from "vitest";
import { createProfileFixtureSet } from "../../../../support/helpers/admission-fixture.js";
import { disposeHttpRouteHarness, harness, json } from "../../../../support/helpers/backend/http-route-harness.js";

import assert from "node:assert/strict";
import { UNWIRED_INTAKE_SERVICE } from "../../../../support/fixtures/intake-kernel-seams.js";
import { composeIntake } from "../../../../../src/backend/app/composition/dashboard/intake.js";
import { createIntakeParser } from "../../../../../src/backend/processing/spreadsheet/intake-parser.js";
import { INTAKE_FIXTURE_WORKFLOW_ID, intakeFixtureDescriptor, intakeFixtureProjection } from "../../../../support/fixtures/intake-workflow-fixture.js";
import { sequentialIdFactory } from "../../../../support/fixtures/phase1f-run-fixtures.js";

const profileFixtures = createProfileFixtureSet();
afterAll(() => profileFixtures.close());

afterEach(disposeHttpRouteHarness);

it("reads an existing intake session and validates both command result IDs", async () => {
  const h = await harness({ profileFixture: profileFixtures.create, intake: {
    ...UNWIRED_INTAKE_SERVICE,
    read: sessionId => intake.read(sessionId),
  } });
  const intake = composeIntake({ database: h.database, artifacts: h.artifacts, parser: createIntakeParser({ artifacts: h.artifacts }),
    projections: { resolve: id => id === INTAKE_FIXTURE_WORKFLOW_ID ? intakeFixtureProjection : undefined },
    descriptors: { resolve: id => id === INTAKE_FIXTURE_WORKFLOW_ID ? intakeFixtureDescriptor : undefined }, clock: h.clock, ids: sequentialIdFactory("c") });
  const uploaded = await intake.upload({
    workflow: INTAKE_FIXTURE_WORKFLOW_ID, fileName: "roster.csv", mediaType: "text/csv",
    bytes: new TextEncoder().encode("Employee ID#,Effective Date,Dept\n10000001,2026-01-03,Fixture\n"),
  });
  assert.equal(uploaded.state, "created");
  if (uploaded.state !== "created") throw new Error("synthetic session was not created");
  const session = await h.app.request(`/api/v1/intake/${uploaded.session.intakeSessionId}`);
  assert.equal(session.status, 200);
  assert.deepEqual(IntakeSessionWireSchema.parse(await session.json()), uploaded.session);

  const id = "00000000-0000-4000-8000-000000000001";
  const result = await h.app.request(`/api/v1/intake/${id}/commands/${id}`);
  assert.equal(result.status, 200);
  assert.equal(await result.text(), '{"state":"unavailable"}');
  for (const path of ["/api/v1/intake/malformed", `/api/v1/intake/malformed/commands/${id}`, `/api/v1/intake/${id}/commands/malformed`]) {
    const response = await h.app.request(path);
    assert.equal(response.status, 400, path);
    assert.equal((await json(response)).code, "SCHEMA_INVALID");
  }
});

it.each([
  ["/api/v1/intake/files?workflow=fixture-graph&filename=roster.csv", "text/csv", "eid"],
  ["/api/v1/workbooks/library/intake", "application/json", "{}"],
])("does not mount the unused intake entry door %s", async (path, mediaType, body) => {
  const { app } = await harness({ profileFixture: profileFixtures.create });
  const response = await app.request(`http://localhost${path}`, {
    method: "POST", headers: { host: "localhost", origin: "http://localhost", "content-type": mediaType }, body,
  });
  assert.equal(response.status, 404);
  assert.equal((await json(response)).code, "ROUTE_NOT_FOUND");
});
