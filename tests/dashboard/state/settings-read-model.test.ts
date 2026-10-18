import assert from "node:assert/strict";
import { afterEach, it, vi } from "vitest";
import { createSettingsRead, settingsReadResource } from "../../../src/dashboard/state/settings-read-model.js";
import { ERROR_CATALOG } from "../../../src/models/failures/error-catalog.js";

afterEach(() => { vi.useRealTimers(); });
it("shares pending reads and retains exact verified data through refresh failure and timeout", async () => {
  vi.useFakeTimers();
  const resource = createSettingsRead<{ revision: number }>();
  const value = { revision: 7 }; resource.accept(value);
  const pending = Promise.withResolvers<typeof value>(); let calls = 0;
  const first = resource.read(() => { calls++; return pending.promise; }, "SETTINGS_INITIAL_READ_UNAVAILABLE");
  assert.equal(resource.read(() => { calls++; return pending.promise; }, "SETTINGS_INITIAL_READ_UNAVAILABLE"), first);
  assert.equal(calls, 1); assert.equal(resource.snapshot().value, value); assert.equal(resource.snapshot().state, "loading");
  const failed = first.catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(10_000);
  const error = await failed; assert.ok(error instanceof Error);
  assert.equal(error.message, ERROR_CATALOG.SETTINGS_INITIAL_READ_UNAVAILABLE.text);
  assert.equal(resource.snapshot().value, value); assert.equal(resource.snapshot().state, "failed");
  pending.resolve({ revision: 8 }); await Promise.resolve(); assert.equal(resource.snapshot().value, value);
  await resource.read(() => Promise.reject(new Error("synthetic 503")), "SETTINGS_INITIAL_READ_UNAVAILABLE").catch(() => undefined);
  assert.equal(resource.snapshot().value, value); assert.equal(resource.snapshot().state, "failed");
});
it("hides replaced authority and cannot revive old A data through A to B to A", async () => {
  const client = {}, authorityA = {}, authorityB = {};
  const a = settingsReadResource<number>(client, authorityA, "actor-a:descriptor-a", "editor");
  a.accept(7);
  const pending = Promise.withResolvers<number>();
  const old = a.read(() => pending.promise, "SETTINGS_INITIAL_READ_UNAVAILABLE");
  const b = settingsReadResource<number>(client, authorityB, "actor-a:descriptor-a", "editor");
  assert.equal(b.snapshot().value, undefined);
  const nextA = settingsReadResource<number>(client, authorityA, "actor-a:descriptor-a", "editor");
  assert.notEqual(nextA, a); assert.equal(nextA.snapshot().value, undefined);
  pending.resolve(8); await old; assert.equal(nextA.snapshot().value, undefined);
  const actor = settingsReadResource<number>(client, authorityA, "actor-b:descriptor-a", "editor");
  assert.equal(actor.snapshot().value, undefined);
  const descriptor = settingsReadResource<number>(client, authorityA, "actor-b:descriptor-b", "editor");
  assert.equal(descriptor.snapshot().value, undefined);
});
it("authoritative acceptance fences an older pending observation", async () => {
  const resource = createSettingsRead<number>();
  const pending = Promise.withResolvers<number>();
  const old = resource.read(() => pending.promise, "SETTINGS_INITIAL_READ_UNAVAILABLE").catch((error: unknown) => error);
  resource.accept(9); pending.resolve(8); assert.ok(await old instanceof Error); assert.equal(resource.snapshot().value, 9);
});
