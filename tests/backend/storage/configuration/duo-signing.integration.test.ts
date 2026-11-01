import { z } from "zod";
import nativeFs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomUUID, verify } from "node:crypto";
import { fork } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import type { BrowserContext } from "playwright";
import { it, vi } from "vitest";
import { createDuoCredentialStore, DuoCredentialCommitUncertainError } from "../../../../src/backend/storage/configuration/duo-credential-store.js";
import { provisionWorkflowDuo } from "../../../../src/backend/runtime/browser/workflow-duo-provider.js";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { hostConfigFacts } from "../../../../src/models/config/host-display.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";
import { fixtureWorkflowWorker } from "../../../support/helpers/browser/duo-signing.js";
import { testProcessImport } from "../../../support/compiled-process.js";
import { scaledMs } from "../../../support/time-scale.js";

async function setup() {
  const fixture = await createBoundProfileFixture({ sharedMachine: true });
  const clock = manualClock(new Date("2026-11-01T12:00:00Z"));
  const store = createDuoCredentialStore(fixture.admission, fixture.machine, clock);
  const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const scope = { armId: randomUUID(), contextId: "a".repeat(32), tabId: 1, accountId: randomUUID(),
    origin: "https://test.duosecurity.com", rpId: "duosecurity.com", armedAt: clock.now().toISOString(), expiresAt: "2026-11-01T12:10:00.000Z" };
  const credentialId = Buffer.from(randomUUID()).toString("base64url");
  store.enroll({ credentialId, scope, privateKeyPkcs8: keys.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
    publicKeySpki: keys.publicKey.export({ format: "der", type: "spki" }).toString("base64"), authenticator: { transport: "usb", isResidentCredential: true } });
  store.confirm(credentialId, scope);
  const request = { requestId: randomUUID(), credentialId, origin: scope.origin, rpId: "duosecurity.com" as const, challenge: "AQID" };
  return { ...fixture, clock, store, keys, credentialId, request };
}

it("two independent workflow brokers sign through the same durable store with strictly advancing counts and real signature bytes", async () => {
  const f = await setup();
  const owners: Awaited<ReturnType<typeof provisionWorkflowDuo>>[] = [];
  try {
    const config = resolveConfigWithProvenance({}, hostConfigFacts({}), f.clock).config;
    const replies = await Promise.all([0, 1].map(async () => {
      const broker = fixtureWorkflowWorker();
      const source = createDuoCredentialStore(f.admission, f.machine, f.clock);
      let reply: (value: unknown) => void = () => { throw new Error("reply not installed"); };
      const result = new Promise<unknown>(resolve => { reply = resolve; });
      broker.owner.reply = (_id, value) => reply(value);
      owners.push(await provisionWorkflowDuo({ context: { serviceWorkers: () => [broker.worker] } as unknown as BrowserContext,
        config, source, accountName: "fixture@ucsd.edu", assertOwner() { f.admission.assertProfileRuntime(); }, assertSigningScope() {} }));
      broker.request({ id: randomUUID(), request: { requestId: randomUUID(), rpId: f.request.rpId, origin: f.request.origin, challenge: f.request.challenge,
        allowCredentials: [f.credentialId], accountNames: ["fixture"] } });
      return result;
    }));
    const assertions = replies.map(value => {
      assert.ok(value !== null && typeof value === "object" && "value" in value);
      const result = value.value;
      assert.ok(result !== null && typeof result === "object" && "authenticatorData" in result && "clientDataJSON" in result && "signature" in result);
      const auth = Buffer.from(String(result.authenticatorData), "base64");
      const client = Buffer.from(String(result.clientDataJSON), "base64");
      assert.deepEqual(auth.subarray(0, 32), createHash("sha256").update("duosecurity.com").digest());
      assert.ok(verify("sha256", Buffer.concat([auth, createHash("sha256").update(client).digest()]), f.keys.publicKey, Buffer.from(String(result.signature), "base64")));
      assert.equal(/privateKey|highWater|signCount/.test(JSON.stringify(value)), false);
      return auth.readUInt32BE(33);
    }).sort((a, b) => a - b);
    assert.equal(assertions[1], assertions[0] + 1);
    assert.equal(f.store.read().credentials.find(row => row.credentialId === f.credentialId)?.highWater, assertions[1]);
  } finally { await Promise.all(owners.map(owner => owner.stop())); await f.close(); }
});

