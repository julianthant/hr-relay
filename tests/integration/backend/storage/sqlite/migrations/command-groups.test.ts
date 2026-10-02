import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../../../../../src/backend/storage/sqlite/migrations.js";
import { deriveBulkChildCommand } from "../../../../../../src/rules/commands/command-groups.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, it } from "vitest";
import { createCredentialStore } from "../../../../../support/helpers/synthetic-storage-admission.js";
import { ProtectedSettingsApplyInputSchema, PROTECTED_SETTINGS_SCHEMA_HASH } from "../../../../../../src/models/config/protected-settings.js";
import { manualClock } from "../../../../../../src/rules/time/clock.js";
import { BulkRunCommandRequestSchema, deriveBulkRunCommandFingerprint, CommandRequestSchema } from "../../../../../../src/rules/commands/commands.js";
import { AuthorityDatabase, inspectConvertedAuthority } from "../../../../../support/helpers/synthetic-storage-admission.js";
import { inspectAuthorityBackupReadOnly } from "../../../../../support/helpers/synthetic-storage-admission.js";
import { AUTHORITY_APPLICATION_ID, SQLITE_MIGRATIONS } from "../../../../../../src/backend/storage/sqlite/migrations.js";
import { backupStoppedAuthority, upgradeStorage } from "../../../../../support/helpers/synthetic-storage-admission.js";
import { DELEGATION_MANIFEST, DEPENDENCY_RECORD } from "../../../../../support/fixtures/phase1c-contract-fixtures.js";

