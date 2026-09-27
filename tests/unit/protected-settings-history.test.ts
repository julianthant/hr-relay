import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, it } from "vitest";
import { canonicalJsonStringify } from "../../src/domain/canonical-json.js";
import { manualClock } from "../../src/domain/clock.js";
import {
  CommandAuditRecordSchema,
  CommandRequestSchema,
  MarkedProtectedSettingsCommandRequestSchema,
  ProtectedSettingsCommandRequestSchema,
  deriveSettingsCommandFingerprint,
} from "../../src/domain/commands.js";
import {
  HistoricalProtectedSettingsAuditSchema,
  HistoricalProtectedSettingsCommandSchema,
  deriveJournaledSettingsCommandFingerprint,
  journaledSettingsCommand,
} from "../../src/domain/commands-history.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH } from "../../src/domain/config/protected-settings.js";
import {
  LEGACY_PROTECTED_SETTINGS_SCHEMA_HASH,
  LegacyProtectedSettingsNameSchema,
  RETIRED_TEST_TARGET_PROTECTED_NAMES,
  legacyMarkProtectedSettingsPatch,
} from "../../src/domain/config/protected-settings-legacy.js";
import { sha256Hex } from "../../src/domain/sha256.js";
import { AuthorityDatabase } from "../helpers/synthetic-storage-admission.js";

/**
 * D341 — historical journal readability is permanent. A pre-D341 protected-settings command
 * named the two retired canaries in its marked form; the live grammar refuses that row, so the
 * frozen arm in commands-history reads it and the D341 refusal happens by name afterwards.
 */
const now = "2026-09-01T09:00:00.000Z";
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function envelope() {
  return { commandId: randomUUID(), requestedAt: now, requestedBy: "local-operator", source: "settings-surface", family: "settings", type: "apply-protected-settings", target: { expectedRevision: 1 } };
}
const SYNTHETIC_DOCUMENT_NUMBER = "4000001";
const SYNTHETIC_EID = "10000001";
function historicalCommand(protectedSchemaHash: string = LEGACY_PROTECTED_SETTINGS_SCHEMA_HASH) {
  return {
    ...envelope(),
    payload: {
      protectedSchemaHash,
      writeId: randomUUID(),
      entries: legacyMarkProtectedSettingsPatch({
        ucpathPassword: { set: "synthetic-private-value" },
        separationsKualiFinalizationCanaryDocumentNumber: { set: SYNTHETIC_DOCUMENT_NUMBER },
        personLookupCanaryEid: { set: SYNTHETIC_EID },
      }),
    },
  };
}
function liveCommand() {
  return ProtectedSettingsCommandRequestSchema.parse({
    ...envelope(),
    payload: { protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH, writeId: randomUUID(), entries: { ucpathPassword: { set: "synthetic-private-value" } } },
  });
}

describe("pre-D341 marked protected-settings commands", () => {
  it("parse only through the frozen historical arm and never carry a value", () => {
    const command = historicalCommand();
    for (const name of RETIRED_TEST_TARGET_PROTECTED_NAMES) assert.deepEqual(command.payload.entries[name], { set: "<set>" });
    assert.equal(CommandRequestSchema.safeParse(command).success, false, "the live durable grammar never admits the seven-name row");
    assert.equal(MarkedProtectedSettingsCommandRequestSchema.safeParse(command).success, false);
    assert.deepEqual(HistoricalProtectedSettingsCommandSchema.parse(command), command);
    const text = canonicalJsonStringify(command);
    assert.equal(text.includes(SYNTHETIC_DOCUMENT_NUMBER) || text.includes(SYNTHETIC_EID) || text.includes("synthetic-private-value"), false);
  });

  it("refuse a live schema hash and any unmarked value, so no new command can enter through history", () => {
    assert.equal(HistoricalProtectedSettingsCommandSchema.safeParse(historicalCommand(PROTECTED_SETTINGS_SCHEMA_HASH)).success, false, "pinned to the legacy hash");
    const valued = historicalCommand();
    const withValue = { ...valued, payload: { ...valued.payload, entries: { ...valued.payload.entries, personLookupCanaryEid: { set: SYNTHETIC_EID } } } };
    assert.equal(HistoricalProtectedSettingsCommandSchema.safeParse(withValue).success, false, "values never parse");
    assert.equal(HistoricalProtectedSettingsCommandSchema.safeParse({ ...valued, payload: { ...valued.payload, entries: { ...valued.payload.entries, unknownName: { set: "<set>" } } } }).success, false);
  });

  it("derive the same journal form and fingerprint the pre-D341 kernel recorded", () => {
    const command = historicalCommand();
    assert.deepEqual(journaledSettingsCommand(command), command, "a historical row is already marked");
    assert.equal(
      deriveJournaledSettingsCommandFingerprint(command),
      sha256Hex(`hrauto:settings-command:v1\0${canonicalJsonStringify(command)}`),
    );
    const live = liveCommand();
    assert.equal(deriveJournaledSettingsCommandFingerprint(live), deriveSettingsCommandFingerprint(live), "live commands are unchanged");
  });

  it("read back from the durable journal through the settings-history readers", () => {
    const root = mkdtempSync(join(tmpdir(), "protected-history-")); roots.push(root);
    const path = join(root, "state.db");
    const clock = manualClock(new Date(now));
    AuthorityDatabase.open({ path, busyTimeoutMs: 250, migrationOwner: "unit-test" }, clock).close();
    const command = historicalCommand();
    const auditId = randomUUID();
    const target = { family: "protected-settings", revision: 2 };
    const entries = Object.fromEntries(LegacyProtectedSettingsNameSchema.options.map((name) => [name, name in command.payload.entries
      ? { present: true, valueId: randomUUID(), updatedAt: now }
      : { present: false }]));
    const audit = { auditId, request: command, result: { state: "applied", commandId: command.commandId, affectedTargets: [target], restartRequired: false, revision: 2, entries }, completedAt: now, versionChanges: [{ target, before: 1, after: 2 }], affectedDependencyIds: [] };
    assert.equal(CommandAuditRecordSchema.safeParse(audit).success, false, "the live audit grammar refuses the seven-name request");
    assert.deepEqual(HistoricalProtectedSettingsAuditSchema.parse(audit), audit);
    const raw = new DatabaseSync(path);
    try {
      raw.prepare("INSERT INTO commands(record_key,family,record_json,created_at) VALUES (?,?,?,?)").run(command.commandId, "settings", canonicalJsonStringify(command), now);
      raw.prepare("INSERT INTO command_audits VALUES (?,?,?,?)").run(auditId, command.commandId, canonicalJsonStringify(audit), now);
    } finally { raw.close(); }
    const database = AuthorityDatabase.open({ path, busyTimeoutMs: 250, migrationOwner: "unit-test" }, clock);
    try {
      assert.deepEqual(database.authority.commands.getSettingsHistory(command.commandId), command);
      assert.deepEqual(database.authority.commandAudits.findSettingsHistory(command.commandId), audit);
      assert.throws(() => database.authority.commands.get(command.commandId), "the live reader still refuses it");
    } finally { database.close(); }
  });
});
