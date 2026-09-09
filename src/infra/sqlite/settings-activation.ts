import { z } from "zod";
import type { DatabaseSync } from "node:sqlite";
import { canonicalJsonStringify } from "../../domain/canonical-json.js";
import { SettingsCurrentRecordSchema } from "../../domain/config/settings-current.js";
import { ActiveRuntimeConfigActivationSchema, ActiveRuntimeConfigExpectationSchema, ActiveRuntimeConfigRecordSchema, RuntimeConfigClaimTokenSchema } from "../../domain/config/runtime-generation.js";
import { ConfigSnapshotRecordSchema } from "../../domain/config/snapshot.js";
import { CommandRequestSchema, CommandAuditRecordSchema, deriveSettingsCommandFingerprint } from "../../domain/commands.js";
import { readAppSettings, writeAppSettings } from "./settings-storage.js";
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
            const target = { family: "settings" as const, revision: record.revision };
            if (command === undefined
              || command.family !== "settings"
              || command.type !== "apply-settings"
              || deriveSettingsCommandFingerprint(command) !== record.commandFingerprint
              || audit === undefined
              || audit.request.commandId !== record.commandId
              || canonicalJsonStringify(audit.request) !== canonicalJsonStringify(command)
              || audit.result.state !== "applied"
              || audit.result.commandId !== record.commandId
              || typeof audit.result.restartRequired !== "boolean"
              || audit.result.settingsRevision !== record.revision
              || audit.result.settingsFingerprint !== record.settingsFingerprint
              || canonicalJsonStringify(audit.result.affectedTargets)
                !== canonicalJsonStringify([target])
              || canonicalJsonStringify(audit.versionChanges) !== canonicalJsonStringify([{
                target,
                before: record.revision - 1,
                after: record.revision,
              }])
              || audit.affectedDependencyIds.length !== 0
              || audit.completedAt !== record.committedAt) {
              throw new Error(
                `settings current revision ${String(record.revision)} does not bind its exact command and audit result`,
              );
            }
            const app = readAppSettings(ports.database);
            if (audit.result.restartRequired === false && (app?.active == null
              || app.active.settingsRevision !== record.revision
              || app.active.settingsFingerprint !== record.settingsFingerprint)) {
              throw new Error("settings-activation-current-mismatch");
            }
            writeAppSettings(ports.database, { format: 1, saved: record, active: app?.active ?? null });
            const changes = 1;
            return { result: record, changes };
          });
        },
      }),
      runtimeConfig: Object.freeze({
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
            writeAppSettings(ports.database, { format: 1, saved: app?.saved ?? null, active: record });
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
