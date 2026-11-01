import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { BrowserContext } from "playwright";
import { describe, it } from "vitest";
import { provisionWorkflowDuo } from "../../../../src/backend/runtime/browser/workflow-duo-provider.js";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { hostConfigFacts } from "../../../../src/models/config/host-display.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import type { DuoAssertionRequest } from "../../../../src/backend/storage/configuration/duo-signing.js";
import { fixtureDuoSigningSource, fixtureWorkflowWorker } from "../../../support/helpers/browser/duo-signing.js";

const config = resolveConfigWithProvenance({}, hostConfigFacts({}), manualClock(new Date("2026-11-01T00:00:00Z"))).config;
function world(options: { noMatch?: boolean; noScope?: boolean; failSign?: boolean; failStop?: boolean } = {}) {
  const broker = fixtureWorkflowWorker();
  const signed: DuoAssertionRequest[] = [];
  const replies: unknown[] = [];
  let finalDrift = false;
  let scope = !options.noScope;
  let releaseReply: (() => void) | undefined;
  const replied = new Promise<void>(resolve => { releaseReply = resolve; });
  let releaseStop: (() => void) | undefined;
  const stopped = new Promise<void>(resolve => { releaseStop = resolve; });
  const nativeStop = broker.owner.stop.bind(broker.owner);
  broker.owner.stop = () => { nativeStop(); releaseStop?.(); if (options.failStop) throw new Error("synthetic stop failed"); };
  broker.owner.reply = (_id, result) => { replies.push(result); releaseReply?.(); };
  broker.owner.assertContext = () => { if (finalDrift) throw new Error("synthetic final account drift"); };
  const source = fixtureDuoSigningSource({ credentials: () => options.noMatch ? [] : [{ credentialId: "AQID", rpId: "duosecurity.com", transport: "usb", isResidentCredential: true, userHandle: "BAUG" }],
    async sign(request) { signed.push(request); if (options.failSign) throw new Error("duo-commit-uncertain");
      return { credentialId: request.credentialId, authenticatorData: "AQID", clientDataJSON: "AQID", signature: "AQID", userHandle: null, transport: "usb", signCount: 42 }; } });
  const context = { serviceWorkers: () => [broker.worker] } as unknown as BrowserContext;
  const open = () => provisionWorkflowDuo({ context, config, source, accountName: "alex@ucsd.edu", assertOwner() {},
    assertSigningScope() { if (!scope) throw new Error("no current ceremony lease"); } });
  const request = (accountNames = ["alex"], allowCredentials = ["AQID"]) => broker.request({ id: randomUUID(), request: { requestId: randomUUID(), origin: "https://test.duosecurity.com",
    rpId: "duosecurity.com", challenge: "AQID", allowCredentials, accountNames } });
  return { broker, signed, replies, replied, stopped, open, request, source, drift: () => { finalDrift = true; }, revoke: () => { scope = false; } };
}

describe("backend workflow Duo bridge", () => {
  it("installs no credentials and waits without a ceremony, but refuses a signing request outside its actual lease", async () => {
    const w = world({ noScope: true }); const owner = await w.open();
    assert.deepEqual(w.broker.installed.map(args => [...args]), [[]]);
    assert.equal(w.signed.length, 0); w.request(); await w.stopped;
    assert.equal(w.signed.length, 0); assert.throws(owner.assertCurrent, /ceremony lease/u); await owner.stop();
  });
  it("selects in the backend and releases only public assertion bytes", async () => {
    const w = world(); const owner = await w.open(); w.request(); await w.replied;
    assert.equal(w.signed.length, 1);
    assert.equal(w.signed[0].credentialId, "AQID");
    assert.equal(/privateKey|signCount|highWater/.test(JSON.stringify(w.replies)), false); await owner.stop();
  });
  it("passes through only an explicit valid no-software-match request", async () => {
    const w = world({ noMatch: true }); const owner = await w.open(); w.request(); await w.replied;
    assert.deepEqual(w.replies, [{ ok: true, value: { passThrough: true } }]); assert.equal(w.signed.length, 0); await owner.stop();
  });
  it("refuses a different account instead of turning it into native pass-through", async () => {
    const w = world(); const owner = await w.open(); w.request(["other"]); await w.stopped;
    assert.equal(w.signed.length, 0); assert.deepEqual(w.replies, []); await owner.stop();
  });
  it("withholds a reserved assertion after final account drift or lease revocation", async () => {
    for (const drift of ["account", "lease"] as const) {
      const w = world(); const originalSign = w.source.sign.bind(w.source);
      w.source.sign = async request => { const result = await originalSign(request); if (drift === "account") w.drift(); else w.revoke(); return result; };
      const owner = await w.open(); w.request(); await w.stopped;
      assert.equal(w.signed.length, 1); assert.deepEqual(w.replies, []); await owner.stop();
    }
  });
  it("does not refund or retry an uncertain signing result", async () => {
    const w = world({ failSign: true }); const owner = await w.open(); w.request(); await w.stopped;
    assert.equal(w.signed.length, 1); assert.deepEqual(w.replies, []); assert.throws(owner.assertCurrent, /duo-commit-uncertain/u); await owner.stop();
  });
  it("retains a broker-stop failure instead of reporting a clean shutdown", async () => {
    const w = world({ failStop: true }); const owner = await w.open();
    await assert.rejects(owner.stop(), /duo-broker-stop-unproved/u);
  });
});

it("accepts exact IDs without visible names and matching short/email aliases for exact and resident requests", async () => {
  for (const [names, allowed] of [[[], ["AQID"]], [["alex", "alex@ucsd.edu"], ["AQID"]], [["alex", "alex@ucsd.edu"], []]]) {
    const w = world(); const owner = await w.open(); w.request(names, allowed); await w.replied;
    assert.equal(w.signed.length, 1); await owner.stop();
  }
});

it("rejects contradictory names and discoverable requests without a positive owner", async () => {
  for (const [names, allowed] of [[["alex", "other"], ["AQID"]], [["alex", "other"], []], [[], []]]) {
    const w = world(); const owner = await w.open(); w.request(names, allowed); await w.stopped;
    assert.equal(w.signed.length, 0); assert.deepEqual(w.replies, []); await owner.stop();
  }
});

it("never selects an empty resident user handle ahead of a usable key", async () => {
  for (const usable of [false, true]) {
    const w = world();
    w.source.credentials = () => [
      { credentialId: "AQID", rpId: "duosecurity.com", transport: "usb", isResidentCredential: true, userHandle: "" },
      ...(usable ? [{ credentialId: "BAUG", rpId: "duosecurity.com" as const, transport: "usb" as const, isResidentCredential: true, userHandle: "AQID" }] : []),
    ];
    const owner = await w.open(); w.request(["alex"], []); await w.replied;
    assert.equal(w.signed.length, usable ? 1 : 0);
    if (usable) assert.equal(w.signed[0].credentialId, "BAUG");
    else assert.deepEqual(w.replies, [{ ok: true, value: { passThrough: true } }]);
    await owner.stop();
  }
});
