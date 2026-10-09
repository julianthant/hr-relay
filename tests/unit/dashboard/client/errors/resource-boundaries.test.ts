// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act } from "react";
import { type Root } from "react-dom/client";
import { afterEach, describe, it } from "vitest";
import { DashboardClientError } from "../../../../../src/dashboard/client/errors.js";
import { observeAsyncResource, observeResource, type AsyncResource } from "../../../../../src/dashboard/state/async-resource.js";

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
