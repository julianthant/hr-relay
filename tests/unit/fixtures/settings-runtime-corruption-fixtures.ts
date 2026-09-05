import { hostConfigFacts } from "../../../src/domain/config/host-display.js";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { canonicalJsonStringify } from "../../../src/domain/canonical-json.js";
import type { Clock } from "../../../src/domain/clock.js";
import { resolveConfigWithProvenance } from "../../../src/domain/config/resolve.js";
import {
  SETTINGS_SCHEMA_HASH,
  SettingsFileRecordSchema,
  deriveSettingsPatchFingerprint,
} from "../../../src/domain/config/settings.js";
import {
  CommandAuditRecordSchema,
  SettingsCommandRequestSchema,
  deriveSettingsCommandFingerprint,
} from "../../../src/domain/commands.js";
import { createSettingsFileAuthority } from "../../../src/infra/config/settings-file.js";
import { AuthorityDatabase } from "../../../src/infra/sqlite/index.js";

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
  try {
    const commandRow = raw.prepare(
      "SELECT record_json FROM commands WHERE record_key = ?",
    ).get(COMMAND_ID);
    const auditRow = raw.prepare(
      "SELECT record_json FROM command_audits WHERE record_key = ?",
    ).get(AUDIT_ID);
    const commandRecord = SettingsCommandRequestSchema.parse(
      JSON.parse(String(commandRow?.record_json)),
    );
    const auditRecord = CommandAuditRecordSchema.parse(
      JSON.parse(String(auditRow?.record_json)),
    );

    if (corruption.id === "command-envelope") {
      const changed = SettingsCommandRequestSchema.parse({
        ...commandRecord,
        requestedAt: CHANGED_REQUESTED_AT,
      });
      raw.prepare("UPDATE commands SET record_json = ? WHERE record_key = ?")
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
      const wrongTarget = { family: "settings" as const, revision: 3 };
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
          target: { family: "settings", revision: 2 },
          before: 0,
          after: 2,
        }],
      };
    } else {
      changedAudit = { ...auditRecord, affectedDependencyIds: [DEPENDENCY_ID] };
    }

    const parsed = CommandAuditRecordSchema.parse(changedAudit);
    raw.prepare("UPDATE command_audits SET record_json = ? WHERE record_key = ?")
      .run(canonicalJsonStringify(parsed), AUDIT_ID);
  } finally {
    raw.close();
  }
}

export function persistCorruptJournaledSettings(input: Readonly<{
  repoRoot: string;
  stateRoot: string;
  clock: Clock;
  corruption: SettingsRuntimeIdentityCorruption;
  activateRuntime: boolean;
}>): Readonly<{ settingsPath: string; settingsBytes: Buffer }> {
  mkdirSync(input.stateRoot, { recursive: true });
  const settingsPath = join(input.repoRoot, ".tracker", "settings", "settings.json");
  const patch = { "browser.headless": { set: false } } as const;
  const command = SettingsCommandRequestSchema.parse({
    commandId: COMMAND_ID,
    requestedAt: input.clock.now().toISOString(),
    requestedBy: "local-operator",
    source: "dashboard",
    family: "settings",
    type: "apply-settings",
    target: { expectedRevision: 1 },
    payload: {
      settingsSchemaHash: SETTINGS_SCHEMA_HASH,
      patchFingerprint: deriveSettingsPatchFingerprint(patch),
      patch,
    },
  });
  const authority = createSettingsFileAuthority({
    path: settingsPath,
    validateCandidate: (settings) => {
      resolveConfigWithProvenance(settings, hostConfigFacts({}), input.clock);
    },
  });
  const outcome = authority.apply({
    commandId: command.commandId,
    commandFingerprint: deriveSettingsCommandFingerprint(command),
    expectedRevision: command.target.expectedRevision,
    settingsSchemaHash: command.payload.settingsSchemaHash,
    patchFingerprint: command.payload.patchFingerprint,
    patch: command.payload.patch,
  });
  if (outcome.state !== "applied") {
    throw new Error(`corrupt settings fixture refused: ${outcome.message}`);
  }

  const databasePath = join(input.stateRoot, "state.db");
  const database = AuthorityDatabase.open(
    { path: databasePath, busyTimeoutMs: 250, migrationOwner: "unit-test" },
    input.clock,
  );
  try {
    database.withAuthorityTransaction((repositories) => {
      repositories.commands.insert(command);
      const target = { family: "settings" as const, revision: outcome.record.revision };
      repositories.commandAudits.insert({
        auditId: AUDIT_ID,
        request: command,
        result: {
          state: "applied",
          commandId: command.commandId,
          affectedTargets: [target],
          restartRequired: true,
          settingsRevision: outcome.record.revision,
          settingsFingerprint: outcome.record.settingsFingerprint,
        },
        completedAt: command.requestedAt,
        versionChanges: [{
          target,
          before: command.target.expectedRevision,
          after: outcome.record.revision,
        }],
        affectedDependencyIds: [],
      });
      repositories.settingsCurrent.advance({
        revision: outcome.record.revision,
        settingsFingerprint: outcome.record.settingsFingerprint,
        commandId: command.commandId,
        commandFingerprint: deriveSettingsCommandFingerprint(command),
        auditId: AUDIT_ID,
        committedAt: command.requestedAt,
      });
      if (input.activateRuntime) {
        const resolved = resolveConfigWithProvenance(outcome.record.settings, hostConfigFacts({}), input.clock);
        repositories.configSnapshots.insert({
          configSnapshotId: CONFIG_SNAPSHOT_ID,
          revision: 1,
          fingerprint: resolved.fingerprint,
          capturedAt: command.requestedAt,
          capturedBy: "local-operator",
          config: resolved.config,
          provenance: resolved.provenance,
        });
        repositories.runtimeConfig.activate({
          settingsRevision: outcome.record.revision,
          settingsFingerprint: outcome.record.settingsFingerprint,
          configSnapshotId: CONFIG_SNAPSHOT_ID,
          configFingerprint: resolved.fingerprint,
          activatedAt: command.requestedAt,
        });
      }
    });
    outcome.commit();
  } finally {
    database.close();
  }

  const settingsBytes = readFileSync(settingsPath);
  SettingsFileRecordSchema.parse(JSON.parse(settingsBytes.toString("utf8")));
  corruptPersistedIdentity(databasePath, input.corruption);
  return Object.freeze({ settingsPath, settingsBytes });
}
