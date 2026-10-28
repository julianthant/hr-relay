import { detachBoundFixtureWorkers } from "../../../support/helpers/synthetic-database-admission.js";
import { createStorageRestoreTestWorld } from "../../../support/helpers/backend/storage-restore-world.js";
import { createTimelineEmitter } from "../../../../src/backend/storage/events/timeline-emitter.js";
import assert from "node:assert/strict";
import {readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { z } from "zod";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH, ProtectedSettingsApplyInputSchema } from "../../../../src/models/config/protected-settings.js";
import { localDatePart } from "../../../../src/rules/time/clock.js";
import { COMMAND_FIXTURES, NOTIFICATION, NOW, WRITE_INTENT_ATTEMPTING } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { makeWorld } from "../../../support/helpers/backend/dashboard-harness.js";
import { sqliteRunReader } from "../../../support/helpers/canonical-run-reader.js";

const {CLOCK, composeStorageCommand, drillPaths, open, seedRealShapedAuthority, takeBackup, corrupt, cleanup } = createStorageRestoreTestWorld();

const CommandIdentitySchema = z.object({ commandId: z.string().min(1) });

afterEach(cleanup);

/** `COMMAND_FIXTURES` is a `readonly unknown[]`, so its id is read by schema. */
function seededCommandId(): string {
  return CommandIdentitySchema.parse(COMMAND_FIXTURES[0]).commandId;
}

describe("corruption → degraded → restore → rebuild, through the CLI", () => {

  it("names the corruption read-only, restores the named backup, and keeps every authority family", async () => {
    const paths = await drillPaths();
    const credentialDirectory = join(paths.stateRoot, "credentials");
    const credentialPath = join(credentialDirectory, "protected.json");
    const credentialOutcome = paths.credentials.apply(
      ProtectedSettingsApplyInputSchema.parse({
        commandId: "a7111111-1111-4111-8111-111111111111",
        commandFingerprint: "1".repeat(64),
        expectedRevision: paths.credentials.read().revision,
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
    detachBoundFixtureWorkers(database);
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

    const oldAdmission = paths.admission;
    paths.renewAfterRestore();
    assert.throws(() => oldAdmission.assertProfileRuntime());

    // 4 — every family the exit criterion names survived.
    const reopened = open(paths);
    try {
      assert.deepEqual(reopened.authority.timelineEvents.page({}), retainedTimeline);
      assert.deepEqual(reopened.authority.commands.get(seededCommandId()), COMMAND_FIXTURES[0]);
      const run = reopened.authority.runs.get(seeded.runId);
      assert.ok(run !== undefined);
      assert.equal(run.claimGeneration, seeded.claimGeneration);
      assert.equal(run.lifecycle.state, "running");
      assert.deepEqual(
        reopened.authority.writeIntents.get(WRITE_INTENT_ATTEMPTING.writeIntentId),
        WRITE_INTENT_ATTEMPTING,
      );
      assert.equal(reopened.getMeta().authorityGeneration, generation);
      const world = await makeWorld({ reader: sqliteRunReader(reopened, CLOCK) });
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
        await world.dispose();
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
