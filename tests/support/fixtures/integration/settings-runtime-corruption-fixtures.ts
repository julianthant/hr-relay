import { hostConfigFacts } from "../../../../src/models/config/host-display.js";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import type { Clock } from "../../../../src/rules/time/clock.js";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import {
  SETTINGS_SCHEMA_HASH,
  mergeSettingsPatch,
  deriveSettingsPatchFingerprint,
} from "../../../../src/models/config/settings.js";
import {
  CommandAuditRecordSchema,
  SettingsCommandRequestSchema,
  deriveSettingsCommandFingerprint,
} from "../../../../src/rules/commands/commands.js";
import type { SettingsCurrentRecord } from "../../../../src/models/config/settings-current.js";
import { derivePersistedSettingsFingerprint } from "../../../../src/models/config/settings.js";
import type { CredentialStore } from "../../../../src/models/config/credential-store.js";
import { readSettings } from "../../../../src/backend/runtime/settings/settings-runtime.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import type { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";

const COMMAND_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_COMMAND_ID = "99999999-9999-4999-8999-999999999999";
const AUDIT_ID = "44444444-4444-4444-8444-444444444444";
const DEPENDENCY_ID = "77777777-7777-4777-8777-777777777777";
const CONFIG_SNAPSHOT_ID = "55555555-5555-4555-8555-555555555555";
const CHANGED_REQUESTED_AT = "2026-08-28T12:00:01.000Z";

export const SETTINGS_RUNTIME_IDENTITY_CORRUPTIONS = Object.freeze([
  Object.freeze({
    id: "command-envelope",
    label: "journal command envelope",
    expected: /does not match the full journaled command envelope/u,
  }),
  Object.freeze({
    id: "audit-request",
    label: "audit request identity",
    expected: /has a mismatched durable audit/u,
  }),
  Object.freeze({
    id: "audit-result-state",
    label: "audit result state",
    expected: /has a mismatched durable audit/u,
  }),
  Object.freeze({
    id: "audit-result-command",
    label: "audit result command identity",
    expected: /has a mismatched durable audit/u,
  }),
  Object.freeze({
    id: "audit-result-settings",
    label: "audit result settings identity",
    expected: /has a mismatched durable audit/u,
  }),
  Object.freeze({
    id: "audit-result-target",
    label: "audit result target identity",
    expected: /has a mismatched durable audit/u,
  }),
  Object.freeze({
    id: "audit-version-vector",
    label: "audit version vector",
    expected: /has a mismatched durable audit/u,
  }),
  Object.freeze({
    id: "audit-dependency-vector",
    label: "audit dependency vector",
    expected: /has a mismatched durable audit/u,
  }),
] as const);

type SettingsRuntimeIdentityCorruption =
  (typeof SETTINGS_RUNTIME_IDENTITY_CORRUPTIONS)[number];

function corruptPersistedIdentity(
  databasePath: string,
  corruption: SettingsRuntimeIdentityCorruption,
): void {
  const raw = new DatabaseSync(databasePath);
  const trigger = raw.prepare("SELECT sql FROM sqlite_schema WHERE name='command_audits_immutable'").get()?.sql;
  if (typeof trigger !== "string") { raw.close(); throw new Error("fixture audit trigger missing"); }
  try {
    raw.exec("DROP TRIGGER command_audits_immutable");
    const commandRow = raw.prepare(
      "SELECT request_json FROM commands WHERE id = ?",
    ).get(COMMAND_ID);
    const auditRow = raw.prepare(
      "SELECT payload_json FROM command_audits WHERE id = ?",
    ).get(AUDIT_ID);
    const commandRecord = SettingsCommandRequestSchema.parse(
      JSON.parse(String(commandRow?.request_json)),
    );
    const auditRecord = CommandAuditRecordSchema.parse(
      JSON.parse(String(auditRow?.payload_json)),
    );

    if (corruption.id === "command-envelope") {
      const changed = SettingsCommandRequestSchema.parse({
        ...commandRecord,
        requestedAt: CHANGED_REQUESTED_AT,
      });
      raw.prepare("UPDATE commands SET request_json = ? WHERE id = ?")
        .run(canonicalJsonStringify(changed), COMMAND_ID);
      return;
    }

    let changedAudit: unknown;
    if (corruption.id === "audit-request") {
      changedAudit = {
        ...auditRecord,
        request: { ...auditRecord.request, requestedAt: CHANGED_REQUESTED_AT },
      };
    } else if (corruption.id === "audit-result-state") {
      changedAudit = {
        ...auditRecord,
        result: { ...auditRecord.result, state: "already-applied" },
      };
    } else if (corruption.id === "audit-result-command") {
      changedAudit = {
        ...auditRecord,
        result: { ...auditRecord.result, commandId: OTHER_COMMAND_ID },
      };
    } else if (corruption.id === "audit-result-settings") {
      changedAudit = {
        ...auditRecord,
        result: { ...auditRecord.result, settingsFingerprint: "f".repeat(64) },
      };
    } else if (corruption.id === "audit-result-target") {
      const wrongTarget = { family: "settings" as const, revision: commandRecord.target.expectedRevision + 2 };
      changedAudit = {
        ...auditRecord,
        result: {
          ...auditRecord.result,
          affectedTargets: [wrongTarget],
          settingsRevision: wrongTarget.revision,
        },
      };
    } else if (corruption.id === "audit-version-vector") {
      changedAudit = {
        ...auditRecord,
        versionChanges: [{
          target: { family: "settings", revision: commandRecord.target.expectedRevision + 1 },
          before: 0,
          after: commandRecord.target.expectedRevision + 1,
        }],
      };
    } else {
      changedAudit = { ...auditRecord, affectedDependencyIds: [DEPENDENCY_ID] };
    }

    const parsed = CommandAuditRecordSchema.parse(changedAudit);
    raw.prepare("UPDATE command_audits SET payload_json = ? WHERE id = ?")
      .run(canonicalJsonStringify(parsed), AUDIT_ID);
  } finally {
    raw.exec(trigger);
    raw.close();
  }
}

