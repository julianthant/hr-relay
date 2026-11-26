import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "vitest";
import { assessCredentialInventory } from "../../../src/backend/profiles/credential-inventory.js";
import { STOPPED_PROTECTED_SETTINGS_SCHEMA_HASH } from "../../../src/backend/storage/configuration/protected-settings-upgrade.js";

it.each([2, 3])("requires a structurally valid version %d copy before certifying logout", schemaVersion => {
  const profileRoot = mkdtempSync(join(tmpdir(), "inventory-legacy-"));
  try {
    const credentials = join(profileRoot, "credentials");
    mkdirSync(credentials, { mode: 0o700 });
    const active = join(credentials, "protected.json");
    const stage = join(credentials, ".protected.fixture.tmp");
    const backup = join(profileRoot, "backup.json");
    const input = { profileRoot, entriesAbsent: true, backupPaths: [backup], loginDataPaths: [], capturedSecretsComplete: true };
    const record = { schemaVersion: 1, revision: 1, protectedSchemaHash: STOPPED_PROTECTED_SETTINGS_SCHEMA_HASH, entries: {} };
    const clean = { schemaVersion, record, history: [] };
    writeFileSync(backup, JSON.stringify(clean), { mode: 0o600 });
    assert.equal(assessCredentialInventory(input).logoutComplete, true);
    for (const invalid of [
      { schemaVersion },
      { ...clean, record: { ...record, entries: null } },
      { ...clean, record: { ...record, entries: { unexpected: {} } } },
      { ...clean, history: {} },
      { ...clean, history: [{}] },
      { ...clean, history: [{ request: { entries: {} }, setValueIds: {} }] },
    ]) {
      for (const path of [active, stage, backup]) {
        writeFileSync(path, JSON.stringify(invalid), { mode: 0o600 });
        const result = assessCredentialInventory(input);
        assert.equal(result.logoutComplete, false, path === active ? "active" : path === stage ? "stage" : "backup");
        assert.equal(result.protectedPlaintext, false);
        assert.equal(result.stagePlaintext, path === stage);
        assert.deepEqual(result.unknownFormats, path === backup ? [backup] : []);
        if (path === backup) writeFileSync(backup, JSON.stringify(clean), { mode: 0o600 });
        else rmSync(path);
      }
    }
  } finally {
    rmSync(profileRoot, { recursive: true, force: true });
  }
});

it("requires the historical request receipt on version 3 history entries", () => {
  const profileRoot = mkdtempSync(join(tmpdir(), "inventory-legacy-receipt-"));
  try {
    const backup = join(profileRoot, "backup.json");
    const input = { profileRoot, entriesAbsent: true, backupPaths: [backup], loginDataPaths: [], capturedSecretsComplete: true };
    const lastApplied = {
      commandId: "00000000-0000-4000-8000-000000000001",
      writeId: "00000000-0000-4000-8000-000000000002",
      commandFingerprint: "a".repeat(64),
      expectedRevision: 1,
      protectedSchemaHash: STOPPED_PROTECTED_SETTINGS_SCHEMA_HASH,
    };
    const receipt = { ...lastApplied, updatedAt: "2026-01-01T00:00:00.000Z" };
    const copy = {
      schemaVersion: 3,
      record: { schemaVersion: 1, revision: 2, protectedSchemaHash: STOPPED_PROTECTED_SETTINGS_SCHEMA_HASH, entries: {}, lastApplied },
    };
    const writeCopy = (historyReceipt: typeof receipt & { requestReceipt?: string }) => writeFileSync(backup, JSON.stringify({
      ...copy,
      history: [{ receipt: historyReceipt, marked: { timekeeperName: { clear: true } }, setValueIds: {} }],
    }), { mode: 0o600 });

    writeCopy({ ...receipt, requestReceipt: "b".repeat(64) });
    assert.equal(assessCredentialInventory(input).logoutComplete, true);
    writeCopy(receipt);
    const invalid = assessCredentialInventory(input);
    assert.equal(invalid.logoutComplete, false);
    assert.deepEqual(invalid.unknownFormats, [backup]);
  } finally {
    rmSync(profileRoot, { recursive: true, force: true });
  }
});
