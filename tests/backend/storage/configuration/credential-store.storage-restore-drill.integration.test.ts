import { createTimelineEmitter } from "../../../../src/backend/storage/events/timeline-emitter.js";
import { ATOMIC_WRITE_COMMIT as HISTORICAL_COMMIT } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { seedAtomicWriteOwner } from "../../../support/helpers/timeline-write-fixture.js";

import assert from "node:assert/strict";
import {
mkdirSync,
mkdtempSync,
readFileSync,
readdirSync,
realpathSync,
rmSync,
statSync,
writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach,describe,it } from "vitest";
import { z } from "zod";
import {
composeStorageCommand as composeNativeStorageCommand
} from "../../../../src/backend/app/composition/storage-compose.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import type { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { createCredentialStore } from "../../../../src/backend/storage/configuration/credential-store.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { AuthorityBackupService } from "../../../../src/backend/storage/sqlite/backup-service.js";
import {
PROTECTED_SETTINGS_SCHEMA_HASH,
ProtectedSettingsApplyInputSchema,
} from "../../../../src/models/config/protected-settings.js";
import { localDatePart,manualClock } from "../../../../src/rules/time/clock.js";
import {
COMMAND_FIXTURES,
NOTIFICATION,
NOW,
WRITE_ATTEMPT,
WRITE_INTENT_ATTEMPTING,
} from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { makeWorld } from "../../../support/helpers/backend/dashboard-harness.js";
import { sqliteRunReader } from "../../../support/helpers/canonical-run-reader.js";

const CLOCK = manualClock(new Date(NOW));
const CommandIdentitySchema = z.object({ commandId: z.string().min(1) });
const roots: string[] = [];
const admissions = new Map<string,RuntimeAdmission>();
async function composeStorageCommand(isolation:typeof rebuildRuntimeIsolation,args:readonly string[],clock:typeof CLOCK,repoRoot:string){const admission=admissions.get(repoRoot);assert.ok(admission);return composeNativeStorageCommand(isolation,args,clock,repoRoot,admission);}

