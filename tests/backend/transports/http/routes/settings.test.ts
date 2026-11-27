import { Hono } from "hono";
import assert from "node:assert/strict";
import { describe,it } from "vitest";
import type { SettingsRouteDeps } from "../../../../../src/backend/transports/http/routes/settings-types.js";
import { registerSettingsRoutes } from "../../../../../src/backend/transports/http/routes/settings.js";
import type { ActorId } from "../../../../../src/rules/identity/ids.js";

describe("fixed Settings storage route", () => {
  it("has no relocation read or write route", async () => {
    const app = new Hono<{ Variables: { requestActorId: ActorId } }>();
    registerSettingsRoutes(app, {} as Pick<SettingsRouteDeps, "settings" | "settingsEditor">);
    for (const method of ["GET", "POST"]) {
      const response = await app.request("/api/v1/settings/storage-relocation", { method });
      assert.equal(response.status, 404);
    }
  });
});
