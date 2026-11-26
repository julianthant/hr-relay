import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { rebuildRuntimeIsolation } from "../../../../../src/backend/app/config/runtime-isolation.js";
import { createDashboardClient } from "../../../../../src/dashboard/client/index.js";
import { SETTINGS_SCHEMA_HASH, deriveSettingsPatchFingerprint } from "../../../../../src/models/config/settings.js";
import { manualClock } from "../../../../../src/rules/time/clock.js";
import { settingsSetOperations } from "../../../../support/fixtures/settings-operation-fixtures.js";
import { releaseAdmissionFixtures } from "../../../../support/helpers/admission-fixture.js";
import { createDashboardPortTestWorld } from "../../../../support/helpers/backend/dashboard-port-world.js";
import { EditableSettingsWireSchema } from "../../../../../src/models/dashboard/settings-editor.js";

describe("BFF spine flow (start plan -> kernel -> spans -> projection)", () => {

  it("serves the resolver-owned editor inventory and reads the persisted settings revision back", async () => {
    const h = await harness();
    const initial = EditableSettingsWireSchema.parse(await json(await h.app.request("/api/v1/settings/editable")));
    assert.equal(initial.revision, 1);
    assert.deepEqual(initial.sections.map((section) => section.id), ["general", "display", "performance", "paths", "routes", "annual-dates", "providers"]);
    const initialWidth = initial.sections.flatMap((section) => section.leaves).find((leaf) => leaf.path === "display.screenWidth");
    assert.equal(initialWidth?.source, "default");

    const patch = {
      "display.screenWidth": { set: 1980 },
      "display.screenHeight": { set: 1080 },
    } as const;
    const applied = await h.app.request("/api/v1/commands", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify({
        commandId: "00000000-0000-4000-8000-000000000096",
        requestedAt: h.clock.now().toISOString(),
        requestedBy: "local-operator",
        source: "settings-surface",
        family: "settings",
        type: "apply-settings",
        target: { expectedRevision: initial.revision },
        payload: {
          settingsSchemaHash: initial.settingsSchemaHash,
          patchFingerprint: deriveSettingsPatchFingerprint(patch),
          patch,
        },
      }),
    });
    assert.equal(applied.status, 200);
    const readback = EditableSettingsWireSchema.parse(await json(await h.app.request("/api/v1/settings/editable")));
    assert.equal(readback.revision, 2);
    const persistedWidth = readback.sections.flatMap((section) => section.leaves).find((leaf) => leaf.path === "display.screenWidth");
    assert.equal(persistedWidth?.source, "settings");
    assert.equal(persistedWidth?.effectiveValue, 1980);
    assert.equal(persistedWidth?.settingsValue, 1980);
  });


});

import { OPERATOR_JSON_HEADERS, disposeHttpRouteHarness, harness, json } from "../../../../support/helpers/backend/http-route-harness.js";
afterEach(disposeHttpRouteHarness);

const portWorld = createDashboardPortTestWorld(() => {}, releaseAdmissionFixtures);
afterEach(portWorld.cleanup);

it("applies a settings revision and reads it back through the composed runtime's read lane", async () => {
  const profile = await portWorld.createProfileFixture(manualClock(new Date()));
  const runtime = await portWorld.composeDashboardRuntime({ lifetimeLock: profile.lifetime, ...profile.dashboardInput,
    frontendPortOverride: 0, backendPortOverride: 0, isolation: rebuildRuntimeIsolation, env: {}, repoRoot: profile.workspace });
  try {
    const client = createDashboardClient({ baseUrl: `http://127.0.0.1:${String(runtime.port)}` });
    const before = await client.editableSettings();
    assert.equal(before.revision, 1);
    // The lane's cached store part must not outlive the write.
    assert.deepEqual(await client.editableSettings(), before);
    const patch = settingsSetOperations({ display: { screenWidth: 1980, screenHeight: 1080 } });
    const applied = await client.applySettings({ commandId: "64646464-6464-4464-8464-646464646464", requestedAt: new Date().toISOString(),
      requestedBy: "local-operator", source: "settings-surface", family: "settings", type: "apply-settings", target: { expectedRevision: 1 },
      payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveSettingsPatchFingerprint(patch), patch } });
    assert.equal(applied.state, "applied");
    const readback = await client.editableSettings();
    assert.equal(readback.revision, 2);
    assert.equal(readback.runtimeStatus.state, "current");
    assert.equal(readback.sections.flatMap(section => section.leaves).find(leaf => leaf.path === "display.screenWidth")?.settingsValue, 1980);
  } finally { await runtime.stop(); }
});
