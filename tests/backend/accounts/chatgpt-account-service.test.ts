import { ChatGptAccountStateSchema } from "../../../src/models/dashboard/chatgpt-account.js";
import assert from "node:assert/strict";
import { it, vi } from "vitest";
import { closeSync, fstatSync, mkdtempSync, openSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RuntimeAdmission } from "../../../src/backend/storage/admission/admission.js";
import { hasUnprovedSourceClosure, retainAuthoritySourceClosure } from "../../../src/backend/storage/source-closure.js";
import * as credentials from "../../../src/backend/storage/configuration/chatgpt-credential-repository.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { IsoInstantSchema } from "../../../src/rules/identity/ids.js";
import { ChatGptOcrRequestSchema, ChatGptAccountError, createChatGptAccountService } from "../../../src/backend/accounts/chatgpt-account-service.js";

it("public account states reject token properties", () => {
  assert.equal(ChatGptAccountStateSchema.safeParse({ state: "signed-out", accessToken: "synthetic" }).success, false);
  assert.equal(ChatGptAccountStateSchema.safeParse({ state: "connected", name: "Synthetic", email: "synthetic@example.com", expiresAt: "2026-10-12T12:00:00.000Z", planUsage: "enabled", refreshToken: "synthetic" }).success, false);
});
it("OCR admits inline image and PDF inputs only", () => {
  for (const input of [{ kind: "image", mediaType: "image/png", base64: "YQ==" }, { kind: "pdf", filename: "synthetic.pdf", base64: "YQ==" }])
    assert.equal(ChatGptOcrRequestSchema.safeParse({ model: "gpt-6.1-sol", instruction: "Read this synthetic form", input }).success, true);
  for (const input of [{ kind: "image", mediaType: "image/svg+xml", base64: "YQ==" }, { kind: "pdf", filename: "../private.pdf", base64: "YQ==" }, { kind: "image", imageUrl: "https://elsewhere.example/image" }])
    assert.equal(ChatGptOcrRequestSchema.safeParse({ model: "gpt-6.1-sol", instruction: "Read", input }).success, false);
});
it("account errors carry fixed safe text", () => {
  assert.equal(new ChatGptAccountError("CHATGPT_AUTH_INVALID").message, "The ChatGPT sign-in response could not be verified.");
  assert.equal(new ChatGptAccountError("CHATGPT_USAGE_LIMIT").code, "CHATGPT_USAGE_LIMIT");
});


it("safe account projection retains the original unproved credential resource through close", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "chatgpt-account-port-"))), admission = RuntimeAdmission.syntheticRoots(root, root);
  const descriptor = openSync(join(root, "held-source"), "w+", 0o600);
  const source = retainAuthoritySourceClosure([new Error("synthetic private source failure")], { descriptor: { descriptor } });
  const mapped = new credentials.ChatGptCredentialError("CHATGPT_CREDENTIAL_UNAVAILABLE"); mapped.cause = source;
  let readable = false;
  const factory = vi.spyOn(credentials, "createChatGptCredentialRepository").mockReturnValue({
    read() { if (!readable) throw mapped; return undefined; },
    async withLock() { throw mapped; },
  });
  const service = createChatGptAccountService({ admission, stateRoot: root, clock: manualClock(new Date("2026-10-12T12:00:00.000Z")) });
  try {
    const state = service.readAccount();
    assert.deepEqual(state, { state: "unavailable", code: "CHATGPT_CREDENTIAL_UNAVAILABLE", message: "ChatGPT credentials could not be read or saved safely." });
    assert.equal(JSON.stringify(state).includes("private source failure"), false);
    readable = true; assert.deepEqual(service.readAccount(), { state: "signed-out" });
    for (let index = 0; index < 2; index++) await assert.rejects(service.close(), error => {
      assert.equal(hasUnprovedSourceClosure(error), true);
      const pending: unknown[] = [error], seen = new Set<unknown>();
      while (pending.length !== 0) {
        const value = pending.pop(); if (seen.has(value)) continue; seen.add(value);
        if (value instanceof AggregateError) { const causes: readonly unknown[] = value.errors; pending.push(...causes); }
        if (value instanceof Error) pending.push(value.cause);
      }
      assert.equal(seen.has(source), true); assert.equal(seen.has(mapped), true);
      assert.equal(fstatSync(descriptor).isFile(), true);
      return true;
    });
  } finally { factory.mockRestore(); closeSync(descriptor); admission.release(); rmSync(root, { recursive: true, force: true }); }
});

