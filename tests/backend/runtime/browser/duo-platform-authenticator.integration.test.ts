import assert from "node:assert/strict";
import { createPrivateKey, createPublicKey } from "node:crypto";
import { chromium, type CDPSession } from "playwright";
import { it, onTestFinished } from "vitest";
import { z } from "zod";
import { prepareDuoPlatformAuthenticator } from "../../../../src/backend/runtime/browser/duo-platform-authenticator.js";
import { scaledMs } from "../../../support/time-scale.js";

it("rehydrates the actual platform credential while preserving discovery and refusing native assertions after handoff", async () => {
  const browser = await chromium.launch({ headless: true });
  onTestFinished(() => browser.close());
  const context = await browser.newContext();
  await context.route("https://synthetic.duosecurity.com/**", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Synthetic Duo</title>" }));
  const page = await context.newPage(); await page.goto("https://synthetic.duosecurity.com/");
  const platform = await prepareDuoPlatformAuthenticator(context, page, { purpose: "enrollment" });
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
      spki: btoa(String.fromCharCode(...new Uint8Array(spki))), attachment: credential.authenticatorAttachment,
      signCount: new DataView(credential.response.getAuthenticatorData()).getUint32(33) };
  });
  assert.equal(result.attachment, "platform");
  const pending = await platform.credential(result.id, "duosecurity.com", "2026-11-02T12:00:00.000Z");
  assert.equal(pending.credentialId, result.id);
  assert.equal(pending.initialSignCount, result.signCount);
  assert.equal(pending.publicKeySpki, result.spki); assert.equal(pending.isResidentCredential, true);
  assert.equal(createPublicKey(createPrivateKey({ key: Buffer.from(pending.privateKeyPkcs8, "base64"), type: "pkcs8", format: "der" }))
    .export({ type: "spki", format: "der" }).toString("base64"), result.spki);
  assert.equal(await page.evaluate(() => PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()), true);
  const login = await browser.newContext();
  await login.route("https://synthetic.duosecurity.com/**", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Synthetic Duo login</title>" }));
  const loginPage = await login.newPage(); await loginPage.goto("https://synthetic.duosecurity.com/");
  const session = await login.newCDPSession(loginPage), send = session.send.bind(session);
  let authenticatorId: string | undefined;
  const observe: CDPSession["send"] = async (method, parameters) => {
    const response = await send(method, parameters);
    if (method === "WebAuthn.addVirtualAuthenticator") authenticatorId = z.object({ authenticatorId: z.string() }).parse(response).authenticatorId;
    return response;
  };
  session.send = observe;
  const attach = login.newCDPSession.bind(login);
  login.newCDPSession = async target => { assert.equal(target, loginPage); return session; };
  try {
    await prepareDuoPlatformAuthenticator(login, loginPage, { purpose: "login", credentials: [{ ...pending, rpId: "duosecurity.com", signCount: pending.initialSignCount }] });
  } finally { login.newCDPSession = attach; session.send = send; }
  assert.ok(authenticatorId);
  const restored = await session.send("WebAuthn.getCredentials", { authenticatorId });
  assert.equal(restored.credentials.length, 1);
  const credential = restored.credentials[0];
  assert.equal(credential.credentialId, Buffer.from(pending.credentialId, "base64url").toString("base64"));
  assert.equal(credential.signCount, pending.initialSignCount);
  assert.equal(createPublicKey(createPrivateKey({ key: Buffer.from(credential.privateKey, "base64"), type: "pkcs8", format: "der" }))
    .export({ type: "spki", format: "der" }).toString("base64"), result.spki);
  assert.equal(await loginPage.evaluate(() => PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()), true);
  await loginPage.bringToFront();
  assert.equal(await loginPage.evaluate(() => document.hasFocus()), true);
  const outcome = await loginPage.evaluate(async ({ credentialId, timeoutMs }) => {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      await navigator.credentials.get({ signal: controller.signal, publicKey: {
        rpId: "duosecurity.com", challenge: new TextEncoder().encode("synthetic-login"), userVerification: "required",
        allowCredentials: [{ type: "public-key", id: Uint8Array.from(atob(credentialId), value => value.charCodeAt(0)) }],
      } });
      return "signed";
    } catch (error) { if (!(error instanceof DOMException)) throw error; return error.name; }
    finally { clearTimeout(timer); }
  }, { credentialId: credential.credentialId, timeoutMs: scaledMs(250) });
  assert.ok(["AbortError", "NotAllowedError"].includes(outcome), `unexpected native assertion outcome: ${outcome}`);
});
