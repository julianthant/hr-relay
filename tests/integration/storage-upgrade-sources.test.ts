import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync, chmodSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, it } from "vitest";
import { manualClock } from "../../src/domain/clock.js";
import { canonicalJsonStringify } from "../../src/domain/canonical-json.js";
import { sha256Hex } from "../../src/domain/sha256.js";
import { AUTHORITY_APPLICATION_ID, SQLITE_MIGRATIONS } from "../../src/infra/sqlite/migrations.js";
import { upgradeStorage } from "../helpers/synthetic-storage-admission.js";
import { storageTree, credentialTrap } from "./helpers/storage-recovery-fixture.js";
// Immutable v29 fixture facts; no file importer or recovery algorithm remains here.
import { EditableSettingsOverrideSchema } from "../../src/domain/config/settings-v29-schema.js";
const SETTINGS_SCHEMA_HASH = "aa49b924a6acd011954066a5ca78117eb6f7c1f1cee4f08eb3fef3c20d577b80";
const derivePersistedSettingsFingerprint = (value: unknown) => sha256Hex(`hrauto:persisted-settings:v1\0${canonicalJsonStringify(EditableSettingsOverrideSchema.parse(value))}`);
const deriveSettingsPatchFingerprint = (value: unknown) => sha256Hex(`hrauto:settings-patch:v1\0${canonicalJsonStringify(EditableSettingsOverrideSchema.parse(value))}`);

const fixtures: Array<{ root: string; database: DatabaseSync }> = [];
afterEach(() => { for (const fixture of fixtures.splice(0)) { fixture.database.close(); rmSync(fixture.root, { recursive: true, force: true }); } });
const now = "2026-09-06T12:00:00.000Z";
const clock = manualClock(new Date(now));
function fixture(patch: unknown = { concurrency: { defaultWorkers: 3 } }) {
  const root = mkdtempSync(join(tmpdir(), "upgrade-sources-"));
  const database = new DatabaseSync(join(root,"state.db"));
  for (const migration of SQLITE_MIGRATIONS.filter(({ version }) => version <= 29)) for (const statement of migration.statements) database.exec(statement);
  database.prepare("INSERT INTO authority_meta(singleton_id,schema_version,authority_generation,updated_at) VALUES (1,29,7,?)").run(now);
  database.exec(`PRAGMA user_version=29; PRAGMA application_id=${String(AUTHORITY_APPLICATION_ID)}`);
  credentialTrap(root);
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
  const snapshot = () => storageTree(root);
  const read = (plan = false) => upgradeStorage({stateRoot:root,processLockRoot:join(root,"locks"),environmentFile:join(root,".env"),plan},clock);
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

async function refused(f: ReturnType<typeof fixture>) {
  const before=f.snapshot();
  for(const plan of [true,false]) await assert.rejects(f.read(plan),/authority-below-floor \{ schemaVersion: 29, floor: 46 \}/u);
  assert.deepEqual(f.snapshot(),before);
}
describe("expired A0/A1 sources refuse before file or journal recovery", () => {
  it.each([
    [{ ocr: { pageConcurrency: 3 } }, "OCR_PAGE_CONCURRENCY"],
    [{ ocr: { maxValidationRetries: 3 } }, "OCR_MAX_VALIDATION_RETRIES"],
    [{ concurrency: { defaultWorkers: 3 } }, "HRAUTO_DEFAULT_WORKERS"],
  ] as const)("refuses the old database for equal, divergent and invalid duplicates %s/%s", async (patch,name) => {
    const f=fixture(patch);f.commit();f.write("settings.json",f.nextBytes);f.write("settings.json.authority.json",f.nextAuthority);
    for(const value of ["3","7","-1"]) {f.write(".env",`${name}=${value}\n`);await refused(f);}
  });
  it("does not recover leaf-disjoint CRM file/environment routes below the floor",async()=>{
    const f=fixture({urls:{crm:{test:{onboardingSearch:"https://fixture.invalid/search"}}}});f.commit();
    f.write("settings.json",f.nextBytes);f.write(".env","HRAUTO_CRM_TEST_URL=https://fixture.invalid/entry\n");await refused(f);
  });
  it.each(["virgin","before-commit","committed","partial-journal","changed-bytes","missing-next"] as const)("preserves %s sources for the original compatible release",async state=>{
    const f=fixture();
    if(state!=="virgin")f.write("settings.json.prepare.json",canonicalJsonStringify(f.prepare));
    if(state==="committed"||state==="missing-next")f.commit();
    if(state==="partial-journal")f.database.prepare("INSERT INTO commands VALUES (?,?,?,?)").run(f.request.commandId,"settings",canonicalJsonStringify(f.request),now);
    if(state==="before-commit"||state==="committed"||state==="changed-bytes")f.write("settings.json",f.nextBytes+(state==="changed-bytes"?"\n":""));
    await refused(f);
  });
  it("refuses without disclosing either duplicate value or provider credentials",async()=>{
    const f=fixture();f.commit();f.write("settings.json",f.nextBytes);f.write(".env","HRAUTO_DEFAULT_WORKERS=7\nGEMINI_API_KEY=provider-value-must-stay-unopened\n");
    await assert.rejects(f.read(),error=>error instanceof Error&&error.message.includes("authority-below-floor")&&!error.message.includes("provider-value"));await refused(f);
  });
  it.each(["command","audit","current","command-columns","current-columns"] as const)("does not repair %s journal corruption below the floor",async fault=>{
    const f=fixture();f.commit();f.write("settings.json",f.nextBytes);
    if(fault==="command")f.database.exec("UPDATE commands SET record_json=json_set(record_json,'$.requestedAt','2026-09-06T13:00:00.000Z')");
    else if(fault==="audit")f.database.exec("UPDATE command_audits SET record_json=json_set(record_json,'$.result.settingsRevision',3)");
    else if(fault==="command-columns")f.database.exec("UPDATE commands SET created_at='2026-09-06T13:00:00.000Z'");
    else {for(const row of f.database.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='settings_current'").all())f.database.exec(`DROP TRIGGER "${String(row.name)}"`);
      f.database.exec(fault==="current-columns"?"UPDATE settings_current SET created_at='2026-09-06T13:00:00.000Z'":"UPDATE settings_current SET record_json=json_set(record_json,'$.surprise',true)");}
    await refused(f);
  });
  it("leaves permissive and dangling obsolete sources untouched and refuses aliased authority roots",async()=>{
    const f=fixture();chmodSync(join(f.root,"settings.json.authority.json"),0o644);await refused(f);
    symlinkSync(join(f.root,"absent"),join(f.root,".env"));await refused(f);
    const g=fixture(),alias=join(g.root,"alias");symlinkSync(f.root,alias,"dir");const before=f.snapshot();
    await assert.rejects(upgradeStorage({stateRoot:alias,processLockRoot:join(alias,"locks"),environmentFile:join(alias,".env"),plan:false},clock),/source-integrity/u);assert.deepEqual(f.snapshot(),before);
  });
});
