// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { it } from "vitest";
import { ActorIdSchema } from "../../../src/rules/identity/ids.js";
import type { FrontendBootstrapWire } from "../../../src/models/dashboard/bootstrap.js";
import type { DashboardClient } from "../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../src/dashboard/state/client-context.js";
import { useBootstrap } from "../../../src/dashboard/state/use-bootstrap.js";
import { FIXTURE_BOOTSTRAP } from "../../support/fixtures/dashboard/fixture-bootstrap.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

it("never renders a previous client's bootstrap and ignores superseded A -> B -> A replies", async () => {
  const pending: ((value: FrontendBootstrapWire) => void)[] = [];
  const makeClient = (): DashboardClient => ({ bootstrap: () => new Promise<FrontendBootstrapWire>(resolve => pending.push(resolve)) }) as DashboardClient;
  const a = makeClient(), b = makeClient();
  const seen: ReturnType<typeof useBootstrap>[] = [];
  function Probe() { seen.push(useBootstrap()); return null; }
  const root = createRoot(document.createElement("div"));
  const render = async (client: DashboardClient) => { await act(async () => { root.render(createElement(DashboardClientProvider, { client, children: createElement(Probe) })); }); };
  try {
    await render(a);
    await act(async () => { pending[0](FIXTURE_BOOTSTRAP); });
    assert.equal(seen.at(-1)?.state, "loaded");
    const start = seen.length;
    await render(b);
    assert.ok(seen.slice(start).every(resource => resource.state === "loading"));
    await render(a);
    await act(async () => { pending[1]({ ...FIXTURE_BOOTSTRAP, actor: { ...FIXTURE_BOOTSTRAP.actor, id: ActorIdSchema.parse("other-operator") } }); });
    assert.equal(seen.at(-1)?.state, "loading");
    await act(async () => { pending[2](FIXTURE_BOOTSTRAP); });
    assert.deepEqual(seen.at(-1), { state: "loaded", value: FIXTURE_BOOTSTRAP });
  } finally { await act(async () => root.unmount()); }
});

it("does not read selected bootstrap before explicit public session admission", async () => {
  let calls = 0;
  const client = { bootstrap: async () => { calls++; return FIXTURE_BOOTSTRAP; } } as DashboardClient;
  const root = createRoot(document.createElement("div"));
  let state!: ReturnType<typeof useBootstrap>;
  const current = () => state;
  function Probe({ enabled }: { enabled: boolean }) { state = useBootstrap(undefined, enabled); return null; }
  const render = async (enabled: boolean) => { await act(async () => root.render(createElement(DashboardClientProvider,
    { client, children: createElement(Probe, { enabled }) }))); };
  try {
    await render(false); assert.equal(calls, 0); assert.equal(current().state, "loading");
    await render(true); assert.equal(calls, 1); assert.equal(current().state, "loaded");
    await render(false); assert.equal(calls, 1); assert.equal(current().state, "loading");
  } finally { await act(async () => root.unmount()); }
});
