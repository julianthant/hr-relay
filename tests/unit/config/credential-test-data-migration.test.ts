/**
 * D341 P6/P7 — converting the pre-D341 credential document (schemaVersion 1,
 * seven names) into the schemaVersion-2 document plus the private test-data
 * file. Every document here is synthetic and built by the same replay rules
 * the frozen legacy reader applies; nothing touches a real `.tracker`.
 */
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { canonicalJsonStringify } from "../../../src/domain/canonical-json.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH, ProtectedSettingsApplyInputSchema } from "../../../src/domain/config/protected-settings.js";
import {
  LEGACY_PROTECTED_SETTINGS_SCHEMA_HASH,
  LegacyProtectedSettingsApplyInputSchema,
  LegacyProtectedStoreRecordSchema,
  RETIRED_TEST_TARGET_PROTECTED_NAMES,
  type LegacyProtectedSettingsApplyInput,
} from "../../../src/domain/config/protected-settings-legacy.js";
import { readTestDataLocalConfig, testDataLocalPath } from "../../../src/control/test-data.js";
import {
  CredentialStoreMigrationRequiredError,
  createCredentialStore,
  type CredentialUpgradeStore,
} from "../../../src/infra/config/credential-store.js";
import { migrateTestDataFromCredentials } from "../../../src/infra/config/credential-test-data-migration.js";
import { observeProcessIdentity } from "../../../src/infra/sqlite/runtime-process-locks.js";

const COMMAND_1 = "11111111-1111-4111-8111-111111111111";
const COMMAND_2 = "22222222-2222-4222-8222-222222222222";
const COMMAND_NEW = "33333333-3333-4333-8333-333333333333";
const WRITE_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WRITE_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const WRITE_NEW = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const VALUE_DOC = "d0000000-0000-4000-8000-000000000001";
const VALUE_EID = "d0000000-0000-4000-8000-000000000002";
const VALUE_PASSWORD = "d0000000-0000-4000-8000-000000000003";
const VALUE_EID_2 = "d0000000-0000-4000-8000-000000000004";
const VALUE_TIMEKEEPER = "d0000000-0000-4000-8000-000000000005";
const MIGRATION_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const FRESH_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const NOW_1 = "2026-09-06T12:00:00.000Z";
const NOW_2 = "2026-09-06T12:01:00.000Z";
const MIGRATED_AT = "2026-09-07T09:00:00.000Z";
const SYNTHETIC_DOCUMENT = "4000001";
const SYNTHETIC_EID = "10000001";
const SYNTHETIC_EID_2 = "10000002";
const SYNTHETIC_PASSWORD = "synthetic-legacy-private-password";
const SYNTHETIC_TIMEKEEPER = "Synthetic Timekeeper";
const UPGRADE_ID = "9".repeat(64);

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

interface LegacyHistoryEntry { request: LegacyProtectedSettingsApplyInput; setValueIds: Record<string, string> }

function legacyRequest(input: { commandId: string; writeId: string; expectedRevision: number; entries: Record<string, unknown>; updatedAt?: string }): LegacyProtectedSettingsApplyInput {
  return LegacyProtectedSettingsApplyInputSchema.parse({
    commandId: input.commandId,
    commandFingerprint: input.commandId.replace(/-/gu, "").padEnd(64, "0"),
    expectedRevision: input.expectedRevision,
    protectedSchemaHash: LEGACY_PROTECTED_SETTINGS_SCHEMA_HASH,
    writeId: input.writeId,
    entries: input.entries,
    updatedAt: input.updatedAt ?? NOW_1,
  });
}

