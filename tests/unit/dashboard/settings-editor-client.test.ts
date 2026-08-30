import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { createDashboardClient } from "../../../src/dashboard/client/index.js";

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
});
