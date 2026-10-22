import { createRunClaimFixtures } from "../../support/helpers/backend/run-claim-fixtures.js";
import { createSettingsAuthorityTestWorld } from "../../support/helpers/backend/settings-authority-world.js";
import { default as assert } from "node:assert/strict";
import { randomUUID } from "node:crypto";



import { rmSync } from "node:fs";



import { afterEach } from "vitest";
import { describe } from "vitest";
import { it } from "vitest";









import { SETTINGS_SCHEMA_HASH } from "../../../src/models/config/settings.js";
import { deriveSettingsPatchFingerprint } from "../../../src/models/config/settings.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { AuthorityDatabase } from "../../support/helpers/synthetic-storage-admission.js";



import { derivePersistedSettingsFingerprint } from "../../../src/models/config/settings.js";

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

const { fixture, cleanup } = createSettingsAuthorityTestWorld();


const _afterEachFixture0 = cleanup;

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

const { openDatabase } =
  createRunClaimFixtures(CLOCK, roots, databases, WORKER_START_REQUEST, WORKER_ID);

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
