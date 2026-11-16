import { Hono } from "hono";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { afterEach,describe,it } from "vitest";
import { createNativePathPicker,type NativePickerExecutor } from "../../../src/backend/transports/http/native-path-picker.js";
import { operatorMutationIngressGuard } from "../../../src/backend/transports/http/routes/operator-mutation-ingress.js";
import type { SettingsRouteDeps } from "../../../src/backend/transports/http/routes/settings-types.js";
import { registerSettingsRoutes } from "../../../src/backend/transports/http/routes/settings.js";
import { NativePathPickerRequestSchema,NativePathPickerResponseSchema } from "../../../src/models/dashboard/native-path-picker.js";
import type { ActorId } from "../../../src/rules/identity/ids.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("Settings native picker route", () => {
  const minimal = {} as Pick<SettingsRouteDeps, "settings" | "settingsEditor">;
  const headers = { host: "127.0.0.1:3210", origin: "http://127.0.0.1:3210", "content-type": "application/json" };
  function appWith(execute: NativePickerExecutor) {
    const app = new Hono<{ Variables: { requestActorId: ActorId } }>();
    app.use("/api/v1/settings/path-picker", operatorMutationIngressGuard);
    registerSettingsRoutes(app, { ...minimal, nativePathPicker: createNativePathPicker({ platform: "darwin", execute }) });
    return app;
  }
  it("admits Host, Origin and JSON media type before any dialog", async () => {
    let calls = 0;
    const app = appWith(async () => { calls += 1; return { state: "exited", code: 0, stdout: "__HRAUTO_NATIVE_PICKER_CANCELLED__\n" }; });
    const body = JSON.stringify({ field: "paths.reportsDir" });
    for (const [input, code] of [
      [{ host: headers.host, "content-type": headers["content-type"] }, 403],
      [{ ...headers, origin: "http://evil.example" }, 403],
      [{ ...headers, "content-type": "text/plain" }, 415],
    ] as const) {
      const response = await app.request("http://127.0.0.1:3210/api/v1/settings/path-picker", { method: "POST", headers: input, body });
      assert.equal(response.status, code);
    }
    assert.equal(calls, 0);
    const accepted = await app.request("http://127.0.0.1:3210/api/v1/settings/path-picker", { method: "POST", headers, body });
    assert.equal(accepted.status, 200);
    assert.deepEqual(NativePathPickerResponseSchema.parse(await accepted.json()), { state: "cancelled", field: "paths.reportsDir" });
    assert.equal(calls, 1);
  });

  it("rejects unknown fields and unsafe hints before any dialog", async () => {
    let calls = 0;
    const app = appWith(async () => { calls += 1; return { state: "failed" }; });
    assert.equal(NativePathPickerRequestSchema.safeParse({ field: "paths.unknown" }).success, false);
    assert.equal(NativePathPickerRequestSchema.safeParse({ field: "paths.duoCredential" }).success, false);
    const response = await app.request("http://127.0.0.1:3210/api/v1/settings/path-picker", { method: "POST", headers,
      body: JSON.stringify({ field: "paths.i9CheckTrackerPath", initialPath: "relative/file" }) });
    assert.equal(response.status, 400);
    assert.equal((await response.json() as { code: string }).code, "NATIVE_PATH_HINT_INVALID");
    assert.equal(calls, 0);
  });
});
