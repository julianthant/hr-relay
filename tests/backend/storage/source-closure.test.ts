import assert from "node:assert/strict";
import { it } from "vitest";
import { assertSourceClosuresProved, createBrowserSourceRecovery, hasUnprovedSourceClosure, retainAuthoritySourceClosure } from "../../../src/backend/storage/source-closure.js";

it("settles only the exact browser closure after its proof succeeds", async () => {
  const recovery = createBrowserSourceRecovery();
  const browser = retainAuthoritySourceClosure([new Error("synthetic close failure")], { directory: {} });
  const foreign = retainAuthoritySourceClosure([new Error("synthetic database failure")], { database: {} });
  recovery.retain(browser);
  assert.throws(() => assertSourceClosuresProved(new Set([browser])), error => error === browser);
  await recovery.prove(async () => {
    assertSourceClosuresProved(new Set([browser]));
    assert.throws(() => assertSourceClosuresProved(new Set([browser, foreign])), error => error === foreign);
  });
  assert.equal(hasUnprovedSourceClosure(browser), false);
  assert.throws(() => assertSourceClosuresProved(new Set([browser, foreign])), error => error === foreign);
});

it("retains a failed proof and does not inherit another browser's recovery scope", async () => {
  const recovery = createBrowserSourceRecovery();
  const failure = retainAuthoritySourceClosure([new Error("synthetic close failure")], { directory: {} });
  recovery.retain(failure);
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const proof = recovery.prove(async () => { entered.resolve(); await release.promise; throw new Error("native proof failed"); });
  await entered.promise;
  assert.throws(() => assertSourceClosuresProved(new Set([failure])), error => error === failure);
  release.resolve();
  await assert.rejects(proof, /native proof failed/);
  assert.throws(() => assertSourceClosuresProved(new Set([failure])), error => error === failure);
});

it("never settles an independent source failure nested under the browser failure", async () => {
  const recovery = createBrowserSourceRecovery();
  const foreign = retainAuthoritySourceClosure([new Error("synthetic native probe failure")], { nativeResource: {} });
  const browser = retainAuthoritySourceClosure([foreign], { directory: {} });
  recovery.retain(browser);
  await assert.rejects(recovery.prove(async () => assertSourceClosuresProved(new Set([browser]))), error => error === browser);
  assert.equal(hasUnprovedSourceClosure(browser), true);
});

it("preserves refusal for ordinary errors passed to the source-custody assertion", () => {
  const failure = new Error("synthetic unexpected retained error");
  assert.throws(() => assertSourceClosuresProved(new Set([failure])), error => error === failure);
});
