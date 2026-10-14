import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { createDashboardClient, DashboardClientError } from "../../../src/dashboard/client/index.js";
import { planRelocationCommand } from "../../../src/dashboard/surfaces/settings/general/settings-relocation-model.js";
import { StorageRelocationCommandRequestSchema,StorageRelocationPlanViewSchema } from "../../../src/rules/commands/commands.js";
import { FIXTURE_STORAGE_RELOCATION } from "../../parity/helpers/fixture-settings.js";

describe("Settings editor client", () => {
  it("asks the BFF for the server-listed editable inventory", async () => {
    const requests: string[] = [];
    const client = createDashboardClient({
      baseUrl: "http://bff.test",
      fetchImpl: async (input) => {
        requests.push(input);
        return new Response(JSON.stringify({}), { status: 200 });
      },
    });

    await assert.rejects(client.editableSettings(), /GET \/api\/v1\/settings\/editable/);
    assert.deepEqual(requests, ["http://bff.test/api/v1/settings/editable"]);
  });
  it("parses the separate relocation view and refuses an invalid shape", async () => {
    let valid = true;
    const client = createDashboardClient({ baseUrl: "http://bff.test", fetchImpl: async (url) => {
      assert.equal(url, "http://bff.test/api/v1/settings/storage-relocation");
      return Response.json(valid ? FIXTURE_STORAGE_RELOCATION : { ...FIXTURE_STORAGE_RELOCATION, pending: {} });
    } });
    assert.deepEqual(await client.storageRelocationPlans(), FIXTURE_STORAGE_RELOCATION);
    valid = false;
    await assert.rejects(client.storageRelocationPlans(), /GET \/api\/v1\/settings\/storage-relocation/u);
  });
  it("posts a strict plan through the authenticated command route", async () => {
    const requests: unknown[] = [];
    const client = createDashboardClient({ baseUrl: "http://bff.test", fetchImpl: async (url, init) => {
      assert.equal(url, "http://bff.test/api/v1/commands");
      assert.equal(init?.method, "POST");
      if (typeof init?.body !== "string") throw new Error("JSON command body missing");
      const body: unknown = JSON.parse(init.body); requests.push(body);
      const parsed = StorageRelocationCommandRequestSchema.parse(body);
      return Response.json({ state: "applied", commandId: parsed.commandId, affectedTargets: [{ family: "storage-relocation", revision: 1 }] });
    } });
    await assert.rejects(client.applyStorageRelocation({ family: "storage-relocation", type: "plan-storage-relocation" }));
    assert.equal(requests.length, 0);
    const command = planRelocationCommand(StorageRelocationPlanViewSchema.parse(FIXTURE_STORAGE_RELOCATION),
      { stateRoot: "/tmp/new-state", artifactRoot: "/tmp/new-artifacts" }, "local-operator", "2026-08-03T12:00:00.000Z");
    assert.equal((await client.applyStorageRelocation(command)).state, "applied");
    assert.deepEqual(requests, [command]);
  });
});


it.each(["settings", "relocation"])("validates %s reply identity and retains the offending reply", async family => {
  const hash = "d".repeat(64);
  const command = family === "settings" ? { commandId: "11111111-1111-4111-8111-111111111111", requestedAt: "2026-08-03T12:00:00.000Z",
    requestedBy: "local-operator", source: "dashboard", family: "settings", type: "apply-settings", target: { expectedRevision: 1 },
    payload: { settingsSchemaHash: hash, patchFingerprint: hash, patch: { "timeouts.navigationMs": { set: 2000 } } } }
    : planRelocationCommand(StorageRelocationPlanViewSchema.parse(FIXTURE_STORAGE_RELOCATION),
      { stateRoot: "/tmp/new-state", artifactRoot: "/tmp/new-artifacts" }, "local-operator", "2026-08-03T12:00:00.000Z");
  let wrongId = true;
  let wrongTarget = false;
  let malformed = false;
  let reply: unknown;
  const client = createDashboardClient({ baseUrl: "http://bff.test", fetchImpl: async () => {
    reply = malformed ? {} : { state: "applied", commandId: wrongId ? "99999999-9999-4999-8999-999999999999" : command.commandId,
      affectedTargets: [{ family: wrongTarget ? "storage-relocation" : family === "settings" ? "settings" : "storage-relocation", revision: 2 }],
      ...(family === "settings" && !wrongTarget ? { restartRequired: false, settingsRevision: 2, settingsFingerprint: hash } : {}) };
    return Response.json(reply);
  } });
  const send = () => family === "settings" ? client.applySettings(command) : client.applyStorageRelocation(command);
  await assert.rejects(send(), (error: unknown) => error instanceof DashboardClientError && error.code === "COMMAND_RESULT_IDENTITY_MISMATCH"
    && JSON.stringify(error.cause) === JSON.stringify(reply));
  wrongId = false;
  assert.equal((await send()).state, "applied");
  if (family === "settings") {
    wrongTarget = true;
    await assert.rejects(send(), (error: unknown) => error instanceof DashboardClientError && error.code === "COMMAND_RESULT_IDENTITY_MISMATCH");
  }
  malformed = true;
  await assert.rejects(send(), (error: unknown) => error instanceof DashboardClientError && error.kind === "schema" && error.cause !== undefined);
});
