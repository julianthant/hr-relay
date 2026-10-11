import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync,mkdtempSync,realpathSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach,describe,it } from "vitest";
import { inspectOpenDatabase } from "../../../src/backend/storage/sqlite/backup-inspection.js";
import { CanonicalClaimNextRequestSchema } from "../../../src/backend/storage/sqlite/run-store-contracts.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH,ProtectedSettingsApplyInputSchema } from "../../../src/models/config/protected-settings.js";
import { deriveBulkChildCommand } from "../../../src/rules/commands/command-groups.js";
import { BulkRunCommandRequestSchema,CommandRequestSchema,deriveBulkRunCommandFingerprint } from "../../../src/rules/commands/commands.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { canonicalJsonStringify } from "../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../src/rules/validation/sha256.js";
import { AuthorityDatabase,createCredentialStore,inspectAuthorityBackupReadOnly } from "../../support/helpers/synthetic-storage-admission.js";

const roots: string[] = [];
const opened: AuthorityDatabase[] = [];
const now = "2026-09-08T12:00:00.000Z";
const clock = manualClock(new Date(now));
afterEach(() => { for (const db of opened.splice(0)) db.close(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "command-groups-")); roots.push(root);
  const stateRoot = join(root, ".tracker", "data"); mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
  const path = join(stateRoot, "state.db");
  const open = () => { const db = AuthorityDatabase.open({ path, busyTimeoutMs: 500, migrationOwner: "command-group-test" }, clock); opened.push(db); return db; };
  return { path, stateRoot, open };
}
function acceptance() {
  const id = randomUUID();
  const request = BulkRunCommandRequestSchema.parse({ commandId: id, bulkCommandId: id, requestedAt: now, requestedBy: "local-operator", source: "dashboard", family: "run", type: "cancel", reason: "synthetic selection", mode: "best-effort", targets: [{ runId: randomUUID(), expectedVersion: 1 }, { runId: randomUUID(), expectedVersion: 4 }] });
  return { bulkCommandId: id, request, requestFingerprint: deriveBulkRunCommandFingerprint(request) };
}
function lifecycleCommand(commandId: string) {
  const request = CanonicalClaimNextRequestSchema.parse({ commandId, workflow: "person-lookup", workerId: "person-lookup-worker-1",
    runtimeConfig: { generation: 1, settingsRevision: 1, settingsFingerprint: "a".repeat(64), configFingerprint: "b".repeat(64) } });
  return { kind: "run-lifecycle", commandId, operation: "claim-next", request,
    requestFingerprint: sha256Hex(`hrauto:run-lifecycle-command:v1\0claim-next\0${canonicalJsonStringify(request)}`),
    fence: { kind: "none" }, recordedAt: now };
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
    assert.throws(() => db.authority.lifecycleJournal.insertCommand(lifecycleCommand(parent.bulkCommandId)), /reused with different content/);

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
    db.authority.lifecycleJournal.insertCommand(lifecycleCommand(lifecycleCollision.bulkCommandId));
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

  it("protects current credential command identities before acceptance", () => {
    const f = fixture(); const db = f.open(); const parent = acceptance();
    const store = createCredentialStore({ stateRoot: f.stateRoot });
    assert.equal(store.apply(ProtectedSettingsApplyInputSchema.parse({ commandId: parent.bulkCommandId, commandFingerprint: "a".repeat(64), expectedRevision: 1, protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH, writeId: randomUUID(), entries: { ucpathPassword: { set: "synthetic-command-group-credential" } }, updatedAt: now })).state, "applied");
    assert.throws(() => db.authority.commands.acceptBulk(parent), /command-divergent/);
    assert.equal(db.authority.commands.getBulk(parent.bulkCommandId), undefined);

  });

  it("rejects SQL self/missing/nested parents and keeps acceptance immutable without a fabricated audit", () => {
    const f = fixture(); const db = f.open(); const parent = acceptance(); db.authority.commands.acceptBulk(parent);
    const child = deriveBulkChildCommand(parent.request, parent.request.targets[0]);
    const raw = new DatabaseSync(f.path);
    try {
      const statement = raw.prepare("INSERT INTO commands(id,family,actor_id,request_json,created_at,parent_id,request_digest,state,updated_at) VALUES (?,?,'local-operator',?,?,?,?,'admitted',?)");
      const insert = { run: (id: string, family: string, json: string, at: string, parentId: string) =>
        statement.run(id, family, json, at, parentId, sha256Hex(json), at) };
      assert.throws(() => insert.run(child.commandId, "run", JSON.stringify(child), now, child.commandId), /commands-parent-kind/u);
      assert.throws(() => insert.run(child.commandId, "run", JSON.stringify(child), now, randomUUID()), /commands-parent-kind/u);
      assert.throws(() => insert.run(randomUUID(), "bulk-parent", JSON.stringify(parent), now, parent.bulkCommandId), /commands-parent-kind/u);
      assert.throws(() => raw.prepare("DELETE FROM commands WHERE id=?").run(parent.bulkCommandId), /commands-bulk-retained/u);
      assert.throws(() => raw.prepare("UPDATE commands SET created_at=? WHERE id=?").run("2026-09-09T00:00:00.000Z", parent.bulkCommandId), /immutable/);
      assert.throws(() => raw.prepare("INSERT INTO command_audits(id,command_id,payload_json,created_at) VALUES (?,?,?,?)").run(randomUUID(), parent.bulkCommandId, "{}", now), /command-audits-no-bulk-parent/u);
    } finally { raw.close(); }
  });

  it.each(["removed", "reassigned"] as const)("detects %s child linkage in current inspection and backup admission", (kind) => {
    const f = fixture(); const db = f.open(); const parent = acceptance(); db.authority.commands.acceptBulk(parent);
    const child = deriveBulkChildCommand(parent.request, parent.request.targets[0]); db.authority.commands.insert(child, parent.bulkCommandId);
    const other = acceptance(); db.authority.commands.acceptBulk(other); db.close();
    const raw = new DatabaseSync(f.path);
    try {
      const trigger = String(raw.prepare("SELECT sql FROM sqlite_master WHERE name='commands_parent_immutable'").get()?.sql);
      assert.throws(() => raw.prepare("UPDATE commands SET parent_id=NULL WHERE id=?").run(child.commandId), /immutable/);
      raw.exec("DROP TRIGGER commands_parent_immutable");
      raw.prepare("UPDATE commands SET parent_id=? WHERE id=?").run(kind === "removed" ? null : other.bulkCommandId, child.commandId);
      raw.exec(trigger);
      assert.throws(() => inspectOpenDatabase(raw), /command-group child linkage mismatch/);
    } finally { raw.close(); }
    assert.throws(() => inspectAuthorityBackupReadOnly(f.path), /command-group child linkage mismatch/);
  });

});
