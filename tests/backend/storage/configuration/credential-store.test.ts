import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  authenticateDocument, CredentialDocumentSchema, initialDocument, type CredentialDocument,
} from "../../../../src/backend/storage/configuration/credential-store.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH } from "../../../../src/models/config/protected-settings.js";
import { FingerprintSchema, IsoInstantSchema, PositiveIntSchema } from "../../../../src/rules/identity/ids.js";

const COMMAND_1 = "10000000-0000-4000-8000-000000000001";
const COMMAND_2 = "10000000-0000-4000-8000-000000000002";
const WRITE_1 = "20000000-0000-4000-8000-000000000001";
const WRITE_2 = "20000000-0000-4000-8000-000000000002";
const VALUE_1 = "30000000-0000-4000-8000-000000000001";
const VALUE_2 = "30000000-0000-4000-8000-000000000002";
const FIRST_AT = "2026-11-01T12:00:00.000Z";
const LAST_AT = "2026-11-01T12:01:00.000Z";
const FOREIGN_FINGERPRINT = FingerprintSchema.parse("c".repeat(64));

function twoCommands(): CredentialDocument {
  const first = { commandId: COMMAND_1, commandFingerprint: "a".repeat(64), expectedRevision: 1,
    protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH, writeId: WRITE_1 };
  const latest = { commandId: COMMAND_2, commandFingerprint: "b".repeat(64), expectedRevision: 2,
    protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH, writeId: WRITE_2 };
  return CredentialDocumentSchema.parse({
    schemaVersion: 4, historyBaseRevision: 1,
    record: { schemaVersion: 1, revision: 3, protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH,
      entries: {
        timekeeperName: { valueId: VALUE_1, value: "Synthetic previous keeper", updatedAt: FIRST_AT },
        ucpathUserId: { valueId: VALUE_2, value: "synthetic-current-user", updatedAt: LAST_AT },
      }, lastApplied: latest },
    history: [
      { receipt: { ...first, updatedAt: FIRST_AT }, marked: { timekeeperName: { set: "<set>" } }, setValueIds: { timekeeperName: VALUE_1 } },
      { receipt: { ...latest, updatedAt: LAST_AT }, marked: { ucpathUserId: { set: "<set>" } }, setValueIds: { ucpathUserId: VALUE_2 } },
    ],
    retiredLegacy: { commandIds: [], writeIds: [], valueIds: [] },
    latestRequest: { kind: "apply", request: { ...latest, updatedAt: LAST_AT, entries: { ucpathUserId: { set: "synthetic-current-user" } } } },
  });
}

function importedHistory(): CredentialDocument {
  const document = twoCommands();
  delete document.record.entries.timekeeperName;
  document.retiredLegacy = { commandIds: [COMMAND_1], writeIds: [], valueIds: [VALUE_1] };
  return document;
}

describe("protected credential payload authentication", () => {
  it("accepts the empty current document without inventing history or a latest request", () => {
    const document = authenticateDocument(initialDocument());
    assert.equal(document.schemaVersion, 4);
    assert.equal(document.record.revision, 1);
    assert.deepEqual(document.record.entries, {});
    assert.deepEqual(document.history, []);
    assert.equal(document.latestRequest, undefined);
  });

  it("accepts a contiguous two-command chain and keeps both current values", () => {
    const document = authenticateDocument(twoCommands());
    assert.equal(document.record.revision, 3);
    assert.deepEqual(document.history.map(entry => entry.receipt.commandId), [COMMAND_1, COMMAND_2]);
    assert.deepEqual(document.record.entries, {
      timekeeperName: { valueId: VALUE_1, value: "Synthetic previous keeper", updatedAt: FIRST_AT },
      ucpathUserId: { valueId: VALUE_2, value: "synthetic-current-user", updatedAt: LAST_AT },
    });
  });

  it("accepts imported retired command history while filtering only the retired value", () => {
    const input = importedHistory(), document = authenticateDocument(input);
    assert.equal(document.history[0]?.receipt.commandId, COMMAND_1);
    assert.deepEqual(document.retiredLegacy.commandIds, [COMMAND_1]);
    assert.deepEqual(document.record.entries, {
      ucpathUserId: { valueId: VALUE_2, value: "synthetic-current-user", updatedAt: LAST_AT },
    });
    assert.deepEqual(document.latestRequest, input.latestRequest);
    assert.equal(document.record.lastApplied?.commandId, COMMAND_2);
  });

  it("rejects a retired value revived into the current record", () => {
    const document = importedHistory();
    document.record.entries.timekeeperName = { valueId: VALUE_1, value: "Synthetic previous keeper", updatedAt: IsoInstantSchema.parse(FIRST_AT) };
    assert.throws(() => authenticateDocument(document), /identity history/u);
  });

  it("rejects a gap even when the final revision and latest receipt still agree", () => {
    const document = twoCommands();
    const first = document.history[0]; assert.ok(first);
    first.receipt.expectedRevision = PositiveIntSchema.parse(2);
    assert.throws(() => authenticateDocument(document), /malformed identity history/u);
  });

  for (const identity of ["commandId", "writeId"] as const) it(`rejects duplicate historical ${identity}`, () => {
    const document = twoCommands();
    const first = document.history[0], latest = document.history[1]; assert.ok(first && latest);
    if (identity === "commandId") first.receipt.commandId = latest.receipt.commandId;
    else first.receipt.writeId = latest.receipt.writeId;
    assert.throws(() => authenticateDocument(document), /malformed identity history/u);
  });

  it("rejects a value identity allocated by two historical commands", () => {
    const document = twoCommands();
    const first = document.history[0]; assert.ok(first);
    first.setValueIds.timekeeperName = VALUE_2;
    assert.throws(() => authenticateDocument(document), /malformed identity history/u);
  });

  it("rejects a latest record receipt that diverges from the history", () => {
    const document = twoCommands();
    assert.ok(document.record.lastApplied);
    document.record.lastApplied.commandFingerprint = FOREIGN_FINGERPRINT;
    assert.throws(() => authenticateDocument(document), /identity history/u);
  });

  it("rejects a latest request that diverges from its otherwise valid receipt", () => {
    const document = twoCommands();
    assert.ok(document.latestRequest);
    document.latestRequest.request.commandFingerprint = FOREIGN_FINGERPRINT;
    assert.throws(() => authenticateDocument(document), /credential-document-history-invalid/u);
  });

  for (const schemaVersion of [3, 5]) it(`rejects foreign payload format ${schemaVersion}`, () => {
    assert.throws(() => authenticateDocument({ ...twoCommands(), schemaVersion }), /malformed/u);
  });

  it("rejects a foreign protected settings schema", () => {
    const document = twoCommands();
    document.record.protectedSchemaHash = FOREIGN_FINGERPRINT;
    assert.throws(() => authenticateDocument(document), /malformed/u);
  });

  it("rejects retired write identities that overlap retained command history", () => {
    const document = importedHistory();
    document.retiredLegacy.writeIds = [WRITE_1];
    assert.throws(() => authenticateDocument(document), /credential-document-history-invalid/u);
  });
});
