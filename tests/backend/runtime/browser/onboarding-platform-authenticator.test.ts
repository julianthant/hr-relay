import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import type { BrowserContext, Page } from "playwright";
import { it } from "vitest";
import { prepareOnboardingPlatformAuthenticator } from "../../../../src/backend/runtime/browser/onboarding-platform-authenticator.js";

function fixture(available: boolean | Error) {
  const calls: { method: string; input: unknown }[] = [];
  const key = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const credential = { credentialId: "c3ludGhldGlj", rpId: "duosecurity.com", privateKey: key.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
    isResidentCredential: true, userHandle: "dXNlcg==", signCount: 0 };
  const page = { async evaluate() { if (available instanceof Error) throw available; return available; } } as unknown as Page;
  const context = { async newCDPSession() { calls.push({ method: "attach", input: page }); return { async send(method: string, input?: unknown) {
    calls.push({ method, input });
    if (method === "WebAuthn.addVirtualAuthenticator") return { authenticatorId: "synthetic-authenticator" };
    if (method === "WebAuthn.getCredential") return { credential };
    if (method === "WebAuthn.enable") return {};
    throw new Error("unexpected CDP method");
  } }; } } as unknown as BrowserContext;
  return { context, page, calls, credential, key };
}

it("keeps an available platform authenticator native without attaching emulation", async () => {
  const f = fixture(true);
  assert.deepEqual(await prepareOnboardingPlatformAuthenticator(f.context, f.page, "darwin"), { mechanism: "native-platform" });
  assert.deepEqual(f.calls, []);
});

for (const host of ["win32", "linux"] as const) it(`uses virtual Touch ID on ${host} even when another platform authenticator is available`, async () => {
  const f = fixture(true);
  assert.equal((await prepareOnboardingPlatformAuthenticator(f.context, f.page, host)).mechanism, "chromium-platform");
  assert.deepEqual(f.calls.map(call => call.method), ["attach", "WebAuthn.enable", "WebAuthn.addVirtualAuthenticator"]);
});

it("uses a Chromium internal authenticator only for explicit platform absence and retains its bound key", async () => {
  const f = fixture(false), platform = await prepareOnboardingPlatformAuthenticator(f.context, f.page);
  assert.equal(platform.mechanism, "chromium-platform"); if (platform.mechanism !== "chromium-platform") throw new Error("virtual platform required");
  assert.deepEqual(f.calls.map(call => call.method), ["attach", "WebAuthn.enable", "WebAuthn.addVirtualAuthenticator"]);
  assert.deepEqual(f.calls[2]?.input, { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true,
    hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  const pending = await platform.credential(f.credential.credentialId, "duosecurity.com", "2026-11-02T12:00:00.000Z");
  assert.equal(pending.transport, "internal"); assert.equal(pending.privateKeyPkcs8, f.credential.privateKey);
  assert.equal(pending.publicKeySpki, f.key.publicKey.export({ type: "spki", format: "der" }).toString("base64"));
  await assert.rejects(platform.credential("foreign", "duosecurity.com", pending.createdAt), /scope-changed/u);
  await assert.rejects(platform.credential(f.credential.credentialId, "foreign.invalid", pending.createdAt), /scope-changed/u);
});

it("preserves a failed native availability probe instead of silently enabling emulation", async () => {
  const error = new Error("synthetic failed platform probe"), f = fixture(error);
  await assert.rejects(prepareOnboardingPlatformAuthenticator(f.context, f.page), value => value === error);
  assert.deepEqual(f.calls, []);
});

it("uses CDP base64 for lookup while retaining the broker's canonical base64url ID", async () => {
  const f = fixture(false);
  f.credential.credentialId = "+/8AAQ==";
  const platform = await prepareOnboardingPlatformAuthenticator(f.context, f.page);
  if (platform.mechanism !== "chromium-platform") throw new Error("virtual platform required");
  const pending = await platform.credential("-_8AAQ", "duosecurity.com", "2026-11-02T12:00:00.000Z");
  assert.deepEqual(f.calls.at(-1), { method: "WebAuthn.getCredential", input: {
    authenticatorId: "synthetic-authenticator", credentialId: "+/8AAQ==",
  } });
  assert.equal(pending.credentialId, "-_8AAQ");
});
