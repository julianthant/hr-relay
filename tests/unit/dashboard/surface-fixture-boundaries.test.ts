import assert from "node:assert/strict";
import { Hono } from "hono";
import { describe, it } from "vitest";
import { createDashboardClient } from "../../../src/dashboard/client/index.js";
import { FIXTURE_EDITABLE_SETTINGS, FIXTURE_SETTINGS_FACTS, FIXTURE_STORAGE_DOCTOR } from "../../parity/helpers/fixture-day.js";
import * as settings from "../../parity/helpers/fixture-settings.js";
import * as storage from "../../parity/helpers/fixture-storage.js";
import { registerFixtureSettingsRoutes } from "../../parity/helpers/fixture-settings-routes.js";
import { registerFixtureStorageRoutes } from "../../parity/helpers/fixture-storage-routes.js";
import { registerFixtureExplorerRoutes } from "../../parity/helpers/fixture-explorer-routes.js";
import { registerFixtureIntakeRoutes } from "../../parity/helpers/fixture-intake-routes.js";
import { FIXTURE_EXPLORER_WIRE } from "../../parity/helpers/fixture-explorer.js";
import { FIXTURE_INTAKE_IDS } from "../../parity/helpers/fixture-intake.js";
import { SCENES as shell } from "../../parity/helpers/reference-shell-scenes.js";
import { SCENES as detail } from "../../parity/helpers/reference-detail-scenes.js";
import { SCENES as start } from "../../parity/helpers/reference-start-scenes.js";
import { SCENES as intake } from "../../parity/helpers/reference-intake-scenes.js";
import { SCENES as explorer } from "../../parity/helpers/reference-explorer-scenes.js";
import { SCENES as archive } from "../../parity/helpers/reference-archive-scenes.js";
import { SCENES as activity } from "../../parity/helpers/reference-activity-scenes.js";
import { SCENES as settingsScenes } from "../../parity/helpers/reference-settings-scenes.js";

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
      assert.deepEqual(await client.settingsFacts(), FIXTURE_SETTINGS_FACTS);
      assert.deepEqual(await client.editableSettings(), FIXTURE_EDITABLE_SETTINGS);
      assert.deepEqual(await client.storageDoctor(), FIXTURE_STORAGE_DOCTOR);
      assert.deepEqual(await client.workflowExplorer(), FIXTURE_EXPLORER_WIRE);
      assert.equal((await client.intakeSession(FIXTURE_INTAKE_IDS.mapping)).intakeSessionId,
        FIXTURE_INTAKE_IDS.mapping);
      await assert.rejects(() => client.intakeSession("missing-session"), /no fixture intake session/u);
      const upload = await client.uploadIntakeFile({ workflowId: "person-lookup", fileName: "people.csv", mediaType: "text/csv", bytes: new TextEncoder().encode("eid\n12345678").buffer });
      assert.equal(upload.state, "created");
    }
  });

  it("partitions the accepted default reference scenes exactly once", () => {
    const ids = [shell, detail, start, intake, explorer, archive, activity, settingsScenes].flatMap(scenes => scenes.map(scene => scene.id));
    assert.equal(new Set(ids).size, ids.length);
    assert.deepEqual(ids.toSorted(), ["queue-day", "run-open-gate", "run-failed", "run-running", "run-done", "run-queued", "run-parked-write", "run-group", "run-member", "start-run", "intake-mapping", "intake-review", "intake-manifest", "intake-rerun", "explorer-graph", "explorer-transaction", "catalog-search", "archive-ledger", "archive-run", "activity-report", "activity-report-unavailable", "settings"].toSorted());
  });
});
