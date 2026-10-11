import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { AuthorityRepositories } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { readBootSettings, readSettings } from "../../../../src/backend/runtime/settings/settings-runtime.js";
import { createSettingsApplicationExecutor } from "../../../../src/backend/runs/commands/settings-service.js";
import { selectNewRunIdentity, selectRunSettings } from "../../../../src/backend/runs/settings/run-settings.js";
import { SettingsCurrentRecordSchema } from "../../../../src/models/config/settings-current.js";
import { SETTINGS_SCHEMA_HASH, derivePersistedSettingsFingerprint, deriveSettingsPatchFingerprint, initialSettingsFileRecord } from "../../../../src/models/config/settings.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH } from "../../../../src/models/config/protected-settings.js";
import type { CredentialStore } from "../../../../src/models/config/credential-store.js";
import { CommandAuditRecordSchema, CommandResultSchema, SettingsCommandRequestSchema, deriveSettingsCommandFingerprint } from "../../../../src/rules/commands/commands.js";
import { ordinaryReadbackState } from "../../../../src/dashboard/surfaces/settings/editor/settings-attempt-model.js";
import { fixtureSettingsDocument } from "../../../support/fixtures/dashboard/fixture-settings.js";

const ID = "11111111-1111-4111-8111-111111111111";
const WRITE_ID = "22222222-2222-4222-8222-222222222222";
const TOKEN_A = "a".repeat(64);
const TOKEN_B = "b".repeat(64);
const TOKEN_C = "c".repeat(64);

function ordinaryRepositories(input: { command?: boolean; audit?: boolean; advanced?: boolean; activeRevision?: number; current?: boolean } = {}): AuthorityRepositories {
  const initial = initialSettingsFileRecord();
  const current = input.current ? SettingsCurrentRecordSchema.parse({ revision: 2, settings: {},
    settingsFingerprint: derivePersistedSettingsFingerprint({}), commandId: ID, commandFingerprint: TOKEN_A,
    auditId: WRITE_ID, committedAt: "2026-10-02T12:00:00.000Z" }) : undefined;
  return {
    settingsCurrent: { get: () => current, hasHistory: () => input.command ?? false,
      hasAuditHistory: () => input.audit ?? false },
    runtimeConfig: { hasHistory: () => input.advanced ?? false, hasAdvancedHistory: () => input.advanced ?? false,
      get: () => input.activeRevision === undefined ? undefined : {
        settingsRevision: input.activeRevision, settingsFingerprint: initial.settingsFingerprint, configFingerprint: TOKEN_B,
      }, requireActive: () => ({}) },
    commands: { getSettingsHistory: () => undefined },
  } as unknown as AuthorityRepositories;
}

function authenticatedSavedSettingsRepositories(input: { active?: boolean; snapshotHistory?: boolean } = {}) {
  const settings = { actor: { label: "Accepted" } };
  const command = SettingsCommandRequestSchema.parse({ commandId: ID, requestedAt: "2026-10-02T12:00:00.000Z",
    requestedBy: "local-operator", source: "settings-surface", family: "settings", type: "apply-settings",
    target: { expectedRevision: 1 }, payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH,
      patchFingerprint: deriveSettingsPatchFingerprint({ "actor.label": { set: "Accepted" } }),
      patch: { "actor.label": { set: "Accepted" } } } });
  const settingsFingerprint = derivePersistedSettingsFingerprint(settings);
  const current = SettingsCurrentRecordSchema.parse({ revision: 2, settings, settingsFingerprint,
    commandId: ID, commandFingerprint: deriveSettingsCommandFingerprint(command), auditId: WRITE_ID,
    committedAt: "2026-10-02T12:00:00.000Z" });
  const audit = CommandAuditRecordSchema.parse({ auditId: WRITE_ID, request: command,
    result: { state: "applied", commandId: ID, affectedTargets: [{ family: "settings", revision: 2 }],
      restartRequired: false, settingsRevision: 2, settingsFingerprint },
    completedAt: current.committedAt,
    versionChanges: [{ target: { family: "settings", revision: 2 }, before: 1, after: 2 }],
    affectedDependencyIds: [] });
  let writes = 0;
  const repositories = {
    settingsCurrent: { get: () => current, hasHistory: () => true, hasAuditHistory: () => true,
      advance: () => { writes += 1; return current; } },
    runtimeConfig: { get: () => input.active ? { settingsRevision: current.revision,
      settingsFingerprint: current.settingsFingerprint, configFingerprint: TOKEN_B } : undefined,
      hasHistory: () => input.snapshotHistory ?? false, hasAdvancedHistory: () => false,
      requireActive: () => ({}), activate: () => { writes += 1; return undefined; } },
    commands: { getSettingsHistory: (commandId: string) => commandId === ID ? command : undefined },
    commandAudits: { findSettingsHistory: (commandId: string) => commandId === ID ? audit : undefined },
    configSnapshots: { insert: () => { writes += 1; } },
  } as unknown as AuthorityRepositories;
  return { repositories, writes: () => writes };
}