it("close drains an awaited sign-out transaction and prevents publication after revocation cancellation", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "chatgpt-signout-port-"))), admission = RuntimeAdmission.syntheticRoots(root, root);
  const entered = Promise.withResolvers<void>(), leaseCleanup = Promise.withResolvers<void>(), releaseLease = Promise.withResolvers<void>();
  let record: credentials.ChatGptCredentialRecord = { schemaVersion: 1, revision: 1, hostId: "urn:uuid:00000000-0000-4000-8000-000000000001",
    clientId: "oaiapp_fixture", registration: { subject: "synthetic-subject", name: "Synthetic", email: "synthetic@example.com" },
    session: { accessToken: "synthetic-access", refreshToken: "synthetic-refresh", idToken: "synthetic-id",
      expiresAt: IsoInstantSchema.parse("2026-10-12T13:00:00.000Z"), earliestRefreshAt: null, scopes: [], usePlan: false, usage: "available" } };
  const original = record; let leased = false, writes = 0, closed = false;
  const repository: ReturnType<typeof credentials.createChatGptCredentialRepository> = {
    read: () => record,
    async withLock<T>(operation: (transaction: credentials.ChatGptCredentialTransaction) => Promise<T>): Promise<T> {
      assert.equal(leased, false); leased = true;
      try { return await operation({ read: () => record, replace(next) { writes++; record = next; } }); }
      finally { leaseCleanup.resolve(); await releaseLease.promise; leased = false; }
    },
  };
  const factory = vi.spyOn(credentials, "createChatGptCredentialRepository").mockReturnValue(repository);
  const transport: typeof fetch = async (input, init = {}) => {
    const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
    if (url.endsWith("/.well-known/openid-configuration")) return Response.json({ issuer: "https://auth.openai.com", jwks_uri: "https://auth.openai.com/jwks",
      revocation_endpoint: "https://auth.openai.com/revoke", id_token_signing_alg_values_supported: ["RS256"] });
    assert.equal(url, "https://auth.openai.com/revoke");
    const signal = init.signal; assert.ok(signal);
    return new Promise<Response>((_resolve, reject) => {
      signal.addEventListener("abort", () => { const reason: unknown = signal.reason; reject(reason instanceof Error ? reason : new Error("synthetic revocation cancelled", { cause: reason })); }, { once: true }); entered.resolve();
    });
  };
  const service = createChatGptAccountService({ admission, stateRoot: root, clock: manualClock(new Date("2026-10-12T12:00:00.000Z")), fetch: transport });
  let closing: Promise<void> | undefined, signOut: Promise<void> | undefined;
  try {
    signOut = assert.rejects(service.signOut(), { code: "CHATGPT_SERVICE_CLOSED" }); await entered.promise;
    closing = service.close().then(() => { closed = true; }); await leaseCleanup.promise;
    assert.equal(leased, true); assert.equal(closed, false); assert.equal(writes, 0); assert.equal(record, original);
    releaseLease.resolve(); await closing; await signOut;
    assert.equal(leased, false); assert.equal(closed, true); assert.equal(writes, 0); assert.equal(record, original);
    assert.throws(() => service.readAccount(), { code: "CHATGPT_SERVICE_CLOSED" });
  } finally {
    releaseLease.resolve(); await closing; await signOut;
    factory.mockRestore(); admission.release(); rmSync(root, { recursive: true, force: true });
  }
});
