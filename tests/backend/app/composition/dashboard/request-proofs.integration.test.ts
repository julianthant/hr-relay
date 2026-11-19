import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { it } from "vitest";
import { composeSettings } from "../../../../../src/backend/app/composition/dashboard/settings.js";
import { activeSettingsRuntimeIdentity } from "../../../../../src/backend/runtime/settings/settings-runtime.js";
import type { DashboardApp } from "../../../../../src/backend/transports/http/routes/api-types.js";
import { registerSettingsRoutes } from "../../../../../src/backend/transports/http/routes/settings.js";
import { hostConfigFacts } from "../../../../../src/models/config/host-display.js";
import { EditableSettingsWireSchema } from "../../../../../src/models/dashboard/settings-editor.js";
import { SettingsFactsWireSchema } from "../../../../../src/models/dashboard/settings.js";
import { manualClock } from "../../../../../src/rules/time/clock.js";
import { seedInitialSettingsRuntimeConfig } from "../../../../support/fixtures/operator-command-fixtures.js";
import { openBoundDatabaseFixture } from "../../../../support/helpers/admission-fixture.js";
import { createCredentialStore } from "../../../../support/helpers/synthetic-storage-admission.js";

it("serves the same Settings facts and editable settings while another connection holds the writer reservation", async () => {
  const clock = manualClock(new Date("2026-10-01T12:00:00Z"));
  const fixture = await openBoundDatabaseFixture("request-proofs", clock);
  let writer: DatabaseSync | undefined;
  try {
    seedInitialSettingsRuntimeConfig(fixture.database, clock);
    const { routes } = composeSettings({ database: fixture.database, clock, environment: {}, hostFacts: hostConfigFacts({}),
      active: activeSettingsRuntimeIdentity, credentials: createCredentialStore({ stateRoot: fixture.stateRoot }),
      assertCurrent: () => fixture.profile.admission.assertProfileRuntime() });
    const app: DashboardApp = new Hono();
    app.onError(error => { throw error; });
    registerSettingsRoutes(app, routes);
    const read = async () => {
      const facts = await app.request("/api/v1/settings/facts");
      assert.equal(facts.status, 200);
      const editable = await app.request("/api/v1/settings/editable");
      assert.equal(editable.status, 200);
      return [SettingsFactsWireSchema.parse(await facts.json()), EditableSettingsWireSchema.parse(await editable.json())];
    };
    const expected = await read();
    writer = new DatabaseSync(fixture.path);
    writer.exec("BEGIN IMMEDIATE");
    assert.deepEqual(await read(), expected);
  } finally {
    writer?.close();
    await fixture.close();
  }
});