describe("ordinary Settings authority admission", () => {
  it("admits empty authority and intact initial revision one", () => {
    assert.deepEqual(readSettings(ordinaryRepositories()), initialSettingsFileRecord());
    assert.deepEqual(readSettings(ordinaryRepositories({ activeRevision: 1 })), initialSettingsFileRecord());
  });
  it("refuses a missing singleton when command, audit, or advanced runtime history survives", () => {
    for (const input of [{ command: true }, { audit: true }, { advanced: true }, { activeRevision: 2 }]) {
      assert.throws(() => readSettings(ordinaryRepositories(input)), /settings-current-missing-with-history/u);
    }
  });
  it("refuses a current row with no matching durable command", () => {
    assert.throws(() => readSettings(ordinaryRepositories({ current: true })), /no durable command journal/u);
  });
  it("refuses a divergent command or audit despite a saved row", () => {
    const patch = { "actor.label": { set: "accepted" } } as const;
    const command = SettingsCommandRequestSchema.parse({ commandId: ID, requestedAt: "2026-10-02T12:00:00.000Z",
      requestedBy: "local-operator", source: "settings-surface", family: "settings", type: "apply-settings",
      target: { expectedRevision: 1 }, payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH,
        patchFingerprint: deriveSettingsPatchFingerprint(patch), patch } });
    const current = SettingsCurrentRecordSchema.parse({ revision: 2, settings: {},
      settingsFingerprint: derivePersistedSettingsFingerprint({}), commandId: ID,
      commandFingerprint: deriveSettingsCommandFingerprint(command), auditId: WRITE_ID,
      committedAt: "2026-10-02T12:00:00.000Z" });
    const base = ordinaryRepositories();
    const repositories = (fingerprint: string, audit: unknown) => ({ ...base,
      settingsCurrent: { ...base.settingsCurrent, get: () => ({ ...current, commandFingerprint: fingerprint }) },
      commands: { ...base.commands, getSettingsHistory: () => command },
      commandAudits: { ...base.commandAudits, findSettingsHistory: () => audit },
    }) as unknown as AuthorityRepositories;
    const target = { family: "settings", revision: 2 };
    const audit = CommandAuditRecordSchema.parse({ request: command, result: { state: "applied", commandId: ID, affectedTargets: [target],
      restartRequired: false, settingsRevision: 2, settingsFingerprint: current.settingsFingerprint },
      versionChanges: [{ target, before: 1, after: 2 }], affectedDependencyIds: [], auditId: WRITE_ID, completedAt: current.committedAt });
    assert.equal(readSettings(repositories(current.commandFingerprint, audit)).revision, 2);
    assert.throws(() => readSettings(repositories(TOKEN_A, audit)), /settings-current-command-audit-binding-mismatch/u);
    assert.throws(() => readSettings(repositories(current.commandFingerprint, { ...audit, result: { ...audit.result, commandId: WRITE_ID } })), /settings-current-command-audit-binding-mismatch/u);
  });

  it("admits a retained ordinary revision only while its active runtime remains present", () => {
    const retained = authenticatedSavedSettingsRepositories({ active: true });
    assert.equal(readBootSettings(retained.repositories).revision, 2);
    assert.equal(retained.writes(), 0);
  });

  it("refuses authenticated saved Settings with no active runtime or snapshots without replacing activation", () => {
    const missingRuntime = authenticatedSavedSettingsRepositories();
    assert.equal(readSettings(missingRuntime.repositories).revision, 2);
    assert.throws(() => readBootSettings(missingRuntime.repositories),
      /dashboard settings\/runtime authority is missing despite durable revision evidence/u);
    assert.equal(missingRuntime.writes(), 0);

    const orphanSnapshot = authenticatedSavedSettingsRepositories({ snapshotHistory: true });
    assert.throws(() => readBootSettings(orphanSnapshot.repositories),
      /dashboard settings\/runtime authority is missing despite durable revision evidence/u);
    assert.equal(orphanSnapshot.writes(), 0);
  });

  it("admits virgin authority and intact initial active revision at boot", () => {
    assert.deepEqual(readBootSettings(ordinaryRepositories()), initialSettingsFileRecord());
    assert.deepEqual(readBootSettings(ordinaryRepositories({ activeRevision: 1 })), initialSettingsFileRecord());
  });

  it("refuses orphan runtime snapshot history without an active generation", () => {
    assert.throws(() => readBootSettings(ordinaryRepositories({ advanced: true })),
      /settings-current-missing-with-history/u);
  });
});

