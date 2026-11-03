import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import { createDashboardClient } from "../../../src/dashboard/client/index.js";

describe("handled dashboard failure reports", () => {
  it.each(["http", "network", "refused", "schema", "settings-network", "preflight-http"])("reports %s with metadata and preserves the original settlement", async kind => {
    const reports: unknown[] = [];
    const requests: string[] = [];
    const client = createDashboardClient({ baseUrl: "http://relay.test", surface: () => "settings",
      fetchImpl: async (url, init) => {
        requests.push(url);
        if (url.endsWith("/debug/errors")) { const body = init?.body; assert.ok(typeof body === "string"); reports.push(JSON.parse(body)); return Response.json({ state: "recorded" }); }
        if (kind === "network" || kind === "settings-network") throw new Error("PRIVATE_NAME PRIVATE_EID PRIVATE_CREDENTIAL");
        if (kind === "schema") return Response.json({ state: "PRIVATE_PAGE_TEXT" });
        if (kind === "refused") return Response.json({ state: "refused", code: "PROFILE_SESSION_STALE" });
        return Response.json({ state: "error", code: "PROFILE_SESSION_STALE", message: "PRIVATE_NAME", retryable: false }, { status: 503 });
      } });
    const operation = kind === "http" || kind === "settings-network" ? client.editableSettings()
      : kind === "preflight-http" ? client.readPreflight() : client.readProfileSession();
    if (kind === "refused") assert.deepEqual(await operation, { state: "refused", code: "PROFILE_SESSION_STALE" });
    else await assert.rejects(operation);
    await vi.waitFor(() => assert.equal(reports.length, 1));
    const serialized = JSON.stringify(reports);
    assert.equal(serialized.includes("PRIVATE_"), false);
    assert.match(serialized, /settings/u);
    if (kind === "schema") assert.match(serialized, /client:readProfileSession/u);
    assert.equal(requests.filter(url => url.endsWith("/debug/errors")).length, 1);
    assert.equal(Object.isFrozen(client), true);
  });
  it("surfaces report delivery failure once without recursively reporting it", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const requests: string[] = [];
    try {
      const client = createDashboardClient({ baseUrl: "http://relay.test", surface: () => "settings",
        fetchImpl: async url => { requests.push(url); throw new Error("PRIVATE_CREDENTIAL"); } });
      await assert.rejects(client.readProfileSession());
      await vi.waitFor(() => assert.equal(error.mock.calls.length, 1));
      assert.deepEqual(error.mock.calls, [["DASHBOARD_ERROR_REPORT_UNAVAILABLE"]]);
      assert.equal(requests.length, 2);
    } finally { error.mockRestore(); }
  });
});
