import assert from "node:assert/strict";
import { generateKeyPairSync, createHash, verify } from "node:crypto";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "vitest";
import { z } from "zod";
import { stageFastDuoExtension } from "../../../../src/backend/runtime/browser/fast-duo-extension.js";
import { DEFAULT_BROWSER_LAUNCHER } from "../../../../src/backend/runtime/browser/native-profile-probe.js";

it("loads the staged workflow extension in full Chromium and answers a synthetic Duo page", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "relay-fast-duo-browser-")));
  const extension = join(root, "extension");
  stageFastDuoExtension(realpathSync("fast-duo"), extension, "workflow");
  const context = await DEFAULT_BROWSER_LAUNCHER.launch({ profileDirectory: join(root, "profile"), headless: true,
    extensionDirectory: extension, downloadsPath: root, acceptDownloads: false, viewport: { width: 800, height: 600 } });
  try {
    const matches = (url: string) => url.endsWith("/src/workflow-background.js");
    const worker = context.serviceWorkers().find(worker => matches(worker.url()))
      ?? await context.waitForEvent("serviceworker", { predicate: worker => matches(worker.url()) });
    const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const credential = { rpId: "duosecurity.com", credentialId: Buffer.from("synthetic-id").toString("base64"),
      privateKey: keys.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"), signCount: 0, transport: "usb" };
    await worker.evaluate(async input => {
      const owner: unknown = Reflect.get(globalThis, "relayWorkflow");
      if (typeof owner !== "object" || owner === null) throw new Error("missing workflow worker");
      const install: unknown = Reflect.get(owner, "install");
      if (typeof install !== "function") throw new Error("missing workflow install");
      await Reflect.apply(install, owner, [input]);
    }, { username: "alex", credentials: [credential], nowMs: Date.now() });
    await context.route("https://test.duosecurity.com/**", route => route.fulfill({ contentType: "text/html",
      body: '<!doctype html><input autocomplete="username" value="alex"><button onclick="document.body.dataset.trusted = 1">Yes, this is my device</button>' }));
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto("https://test.duosecurity.com/login");
    await page.waitForFunction(() => document.body.dataset.trusted === "1");
    const assertion = await page.evaluate(async id => {
      const credential = await navigator.credentials.get({ publicKey: { rpId: "duosecurity.com", challenge: new TextEncoder().encode("synthetic-challenge"),
        allowCredentials: [{ type: "public-key", id: Uint8Array.from(atob(id), c => c.charCodeAt(0)) }] } });
      if (!(credential instanceof PublicKeyCredential) || !(credential.response instanceof AuthenticatorAssertionResponse)) throw new Error("missing assertion");
      return { id: credential.id, auth: btoa(String.fromCharCode(...new Uint8Array(credential.response.authenticatorData))),
        client: btoa(String.fromCharCode(...new Uint8Array(credential.response.clientDataJSON))),
        signature: btoa(String.fromCharCode(...new Uint8Array(credential.response.signature))) };
    }, credential.credentialId);
    assert.equal(assertion.id, Buffer.from("synthetic-id").toString("base64url"));
    const auth = Buffer.from(assertion.auth, "base64"), client = Buffer.from(assertion.client, "base64");
    assert.deepEqual(auth.subarray(0, 32), createHash("sha256").update("duosecurity.com").digest());
    assert.equal(z.object({ origin: z.string() }).parse(JSON.parse(client.toString("utf8"))).origin, "https://test.duosecurity.com");
    assert.ok(verify("sha256", Buffer.concat([auth, createHash("sha256").update(client).digest()]), keys.publicKey, Buffer.from(assertion.signature, "base64")));
  } finally { await context.close(); }
});
