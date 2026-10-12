// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act } from "react";
import { type Root } from "react-dom/client";
import { afterEach,describe,it } from "vitest";
import { observeResource } from "../../../src/dashboard/state/async-resource.js";

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