it("selects the active snapshot for a new run while retained runs keep their exact snapshot", () => {
  const snapshots = new Map([[ID, { configSnapshotId: ID, fingerprint: TOKEN_A }],
    [WRITE_ID, { configSnapshotId: WRITE_ID, fingerprint: TOKEN_B }]]);
  const repositories = { configSnapshots: { get: (key: string) => snapshots.get(key) },
    runtimeConfig: { get: () => ({ configSnapshotId: WRITE_ID, configFingerprint: TOKEN_B }) } } as unknown as AuthorityRepositories;
  const oldRun = { configSnapshotId: ID, configFingerprint: TOKEN_A };
  assert.deepEqual(selectNewRunIdentity(repositories, oldRun), { configSnapshotId: WRITE_ID, configFingerprint: TOKEN_B });
  assert.deepEqual(selectRunSettings(repositories, oldRun), snapshots.get(ID));
  assert.throws(() => selectRunSettings(repositories, { ...oldRun, configFingerprint: TOKEN_C }), /run-settings-snapshot-mismatch/u);
});

describe("accepted Settings readback", () => {
  it("separates superseded ordinary acceptance from a same-revision mismatch", () => {
    const patch = { "actor.label": { set: "Accepted" } } as const;
    const command = SettingsCommandRequestSchema.parse({ commandId: ID, requestedAt: "2026-10-02T12:00:00.000Z",
      requestedBy: "local-operator", source: "settings-surface", family: "settings", type: "apply-settings",
      target: { expectedRevision: 1 }, payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH,
        patchFingerprint: deriveSettingsPatchFingerprint(patch), patch } });
    const accepted = fixtureSettingsDocument({ actor: { label: "Accepted" } }, 2);
    const result = CommandResultSchema.parse({ state: "applied", commandId: ID,
      affectedTargets: [{ family: "settings", revision: 2 }], restartRequired: false,
      settingsRevision: 2, settingsFingerprint: accepted.settingsFingerprint });
    assert.equal(ordinaryReadbackState(command, result, accepted), "confirmed");
    assert.equal(ordinaryReadbackState(command, result, fixtureSettingsDocument({ actor: { label: "Later" } }, 3)), "superseded");
    assert.equal(ordinaryReadbackState(command, result, fixtureSettingsDocument({ actor: { label: "Mismatch" } }, 2)), "unresolved");
    assert.equal(ordinaryReadbackState(command, CommandResultSchema.parse({ ...result, commandId: WRITE_ID }), fixtureSettingsDocument({}, 3)), "unresolved");
  });
});

it("keeps request validation before private reads and maps independent-store uncertainty", () => {
  let privateCommits = 0;
  const credentials = { apply: () => { privateCommits += 1; return { state: "rejected", code: "authority-uncertain",
    message: "private authority uncertain" } as const; } } as unknown as CredentialStore;
  const executor = createSettingsApplicationExecutor(() => { throw new Error("unused resolver"); }, credentials);
  const command = SettingsCommandRequestSchema.parse({ commandId: ID, requestedAt: "2026-10-02T12:00:00.000Z",
    requestedBy: "local-operator", source: "settings-surface", family: "settings", type: "apply-settings",
    target: { expectedRevision: 1 }, payload: { settingsSchemaHash: TOKEN_A,
      patchFingerprint: TOKEN_B, patch: { "actor.label": { set: "test" } } } });
  assert.equal(executor.validateRequest(command)?.state, "rejected");
  assert.equal(privateCommits, 0);
  const protectedCommand = { ...command, type: "apply-protected-settings", payload: {
    protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH, writeId: WRITE_ID, entries: { ucpathPassword: { set: "synthetic" } },
  } } as unknown as Parameters<typeof executor.commitPrivate>[0];
  assert.deepEqual(executor.commitPrivate(protectedCommand), { state: "rejected", code: "authority-uncertain",
    message: "private authority uncertain" });
  assert.equal(privateCommits, 1);

});
