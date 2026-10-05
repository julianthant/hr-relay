// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, it } from "vitest";
import { DashboardClientError } from "../../../src/dashboard/client/errors.js";
import { observeAsyncResource, observeResource, type AsyncResource } from "../../../src/dashboard/state/async-resource.js";
import { useSavedResource, type SavedResource } from "../../../src/dashboard/surfaces/archive/archive-report-model.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
});

describe("effect-owned resource settlement", () => {
  it("keeps value and error identities and revokes both outcomes from superseded requests", async () => {
    const old = deferred<object>();
    const current = deferred<object>();
    const outcomes: AsyncResource<object>[] = [];
    const cancel = observeAsyncResource(() => old.promise, value => outcomes.push(value));
    cancel();
    const close = observeAsyncResource(() => current.promise, value => outcomes.push(value));
    const value = Object.freeze({ id: "new" });
    current.resolve(value);
    old.reject(new DashboardClientError({ kind: "network", message: "old failure" }));
    await Promise.resolve();
    assert.equal(outcomes.length, 1);
    assert.equal(outcomes[0]?.state, "loaded");
    if (outcomes[0]?.state !== "loaded") throw new Error("new read did not settle");
    assert.equal(outcomes[0].value, value);
    close();

    const failedRead = deferred<object>();
    const error = new DashboardClientError({ kind: "network", message: "current failure" });
    observeAsyncResource(() => failedRead.promise, result => outcomes.push(result));
    failedRead.reject(error);
    await Promise.resolve();
    assert.equal(outcomes[1]?.state, "failed");
    if (outcomes[1]?.state !== "failed") throw new Error("failure was swallowed");
    assert.equal(outcomes[1].error, error);
  });

  it("cancellation also revokes late success; unexpected faults reach the caller's error policy", async () => {
    const request = deferred<object>();
    const calls: unknown[] = [];
    const cancel = observeResource(() => request.promise, value => calls.push(value), error => calls.push(error));
    cancel();
    request.resolve({ id: "abandoned" });
    await Promise.resolve();
    assert.equal(calls.length, 0);

    const fault = new Error("programming failure");
    observeResource(() => Promise.reject(fault), value => calls.push(value), error => calls.push(error));
    await Promise.resolve();
    assert.deepEqual(calls, [fault]);
    assert.throws(() => observeResource(() => { throw fault; }, () => undefined, () => undefined), error => error === fault);
  });
});

describe("the real saved Archive resource hook", () => {
  it("keeps first load, refresh, failure, identity change and stale completion distinct", async () => {
    const reads = [deferred<object>(), deferred<object>(), deferred<object>()];
    let attempt = 0;
    const read = () => {
      const next = reads[attempt++];
      if (next === undefined) throw new Error("unexpected read");
      return next.promise;
    };
    let state: SavedResource<object> = { state: "loading" };
    function Probe({ reader, revision }: { reader: () => Promise<object>; revision: number }) {
      state = useSavedResource(reader, revision);
      return createElement("p", null, state.state);
    }
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    const render = async (reader: () => Promise<object>, revision: number) => {
      await act(async () => root?.render(createElement(Probe, { reader, revision })));
    };
    await render(read, 0);
    assert.equal(state.state, "loading");
    const first = Object.freeze({ id: "first" });
    await act(async () => reads[0]?.resolve(first));
    assert.deepEqual(state, { state: "loaded", value: first });
    assert.equal(Reflect.get(state, "value"), first, "the served object is not cloned");

    await render(read, 1);
    assert.equal(state.state, "loading", "saved reports intentionally load for a new revision");
    const refreshed = Object.freeze({ id: "refreshed" });
    await act(async () => reads[1]?.resolve(refreshed));
    assert.equal(Reflect.get(state, "value"), refreshed);
    await render(read, 2);
    await act(async () => reads[2]?.reject(new Error("refresh failed")));
    assert.deepEqual(state, { state: "error", message: "refresh failed" });

    const old = deferred<object>();
    const latest = deferred<object>();
    await render(() => old.promise, 0);
    await render(() => latest.promise, 0);
    assert.equal(state.state, "loading");
    const current = Object.freeze({ id: "latest" });
    await act(async () => latest.resolve(current));
    await act(async () => old.resolve({ id: "wrong identity" }));
    assert.equal(Reflect.get(state, "value"), current);

    const abandoned = deferred<object>();
    await render(() => abandoned.promise, 0);
    act(() => root?.unmount());
    root = undefined;
    await act(async () => abandoned.reject(new Error("unmounted")));
    assert.equal(state.state, "loading", "an unmounted reader cannot settle");
  });
});
