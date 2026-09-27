import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { createDashboardClient } from "../../../src/dashboard/client/index.js";
import { FIXTURE_STORAGE_RELOCATION } from "../../parity/helpers/fixture-settings.js";
import { StorageRelocationCommandRequestSchema, StorageRelocationPlanViewSchema } from "../../../src/domain/commands.js";
import { planRelocationCommand } from "../../../src/dashboard/surfaces/settings-relocation-model.js";

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
      { stateRoot: "/tmp/new-state", artifactRoot: "/tmp/new-artifacts" }, "local-operator");
    assert.equal((await client.applyStorageRelocation(command)).state, "applied");
    assert.deepEqual(requests, [command]);
  });
});
