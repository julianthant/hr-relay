import { default as assert_m0,default as assert_m1 } from "node:assert/strict";
import { it as it_m0,it as it_m1 } from "vitest";
import { z as z_m0 } from "zod";
import { resolveConfigWithProvenance as resolveConfigWithProvenance_m0 } from "../../../../src/backend/app/config/resolve.js";
import { executeSettingsCommand as executeSettingsCommand_m0,type CommandAuthority as CommandAuthority_m0 } from "../../../../src/backend/runs/commands/command-kernel.js";
import { createSettingsApplicationExecutor as createSettingsApplicationExecutor_m0,createSettingsApplicationExecutor as createSettingsApplicationExecutor_m1 } from "../../../../src/backend/runs/commands/settings-service.js";
import { readSettings as readSettings_m0 } from "../../../../src/backend/runtime/settings/settings-runtime.js";
import type { AuthorityRepositories as AuthorityRepositories_m0 } from "../../../../src/backend/storage/sqlite/authority-database.js";
import type { CredentialStore as CredentialStore_m0,CredentialStore as CredentialStore_m1 } from "../../../../src/models/config/credential-store.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH as PROTECTED_SETTINGS_SCHEMA_HASH_m0,PROTECTED_SETTINGS_SCHEMA_HASH as PROTECTED_SETTINGS_SCHEMA_HASH_m1,ProtectedSettingsApplyInputSchema as ProtectedSettingsApplyInputSchema_m0,ProtectedStoreRecordSchema as ProtectedStoreRecordSchema_m0,type ProtectedStoreRecord as ProtectedStoreRecord_m0 } from "../../../../src/models/config/protected-settings.js";
import { ActiveRuntimeConfigActivationSchema as ActiveRuntimeConfigActivationSchema_m0,ActiveRuntimeConfigRecordSchema as ActiveRuntimeConfigRecordSchema_m0 } from "../../../../src/models/config/runtime-generation.js";
import { SettingsCurrentRecordSchema as SettingsCurrentRecordSchema_m0 } from "../../../../src/models/config/settings-current.js";
import { SETTINGS_SCHEMA_HASH as SETTINGS_SCHEMA_HASH_m0,deriveSettingsPatchFingerprint as deriveSettingsPatchFingerprint_m0,initialSettingsFileRecord as initialSettingsFileRecord_m0 } from "../../../../src/models/config/settings.js";
import { ConfigSnapshotRecordSchema as ConfigSnapshotRecordSchema_m0 } from "../../../../src/models/config/snapshot.js";
import { CommandAuditRecordSchema as CommandAuditRecordSchema_m0,CommandRequestSchema as CommandRequestSchema_m0,SettingsCommandRequestSchema as SettingsCommandRequestSchema_m1,type CommandRequest as CommandRequest_m0 } from "../../../../src/rules/commands/commands.js";
import { manualClock as manualClock_m0 } from "../../../../src/rules/time/clock.js";


