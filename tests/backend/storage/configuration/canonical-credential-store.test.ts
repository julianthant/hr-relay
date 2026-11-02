import assert from "node:assert/strict";
import { createCipheriv, createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, it, vi } from "vitest";
import type { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { CanonicalCredentialError, CredentialMaintenanceHold, createCanonicalCredentials } from "../../../../src/backend/storage/configuration/canonical-credential-store.js";
import { credentialKeyCustody } from "../../../../src/backend/storage/configuration/credential-key-custody.js";
import { retainAuthoritySourceClosure } from "../../../../src/backend/storage/source-closure.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";

vi.mock("../../../../src/backend/storage/admission/admission-identity.js", () => ({ requireRuntimeAdmission: (value: unknown) => value }));
vi.mock("../../../../src/backend/storage/configuration/credential-key-custody.js", () => ({ credentialKeyCustody: { read: vi.fn() } }));

const directories: string[] = [];
afterEach(() => { vi.resetAllMocks(); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "canonical-read-"))); directories.push(root);
  const binding = { installationId: randomUUID(), profileId: randomUUID() }, stateRoot = join(root, "profiles", binding.profileId);
  const headPath = join(root, "machine", "credential-keys", `${binding.profileId}.json`);
  const recordPath = join(stateRoot, "credentials", "protected.json");
  for (const directory of [dirname(headPath), dirname(recordPath), join(root, "machine", "duo-credentials")]) mkdirSync(directory, { recursive: true, mode: 0o700 });
  const key = randomBytes(32), keyId = randomUUID();
  const encode = (value: unknown) => Buffer.from(canonicalJsonStringify(value));
  const head = (generation: number) => {
    const body = { ...binding, schemaVersion: 1, state: "active", generation, revision: 0,
      key: { ...binding, schemaVersion: 2, keyId, keyDigest: createHash("sha256").update(key).digest("hex") }, counters: [], retired: [] };
    return encode({ ...body, mac: createHmac("sha256", key).update("relay:canonical-credential-head:v1\0").update(encode(body)).digest("hex") });
  };
  writeFileSync(headPath, head(1), { mode: 0o600 });
  const nonce = randomBytes(12), metadata = { ...binding, schemaVersion: 1, kind: "protected", generation: 1, keyId, revision: 1, nonce: nonce.toString("base64") };
  const cipher = createCipheriv("aes-256-gcm", key, nonce); cipher.setAAD(encode(metadata));
  const record = { revision: 1, value: { synthetic: "value" } };
  const ciphertext = Buffer.concat([cipher.update(encode(record)), cipher.final()]);
  writeFileSync(recordPath, encode({ ...metadata, tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") }), { mode: 0o600 });
  const material = { ...binding, schemaVersion: 1 as const, keyId, key: key.toString("base64") };
  vi.mocked(credentialKeyCustody.read).mockReturnValue(material);
  const assertLive = vi.fn<() => void>(), assertCredentialRead = vi.fn(() => assertLive()), retainSourceClosure = vi.fn();
  const admission = { profileBinding: binding, stateRoot, readInstallationContext: () => ({ locator: { installationId: binding.installationId, stateRoot: root } }),
    assertCredentialRead, assertLive, retainSourceClosure } as unknown as RuntimeAdmission;
  return { store: createCanonicalCredentials(admission), assertCredentialRead, assertLive, retainSourceClosure, headPath, head, record, material, binding, root };
}

it("checks runtime at authenticated-read boundaries without repeating its census for each namespace entry", () => {
  const f = fixture();
  assert.deepEqual(f.store.readRecord("protected"), f.record);
  assert.equal(f.assertCredentialRead.mock.calls.length, 4);
  assert.ok(f.assertLive.mock.calls.length > 4);
  assert.deepEqual(f.store.readRecord("protected"), f.record);
  assert.equal(f.assertCredentialRead.mock.calls.length, 8);
});

it.each([
  ["profile-storage-claim-generation-changed", 1], ["profile-session-not-current", 1],
  ["profile-storage-claim-generation-changed", 2], ["profile-session-not-current", 2],
] as const)("refuses %s observed on authenticated key read %i", (reason, keyRead) => {
  const f = fixture(), failure = new Error(reason);
  let reads = 0;
  vi.mocked(credentialKeyCustody.read).mockImplementation(() => {
    if (++reads === keyRead) f.assertCredentialRead.mockImplementation(() => { throw failure; });
    return f.material;
  });
  assert.throws(() => f.store.readRecord("protected"), error => error instanceof Error && error.cause === failure);
  assert.equal(reads, keyRead);
});

it("refuses an authenticated credential generation change while reading a record", () => {
  const f = fixture();
  vi.mocked(credentialKeyCustody.read).mockImplementationOnce(() => { writeFileSync(f.headPath, f.head(2)); return f.material; });
  assert.throws(() => f.store.readRecord("protected"), { code: "CREDENTIAL_UNAVAILABLE" });
});

it("keeps unknown credential descendants held before returning protected values", () => {
  const f = fixture();
  const path = join(dirname(f.headPath), `.${f.binding.profileId}.unknown`);
  writeFileSync(path, "unknown", { mode: 0o600 });
  assert.throws(() => f.store.readRecord("protected"), error => error instanceof CanonicalCredentialError && error.code === "CREDENTIAL_UNAVAILABLE"
    && error.cause instanceof CredentialMaintenanceHold && error.cause.code === "CREDENTIAL_OPERATION_PENDING");
  assert.equal(readFileSync(path, "utf8"), "unknown");
});

it("holds a pending credential operation before native key access", () => {
  const f = fixture(), path = join(f.root, "machine", "credential-operations", `${f.binding.profileId}.json`);
  mkdirSync(dirname(path), { mode: 0o700 }); writeFileSync(path, "pending", { mode: 0o600 });
  assert.throws(() => f.store.readRecord("protected"), { code: "CREDENTIAL_BUSY" });
  assert.equal(vi.mocked(credentialKeyCustody.read).mock.calls.length, 0);
  assert.equal(readFileSync(path, "utf8"), "pending");
});

it("retains an unproved source closure from an inner liveness check", () => {
  const f = fixture(), failure = retainAuthoritySourceClosure([new Error("synthetic closure unproved")], { database: {} });
  vi.mocked(credentialKeyCustody.read).mockImplementationOnce(() => {
    f.assertLive.mockImplementation(() => { throw failure; });
    return f.material;
  });
  assert.throws(() => f.store.readRecord("protected"), error => error instanceof Error && error.cause === failure);
  assert.equal(f.retainSourceClosure.mock.calls[0]?.[0], failure);
});
