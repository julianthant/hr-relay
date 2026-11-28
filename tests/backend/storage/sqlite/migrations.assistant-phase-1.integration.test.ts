import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { it } from "vitest";
import { profileBrowserClosure } from "../../../../src/backend/runtime/browser/profile-browser-closure.js";
import { upgradeProfileAtStartup } from "../../../../src/backend/storage/maintenance/upgrade.js";
import { createCredentialStore } from "../../../../src/backend/storage/configuration/credential-store.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { inspectNativeAuthority } from "../../../../src/backend/storage/sqlite/authority-inspection.js";
import { verifyBackupManifestAtPath } from "../../../../src/backend/storage/sqlite/backup-service.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION, migrationTableNames } from "../../../../src/backend/storage/sqlite/migrations.js";
import { systemClock } from "../../../../src/rules/time/clock.js";
import { restoreSchema42AssistantStorage, restoreSchema45RunSearch, restoreSchema46AssistantEdits } from "../../../support/fixtures/storage/historical-run-schema.js";
import { boundProfileCredentials, createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";

it.each([42, 44, 46] as const)("upgrades populated schema-%d history to the current version, verifies its backup and settles the retained turn", async fromSchemaVersion => {
  const profile = await createBoundProfileFixture();
  const profileId = profile.admission.profileBinding.profileId;
  const options = {
    path: profile.path, busyTimeoutMs: 250, migrationOwner: "assistant-storage-upgrade",
  };
  const tables = ["assistant_proposals", "assistant_proposal_rows", "assistant_session_claims", "assistant_applied_edits"];
  const conversationId = randomUUID(), messageId = randomUUID(), now = systemClock.now().toISOString();
  try {
    const fresh = AuthorityDatabase.open(profile.admission, options, systemClock, undefined, undefined, undefined,
      boundProfileCredentials(profile.admission));
    try {
      fresh.bindAssistantEpoch(() => 1);
      const history = fresh.authority.assistantHistory;
      assert.equal(history.apply({ operation: "create", conversationId, title: "Retained chat" }, now).state, "saved");
      assert.equal(history.accept({ conversationId, expectedRevision: 1, messageId, text: "Explain", modelText: "Explain",
        subjectRef: null, attachments: [], proposalAnswer: null, now }).state, "accepted");
    } finally { fresh.close(); }
    profile.admission.release();

    let original;
    let originalMessages;
    {
      using raw = new DatabaseSync(profile.path);
      assert.equal(inspectNativeAuthority(raw).schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
      for (const table of tables) assert.equal(raw.prepare(`SELECT count(*) AS count FROM ${table}`).get()?.count, 0);
      if (fromSchemaVersion === 42) restoreSchema42AssistantStorage(raw);
      else if (fromSchemaVersion === 46) restoreSchema46AssistantEdits(raw);
      else {
        restoreSchema45RunSearch(raw);
        raw.exec("UPDATE database_states SET schema_version=44; PRAGMA user_version=44");
      }
      original = inspectNativeAuthority(raw, fromSchemaVersion);
      originalMessages = raw.prepare("SELECT * FROM assistant_messages").all();
      assert.equal(originalMessages.length, 1);
    }

    assert.deepEqual(await upgradeProfileAtStartup(profileBrowserClosure, profile.machine, profileId, { primaryDisplay: null }, systemClock),
      { state: "upgraded", fromSchemaVersion, toSchemaVersion: CURRENT_AUTHORITY_SCHEMA_VERSION, credentials: "unchanged" });
    assert.deepEqual(migrationTableNames(CURRENT_AUTHORITY_SCHEMA_VERSION).filter(table => !migrationTableNames(fromSchemaVersion).includes(table)), fromSchemaVersion === 42 ? tables : ["assistant_applied_edits"]);
    {
      using upgraded = new DatabaseSync(profile.path, { readOnly: true });
      assert.equal(inspectNativeAuthority(upgraded).schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
      const parts = [{ kind: "text", runs: [{ kind: "plain", text: "Explain" }] }];
      assert.deepEqual(upgraded.prepare("SELECT * FROM assistant_messages").all().map(row => ({ ...row })), originalMessages.map(row => fromSchemaVersion !== 42 ? { ...row } : { ...row,
        payload_json: JSON.stringify({ parts, recording: { kind: "unrecorded", usage: { state: "unrecorded" } } }) }));
      for (const table of tables) assert.equal(upgraded.prepare(`SELECT count(*) AS count FROM ${table}`).get()?.count, 0);
    }

    const admission = profile.machine.admitProfile(profileId);
    try {
      const directory = join(profile.stateRoot, "backups", "authority");
      const manifests = readdirSync(directory).filter(name => name.endsWith(".manifest.json"));
      assert.equal(manifests.length, 1);
      const backup = await verifyBackupManifestAtPath(admission, join(directory, manifests[0]));
      assert.equal(backup.manifest.schemaVersion, fromSchemaVersion);
      assert.equal(backup.manifest.authorityContentFingerprint, original.authorityContentFingerprint);

      const reopened = AuthorityDatabase.open(admission, options, systemClock, undefined, undefined, undefined,
        createCredentialStore({ admission, stateRoot: profile.stateRoot }));
      try {
        reopened.bindAssistantEpoch(() => 1);
        assert.equal(reopened.authority.assistantHistory.settleInterrupted(now), 1);
        assert.equal(reopened.authority.assistantHistory.conversation(conversationId, now)?.messages.find(message => message.id === messageId)?.delivery, "delivery-unknown");
      } finally { reopened.close(); }
    } finally { admission.release(); }
  } finally { await profile.close(); }
});