/** Replays a synthetic history exactly as the frozen legacy reader does. */
function legacyDocument(history: readonly LegacyHistoryEntry[], upgradeBinding?: { upgradeId: string; entries: Record<string, unknown> }) {
  let record: Record<string, unknown> = { schemaVersion: 1, revision: 1, protectedSchemaHash: LEGACY_PROTECTED_SETTINGS_SCHEMA_HASH, entries: {} };
  for (const { request, setValueIds } of history) {
    const entries = { ...(record.entries as Record<string, unknown>) };
    for (const [name, operation] of Object.entries(request.entries)) {
      if (operation === undefined) continue;
      if ("clear" in operation) { delete entries[name]; continue; }
      entries[name] = { valueId: setValueIds[name], value: operation.set, updatedAt: request.updatedAt };
    }
    record = {
      schemaVersion: 1,
      revision: (record.revision as number) + 1,
      protectedSchemaHash: LEGACY_PROTECTED_SETTINGS_SCHEMA_HASH,
      entries,
      lastApplied: { commandId: request.commandId, commandFingerprint: request.commandFingerprint, expectedRevision: request.expectedRevision, protectedSchemaHash: request.protectedSchemaHash, writeId: request.writeId },
    };
  }
  return { schemaVersion: 1, record: LegacyProtectedStoreRecordSchema.parse(record), history, ...(upgradeBinding === undefined ? {} : { upgradeBinding }) };
}

const CANARY_HISTORY: LegacyHistoryEntry[] = [{
  request: legacyRequest({ commandId: COMMAND_1, writeId: WRITE_1, expectedRevision: 1, entries: {
    ucpathPassword: { set: SYNTHETIC_PASSWORD },
    separationsKualiFinalizationCanaryDocumentNumber: { set: SYNTHETIC_DOCUMENT },
    personLookupCanaryEid: { set: SYNTHETIC_EID },
  } }),
  setValueIds: { ucpathPassword: VALUE_PASSWORD, separationsKualiFinalizationCanaryDocumentNumber: VALUE_DOC, personLookupCanaryEid: VALUE_EID },
}];

function fixture(document?: unknown) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "hr-credential-migration-"));
  roots.push(root);
  const tracker = join(root, ".tracker");
  mkdirSync(tracker, { mode: 0o700 });
  mkdirSync(join(root, "config"), { mode: 0o755 });
  const directory = join(tracker, "credentials");
  const path = join(directory, "protected.json");
  if (document !== undefined) {
    mkdirSync(directory, { mode: 0o700 });
    writeFileSync(path, `${canonicalJsonStringify(document)}\n`, { mode: 0o600 });
    chmodSync(path, 0o600);
  }
  const localPath = testDataLocalPath(root);
  const sourceBytes = () => existsSync(path) ? readFileSync(path, "utf8") : undefined;
  const sourceJson = () => JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown> & { record: { revision: number; entries: Record<string, { valueId: string; value: unknown }> }; baseline?: Record<string, unknown> & { retired: Record<string, unknown> & { entries: unknown[] } } };
  const store = () => createCredentialStore({ stateRoot: tracker });
  const migrate = (mode: "plan" | "apply", overrides: Partial<Parameters<typeof migrateTestDataFromCredentials>[0]> = {}) =>
    migrateTestDataFromCredentials({ stateRoot: tracker, localPath, mode, now: () => new Date(MIGRATED_AT), ids: { randomUUID: () => MIGRATION_ID }, ...overrides });
  return { root, tracker, directory, path, localPath, sourceBytes, sourceJson, store, migrate,
    lockPath: join(directory, ".protected.lock") };
}

function noValueLeaks(report: unknown): void {
  const text = JSON.stringify(report);
  for (const value of [SYNTHETIC_DOCUMENT, SYNTHETIC_EID, SYNTHETIC_EID_2, SYNTHETIC_PASSWORD, SYNTHETIC_TIMEKEEPER]) {
    assert.equal(text.includes(value), false, `report leaked ${value}`);
  }
}

