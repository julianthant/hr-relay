// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { it } from "vitest";
import { z } from "zod";
import { createDashboardClient } from "../../../../src/dashboard/client/index.js";
import { DuoReenrolStateSchema, PublicProfileStateSchema } from "../../../../src/models/profiles/public-profile.js";
import { useDuoReenrol } from "../../../../src/dashboard/surfaces/shell/onboarding-model.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
const operationId = "00000000-0000-4000-8000-000000000001", profileId = "00000000-0000-4000-8000-000000000003";
const idle = { state: "idle", ceremonyObserved: false, portalAccepted: false, operatorConfirmed: false, exactCredentialRequestObserved: false };
const draft = DuoReenrolStateSchema.parse({ state: "duo-reenrol", operationId, profileId, step: "duo", methods: { key: idle, touch: idle }, browser: { state: "open", generation: 0 } });
const active = PublicProfileStateSchema.parse({ state: "active", profileId, epoch: 2, duoState: "ready" });

async function fixture(routes: Record<string, () => Response>) {
  const calls: { path: string; body: unknown }[] = [];
  const client = createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async (url, init) => {
    const path = new URL(url).pathname;
    calls.push({ path, body: init?.body === undefined ? undefined : JSON.parse(z.string().parse(init.body)) });
    const route = routes[path];
    if (!route) throw new Error(`unexpected ${path}`);
    return route();
  } });
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  let reenrol!: ReturnType<typeof useDuoReenrol>;
  function Probe() { reenrol = useDuoReenrol(client, true); return createElement("output", null, reenrol.port?.onboarding?.state ?? "closed"); }
  await act(async () => root.render(createElement(Probe)));
  return { calls, reenrol: () => reenrol, async close() { await act(async () => root.unmount()); host.remove(); } };
}

it("opens a served re-enrolment as the setup window's draft, never a mock", async () => {
  const f = await fixture({ "/api/v1/profile/duo/reenrol/begin": () => Response.json(draft), "/api/v1/profile/duo/reenrol/read": () => Response.json(draft) });
  try {
    assert.equal(f.reenrol().port, undefined);
    assert.equal(await act(() => f.reenrol().begin()), undefined);
    const port = f.reenrol().port;
    assert.equal(port?.source, "served");
    assert.equal(port?.reenrol, true);
    assert.equal(port?.onboarding?.operationId, operationId);
  } finally { await f.close(); }
});

it("shows the backend's text for a refused begin and opens nothing", async () => {
  const f = await fixture({ "/api/v1/profile/duo/reenrol/begin": () => Response.json({ state: "refused", code: "PROFILE_DUO_REENROL_OPEN" }, { status: 409 }) });
  try {
    const failure = await act(() => f.reenrol().begin());
    assert.equal(typeof failure, "string");
    assert.equal(f.reenrol().port, undefined);
  } finally { await f.close(); }
});

it("commits through the served route and closes the window", async () => {
  const f = await fixture({ "/api/v1/profile/duo/reenrol/begin": () => Response.json(draft), "/api/v1/profile/duo/reenrol/read": () => Response.json(draft), "/api/v1/profile/duo/reenrol/commit": () => Response.json(active) });
  try {
    await act(() => f.reenrol().begin());
    const result = await act(() => f.reenrol().port!.complete());
    assert.equal(result.state, "active");
    assert.ok(f.calls.some(call => call.path === "/api/v1/profile/duo/reenrol/commit" && JSON.stringify(call.body) === JSON.stringify({ operationId })));
    assert.equal(f.reenrol().port, undefined);
  } finally { await f.close(); }
});

it("keeps the window open and rethrows when the commit is refused", async () => {
  const f = await fixture({ "/api/v1/profile/duo/reenrol/begin": () => Response.json(draft), "/api/v1/profile/duo/reenrol/read": () => Response.json(draft), "/api/v1/profile/duo/reenrol/commit": () => Response.json({ state: "refused", code: "PROFILE_DUO_REENROL_OPEN" }, { status: 409 }) });
  try {
    await act(() => f.reenrol().begin());
    await act(async () => { await assert.rejects(f.reenrol().port!.complete()); });
    assert.equal(f.reenrol().port?.onboarding?.operationId, operationId);
  } finally { await f.close(); }
});

it("cancels through the served route and closes the window", async () => {
  const f = await fixture({ "/api/v1/profile/duo/reenrol/begin": () => Response.json(draft), "/api/v1/profile/duo/reenrol/read": () => Response.json(draft), "/api/v1/profile/duo/reenrol/cancel": () => Response.json(active) });
  try {
    await act(() => f.reenrol().begin());
    await act(() => f.reenrol().port!.cancel());
    assert.equal(f.reenrol().port, undefined);
  } finally { await f.close(); }
});
