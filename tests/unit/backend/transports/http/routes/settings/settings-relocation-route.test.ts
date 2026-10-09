import assert from "node:assert/strict";
import { Hono } from "hono";
import { describe, it } from "vitest";
import { registerSettingsRoutes } from "../../../../../../../src/backend/transports/http/routes/settings.js";
import type { SettingsRouteDeps } from "../../../../../../../src/backend/transports/http/routes/settings-types.js";
import { StorageRelocationPlanViewSchema } from "../../../../../../../src/rules/commands/commands.js";
import type { ActorId } from "../../../../../../../src/rules/identity/ids.js";
import { FIXTURE_STORAGE_RELOCATION } from "../../../../../../support/fixtures/dashboard/fixture-settings.js";

describe("Settings relocation query route", () => {
  const minimal = {} as Pick<SettingsRouteDeps, "settings" | "settingsEditor">;
  it("returns a distinct unavailable error without a composed reader", async () => {
    const app = new Hono<{ Variables: { requestActorId: ActorId } }>();
    registerSettingsRoutes(app, minimal);
    const response = await app.request("/api/v1/settings/storage-relocation");
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { state: "error", code: "STORAGE_RELOCATION_UNAVAILABLE", message: "Storage relocation plan reader is unavailable", retryable: false });
  });
  it("serves only the strict reader projection", async () => {
    const app = new Hono<{ Variables: { requestActorId: ActorId } }>();
    registerSettingsRoutes(app, { ...minimal, storageRelocationPlans: { read: () => StorageRelocationPlanViewSchema.parse(FIXTURE_STORAGE_RELOCATION) } });
    const response = await app.request("/api/v1/settings/storage-relocation");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), FIXTURE_STORAGE_RELOCATION);
  });
});
