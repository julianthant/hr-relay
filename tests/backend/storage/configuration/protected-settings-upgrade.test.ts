import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { convertProtectedSettings } from "../../../../src/backend/storage/configuration/protected-settings-upgrade.js";
import { authenticateDocument } from "../../../../src/backend/storage/configuration/credential-store.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH, ProtectedSettingsPatchSchema, ProtectedStoreRecordSchema } from "../../../../src/models/config/protected-settings.js";

const priorHash = "c55c987ab4b2f568e6c8781db0a963b379ce67c5fe80dbeab9985ae734c607fe";
const at = "2026-11-04T00:00:00.000Z";
const commandId = "10000000-0000-4000-8000-000000000001", writeId = "10000000-0000-4000-8000-000000000002";
const credentialId = "10000000-0000-4000-8000-000000000003", nameId = "10000000-0000-4000-8000-000000000004", pseudonymId = "10000000-0000-4000-8000-000000000005";

function source() {
  const lastApplied = { commandId, writeId, commandFingerprint: "a".repeat(64), expectedRevision: 1, protectedSchemaHash: priorHash };
  const values = { ucpathUserId: "synthetic-login", timekeeperName: "Old Synthetic Name", activityPersonPseudonym: { keyHex: "b".repeat(64), keyGeneration: "activity-person-test" } };
  const retiredLegacy: { commandIds: string[]; writeIds: string[]; valueIds: string[] } = { commandIds: [], writeIds: [], valueIds: [] };
  return { schemaVersion: 4, historyBaseRevision: 1,
    record: { schemaVersion: 1, revision: 2, protectedSchemaHash: priorHash, lastApplied,
      entries: { ucpathUserId: { valueId: credentialId, value: values.ucpathUserId, updatedAt: at },
        timekeeperName: { valueId: nameId, value: values.timekeeperName, updatedAt: at },
        activityPersonPseudonym: { valueId: pseudonymId, value: values.activityPersonPseudonym, updatedAt: at } } },
    history: [{ receipt: { ...lastApplied, updatedAt: at }, marked: { ucpathUserId: { set: "<set>" }, timekeeperName: { set: "<set>" }, activityPersonPseudonym: { set: "<set>" } },
      setValueIds: { ucpathUserId: credentialId, timekeeperName: nameId, activityPersonPseudonym: pseudonymId } }],
    retiredLegacy,
    latestRequest: { kind: "apply", request: { ...lastApplied, updatedAt: at,
      entries: { ucpathUserId: { set: values.ucpathUserId }, timekeeperName: { set: values.timekeeperName }, activityPersonPseudonym: { set: values.activityPersonPseudonym } } } } };
}

describe("stopped protected settings conversion", () => {
  it("removes retired values and plaintext requests while preserving credential identity and write evidence", () => {
    const prior = source(), original = structuredClone(prior), next = convertProtectedSettings(prior, at);
    assert.deepEqual(prior, original);
    assert.equal(next.schemaVersion, 5);
    assert.equal(next.record.schemaVersion, 2);
    assert.equal(next.record.revision, 3);
    assert.equal(next.record.protectedSchemaHash, PROTECTED_SETTINGS_SCHEMA_HASH);
    assert.deepEqual(next.record.entries, { ucpathUserId: prior.record.entries.ucpathUserId });
    assert.deepEqual(next.history[0], prior.history[0]);
    assert.deepEqual(next.retiredLegacy.valueIds.toSorted(), [nameId, pseudonymId].sort());
    assert.deepEqual(next.latestRequest?.kind === "apply" ? next.latestRequest.request.entries : undefined, {});
    const bytes = JSON.stringify(next);
    assert.equal(bytes.includes("Old Synthetic Name"), false);
    assert.equal(bytes.includes("b".repeat(64)), false);
    assert.deepEqual(authenticateDocument(next), next);
    assert.equal(ProtectedStoreRecordSchema.safeParse(prior.record).success, false);
    assert.throws(() => authenticateDocument(prior));
    assert.equal(ProtectedSettingsPatchSchema.safeParse({ timekeeperName: { set: "Injected name" } }).success, false);
    assert.equal(ProtectedSettingsPatchSchema.safeParse({ activityPersonPseudonym: { clear: true } }).success, false);
  });

  it("retains deny-only retired command, write and value identities", () => {
    const prior = source();
    prior.retiredLegacy = { commandIds: ["10000000-0000-4000-8000-000000000006"], writeIds: ["10000000-0000-4000-8000-000000000007"], valueIds: ["10000000-0000-4000-8000-000000000008"] };
    const next = convertProtectedSettings(prior, at);
    assert.deepEqual(next.retiredLegacy.commandIds, prior.retiredLegacy.commandIds);
    assert.deepEqual(next.retiredLegacy.writeIds, prior.retiredLegacy.writeIds);
    assert.equal(next.retiredLegacy.valueIds.includes(prior.retiredLegacy.valueIds[0]), true);
    assert.equal(next.history[0]?.receipt.commandId, commandId);
    assert.equal(next.history[0]?.receipt.writeId, writeId);
  });

  it("refuses divergent source identity history, plaintext request and future schemas", () => {
    const divergent = source(); divergent.record.entries.timekeeperName.valueId = credentialId;
    assert.throws(() => convertProtectedSettings(divergent, at));
    const changedValue = source(); changedValue.record.entries.timekeeperName.value = "Changed after apply";
    assert.throws(() => convertProtectedSettings(changedValue, at));
    const changedRequest = source(); changedRequest.latestRequest.request.writeId = nameId;
    assert.throws(() => convertProtectedSettings(changedRequest, at));
    assert.throws(() => convertProtectedSettings({ ...source(), schemaVersion: 6 }, at));
    assert.throws(() => convertProtectedSettings({ ...source(), history: [] }, at));
  });
});
