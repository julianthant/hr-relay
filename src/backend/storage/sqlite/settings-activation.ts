import { randomUUID } from "node:crypto";
import { initialSettingsFileRecord } from "../../../models/config/settings.js";
import { SettingsInitializationCommandSchema, SettingsInitializationAuditSchema } from "../../../models/config/settings-initialization.js";
import { insertNativeCommand, settleNativeCommand } from "./command-record-row.js";
import { z } from "zod";
import type { DatabaseSync } from "node:sqlite";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { SettingsCurrentRecordSchema } from "../../../models/config/settings-current.js";
import { ActiveRuntimeConfigActivationSchema, ActiveRuntimeConfigExpectationSchema, ActiveRuntimeConfigRecordSchema, RuntimeConfigClaimTokenSchema } from "../../../models/config/runtime-generation.js";
import { ConfigSnapshotRecordSchema } from "../../../models/config/snapshot.js";
import { CommandRequestSchema, CommandAuditRecordSchema } from "../../../rules/commands/commands.js";
import { readAppSettings, writeAppSettings, authenticateSavedSettings } from "./settings-storage.js";
interface SettingsActivationPorts {
 database: DatabaseSync;
 mutate<T>(work:()=>Readonly<{result:T;changes:number}>):T;
 readRecord<S extends z.ZodType>(table:"commands"|"command_audits"|"settings_snapshots",key:string,schema:S):z.output<S>|undefined;
}
export function createSettingsActivationRepositories(ports:SettingsActivationPorts) {
 const readRecord=<S extends z.ZodType>(table:"settings_current"|"runtime_config"|"commands"|"command_audits"|"settings_snapshots",key:string,schema:S):z.output<S>|undefined=> {
  if(table==="settings_current"||table==="runtime_config") {
   const app=readAppSettings(ports.database);const value=table==="settings_current"?app?.saved:app?.active;
   return value==null?undefined:schema.parse(value);
  }
  return ports.readRecord(table,key,schema);
 };
 return Object.freeze({
      settingsCurrent: Object.freeze({
        get: () => readRecord("settings_current", "current", SettingsCurrentRecordSchema),
        hasHistory: () => ports.database.prepare(`
          SELECT 1 FROM commands
          WHERE family = 'settings'
            AND json_extract(request_json, '$.type') = 'apply-settings'
          LIMIT 1
        `).get() !== undefined,
        hasAuditHistory: () => ports.database.prepare(`
          SELECT 1 FROM command_audits
          WHERE json_extract(payload_json, '$.request.family') = 'settings'
            AND json_extract(payload_json, '$.request.type') = 'apply-settings'
          LIMIT 1
        `).get() !== undefined,
        advance: (input: unknown) => {
          const record = SettingsCurrentRecordSchema.parse(input);
          return ports.mutate( () => {
            const current = readRecord(
              "settings_current",
              "current",
              SettingsCurrentRecordSchema,
            );
            const expectedRevision = current === undefined ? 2 : current.revision + 1;
            if (record.revision !== expectedRevision) {
              throw new Error(
                `settings current revision ${String(record.revision)} does not exactly advance `
                + `${String(current?.revision ?? 1)} to ${String(expectedRevision)}`,
              );
            }
            const command = readRecord("commands", record.commandId, CommandRequestSchema);
            const audit = readRecord("command_audits", record.auditId, CommandAuditRecordSchema);
            const authenticated=authenticateSavedSettings(record,command,audit);
            const app = readAppSettings(ports.database);
            if (authenticated.result.restartRequired === false && (app?.active == null
              || app.active.settingsRevision !== record.revision
              || app.active.settingsFingerprint !== record.settingsFingerprint)) {
              throw new Error("settings-activation-current-mismatch");
            }
            if (app === undefined) throw new Error("settings-initialization-missing");
            writeAppSettings(ports.database, { ...app, saved: record });
            const changes = 1;
            return { result: record, changes };
          });
        },
      }),
      runtimeConfig: Object.freeze({
        initialize(input: unknown) {
          const snapshot = ConfigSnapshotRecordSchema.parse(input);
          return ports.mutate(() => {
            if (readAppSettings(ports.database) !== undefined
              || ports.database.prepare("SELECT 1 FROM settings_snapshots LIMIT 1").get() !== undefined) throw new Error("settings-initialization-not-fresh");
            if (snapshot.revision !== 1) throw new Error("settings-initialization-revision-invalid");
            const settings = initialSettingsFileRecord();
            const request = SettingsInitializationCommandSchema.parse({ kind: "settings-initialization", commandId: randomUUID(), revision: 1,
              settings, configSnapshotId: snapshot.configSnapshotId, configFingerprint: snapshot.fingerprint, initializedAt: snapshot.capturedAt });
            insertNativeCommand(ports.database, request);
            ports.database.prepare("INSERT INTO settings_snapshots(id,revision,fingerprint,payload_json,captured_at) VALUES(?,?,?,?,?)")
              .run(snapshot.configSnapshotId, snapshot.revision, snapshot.fingerprint, canonicalJsonStringify(snapshot), snapshot.capturedAt);
            const audit = SettingsInitializationAuditSchema.parse({ kind: "settings-initialization", auditId: randomUUID(), request,
              result: { state: "initialized", revision: 1, snapshotId: snapshot.configSnapshotId, fingerprint: snapshot.fingerprint }, completedAt: snapshot.capturedAt });
            ports.database.prepare("INSERT INTO command_audits(id,command_id,code,payload_json,created_at) VALUES(?,?,NULL,?,?)")
              .run(audit.auditId, request.commandId, canonicalJsonStringify(audit), audit.completedAt);
            settleNativeCommand(ports.database, audit);
            const active = ActiveRuntimeConfigRecordSchema.parse({ generation: 1, settingsRevision: 1, settingsFingerprint: settings.settingsFingerprint,
              configSnapshotId: snapshot.configSnapshotId, configFingerprint: snapshot.fingerprint, activatedAt: snapshot.capturedAt });
            writeAppSettings(ports.database, { format: 1, saved: null, active, initialization: { commandId: request.commandId, auditId: audit.auditId,
              configSnapshotId: snapshot.configSnapshotId, configFingerprint: snapshot.fingerprint, initializedAt: snapshot.capturedAt, settings } });
            return { result: active, changes: 5 };
          });
        },
        hasHistory: () => ports.database.prepare("SELECT 1 FROM settings_snapshots LIMIT 1").get() !== undefined,
        hasAdvancedHistory: () => ports.database.prepare("SELECT 1 FROM settings_snapshots WHERE json_extract(payload_json, '$.revision') > 1 LIMIT 1").get() !== undefined,
        matchesClaim(input: unknown): boolean {
          const token = RuntimeConfigClaimTokenSchema.parse(input);
          const current = readAppSettings(ports.database);
          const active = current?.active;
          if (active == null || active.generation !== token.generation || active.settingsRevision !== token.settingsRevision
            || active.settingsFingerprint !== token.settingsFingerprint || active.configFingerprint !== token.configFingerprint) return false;
          return current?.saved == null ? token.settingsRevision === 1
            : current.saved.revision === token.settingsRevision && current.saved.settingsFingerprint === token.settingsFingerprint;
        },
        matchesRun(configFingerprint: string, runFingerprint: string): boolean {
          // Current authorization permits retained runs; claimEligible still authenticates
          // each run's exact snapshot and enforces worker/claim ownership independently.
          return configFingerprint === runFingerprint
            || readAppSettings(ports.database)?.active?.configFingerprint === configFingerprint;
        },
        get: () => readRecord("runtime_config", "active", ActiveRuntimeConfigRecordSchema),
        activate: (input: unknown) => {
          const request = ActiveRuntimeConfigActivationSchema.parse(input);
          return ports.mutate( () => {
            const snapshot = readRecord(
              "settings_snapshots",
              request.configSnapshotId,
              ConfigSnapshotRecordSchema,
            );
            if (snapshot === undefined || snapshot.fingerprint !== request.configFingerprint) {
              throw new Error(
                `runtime config activation does not bind exact snapshot ${request.configSnapshotId} `
                + `at fingerprint ${request.configFingerprint}`,
              );
            }
            const current = readRecord(
              "runtime_config",
              "active",
              ActiveRuntimeConfigRecordSchema,
            );
            const record = ActiveRuntimeConfigRecordSchema.parse({
              ...request,
              generation: current === undefined ? 1 : current.generation + 1,
            });
            const app = readAppSettings(ports.database);
            if (app === undefined) throw new Error("settings-initialization-required");
            writeAppSettings(ports.database, { ...app, active: record });
            const changes = 1;
            return { result: record, changes };
          });
        },
        requireActive: (input: unknown) => {
          const request = ActiveRuntimeConfigExpectationSchema.parse(input);
          const current = readRecord(
            "runtime_config",
            "active",
            ActiveRuntimeConfigRecordSchema,
          );
          if (current === undefined) {
            throw new Error("runtime config has no dashboard-activated generation");
          }
          if (current.settingsRevision !== request.settingsRevision
            || current.settingsFingerprint !== request.settingsFingerprint
            || current.configFingerprint !== request.configFingerprint) {
            throw new Error(
              `settings revision ${String(request.settingsRevision)} at ${request.settingsFingerprint} `
              + `and config ${request.configFingerprint} are not dashboard-active; restart activation is required`,
            );
          }
          const snapshot = readRecord(
            "settings_snapshots",
            current.configSnapshotId,
            ConfigSnapshotRecordSchema,
          );
          if (snapshot === undefined || snapshot.fingerprint !== current.configFingerprint) {
            throw new Error(
              `active runtime config generation ${String(current.generation)} does not bind exact `
              + `snapshot ${current.configSnapshotId}`,
            );
          }
          return RuntimeConfigClaimTokenSchema.parse({
            generation: current.generation,
            settingsRevision: current.settingsRevision,
            settingsFingerprint: current.settingsFingerprint,
            configFingerprint: current.configFingerprint,
          });
        },
        requireSettingsCurrent: () => {
          const settingsCurrent = readRecord(
            "settings_current",
            "current",
            SettingsCurrentRecordSchema,
          );
          if (settingsCurrent === undefined) return;
          const runtime = readRecord(
            "runtime_config",
            "active",
            ActiveRuntimeConfigRecordSchema,
          );
          if (runtime === undefined
            || runtime.settingsRevision !== settingsCurrent.revision
            || runtime.settingsFingerprint !== settingsCurrent.settingsFingerprint) {
            throw new Error(
              "dashboard runtime settings are stale; restart activation is required",
            );
          }
          const snapshot = readRecord(
            "settings_snapshots",
            runtime.configSnapshotId,
            ConfigSnapshotRecordSchema,
          );
          if (snapshot === undefined || snapshot.fingerprint !== runtime.configFingerprint) {
            throw new Error(
              `active runtime config generation ${String(runtime.generation)} does not bind exact `
              + `snapshot ${runtime.configSnapshotId}`,
            );
          }
        },
      }),
 });
}
