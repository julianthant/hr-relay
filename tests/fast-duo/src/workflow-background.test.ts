import assert from "node:assert/strict";
import { generateKeyPairSync, verify, createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { describe, it } from "vitest";
import { z } from "zod";

interface WorkflowWorker {
  install(input: unknown): Promise<void>;
  receive(message: unknown, sender: unknown): Promise<Record<string, unknown>>;
}
const { createWorkflowWorker } = await import(pathToFileURL(resolve("fast-duo/src/workflow-background.js")).href) as {
  createWorkflowWorker(this: void, api: unknown): WorkflowWorker;
};
const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const credential = { rpId: "duosecurity.com", credentialId: Buffer.from("synthetic-id").toString("base64"),
  privateKey: keys.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"), signCount: 0, transport: "usb",
  isResidentCredential: true, userHandle: Buffer.from("synthetic-user").toString("base64") };
const origin = "https://test.duosecurity.com";
const sender = { id: "owned", url: `${origin}/login`, origin };
const sign = { type: "DUO_AUTOPILOT_SIGN", request: { rpId: "duosecurity.com", origin,
  challenge: Buffer.from("synthetic-challenge").toString("base64"), allowCredentials: [credential.credentialId], usernames: ["alex"] } };

function world(options: { persistent?: Record<string, unknown>; corrupt?: boolean; stale?: boolean } = {}) {
  let saved: Record<string, unknown> = options.stale ? { autopilotV1: {} } : {};
  const calls: string[] = [];
  const api = { runtime: { id: "owned" }, storage: {
    local: { get: () => { calls.push("local:get"); return options.persistent ?? {}; }, set: () => { throw new Error("persistent write"); } },
    session: {
      setAccessLevel: (value: unknown) => { assert.deepEqual(value, { accessLevel: "TRUSTED_CONTEXTS" }); calls.push("trusted"); },
      clear: () => { if (!options.stale) saved = {}; },
      get: (keys: string | string[] | null) => Object.fromEntries((keys === null ? Object.keys(saved) : Array.isArray(keys) ? keys : [keys]).filter(key => key in saved).map(key => {
        const value = structuredClone(saved[key]);
        return [key, value !== null && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).reverse()) : value];
      })),
      set: (values: Record<string, unknown>) => { calls.push("session:set"); saved = options.corrupt ? {} : structuredClone(values); },
      remove: (names: string[]) => { for (const name of names) delete saved[name]; },
    },
  } };
  const worker = createWorkflowWorker(api);
  return { worker, calls, state: () => saved,
    install: () => worker.install({ username: "alex@ucsd.edu", credentials: [credential], nowMs: 1_800_000_000_000 }) };
}

describe("Fast Duo workflow session", () => {
  it("provisions trusted session storage and signs with the shared Fast Duo service", async () => {
    const w = world();
    await w.install();
    assert.deepEqual(w.calls.slice(0, 3), ["local:get", "trusted", "session:set"]);
    assert.deepEqual(await w.worker.receive({ type: "DUO_SETTINGS" }, sender), { enabled: true, trustClick: true, toast: true });
    const reply = await w.worker.receive(sign, sender);
    assert.equal(reply.ok, true);
    assert.equal(JSON.stringify(reply).includes(credential.privateKey), false);
    const result = z.object({ authenticatorData: z.string(), clientDataJSON: z.string(), signature: z.string() }).parse(reply);
    const auth = Buffer.from(result.authenticatorData, "base64");
    assert.ok(verify("sha256", Buffer.concat([auth, createHash("sha256").update(Buffer.from(result.clientDataJSON, "base64")).digest()]), keys.publicKey, Buffer.from(result.signature, "base64")));
    const state = z.object({ autopilotV1: z.object({ credentials: z.array(z.object({ signCount: z.number() })) }) }).parse(w.state());
    assert.equal(state.autopilotV1.credentials[0].signCount, auth.readUInt32BE(33));
    const second = await w.worker.receive(sign, sender);
    assert.equal(Buffer.from(String(second.authenticatorData), "base64").readUInt32BE(33), auth.readUInt32BE(33) + 1);
    assert.equal(w.calls.filter(call => call === "local:get").length, 1);
  });

  it("fails before provisioning and refuses foreign senders, origins and enrollment", async () => {
    const w = world();
    await assert.rejects(w.worker.receive(sign, sender), /DUO_SESSION_UNAVAILABLE/);
    await w.install();
    await assert.rejects(w.worker.receive(sign, { ...sender, id: "foreign" }));
    await assert.rejects(w.worker.receive(sign, { ...sender, url: "https://evil.invalid/" }));
    await assert.rejects(w.worker.receive({ ...sign, request: { ...sign.request, origin: "https://evil.invalid" } }, sender));
    await assert.rejects(w.worker.receive({ type: "DUO_AUTOPILOT_ENROLL" }, sender));
    await assert.rejects(w.install(), /ALREADY_INSTALLED/);
  });

  it("requires exact keys and a matching account for discoverable requests", async () => {
    const w = world(); await w.install();
    for (const request of [
      { ...sign.request, allowCredentials: [Buffer.from("other-key").toString("base64")] },
      { ...sign.request, usernames: ["other-user"] },
      { ...sign.request, allowCredentials: [], usernames: [] },
      { ...sign.request, rpId: "evil.invalid" },
    ]) assert.equal((await w.worker.receive({ ...sign, request }, sender)).ok, false);
    assert.equal((await w.worker.receive({ ...sign, request: { ...sign.request, allowCredentials: [] } }, sender)).ok, true);
  });

  it("withholds assertions when advancing the session counter cannot be verified", async () => {
    const options = { corrupt: false };
    const w = world(options); await w.install(); options.corrupt = true;
    await assert.rejects(w.worker.receive(sign, sender), /DUO_SESSION_UNVERIFIED/);
  });

  it("refuses persistent keys and unverified session writes without enabling signing", async () => {
    for (const options of [{ persistent: { duoCredentials: [credential] } }, { persistent: { autopilotV1: {} } }, { corrupt: true }, { stale: true }]) {
      const w = world(options);
      await assert.rejects(w.install(), /DUO_(PERSISTENT_CREDENTIAL_REFUSED|SESSION_UNVERIFIED)/);
      await assert.rejects(w.worker.receive(sign, sender));
    }
  });
});
