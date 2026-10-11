import assert_m0 from "node:assert/strict";
import { randomUUID as randomUUID_m0 } from "node:crypto";
import { mkdirSync as mkdirSync_m0,mkdtempSync as mkdtempSync_m0,realpathSync as realpathSync_m0,rmSync as rmSync_m0,writeFileSync as writeFileSync_m0 } from "node:fs";
import { tmpdir as tmpdir_m0 } from "node:os";
import { join as join_m0 } from "node:path";
import { afterEach as afterEach_m0,describe as describe_m0,it as it_m0 } from "vitest";
import { resolveConfigWithProvenance as resolveConfigWithProvenance_m0 } from "../../../src/backend/app/config/resolve.js";
import { rebuildRuntimeIsolation as rebuildRuntimeIsolation_m0 } from "../../../src/backend/app/config/runtime-isolation.js";
import { executeSettingsCommand as executeSettingsCommand_m0,type CommandAuthority as CommandAuthority_m0 } from "../../../src/backend/runs/commands/command-kernel.js";
import { createSettingsApplicationExecutor as createSettingsApplicationExecutor_m0 } from "../../../src/backend/runs/commands/settings-service.js";
import type { RuntimeAdmission as RuntimeAdmission_m0 } from "../../../src/backend/storage/admission/admission.js";
import { acquireEntrypointAdmission as acquireEntrypointAdmission_m0 } from "../../../src/backend/storage/admission/bootstrap-admission.js";
import { createCredentialStore as nativeCredentialStore_m0 } from "../../../src/backend/storage/configuration/credential-store.js";
import { AuthorityDatabase as NativeAuthorityDatabase_m0 } from "../../../src/backend/storage/sqlite/authority-database.js";
import { SETTINGS_SCHEMA_HASH as SETTINGS_SCHEMA_HASH_m0,deriveSettingsPatchFingerprint as deriveSettingsPatchFingerprint_m0 } from "../../../src/models/config/settings.js";
import { manualClock as manualClock_m0 } from "../../../src/rules/time/clock.js";
import { AuthorityDatabase as AuthorityDatabase_m0,createCredentialStore as createCredentialStore_m0,type CredentialStoreHooks as CredentialStoreHooks_m0 } from "../../support/helpers/synthetic-storage-admission.js";

import { randomUUID as randomUUID_m1 } from "node:crypto";
import { admitDirectWorker as admitDirectWorker_m1 } from "../../../src/backend/storage/sqlite/worker-slots.js";
import { derivePersistedSettingsFingerprint as derivePersistedSettingsFingerprint_m1 } from "../../../src/models/config/settings.js";
import { seedSyntheticRuntimeConfig as seedSyntheticRuntimeConfig_m0 } from "../../support/fixtures/operator-command-fixtures.js";

import assert_m1 from "node:assert/strict";
import { mkdtempSync as mkdtempSync_m1,realpathSync as realpathSync_m1,rmSync as rmSync_m1 } from "node:fs";
import { tmpdir as tmpdir_m1 } from "node:os";
import { join as join_m1 } from "node:path";
import { afterEach as afterEach_m1,describe as describe_m1,it as it_m1 } from "vitest";
import {
CommandRequestSchema as CommandRequestSchema_m1,
deriveSettingsCommandFingerprint as deriveSettingsCommandFingerprint_m1
} from "../../../src/rules/commands/commands.js";
import { manualClock as manualClock_m1 } from "../../../src/rules/time/clock.js";
import {
COMMAND_FIXTURES as COMMAND_FIXTURES_m1,
CONFIG_SNAPSHOT as CONFIG_SNAPSHOT_m1,
HASH_A as HASH_A_m1,
NOW as NOW_m1,
UUID_8 as UUID_8_m1
} from "../../support/fixtures/phase1c-contract-fixtures.js";
import {
WORKER_START_REQUEST as BASE_WORKER_START_REQUEST_m1,
QUEUED_RUN as QUEUED_RUN_m1,
RUN_ENVELOPE as RUN_ENVELOPE_m1,
RUN_ID as RUN_ID_m1,
WORKFLOW_ID as WORKFLOW_ID_m1
} from "../../support/fixtures/phase1f-run-fixtures.js";
import { AuthorityDatabase as AuthorityDatabase_m1 } from "../../support/helpers/synthetic-storage-admission.js";


