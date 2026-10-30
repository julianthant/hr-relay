// @vitest-environment jsdom
import assert_m0 from "node:assert/strict";
import { act as act_m0 } from "react";
import { type Root as Root_m0 } from "react-dom/client";
import { afterEach as afterEach_m0,describe as describe_m0,it as it_m0 } from "vitest";
import { DashboardClientError as DashboardClientError_m0 } from "../../../src/dashboard/client/errors.js";
import { observeAsyncResource as observeAsyncResource_m0,type AsyncResource as AsyncResource_m0 } from "../../../src/dashboard/state/async-resource.js";
// @vitest-environment jsdom
import assert_m1 from "node:assert/strict";
import { act as act_m1,createElement as createElement_m1 } from "react";
import { createRoot as createRoot_m1,type Root as Root_m1 } from "react-dom/client";
import { it as it_m1 } from "vitest";
import { DashboardClientError as DashboardClientError_m1 } from "../../../src/dashboard/client/errors.js";
import { FixtureCommandBinding } from "../../support/helpers/dashboard/command-binding.js";
import type { DashboardClient as DashboardClient_m1 } from "../../../src/dashboard/client/index.js";
import { DashboardClientProvider as DashboardClientProvider_m1 } from "../../../src/dashboard/state/client-context.js";
import type { SettingsSaveNotice as SettingsSaveNotice_m1 } from "../../../src/dashboard/surfaces/settings/editor/settings-attempt-model.js";
import { useStorageRelocation as useStorageRelocation_m1 } from "../../../src/dashboard/surfaces/settings/general/settings-relocation-model.js";
import { FixedStorageRows as FixedStorageRows_m1 } from "../../../src/dashboard/surfaces/settings/general/settings-relocation.js";
import { StorageRelocationPlanViewSchema as StorageRelocationPlanViewSchema_m1 } from "../../../src/rules/commands/commands.js";


{


Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

let root: Root_m0 | undefined;
let host: HTMLDivElement | undefined;
const _afterEachFixture0 = () => {
  act_m0(() => root?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
};

describe_m0("effect-owned resource settlement", () => {
afterEach_m0(_afterEachFixture0);

  it_m0("keeps value and error identities and revokes both outcomes from superseded requests", async () => {
    const old = deferred<object>();
    const current = deferred<object>();
    const outcomes: AsyncResource_m0<object>[] = [];
    const cancel = observeAsyncResource_m0(() => old.promise, value => outcomes.push(value));
    cancel();
    const close = observeAsyncResource_m0(() => current.promise, value => outcomes.push(value));
    const value = Object.freeze({ id: "new" });
    current.resolve(value);
    old.reject(new DashboardClientError_m0({ kind: "network", message: "old failure" }));
    await Promise.resolve();
    assert_m0.equal(outcomes.length, 1);
    assert_m0.equal(outcomes[0]?.state, "loaded");
    if (outcomes[0]?.state !== "loaded") throw new Error("new read did not settle");
    assert_m0.equal(outcomes[0].value, value);
    close();

    const failedRead = deferred<object>();
    const error = new DashboardClientError_m0({ kind: "network", message: "current failure" });
    observeAsyncResource_m0(() => failedRead.promise, result => outcomes.push(result));
    failedRead.reject(error);
    await Promise.resolve();
    assert_m0.equal(outcomes[1]?.state, "failed");
    if (outcomes[1]?.state !== "failed") throw new Error("failure was swallowed");
    assert_m0.equal(outcomes[1].error, error);
  });
});
}

{


Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
const SOURCE = { stateRoot: "/tmp/fixture-state", artifactRoot: "/tmp/fixture-artifacts" };
const INITIAL = StorageRelocationPlanViewSchema_m1.parse({ revision: 0, installationId: "11111111-1111-4111-8111-111111111111",
  sourceGeneration: 0, sourcePair: SOURCE, pending: null });
let root: Root_m1 | undefined;
let host: HTMLElement | undefined;
let currentController: ReturnType<typeof useStorageRelocation_m1> | undefined;
const _afterEachFixture0 = () => { if (root !== undefined) act_m1(() => root?.unmount()); host?.remove(); root = undefined; host = undefined; currentController = undefined; };

async function mount(client: DashboardClient_m1) {
  const notices: SettingsSaveNotice_m1[] = [];
  host = document.createElement("div"); document.body.append(host); root = createRoot_m1(host);
  let controller: ReturnType<typeof useStorageRelocation_m1> | undefined;
  function Surface() { controller = useStorageRelocation_m1({ actorId: "local-operator", onSaved: notice => notices.push(notice) }); currentController = controller; return createElement_m1(FixedStorageRows_m1, { editor: controller }); }
  await act_m1(async () => { root?.render(createElement_m1(DashboardClientProvider_m1, { client, children: createElement_m1(FixtureCommandBinding, { actorId: "local-operator", children: createElement_m1(Surface) }) })); });
  await act_m1(async () => undefined);
  if (controller === undefined) throw new Error("relocation-controller-missing");
  return { notices, controller: () => { if (controller === undefined) throw new Error("relocation-controller-missing"); return controller; }, host };
}
async function edit(label: string, value: string) {
  if (currentController === undefined) throw new Error(`missing ${label} controller`);
  const field = label === "Runtime state folder" ? "stateRoot" : "artifactRoot";
  await act_m1(async () => currentController?.update(field, value));
}
async function idle() { await act_m1(async () => { await new Promise(resolve => setTimeout(resolve, 750)); }); }

it_m1("clears a typed before-effect refusal but retains an unknown relocation attempt", async () => {
try {


  const commands: unknown[] = [];
  let beforeEffect = true;
  const client = { storageRelocationPlans: () => Promise.resolve(INITIAL),
    executeCommand: (command: unknown) => {
      commands.push(structuredClone(command));
      return Promise.reject(beforeEffect
        ? new DashboardClientError_m1({ kind: "http", status: 403, code: "OPERATOR_MUTATION_ORIGIN_REFUSED", message: "synthetic admission refusal" })
        : new Error("synthetic unknown effect"));
    },
  } as unknown as DashboardClient_m1;
  const surface = await mount(client);
  await edit("Artifact folder", "/tmp/refused-artifacts"); await idle();
  assert_m1.equal(surface.controller().save.state, "refused");
  assert_m1.equal(surface.controller().dirtyCount, 1);
  beforeEffect = false;
  await edit("Artifact folder", "/tmp/unknown-artifacts"); await idle();
  assert_m1.equal(surface.controller().save.state, "unconfirmed");
  assert_m1.notDeepEqual(commands[0], commands[1]);
  await edit("Artifact folder", "/tmp/ignored-artifacts");
  await act_m1(async () => surface.controller().retry());
  assert_m1.deepEqual(commands[2], commands[1]);
  assert_m1.equal(surface.controller().save.state, "unconfirmed");

} finally {
_afterEachFixture0();
}
});
}
