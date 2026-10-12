import { default as assert } from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { realpathSync } from "node:fs";
import { rmSync } from "node:fs";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";
import { describe } from "vitest";
import { it } from "vitest";
import { resolveConfigWithProvenance } from "../../../src/backend/app/config/resolve.js";
import { rebuildRuntimeIsolation } from "../../../src/backend/app/config/runtime-isolation.js";
import { executeSettingsCommand } from "../../../src/backend/runs/commands/command-kernel.js";
import type { CommandAuthority } from "../../../src/backend/runs/commands/command-kernel.js";
import { createSettingsApplicationExecutor } from "../../../src/backend/runs/commands/settings-service.js";
import type { RuntimeAdmission } from "../../../src/backend/storage/admission/admission.js";
import { acquireEntrypointAdmission } from "../../../src/backend/storage/admission/bootstrap-admission.js";
import { createCredentialStore as nativeCredentialStore } from "../../../src/backend/storage/configuration/credential-store.js";
import { AuthorityDatabase as NativeAuthorityDatabase } from "../../../src/backend/storage/sqlite/authority-database.js";
import { SETTINGS_SCHEMA_HASH } from "../../../src/models/config/settings.js";
import { deriveSettingsPatchFingerprint } from "../../../src/models/config/settings.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { AuthorityDatabase } from "../../support/helpers/synthetic-storage-admission.js";
import { createCredentialStore } from "../../support/helpers/synthetic-storage-admission.js";
import type { CredentialStoreHooks } from "../../support/helpers/synthetic-storage-admission.js";
import { admitDirectWorker } from "../../../src/backend/storage/sqlite/worker-slots.js";
import { derivePersistedSettingsFingerprint } from "../../../src/models/config/settings.js";
import { seedSyntheticRuntimeConfig } from "../../support/fixtures/operator-command-fixtures.js";
import { CommandRequestSchema } from "../../../src/rules/commands/commands.js";
import { deriveSettingsCommandFingerprint } from "../../../src/rules/commands/commands.js";
import { COMMAND_FIXTURES } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { CONFIG_SNAPSHOT } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { HASH_A } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { NOW } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { UUID_8 } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { WORKER_START_REQUEST as BASE_WORKER_START_REQUEST } from "../../support/fixtures/phase1f-run-fixtures.js";
import { QUEUED_RUN } from "../../support/fixtures/phase1f-run-fixtures.js";
import { RUN_ENVELOPE } from "../../support/fixtures/phase1f-run-fixtures.js";
import { RUN_ID } from "../../support/fixtures/phase1f-run-fixtures.js";
import { WORKFLOW_ID } from "../../support/fixtures/phase1f-run-fixtures.js";

{

const roots: string[] = [];
const databases: AuthorityDatabase[] = [];
const admissions: RuntimeAdmission[] = [];
const _afterEachFixture0 = () => { for (const database of databases.splice(0)) database.close(); for (const admission of admissions.splice(0)) admission.release(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); };
function fixture(hooks?: CredentialStoreHooks, exclusive = false) {
  const repoRoot = mkdtempSync(join(realpathSync(tmpdir()), "sqlite-settings-")); roots.push(repoRoot);
  const admission = exclusive ? acquireEntrypointAdmission(repoRoot, "exclusive") : undefined;
  if (admission !== undefined) admissions.push(admission);
  const root = join(repoRoot, rebuildRuntimeIsolation.stateRoot); mkdirSync(root, { recursive: true, mode: 0o700 });
  writeFileSync(join(repoRoot, "package.json"), JSON.stringify({ name: "credential-restore-proof", version: "0.1.0" }));
  const clock = manualClock(new Date("2026-09-06T12:00:00Z"));
  const path = join(root, "state.db");
  const options = { path, busyTimeoutMs: 250, migrationOwner: "settings-test" };
  const database = admission === undefined ? AuthorityDatabase.open(options, clock) : NativeAuthorityDatabase.open(admission, options, clock); databases.push(database);
  seedSyntheticRuntimeConfig(database);
  const credentialOptions = { stateRoot: root, ...(hooks === undefined ? {} : { hooks }) };
  const store = admission === undefined ? createCredentialStore(credentialOptions) : nativeCredentialStore({ ...credentialOptions, admission });
  const settings = createSettingsApplicationExecutor((value) => resolveConfigWithProvenance(value, { primaryDisplay: null }, clock), store);
  const execute = (request: unknown, authority: CommandAuthority = database) => executeSettingsCommand({ authority, clock, ids: { uuid: randomUUID }, settings }, request);
  return { repoRoot, root, path, database, store, execute, clock, admission };
}
function ordinary(expectedRevision = 1) {
  const patch = { "concurrency.defaultWorkers": { set: 3 } };
  return { family: "settings", type: "apply-settings", commandId: randomUUID(), requestedAt: "2026-09-06T12:00:00.000Z", requestedBy: "local-operator", source: "settings-surface",
    target: { expectedRevision }, payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveSettingsPatchFingerprint(patch), patch } };
}

