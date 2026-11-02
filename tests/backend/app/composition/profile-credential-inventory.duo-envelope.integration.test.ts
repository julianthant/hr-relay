import assert from "node:assert/strict";
import { Entry } from "@napi-rs/keyring";
import nativeCrypto, { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { it, vi } from "vitest";
import { z } from "zod";
import { createCanonicalCredentials, CanonicalCredentialConversionPlanSchema, initializeCanonicalCredentials } from "../../../../src/backend/storage/configuration/canonical-credential-store.js";
import { createDuoCredentialStore } from "../../../../src/backend/storage/configuration/duo-credential-store.js";
import { createCredentialStore, initialDocument } from "../../../../src/backend/storage/configuration/credential-store.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { DuoCredentialRecordSchema } from "../../../../src/models/config/duo-credential-store.js";
import { SignUpOperationSchema } from "../../../../src/models/profiles/profile.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";
import { FakeKeyringEntry } from "../../../support/helpers/credential-keychain-fake.js";

function operation(f: Awaited<ReturnType<typeof createBoundProfileFixture>>) {
  const directory = join(f.machine.stateRoot, "machine", "operations"), names = readdirSync(directory); assert.equal(names.length, 1);
  const name = names[0]; assert.ok(name);
  return SignUpOperationSchema.parse(JSON.parse(readFileSync(join(directory, name), "utf8")));
}
function initialize(f: Awaited<ReturnType<typeof createBoundProfileFixture>>, current: ReturnType<typeof operation>) {
  const document = initialDocument();
  initializeCanonicalCredentials(f.machine, f.admission, current, { revision: document.record.revision, value: document });
}

for (const content of ["valid", "changed", "malformed", "foreign", "plaintext"] as const)
  it(`authenticates ${content} canonical Duo custody without classifying an encrypted FE nonce as plaintext`, async () => {
    const actualEntry: unknown = Entry; assert.equal(actualEntry, FakeKeyringEntry);
    const f = await createBoundProfileFixture({ pending: "onboarding" }), clock = manualClock(new Date("2026-11-01T12:00:01.000Z"));
    try {
      const current = operation(f); assert.ok(current.onboarding);
      const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
      const input = { credentialId: randomBytes(32).toString("base64url"),
        scope: { armId: randomUUID(), contextId: "a".repeat(32), tabId: 1, accountId: current.onboarding.accountId,
          origin: "https://fixture.duosecurity.com", rpId: "duosecurity.com", armedAt: "2026-11-01T12:00:00.000Z", expiresAt: "2026-11-01T12:10:00.000Z" },
        privateKeyPkcs8: pair.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
        publicKeySpki: pair.publicKey.export({ format: "der", type: "spki" }).toString("base64") };
      const random = nativeCrypto.randomBytes;
      const nonce = vi.spyOn(nativeCrypto, "randomBytes").mockImplementation((size: number, callback?: (error: Error | null, bytes: Buffer<ArrayBuffer>) => void) => {
        const bytes = size === 12 ? Buffer.from("FEAAAAAAAAAAAAAA", "base64") : random(size);
        if (callback !== undefined) callback(null, bytes); return bytes;
      });
      syncBuiltinESMExports();
      try { createDuoCredentialStore(f.admission, clock).enroll(input); }
      finally { nonce.mockRestore(); syncBuiltinESMExports(); }
      const path = join(f.machine.stateRoot, "machine", "duo-credentials", `${current.profileId}.json`), bytes = readFileSync(path);
      assert.ok(bytes.includes("FE")); assert.equal(bytes.includes(input.privateKeyPkcs8), false);
      const protectedStore = createCredentialStore({ admission: f.admission, stateRoot: f.stateRoot });
      assert.equal(protectedStore.read().entries.timekeeperName?.value, "FE");
      const headPath = join(f.machine.stateRoot, "machine", "credential-keys", `${current.profileId}.json`), head = readFileSync(headPath), keys = FakeKeyringEntry.snapshot();
      if (content !== "valid") {
        const envelope = z.record(z.string(), z.unknown()).parse(JSON.parse(bytes.toString("utf8")));
        if (content === "changed") envelope.ciphertext = "AAAA";
        if (content === "foreign") envelope.profileId = randomUUID();
        writeFileSync(path, content === "malformed" ? "{invalid" : content === "plaintext" ? "FE disposable-fixture-password" : JSON.stringify(envelope));
      }
      const source = readFileSync(path), owner = createCanonicalCredentials(f.admission);
      if (content === "valid") {
        const record = owner.readRecord("duo"); assert.ok(record);
        assert.equal(DuoCredentialRecordSchema.parse(record.value).credentials[0]?.credentialId, input.credentialId);
        assert.equal(protectedStore.read().entries.timekeeperName?.value, "FE");
      } else assert.throws(() => owner.readRecord("duo"), { code: "CREDENTIAL_UNAVAILABLE" });
      assert.deepEqual(readFileSync(path), source); assert.deepEqual(readFileSync(headPath), head);
      assert.equal(JSON.stringify(FakeKeyringEntry.snapshot()) === JSON.stringify(keys), true);
    } finally { await f.close(); }
  });

it("records actual canonical create custody before native key publication and expires its allocated operation after ready", async () => {
  const f = await createBoundProfileFixture({ pending: "storage" }), current = operation(f);
  const entry = new FakeKeyringEntry("Relay", `${f.admission.profileBinding.installationId}:${f.admission.profileBinding.profileId}`), set = entry.setPassword.bind(entry);
  let observed = false, failure: unknown;
  const spy = vi.spyOn(FakeKeyringEntry.prototype, "setPassword").mockImplementation((key: string) => {
    try {
      const path = join(f.machine.stateRoot, "machine", "credential-operations", `${current.profileId}.json`);
      const plan = CanonicalCredentialConversionPlanSchema.shape.operation.parse(JSON.parse(readFileSync(path, "utf8")));
      assert.equal(plan.operationId, current.credentials.operationId); assert.equal(plan.head.key.keyId, current.credentials.keyId);
      assert.equal(readFileSync(path).includes(key), false); observed = true;
    } catch (error) { failure = error; throw error; }
    set(key);
  });
  try {
    AuthorityDatabase.initializeProfile(f.admission); initialize(f, current); assert.equal(observed, true);
    if (failure !== undefined) throw failure instanceof Error ? failure : new AggregateError([failure], "native-create-observation-failed", { cause: failure });
    const document = initialDocument();
    f.machine.publishProfileOperation({ ...current, credentials: { ...current.credentials, phase: "ready", protectedRevision: document.record.revision } });
    const path = join(f.machine.stateRoot, "machine", "credential-keys", `${current.profileId}.json`), before = readFileSync(path);
    assert.throws(() => initialize(f, current), /profile-credential-creation-changed/u);
    assert.deepEqual(readFileSync(path), before);
  } finally { spy.mockRestore(); await f.close(); }
});

it("refuses an actual unbound Duo document before create-plan or native key publication", async () => {
  const f = await createBoundProfileFixture({ pending: "storage" });
  try {
    AuthorityDatabase.initializeProfile(f.admission);
    const current = operation(f), operationPath = join(f.machine.stateRoot, "machine", "operations", `${current.operationId}.json`), operationBytes = readFileSync(operationPath);
    const controlPath = join(f.workspace, ".tracker", "control", "profile-registry.json"), controlBytes = readFileSync(controlPath);
    const directory = join(f.machine.stateRoot, "machine", "duo-credentials"); mkdirSync(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, `${current.profileId}.json`), bytes = Buffer.from("{unbound-duo"); writeFileSync(path, bytes, { mode: 0o600, flag: "wx" });
    const keys = FakeKeyringEntry.snapshot(), native = vi.spyOn(FakeKeyringEntry.prototype, "setPassword");
    try { assert.throws(() => initialize(f, current), { code: "CREDENTIAL_CONVERSION_REQUIRED" }); assert.equal(native.mock.calls.length, 0); }
    finally { native.mockRestore(); }
    assert.equal(existsSync(join(f.machine.stateRoot, "machine", "credential-operations", `${current.profileId}.json`)), false);
    assert.deepEqual(readFileSync(path), bytes); assert.deepEqual(readFileSync(operationPath), operationBytes); assert.deepEqual(readFileSync(controlPath), controlBytes);
    assert.equal(JSON.stringify(FakeKeyringEntry.snapshot()) === JSON.stringify(keys), true);
  } finally { await f.close(); }
});
