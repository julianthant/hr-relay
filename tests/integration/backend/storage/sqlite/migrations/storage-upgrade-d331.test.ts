import { z } from "zod";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, it } from "vitest";
import { manualClock } from "../../../../../../src/rules/time/clock.js";
import { canonicalJsonStringify } from "../../../../../../src/rules/validation/canonical-json.js";
import { CommandRequestSchema, SettingsCommandRequestSchema } from "../../../../../../src/rules/commands/commands.js";
import { HistoricalProtectedSettingsCommandSchema, deriveJournaledSettingsCommandFingerprint, journaledSettingsCommand } from "../../../../../../src/rules/commands/commands-history.js";
import { SETTINGS_SCHEMA_HASH, deriveSettingsPatchFingerprint } from "../../../../../../src/models/config/settings.js";
// D341: D331 sources belong to the LEGACY protected family; the fixture writes what the pinned reader accepts.
import { LEGACY_PROTECTED_SETTINGS_SCHEMA_HASH, RETIRED_TEST_TARGET_PROTECTED_NAMES, legacyMarkProtectedSettingsPatch, legacyProtectedSettingsReadback } from "../../../../../../src/models/config/protected-settings-legacy.js";
import { AUTHORITY_APPLICATION_ID, SQLITE_MIGRATIONS } from "../../../../../../src/backend/storage/sqlite/migrations.js";
import { backupStoppedAuthority, upgradeStorage } from "../../../../../support/helpers/synthetic-storage-admission.js";
import { createSettingsFileAuthority, createProtectedSettingsFileAuthority } from "../../../../../support/fixtures/d331-settings-file.js";

const roots: string[] = [];
const now = "2026-09-06T12:00:00.000Z";
const clock = manualClock(new Date(now));
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
type Target = "ordinary" | "protected";
function fixture(target: Target, committed: boolean, protectedEntries: Record<string, { set: string }> = { ucpathPassword: { set: "synthetic-d331-private-value" } }) {
  const root = mkdtempSync(join(tmpdir(), "upgrade-d331-")); roots.push(root);
  const directory = join(root, "settings"); mkdirSync(directory, { mode: 0o700 });
  const path = join(root, "state.db"); const ordinaryPath = join(directory, "settings.json");
  const envelope = { commandId: randomUUID(), requestedAt: now, requestedBy: "local-operator", source: "settings-surface", family: "settings", target: { expectedRevision: 1 } };
  const patch = { "concurrency.defaultWorkers": { set: 3 } };
  const request = target === "ordinary" ? SettingsCommandRequestSchema.parse({ ...envelope, type: "apply-settings", payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveSettingsPatchFingerprint(patch), patch } })
    // D341: a pre-D341 journal wrote the protected command in its marked seven-name form, so the
    // journaled command and the D331 file agree on every name, retired ones included.
    : HistoricalProtectedSettingsCommandSchema.parse({ ...envelope, type: "apply-protected-settings", payload: { protectedSchemaHash: LEGACY_PROTECTED_SETTINGS_SCHEMA_HASH, writeId: randomUUID(),
      entries: legacyMarkProtectedSettingsPatch(protectedEntries) } });
  const commandFingerprint = deriveJournaledSettingsCommandFingerprint(request);
  const publication = request.type === "apply-settings"
    ? createSettingsFileAuthority({ path: ordinaryPath, validateCandidate: () => {} }).apply({ commandId: request.commandId, commandFingerprint, expectedRevision: 1, ...request.payload })
    : createProtectedSettingsFileAuthority({ path: ordinaryPath, assertWriteIdAvailable: () => {} }).apply({ commandId: request.commandId, commandFingerprint, expectedRevision: 1, ...request.payload, entries: protectedEntries, updatedAt: now });
  assert.equal(publication.state, "applied");
  if (publication.state !== "applied") throw new Error("D331 fixture failed");
  const prepared = readFileSync(join(directory, "prepare.json"));
  const record = publication.record;
  publication.commit();
  writeFileSync(join(directory, "prepare.json"), prepared, { mode: 0o600 });
  const db = new DatabaseSync(path);
  try {
    for (const migration of SQLITE_MIGRATIONS.filter(({ version }) => version <= 30)) for (const statement of migration.statements) db.exec(statement);
    db.prepare("INSERT INTO authority_meta(singleton_id,schema_version,authority_generation,updated_at) VALUES (1,30,7,?)").run(now);
    db.exec(`PRAGMA user_version=30; PRAGMA application_id=${String(AUTHORITY_APPLICATION_ID)}`);
    if (committed) {
      const marked = journaledSettingsCommand(request); const auditId = randomUUID();
      const affected = { family: target === "ordinary" ? "settings" : "protected-settings", revision: 2 };
      const result = "settingsFingerprint" in record
        ? { state: "applied", commandId: request.commandId, affectedTargets: [affected], restartRequired: true, settingsRevision: 2, settingsFingerprint: record.settingsFingerprint }
        : { state: "applied", commandId: request.commandId, affectedTargets: [affected], restartRequired: false, ...legacyProtectedSettingsReadback(record) };
      const audit = { auditId, request: marked, result, completedAt: now, versionChanges: [{ target: affected, before: 1, after: 2 }], affectedDependencyIds: [] };
      db.prepare("INSERT INTO commands VALUES (?,?,?,?)").run(request.commandId, "settings", canonicalJsonStringify(marked), now);
      db.prepare("INSERT INTO command_audits VALUES (?,?,?,?)").run(auditId, request.commandId, canonicalJsonStringify(audit), now);
      const current = { revision: 2, commandId: request.commandId, commandFingerprint, auditId, committedAt: now };
      if ("settingsFingerprint" in record) db.prepare("INSERT INTO settings_current VALUES ('current',?,?,?,?,?,?,?)").run(2, record.settingsFingerprint, request.commandId, commandFingerprint, auditId, canonicalJsonStringify({ ...current, settingsFingerprint: record.settingsFingerprint }), now);
      else db.prepare("INSERT INTO protected_settings_current VALUES ('current',?,?,?,?,?,?)").run(2, request.commandId, commandFingerprint, auditId, canonicalJsonStringify({ ...current, entries: Object.entries(record.entries).map(([name, value]) => ({ name, valueId: value.valueId, updatedAt: value.updatedAt })) }), now);
    }
  } finally { db.close(); }
  const snapshot = () => Object.fromEntries(readdirSync(directory).sort().map((name) => [name, readFileSync(join(directory, name)).toString("base64")]));
  return { root, directory, path, prepared, snapshot, targetPath: join(directory, target === "ordinary" ? "settings.json" : "protected.json"),
    input: { stateRoot: root, processLockRoot: join(root, "locks"), environmentFile: join(root, ".env"), plan: false } };
}