{


const roots: string[] = [];
const databases: AuthorityDatabase_m0[] = [];
const admissions: RuntimeAdmission_m0[] = [];
const _afterEachFixture0 = () => { for (const database of databases.splice(0)) database.close(); for (const admission of admissions.splice(0)) admission.release(); for (const root of roots.splice(0)) rmSync_m0(root, { recursive: true, force: true }); };
function fixture(hooks?: CredentialStoreHooks_m0, exclusive = false) {
  const repoRoot = mkdtempSync_m0(join_m0(realpathSync_m0(tmpdir_m0()), "sqlite-settings-")); roots.push(repoRoot);
  const admission = exclusive ? acquireEntrypointAdmission_m0(repoRoot, "exclusive") : undefined;
  if (admission !== undefined) admissions.push(admission);
  const root = join_m0(repoRoot, rebuildRuntimeIsolation_m0.stateRoot); mkdirSync_m0(root, { recursive: true, mode: 0o700 });
  writeFileSync_m0(join_m0(repoRoot, "package.json"), JSON.stringify({ name: "credential-restore-proof", version: "0.1.0" }));
  const clock = manualClock_m0(new Date("2026-09-06T12:00:00Z"));
  const path = join_m0(root, "state.db");
  const options = { path, busyTimeoutMs: 250, migrationOwner: "settings-test" };
  const database = admission === undefined ? AuthorityDatabase_m0.open(options, clock) : NativeAuthorityDatabase_m0.open(admission, options, clock); databases.push(database);
  seedSyntheticRuntimeConfig_m0(database);
  const credentialOptions = { stateRoot: root, ...(hooks === undefined ? {} : { hooks }) };
  const store = admission === undefined ? createCredentialStore_m0(credentialOptions) : nativeCredentialStore_m0({ ...credentialOptions, admission });
  const settings = createSettingsApplicationExecutor_m0((value) => resolveConfigWithProvenance_m0(value, { primaryDisplay: null }, clock), store);
  const execute = (request: unknown, authority: CommandAuthority_m0 = database) => executeSettingsCommand_m0({ authority, clock, ids: { uuid: randomUUID_m0 }, settings }, request);
  return { repoRoot, root, path, database, store, execute, clock, admission };
}
function ordinary(expectedRevision = 1) {
  const patch = { "concurrency.defaultWorkers": { set: 3 } };
  return { family: "settings", type: "apply-settings", commandId: randomUUID_m0(), requestedAt: "2026-09-06T12:00:00.000Z", requestedBy: "local-operator", source: "settings-surface",
    target: { expectedRevision }, payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH_m0, patchFingerprint: deriveSettingsPatchFingerprint_m0(patch), patch } };
}

describe_m0("SQLite settings authority", () => {
afterEach_m0(_afterEachFixture0);

  it_m0("replays an older ordinary result from its journal and refuses divergent identity reuse", () => {
    const f = fixture(); const first = ordinary();
    const applied = f.execute(first);
    assert_m0.equal(applied.state, "applied");
    assert_m0.equal(f.execute(ordinary(2)).state, "applied");
    const current = f.database.authority.settingsCurrent.get();
    const generation = f.database.getMeta().authorityGeneration;
    assert_m0.deepEqual(f.execute(first), { ...applied, state: "already-applied" });
    const changed = structuredClone(first);
    changed.payload.patch["concurrency.defaultWorkers"].set = 4;
    changed.payload.patchFingerprint = deriveSettingsPatchFingerprint_m0(changed.payload.patch);
    const refused = f.execute(changed);
    assert_m0.equal(refused.state, "rejected");
    if (refused.state === "rejected") assert_m0.equal(refused.code, "command-divergent");
    assert_m0.deepEqual(f.database.authority.settingsCurrent.get(), current);
    assert_m0.equal(f.database.getMeta().authorityGeneration, generation);
  });
});
}

