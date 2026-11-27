import { Hono } from "hono";
import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { createDashboardClient } from "../../../src/dashboard/client/index.js";
import { FIXTURE_EDITABLE_SETTINGS,FIXTURE_SETTINGS_FACTS,FIXTURE_STORAGE_DOCTOR } from "../../support/helpers/dashboard/mock-world/fixture-day.js";
import { registerFixtureExplorerRoutes } from "../../support/helpers/dashboard/mock-world/fixture-explorer-routes.js";
import { FIXTURE_EXPLORER_WIRE } from "../../support/helpers/dashboard/mock-world/fixture-explorer.js";
import { registerFixtureIntakeRoutes } from "../../support/helpers/dashboard/mock-world/fixture-intake-routes.js";
import { FIXTURE_INTAKE_IDS } from "../../support/fixtures/dashboard/fixture-intake.js";
import { registerFixtureSettingsRoutes } from "../../support/helpers/dashboard/mock-world/fixture-settings-routes.js";
import * as settings from "../../support/helpers/dashboard/mock-world/fixture-settings.js";
import { registerFixtureStorageRoutes } from "../../support/helpers/dashboard/mock-world/fixture-storage-routes.js";
import * as storage from "../../support/helpers/dashboard/mock-world/fixture-storage.js";
import { SCENES as activity } from "../../support/helpers/dashboard/mock-world/reference-activity-scenes.js";
import { SCENES as detail } from "../../support/helpers/dashboard/mock-world/reference-detail-scenes.js";
import { SCENES as explorer } from "../../support/helpers/dashboard/mock-world/reference-explorer-scenes.js";
import { SCENES as intake } from "../../support/helpers/dashboard/mock-world/reference-intake-scenes.js";
import { SCENES as settingsScenes } from "../../support/helpers/dashboard/mock-world/reference-settings-scenes.js";
import { SCENES as shell } from "../../support/helpers/dashboard/mock-world/reference-shell-scenes.js";
import { SCENES as start } from "../../support/helpers/dashboard/mock-world/reference-start-scenes.js";

describe("released surface fixtures", () => {
  it("keeps compatibility exports as the exact schema-backed leaf objects", () => {
    assert.equal(settings.FIXTURE_EDITABLE_SETTINGS, FIXTURE_EDITABLE_SETTINGS);
    assert.equal(settings.FIXTURE_SETTINGS_FACTS, FIXTURE_SETTINGS_FACTS);
    assert.equal(storage.FIXTURE_STORAGE_DOCTOR, FIXTURE_STORAGE_DOCTOR);
  });

  it("composes independent settings, storage, explorer and intake HTTP routes in either order", async () => {
    const registrars = [registerFixtureSettingsRoutes, registerFixtureStorageRoutes,
      registerFixtureExplorerRoutes, registerFixtureIntakeRoutes];
    for (const order of [registrars, [...registrars].reverse()]) {
      const app = new Hono();
      for (const register of order) register({ app });
      const client = createDashboardClient({
        baseUrl: "http://127.0.0.1",
        fetchImpl: async (input, init) => await app.request(input, init),
      });
      assert.deepEqual(await client.editableSettings(), FIXTURE_EDITABLE_SETTINGS);
      assert.deepEqual(await client.workflowExplorer(), FIXTURE_EXPLORER_WIRE);
      assert.equal((await client.intakeSession(FIXTURE_INTAKE_IDS.mapping)).intakeSessionId,
        FIXTURE_INTAKE_IDS.mapping);
      await assert.rejects(() => client.intakeSession("missing-session"), /no fixture intake session/u);
    }
  });

  it("partitions the accepted default reference scenes exactly once", () => {
    const ids = [shell, detail, start, intake, explorer, activity, settingsScenes].flatMap(scenes => scenes.map(scene => scene.id));
    assert.equal(new Set(ids).size, ids.length);
    assert.deepEqual(ids.toSorted(), ["queue-day", "run-open-gate", "run-failed", "run-running", "run-done", "run-queued", "run-parked-write", "run-group", "run-member", "start-run", "intake-mapping", "intake-review", "intake-manifest", "intake-rerun", "explorer-graph", "explorer-transaction", "catalog-search", "activity-report", "activity-report-unavailable", "settings"].toSorted());
  });
});
