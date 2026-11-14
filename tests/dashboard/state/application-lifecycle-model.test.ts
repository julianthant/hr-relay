// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { it } from "vitest";
import { createDashboardClient, DashboardClientError } from "../../../src/dashboard/client/index.js";
import { useApplicationLifecycle } from "../../../src/dashboard/state/application-lifecycle-model.js";
import { ApplicationLifecycleSchema } from "../../../src/models/dashboard/application-lifecycle.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

it("discards late lifecycle reads after the authority changes", async () => {
  const replies = [Promise.withResolvers<Response>(), Promise.withResolvers<Response>()];
  let reads = 0, authority = {};
  const client = createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: () => replies[reads++].promise });
  let result: ReturnType<typeof useApplicationLifecycle> | undefined;
  function Probe() { result = useApplicationLifecycle(client, authority); return null; }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(createElement(Probe)));
    authority = {};
    await act(async () => root.render(createElement(Probe)));
    const response = (generation: number) => Response.json({ runtimeGeneration: generation, state: "ready", pause: "running", targets: [], update: "installer-unavailable" });
    await act(async () => { replies[1].resolve(response(2)); });
    assert.equal(result?.resource.state, "loaded");
    await act(async () => { replies[0].resolve(response(1)); });
    assert.equal(result?.resource.state === "loaded" && result.resource.value.runtimeGeneration, 2);
  } finally { await act(async () => root.unmount()); }
});

it("exposes read failure until the operator refreshes, without retaining old authority", async () => {
  let fail = true;
  const transport = createDashboardClient({ baseUrl: "http://fixture.test" });
  const client = { ...transport, async applicationLifecycle() {
    if (fail) throw new DashboardClientError({ kind: "http", status: 503, code: "DASHBOARD_READ_FAILED", message: "fixture failure" });
    return ApplicationLifecycleSchema.parse({ runtimeGeneration: 2, state: "ready", pause: "running", targets: [], update: "installer-unavailable" });
  } };
  const authority = {};
  let result: ReturnType<typeof useApplicationLifecycle> | undefined;
  function Probe() { result = useApplicationLifecycle(client, authority); return null; }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(createElement(Probe)));
    assert.equal(result?.resource.state, "failed");
    fail = false;
    await act(async () => result?.refresh());
    assert.equal(result?.resource.state, "loaded");
  } finally { await act(async () => root.unmount()); }
});
