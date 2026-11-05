import assert from "node:assert/strict";
import { createCipheriv, randomBytes, randomUUID } from "node:crypto";
import { authenticateDocument } from "../../../src/backend/storage/configuration/credential-store.js";
import { inspectProtectedSettingsSource, STOPPED_PROTECTED_SETTINGS_SCHEMA_HASH } from "../../../src/backend/storage/configuration/protected-settings-upgrade.js";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RuntimeAdmission } from "../../../src/backend/storage/admission/admission.js";
import { createCanonicalCredentials, CanonicalCredentialHeadSchema } from "../../../src/backend/storage/configuration/canonical-credential-store.js";
import { credentialKeyCustody } from "../../../src/backend/storage/configuration/credential-key-custody.js";
import { canonicalJsonStringify } from "../../../src/rules/validation/canonical-json.js";

export function captureProfileCredentialFixture(admission: RuntimeAdmission) {
  const record = createCanonicalCredentials(admission).readRecord("protected"); assert.ok(record);
  const path = join(admission.stateRoot, "credentials", "protected.json"), bytes = readFileSync(path);
  const machine = admission.readInstallationContext(); assert.ok(machine);
  const head = CanonicalCredentialHeadSchema.parse(JSON.parse(readFileSync(join(machine.locator.stateRoot, "machine", "credential-keys", `${admission.profileBinding.profileId}.json`), "utf8")));
  assert.ok(head.state === "active");
  const key = credentialKeyCustody.read(head.key);
  return { rewrite(change: (payload: unknown) => unknown): void {
    assert.deepEqual(readFileSync(path), bytes, "captured fixture source must remain exact");
    const frame = JSON.parse(bytes.toString("utf8")) as { revision: number; nonce: string; tag: string; ciphertext: string };
    const { tag: _tag, ciphertext: _ciphertext, ...prior } = frame;
    const nonce = randomBytes(12), header = { ...prior, nonce: nonce.toString("base64") };
    const cipher = createCipheriv("aes-256-gcm", Buffer.from(key.key, "base64"), nonce);
    cipher.setAAD(Buffer.from(canonicalJsonStringify(header)));
    const ciphertext = Buffer.concat([cipher.update(Buffer.from(canonicalJsonStringify({ revision: record.revision, value: change(record.value) }))), cipher.final()]);
    writeFileSync(path, canonicalJsonStringify({ ...header, ciphertext: ciphertext.toString("base64"), tag: cipher.getAuthTag().toString("base64") }), { mode: 0o600 });
  } };
}

export function installPredecessorProfileCredentials(source: ReturnType<typeof captureProfileCredentialFixture>, name: string, valueId = randomUUID(), commandId?: string): void {
  source.rewrite(input => {
    const document = authenticateDocument(input), latest = document.latestRequest;
    assert.ok(latest?.kind === "apply" && document.history.length === 1 && document.record.lastApplied);
    const receipt = (original: NonNullable<typeof document.record.lastApplied>) => ({ ...original, ...(commandId === undefined ? {} : { commandId }), protectedSchemaHash: STOPPED_PROTECTED_SETTINGS_SCHEMA_HASH });
    return inspectProtectedSettingsSource({ ...document, schemaVersion: 4,
      record: { ...document.record, schemaVersion: 1, protectedSchemaHash: STOPPED_PROTECTED_SETTINGS_SCHEMA_HASH,
        lastApplied: receipt(document.record.lastApplied),
        entries: { ...document.record.entries, timekeeperName: { valueId, value: name, updatedAt: latest.request.updatedAt } } },
      history: document.history.map(entry => ({ receipt: { ...receipt(entry.receipt), updatedAt: entry.receipt.updatedAt },
        marked: { ...entry.marked, timekeeperName: { set: "<set>" } }, setValueIds: { ...entry.setValueIds, timekeeperName: valueId } })),
      latestRequest: { kind: "apply", request: { ...latest.request, ...(commandId === undefined ? {} : { commandId }), protectedSchemaHash: STOPPED_PROTECTED_SETTINGS_SCHEMA_HASH,
        entries: { ...latest.request.entries, timekeeperName: { set: name } } } } });
  });
}
