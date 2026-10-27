import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { once } from "node:events";
import { join } from "node:path";
import { chromium } from "playwright";
import { it } from "vitest";

it("isolated native create uses the page RP/origin and ignores forged page witnesses", async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end("<!doctype html><body>Signed in as: realm-test</body>");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://localhost:${address.port}`;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    browser = await chromium.launch({ channel: "chromium", headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    const session = await context.newCDPSession(page);
    await session.send("Page.enable");
    await session.send("Runtime.enable");
    await session.send("WebAuthn.enable");
    // Virtual presence proves realm/protocol behavior only, never operator Touch ID acceptance.
    const { authenticatorId } = await session.send("WebAuthn.addVirtualAuthenticator", { options: {
      protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true,
      isUserVerified: true, automaticPresenceSimulation: true,
    } });
    let nativeCredentials = 0;
    session.on("WebAuthn.credentialAdded", () => { nativeCredentials++; });
    await page.goto(origin);
    const { frameTree } = await session.send("Page.getFrameTree");
    const { executionContextId } = await session.send("Page.createIsolatedWorld", { frameId: frameTree.frame.id, worldName: "relay-native-realm-fixture" });
    const evaluate = async (expression: string) => {
      const result = await session.send("Runtime.evaluate", { expression, contextId: executionContextId, awaitPromise: true, returnByValue: true });
      assert.equal(result.exceptionDetails, undefined);
      return result.result.value as unknown;
    };
    await evaluate(`globalThis.fixtureReceipts = []; globalThis.fixtureReplies = [];
      globalThis.chrome = { runtime: { id: 'realm-fixture', onMessage: { addListener() {} },
        sendMessage: async message => { fixtureReceipts.push(message); return message.type === 'DUO_AUTOPILOT_ENROLL'
          ? { success: true, result: { native: true } } : { success: true }; } } };
      window.addEventListener('message', event => { if (event.data?.type === 'RELAY_DUO_RESPONSE') { fixtureReplies.push(event.data); if (event.data.id === 'real-native') document.documentElement.dataset.realmDone = 'true'; } });`);
    for (const file of ["username.js", "relay-native.js", "relay-content.js"]) {
      await evaluate(await readFile(join(process.cwd(), "fast-duo", "src", file), "utf8"));
    }
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
    assert.equal(await evaluate("fixtureReceipts.length"), 0);
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
    await page.waitForFunction(() => document.documentElement.dataset.realmDone === "true", undefined, { timeout: 10000 }).catch(cause => {
      throw new Error("isolated native completion was not delivered", { cause });
    });
    const output = await evaluate("fixtureReplies.find(reply => reply.id === 'real-native')") as { success: boolean; result: { clientDataJSON: string; authData: string; native: boolean; credentialId: string } };
    assert.equal(output.success, true);
    assert.equal(output.result.native, true);
    const clientData = JSON.parse(Buffer.from(output.result.clientDataJSON, "base64").toString("utf8")) as { origin: string; challenge: string; type: string };
    assert.equal(clientData.origin, origin);
    assert.equal(clientData.type, "webauthn.create");
    assert.equal(clientData.challenge, Buffer.from("realm-protocol-challenge").toString("base64url"));
    const { createHash } = await import("node:crypto");
    assert.deepEqual(Buffer.from(output.result.authData, "base64").subarray(0, 32), createHash("sha256").update("localhost").digest());
    assert.equal(nativeCredentials, 1);
    const receipts = await evaluate("fixtureReceipts.filter(message => message.type === 'RELAY_NATIVE_CREATED')") as { request: { credentialId: string } }[];
    assert.equal(receipts.length, 1);
    assert.equal(receipts[0]?.request.credentialId, output.result.credentialId);
    assert.equal(JSON.stringify(receipts).includes("privateKey"), false);
    await session.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId });
    await context.close();
  } finally {
    try { await browser?.close(); }
    finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  }
}, 30000);