afterEach(() => {
  for(const admission of admissions.values())admission.release();admissions.clear();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

interface DrillPaths {
  readonly repoRoot: string;
  readonly admission: RuntimeAdmission;
  readonly stateRoot: string;
  readonly authorityPath: string;
  readonly backupDirectory: string;
  readonly processLockRoot: string;
}

function drillPaths(): DrillPaths {
  const repoRoot = mkdtempSync(join(realpathSync(tmpdir()), "native-restore-drill-"));
  roots.push(repoRoot);
  const admission=acquireEntrypointAdmission(repoRoot,"exclusive");admissions.set(repoRoot,admission);
  const stateRoot = admission.stateRoot;
  mkdirSync(stateRoot, { recursive: true });
  // The command reads the running build's version out of its repo root, the
  // same way the dashboard composition does; the drill's root is a repo root.
  writeFileSync(join(repoRoot, "package.json"), JSON.stringify({ name: "drill", version: "0.1.0" }));
  return {
    repoRoot,
    admission,
    stateRoot,
    authorityPath: join(stateRoot, "state.db"),
    backupDirectory: join(stateRoot, "backups", "authority"),
    processLockRoot: join(repoRoot, rebuildRuntimeIsolation.processLockRoot),
  };
}

function open(paths: DrillPaths): AuthorityDatabase {
  return AuthorityDatabase.open(paths.admission,
    { path: paths.authorityPath, busyTimeoutMs: 250, migrationOwner: "restore-drill" },
    CLOCK,
  );
}

/** `COMMAND_FIXTURES` is a `readonly unknown[]`, so its id is read by schema. */
function seededCommandId(): string {
  return CommandIdentitySchema.parse(COMMAND_FIXTURES[0]).commandId;
}


function seedRealShapedAuthority(database: AuthorityDatabase, paths:DrillPaths): Readonly<{
  claimGeneration: number;
  runId: string;
}> {
  database.authority.commands.insert(COMMAND_FIXTURES[0]);
  seedAtomicWriteOwner(database,HISTORICAL_COMMIT,paths.authorityPath);
  const run=database.authority.runs.get(WRITE_INTENT_ATTEMPTING.runId);assert.ok(run);
  const claimGeneration=run.claimGeneration;
  const fenced = database.authority.writeIntents.fenceAttempt({
    intent: WRITE_INTENT_ATTEMPTING,
    attempt: WRITE_ATTEMPT,
  });
  assert.equal(fenced.state, "fenced");
  return { claimGeneration, runId: String(WRITE_INTENT_ATTEMPTING.runId) };
}

async function takeBackup(database: AuthorityDatabase, paths: DrillPaths): Promise<string> {
  const service = new AuthorityBackupService(paths.admission,database, { directory: paths.backupDirectory }, CLOCK);
  const report = await service.request({
    trigger: "operator",
    requiredGeneration: database.getMeta().authorityGeneration,
  });
  const manifest = report.manifests.at(-1);
  assert.ok(manifest !== undefined, "the backup run produced no manifest");
  return join(paths.backupDirectory, `${manifest.backupFileName}.manifest.json`);
}


function corrupt(paths: DrillPaths): void {
  const bytes = readFileSync(paths.authorityPath);
  bytes.fill(0x5a, 4096, Math.min(bytes.length, 40_960));
  writeFileSync(paths.authorityPath, bytes);
}

describe("corruption → degraded → restore → rebuild, through the CLI", () => {

  it("names the corruption read-only, restores the named backup, and keeps every authority family", async () => {
    const paths = drillPaths();
    const credentialDirectory = join(paths.stateRoot, "credentials");
    const credentialPath = join(credentialDirectory, "protected.json");
    const credentialOutcome = createCredentialStore({ admission:paths.admission,stateRoot: paths.stateRoot }).apply(
      ProtectedSettingsApplyInputSchema.parse({
        commandId: "a7111111-1111-4111-8111-111111111111",
        commandFingerprint: "1".repeat(64),
        expectedRevision: 1,
        protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH,
        writeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        entries: { ucpathPassword: { set: "restore-independent-credential-canary" } },
        updatedAt: NOW,
      }),
    );
    assert.equal(credentialOutcome.state, "applied");
    const credentialBytes = readFileSync(credentialPath);
    const credentialStats = statSync(credentialPath);
    const database = open(paths);
    const seeded = seedRealShapedAuthority(database,paths);
    createTimelineEmitter({ repository: database.authority.timelineEvents, clock: CLOCK, pid: 4242 }).emit({
      t: "span.started", kind: "worker", workflow: "person-lookup", ts: NOW,
      workerId: "restored-worker", spanPath: "worker/restored-worker", name: "Restored worker" });
    const retainedTimeline = database.authority.timelineEvents.page({});
    const generation = database.getMeta().authorityGeneration;
    const manifestPath = await takeBackup(database, paths);

    database.authority.notifications.create(NOTIFICATION);
    database.close();
    const before = readFileSync(paths.authorityPath);

    corrupt(paths);

    // 1 — the doctor degrades READ-ONLY and names the corruption.
    const degraded = await composeStorageCommand(
      rebuildRuntimeIsolation,
      ["doctor", "--json"],
      CLOCK,
      paths.repoRoot,
    );
    assert.equal(degraded.exitCode, 1);
    const report: unknown = JSON.parse(degraded.output);
    assert.equal(Reflect.get(report as object, "mode"), "read-only");
    const authority = Reflect.get(report as object, "authority") as Record<string, unknown>;
    assert.equal(authority["state"], "degraded");
    const cause = authority["cause"] as Record<string, unknown>;
    assert.equal(cause["code"], "authority-corrupt");

    assert.equal(
      readFileSync(paths.authorityPath).equals(before),
      false,
      "the corruption itself must have changed the file",
    );
    const afterDoctor = readFileSync(paths.authorityPath);

    // 2 — the restore, through the operator's command, naming ONE manifest.
    const restored = await composeStorageCommand(
      rebuildRuntimeIsolation,
      ["restore", "--from", manifestPath],
      CLOCK,
      paths.repoRoot,
    );
    assert.equal(restored.exitCode, 0, restored.output);
    assert.match(restored.output, /authority restore — restored/u);
    assert.match(restored.output, /projections rebuilt: true/u);

    // 3 — the suspect database is preserved, byte-identical to what the
    // doctor saw. It is evidence, not garbage.
    const quarantined = readdirSync(join(paths.stateRoot, "backups", "suspects"));
    const suspects = quarantined.filter((name) => name.endsWith(".sqlite"));
    assert.equal(suspects.length, 1, quarantined.join(","));
    assert.equal(
      readFileSync(join(paths.stateRoot, "backups", "suspects", suspects[0] ?? "")).equals(afterDoctor),
      true,
    );

    // 4 — every family the exit criterion names survived.
    const reopened = open(paths);
    try {
      assert.deepEqual(reopened.authority.timelineEvents.page({}), retainedTimeline);
      assert.deepEqual(reopened.authority.commands.get(seededCommandId()), COMMAND_FIXTURES[0]);
      const run = reopened.authority.runs.get(seeded.runId);
      assert.ok(run !== undefined);
      assert.equal(run.claimGeneration, seeded.claimGeneration);
      assert.equal(run.lifecycle.state, "claimed");
      assert.deepEqual(
        reopened.authority.writeIntents.get(WRITE_INTENT_ATTEMPTING.writeIntentId),
        WRITE_INTENT_ATTEMPTING,
      );
      assert.equal(reopened.getMeta().authorityGeneration, generation);
      const world = makeWorld({ reader: sqliteRunReader(reopened, CLOCK) });
      try {
        assert.equal(world.projection.runFold(seeded.runId), undefined);
        assert.equal(world.projection.queueSurface(seeded.runId)?.status, "running",
          "restored canonical authority renders without replaying execution spans or writes");
        const day = world.projection.buildDashboardDayWire(localDatePart(new Date(run.envelope.enqueuedAt)));
        assert.equal(day.queueSurfaces.find((row) => row.runId === seeded.runId)?.status, "running");
        assert.deepEqual(day.statusCounts, [{ status: "running", count: 1 }]);
        world.projection.reconcileWorkerAuthority();
        assert.equal(world.changes.length, 0, "an unchanged restored authority must not churn snapshots");
        assert.equal(reopened.getMeta().authorityGeneration, generation);
        assert.deepEqual(reopened.authority.writeIntents.get(WRITE_INTENT_ATTEMPTING.writeIntentId),
          WRITE_INTENT_ATTEMPTING);
      } finally {
        world.dispose();
      }
      // The post-backup row is gone — the restore restored the BACKUP, not a merge.
      assert.equal(reopened.authority.notifications.get(NOTIFICATION.notificationId), undefined);
    } finally {
      reopened.close();
    }

    // 5 — the doctor now reports a healthy authority over the restored file.
    const healthy = await composeStorageCommand(
      rebuildRuntimeIsolation,
      ["doctor", "--json"],
      CLOCK,
      paths.repoRoot,
    );
    const healthyReport: unknown = JSON.parse(healthy.output);
    const healthyAuthority = Reflect.get(healthyReport as object, "authority") as Record<string, unknown>;
    assert.equal(healthyAuthority["state"], "healthy");
    assert.equal(readFileSync(credentialPath).equals(credentialBytes), true);
    const afterCredentialStats = statSync(credentialPath);
    assert.deepEqual({
      mode: afterCredentialStats.mode,
      uid: afterCredentialStats.uid,
      ino: afterCredentialStats.ino,
      size: afterCredentialStats.size,
      mtimeMs: afterCredentialStats.mtimeMs,
      ctimeMs: afterCredentialStats.ctimeMs,
    }, {
      mode: credentialStats.mode,
      uid: credentialStats.uid,
      ino: credentialStats.ino,
      size: credentialStats.size,
      mtimeMs: credentialStats.mtimeMs,
      ctimeMs: credentialStats.ctimeMs,
    });
  });
});