{


const WORKER_ID = `${WORKFLOW_ID_m1}-worker-1`;
const WORKER_START_REQUEST = { ...BASE_WORKER_START_REQUEST_m1, workerId: WORKER_ID };
const CLOCK = manualClock_m1(new Date(NOW_m1));
const roots: string[] = [];
const databases: AuthorityDatabase_m1[] = [];

const LATER = "2026-07-31T17:05:00.000Z";

function openDatabase(): AuthorityDatabase_m1 {
  const root = mkdtempSync_m1(join_m1(realpathSync_m1(tmpdir_m1()), "hrauto-rebuild-runs-"));
  roots.push(root);
  const database = AuthorityDatabase_m1.open(
    { path: join_m1(root, "state.sqlite"), busyTimeoutMs: 250, migrationOwner: "unit-test" },
    CLOCK,
  );
  database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT_m1);
  for (const poolIndex of [1, 2]) database.withAuthorityTransaction(repositories => {
    admitDirectWorker_m1(repositories, { commandId: randomUUID_m1(), workflow: WORKFLOW_ID_m1, poolIndex,
      expectedPoolVersion: repositories.workerPools.get(WORKFLOW_ID_m1)?.version ?? 0, processId: WORKER_START_REQUEST.processId,
      processAcquisitionId: randomUUID_m1(), authorityPath: join_m1(root, "state.sqlite"), processLockRoot: join_m1(root, "locks"), now: NOW_m1 }, randomUUID_m1());
  });
  databases.push(database);
  return database;
}

const _afterEachFixture0 = () => {
  while (databases.length > 0) databases.pop()?.close();
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) rmSync_m1(root, { recursive: true, force: true });
  }
};

describe_m1("run claim store", () => {
afterEach_m1(_afterEachFixture0);

  it_m1("atomically refuses a claim after settings advance beyond the active runtime", () => {
    const database = openDatabase();
    const snapshot = {
      ...CONFIG_SNAPSHOT_m1,
      configSnapshotId: RUN_ENVELOPE_m1.configSnapshotId,
      fingerprint: RUN_ENVELOPE_m1.configFingerprint,
    };
    database.authority.configSnapshots.insert(snapshot);
    const active = database.authority.runtimeConfig.activate({
      settingsRevision: 1,
      settingsFingerprint: HASH_A_m1,
      configSnapshotId: snapshot.configSnapshotId,
      configFingerprint: snapshot.fingerprint,
      activatedAt: NOW_m1,
    });
    database.authority.runs.enqueue(QUEUED_RUN_m1);
    const settingsCommand = CommandRequestSchema_m1.parse(COMMAND_FIXTURES_m1[14]);
    if (settingsCommand.family !== "settings") throw new Error("settings fixture is not apply-settings");
    database.authority.commands.insert(settingsCommand);
    database.authority.commandAudits.insert({
      auditId: UUID_8_m1,
      request: settingsCommand,
      result: {
        state: "applied",
        commandId: settingsCommand.commandId,
        affectedTargets: [{ family: "settings", revision: 2 }],
        restartRequired: true,
        settingsRevision: 2,
        settingsFingerprint: derivePersistedSettingsFingerprint_m1({}),
      },
      completedAt: NOW_m1,
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
      settingsFingerprint: derivePersistedSettingsFingerprint_m1({}),
      commandId: settingsCommand.commandId,
      commandFingerprint: deriveSettingsCommandFingerprint_m1(settingsCommand),
      auditId: UUID_8_m1,
      committedAt: NOW_m1,
    });

    assert_m1.throws(
      () => database.authority.runs.claimNext({
        workflow: WORKFLOW_ID_m1,
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
    assert_m1.equal(database.authority.runs.get(RUN_ID_m1)?.lifecycle.state, "queued");
  });
});
}