describe("SQLite settings authority", () => {
afterEach(_afterEachFixture0);

  it("replays an older ordinary result from its journal and refuses divergent identity reuse", () => {
    const f = fixture(); const first = ordinary();
    const applied = f.execute(first);
    assert.equal(applied.state, "applied");
    assert.equal(f.execute(ordinary(2)).state, "applied");
    const current = f.database.authority.settingsCurrent.get();
    const generation = f.database.getMeta().authorityGeneration;
    assert.deepEqual(f.execute(first), { ...applied, state: "already-applied" });
    const changed = structuredClone(first);
    changed.payload.patch["concurrency.defaultWorkers"].set = 4;
    changed.payload.patchFingerprint = deriveSettingsPatchFingerprint(changed.payload.patch);
    const refused = f.execute(changed);
    assert.equal(refused.state, "rejected");
    if (refused.state === "rejected") assert.equal(refused.code, "command-divergent");
    assert.deepEqual(f.database.authority.settingsCurrent.get(), current);
    assert.equal(f.database.getMeta().authorityGeneration, generation);
  });
});
}

{

const WORKER_ID = `${WORKFLOW_ID}-worker-1`;
const WORKER_START_REQUEST = { ...BASE_WORKER_START_REQUEST, workerId: WORKER_ID };
const CLOCK = manualClock(new Date(NOW));
const roots: string[] = [];
const databases: AuthorityDatabase[] = [];

const LATER = "2026-07-31T17:05:00.000Z";

function openDatabase(): AuthorityDatabase {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "hrauto-rebuild-runs-"));
  roots.push(root);
  const database = AuthorityDatabase.open(
    { path: join(root, "state.sqlite"), busyTimeoutMs: 250, migrationOwner: "unit-test" },
    CLOCK,
  );
  database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
  for (const poolIndex of [1, 2]) database.withAuthorityTransaction(repositories => {
    admitDirectWorker(repositories, { commandId: randomUUID(), workflow: WORKFLOW_ID, poolIndex,
      expectedPoolVersion: repositories.workerPools.get(WORKFLOW_ID)?.version ?? 0, processId: WORKER_START_REQUEST.processId,
      processAcquisitionId: randomUUID(), authorityPath: join(root, "state.sqlite"), processLockRoot: join(root, "locks"), now: NOW }, randomUUID());
  });
  databases.push(database);
  return database;
}

const _afterEachFixture0 = () => {
  while (databases.length > 0) databases.pop()?.close();
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
};

describe("run claim store", () => {
afterEach(_afterEachFixture0);

  it("atomically refuses a claim after settings advance beyond the active runtime", () => {
    const database = openDatabase();
    const snapshot = {
      ...CONFIG_SNAPSHOT,
      configSnapshotId: RUN_ENVELOPE.configSnapshotId,
      fingerprint: RUN_ENVELOPE.configFingerprint,
    };
    database.authority.configSnapshots.insert(snapshot);
    const active = database.authority.runtimeConfig.activate({
      settingsRevision: 1,
      settingsFingerprint: HASH_A,
      configSnapshotId: snapshot.configSnapshotId,
      configFingerprint: snapshot.fingerprint,
      activatedAt: NOW,
    });
    database.authority.runs.enqueue(QUEUED_RUN);
    const settingsCommand = CommandRequestSchema.parse(COMMAND_FIXTURES[14]);
    if (settingsCommand.family !== "settings") throw new Error("settings fixture is not apply-settings");
    database.authority.commands.insert(settingsCommand);
    database.authority.commandAudits.insert({
      auditId: UUID_8,
      request: settingsCommand,
      result: {
        state: "applied",
        commandId: settingsCommand.commandId,
        affectedTargets: [{ family: "settings", revision: 2 }],
        restartRequired: true,
        settingsRevision: 2,
        settingsFingerprint: derivePersistedSettingsFingerprint({}),
      },
      completedAt: NOW,
      versionChanges: [{
        target: { family: "settings", revision: 2 },
        before: 1,
        after: 2,
      }],
      affectedDependencyIds: [],
    });
    database.authority.settingsCurrent.advance({
      settings: {},
      revision: 2,
      settingsFingerprint: derivePersistedSettingsFingerprint({}),
      commandId: settingsCommand.commandId,
      commandFingerprint: deriveSettingsCommandFingerprint(settingsCommand),
      auditId: UUID_8,
      committedAt: NOW,
    });

    assert.throws(
      () => database.authority.runs.claimNext({
        workflow: WORKFLOW_ID,
        workerId: WORKER_ID,
        now: LATER,
        configFingerprint: active.configFingerprint,
        runtimeConfig: {
          generation: active.generation,
          settingsRevision: active.settingsRevision,
          settingsFingerprint: active.settingsFingerprint,
          configFingerprint: active.configFingerprint,
        },
      }),
      /dashboard runtime settings are stale; restart activation is required/u,
    );
    assert.equal(database.authority.runs.get(RUN_ID)?.lifecycle.state, "queued");
  });
});
}
