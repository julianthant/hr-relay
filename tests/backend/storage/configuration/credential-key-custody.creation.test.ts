import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "vitest";
import { createCredentialKeyCustody } from "../../../../src/backend/storage/configuration/credential-key-custody.js";
import { AuthoritySourceClosureUnprovedError, hasUnprovedSourceClosure } from "../../../../src/backend/storage/source-closure.js";

function fixture() {
  const entries = new Map<string, string>(), events: string[] = [];
  const identity = { installationId: randomUUID(), profileId: randomUUID(), keyId: randomUUID() };
  const store = { get: (account: string) => entries.get(account) ?? null,
    set(account: string, secret: string) { events.push("OS-set"); entries.set(account, secret); },
    delete: (account: string) => { entries.delete(account); } };
  return { identity, entries, events, store, custody: createCredentialKeyCustody(store) };
}

it("records the exact planned native metadata before OS set and reads back that same key", () => {
  const f = fixture();
  let planned: unknown;
  const metadata = f.custody.create(f.identity, (next, key) => {
    f.events.push("durable-plan"); planned = structuredClone(next);
    assert.equal(f.entries.size, 0); assert.equal(key.byteLength, 32);
    assert.equal("key" in next, false);
  });
  assert.deepEqual(f.events, ["durable-plan", "OS-set"]);
  assert.deepEqual(metadata, planned);
  assert.deepEqual(f.custody.resumeUnpublishedCreation(planned), metadata);
});

it("does not create an OS entry when durable preparation fails", () => {
  const f = fixture(), failure = new Error("synthetic preparation refused");
  assert.throws(() => f.custody.create(f.identity, () => { throw failure; }), error => error === failure);
  assert.deepEqual(f.events, []); assert.equal(f.entries.size, 0);
});

it("never regenerates a missing prepared key or adopts an unknown existing key", () => {
  const f = fixture(), metadata = f.custody.create(f.identity, () => {});
  f.entries.clear();
  assert.throws(() => f.custody.resumeUnpublishedCreation(metadata), { code: "CREDENTIAL_KEYCHAIN_MISSING" });
  assert.equal(f.entries.size, 0); assert.deepEqual(f.events, ["OS-set"]);
  f.entries.set(`${f.identity.installationId}:${f.identity.profileId}`, Buffer.alloc(32, 7).toString("base64"));
  assert.throws(() => f.custody.resumeUnpublishedCreation(metadata), { code: "CREDENTIAL_KEYCHAIN_MISMATCH" });
  assert.throws(() => f.custody.create(f.identity, () => { throw new Error("must not plan over an unknown entry"); }), { code: "CREDENTIAL_KEYCHAIN_MISMATCH" });
  assert.deepEqual(f.events, ["OS-set"]);
});

it("preserves source-closure custody through a redacted native failure", () => {
  const f = fixture(), closure = new AuthoritySourceClosureUnprovedError([new Error("synthetic private close failed")]);
  const custody = createCredentialKeyCustody({ ...f.store, set() { throw closure; } });
  assert.throws(() => custody.create(f.identity, () => {}), error => error instanceof Error
    && hasUnprovedSourceClosure(error) && error.cause === closure && !error.message.includes("synthetic private"));
});
