import assert from "node:assert/strict";
import { mkdtempSync,realpathSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach,describe,it } from "vitest";
import { PROTECTED_SETTINGS_SCHEMA_HASH } from "../../../src/models/config/protected-settings.js";
import {
markSettingsCommand
} from "../../../src/rules/commands/commands.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../../src/rules/identity/ids.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import {
CONFIG_SNAPSHOT,
NOW,
UUID_5,
UUID_6,
UUID_7,
UUID_8
} from "../../support/fixtures/phase1c-contract-fixtures.js";
import { AuthorityDatabase } from "../../support/helpers/synthetic-storage-admission.js";

const roots: string[] = [];
const openDatabases: AuthorityDatabase[] = [];
const databasePaths = new WeakMap<AuthorityDatabase, string>();
const CLOCK = manualClock(new Date(NOW));

function databasePath(name = "authority.sqlite"): string {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "hrauto-rebuild-sqlite-"));
  roots.push(root);
  return join(root, name);
}

function openDatabase(path = databasePath(), busyTimeoutMs = 250): AuthorityDatabase {
  const database = AuthorityDatabase.open({ path, busyTimeoutMs, migrationOwner: "unit-test" }, CLOCK);
  openDatabases.push(database);
  databasePaths.set(database, path);
  return database;
}

afterEach(() => {
  for (const database of openDatabases.splice(0)) database.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("authority persistence invariants", () => {

  it("finds a protected write-id owner after restart while excluding the replaying command", () => {
    const path = databasePath("protected-write-id.sqlite");
    const ownerCommandId = UUID_6;
    const writeId = UUID_7;
    const first = openDatabase(path);
    first.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
    first.authority.commands.insert(markSettingsCommand({
      commandId: ownerCommandId,
      requestedAt: NOW,
      requestedBy: LOCAL_OPERATOR_ACTOR_ID,
      source: "settings-surface",
      family: "settings",
      type: "apply-protected-settings",
      target: { expectedRevision: 1 },
      payload: {
        protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH,
        writeId,
        entries: { ucpathPassword: { set: "synthetic-protected-value" } },
      },
    }));
    first.close();

    const reopened = openDatabase(path);
    const lookup: unknown = Reflect.get(
      reopened.authority.commands,
      "findProtectedSettingsCommandIdByWriteId",
    );
    assert.equal(typeof lookup, "function");
    const findOwner = lookup as (input: unknown) => string | undefined;
    assert.equal(findOwner({ writeId, excludingCommandId: ownerCommandId }), undefined);
    assert.equal(findOwner({ writeId, excludingCommandId: UUID_8 }), ownerCommandId);
    assert.equal(findOwner({ writeId: UUID_5, excludingCommandId: UUID_8 }), undefined);
  });
});