describe("D341 retired test-target entries in D331 sources", () => {
  it.each([...RETIRED_TEST_TARGET_PROTECTED_NAMES])("refuses the expired source containing %s before any value is read, changing nothing", async (name) => {
    const value = name === "personLookupCanaryEid" ? "10000001" : "4000001";
    const f = fixture("protected", true, { ucpathPassword: { set: "synthetic-d331-private-value" }, [name]: { set: value } });
    const before = f.snapshot(); const databaseBytes = readFileSync(f.path);
    // The journaled row really is a pre-D341 row: only the frozen historical arm reads it.
    const db = new DatabaseSync(f.path, { readOnly: true });
    try {
      const row = z.object({ record_json: z.string() }).parse(db.prepare("SELECT record_json FROM commands").get());
      const journaled: unknown = JSON.parse(row.record_json);
      assert.equal(CommandRequestSchema.safeParse(journaled).success, false, "the live grammar refuses the seven-name row");
      assert.equal(HistoricalProtectedSettingsCommandSchema.safeParse(journaled).success, true, "the frozen arm reads it");
      assert.equal(row.record_json.includes(value), false, "the journal never held the value");
    } finally { db.close(); }
    await backupStoppedAuthority(f.root, clock);
    for (const plan of [true, false]) {
      await assert.rejects(upgradeStorage({ ...f.input, plan }, clock), (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        assert.match(message, /authority-below-floor.*schemaVersion: 30.*floor: 46.*original compatible release/u);
        assert.equal(message.includes(value), false, "the refusal names the key, never the value");
        return true;
      });
    }
    assert.deepEqual(f.snapshot(), before, "D331 bytes untouched");
    assert.deepEqual(readFileSync(f.path), databaseBytes, "database untouched");
    assert.equal(readdirSync(f.root).includes("credentials"), false, "no credential store was created");
  });
});

describe("D331 interrupted sources through stopped upgrade", () => {
  for (const target of ["ordinary", "protected"] as const) {
    it.each([false, true])(`${target}: preserves expired prior/committed bytes (committed=%s)`, async (committed) => {
      const f = fixture(target, committed); const before = f.snapshot();
      await backupStoppedAuthority(f.root, clock);
      const bytes = readFileSync(f.path);
      for (const plan of [true, false]) await assert.rejects(upgradeStorage({ ...f.input, plan }, clock), /authority-below-floor.*schemaVersion: 30.*original compatible release/u);
      assert.deepEqual(f.snapshot(), before);
      assert.deepEqual(readFileSync(f.path), bytes);
      assert.equal(readdirSync(f.root).includes("credentials"), false);
    });
    it(`${target}: refuses expired conversion with exact rollback evidence without altering old source bytes`, async () => {
      const f = fixture(target, false);
      const prepare = z.record(z.string(), z.unknown()).parse(JSON.parse(f.prepared.toString("utf8")));
      const { prepareId: _prepareId, ...body } = prepare;
      writeFileSync(join(f.directory, "rollback.json"), canonicalJsonStringify({ ...body, rollbackId: randomUUID() }), { mode: 0o600 });
      const before = f.snapshot(); await backupStoppedAuthority(f.root, clock);
      for (const plan of [true, false]) await assert.rejects(upgradeStorage({ ...f.input, plan }, clock), /authority-below-floor.*schemaVersion: 30.*original compatible release/u);
      assert.deepEqual(f.snapshot(), before);
      assert.equal(readdirSync(f.root).includes("credentials"), false);
    });
    it.each(["changed", "missing"])(`${target}: refuses committed %s bytes without conversion`, async (corruption) => {
      const f = fixture(target, true);
      if (corruption === "missing") rmSync(f.targetPath);
      else writeFileSync(f.targetPath, `${readFileSync(f.targetPath, "utf8")} `, { mode: 0o600 });
      const before = f.snapshot(); const databaseBytes = readFileSync(f.path);
      await backupStoppedAuthority(f.root, clock);
      for (const plan of [true, false]) await assert.rejects(upgradeStorage({ ...f.input, plan }, clock), /authority-below-floor.*schemaVersion: 30.*original compatible release/u);
      assert.deepEqual(f.snapshot(), before); assert.deepEqual(readFileSync(f.path), databaseBytes);
      assert.equal(readdirSync(f.root).includes("credentials"), false);
    });
  }
});