{


const NOW = "2026-10-02T12:00:00.000Z";
const IDS = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333", "44444444-4444-4444-8444-444444444444"];
type State = { commands: Map<string, CommandRequest_m0>; audits: Map<string, z_m0.infer<typeof CommandAuditRecordSchema_m0>>;
  current?: z_m0.infer<typeof SettingsCurrentRecordSchema_m0>; active?: z_m0.infer<typeof ActiveRuntimeConfigRecordSchema_m0>;
  snapshots: Map<string, z_m0.infer<typeof ConfigSnapshotRecordSchema_m0>> };

function fixture(failAt?: "audit" | "insert") {
  let durable: State = { commands: new Map(), audits: new Map(), snapshots: new Map() };
  let privateCommits = 0;
  let privateRecord: ProtectedStoreRecord_m0 | undefined;
  let nextId = 1;
  const clock = manualClock_m0(new Date(NOW));
  const authority: CommandAuthority_m0 = { withAuthorityTransaction: (work) => {
    const state: State = { commands: new Map(durable.commands), audits: new Map(durable.audits),
      snapshots: new Map(durable.snapshots), current: durable.current, active: durable.active };
    const repositories = {
      commands: {
        assertIdentity(input: unknown) { const command = CommandRequestSchema_m0.parse(input);
          const existing = state.commands.get(command.commandId);
          if (existing !== undefined) assert_m0.deepEqual(existing, command); },
        get: (id: string) => state.commands.get(id), getSettingsHistory: (id: string) => state.commands.get(id),
        insert(input: unknown) { if (failAt === "insert") throw new Error("injected journal failure");
          const command = CommandRequestSchema_m0.parse(input); const existing = state.commands.get(command.commandId);
          if (existing !== undefined) return { state: "existing", record: existing };
          state.commands.set(command.commandId, command); return { state: "inserted", record: command }; },
      },
      commandAudits: {
        insert(input: unknown) { if (failAt === "audit") throw new Error("injected audit failure");
          const audit = CommandAuditRecordSchema_m0.parse(input);
          state.audits.set(audit.request.commandId, audit); return { state: "inserted", record: audit }; },
        findByCommand: (id: string) => state.audits.get(id),
        findSettingsHistory: (id: string) => state.audits.get(id),
      },
      settingsCurrent: {
        get: () => state.current,
        hasHistory: () => [...state.commands.values()].some(command => command.family === "settings" && command.type === "apply-settings"),
        hasAuditHistory: () => [...state.audits.values()].some(audit => audit.request.type === "apply-settings"),
        advance(input: unknown) { state.current = SettingsCurrentRecordSchema_m0.parse(input); return state.current; },
      },
      configSnapshots: { insert(input: unknown) { const snapshot = ConfigSnapshotRecordSchema_m0.parse(input);
        state.snapshots.set(snapshot.configSnapshotId, snapshot); return { state: "inserted", record: snapshot }; } },
      runtimeConfig: {
        get: () => state.active, hasHistory: () => state.snapshots.size > 0,
        hasAdvancedHistory: () => [...state.snapshots.values()].some(snapshot => snapshot.revision > 1),
        requireActive: () => ({}), activate(input: unknown) { state.active = ActiveRuntimeConfigRecordSchema_m0.parse({
          ...ActiveRuntimeConfigActivationSchema_m0.parse(input), generation: (state.active?.generation ?? 0) + 1,
        }); return state.active; },
      },
    } as unknown as AuthorityRepositories_m0;
    const result = work(repositories);
    durable = state;
    return result;
  } };
  const credentials = { apply: (input: unknown) => { privateCommits += 1;
    const applied = ProtectedSettingsApplyInputSchema_m0.parse(input);
    privateRecord = ProtectedStoreRecordSchema_m0.parse({ schemaVersion: 1, revision: applied.expectedRevision + 1,
      protectedSchemaHash: applied.protectedSchemaHash, entries: {}, lastApplied: {
        commandId: applied.commandId, commandFingerprint: applied.commandFingerprint, expectedRevision: applied.expectedRevision,
        protectedSchemaHash: applied.protectedSchemaHash, writeId: applied.writeId,
      } });
    return { state: "applied", record: privateRecord }; },
  verifyReplay: () => { if (privateRecord === undefined) throw new Error("missing private commit");
    return { state: "applied", record: privateRecord }; } } as unknown as CredentialStore_m0;
  const settings = createSettingsApplicationExecutor_m0(
    value => resolveConfigWithProvenance_m0(value, { primaryDisplay: null }, clock), credentials);
  const execute = (command: unknown) => executeSettingsCommand_m0({ authority, clock,
    ids: { uuid: () => IDS[nextId++ % IDS.length] }, settings }, command);
  const ordinary = (expectedRevision = 1, commandId = IDS[0]) => {
    const patch = { "concurrency.defaultWorkers": { set: 3 } };
    return { family: "settings", type: "apply-settings", commandId, requestedAt: NOW,
      requestedBy: "local-operator", source: "settings-surface", target: { expectedRevision },
      payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH_m0, patchFingerprint: deriveSettingsPatchFingerprint_m0(patch), patch } };
  };
  return { execute, ordinary, authority, durable: () => durable,
    privateCommits: () => privateCommits,
    loseCurrent: () => { durable.current = undefined; } };
}

