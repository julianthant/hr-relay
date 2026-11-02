// @vitest-environment jsdom
import assert_m0 from "node:assert/strict";
import { act as act_m0 } from "react";
import { type Root as Root_m0 } from "react-dom/client";
import { afterEach as afterEach_m0,describe as describe_m0,it as it_m0 } from "vitest";
import { DashboardClientError as DashboardClientError_m0 } from "../../../src/dashboard/client/errors.js";
import { observeAsyncResource as observeAsyncResource_m0,type AsyncResource as AsyncResource_m0 } from "../../../src/dashboard/state/async-resource.js";
// @vitest-environment jsdom


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
