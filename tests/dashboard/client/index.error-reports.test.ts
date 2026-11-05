import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import { createDashboardClient } from "../../../src/dashboard/client/index.js";
import { DashboardReportDeliveryError } from "../../../src/dashboard/client/errors.js";

const active = { state: "active", profileId: "00000000-0000-4000-8000-000000000001", epoch: 1, duoState: "ready" };

describe("handled dashboard failure reports", () => {
  it.each(["http", "network", "refused", "schema", "settings-network", "preflight-http"])("reports %s with metadata and preserves the original settlement", async kind => {
    const reports: unknown[] = [];
    const requests: string[] = [];
    let activated = false;
    const client = createDashboardClient({ baseUrl: "http://relay.test", surface: () => "settings",
      fetchImpl: async (url, init) => {
        requests.push(url);
        if (!activated && url.endsWith("/profile/state")) { activated = true; return Response.json(active); }
        if (url.endsWith("/debug/errors")) { const body = init?.body; assert.ok(typeof body === "string"); reports.push(JSON.parse(body)); return Response.json({ state: "recorded" }); }
        if (kind === "network" || kind === "settings-network") throw new Error("PRIVATE_NAME PRIVATE_EID PRIVATE_CREDENTIAL");
        if (kind === "schema") return Response.json({ state: "PRIVATE_PAGE_TEXT" });
        if (kind === "refused") return Response.json({ state: "refused", code: "PROFILE_SESSION_STALE" });
        return Response.json({ state: "error", code: "PROFILE_SESSION_STALE", message: "PRIVATE_NAME", retryable: false }, { status: 503 });
      } });
    await client.readProfileSession();
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
    const surfaced: Error[] = [];
    vi.stubGlobal("window", { reportError: (error: Error) => { surfaced.push(error); } });
    const requests: string[] = [];
    try {
      const client = createDashboardClient({ baseUrl: "http://relay.test", surface: () => "settings",
        fetchImpl: async url => { requests.push(url); if (requests.length === 1) return Response.json(active); throw new Error("PRIVATE_CREDENTIAL"); } });
      await client.readProfileSession();
      await assert.rejects(client.readProfileSession());
      await vi.waitFor(() => assert.equal(surfaced.length, 1));
      assert.ok(surfaced[0] instanceof DashboardReportDeliveryError);
      assert.equal(surfaced[0].code, "DASHBOARD_ERROR_REPORT_UNAVAILABLE");
      assert.equal(surfaced[0].message, "Dashboard error report was not recorded");
      assert.equal(requests.length, 3);
    } finally { vi.unstubAllGlobals(); }
  });
  it.each(["initial", "signed-out", "logout", "stale"])("does not send authenticated reports while %s", async phase => {
    const requests: string[] = [];
    let state: unknown = phase === "initial" ? { state: "signed-out" } : active;
    const client = createDashboardClient({ baseUrl: "http://relay.test", surface: () => "app", fetchImpl: async url => {
      requests.push(url);
      if (url.endsWith("/profile/state") || url.endsWith("/profile/logout")) return Response.json(state);
      return Response.json({ state: "refused", code: "PROFILE_SESSION_STALE" }, { status: 401 });
    } });
    await client.readProfileSession();
    if (phase === "signed-out") { state = { state: "signed-out" }; await client.readProfileSession(); }
    if (phase === "logout") { state = { state: "signed-out" }; await client.logOutProfile(); }
    await assert.rejects(client.editableSettings());
    await client.reportError({ reportId: crypto.randomUUID(), clientId: crypto.randomUUID(), release: "dashboard",
      route: "/", surface: "app", code: "DASHBOARD_UNHANDLED_ERROR", message: "Synthetic page failure" });
    assert.equal(requests.some(url => url.endsWith("/debug/errors")), false);
  });
});
