// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act } from "react";
import { type Root } from "react-dom/client";
import { afterEach,describe,it } from "vitest";
import { createSettingsQueries } from "../../../../src/dashboard/client/queries/settings-queries.js";
import { createDashboardTransport } from "../../../../src/dashboard/client/transport.js";
import { NativePathPickerRequestSchema,type NativePathPickerResponse } from "../../../../src/models/dashboard/native-path-picker.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
let root: Root | undefined;
let host: HTMLElement | undefined;
afterEach(() => { if (root !== undefined) act(() => root?.unmount()); host?.remove(); root = undefined; host = undefined; });

describe("native Paths picker client", () => {
  it("uses one guarded POST and preserves selected, cancellation, and typed unavailable states", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const responses: { status: number; body: NativePathPickerResponse }[] = [
      { status: 200, body: { state: "selected", field: "paths.stateRoot", path: "/tmp/new-state" } },
      { status: 200, body: { state: "cancelled", field: "paths.stateRoot" } },
      { status: 409, body: { state: "unavailable", field: "paths.stateRoot", reason: "busy" } },
      { status: 503, body: { state: "unavailable", field: "paths.stateRoot", reason: "timeout" } },
      { status: 503, body: { state: "unavailable", field: "paths.stateRoot", reason: "unsupported-platform" } },
    ];
    const queries = createSettingsQueries(createDashboardTransport({ baseUrl: "http://127.0.0.1:4371",
      fetchImpl: (url, init) => {
        calls.push({ url, init });
        const next = responses.shift(); if (next === undefined) throw new Error("unexpected picker retry");
        return Promise.resolve(new Response(JSON.stringify(next.body), { status: next.status }));
      } }));
    for (const state of ["selected", "cancelled", "unavailable", "unavailable", "unavailable"]) {
      assert.equal((await queries.pickSettingsPath({ field: "paths.stateRoot", initialPath: "/tmp/state" })).state, state);
    }
    assert.equal(calls.length, 5);
    assert.ok(calls.every(call => call.url === "http://127.0.0.1:4371/api/v1/settings/path-picker" && call.init?.method === "POST"));
    assert.ok(calls.every(call => new Headers(call.init?.headers).get("origin") === "http://127.0.0.1:4371"));
    assert.ok(calls.every(call => typeof call.init?.body === "string"
      && NativePathPickerRequestSchema.parse(JSON.parse(call.init.body) as unknown).field === "paths.stateRoot"));
  });

  it("rejects a selected path for a different field", async () => {
    const queries = createSettingsQueries(createDashboardTransport({ baseUrl: "http://127.0.0.1:4371",
      fetchImpl: () => Promise.resolve(new Response(JSON.stringify({ state: "selected", field: "paths.artifactRoot", path: "/tmp/other" }), { status: 200 })) }));
    await assert.rejects(queries.pickSettingsPath({ field: "paths.stateRoot" }), /selected field differs/u);
  });
});