it("burns a failed signature request durably, refuses replay after reopening and preserves the next count", async () => {
  const f = await setup();
  try {
    const first = await f.store.sign(f.request);
    const failed = { ...f.request, requestId: randomUUID(), challenge: Buffer.alloc(4097).toString("base64") };
    await assert.rejects(f.store.sign(failed), /duo-challenge-invalid/u);
    const fresh = createDuoCredentialStore(f.admission, f.machine, f.clock);
    await assert.rejects(fresh.sign({ ...failed, challenge: "AQID" }), /duo-attempt-reused/u);
    await assert.rejects(fresh.sign(f.request), /duo-attempt-reused/u);
    assert.equal((await fresh.sign({ ...f.request, requestId: randomUUID() })).signCount, first.signCount + 2);
  } finally { await f.close(); }
});

const retainedChildren = new Set<object>();
it("burns an unacknowledged signature across actual process death and refuses its request ID after restart", async () => {
  const f = await setup();
  const child = fork(fileURLToPath(new URL("../../../support/processes/duo-credential-store-worker.ts", import.meta.url)),
    [f.workspace, f.admission.profileBinding.profileId, f.credentialId, f.clock.now().toISOString(), String(f.lifetime.port)],
    { execArgv: ["--import", testProcessImport()], stdio: ["ignore", "ignore", "pipe", "ipc"] });
  const held = { fixture: f, child }; retainedChildren.add(held);
  let stderrBytes = 0;
  child.stderr?.on("data", (bytes: Buffer) => { stderrBytes += bytes.length; });
  const exit = once(child, "exit");
  const close = once(child, "close");
  const ready = once(child, "message");
  await f.lifetime.share(child);
  assert.equal(z.object({ type: z.literal("ready") }).parse((await ready)[0]).type, "ready");
  const first = await f.store.sign(f.request);
  const requestId = randomUUID();
  child.send({ kind: "sign-then-crash", requestId });
  assert.deepEqual(await exit, [23, null]); assert.deepEqual(await close, [23, null]);
  assert.equal(stderrBytes, 0); assert.equal(child.connected, false);
  const fresh = createDuoCredentialStore(f.admission, f.machine, f.clock);
  await assert.rejects(fresh.sign({ ...f.request, requestId }), /duo-attempt-reused/u);
  assert.equal((await fresh.sign({ ...f.request, requestId: randomUUID() })).signCount, first.signCount + 2);
  await f.close(); retainedChildren.delete(held);
}, scaledMs(30_000));

it("withholds a signature on unknown publication, then burns the same request through exact settlement", async () => {
  const f = await setup();
  const first = await f.store.sign(f.request);
  const request = { ...f.request, requestId: randomUUID() };
  const rename = nativeFs.renameSync;
  const canonical = join(f.machine.stateRoot, "machine", "duo-credentials", `${f.admission.profileBinding.profileId}.json`);
  let injected = false;
  const fault = vi.spyOn(nativeFs, "renameSync").mockImplementation((source, destination) => {
    rename(source, destination);
    if (String(destination) === canonical && !injected) { injected = true; throw new Error("synthetic publication ACK lost"); }
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(f.store.sign(request), DuoCredentialCommitUncertainError);
    assert.equal(injected, true);
  } finally { fault.mockRestore(); syncBuiltinESMExports(); }
  f.store.recoverInterruptedPublication();
  const fresh = createDuoCredentialStore(f.admission, f.machine, f.clock);
  await assert.rejects(fresh.sign(request), /duo-attempt-reused/u);
  assert.equal((await fresh.sign({ ...f.request, requestId: randomUUID() })).signCount, first.signCount + 2);
  await f.close();
});
