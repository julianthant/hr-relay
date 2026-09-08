import { RunRecordService } from "../../../src/core/run-record-service.js";
import { hostConfigFacts } from "../../../src/domain/config/host-display.js";
/**
 * The dry-run admission fixture every T1b composition proof shares: a selected
 * SQLite ordinary settings journaled through the REAL settings kernel arm and
 * activated through the existing dashboard activation contract — never an
 * alternate runtime writer — plus a read-only view of the start-effect tables.
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { rebuildRuntimeIsolation } from "../../../src/config/runtime-isolation.js";
import type { TestClock } from "../../../src/domain/clock.js";
import { createCommandKernel } from "../../../src/core/command-kernel.js";
import { resolveConfigWithProvenance } from "../../../src/domain/config/resolve.js";
import { SETTINGS_SCHEMA_HASH, deriveSettingsPatchFingerprint } from "../../../src/domain/config/settings.js";
import { createCredentialStore } from "../../../src/infra/config/credential-store.js";
import { createSettingsApplicationExecutor } from "../../../src/server/dashboard/commands/settings-service.js";
import { readSettings } from "../../../src/server/settings-runtime.js";
import { AuthorityDatabase } from "../../../src/infra/sqlite/index.js";
import { sequentialIdFactory } from "../../fixtures/phase1f-run-fixtures.js";
import { NO_INTAKE_PROJECTIONS, UNSTORED_CONFIG_IDENTITY, UNWIRED_INTAKE_PARSER } from "../../fixtures/intake-kernel-seams.js";
import { UNWIRED_ARCHIVE_SNAPSHOTS } from "../../fixtures/archive-fixtures.js";
import { settingsSetOperations } from "./settings-operation-fixtures.js";

export function selectedSettingsFixture(
  root: string,
  clock: TestClock,
  env: NodeJS.ProcessEnv = {},
  databases: AuthorityDatabase[] = [],
) {
  const path = join(root, rebuildRuntimeIsolation.stateRoot, "state.db");
  const database = AuthorityDatabase.open({ path, busyTimeoutMs: 250, migrationOwner: "dry-run-admission-test" }, clock);
  databases.push(database);
  const file = { read: () => readSettings(database.authority) };
  const credentials = createCredentialStore({ stateRoot: join(root, rebuildRuntimeIsolation.stateRoot) });
  const ids = sequentialIdFactory("b");
  const unused = (): never => { throw new Error("Settings setup reached an unrelated kernel arm"); };
  const kernel = createCommandKernel({
    lifecycle: new RunRecordService({ database: database, clock: clock, ids: sequentialIdFactory("e"), publishQueued: () => {} }),
    authority: { withAuthorityTransaction: (work) => database.withAuthorityTransaction(work) },
    clock, ids, appVersion: "0.1.0",
    configIdentity: UNSTORED_CONFIG_IDENTITY,
    descriptors: { resolve: unused },
    archiveSnapshots: UNWIRED_ARCHIVE_SNAPSHOTS,
    intakeParser: UNWIRED_INTAKE_PARSER,
    intakeProjections: NO_INTAKE_PROJECTIONS,
    writeResolution: { resolvePresent: unused, resolveAbsent: unused },
    workerRuntime: { planWorkerCount: unused, spawnWorker: unused, refreshBrowser: unused, reopenBrowser: unused },
    settings: createSettingsApplicationExecutor((settings) => { resolveConfigWithProvenance(settings, hostConfigFacts(env), clock); }, credentials),
  });
  return {
    database, file, path,
    apply: (patch: unknown) => {
      const operations = settingsSetOperations(patch);
      const commandId = ids.uuid();
      const result = kernel.execute({
        commandId, requestedAt: clock.now().toISOString(), requestedBy: "local-operator", source: "dashboard",
        family: "settings", type: "apply-settings", target: { expectedRevision: file.read().revision },
        payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveSettingsPatchFingerprint(operations), patch: operations },
      });
      assert.equal(result.state, "applied");
      assert.equal(database.authority.commands.get(commandId)?.family, "settings");
      assert.equal(database.authority.commandAudits.findByCommand(commandId)?.result.state, "applied");
      assert.equal(database.authority.settingsCurrent.get()?.commandId, commandId);
      return database.withAuthorityTransaction((repositories) => readSettings(repositories));
    },
    activate: () => database.withAuthorityTransaction((repositories) => {
      const record = readSettings(repositories);
      const resolved = resolveConfigWithProvenance(record.settings, hostConfigFacts(env), clock);
      const configSnapshotId = ids.uuid();
      // The existing dashboard activation contract, not an alternate runtime writer.
      const snapshot = repositories.configSnapshots.insert({
        configSnapshotId, revision: 1, fingerprint: resolved.fingerprint,
        capturedAt: clock.now().toISOString(), capturedBy: "local-operator",
        config: resolved.config, provenance: resolved.provenance,
      });
      assert.equal(snapshot.state, "inserted");
      const active = repositories.runtimeConfig.activate({
        settingsRevision: record.revision, settingsFingerprint: record.settingsFingerprint,
        configSnapshotId, configFingerprint: resolved.fingerprint, activatedAt: clock.now().toISOString(),
      });
      return { active, snapshot: repositories.configSnapshots.get(configSnapshotId) };
    }),
  };
}

export function startEffects(path: string) {
  const raw = new DatabaseSync(path, { readOnly: true });
  try {
    // These repositories deliberately have no general list API. Compare complete
    // rows on a read-only test connection, in addition to public exact-id reads.
    return ["start_plans", "workflow_runs", "workflow_run_batches", "commands", "command_audits", "config_snapshots"]
      .map((table) => ({ table, rows: raw.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all() }));
  } finally {
    raw.close();
  }
}
