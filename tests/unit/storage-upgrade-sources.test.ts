import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync, chmodSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, it } from "vitest";
import { manualClock } from "../../src/domain/clock.js";
import { canonicalJsonStringify } from "../../src/domain/canonical-json.js";
import { sha256Hex } from "../../src/domain/sha256.js";
import { SQLITE_MIGRATIONS } from "../../src/infra/sqlite/migrations.js";
import { readUpgradeSources } from "../../src/infra/compat/upgrade-sources.js";
import { SETTINGS_SCHEMA_HASH, derivePersistedSettingsFingerprint, deriveSettingsPatchFingerprint } from "../../src/infra/compat/pre-floor-settings.js";

const fixtures: Array<{ root: string; database: DatabaseSync }> = [];
afterEach(() => { for (const fixture of fixtures.splice(0)) { fixture.database.close(); rmSync(fixture.root, { recursive: true, force: true }); } });
const now = "2026-09-06T12:00:00.000Z";
const clock = manualClock(new Date(now));
function fixture(patch: unknown = { concurrency: { defaultWorkers: 3 } }) {
  const root = mkdtempSync(join(tmpdir(), "upgrade-sources-"));
  const database = new DatabaseSync(":memory:");
  for (const migration of SQLITE_MIGRATIONS.filter(({ version }) => version <= 29)) for (const statement of migration.statements) database.exec(statement);
  fixtures.push({ root, database });
  const settingsPath = join(root, "settings.json");
  const settingsPathFingerprint = sha256Hex(resolve(settingsPath));
  const priorAuthority = canonicalJsonStringify({ schemaVersion: 1, settingsPathFingerprint, settingsSchemaHash: SETTINGS_SCHEMA_HASH, state: "virgin" });
  const nextAuthority = canonicalJsonStringify({ schemaVersion: 1, settingsPathFingerprint, settingsSchemaHash: SETTINGS_SCHEMA_HASH, state: "initialized" });
  const request = { family: "settings", type: "apply-settings", commandId: randomUUID(), requestedAt: now, requestedBy: "local-operator", source: "settings-surface",
    target: { expectedRevision: 1 }, payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveSettingsPatchFingerprint(patch), patch } };
  const commandFingerprint = sha256Hex(`hrauto:settings-command:v1\0${canonicalJsonStringify(request)}`);
  const command = { commandId: request.commandId, commandFingerprint, expectedRevision: 1, settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: request.payload.patchFingerprint };
  const next = { revision: 2, settingsSchemaHash: SETTINGS_SCHEMA_HASH, settingsFingerprint: derivePersistedSettingsFingerprint(patch), settings: patch, lastApplied: command };
  const nextBytes = canonicalJsonStringify(next);
  const write = (name: string, value: string) => writeFileSync(join(root, name), value, { mode: 0o600 });
  const prepare = { schemaVersion: 1, prepareId: randomUUID(), settingsPathFingerprint, command, priorSettingsBytesBase64: null,
    nextSettingsBytesBase64: Buffer.from(nextBytes).toString("base64"), priorInitializationBytesBase64: Buffer.from(priorAuthority).toString("base64"), nextInitializationBytesBase64: Buffer.from(nextAuthority).toString("base64") };
  const snapshot = () => Object.fromEntries(readdirSync(root).map((name) => [name, readFileSync(join(root, name), "utf8")]));
  const read = () => readUpgradeSources(root, join(root, ".env"), database, clock);
  const commit = () => {
    const auditId = randomUUID();
    const target = { family: "settings", revision: 2 };
    const audit = { auditId, request, result: { state: "applied", commandId: request.commandId, settingsRevision: 2, settingsFingerprint: next.settingsFingerprint,
      affectedTargets: [target], restartRequired: true }, completedAt: now, versionChanges: [{ target, before: 1, after: 2 }], affectedDependencyIds: [] };
    database.prepare("INSERT INTO commands VALUES (?,?,?,?)").run(request.commandId, "settings", canonicalJsonStringify(request), now);
    database.prepare("INSERT INTO command_audits VALUES (?,?,?,?)").run(auditId, request.commandId, canonicalJsonStringify(audit), now);
    const current = { revision: 2, settingsFingerprint: next.settingsFingerprint, commandId: request.commandId, commandFingerprint, auditId, committedAt: now };
    database.prepare("INSERT INTO settings_current VALUES ('current',?,?,?,?,?,?,?)").run(2, next.settingsFingerprint, request.commandId, commandFingerprint, auditId, canonicalJsonStringify(current), now);
  };
  write("settings.json.authority.json", priorAuthority);
  return { root, database, settingsPathFingerprint, write, read, snapshot, priorAuthority, nextAuthority, nextBytes, prepare, commit, request };
}