it_m0("applies the first ordinary save before its own journal row becomes history; stale and missing authority refuse", () => {
  const f = fixture();
  assert_m0.deepEqual(readSettings_m0(f.authority.withAuthorityTransaction(repositories => repositories)), initialSettingsFileRecord_m0());
  const applied = f.execute(f.ordinary());
  assert_m0.equal(applied.state, "applied");
  assert_m0.equal(f.durable().commands.size, 1);
  assert_m0.equal(f.durable().audits.size, 1);
  assert_m0.equal(f.durable().snapshots.size, 1);
  assert_m0.equal(f.durable().current?.revision, 2);
  assert_m0.equal(f.durable().active?.settingsRevision, 2);
  assert_m0.equal(f.authority.withAuthorityTransaction(readSettings_m0).revision, 2);
  assert_m0.equal(f.execute(f.ordinary()).state, "already-applied");
  assert_m0.equal(f.durable().commands.size, 1);
  assert_m0.equal(f.execute(f.ordinary(1, IDS[2])).state, "conflict");
  assert_m0.equal(f.durable().commands.size, 1);
  assert_m0.equal(f.durable().audits.size, 1);
  f.loseCurrent();
  assert_m0.throws(() => f.execute(f.ordinary(2, IDS[3])), /settings-current-missing-with-history/u);
  assert_m0.equal(f.durable().commands.size, 1);
});

it_m0("rolls back ordinary snapshot and activation if audit insertion fails", () => {
  const f = fixture("audit");
  assert_m0.throws(() => f.execute(f.ordinary()), /injected audit failure/u);
  assert_m0.equal(f.durable().commands.size, 0);
  assert_m0.equal(f.durable().audits.size, 0);
  assert_m0.equal(f.durable().snapshots.size, 0);
  assert_m0.equal(f.durable().current, undefined);
  assert_m0.equal(f.durable().active, undefined);
});

it_m0("maps protected private commits followed by SQL failure to uncertainty", () => {
  const protectedFixture = fixture("audit");
  const protectedRequest = { family: "settings", type: "apply-protected-settings", commandId: IDS[0],
    requestedAt: NOW, requestedBy: "local-operator", source: "settings-surface", target: { expectedRevision: 1 },
    payload: { protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH_m0, writeId: IDS[1],
      entries: { ucpathPassword: { set: "synthetic-value" } } } };
  assert_m0.throws(() => protectedFixture.execute(protectedRequest), /credential-audit-uncertain/u);
  assert_m0.equal(protectedFixture.privateCommits(), 1);
  assert_m0.equal(protectedFixture.durable().commands.size, 0);

});
}

{


const ID = "11111111-1111-4111-8111-111111111111";
const WRITE_ID = "22222222-2222-4222-8222-222222222222";
const TOKEN_A = "a".repeat(64);
const TOKEN_B = "b".repeat(64);

it_m1("keeps request validation before private reads and maps independent-store uncertainty", () => {
  let privateCommits = 0;
  const credentials = { apply: () => { privateCommits += 1; return { state: "rejected", code: "authority-uncertain",
    message: "private authority uncertain" } as const; } } as unknown as CredentialStore_m1;
  const executor = createSettingsApplicationExecutor_m1(() => { throw new Error("unused resolver"); }, credentials);
  const command = SettingsCommandRequestSchema_m1.parse({ commandId: ID, requestedAt: "2026-10-02T12:00:00.000Z",
    requestedBy: "local-operator", source: "settings-surface", family: "settings", type: "apply-settings",
    target: { expectedRevision: 1 }, payload: { settingsSchemaHash: TOKEN_A,
      patchFingerprint: TOKEN_B, patch: { "actor.label": { set: "test" } } } });
  assert_m1.equal(executor.validateRequest(command)?.state, "rejected");
  assert_m1.equal(privateCommits, 0);
  const protectedCommand = { ...command, type: "apply-protected-settings", payload: {
    protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH_m1, writeId: WRITE_ID, entries: { ucpathPassword: { set: "synthetic" } },
  } } as unknown as Parameters<typeof executor.commitPrivate>[0];
  assert_m1.deepEqual(executor.commitPrivate(protectedCommand), { state: "rejected", code: "authority-uncertain",
    message: "private authority uncertain" });
  assert_m1.equal(privateCommits, 1);

});
}
