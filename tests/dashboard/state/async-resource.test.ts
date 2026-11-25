// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act } from "react";
import { type Root } from "react-dom/client";
import { afterEach,describe,it } from "vitest";
import { createKeptResults, dropKeptResults, LOADING, loadingWith, observeResource } from "../../../src/dashboard/state/async-resource.js";

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
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(calls.length, 1);
    assert.equal(calls[0], fault);
    observeResource(() => { throw fault; }, value => calls.push(value), error => calls.push(error));
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(calls, [fault, fault]);
  });

  it("a read whose observer is closed in the same tick is never started", async () => {
    let started = 0;
    const cancel = observeResource(() => { started += 1; return Promise.resolve(1); }, () => undefined, () => undefined);
    cancel();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(started, 0);

    observeResource(() => { started += 1; return Promise.resolve(1); }, () => undefined, () => undefined);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(started, 1);
  });
});

describe("createKeptResults", () => {
  it("returns the last kept result per key, least recently used out first past the limit", () => {
    const store = createKeptResults<string>(2);
    const owner = {};
    const authority = [owner, "actor-1"] as const;
    store.keep(owner, authority, "a", { value: "A", at: 1 });
    store.keep(owner, authority, "b", { value: "B", at: 1 });
    assert.deepEqual(store.get(owner, authority, "a"), { value: "A", at: 1 });
    store.keep(owner, authority, "c", { value: "C", at: 1 });
    assert.equal(store.get(owner, authority, "b"), undefined);
    assert.equal(store.get(owner, authority, "a")?.value, "A");
    store.keep(owner, authority, "a", { value: "A2", at: 2 });
    assert.deepEqual(store.get(owner, authority, "a"), { value: "A2", at: 2 });
  });

  it("drops everything an owner kept under another authority", () => {
    const store = createKeptResults<string>(4);
    const owner = {};
    store.keep(owner, [owner, "actor-1"], "a", { value: "A", at: 1 });
    assert.equal(store.get(owner, [owner, "actor-2"], "a"), undefined);
    assert.equal(store.get(owner, [owner, "actor-1"], "a"), undefined);
  });

  it("forgets one owner's results in every store on sign-out or a stream reset", () => {
    const days = createKeptResults<string>(4);
    const runs = createKeptResults<number>(4);
    const owner = {}, other = {};
    days.keep(owner, [], "day", { value: "D", at: "pc:1" });
    runs.keep(owner, [], "run", { value: 1, at: 1 });
    days.keep(other, [], "day", { value: "O", at: "pc:1" });
    dropKeptResults(owner);
    assert.equal(days.get(owner, [], "day"), undefined);
    assert.equal(runs.get(owner, [], "run"), undefined);
    assert.equal(days.get(other, [], "day")?.value, "O");
  });

  it("a kept result loads as loading, never as loaded", () => {
    assert.equal(loadingWith(undefined), LOADING);
    const resource = loadingWith({ value: "A", at: 1 });
    assert.equal(resource.state, "loading");
    assert.deepEqual(resource.state === "loading" ? resource.kept : undefined, { value: "A", at: 1 });
  });
});