describe("stopped upgrade A0/A1 source admission", () => {
  it.each([
    [{ ocr: { pageConcurrency: 3 } }, "OCR_PAGE_CONCURRENCY", "ocr.pageConcurrency"],
    [{ ocr: { maxValidationRetries: 3 } }, "OCR_MAX_VALIDATION_RETRIES", "ocr.maxValidationRetries"],
    [{ concurrency: { defaultWorkers: 3 } }, "HRAUTO_DEFAULT_WORKERS", "concurrency.defaultWorkers"],
  ] as const)("M6 authenticates equal and refuses differing duplicate %s/%s", (patch, name, key) => {
    const f = fixture(patch); f.commit(); f.write("settings.json", f.nextBytes); f.write("settings.json.authority.json", f.nextAuthority);
    f.write(".env", `${name}=3\n`); assert.ok(f.read().importedKeys.includes(key));
    const before = f.snapshot(); assert.deepEqual(f.snapshot(), before);
    f.write(".env", `${name}=7\n`); const divergentBefore = f.snapshot();
    assert.throws(f.read, (error: unknown) => error instanceof Error && error.message.includes(`ambiguous-duplicate { key: ${key} }`));
    assert.deepEqual(f.snapshot(), divergentBefore);
    f.write(".env", `${name}=-1\n`); assert.throws(f.read, /invalid-value/u);
  });
  it("M6 preserves leaf-disjoint historical CRM routes while importing the environment-owned entry", () => {
    const f = fixture({ urls: { crm: { test: { onboardingSearch: "https://fixture.invalid/search" } } } });
    f.commit(); f.write("settings.json", f.nextBytes); f.write("settings.json.authority.json", f.nextAuthority);
    f.write(".env", "HRAUTO_CRM_TEST_URL=https://fixture.invalid/entry\n");
    assert.deepEqual(f.read().settings.urls?.crm?.test, { onboardingSearch: "https://fixture.invalid/search", entry: "https://fixture.invalid/entry" });
  });
  it("reads the old virgin root without creating or changing files", () => {
    const f = fixture(); const before = f.snapshot();
    assert.deepEqual(f.read().settings, {});
    assert.deepEqual(f.read().protectedPatch, {});
    assert.deepEqual(f.snapshot(), before);
  });
  it("selects authenticated prior bytes after a pre-commit crash without rolling source files back", () => {
    const f = fixture();
    f.write("settings.json", f.nextBytes); f.write("settings.json.authority.json", f.nextAuthority);
    f.write("settings.json.prepare.json", canonicalJsonStringify(f.prepare));
    const before = f.snapshot();
    assert.equal(f.read().ordinary.revision, 1);
    assert.deepEqual(f.read().settings, {});
    assert.deepEqual(f.snapshot(), before);
  });
  it("selects only exact journaled next bytes after commit and preserves receipts", () => {
    const f = fixture(); f.commit();
    f.write("settings.json", f.nextBytes); f.write("settings.json.prepare.json", canonicalJsonStringify(f.prepare));
    const before = f.snapshot();
    assert.equal(f.read().ordinary.revision, 2);
    assert.equal(f.read().settings.concurrency?.defaultWorkers, 3);
    assert.deepEqual(f.snapshot(), before);
  });
  it("refuses partial journal evidence, changed live bytes and a committed-but-missing next document", () => {
    const f = fixture();
    f.write("settings.json.prepare.json", canonicalJsonStringify(f.prepare));
    f.database.prepare("INSERT INTO commands VALUES (?,?,?,?)").run(f.request.commandId, "settings", canonicalJsonStringify(f.request), now);
    assert.throws(f.read, /authority-unjournaled/u);
    const g = fixture(); g.write("settings.json", `${g.nextBytes}\n`); g.write("settings.json.prepare.json", canonicalJsonStringify(g.prepare));
    assert.throws(g.read, /bytes-divergent/u);
    const h = fixture(); h.commit(); h.write("settings.json.prepare.json", canonicalJsonStringify(h.prepare));
    assert.throws(h.read, /committed-bytes-missing/u);
  });
  it("refuses differing duplicate sources by key without exposing either value", () => {
    const f = fixture(); f.commit(); f.write("settings.json", f.nextBytes); f.write("settings.json.authority.json", f.nextAuthority);
    f.write(".env", "HRAUTO_DEFAULT_WORKERS=7\nGEMINI_API_KEY=provider-value-must-stay-unopened\n");
    assert.throws(f.read, (error: unknown) => error instanceof Error && error.message.includes("ambiguous-duplicate { key: concurrency.defaultWorkers }")
      && !error.message.includes("provider-value"));
  });
  it.each(["command", "audit", "current", "command-columns", "current-columns"] as const)("refuses %s corruption before changing migration sources", (fault) => {
    const f = fixture(); f.commit(); f.write("settings.json", f.nextBytes); f.write("settings.json.authority.json", f.nextAuthority);
    if (fault === "command") f.database.exec("UPDATE commands SET record_json=json_set(record_json,'$.requestedAt','2026-09-06T13:00:00.000Z')");
    else if (fault === "audit") f.database.exec("UPDATE command_audits SET record_json=json_set(record_json,'$.result.settingsRevision',3)");
    else if (fault === "command-columns") f.database.exec("UPDATE commands SET created_at='2026-09-06T13:00:00.000Z'");
    else {
      for (const row of f.database.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='settings_current'").all()) f.database.exec(`DROP TRIGGER "${String(row.name)}"`);
      f.database.exec(fault === "current-columns" ? "UPDATE settings_current SET created_at='2026-09-06T13:00:00.000Z'" : "UPDATE settings_current SET record_json=json_set(record_json,'$.surprise',true)");
    }
    const before = f.snapshot();
    assert.throws(f.read);
    assert.deepEqual(f.snapshot(), before);
  });
  it("refuses permissive permissions, file aliases and dangling migration sources", () => {
    const f = fixture(); const path = join(f.root, "settings.json.authority.json");
    chmodSync(path, 0o644); assert.throws(f.read, /source-integrity/u);
    chmodSync(path, 0o600); symlinkSync(join(f.root, "absent"), join(f.root, ".env"));
    assert.throws(f.read, /source-integrity/u);
    const g = fixture(); const alias = join(g.root, "alias"); symlinkSync(f.root, alias, "dir");
    assert.throws(() => readUpgradeSources(alias, join(alias, ".env"), g.database, clock), /source-integrity/u);
  });

});
