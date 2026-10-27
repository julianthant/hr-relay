import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { it } from "vitest";
import { z } from "zod";
import { storageRecoveryFixture, storageTree } from "../../../support/helpers/integration/storage-recovery-fixture.js";
import { ProfileBrowserRootRefusalError } from "../../../../src/backend/storage/admission/admission.js";
import { readAppSettings } from "../../../../src/backend/storage/sqlite/settings-storage.js";
import { SQLITE_MIGRATIONS } from "../../../../src/backend/storage/sqlite/migrations.js";
import { SETTINGS_SCHEMA_HASH } from "../../../../src/models/config/settings.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";

const ValueSchema = z.union([z.string(), z.number(), z.null()]);
const TablesSchema = z.strictObject({ commands: z.array(z.record(z.string(), ValueSchema)), command_audits: z.array(z.record(z.string(), ValueSchema)),
  settings_snapshots: z.array(z.record(z.string(), ValueSchema)), settings: z.array(z.record(z.string(), ValueSchema)) });
const FixtureSchema = z.strictObject({ format: z.literal(1), sourceCommit: z.literal("4eee2b31ada2caf71053671ac6dda9936cec2b25"), schemaVersion: z.literal(7),
  settingsSchemaHash: z.string().regex(/^[a-f0-9]{64}$/u), settings: z.unknown(), command: z.unknown(), result: z.unknown(),
  migrationStatementsSha256: z.string(), sources: z.array(z.strictObject({ path: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/u) })), tables: TablesSchema, tablesSha256: z.string() });
const PRIOR_SOURCES = [
  {
    "path": "src/models/config/settings.ts",
    "sha256": "46c2f778b409a6d9579d48084decc22138ff6b24d74c47c5df19fb428183767c"
  },
  {
    "path": "src/models/config/schema.ts",
    "sha256": "16aec96bdf1bc1bcd902a046549349ea8c188542a06eae94218e82d442ce049b"
  },
  {
    "path": "src/models/config/catalog.ts",
    "sha256": "f40dbfff495629983a73144927de2a78593fe0134e87b7e306e4da3575c07548"
  },
  {
    "path": "src/models/config/settings-initialization.ts",
    "sha256": "e95134e5db730bcc5490ad4b1d9f6b80e8df0398fda61b3c627a03b8e31adead"
  },
  {
    "path": "src/models/config/settings-current.ts",
    "sha256": "dd9e1f9e1f8ec2c6416e50da486d192ee005d390ec1a5beeb3b44139df9af7d5"
  },
  {
    "path": "src/backend/storage/sqlite/settings-storage.ts",
    "sha256": "4d14e00eac5ce8c8e376d5c0e6065c9c91784f326709cb02222d1b71a8594917"
  },
  {
    "path": "src/backend/storage/sqlite/migrations.ts",
    "sha256": "771e1fe69d88dda64c65b7226acbc5c16eb2f08f03f27786568acba7a4535c22"
  },
  {
    "path": "src/backend/runs/commands/settings-service.ts",
    "sha256": "df0df30d90e8090bfdd6e0d5babaa1bb5e2542056dc501a4f623d4a920398fab"
  },
  {
    "path": "src/backend/runs/commands/command-kernel.ts",
    "sha256": "b52dccb7ece6fda80bce62d99abbccc3c20c14d654659f47413481bde21313e7"
  },
  {
    "path": "tests/support/helpers/admission-fixture.ts",
    "sha256": "ef82284a75b98dbaa1a138034bd54850c20e65ad9d1343219d823ffd861fc088"
  }
] as const;
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
it("upgrades actual populated prior Settings rows without rewriting their exact initialization, saved journal, audits or execution fingerprints", async () => {
  const bytes = readFileSync(new URL("../../../support/fixtures/assistant-populated-schema7.json", import.meta.url));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), "b4ac7dd698b79fcea542139add4c584891918ee1ca66f2d04cab4fbb9d25c423");
  const prior = FixtureSchema.parse(JSON.parse(bytes.toString("utf8")));
  assert.deepEqual(prior.sources, PRIOR_SOURCES);
  assert.equal(prior.settingsSchemaHash, SETTINGS_SCHEMA_HASH);
  assert.equal(prior.migrationStatementsSha256, sha(canonicalJsonStringify(SQLITE_MIGRATIONS.filter(migration => migration.version <= 7))));
  assert.equal(prior.tablesSha256, sha(canonicalJsonStringify(prior.tables)));
  assert.equal(prior.tables.settings.length, 1);
  assert.ok(prior.tables.commands.length >= 2);
  assert.ok(prior.tables.command_audits.length >= 2);
  assert.ok(prior.tables.settings_snapshots.length >= 1);
  const f = await storageRecoveryFixture(7);
  try {
    const raw = new DatabaseSync(f.path);
    try {
      raw.exec("PRAGMA foreign_keys=OFF; BEGIN");
      for (const [table, rows] of Object.entries(prior.tables)) for (const row of rows) {
        const columns = Object.keys(row); assert.ok(columns.every(column => /^[a-z_]+$/u.test(column)));
        raw.prepare(`INSERT INTO ${table}(${columns.join(",")}) VALUES(${columns.map(() => "?").join(",")})`).run(...Object.values(row));
      }
      raw.exec("COMMIT; PRAGMA foreign_keys=ON");
    } finally { raw.close(); }
    assert.equal((await f.run(true)).state, "planned");
    const result = await f.run(); assert.equal(result.state, "upgraded");
    assert.equal(result.fromSchemaVersion, 7); assert.equal(result.toSchemaVersion, 8);
    const upgraded = new DatabaseSync(f.path, { readOnly: true });
    try {
      const retained = Object.fromEntries(Object.keys(prior.tables).map(table => [table, upgraded.prepare(`SELECT * FROM ${table} ORDER BY id`).all().map(row => ({ ...row }))]));
      assert.deepEqual(retained, prior.tables); assert.equal(sha(canonicalJsonStringify(retained)), prior.tablesSha256);
      assert.equal(upgraded.prepare("SELECT COUNT(*) AS count FROM assistant_grants").get()?.count, 0);
      assert.equal(upgraded.prepare("SELECT COUNT(*) AS count FROM assistant_chats").get()?.count, 0);
      assert.equal(upgraded.prepare("SELECT COUNT(*) AS count FROM assistant_actions").get()?.count, 0);
    } finally { upgraded.close(); }
    const inspection = new DatabaseSync(f.path, { readOnly: true });
    try {
      const settings = readAppSettings(inspection);
      assert.ok(settings?.saved);
      assert.deepEqual({ revision: settings.saved.revision, settingsSchemaHash: SETTINGS_SCHEMA_HASH,
        settingsFingerprint: settings.saved.settingsFingerprint, settings: settings.saved.settings }, prior.settings);
      assert.equal(inspection.prepare("PRAGMA user_version").get()?.user_version, 8);
      assert.equal(inspection.prepare("SELECT COUNT(*) AS count FROM assistant_grants").get()?.count, 0);
    } finally { inspection.close(); }
    const beforeRuntime = storageTree(f.root);
    await assert.rejects(async () => await f.finish(), error => error instanceof ProfileBrowserRootRefusalError && error.code === "PROFILE_BROWSER_ROOT_REFUSED");
    assert.deepEqual(storageTree(f.root), beforeRuntime);
  } finally { await f.dispose(); }
});