describe("D341 credential → test-data migration", () => {
  it("pins the frozen legacy schema hash and keeps the live hash distinct", () => {
    assert.equal(LEGACY_PROTECTED_SETTINGS_SCHEMA_HASH, "2de4abeb58bd98da2aa2154fa3488e80895b046a406fccdd744924a08ceaf477");
    assert.notEqual(PROTECTED_SETTINGS_SCHEMA_HASH, LEGACY_PROTECTED_SETTINGS_SCHEMA_HASH);
    assert.deepEqual([...RETIRED_TEST_TARGET_PROTECTED_NAMES], ["separationsKualiFinalizationCanaryDocumentNumber", "personLookupCanaryEid"]);
  });

  it("reports nothing to migrate for an absent store and writes nothing", async () => {
    const f = fixture();
    for (const mode of ["plan", "apply"] as const) {
      const report = await f.migrate(mode);
      assert.equal(report.status, "nothing-to-migrate");
      assert.deepEqual(report.source, { path: "credentials/protected.json", state: "absent", retiredEntries: [] });
      assert.equal(report.destination.state, "absent");
    }
    assert.equal(existsSync(f.directory), false);
    assert.equal(existsSync(f.localPath), false);
  });

  it("refuses an ordinary read of the legacy document until it is migrated", () => {
    const f = fixture(legacyDocument(CANARY_HISTORY));
    assert.throws(() => f.store().read(), (error: unknown) => error instanceof CredentialStoreMigrationRequiredError
      && /run cli test-data migrate --from-credentials/u.test(error.message));
    assert.throws(() => f.store().apply(ProtectedSettingsApplyInputSchema.parse({
      commandId: COMMAND_NEW, commandFingerprint: "3".repeat(64), expectedRevision: 3, protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH,
      writeId: WRITE_NEW, entries: { timekeeperName: { set: SYNTHETIC_TIMEKEEPER } }, updatedAt: NOW_2,
    })), CredentialStoreMigrationRequiredError);
    // The migration-only inspection classifies without exposing a value to the report layer.
    const inspection = f.store().inspectTestDataMigration();
    assert.equal(inspection.state, "legacy");
    if (inspection.state !== "legacy") throw new Error("expected legacy");
    assert.equal(inspection.revision, 2);
    assert.equal(inspection.historyLength, 1);
    assert.deepEqual(inspection.retiredEntries.map(({ name, valueId }) => ({ name, valueId })), [
      { name: "separationsKualiFinalizationCanaryDocumentNumber", valueId: VALUE_DOC },
      { name: "personLookupCanaryEid", valueId: VALUE_EID },
    ]);
  });

  it("converts an empty revision-1 legacy document without a baseline or a private file", async () => {
    const f = fixture(legacyDocument([]));
    const plan = await f.migrate("plan");
    assert.equal(plan.status, "planned");
    assert.deepEqual(plan.destination, { path: "config/test-data.local.json", state: "absent", action: "none", inputs: [] });
    const applied = await f.migrate("apply");
    assert.equal(applied.status, "converted");
    assert.equal(applied.source.revision, 1);
    assert.equal(existsSync(f.localPath), false, "no retired entry, no private file");
    const converted = f.sourceJson();
    assert.equal(converted.schemaVersion, 2);
    assert.equal(converted.baseline, undefined);
    assert.equal(f.store().read().revision, 1);
    assert.deepEqual(f.store().read().entries, {});
  });

  it("plans without writing, then converts: destination first, then a value-free baseline that retires the old identities", async () => {
    const f = fixture(legacyDocument(CANARY_HISTORY));
    const legacyBytes = f.sourceBytes();

    const plan = await f.migrate("plan");
    noValueLeaks(plan);
    assert.equal(plan.status, "planned");
    assert.deepEqual(plan.source, { path: "credentials/protected.json", state: "legacy", revision: 2, historyLength: 1,
      retiredEntries: ["separationsKualiFinalizationCanaryDocumentNumber", "personLookupCanaryEid"] });
    assert.deepEqual(plan.destination, { path: "config/test-data.local.json", state: "absent", action: "create", inputs: [
      { name: "separationsKualiFinalizationCanaryDocumentNumber", disposition: "create" },
      { name: "personLookupCanaryEid", disposition: "create" },
    ] });
    assert.equal(f.sourceBytes(), legacyBytes, "plan never rewrites the source");
    assert.equal(existsSync(f.localPath), false, "plan never writes the destination");

    const applied = await f.migrate("apply");
    noValueLeaks(applied);
    assert.equal(applied.status, "converted");
    assert.equal(applied.source.state, "current");
    assert.equal(applied.source.revision, 3);
    assert.equal(applied.destination.action, "create");

    // Destination: the two retired entries with their EXACT identities and values, private to the owner.
    const local = readTestDataLocalConfig(f.localPath);
    assert.equal(local.state, "valid");
    if (local.state !== "valid") throw new Error("expected the private file");
    assert.deepEqual(local.config, { schemaVersion: 1, files: {}, inputs: {
      separationsKualiFinalizationCanaryDocumentNumber: { valueId: VALUE_DOC, value: SYNTHETIC_DOCUMENT, updatedAt: NOW_1 },
      personLookupCanaryEid: { valueId: VALUE_EID, value: SYNTHETIC_EID, updatedAt: NOW_1 },
    } });
    assert.deepEqual(readdirSync(join(f.root, "config")), ["test-data.local.json"], "no staging residue");

    // Source: schemaVersion 2, the live entry unchanged in identity and value, the canaries gone.
    const converted = f.sourceJson();
    assert.equal(converted.schemaVersion, 2);
    assert.equal(converted.record.revision, 3);
    assert.deepEqual(Object.keys(converted.record.entries), ["ucpathPassword"]);
    assert.deepEqual(converted.record.entries.ucpathPassword, { valueId: VALUE_PASSWORD, value: SYNTHETIC_PASSWORD, updatedAt: NOW_1 });
    assert.deepEqual(converted.history, []);
    const baseline = converted.baseline;
    if (baseline === undefined) throw new Error("expected a baseline");
    assert.equal(baseline.migrationId, MIGRATION_ID);
    assert.equal(baseline.migratedAt, MIGRATED_AT);
    assert.deepEqual(baseline.source, { schemaVersion: 1, protectedSchemaHash: LEGACY_PROTECTED_SETTINGS_SCHEMA_HASH, revision: 2, historyLength: 1 });
    assert.deepEqual(baseline.retired, { commandIds: [COMMAND_1], writeIds: [WRITE_1], valueIds: [VALUE_PASSWORD, VALUE_DOC, VALUE_EID],
      entries: [
        { name: "separationsKualiFinalizationCanaryDocumentNumber", valueId: VALUE_DOC },
        { name: "personLookupCanaryEid", valueId: VALUE_EID },
      ] });
    const baselineText = JSON.stringify(baseline.retired) + JSON.stringify(baseline.source);
    for (const value of [SYNTHETIC_DOCUMENT, SYNTHETIC_EID, SYNTHETIC_PASSWORD]) assert.equal(baselineText.includes(value), false, "baseline identities are value-free");
    // The old fingerprint family is recorded as it was; the new record binds the live hash.
    const baselineRecord = baseline.record as { protectedSchemaHash: string; lastApplied: { commandId: string; protectedSchemaHash: string; expectedRevision: number } };
    assert.equal(baselineRecord.protectedSchemaHash, PROTECTED_SETTINGS_SCHEMA_HASH);
    assert.equal(baselineRecord.lastApplied.commandId, MIGRATION_ID);
    assert.equal(baselineRecord.lastApplied.expectedRevision, 2);

    // The ordinary store reads the converted document and owns every retired identity.
    const store = f.store();
    const record = store.read();
    assert.equal(record.revision, 3);
    assert.equal(record.entries.ucpathPassword?.valueId, VALUE_PASSWORD);
    assert.equal(store.ownsCommandId(COMMAND_1), true);
    assert.equal(store.ownsCommandId(MIGRATION_ID), true);
    assert.equal(store.ownsCommandId(COMMAND_NEW), false);
  });

  it("fences retired command, write and value identities against every later request", async () => {
    const f = fixture(legacyDocument(CANARY_HISTORY));
    assert.equal((await f.migrate("apply")).status, "converted");
    const request = (commandId: string, writeId: string) => ProtectedSettingsApplyInputSchema.parse({
      commandId, commandFingerprint: "4".repeat(64), expectedRevision: 3, protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH,
      writeId, entries: { timekeeperName: { set: SYNTHETIC_TIMEKEEPER } }, updatedAt: NOW_2,
    });
    const reusedCommand = f.store().apply(request(COMMAND_1, WRITE_NEW));
    assert.equal(reusedCommand.state, "rejected");
    const reusedWrite = f.store().apply(request(COMMAND_NEW, WRITE_1));
    assert.equal(reusedWrite.state, "rejected");
    const reusedMigration = f.store().apply(request(MIGRATION_ID, WRITE_NEW));
    assert.equal(reusedMigration.state, "rejected");
    // A generator that hands back a retired value identity is a collision, never a reuse.
    const colliding = createCredentialStore({ stateRoot: f.tracker, ids: { randomUUID: () => VALUE_EID } });
    assert.throws(() => colliding.apply(request(COMMAND_NEW, WRITE_NEW)), /credential value identity generation collided/u);
    assert.equal(f.store().read().revision, 3, "nothing was applied");
    // A fresh identity applies, and the baseline survives the write.
    const fresh = createCredentialStore({ stateRoot: f.tracker, ids: { randomUUID: () => FRESH_ID } });
    const applied = fresh.apply(request(COMMAND_NEW, WRITE_NEW));
    assert.equal(applied.state, "applied");
    assert.equal(f.store().read().revision, 4);
    assert.equal(f.store().read().entries.timekeeperName?.valueId, FRESH_ID);
    assert.equal(f.sourceJson().baseline?.migrationId, MIGRATION_ID);
    assert.equal(f.store().ownsCommandId(COMMAND_1), true);
  });

  it("is idempotent after conversion and refuses when the destination lost a retired entry", async () => {
    const f = fixture(legacyDocument(CANARY_HISTORY));
    assert.equal((await f.migrate("apply")).status, "converted");
    const convertedBytes = f.sourceBytes();
    const localBytes = readFileSync(f.localPath, "utf8");
    for (const mode of ["plan", "apply"] as const) {
      const again = await f.migrate(mode);
      noValueLeaks(again);
      assert.equal(again.status, "already-converted");
      assert.equal(again.source.state, "current");
      assert.deepEqual(again.destination.inputs, [
        { name: "separationsKualiFinalizationCanaryDocumentNumber", disposition: "equal" },
        { name: "personLookupCanaryEid", disposition: "equal" },
      ]);
    }
    assert.equal(f.sourceBytes(), convertedBytes);
    assert.equal(readFileSync(f.localPath, "utf8"), localBytes);
    // The private file no longer carries one retired entry: refused, and nothing is reconstructed from the source.
    writeFileSync(f.localPath, `${JSON.stringify({ schemaVersion: 1, inputs: {
      personLookupCanaryEid: { valueId: VALUE_EID, value: SYNTHETIC_EID, updatedAt: NOW_1 },
    }, files: {} })}\n`, { mode: 0o600 });
    const refused = await f.migrate("apply");
    assert.equal(refused.status, "refused");
    assert.match(refused.reason ?? "", /no longer carries separationsKualiFinalizationCanaryDocumentNumber/u);
    assert.deepEqual(refused.destination.inputs, [{ name: "separationsKualiFinalizationCanaryDocumentNumber", disposition: "missing" }]);
    assert.equal(f.sourceBytes(), convertedBytes);
  });

  it("stops on a conflicting or invalid destination without touching either file", async () => {
    const conflicting = fixture(legacyDocument(CANARY_HISTORY));
    const conflict = `${JSON.stringify({ schemaVersion: 1, inputs: {
      personLookupCanaryEid: { valueId: VALUE_EID, value: SYNTHETIC_EID_2, updatedAt: NOW_1 },
    }, files: {} })}\n`;
    writeFileSync(conflicting.localPath, conflict, { mode: 0o600 });
    const legacyBytes = conflicting.sourceBytes();
    for (const mode of ["plan", "apply"] as const) {
      const report = await conflicting.migrate(mode);
      noValueLeaks(report);
      assert.equal(report.status, "refused");
      assert.match(report.reason ?? "", /already carries a different entry for personLookupCanaryEid; reconcile by name/u);
      assert.deepEqual(report.destination.inputs, [
        { name: "separationsKualiFinalizationCanaryDocumentNumber", disposition: "add" },
        { name: "personLookupCanaryEid", disposition: "conflict" },
      ]);
    }
    assert.equal(conflicting.sourceBytes(), legacyBytes);
    assert.equal(readFileSync(conflicting.localPath, "utf8"), conflict);
    assert.throws(() => conflicting.store().read(), CredentialStoreMigrationRequiredError, "the source is still legacy");

    const invalid = fixture(legacyDocument(CANARY_HISTORY));
    writeFileSync(invalid.localPath, "{}\n", { mode: 0o644 });
    chmodSync(invalid.localPath, 0o644);
    const report = await invalid.migrate("apply");
    assert.equal(report.status, "refused");
    assert.match(report.reason ?? "", /is not a valid private file and will not be overwritten/u);
    assert.equal(readFileSync(invalid.localPath, "utf8"), "{}\n");
    assert.throws(() => invalid.store().read(), CredentialStoreMigrationRequiredError);
  });

  it("refuses while a pending upgrade binding still names a retired entry", async () => {
    const f = fixture(legacyDocument([], { upgradeId: UPGRADE_ID, entries: {
      ucpathUserId: { set: "synthetic-user" }, personLookupCanaryEid: { set: SYNTHETIC_EID },
    } }));
    const legacyBytes = f.sourceBytes();
    for (const mode of ["plan", "apply"] as const) {
      const report = await f.migrate(mode);
      noValueLeaks(report);
      assert.equal(report.status, "refused");
      assert.match(report.reason ?? "", /pending upgrade binding names retired test-target entries personLookupCanaryEid/u);
    }
    assert.equal(f.sourceBytes(), legacyBytes);
    assert.equal(existsSync(f.localPath), false);
  });

  it("converts a multi-entry history with an applied upgrade binding, retiring every historical identity", async () => {
    const history: LegacyHistoryEntry[] = [
      {
        request: legacyRequest({ commandId: COMMAND_1, writeId: WRITE_1, expectedRevision: 1, entries: {
          ucpathUserId: { set: "synthetic-user" }, personLookupCanaryEid: { set: SYNTHETIC_EID },
        } }),
        setValueIds: { ucpathUserId: VALUE_PASSWORD, personLookupCanaryEid: VALUE_EID },
      },
      {
        request: legacyRequest({ commandId: COMMAND_2, writeId: WRITE_2, expectedRevision: 2, updatedAt: NOW_2, entries: {
          personLookupCanaryEid: { set: SYNTHETIC_EID_2 }, timekeeperName: { set: SYNTHETIC_TIMEKEEPER }, ucpathUserId: { clear: true },
        } }),
        setValueIds: { personLookupCanaryEid: VALUE_EID_2, timekeeperName: VALUE_TIMEKEEPER },
      },
    ];
    const f = fixture(legacyDocument(history, { upgradeId: UPGRADE_ID, entries: { ucpathUserId: { set: "synthetic-user" }, personLookupCanaryEid: { set: SYNTHETIC_EID } } }));
    const report = await f.migrate("apply");
    noValueLeaks(report);
    assert.equal(report.status, "converted");
    assert.equal(report.source.revision, 4);
    assert.deepEqual(report.destination.inputs, [{ name: "personLookupCanaryEid", disposition: "create" }]);

    const local = readTestDataLocalConfig(f.localPath);
    if (local.state !== "valid") throw new Error("expected the private file");
    // The CURRENT rotated value moves; the superseded one stays retired, never resurrected.
    assert.deepEqual(local.config.inputs, { personLookupCanaryEid: { valueId: VALUE_EID_2, value: SYNTHETIC_EID_2, updatedAt: NOW_2 } });

    const converted = f.sourceJson();
    assert.deepEqual(Object.keys(converted.record.entries), ["timekeeperName"]);
    assert.equal(converted.upgradeBinding, undefined, "the applied legacy binding is retired into the baseline");
    const retired = converted.baseline?.retired as { commandIds: string[]; writeIds: string[]; valueIds: string[]; entries: unknown[]; upgradeBinding?: { upgradeId: string; entryNames: string[] } };
    assert.deepEqual(retired.commandIds, [COMMAND_1, COMMAND_2]);
    assert.deepEqual(retired.writeIds, [WRITE_1, WRITE_2]);
    assert.deepEqual([...retired.valueIds].sort(), [VALUE_PASSWORD, VALUE_EID, VALUE_EID_2, VALUE_TIMEKEEPER].sort(), "every historical value identity is fenced");
    assert.deepEqual(retired.entries, [{ name: "personLookupCanaryEid", valueId: VALUE_EID_2 }]);
    assert.deepEqual(retired.upgradeBinding, { upgradeId: UPGRADE_ID, entryNames: ["ucpathUserId", "personLookupCanaryEid"] });
    const store = f.store();
    assert.equal(store.read().revision, 4);
    assert.equal(store.read().entries.timekeeperName?.valueId, VALUE_TIMEKEEPER);
    assert.equal(store.ownsCommandId(COMMAND_2), true);
  });

  it("leaves the source untouched when staging fails, then completes idempotently on the next run", async () => {
    const f = fixture(legacyDocument(CANARY_HISTORY));
    const legacyBytes = f.sourceBytes();
    const real = f.store();
    // Failure AFTER the destination is durable but BEFORE the source is rewritten.
    const failing: CredentialUpgradeStore = Object.freeze({
      ...real,
      convertTestDataMigration: (input: Parameters<CredentialUpgradeStore["convertTestDataMigration"]>[0]) => {
        const inspection = real.inspectTestDataMigration();
        if (inspection.state !== "legacy") throw new Error("fixture expected a legacy source");
        input.stageDestination(inspection.retiredEntries);
        throw new Error("synthetic crash after staging");
      },
    });
    await assert.rejects(f.migrate("apply", { store: failing }), /synthetic crash after staging/u);
    assert.equal(f.sourceBytes(), legacyBytes, "the source is still the legacy document");
    assert.equal(readTestDataLocalConfig(f.localPath).state, "valid", "the destination is durable");
    const retry = await f.migrate("apply");
    assert.equal(retry.status, "converted");
    assert.deepEqual(retry.destination.inputs, [
      { name: "separationsKualiFinalizationCanaryDocumentNumber", disposition: "equal" },
      { name: "personLookupCanaryEid", disposition: "equal" },
    ]);
    assert.equal(f.store().read().revision, 3);

    // A source that changed between the plan and the lock is refused under the lock, not partially converted.
    const changed = fixture(legacyDocument(CANARY_HISTORY));
    const changedBytes = changed.sourceBytes();
    const changedReal = changed.store();
    const drifting: CredentialUpgradeStore = Object.freeze({
      ...changedReal,
      convertTestDataMigration: (input: Parameters<CredentialUpgradeStore["convertTestDataMigration"]>[0]) => {
        const inspection = changedReal.inspectTestDataMigration();
        if (inspection.state !== "legacy") throw new Error("fixture expected a legacy source");
        input.stageDestination(inspection.retiredEntries.map((entry, index) => ({ ...entry, valueId: index === 0 ? FRESH_ID : entry.valueId })));
        throw new Error("the source must not be rewritten after a staging refusal");
      },
    });
    const refused = await changed.migrate("apply", { store: drifting });
    assert.equal(refused.status, "refused");
    assert.match(refused.reason ?? "", /changed while the migration was planned/u);
    assert.equal(changed.sourceBytes(), changedBytes);
    assert.equal(existsSync(changed.localPath), false);
  });

  it("refuses while another writer holds the credential lock and never touches the destination", async () => {
    const f = fixture(legacyDocument(CANARY_HISTORY));
    const observation = observeProcessIdentity(process.pid);
    if (observation.state !== "alive") throw new Error("test process identity is unavailable");
    writeFileSync(f.lockPath, `${JSON.stringify({ schemaVersion: 1, kind: "writer", pid: process.pid, processIdentity: observation.identity,
      acquisitionId: "abababab-abab-4bab-8bab-abababababab" })}\n`, { mode: 0o600, flag: "wx" });
    const legacyBytes = f.sourceBytes();
    const report = await f.migrate("apply");
    assert.equal(report.status, "refused");
    assert.match(report.reason ?? "", /credential store lock is unavailable/u);
    assert.equal(f.sourceBytes(), legacyBytes);
    assert.equal(existsSync(f.localPath), false);
  });
});
