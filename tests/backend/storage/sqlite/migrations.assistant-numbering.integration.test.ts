import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { it } from "vitest";
import { AuthorityDatabase, AuthorityFormatUnsupportedError, AuthoritySchemaVersionError, inspectNativeAuthority } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { SQLITE_MIGRATIONS } from "../../../../src/backend/storage/sqlite/migrations.js";
import { ASSISTANT_HISTORY_MIGRATION } from "../../../../src/backend/storage/sqlite/assistant-history.js";
import { ASSISTANT_EFFORT_SCALE_MIGRATION } from "../../../../src/backend/storage/sqlite/assistant-effort-migration.js";
import { ASSISTANT_ATTACHMENTS_MIGRATION } from "../../../../src/backend/storage/sqlite/assistant-attachments.js";
import { ASSISTANT_GRANT_RETIREMENT_MIGRATION } from "../../../../src/backend/storage/sqlite/assistant-grant-retirement.js";
import { createBoundProfileFixture, boundProfileCredentials } from "../../../support/helpers/admission-fixture.js";
import { regressSchema27EffortScale, removeEmptySchema28Attachments, restoreSchema28AssistantGrants } from "../../../support/fixtures/storage/historical-run-schema.js";
import { systemClock } from "../../../../src/rules/time/clock.js";
import { storageRecoveryFixture, storageTree } from "../../../support/helpers/integration/storage-recovery-fixture.js";

const unsupported = (error: unknown) => error instanceof AuthorityFormatUnsupportedError
  && error.code === "STORAGE_PROFILE_FORMAT_UNSUPPORTED" && error.cause instanceof Error
  && error.cause.message === "assistant-unpublished-schema-numbering";

const ASSISTANT_MIGRATIONS = [ASSISTANT_HISTORY_MIGRATION, ASSISTANT_EFFORT_SCALE_MIGRATION, ASSISTANT_ATTACHMENTS_MIGRATION, ASSISTANT_GRANT_RETIREMENT_MIGRATION];

// Unpublished builds stacked the assistant migrations on schema 22 (history at 23) or on the claim index 23 (history at 24); neither has staging's 24 and 25.
const UNPUBLISHED = [[22, 1], [22, 2], [22, 3], [22, 4], [23, 1], [23, 2], [23, 3], [23, 4]] as const;

it.each(UNPUBLISHED)("refuses an unpublished numbering on schema %s with %s assistant migrations before backup or upgrade changes its source", async (base, steps) => {
  const f = await storageRecoveryFixture(7), version = base + steps;
  try {
    const database = new DatabaseSync(f.path);
    try {
      for (const migration of SQLITE_MIGRATIONS) if (migration.version > 7 && migration.version <= base) for (const statement of migration.statements) database.exec(statement);
      for (const migration of ASSISTANT_MIGRATIONS.slice(0, steps)) for (const statement of migration.statements) database.exec(statement);
      database.prepare("UPDATE database_states SET schema_version=?").run(version);
      database.exec(`PRAGMA user_version=${String(version)}`);
      assert.throws(() => inspectNativeAuthority(database, version), unsupported);
      database.exec("DROP TABLE run_search");
      assert.throws(() => inspectNativeAuthority(database, version, false, true), unsupported);
    } finally { database.close(); }
    const bytes = readFileSync(f.path), before = storageTree(f.root);
    for (const plan of [true, false]) await assert.rejects(f.run(plan), unsupported);
    await assert.rejects(f.backup(), unsupported);
    assert.deepEqual(readFileSync(f.path), bytes);
    assert.deepEqual(storageTree(f.root), before);
  } finally { await f.dispose(); }
});

it.each([23, 24, 25, 26, 27, 28])("upgrades canonical schema %s through the published numbering", async version => {
  const f = await storageRecoveryFixture(7);
  try {
    const database = new DatabaseSync(f.path);
    try {
      for (const migration of SQLITE_MIGRATIONS) if (migration.version > 7 && migration.version <= version) {
        for (const statement of migration.statements) database.exec(statement);
      }
      database.prepare("UPDATE database_states SET schema_version=?").run(version);
      database.exec(`PRAGMA user_version=${String(version)}`);
      assert.equal(inspectNativeAuthority(database, version).schemaVersion, version);
    } finally { database.close(); }
    assert.equal((await f.run()).state, "upgraded");
  } finally { await f.dispose(); }
});

it.each([24, 25, 26, 27, 28])("ordinary open refuses unpublished assistant schema %s with its named code and unchanged bytes", async version => {
  const f = await createBoundProfileFixture();
  const credentials = boundProfileCredentials(f.admission);
  const options = { path: f.path, busyTimeoutMs: 250, migrationOwner: "assistant-numbering-fixture" };
  const open = () => AuthorityDatabase.open(f.admission, options, systemClock, undefined, undefined, undefined, credentials);
  try {
    open().close();
    const native = new DatabaseSync(f.path);
    try {
      if (version === 28) restoreSchema28AssistantGrants(native);
      else if (version === 27) removeEmptySchema28Attachments(native);
      else regressSchema27EffortScale(native);
      // History below 26, or 26 to 28 without staging's workbook selections.
      if (version >= 26) native.exec("DROP TABLE workflow_workbook_selections");
      else native.exec(`UPDATE database_states SET schema_version=${String(version)}; PRAGMA user_version=${String(version)}`);
    } finally { native.close(); }
    const before = storageTree(f.stateRoot);
    assert.throws(open, unsupported);
    assert.deepEqual(storageTree(f.stateRoot), before);
  } finally { await f.close(); }
});

it("ordinary open still requires the current schema for a canonical predecessor", async () => {
  const f = await createBoundProfileFixture();
  const credentials = boundProfileCredentials(f.admission);
  const options = { path: f.path, busyTimeoutMs: 250, migrationOwner: "assistant-numbering-current-only" };
  const open = () => AuthorityDatabase.open(f.admission, options, systemClock, undefined, undefined, undefined, credentials);
  try {
    open().close();
    const native = new DatabaseSync(f.path);
    try { restoreSchema28AssistantGrants(native); } finally { native.close(); }
    const before = storageTree(f.stateRoot);
    assert.throws(open, error => error instanceof AuthoritySchemaVersionError && error.schemaVersion === 28);
    assert.deepEqual(storageTree(f.stateRoot), before);
  } finally { await f.close(); }
});
