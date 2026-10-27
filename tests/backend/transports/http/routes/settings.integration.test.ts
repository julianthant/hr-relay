
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { deriveSettingsPatchFingerprint } from "../../../../../src/models/config/settings.js";
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
