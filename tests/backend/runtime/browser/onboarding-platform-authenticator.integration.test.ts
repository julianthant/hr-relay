import assert from "node:assert/strict";
import { createPrivateKey, createPublicKey } from "node:crypto";
import { chromium } from "playwright";
import { it } from "vitest";
import { prepareOnboardingPlatformAuthenticator } from "../../../../src/backend/runtime/browser/onboarding-platform-authenticator.js";

it("completes an actual Chromium platform ceremony and retains the same private/public credential", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    await context.route("https://synthetic.duosecurity.com/**", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Synthetic Duo</title>" }));
    const page = await context.newPage(); await page.goto("https://synthetic.duosecurity.com/");
    const platform = await prepareOnboardingPlatformAuthenticator(context, page);
    assert.equal(platform.mechanism, "chromium-platform"); if (platform.mechanism !== "chromium-platform") throw new Error("headless virtual platform required");
    const result = await page.evaluate(async () => {
      const credential = await navigator.credentials.create({ publicKey: {
        challenge: new TextEncoder().encode("synthetic-challenge"), rp: { id: "duosecurity.com", name: "Synthetic Duo" },
        user: { id: new TextEncoder().encode("synthetic-user"), name: "synthetic@ucsd.edu", displayName: "Synthetic Operator" },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }], authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "required" },
      } });
      if (!(credential instanceof PublicKeyCredential) || !(credential.response instanceof AuthenticatorAttestationResponse)) throw new Error("actual platform attestation required");
      const spki = credential.response.getPublicKey(); if (!spki) throw new Error("actual public key required");
      return { id: credential.id,
        spki: btoa(String.fromCharCode(...new Uint8Array(spki))), attachment: credential.authenticatorAttachment };
    });
    assert.equal(result.attachment, "platform");
    const pending = await platform.credential(result.id, "duosecurity.com", "2026-11-02T12:00:00.000Z");
    assert.equal(pending.credentialId, result.id);
    assert.equal(pending.publicKeySpki, result.spki); assert.equal(pending.isResidentCredential, true);
    assert.equal(createPublicKey(createPrivateKey({ key: Buffer.from(pending.privateKeyPkcs8, "base64"), type: "pkcs8", format: "der" }))
      .export({ type: "spki", format: "der" }).toString("base64"), result.spki);
  } finally { await browser.close(); }
});
