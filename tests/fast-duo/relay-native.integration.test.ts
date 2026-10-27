import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { chromium } from "playwright";
import type { BrowserContext } from "playwright";
import { it } from "vitest";

interface RealmReceipt {
  type: string;
  request: { credentialId?: string };
  sender: { id: string; documentId: string; origin: string; url: string; frameId: number };
}

it("real extension isolated native create uses page RP/origin and ignores forged page witnesses", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "relay-native-extension-realm-"));
  const extension = join(fixtureRoot, "extension");
  await mkdir(join(extension, "src"), { recursive: true, mode: 0o700 });
  for (const file of ["username.js", "relay-native.js", "relay-content.js"]) {
    await copyFile(join(process.cwd(), "fast-duo", "src", file), join(extension, "src", file));
  }
  for (const file of ["LICENSE", "THIRD_PARTY_NOTICES.md"]) {
    await copyFile(join(process.cwd(), "fast-duo", file), join(extension, file));
  }
  await writeFile(join(extension, "manifest.json"), JSON.stringify({
    manifest_version: 3, name: "Relay native realm test only", version: "1.0.0", minimum_chrome_version: "140",
    host_permissions: ["http://localhost/*"], background: { service_worker: "background.js" },
    content_scripts: [{ matches: ["http://localhost/*"], js: ["src/username.js", "src/relay-native.js", "src/relay-content.js"],
      world: "ISOLATED", run_at: "document_start" }],
  }), { mode: 0o600 });
  await writeFile(join(extension, "background.js"), `
    globalThis.realmReceipts = [];
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (sender.id !== chrome.runtime.id || sender.frameId !== 0 || sender.documentLifecycle !== 'active'
        || typeof sender.documentId !== 'string' || !/^[\\da-f]{8}(?:-[\\da-f]{4}){3}-[\\da-f]{12}$/i.test(sender.documentId)
        || new URL(sender.url).hostname !== 'localhost' || sender.origin !== new URL(sender.url).origin
        || message.request?.origin !== sender.origin || message.request?.rpId !== 'localhost') {
        sendResponse({ success: false }); return false;
      }
      realmReceipts.push({ type: message.type, request: message.request, sender: {
        id: sender.id, documentId: sender.documentId, origin: sender.origin, url: sender.url, frameId: sender.frameId,
      } });
      sendResponse(message.type === 'DUO_AUTOPILOT_ENROLL'
        ? { success: true, result: { native: true } } : { success: true });
      return false;
    });
  `, { mode: 0o600 });
  const server = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end(`<!doctype html><body>Signed in as: realm-test<script>
      globalThis.realmReplies = [];
      window.addEventListener('message', event => {
        if (event.source === window && event.origin === location.origin && event.data?.type === 'RELAY_DUO_RESPONSE') {
          realmReplies.push(event.data);
          if (event.data.id === 'real-native') document.documentElement.dataset.realmDone = 'true';
        }
      });
    </script></body>`);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://localhost:${address.port}`;
  let context: BrowserContext | undefined;
  try {
    context = await chromium.launchPersistentContext(join(fixtureRoot, "browser"), {
      channel: "chromium", headless: true,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    const worker = context.serviceWorkers().find(item => item.url().endsWith("/background.js"))
      ?? await context.waitForEvent("serviceworker", { predicate: item => item.url().endsWith("/background.js"), timeout: 10000 });
    const extensionId = new URL(worker.url()).hostname;
    assert.equal(new URL(worker.url()).protocol, "chrome-extension:");
    const receipts = async (): Promise<RealmReceipt[]> => {
      const value: unknown = await worker.evaluate(() => Reflect.get(globalThis, "realmReceipts") as unknown);
      assert.ok(Array.isArray(value));
      return value as RealmReceipt[];
    };
    const page = await context.newPage();
    const session = await context.newCDPSession(page);
    await session.send("WebAuthn.enable");
    // Virtual presence proves extension realm/protocol behavior, never operator Touch ID acceptance.
    const { authenticatorId } = await session.send("WebAuthn.addVirtualAuthenticator", { options: {
      protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true,
      isUserVerified: true, automaticPresenceSimulation: true,
    } });
    let nativeCredentials = 0;
    session.on("WebAuthn.credentialAdded", () => { nativeCredentials++; });
    await page.goto(origin);
    await page.evaluate(() => {
      navigator.credentials.create = async () => { throw new Error("page override must never run"); };
      for (const type of ["RELAY_NATIVE_CREATED", "RELAY_NATIVE_FAILED"]) {
        window.postMessage({ type, request: { requestId: "forged", credentialId: "forged", attachment: "platform" } }, location.origin);
        window.postMessage({ type: "RELAY_DUO_REQUEST", id: "forged", operation: type, request: { requestId: "forged" } }, location.origin);
      }
    });
    await page.evaluate(() => new Promise<void>(resolve => {
      const listener = (event: MessageEvent) => { if (event.data === "fixture-barrier") { window.removeEventListener("message", listener); resolve(); } };
      window.addEventListener("message", listener); window.postMessage("fixture-barrier", location.origin);
    }));
    assert.deepEqual(await receipts(), []);
    assert.equal(nativeCredentials, 0);
    await page.evaluate(() => {
      const challenge = new TextEncoder().encode("realm-protocol-challenge");
      const user = new TextEncoder().encode("realm-user");
      const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
      window.postMessage({ type: "RELAY_DUO_REQUEST", id: "real-native", operation: "DUO_AUTOPILOT_ENROLL", request: {
        rpId: "localhost", requestId: "realm-request", username: "realm-test", challenge: encode(challenge), userHandle: encode(user),
      }, nativeOptions: { rp: { id: "localhost", name: "Realm test" }, user: { id: user, name: "realm-test", displayName: "Realm test" },
        challenge, pubKeyCredParams: [{ type: "public-key", alg: -7 }], timeout: 10000,
        authenticatorSelection: { authenticatorAttachment: "platform", residentKey: "required", userVerification: "required" },
      } }, location.origin);
    });
    await page.waitForFunction(() => document.documentElement.dataset.realmDone === "true", undefined, { timeout: 10000 });
    const value: unknown = await page.evaluate(() => Reflect.get(globalThis, "realmReplies") as unknown);
    assert.ok(Array.isArray(value));
    const output = (value as { id: string; success: boolean; result: { clientDataJSON: string; authData: string; native: boolean; credentialId: string } }[]).find(reply => reply.id === "real-native");
    assert.ok(output);
    assert.equal(output.success, true);
    assert.equal(output.result.native, true);
    const clientData = JSON.parse(Buffer.from(output.result.clientDataJSON, "base64").toString("utf8")) as { origin: string; challenge: string; type: string };
    assert.equal(clientData.origin, origin);
    assert.equal(clientData.type, "webauthn.create");
    assert.equal(clientData.challenge, Buffer.from("realm-protocol-challenge").toString("base64url"));
    assert.deepEqual(Buffer.from(output.result.authData, "base64").subarray(0, 32), createHash("sha256").update("localhost").digest());
    assert.equal(nativeCredentials, 1);
    const actualReceipts = await receipts();
    assert.deepEqual(actualReceipts.map(receipt => receipt.type), ["DUO_AUTOPILOT_ENROLL", "RELAY_NATIVE_CREATED"]);
    assert.equal(actualReceipts[1]?.request.credentialId, output.result.credentialId);
    assert.equal(actualReceipts[0]?.sender.documentId, actualReceipts[1]?.sender.documentId);
    for (const receipt of actualReceipts) {
      assert.equal(receipt.sender.id, extensionId);
      assert.match(receipt.sender.documentId, /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i);
      assert.equal(receipt.sender.origin, origin);
      assert.equal(receipt.sender.url, `${origin}/`);
      assert.equal(receipt.sender.frameId, 0);
    }
    assert.equal(JSON.stringify(actualReceipts).includes("privateKey"), false);
    await session.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId });
  } finally {
    try { await context?.close(); }
    finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
    // Keep this owned synthetic root until the sole runner proves physical process/FD closure.
  }
}, 30000);
