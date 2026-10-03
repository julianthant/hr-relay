import assert from "node:assert/strict";
import { it } from "vitest";
import { z } from "zod";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { executeSettingsCommand, type CommandAuthority } from "../../../../src/backend/runs/commands/command-kernel.js";
import { createSettingsApplicationExecutor } from "../../../../src/backend/runs/commands/settings-service.js";
import { readSettings } from "../../../../src/backend/runtime/settings/settings-runtime.js";
import type { AuthorityRepositories } from "../../../../src/backend/storage/sqlite/authority-database.js";
import type { CredentialStore } from "../../../../src/models/config/credential-store.js";
import type { createProviderKeyStore } from "../../../../src/backend/storage/configuration/provider-key-store.js";
import { SETTINGS_SCHEMA_HASH, deriveSettingsPatchFingerprint, initialSettingsFileRecord } from "../../../../src/models/config/settings.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH, ProtectedSettingsApplyInputSchema, ProtectedStoreRecordSchema,
  type ProtectedStoreRecord } from "../../../../src/models/config/protected-settings.js";
import { PROVIDER_KEYS_SCHEMA_HASH } from "../../../../src/models/config/provider-keys.js";
import { CommandAuditRecordSchema, CommandRequestSchema, type CommandRequest } from "../../../../src/rules/commands/commands.js";
import { SettingsCurrentRecordSchema } from "../../../../src/models/config/settings-current.js";
import { ConfigSnapshotRecordSchema } from "../../../../src/models/config/snapshot.js";
import { ActiveRuntimeConfigActivationSchema, ActiveRuntimeConfigRecordSchema } from "../../../../src/models/config/runtime-generation.js";

const NOW = "2026-10-02T12:00:00.000Z";
const TOKEN = "a".repeat(64);
const IDS = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333", "44444444-4444-4444-8444-444444444444"];
type State = { commands: Map<string, CommandRequest>; audits: Map<string, z.infer<typeof CommandAuditRecordSchema>>;
  current?: z.infer<typeof SettingsCurrentRecordSchema>; active?: z.infer<typeof ActiveRuntimeConfigRecordSchema>;
  snapshots: Map<string, z.infer<typeof ConfigSnapshotRecordSchema>> };

function fixture(failAt?: "audit" | "insert") {
  let durable: State = { commands: new Map(), audits: new Map(), snapshots: new Map() };
  let privateCommits = 0;
  let providerCommits = 0;
  let privateRecord: ProtectedStoreRecord | undefined;
  let nextId = 1;
  const clock = manualClock(new Date(NOW));
  const authority: CommandAuthority = { withAuthorityTransaction: (work) => {
    const state: State = { commands: new Map(durable.commands), audits: new Map(durable.audits),
      snapshots: new Map(durable.snapshots), current: durable.current, active: durable.active };
    const repositories = {
      commands: {
        assertIdentity(input: unknown) { const command = CommandRequestSchema.parse(input);
          const existing = state.commands.get(command.commandId);
          if (existing !== undefined) assert.deepEqual(existing, command); },
        get: (id: string) => state.commands.get(id), getSettingsHistory: (id: string) => state.commands.get(id),
        insert(input: unknown) { if (failAt === "insert") throw new Error("injected journal failure");
          const command = CommandRequestSchema.parse(input); const existing = state.commands.get(command.commandId);
          if (existing !== undefined) return { state: "existing", record: existing };
          state.commands.set(command.commandId, command); return { state: "inserted", record: command }; },
      },
      commandAudits: {
        insert(input: unknown) { if (failAt === "audit") throw new Error("injected audit failure");
          const audit = CommandAuditRecordSchema.parse(input);
          state.audits.set(audit.request.commandId, audit); return { state: "inserted", record: audit }; },
        findByCommand: (id: string) => state.audits.get(id),
        findSettingsHistory: (id: string) => state.audits.get(id),
      },
      settingsCurrent: {
        get: () => state.current,
        hasHistory: () => [...state.commands.values()].some(command => command.family === "settings" && command.type === "apply-settings"),
        hasAuditHistory: () => [...state.audits.values()].some(audit => audit.request.type === "apply-settings"),
        advance(input: unknown) { state.current = SettingsCurrentRecordSchema.parse(input); return state.current; },
      },
      configSnapshots: { insert(input: unknown) { const snapshot = ConfigSnapshotRecordSchema.parse(input);
        state.snapshots.set(snapshot.configSnapshotId, snapshot); return { state: "inserted", record: snapshot }; } },
      runtimeConfig: {
        get: () => state.active, hasHistory: () => state.snapshots.size > 0,
        hasAdvancedHistory: () => [...state.snapshots.values()].some(snapshot => snapshot.revision > 1),
        requireActive: () => ({}), activate(input: unknown) { state.active = ActiveRuntimeConfigRecordSchema.parse({
          ...ActiveRuntimeConfigActivationSchema.parse(input), generation: (state.active?.generation ?? 0) + 1,
        }); return state.active; },
      },
    } as unknown as AuthorityRepositories;
    const result = work(repositories);
    durable = state;
    return result;
  } };
  const credentials = { apply: (input: unknown) => { privateCommits += 1;
    const applied = ProtectedSettingsApplyInputSchema.parse(input);
    privateRecord = ProtectedStoreRecordSchema.parse({ schemaVersion: 1, revision: applied.expectedRevision + 1,
      protectedSchemaHash: applied.protectedSchemaHash, entries: {}, lastApplied: {
        commandId: applied.commandId, commandFingerprint: applied.commandFingerprint, expectedRevision: applied.expectedRevision,
        protectedSchemaHash: applied.protectedSchemaHash, writeId: applied.writeId,
      } });
    return { state: "applied", record: privateRecord }; },
  verifyReplay: () => { if (privateRecord === undefined) throw new Error("missing private commit");
    return { state: "applied", record: privateRecord }; } } as unknown as CredentialStore;
  const providerStore = { apply: () => { providerCommits += 1;
    return { revision: 2, sourceVersionToken: TOKEN, receiptId: IDS[3], slots: {} }; } } as unknown as ReturnType<typeof createProviderKeyStore>;
  const settings = createSettingsApplicationExecutor(
    value => resolveConfigWithProvenance(value, { primaryDisplay: null }, clock), credentials,
    { store: providerStore, bootKnown: true, restartRequired: () => false });
  const execute = (command: unknown) => executeSettingsCommand({ authority, clock,
    ids: { uuid: () => IDS[nextId++ % IDS.length] }, settings }, command);
  const ordinary = (expectedRevision = 1, commandId = IDS[0]) => {
    const patch = { "concurrency.defaultWorkers": { set: 3 } };
    return { family: "settings", type: "apply-settings", commandId, requestedAt: NOW,
      requestedBy: "local-operator", source: "settings-surface", target: { expectedRevision },
      payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveSettingsPatchFingerprint(patch), patch } };
  };
  return { execute, ordinary, authority, durable: () => durable,
    privateCommits: () => privateCommits, providerCommits: () => providerCommits,
    loseCurrent: () => { durable.current = undefined; } };
}