const roots: string[] = [];
const opened: AuthorityDatabase[] = [];
const now = "2026-09-08T12:00:00.000Z";
const clock = manualClock(new Date(now));
afterEach(() => { for (const db of opened.splice(0)) db.close(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture(historicalVersion?: 34 | 35 | 36 | 46) {
  const root = mkdtempSync(join(tmpdir(), "command-groups-")); roots.push(root);
  const stateRoot = join(root, ".tracker"); mkdirSync(stateRoot, { mode: 0o700 });
  const path = join(stateRoot, "state.db");
  const input = { stateRoot, processLockRoot: join(stateRoot, "locks"), environmentFile: join(stateRoot, ".env"), plan: false };
  if (historicalVersion !== undefined) {
    const raw = new DatabaseSync(path);
    try {
      for (const migration of SQLITE_MIGRATIONS.filter(({ version }) => version <= historicalVersion)) for (const sql of migration.statements) raw.exec(sql);
      raw.prepare(`INSERT INTO ${historicalVersion >= 39 ? "database_state" : "authority_meta"}(singleton_id,schema_version,authority_generation,updated_at) VALUES (1,?,7,?)`).run(historicalVersion, now);
      raw.exec(`PRAGMA application_id=${String(AUTHORITY_APPLICATION_ID)}; PRAGMA user_version=${String(historicalVersion)}`);
    } finally { raw.close(); }
  }
  const open = () => { const db = AuthorityDatabase.open({ path, busyTimeoutMs: 500, migrationOwner: "command-group-test" }, clock); opened.push(db); return db; };
  return { path, stateRoot, input, open };
}
function acceptance() {
  const id = randomUUID();
  const request = BulkRunCommandRequestSchema.parse({ commandId: id, bulkCommandId: id, requestedAt: now, requestedBy: "local-operator", source: "dashboard", family: "run", type: "cancel", reason: "synthetic selection", mode: "best-effort", targets: [{ runId: randomUUID(), expectedVersion: 1 }, { runId: randomUUID(), expectedVersion: 4 }] });
  return { bulkCommandId: id, request, requestFingerprint: deriveBulkRunCommandFingerprint(request) };
}
function seedHistorical(f: ReturnType<typeof fixture>, count: number, collision?: "parent" | "child") {
  const parent = acceptance();
  const raw = new DatabaseSync(f.path);
  try {
    raw.prepare("INSERT INTO bulk_command_acceptances VALUES (?,?,?,?)").run(parent.bulkCommandId, parent.requestFingerprint, JSON.stringify(parent, null, 2), now);
    const children = parent.request.targets.map((target) => deriveBulkChildCommand(parent.request, target));
    if (collision === "parent") children[0] = CommandRequestSchema.parse({ ...children[0], commandId: parent.bulkCommandId });
    if (collision === "child") children[0] = { ...children[0], reason: "different historical request" };
    for (const child of children.slice(0, count)) {
      raw.prepare("INSERT INTO commands VALUES (?,?,?,?)").run(child.commandId, child.family, JSON.stringify(child, null, 2), now);
      const audit = { auditId: randomUUID(), request: child, result: { state: "applied", commandId: child.commandId, affectedTargets: [{ family: "run", runId: parent.request.targets[0].runId }] }, completedAt: now, versionChanges: [], affectedDependencyIds: [] };
      raw.prepare("INSERT INTO command_audits VALUES (?,?,?,?)").run(audit.auditId, child.commandId, JSON.stringify(audit, null, 2), now);
    }
    raw.prepare("INSERT INTO delegation_manifests VALUES (?,?,?)").run(DELEGATION_MANIFEST.manifestId, JSON.stringify(DELEGATION_MANIFEST), DELEGATION_MANIFEST.createdAt);
    raw.prepare("INSERT INTO dependencies VALUES (?,?,?,?)").run(DEPENDENCY_RECORD.dependencyId, DEPENDENCY_RECORD.manifestId, JSON.stringify(DEPENDENCY_RECORD), DEPENDENCY_RECORD.createdAt);
    const emptyManifest = { ...DELEGATION_MANIFEST, manifestId: randomUUID(), cardinality: "many", join: "all", children: [] };
    raw.prepare("INSERT INTO delegation_manifests VALUES (?,?,?)").run(emptyManifest.manifestId, JSON.stringify(emptyManifest), emptyManifest.createdAt);
    const manyManifest = { ...DELEGATION_MANIFEST, manifestId: randomUUID(), cardinality: "many", join: "all-settled", children: ["satisfied", "failed", "cancelled"].map(() => ({ ...DELEGATION_MANIFEST.children[0], dependencyId: randomUUID(), childRunId: randomUUID(), childItemId: randomUUID() })) };
    raw.prepare("INSERT INTO delegation_manifests VALUES (?,?,?)").run(manyManifest.manifestId, JSON.stringify(manyManifest), manyManifest.createdAt);
    for (const [index, child] of manyManifest.children.entries()) {
      const dependency = { ...DEPENDENCY_RECORD, manifestId: manyManifest.manifestId, dependencyId: child.dependencyId, childRunId: child.childRunId, childItemId: child.childItemId, state: ["satisfied", "failed", "cancelled"][index], version: 2 };
      raw.prepare("INSERT INTO dependencies VALUES (?,?,?,?)").run(dependency.dependencyId, dependency.manifestId, JSON.stringify(dependency), dependency.createdAt);
    }
    return { parent, commands: raw.prepare("SELECT record_key,record_json FROM commands ORDER BY record_key").all(), audits: raw.prepare("SELECT * FROM command_audits ORDER BY record_key").all(), manifests: raw.prepare("SELECT * FROM delegation_manifests").all(), dependencies: raw.prepare("SELECT * FROM dependencies").all() };
  } finally { raw.close(); }
}

/** Retained supported facts: parent membership and journal bytes are explicit fixture input. */
function supportedFixture(before: ReturnType<typeof seedHistorical>) {
  const f = fixture(46), raw = new DatabaseSync(f.path);
  try {
    raw.prepare("INSERT INTO commands(record_key,family,record_json,created_at) VALUES (?,?,?,?)").run(before.parent.bulkCommandId,"bulk-parent",JSON.stringify({kind:"bulk-parent",commandId:before.parent.bulkCommandId,acceptance:before.parent}),now);
    for (const row of before.commands) raw.prepare("INSERT INTO commands(record_key,family,record_json,created_at,parent_command_id) VALUES (?,?,?,?,?)").run(String(row.record_key),"run",String(row.record_json),now,before.parent.bulkCommandId);
    for (const row of before.audits) raw.prepare("INSERT INTO command_audits VALUES (?,?,?,?)").run(...Object.values(row));
    for (const row of before.manifests) raw.prepare("INSERT INTO run_delegations VALUES (?,?,?)").run(...Object.values(row));
    for (const row of before.dependencies) raw.prepare("INSERT INTO delegation_dependencies VALUES (?,?,?,?)").run(...Object.values(row));
  } finally { raw.close(); }
  return f;
}
async function refuseHistorical(f: ReturnType<typeof fixture>) {
  const before = readFileSync(f.path);
  for (const plan of [true,false]) await assert.rejects(upgradeStorage({...f.input,plan},clock),/authority-below-floor.*original compatible release/u);
  assert.deepEqual(readFileSync(f.path),before);
}

describe("command groups", () => {
  it("keeps standalone, parent and child records distinct, fences membership and counts only executable commands", () => {
    const f = fixture(); const db = f.open(); const parent = acceptance();
    db.authority.commands.acceptBulk(parent);
    assert.equal(inspectAuthorityBackupReadOnly(f.path).counts.pendingCommands, 0);
    const child = deriveBulkChildCommand(parent.request, parent.request.targets[0]);
    assert.throws(() => db.authority.commands.insert(child), /requires its parent/);
    assert.throws(() => db.authority.commands.insert(child, randomUUID()), /invalid parent membership/);
    assert.throws(() => db.authority.commands.insert({ ...child, reason: "forged" }, parent.bulkCommandId), /invalid parent membership/);
    assert.equal(db.authority.commands.insert(child, parent.bulkCommandId).state, "inserted");
    assert.equal(db.authority.commands.insert(child, parent.bulkCommandId).state, "existing");
    assert.throws(() => db.authority.commands.insert(child), /different-parent replay/);
    assert.equal(inspectAuthorityBackupReadOnly(f.path).counts.pendingCommands, 1);
    assert.equal(db.authority.commands.parentId(child.commandId), parent.bulkCommandId);
    const standalone = { ...child, commandId: randomUUID() };
    db.authority.commands.insert(standalone);
    assert.equal(db.authority.commands.parentId(standalone.commandId), null);
    assert.equal(inspectAuthorityBackupReadOnly(f.path).counts.pendingCommands, 2);
    assert.equal(CommandRequestSchema.safeParse({ kind: "bulk-parent", commandId: parent.bulkCommandId, acceptance: parent }).success, false);
    assert.throws(() => db.authority.commands.get(parent.bulkCommandId));
    assert.throws(() => db.authority.lifecycleJournal.getCommand(parent.bulkCommandId));
    assert.throws(() => db.authority.commands.getSettingsHistory(parent.bulkCommandId));
    assert.equal(CommandRequestSchema.safeParse({ ...standalone, parent_command_id: parent.bulkCommandId }).success, false);
    assert.throws(() => db.authority.lifecycleJournal.insertCommand({ kind: "run-lifecycle", commandId: parent.bulkCommandId, operation: "create", requestFingerprint: "a".repeat(64), fence: { kind: "none" }, recordedAt: now }), /reused with different content/);

    assert.equal(db.authority.commands.acceptBulk(parent).state, "existing");
    assert.equal(db.authority.commandAudits.findByCommand(parent.bulkCommandId), undefined);
  });

  it("rejects parent/single collisions and rolls back a failed child without rolling back accepted siblings", () => {
    const f = fixture(); const db = f.open(); const parent = acceptance();
    db.authority.commands.acceptBulk(parent);
    const [first, second] = parent.request.targets.map((target) => deriveBulkChildCommand(parent.request, target));
    db.authority.commands.insert(first, parent.bulkCommandId);
    assert.throws(() => db.withAuthorityTransaction((repo) => { repo.commands.insert(second, parent.bulkCommandId); throw new Error("child-before-commit"); }), /child-before-commit/);
    assert.equal(db.authority.commands.get(second.commandId), undefined);
    assert.deepEqual(db.authority.commands.get(first.commandId), first);
    assert.deepEqual(db.authority.commands.getBulk(parent.bulkCommandId), parent);
    assert.throws(() => db.authority.commands.insert({ ...first, commandId: parent.bulkCommandId }), /reused with different content/);
    const lifecycleCollision = acceptance();
    db.authority.lifecycleJournal.insertCommand({ kind: "run-lifecycle", commandId: lifecycleCollision.bulkCommandId, operation: "create", requestFingerprint: "a".repeat(64), fence: { kind: "none" }, recordedAt: now });
    assert.throws(() => db.authority.commands.acceptBulk(lifecycleCollision), /reused with different content/);
    const preexistingChildParent = acceptance();
    db.authority.commands.insert(deriveBulkChildCommand(preexistingChildParent.request, preexistingChildParent.request.targets[0]));
    assert.throws(() => db.authority.commands.acceptBulk(preexistingChildParent), /reserves an existing command identity/);
    const colliding = acceptance();
    db.authority.commands.insert({ ...first, commandId: colliding.bulkCommandId });
    assert.throws(() => db.authority.commands.acceptBulk(colliding), /reused with different content/);
    db.close(); const restarted = f.open();
    assert.equal(restarted.authority.commands.insert(first, parent.bulkCommandId).state, "existing");
    assert.equal(restarted.authority.commands.insert(second, parent.bulkCommandId).state, "inserted");
  });

  it.each([34, 35, 36] as const)("protects credential command identities before acceptance and historical schema-%s conversion", async (version) => {
    const f = fixture(); const db = f.open(); const parent = acceptance();
    const store = createCredentialStore({ stateRoot: f.stateRoot });
    assert.equal(store.apply(ProtectedSettingsApplyInputSchema.parse({ commandId: parent.bulkCommandId, commandFingerprint: "a".repeat(64), expectedRevision: 1, protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH, writeId: randomUUID(), entries: { ucpathPassword: { set: "synthetic-command-group-credential" } }, updatedAt: now })).state, "applied");
    assert.throws(() => db.authority.commands.acceptBulk(parent), /command-divergent/);
    assert.equal(db.authority.commands.getBulk(parent.bulkCommandId), undefined);

    const historical = fixture(version); const saved = seedHistorical(historical, 0);
    const credentials = createCredentialStore({ stateRoot: historical.stateRoot });
    assert.equal(credentials.apply(ProtectedSettingsApplyInputSchema.parse({ commandId: saved.parent.bulkCommandId, commandFingerprint: "b".repeat(64), expectedRevision: 1, protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH, writeId: randomUUID(), entries: { ucpathPassword: { set: "synthetic-historical-credential" } }, updatedAt: now })).state, "applied");
    await backupStoppedAuthority(historical.stateRoot, clock);
    const before = readFileSync(historical.path);
    await assert.rejects(upgradeStorage(historical.input, clock), /authority-below-floor.*original compatible release/u);
    assert.deepEqual(readFileSync(historical.path), before);
  });

  it("rejects SQL self/missing/nested parents and keeps acceptance immutable without a fabricated audit", () => {
    const f = fixture(); const db = f.open(); const parent = acceptance(); db.authority.commands.acceptBulk(parent);
    const child = deriveBulkChildCommand(parent.request, parent.request.targets[0]);
    const raw = new DatabaseSync(f.path);
    try {
      const insert = raw.prepare("INSERT INTO commands(record_key,family,record_json,created_at,parent_command_id) VALUES (?,?,?,?,?)");
      assert.throws(() => insert.run(child.commandId, "run", JSON.stringify(child), now, child.commandId), /direct bulk parent/);
      assert.throws(() => insert.run(child.commandId, "run", JSON.stringify(child), now, randomUUID()), /direct bulk parent/);
      assert.throws(() => insert.run(randomUUID(), "bulk-parent", JSON.stringify(parent), now, parent.bulkCommandId), /direct bulk parent/);
      assert.throws(() => raw.prepare("DELETE FROM commands WHERE record_key=?").run(parent.bulkCommandId), /never deleted/);
      assert.throws(() => raw.prepare("UPDATE commands SET created_at=? WHERE record_key=?").run("2026-09-09T00:00:00.000Z", parent.bulkCommandId), /immutable/);
      assert.throws(() => raw.prepare("INSERT INTO command_audits VALUES (?,?,?,?)").run(randomUUID(), parent.bulkCommandId, "{}", now), /no execution audit/);
    } finally { raw.close(); }
  });

  it.each(["removed", "reassigned"] as const)("detects %s child linkage in current inspection and backup admission", (kind) => {
    const f = fixture(); const db = f.open(); const parent = acceptance(); db.authority.commands.acceptBulk(parent);
    const child = deriveBulkChildCommand(parent.request, parent.request.targets[0]); db.authority.commands.insert(child, parent.bulkCommandId);
    const other = acceptance(); db.authority.commands.acceptBulk(other); db.close();
    const raw = new DatabaseSync(f.path);
    try {
      const trigger = String(raw.prepare("SELECT sql FROM sqlite_master WHERE name='commands_parent_immutable_update'").get()?.sql);
      assert.throws(() => raw.prepare("UPDATE commands SET parent_command_id=NULL WHERE record_key=?").run(child.commandId), /immutable/);
      raw.exec("DROP TRIGGER commands_parent_immutable_update");
      raw.prepare("UPDATE commands SET parent_command_id=? WHERE record_key=?").run(kind === "removed" ? null : other.bulkCommandId, child.commandId);
      raw.exec(trigger);
      assert.throws(() => inspectConvertedAuthority(raw), /command-group child linkage mismatch/);
    } finally { raw.close(); }
    assert.throws(() => inspectAuthorityBackupReadOnly(f.path), /command-group child linkage mismatch/);
  });

  it.each(([34, 35, 36] as const).flatMap((version) => [0, 1, 2].map((count) => ({ version, count }))))("refuses expired schema-$version, preserves $count retained children through supported recovery, rehearses read-only and settles once", async ({ version, count }) => {
    const historical = fixture(version); const before = seedHistorical(historical, count);
    const oldInspection = inspectAuthorityBackupReadOnly(historical.path);
    assert.equal(oldInspection.schemaVersion, version);
    await refuseHistorical(historical);
    const f = supportedFixture(before);
    await backupStoppedAuthority(f.stateRoot, clock);
    const bytes = readFileSync(f.path);
    assert.equal((await upgradeStorage({ ...f.input, plan: true }, clock)).state, "planned");
    assert.deepEqual(readFileSync(f.path), bytes);
    assert.equal((await upgradeStorage(f.input, clock)).state, "converted");
    const db = f.open(); assert.deepEqual(db.authority.commands.getBulk(before.parent.bulkCommandId), before.parent);
    for (const row of before.manifests) {
      const manifest = JSON.parse(String(row.record_json)) as Record<string, unknown>;
      assert.deepEqual(db.authority.delegationManifests.get(String(row.record_key)), manifest);
      assert.equal(db.authority.delegationManifests.insert(manifest).state, "existing");
      assert.throws(() => db.authority.delegationManifests.insert({ ...manifest, edgeId: "different-edge" }), /different content/);
    }
    for (const row of before.dependencies) assert.deepEqual(db.authority.dependencies.get(String(row.record_key)), JSON.parse(String(row.record_json)));
    db.close();
    const raw = new DatabaseSync(f.path);
    try {
      assert.deepEqual(raw.prepare("SELECT record_key,record_json FROM commands WHERE family <> 'bulk-parent' ORDER BY record_key").all(), before.commands);
      assert.deepEqual(raw.prepare("SELECT * FROM command_audits ORDER BY record_key").all(), before.audits);
      assert.deepEqual(raw.prepare("SELECT * FROM run_delegations").all(), before.manifests);
      assert.deepEqual(raw.prepare("SELECT * FROM delegation_dependencies").all(), before.dependencies);
      assert.equal(raw.prepare("SELECT count(*) AS count FROM commands WHERE parent_command_id=?").get(before.parent.bulkCommandId)?.count, count);
      assert.equal(raw.prepare("SELECT name FROM sqlite_master WHERE name='bulk_command_acceptances'").get(), undefined);
    } finally { raw.close(); }
    assert.equal(inspectAuthorityBackupReadOnly(f.path).counts.pendingCommands, 0);
    const settled = readFileSync(f.path);
    assert.equal((await upgradeStorage(f.input, clock)).state, "already-upgraded");
    assert.deepEqual(readFileSync(f.path), settled);
  });

  it.each(([34, 35, 36] as const).flatMap((version) => (["parent", "child"] as const).map((collision) => ({ version, collision }))))("refuses schema-$version $collision identity collisions before any conversion effects", async ({ version, collision }) => {
    const f = fixture(version); seedHistorical(f, 1, collision); await backupStoppedAuthority(f.stateRoot, clock);
    const before = readFileSync(f.path);
    await assert.rejects(upgradeStorage({ ...f.input, plan: true }, clock), /authority-below-floor.*original compatible release/u);
    await assert.rejects(upgradeStorage(f.input, clock), /authority-below-floor.*original compatible release/u);
    assert.deepEqual(readFileSync(f.path), before);
  });

  it.each([34, 35, 36] as const)("refuses expired schema-%s then rolls back/resumes populated supported conversion without duplicate parents", async (version) => {
    const historical = fixture(version), saved = seedHistorical(historical, 1);
    await refuseHistorical(historical);
    const f = supportedFixture(saved); await backupStoppedAuthority(f.stateRoot, clock);
    const before = readFileSync(f.path);
    await assert.rejects(upgradeStorage({ ...f.input, hooks: { beforeCommit: () => { throw new Error("before-conversion-commit"); } } }, clock), /before-conversion-commit/);
    assert.deepEqual(readFileSync(f.path), before);
    await assert.rejects(upgradeStorage({ ...f.input, hooks: { afterCommit: () => { throw new Error("after-conversion-commit"); } } }, clock), /after-conversion-commit/);
    const inspection = inspectAuthorityBackupReadOnly(f.path);
    assert.equal(inspection.schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
    assert.equal((await upgradeStorage(f.input, clock)).state, "converted");
    const raw = new DatabaseSync(f.path); try { assert.equal(raw.prepare("SELECT count(*) AS count FROM commands WHERE family='bulk-parent'").get()?.count, 1); } finally { raw.close(); }
  });
});
