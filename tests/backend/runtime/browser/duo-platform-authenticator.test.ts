import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import type { BrowserContext, Page } from "playwright";
import { it } from "vitest";
import { prepareDuoPlatformAuthenticator } from "../../../../src/backend/runtime/browser/duo-platform-authenticator.js";

function fixture() {
  const calls: { method: string; input: unknown }[] = [];
  const key = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const credential = { credentialId: "+/8AAQ==", rpId: "duosecurity.com", privateKey: key.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
    isResidentCredential: true, userHandle: "dXNlcg==", signCount: 1 };
  let failure: { method: string; error: Error } | undefined;
  const page = {} as Page;
  const context = { async newCDPSession(target: Page) {
    assert.equal(target, page);
    return { async send(method: string, input?: unknown) {
      calls.push({ method, input });
      if (failure?.method === method) throw failure.error;
      if (method === "WebAuthn.addVirtualAuthenticator") return { authenticatorId: "synthetic-authenticator" };
      if (method === "WebAuthn.getCredential") return { credential };
      return {};
    } };
  } } as unknown as BrowserContext;
  return { context, page, calls, credential, key, fail(method: string, error: Error) { failure = { method, error }; } };
}

it("creates an internal platform authenticator and hands the exact native key and observed count to custody once", async () => {
  const f = fixture();
  const platform = await prepareDuoPlatformAuthenticator(f.context, f.page, { purpose: "enrollment" });
  assert.equal(platform.mechanism, "chromium-platform");
  assert.deepEqual(f.calls, [{ method: "WebAuthn.enable", input: undefined }, { method: "WebAuthn.addVirtualAuthenticator", input: { options: {
    protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true,
  } } }]);
  const pending = await platform.credential("-_8AAQ", "duosecurity.com", "2026-11-02T12:00:00.000Z");
  assert.deepEqual(f.calls.slice(2), [
    { method: "WebAuthn.setResponseOverrideBits", input: { authenticatorId: "synthetic-authenticator", isBogusSignature: true } },
    { method: "WebAuthn.setUserVerified", input: { authenticatorId: "synthetic-authenticator", isUserVerified: false } },
    { method: "WebAuthn.setAutomaticPresenceSimulation", input: { authenticatorId: "synthetic-authenticator", enabled: false } },
    { method: "WebAuthn.getCredential", input: { authenticatorId: "synthetic-authenticator", credentialId: "+/8AAQ==" } },
  ]);
  assert.equal(pending.credentialId, "-_8AAQ"); assert.equal(pending.initialSignCount, 1);
  assert.equal(pending.transport, "internal"); assert.equal(pending.isResidentCredential, true);
  assert.ok(pending.privateKeyPkcs8 === f.credential.privateKey);
  assert.ok(pending.publicKeySpki === f.key.publicKey.export({ type: "spki", format: "der" }).toString("base64"));
  const count = f.calls.length;
  await assert.rejects(platform.credential("-_8AAQ", "duosecurity.com", pending.createdAt), /already-handed-off/u);
  assert.equal(f.calls.length, count);
});

it("exports the observed high-water count instead of assuming a fresh registration default", async () => {
  const f = fixture(); f.credential.signCount = 17;
  const platform = await prepareDuoPlatformAuthenticator(f.context, f.page, { purpose: "enrollment" });
  assert.equal((await platform.credential("-_8AAQ", "duosecurity.com", "2026-11-02T12:00:00.000Z")).initialSignCount, 17);
});

it("rehydrates login credentials through CDP with native assertions disabled and the protected counter intact", async () => {
  const f = fixture();
  const platform = await prepareDuoPlatformAuthenticator(f.context, f.page, { purpose: "login", credentials: [{
    credentialId: "-_8AAQ", rpId: "duosecurity.com", transport: "internal", privateKeyPkcs8: f.credential.privateKey,
    isResidentCredential: true, userHandle: f.credential.userHandle, signCount: 42,
  }] });
  assert.deepEqual(f.calls[1], { method: "WebAuthn.addVirtualAuthenticator", input: { options: {
    protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: false, automaticPresenceSimulation: false,
  } } });
  assert.deepEqual(f.calls[2], { method: "WebAuthn.setResponseOverrideBits", input: { authenticatorId: "synthetic-authenticator", isBogusSignature: true } });
  const added = f.calls[3]; assert.equal(added.method, "WebAuthn.addCredential");
  assert.ok(added.input !== null && typeof added.input === "object" && "credential" in added.input);
  const material = added.input.credential;
  assert.ok(material !== null && typeof material === "object" && "privateKey" in material && "signCount" in material && "credentialId" in material);
  assert.ok(material.privateKey === f.credential.privateKey); assert.equal(material.signCount, 42); assert.equal(material.credentialId, "+/8AAQ==");
  await assert.rejects(platform.credential("-_8AAQ", "duosecurity.com", "2026-11-02T12:00:00.000Z"), /already-handed-off/u);
  assert.equal(f.calls.length, 4);
});

for (const method of ["WebAuthn.setResponseOverrideBits", "WebAuthn.setUserVerified", "WebAuthn.setAutomaticPresenceSimulation", "WebAuthn.getCredential"]) {
  it(`withholds material after ${method} fails and never retries the handoff`, async () => {
    const f = fixture(), error = new Error("synthetic CDP failure");
    const platform = await prepareDuoPlatformAuthenticator(f.context, f.page, { purpose: "enrollment" });
    f.fail(method, error);
    await assert.rejects(platform.credential("-_8AAQ", "duosecurity.com", "2026-11-02T12:00:00.000Z"), value => value === error);
    const count = f.calls.length;
    await assert.rejects(platform.credential("-_8AAQ", "duosecurity.com", "2026-11-02T12:00:00.000Z"), /already-handed-off/u);
    assert.equal(f.calls.length, count);
  });
}

for (const fault of ["id", "rp", "counter"] as const) it(`refuses exported ${fault} outside the owned credential`, async () => {
  const f = fixture(), platform = await prepareDuoPlatformAuthenticator(f.context, f.page, { purpose: "enrollment" });
  if (fault === "id") f.credential.credentialId = "AQID";
  if (fault === "rp") f.credential.rpId = "foreign.invalid";
  if (fault === "counter") f.credential.signCount = -1;
  await assert.rejects(platform.credential("-_8AAQ", "duosecurity.com", "2026-11-02T12:00:00.000Z"));
});
