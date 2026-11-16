import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { it, vi } from "vitest";
import { z } from "zod";
import { createCanonicalCredentials, eraseCanonicalDraftCredentials, CanonicalCredentialHeadSchema } from "../../../../src/backend/storage/configuration/canonical-credential-store.js";
import { DuoCredentialRecordSchema } from "../../../../src/models/config/duo-credential-store.js";
import { SignUpOperationSchema } from "../../../../src/models/profiles/profile.js";
import { FakeKeyringEntry } from "../../../support/helpers/credential-keychain-fake.js";
import { storageTree } from "../../../support/helpers/integration/storage-recovery-fixture.js";
import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";

function credential() {
  const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return { state: "ready" as const, credentialId: randomBytes(32).toString("base64url"),
    scope: { armId: randomUUID(), contextId: "a".repeat(32), tabId: 1, accountId: randomUUID(),
      origin: "https://api-fixture.duosecurity.com", rpId: "duosecurity.com", armedAt: "2026-11-01T12:00:00.000Z", expiresAt: "2026-11-01T12:10:00.000Z" },
    privateKeyPkcs8: pair.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
    publicKeySpki: pair.publicKey.export({ type: "spki", format: "der" }).toString("base64"),
    createdAt: "2026-11-01T12:00:01.000Z", confirmedAt: "2026-11-01T12:00:02.000Z" };
}

it("preserves a callback's exact domain failure after releasing the actual global ChatGPT lease", async () => {
  const f = await createBoundProfileFixture();
  try {
    const first = createCanonicalCredentials(f.admission), second = createCanonicalCredentials(f.admission);
    const failure = Object.assign(new Error("synthetic account cancellation"), { code: "SYNTHETIC_ACCOUNT_CANCELLED" });
    let escaped: { read(): unknown } | undefined;
    await assert.rejects(first.withChatGptOperation(async tx => {
      escaped = tx;
      await assert.rejects(second.withChatGptOperation(async () => {}), { code: "CREDENTIAL_BUSY" });
      throw failure;
    }), error => error === failure);
    const settled = escaped; assert.ok(settled);
    assert.throws(() => settled.read(), { code: "CREDENTIAL_UNAVAILABLE" });
    assert.equal(await second.withChatGptOperation(async () => "lease released"), "lease released");
  } finally { await f.close(); }
});

it("burns duplicate Duo requests and advances only a fresh request without replacing the record", async () => {
  const f = await createBoundProfileFixture();
  try {
    const store = createCanonicalCredentials(f.admission), current = store.readRecord("duo"), next = credential();
    const prior = current === undefined ? { credentials: [] } : DuoCredentialRecordSchema.parse(current.value);
    const published = store.replaceRecord("duo", current?.revision ?? null, { credentials: [...prior.credentials, next] });
    const first = store.reserveDuoCounter(next.credentialId, "first request");
    assert.equal(first.count, 1);
    assert.throws(() => store.reserveDuoCounter(next.credentialId, "first request"), { code: "CREDENTIAL_CONFLICT" });
    const second = createCanonicalCredentials(f.admission).reserveDuoCounter(next.credentialId, "fresh request");
    assert.equal(second.count, 2); assert.ok(second.revision > first.revision);
    assert.deepEqual(store.readRecord("duo"), published);
  } finally { await f.close(); }
});

it("refuses a mismatched private key under an established CID and preserves the exact authenticated record", async () => {
  const f = await createBoundProfileFixture();
  try {
    const store = createCanonicalCredentials(f.admission), current = store.readRecord("duo"), next = credential();
    const prior = current === undefined ? { credentials: [] } : DuoCredentialRecordSchema.parse(current.value);
    const published = store.replaceRecord("duo", current?.revision ?? null, { credentials: [...prior.credentials, next] });
    const wrong = credential();
    assert.throws(() => store.replaceRecord("duo", published.revision, { credentials: [...prior.credentials,
      { ...next, privateKeyPkcs8: wrong.privateKeyPkcs8 }] }), { code: "CREDENTIAL_UNAVAILABLE" });
    assert.deepEqual(store.readRecord("duo"), published);
    const chatgpt = store.readRecord("chatgpt");
    assert.throws(() => Reflect.apply(store.replaceRecord.bind(store), store, ["chatgpt", chatgpt?.revision ?? null, {}]), { code: "CREDENTIAL_UNAVAILABLE" });
    assert.deepEqual(store.readRecord("chatgpt"), chatgpt);
  } finally { await f.close(); }
});

