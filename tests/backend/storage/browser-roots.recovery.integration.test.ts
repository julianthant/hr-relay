import assert from "node:assert/strict";
import { mkdirSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { BrowserContext } from "playwright";
import { it } from "vitest";
import { createBrowserRoots } from "../../../src/backend/storage/browser-roots.js";
import { AuthoritySourceClosureUnprovedError } from "../../../src/backend/storage/source-closure.js";
import { createNativeBrowserProbe } from "../../../src/backend/runtime/browser/native-browser.js";
import { SignUpOperationSchema } from "../../../src/models/profiles/profile.js";
import { systemClock } from "../../../src/rules/time/clock.js";
import { createBoundProfileFixture } from "../../support/helpers/admission-fixture.js";

for (const foreign of [false, true]) it(`recovers only the exact owned nested native source under real registry/lifetime custody (foreign=${foreign})`, async () => {
  const f = await createBoundProfileFixture({ pending: "onboarding" });
  const operations = join(f.machine.stateRoot, "machine", "operations"), name = readdirSync(operations).find(name => name.endsWith(".json")); assert.ok(name);
  const operation = SignUpOperationSchema.parse(JSON.parse(readFileSync(join(operations, name), "utf8"))); assert.ok(operation.onboarding);
  const roots = createBrowserRoots(f.machine), launch = roots.beginSignupLaunch({ profileId: operation.profileId,
    profileRoot: join(f.machine.stateRoot, "browsers", "onboarding"), credentialFingerprint: null,
    owner: { kind: "signup", operationId: operation.operationId, accountId: operation.onboarding.accountId, providerGeneration: operation.onboarding.generation } });
  mkdirSync(launch.input.profileDirectory, { recursive: true, mode: 0o700 }); launch.opened(); launch.closing(); launch.closed();
  let foreignFailure: unknown = new AuthoritySourceClosureUnprovedError([new Error("foreign native owner")]);
  let foreignCanStop = false, foreignStops = 0;
  const foreignProbe = createNativeBrowserProbe({ clock: systemClock, signal: new AbortController().signal, closeProofMs: 100, launchTimeoutMs: 100,
    launcher: { async launch(input) {
      let exited = false;
      const listeners: (() => void)[] = [];
      input.ownedProcess?.({ exited: () => exited, onExit() {}, async stop() {
        foreignStops++; if (!foreignCanStop) throw new Error("foreign native process remained live");
        exited = true; for (const listener of listeners) listener();
      } });
      return { pages: () => [], on(_event: string, listener: () => void) { listeners.push(listener); } } as unknown as BrowserContext;
    } } });
  if (foreign) await assert.rejects(foreignProbe.probe(launch.input.profileRoot, launch.input.profileDirectory), error => { foreignFailure = error; return true; });
  let canStop = false, stops = 0, probes = 0, current = true, revokeAfterStop = false, failFreshProbe = true;
  const probe = createNativeBrowserProbe({ clock: systemClock, signal: new AbortController().signal, closeProofMs: 100, launchTimeoutMs: 100,
    launcher: { async launch(input) {
      const probeNumber = ++probes;
      let exited = false;
      const listeners: (() => void)[] = [];
      const context = { pages: () => [], async close() { if (!canStop) throw foreign ? new AggregateError([new Error("synthetic native stop refused"), foreignFailure]) : new Error("synthetic native stop refused"); for (const callback of listeners) callback(); }, on(_event: string, callback: () => void) { listeners.push(callback); } } as unknown as BrowserContext;
      input.ownedProcess?.({ exited: () => exited, onExit() {}, async stop() {
        stops++; if (probeNumber === 2 && failFreshProbe) throw new Error("new owned native source failed");
        if (!canStop) throw foreign ? new AggregateError([new Error("synthetic native stop refused"), foreignFailure]) : new Error("synthetic native stop refused");
        exited = true; for (const callback of listeners) callback(); if (revokeAfterStop) current = false;
      } });
      return context;
    } } });
  const assertCurrent = () => { if (!current) throw new Error("expired recovery request"); };
  const remove = () => roots.withUnused(launch.input.profileDirectory, probe, async ({ remove }) => { assertCurrent(); remove(); }, launch.input);
  try {
    let retained: unknown;
    await assert.rejects(remove(), error => { retained = error; return true; });
    assert.equal(probes, 1); assert.throws(() => roots.inventory());
    await probe.recoverOwned?.(retained, join(launch.input.profileDirectory, "foreign"), assertCurrent);
    assert.throws(() => roots.inventory()); assert.equal(stops, 1);
    await assert.rejects(launch.recover(probe, assertCurrent, remove)); assert.equal(probes, 1); assert.equal(stops, 2);
    canStop = true; revokeAfterStop = true;
    await assert.rejects(launch.recover(probe, assertCurrent, remove), /expired recovery request/);
    assert.equal(probes, 1); assert.equal(existsSync(launch.input.profileDirectory), true); assert.throws(() => roots.inventory());
    current = true; revokeAfterStop = false;
    if (foreign) {
      await assert.rejects(launch.recover(probe, assertCurrent, remove));
      assert.equal(probes, 1, "foreign source remains fenced after owned physical closure");
      assert.equal(foreignStops, 1, "a different probe factory cannot stop this exact same-path foreign resource");
      foreignCanStop = true;
      await foreignProbe.recoverOwned?.(foreignFailure, launch.input.profileDirectory, assertCurrent);
      assert.equal(foreignStops, 2);
    }
    await assert.rejects(launch.recover(probe, assertCurrent, remove));
    assert.equal(probes, 2); assert.throws(() => roots.inventory());
    await assert.rejects(launch.recover(probe, assertCurrent, remove));
    assert.equal(probes, 2, "a newly failed owned source must close before another native acquisition");
    failFreshProbe = false;
    await launch.recover(probe, assertCurrent, remove);
    assert.equal(probes, 3); assert.equal(existsSync(launch.input.profileDirectory), false); assert.deepEqual(roots.inventory().roots, []);
    if (foreign) assert.equal(foreignStops, 2, "later owned retries cannot touch the foreign resource");
    f.lifetime.assertSourceCustody(); f.machine.assertBrowserRegistryCustody();
  } finally { await f.close(); }
});