it("applies the first ordinary save before its own journal row becomes history; stale and missing authority refuse", () => {
  const f = fixture();
  assert.deepEqual(readSettings(f.authority.withAuthorityTransaction(repositories => repositories)), initialSettingsFileRecord());
  const applied = f.execute(f.ordinary());
  assert.equal(applied.state, "applied");
  assert.equal(f.durable().commands.size, 1);
  assert.equal(f.durable().audits.size, 1);
  assert.equal(f.durable().snapshots.size, 1);
  assert.equal(f.durable().current?.revision, 2);
  assert.equal(f.durable().active?.settingsRevision, 2);
  assert.equal(f.authority.withAuthorityTransaction(readSettings).revision, 2);
  assert.equal(f.execute(f.ordinary()).state, "already-applied");
  assert.equal(f.durable().commands.size, 1);
  assert.equal(f.execute(f.ordinary(1, IDS[2])).state, "conflict");
  assert.equal(f.durable().commands.size, 1);
  assert.equal(f.durable().audits.size, 1);
  f.loseCurrent();
  assert.throws(() => f.execute(f.ordinary(2, IDS[3])), /settings-current-missing-with-history/u);
  assert.equal(f.durable().commands.size, 1);
});

it("rolls back ordinary snapshot and activation if audit insertion fails", () => {
  const f = fixture("audit");
  assert.throws(() => f.execute(f.ordinary()), /injected audit failure/u);
  assert.equal(f.durable().commands.size, 0);
  assert.equal(f.durable().audits.size, 0);
  assert.equal(f.durable().snapshots.size, 0);
  assert.equal(f.durable().current, undefined);
  assert.equal(f.durable().active, undefined);
});

it("maps protected and provider private commits followed by SQL failure to distinct uncertainty", () => {
  const protectedFixture = fixture("audit");
  const protectedRequest = { family: "settings", type: "apply-protected-settings", commandId: IDS[0],
    requestedAt: NOW, requestedBy: "local-operator", source: "settings-surface", target: { expectedRevision: 1 },
    payload: { protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH, writeId: IDS[1],
      entries: { ucpathPassword: { set: "synthetic-value" } } } };
  assert.throws(() => protectedFixture.execute(protectedRequest), /credential-audit-uncertain/u);
  assert.equal(protectedFixture.privateCommits(), 1);
  assert.equal(protectedFixture.durable().commands.size, 0);
  const providerFixture = fixture("audit");
  const providerRequest = { family: "settings", type: "apply-provider-keys", commandId: IDS[0],
    requestedAt: NOW, requestedBy: "local-operator", source: "settings-surface",
    target: { expectedRevision: 1, sourceVersionToken: TOKEN },
    payload: { providerSchemaHash: PROVIDER_KEYS_SCHEMA_HASH, writeId: IDS[1],
      operations: { GEMINI_API_KEY: { set: "synthetic-value" } } } };
  assert.throws(() => providerFixture.execute(providerRequest), /provider.*audit.*uncertain/iu);
  assert.equal(providerFixture.providerCommits(), 2);
  assert.equal(providerFixture.durable().commands.size, 0);
});