export function persistCorruptJournaledSettings(input: Readonly<{
  repoRoot: string;
  stateRoot: string;
  clock: Clock;
  corruption: SettingsRuntimeIdentityCorruption;
  activateRuntime: boolean;
  admission: RuntimeAdmission;
  credentials: CredentialStore;
}>): Readonly<{ record: SettingsCurrentRecord }> {
  input.admission.assertAuthorityDatabase(join(input.stateRoot, "state.db"));
  const databasePath = join(input.stateRoot, "state.db");
  const options = { path: databasePath, busyTimeoutMs: 250, migrationOwner: "unit-test" };
  const open = () => AuthorityDatabase.open(input.admission, options, input.clock, undefined, undefined, undefined,
    input.credentials);
  const database = open();
  const baseline = readSettings(database.authority);
  const patch = { "browser.headless": { set: false } } as const;
  const command = SettingsCommandRequestSchema.parse({
    commandId: COMMAND_ID,
    requestedAt: input.clock.now().toISOString(),
    requestedBy: "local-operator",
    source: "dashboard",
    family: "settings",
    type: "apply-settings",
    target: { expectedRevision: baseline.revision },
    payload: {
      settingsSchemaHash: SETTINGS_SCHEMA_HASH,
      patchFingerprint: deriveSettingsPatchFingerprint(patch),
      patch,
    },
  });
  const settings = mergeSettingsPatch(baseline.settings, patch);
  const record = { revision: baseline.revision + 1, settings, settingsFingerprint: derivePersistedSettingsFingerprint(settings) };
  try {
    if (database.authority.runtimeConfig.get() === undefined) {
      const initial = resolveConfigWithProvenance(baseline.settings, hostConfigFacts({}), input.clock,
        { stateRoot: input.stateRoot, artifactRoot: input.admission.artifactRoot });
      database.authority.runtimeConfig.initialize({ configSnapshotId: DEPENDENCY_ID, revision: baseline.revision,
        fingerprint: initial.fingerprint, config: initial.config, provenance: initial.provenance,
        capturedAt: command.requestedAt, capturedBy: "local-operator" });
    }
    database.withAuthorityTransaction((repositories) => {
      repositories.commands.insert(command);
      const target = { family: "settings" as const, revision: record.revision };
      repositories.commandAudits.insert({
        auditId: AUDIT_ID,
        request: command,
        result: {
          state: "applied",
          commandId: command.commandId,
          affectedTargets: [target],
          restartRequired: true,
          settingsRevision: record.revision,
          settingsFingerprint: record.settingsFingerprint,
        },
        completedAt: command.requestedAt,
        versionChanges: [{
          target,
          before: command.target.expectedRevision,
          after: record.revision,
        }],
        affectedDependencyIds: [],
      });
      repositories.settingsCurrent.advance({
        revision: record.revision,
        settings: record.settings,
        settingsFingerprint: record.settingsFingerprint,
        commandId: command.commandId,
        commandFingerprint: deriveSettingsCommandFingerprint(command),
        auditId: AUDIT_ID,
        committedAt: command.requestedAt,
      });
      if (input.activateRuntime) {
        const resolved = resolveConfigWithProvenance(record.settings, hostConfigFacts({}), input.clock,
          { stateRoot: input.stateRoot, artifactRoot: input.admission.artifactRoot });
        repositories.configSnapshots.insert({
          configSnapshotId: CONFIG_SNAPSHOT_ID,
          revision: record.revision,
          fingerprint: resolved.fingerprint,
          capturedAt: command.requestedAt,
          capturedBy: "local-operator",
          config: resolved.config,
          provenance: resolved.provenance,
        });
        repositories.runtimeConfig.activate({
          settingsRevision: record.revision,
          settingsFingerprint: record.settingsFingerprint,
          configSnapshotId: CONFIG_SNAPSHOT_ID,
          configFingerprint: resolved.fingerprint,
          activatedAt: command.requestedAt,
        });
      }
    });
  } finally {
    database.close();
  }

  const reopened = open();
  let current: SettingsCurrentRecord;
  try { const value = reopened.authority.settingsCurrent.get(); if (value === undefined) throw new Error("missing fixture current"); current = value; }
  finally { reopened.close(); }
  corruptPersistedIdentity(databasePath, input.corruption);
  return Object.freeze({ record: current });
}
