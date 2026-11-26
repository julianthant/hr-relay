import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { it } from "vitest";
import { profileBrowserClosure } from "../../../../src/backend/runtime/browser/profile-browser-closure.js";
import { upgradeProfileAtStartup } from "../../../../src/backend/storage/maintenance/upgrade.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { inspectNativeAuthority } from "../../../../src/backend/storage/sqlite/authority-inspection.js";
import { verifyBackupManifestAtPath } from "../../../../src/backend/storage/sqlite/backup-service.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION, migrationTableNames } from "../../../../src/backend/storage/sqlite/migrations.js";
import { systemClock } from "../../../../src/rules/time/clock.js";
import { restoreSchema42AssistantStorage } from "../../../support/fixtures/storage/historical-run-schema.js";
import { boundProfileCredentials, createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";

it("upgrades populated schema-42 history, verifies its backup and keeps legacy settlements working", async () => {
  const profile = await createBoundProfileFixture();
  const profileId = profile.admission.profileBinding.profileId;
  const open = (admission = profile.admission) => AuthorityDatabase.open(admission, {
    path: profile.path, busyTimeoutMs: 250, migrationOwner: "assistant-storage-upgrade",
  }, systemClock, undefined, undefined, undefined, boundProfileCredentials(admission));
  const tables = ["assistant_proposals", "assistant_proposal_rows", "assistant_session_claims"];
  const conversationId = randomUUID(), messageId = randomUUID(), now = systemClock.now().toISOString();
  try {
    const fresh = open();
    try {
      const history = fresh.authority.assistantHistory;
      assert.equal(history.apply({ operation: "create", conversationId, title: "Retained chat" }, now).state, "saved");
      assert.equal(history.accept({ conversationId, expectedRevision: 1, messageId, text: "Explain", modelText: "Explain",
        subjectRef: null, attachments: [], now }).state, "accepted");
    } finally { fresh.close(); }
    profile.admission.release();

    let original;
    let originalMessages;
    {
      using raw = new DatabaseSync(profile.path);
      assert.equal(inspectNativeAuthority(raw).schemaVersion, 43);
      for (const table of tables) assert.equal(raw.prepare(`SELECT count(*) AS count FROM ${table}`).get()?.count, 0);
      restoreSchema42AssistantStorage(raw);
      original = inspectNativeAuthority(raw, 42);
      originalMessages = raw.prepare("SELECT * FROM assistant_messages").all();
      assert.equal(originalMessages.length, 1);
    }

    assert.deepEqual(await upgradeProfileAtStartup(profileBrowserClosure, profile.machine, profileId, { primaryDisplay: null }, systemClock),
      { state: "upgraded", fromSchemaVersion: 42, toSchemaVersion: 43, credentials: "unchanged" });
    assert.deepEqual(migrationTableNames(CURRENT_AUTHORITY_SCHEMA_VERSION).filter(table => !migrationTableNames(42).includes(table)), tables);
    {
      using upgraded = new DatabaseSync(profile.path, { readOnly: true });
      assert.equal(inspectNativeAuthority(upgraded).schemaVersion, 43);
      assert.deepEqual(upgraded.prepare("SELECT * FROM assistant_messages").all(), originalMessages);
      for (const table of tables) assert.equal(upgraded.prepare(`SELECT count(*) AS count FROM ${table}`).get()?.count, 0);
    }

    const admission = profile.machine.admitProfile(profileId);
    try {
      const directory = join(profile.stateRoot, "backups", "authority");
      const manifests = readdirSync(directory).filter(name => name.endsWith(".manifest.json"));
      assert.equal(manifests.length, 1);
      const backup = await verifyBackupManifestAtPath(admission, join(directory, manifests[0]));
      assert.equal(backup.manifest.schemaVersion, 42);
      assert.equal(backup.manifest.authorityContentFingerprint, original.authorityContentFingerprint);

      const reopened = open(admission);
      try {
        const reply = { id: randomUUID(), kind: "answer" as const, text: "Explanation", modelText: "Explanation" };
        assert.equal(typeof reopened.authority.assistantHistory.settle(conversationId, messageId, { delivery: "answered", reply }, now), "number");
      } finally { reopened.close(); }
    } finally { admission.release(); }
  } finally { await profile.close(); }
});
