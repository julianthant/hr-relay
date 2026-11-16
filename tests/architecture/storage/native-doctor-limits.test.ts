import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { it } from "vitest";
import { createBoundProfileFixture } from "../../support/helpers/admission-fixture.js";
import { AuthorityDatabase } from "../../../src/backend/storage/sqlite/authority-database.js";
import { doctorAuthorityStorage } from "../../../src/backend/storage/sqlite/storage-doctor.js";
import { TimelineRecordError } from "../../../src/backend/storage/sqlite/timeline-repository.js";

const NOW = "2026-10-10T12:00:00.000Z";

it.each([
  { label: "records", count: 100_001, payloadBytes: 2, distinctRuns: false, code: "record" },
  { label: "total UTF-8 payload bytes", count: 65, payloadBytes: 260_000, distinctRuns: false, code: "payload" },
  { label: "one payload's UTF-8 bytes", count: 1, payloadBytes: 262_145, distinctRuns: false, code: "event" },
  { label: "distinct run-scope IDs", count: 10_001, payloadBytes: 2, distinctRuns: true, code: "run" },
])("refuses excess $label before parsing records and leaves authority unchanged", async (limit) => {
  const fixture = await createBoundProfileFixture(), { workspace, path, admission } = fixture;
  try {
    AuthorityDatabase.open(admission, { path, busyTimeoutMs: 250, migrationOwner: "native-doctor-limit" }).close();
    // Offline-corrupt rows exercise the metric refusal before strict record parsing.
    const raw = new DatabaseSync(path, { enableForeignKeyConstraints: false });
    try {
      raw.exec("BEGIN IMMEDIATE");
      const payload = limit.payloadBytes === 2 ? "{}" : JSON.stringify({ padding: "é".repeat(Math.ceil(limit.payloadBytes / 2)) });
      assert.ok(Buffer.byteLength(payload, "utf8") >= limit.payloadBytes);
      if (limit.code === "payload") assert.ok(Buffer.byteLength(payload, "utf8") < 256 * 1024);
      const sqlPayload = payload.replaceAll("'", "''");
      const runId = limit.distinctRuns ? "lower(hex(randomblob(16)))" : "NULL";
      const workerId = limit.distinctRuns ? "NULL" : "'doctor-limit-worker'";
      for (let remaining = limit.count; remaining > 0; remaining -= 400) {
        const rows = Math.min(400, remaining);
        raw.exec(`WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n < ${String(rows)})
          INSERT INTO timeline_events
          (id,workflow,run_id,worker_id,kind,occurred_at,recorded_at,retention_date,retention_class,payload_json)
          SELECT lower(hex(randomblob(16))),'person-lookup',${runId},${workerId},'debug','${NOW}','${NOW}','2026-10-10','ordinary','${sqlPayload}'
          FROM seq`);
      }
      raw.exec("COMMIT");
      assert.equal(raw.prepare("SELECT count(*) AS count FROM timeline_events").get()?.count, limit.count);
      raw.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } finally { raw.close(); }
    const before = readFileSync(path);
    assert.throws(() => AuthorityDatabase.inspectTimelineReadOnly(admission, path), (error: unknown) =>
      error instanceof TimelineRecordError && error.message.startsWith(`timeline-doctor-${limit.code}-limit-exceeded`));
    const report = await doctorAuthorityStorage(admission, { stateRootTrustAnchor: workspace,
      stateRoot: admission.stateRoot, authorityPath: path,
      backupDirectory: join(admission.stateRoot, "backups", "authority"), busyTimeoutMs: 250 });
    assert.equal(report.spanAuthority.state, "unavailable");
    if (report.spanAuthority.state !== "unavailable") assert.fail("excess native evidence must be unavailable");
    assert.equal(report.spanAuthority.cause.code, "span-stream-invalid");
    assert.match(report.spanAuthority.cause.summary, new RegExp(`^timeline-doctor-${limit.code}-limit-exceeded`));
    assert.deepEqual(readFileSync(path), before);
  } finally {
    await fixture.close();
  }
});
