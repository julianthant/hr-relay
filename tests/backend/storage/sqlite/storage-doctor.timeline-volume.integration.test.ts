import assert from "node:assert/strict";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, afterEach, describe, it } from "vitest";
import { createTimelineEmitter } from "../../../../src/backend/storage/events/timeline-emitter.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { CONFIG_SNAPSHOT, NOW, UUID_1, UUID_4 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { createProfileFixtureSet, type BoundProfileStorageFixture } from "../../../support/helpers/admission-fixture.js";
import { AuthorityDatabase, doctorAuthorityStorage } from "../../../support/helpers/synthetic-storage-admission.js";

const profiles = createProfileFixtureSet();
const heldProfiles: BoundProfileStorageFixture[] = [];
afterAll(() => profiles.close());
afterEach(async () => {
  for (const profile of heldProfiles.splice(0)) await profile.close();
});
const clock = manualClock(new Date(NOW));
const OLD_WHOLE_TIMELINE_BYTES = 16 * 1024 * 1024;

const run = RunRecordSchema.parse({
  ...QUEUED_RUN,
  envelope: {
    ...QUEUED_RUN.envelope,
    runId: UUID_1, itemId: UUID_4, traceId: "pl-120000-0000", priority: "interactive", dryRun: true,
    resolvedInstance: { ucpath: "prod" }, configSnapshotId: CONFIG_SNAPSHOT.configSnapshotId, configFingerprint: CONFIG_SNAPSHOT.fingerprint,
  },
});

function rootEvent() {
  const e = run.envelope;
  return {
    t: "run.queued", kind: "run", ts: e.enqueuedAt, workflow: e.workflow,
    runId: e.runId, attempt: e.attempt, traceId: e.traceId, spanPath: e.traceId,
    itemId: e.itemId, shape: e.shape, priority: e.priority, dryRun: e.dryRun,
    actorId: "local-operator", title: "Redacted test run",
    descriptorVersion: e.descriptorVersion, contractFingerprint: e.contractFingerprint,
    resolvedInstance: e.resolvedInstance, configFingerprint: e.configFingerprint,
    configSnapshotId: e.configSnapshotId,
  };
}

async function storeWithOneRun() {
  const profile = await profiles.create(); heldProfiles.push(profile);
  const root = profile.stateRoot, authorityPath = profile.path;
  const database = AuthorityDatabase.open({ path: authorityPath, busyTimeoutMs: 500, migrationOwner: "timeline-volume-test" }, clock);
  try {
    database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
    database.authority.runs.enqueue(run);
    createTimelineEmitter({ repository: database.authority.timelineEvents, clock, pid: 4242 }).emit(rootEvent());
  } finally {
    database.close();
  }
  return {
    authorityPath,
    read: async () => (await doctorAuthorityStorage({
      stateRootTrustAnchor: root, stateRoot: root, authorityPath,
      backupDirectory: join(root, "backups", "authority"), busyTimeoutMs: 500,
    }, clock)).spanAuthority,
  };
}

/** Rows a long-lived store accumulates within ordinary retention, written offline in bulk. */
function appendOffline(authorityPath: string, insert: (raw: DatabaseSync) => void): number {
  const raw = new DatabaseSync(authorityPath);
  try {
    raw.exec("BEGIN IMMEDIATE");
    insert(raw);
    raw.exec("COMMIT");
    const total = raw.prepare("SELECT sum(length(CAST(payload_json AS BLOB))) AS bytes FROM timeline_events").get();
    raw.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    return Number(total?.bytes);
  } finally { raw.close(); }
}

describe("storage doctor span authority on a long-lived timeline", () => {
  it("reconciles span authority beside more than 16 MiB of diagnostic and note rows", async () => {
    const store = await storeWithOneRun();
    const padding = "x".repeat(200_000);
    const bytes = appendOffline(store.authorityPath, (raw) => {
      for (const kind of ["debug", "note"]) {
        raw.exec(`WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n < 45)
          INSERT INTO timeline_events
          (id,workflow,run_id,worker_id,kind,occurred_at,recorded_at,retention_date,retention_class,payload_json)
          SELECT lower(hex(randomblob(16))),NULL,NULL,NULL,'${kind}','${NOW}','${NOW}','2026-07-31','ordinary',
            json_object('padding','${padding}') FROM seq`);
      }
    });
    assert.ok(bytes > OLD_WHOLE_TIMELINE_BYTES);
    assert.deepEqual(await store.read(), { state: "reconciled", streamRunCount: 1, liveRunCount: 1, deleted: [] });
  });

  it("inspects more than 16 MiB of span rows instead of refusing the corpus", async () => {
    const store = await storeWithOneRun();
    const bytes = appendOffline(store.authorityPath, (raw) => {
      const source = raw.prepare("SELECT * FROM timeline_events WHERE kind='run.queued'").get() as Record<string, string | number>;
      const insert = raw.prepare(`INSERT INTO timeline_events
        (cursor,id,workflow,run_id,worker_id,kind,occurred_at,recorded_at,retention_date,retention_class,payload_json)
        VALUES (?,?,?,?,?,?,?,?,?,?,json_set(?,'$.cursor',?,'$.eventId',?))`);
      const base = Number(source.cursor);
      for (let n = 1; n * 1000 < OLD_WHOLE_TIMELINE_BYTES + 1_000_000; n += 1) {
        const id = `${n.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`;
        insert.run(base + n, id, source.workflow, source.run_id, source.worker_id, source.kind, source.occurred_at,
          source.recorded_at, source.retention_date, source.retention_class, source.payload_json, base + n, id);
      }
    });
    assert.ok(bytes > OLD_WHOLE_TIMELINE_BYTES);
    const report = await store.read();
    assert.notEqual(report.state, "unavailable", JSON.stringify(report));
  });
});