it("refuses an erase plan/source substitution after key deletion and resumes only the original exact plan", async () => {
  const f = await createBoundProfileFixture({ pending: "onboarding" });
  const profileId = f.admission.profileBinding.profileId;
  const signupPath = join(f.machine.stateRoot, "machine", "operations");
  let protectedBytes: Buffer | undefined, planBytes: Buffer | undefined;
  const protectedPath = join(f.stateRoot, "credentials", "protected.json"), planPath = join(f.machine.stateRoot, "machine", "credential-operations", `${profileId}.json`);
  try {
    const names = readdirSync(signupPath).filter(name => name.endsWith(".json"));
    assert.equal(names.length, 1); const name = names[0]; assert.ok(name);
    const original = SignUpOperationSchema.parse(JSON.parse(readFileSync(join(signupPath, name), "utf8")));
    assert.equal(original.profileId, profileId); assert.ok(original.onboarding);
    const operation = SignUpOperationSchema.parse({ ...original, onboarding: { ...original.onboarding,
      generation: original.onboarding.generation + 1, abort: { operationId: randomUUID(), generation: original.credentials.generation + 1 } } });
    f.machine.publishProfileOperation(operation);
    assert.deepEqual(SignUpOperationSchema.parse(JSON.parse(readFileSync(join(signupPath, `${operation.operationId}.json`), "utf8"))), operation);
    protectedBytes = readFileSync(protectedPath);
    const entry = new FakeKeyringEntry("Relay", `${f.admission.profileBinding.installationId}:${profileId}`), remove = entry.deletePassword.bind(entry);
    vi.spyOn(FakeKeyringEntry.prototype, "deletePassword").mockImplementationOnce(() => {
      remove(); throw new Error("synthetic failure after native key deletion");
    });
    try { assert.throws(() => eraseCanonicalDraftCredentials(f.machine, f.admission, operation), { code: "CREDENTIAL_KEYCHAIN_UNCERTAIN" }); }
    finally { vi.restoreAllMocks(); }
    assert.equal(entry.getPassword(), null);
    const headPath = join(f.machine.stateRoot, "machine", "credential-keys", `${profileId}.json`),
      head = CanonicalCredentialHeadSchema.parse(JSON.parse(readFileSync(headPath, "utf8")));
    assert.equal(head.state, "erased");
    planBytes = readFileSync(planPath);
    const plan = z.looseObject({ files: z.array(z.looseObject({ kind: z.string(), digest: z.string() })) }).parse(JSON.parse(planBytes.toString("utf8")));
    const changed = Buffer.concat([protectedBytes, Buffer.from("\n")]);
    writeFileSync(protectedPath, changed);
    writeFileSync(planPath, JSON.stringify({ ...plan, files: plan.files.map(file => file.kind === "protected"
      ? { ...file, digest: createHash("sha256").update(changed).digest("hex") } : file) }));
    const substituted = storageTree(f.workspace);
    assert.throws(() => eraseCanonicalDraftCredentials(f.machine, f.admission, operation), { code: "CREDENTIAL_UNAVAILABLE" });
    assert.deepEqual(storageTree(f.workspace), substituted); assert.equal(entry.getPassword(), null);
    writeFileSync(protectedPath, protectedBytes); writeFileSync(planPath, planBytes);
    eraseCanonicalDraftCredentials(f.machine, f.admission, operation);
    assert.deepEqual(CanonicalCredentialHeadSchema.parse(JSON.parse(readFileSync(headPath, "utf8"))), head);
    for (const path of [protectedPath, join(f.stateRoot, "credentials", "chatgpt-account.json"),
      join(f.machine.stateRoot, "machine", "duo-credentials", `${profileId}.json`), planPath]) assert.equal(existsSync(path), false);
    assert.equal(entry.getPassword(), null);
  } finally {
    vi.restoreAllMocks();
    await f.close();
  }
});
