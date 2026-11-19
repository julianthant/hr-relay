import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { profileBrowserClosure } from "../../../../src/backend/runtime/browser/profile-browser-closure.js";
import { upgradeReadyProfileStorage } from "../../../../src/backend/storage/maintenance/upgrade.js";
import { parseBackupManifestFile } from "../../../../src/backend/storage/sqlite/backup-service.js";
import { insertNativeCommand, settleNativeCommand } from "../../../../src/backend/storage/sqlite/command-record-row.js";
import { NotificationCommandRequestSchema } from "../../../../src/rules/commands/commands.js";
import { systemClock } from "../../../../src/rules/time/clock.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { readyBoundEight, hostFacts } from "../../../support/helpers/storage/ready-bound-upgrade.js";
import { DatabaseSync } from "node:sqlite";
import { it } from "vitest";
import { SQLITE_MIGRATIONS } from "../../../../src/backend/storage/sqlite/migrations.js";
import { ASSISTANT_GRANT_RETIREMENT_VERSION, assertAssistantHistoryRetirable } from "../../../../src/backend/storage/sqlite/assistant-grant-retirement.js";

function predecessor(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  for (const migration of SQLITE_MIGRATIONS.filter(value => value.version < ASSISTANT_GRANT_RETIREMENT_VERSION)) {
    for (const statement of migration.statements) database.exec(statement);
  }
  return database;
}
const tables = (database: DatabaseSync) => database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='assistant_grants'").all();

it("drops the grant table from a store that holds no grant history", () => {
  const database = predecessor();
  try {
    assert.equal(tables(database).length, 1);
    assertAssistantHistoryRetirable(database);
    const migration = SQLITE_MIGRATIONS.find(value => value.version === ASSISTANT_GRANT_RETIREMENT_VERSION); assert.ok(migration);
    for (const statement of migration.statements) database.exec(statement);
    assert.deepEqual(tables(database), []);
  } finally { database.close(); }
});

it.each([
  ["a grant", "INSERT INTO assistant_grants VALUES ('current','profile',1,'plain','{}','created')"],
  ["an assistant action", "INSERT INTO assistant_actions VALUES ('action','chat','command',1,'cancelled','{}','created','expires')"],
  ["a permission command", `INSERT INTO commands VALUES ('permission','settings','operator',NULL,NULL,'digest','{"payload":{"assistantPermission":{"mode":"every-action"}}}','succeeded','{}','created','created')`],
  ["a permission audit", `INSERT INTO command_audits VALUES ('audit','plain',NULL,'{"request":{"payload":{"assistantPermission":{"mode":"every-action"}}}}','created')`],
])("refuses the upgrade when the store holds %s", (_label, insert) => {
  const database = predecessor();
  try {
    database.exec("INSERT INTO assistant_chats VALUES ('chat','profile',1,'{}','created','expires')");
    database.exec(`INSERT INTO commands VALUES ('plain','settings','operator',NULL,NULL,'digest','{"payload":{}}','succeeded','{}','created','created')`);
    assertAssistantHistoryRetirable(database);
    database.exec(insert);
    assert.throws(() => assertAssistantHistoryRetirable(database), /assistant-grant-history-unsupported/u);
  } finally { database.close(); }
});

it("retires an audited settled legacy action into its verified pre-upgrade backup", async () => {
  const fixture = await readyBoundEight("idle", 28);
  try {
    const chatId = randomUUID(), id = randomUUID(), auditId = randomUUID();
    const at = "2026-10-21T12:00:00.000Z", expiresAt = "2026-10-21T13:00:00.000Z";
    const command = NotificationCommandRequestSchema.options[0].parse({ commandId: randomUUID(), requestedAt: at, requestedBy: "local-operator", source: "assistant",
      family: "notification", type: "notification-read", target: { notificationId: randomUUID(), actorId: "local-operator", expectedVersion: 1 } });
    const chat = { id: chatId, profileId: fixture.claim, epoch: 1, createdAt: at, expiresAt };
    const result = { state: "applied", commandId: command.commandId, affectedTargets: [{ family: "notification", notificationId: command.target.notificationId }] };
    const audit = { auditId, request: command, result, completedAt: at, versionChanges: [], affectedDependencyIds: [] };
    const action = { id, chatId, manifest: { revision: 1, entries: [] },
      binding: { profileId: chat.profileId, accountSessionEpoch: chat.epoch, manifestRevision: 1, family: command.family, action: command.type,
        classification: "local-write", commandId: command.commandId, target: command.target, subject: { kind: "none" }, options: { kind: "none" },
        configDescriptor: { kind: "none" }, grantId: randomUUID(), policyRevision: 1, mode: "every-action" },
      command, plan: null, revision: 4, state: "settled", result, createdAt: at, expiresAt };
    const source = new DatabaseSync(fixture.path);
    try {
      insertNativeCommand(source, command);
      settleNativeCommand(source, audit);
      source.prepare("INSERT INTO command_audits VALUES (?,?,NULL,?,?)").run(auditId, command.commandId, canonicalJsonStringify(audit), at);
      source.prepare("INSERT INTO assistant_chats VALUES (?,?,?,?,?,?)").run(chatId, chat.profileId, chat.epoch, canonicalJsonStringify(chat), at, expiresAt);
      const insert = source.prepare("INSERT INTO assistant_actions VALUES (?,?,?,?,?,?,?,?)");
      for (const state of ["claimed", "unknown", "settled"] as const) {
        source.exec("SAVEPOINT unproved");
        const unproved = { ...action, state, result: state === "settled" ? { ...result, state: "already-applied" } : null };
        insert.run(id, chatId, command.commandId, 4, state, canonicalJsonStringify(unproved), at, expiresAt);
        assert.throws(() => assertAssistantHistoryRetirable(source), /assistant-grant-history-unsupported/u);
        source.exec("ROLLBACK TO unproved; RELEASE unproved");
      }
      insert.run(id, chatId, command.commandId, 4, "settled", canonicalJsonStringify(action), at, expiresAt);
    } finally { source.close(); }
    assert.equal((await upgradeReadyProfileStorage(profileBrowserClosure, fixture.machine, fixture.claim, { plan: false, hostFacts }, systemClock)).state, "upgraded");
    const current = new DatabaseSync(fixture.path, { readOnly: true });
    try {
      assert.equal(current.prepare("SELECT id FROM assistant_actions WHERE id=?").get(id), undefined);
      assert.ok(current.prepare("SELECT id FROM command_audits WHERE id=?").get(auditId));
      const row = current.prepare("SELECT json_extract(payload_json,'$.backup.manifestPath') AS manifest FROM database_upgrades WHERE phase='settled'").get();
      assert.ok(row && typeof row.manifest === "string");
      const manifest = parseBackupManifestFile(row.manifest);
      const backup = new DatabaseSync(join(dirname(row.manifest), manifest.backupFileName), { readOnly: true });
      try { assert.equal(backup.prepare("SELECT payload_json FROM assistant_actions WHERE id=?").get(id)?.payload_json, canonicalJsonStringify(action)); }
      finally { backup.close(); }
    } finally { current.close(); }
  } finally { await fixture.close(); }
});
