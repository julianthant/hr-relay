// Read-only doctor probe over a disposable fixture; no product authority is opened.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { manualClock } from "../../../../../src/domain/clock.js";
import { RunRecordSchema } from "../../../../../src/domain/run/record.js";
import { AuthorityDatabase } from "../../../../../src/infra/sqlite/authority-database.js";
import { doctorAuthorityStorage } from "../../../../../src/infra/sqlite/storage-doctor.js";
import { createSpanJsonlWriter } from "../../../../../src/infra/events/span-jsonl-writer.js";
import { QUEUED_RUN } from "../../../../../tests/unit/fixtures/phase1f-run-fixtures.js";
import { NOW, UUID_1, UUID_2, UUID_3, UUID_4, UUID_5, UUID_6 } from "../../../../../tests/unit/fixtures/phase1c-contract-fixtures.js";

const root = mkdtempSync(join(tmpdir(), "hrauto-dcc2-mixed-probe-"));
const authorityPath = join(root, "state.db");
const clock = manualClock(new Date(NOW));
const run = (runId: string, itemId: string, traceId: string) => RunRecordSchema.parse({
  ...QUEUED_RUN, envelope: { ...QUEUED_RUN.envelope, runId, itemId, traceId },
});
const a = run(UUID_1, UUID_4, "pl-120000-0000");
const b = run(UUID_2, UUID_5, "pl-120001-0000");
const c = run(UUID_3, UUID_6, "pl-120002-0000");
try {
  const database = AuthorityDatabase.open({ path: authorityPath, busyTimeoutMs: 500, migrationOwner: "dcc2-mixed-probe" }, clock);
  try {
    database.authority.runs.enqueue(a);
    database.authority.runs.enqueue(b);
  } finally { database.close(); }
  const writer = createSpanJsonlWriter({ stateRoot: root, clock, pid: 4242 });
  for (const { envelope: e } of [a, c]) writer.emit({
    t: "run.queued", kind: "run", ts: e.enqueuedAt, workflow: e.workflow,
    runId: e.runId, attempt: e.attempt, traceId: e.traceId, spanPath: e.traceId,
    itemId: e.itemId, shape: e.shape, priority: e.priority, dryRun: e.dryRun,
    actorId: "local-operator", title: "Redacted fixture",
    descriptorVersion: e.descriptorVersion, contractFingerprint: e.contractFingerprint,
    resolvedInstance: e.resolvedInstance, configFingerprint: e.configFingerprint,
    configSnapshotId: e.configSnapshotId,
  });
  const inspect = async () => (await doctorAuthorityStorage({
    stateRootTrustAnchor: root, stateRoot: root, authorityPath,
    backupDirectory: join(root, "backups"), maxBackupAgeMs: 60_000, busyTimeoutMs: 500,
  }, clock)).spanAuthority;
  const validControl = await inspect();
  const raw = new DatabaseSync(authorityPath);
  try {
    raw.prepare("UPDATE tasks SET record_json = ? WHERE record_key = ?")
      .run(JSON.stringify({ malformed: true }), a.envelope.runId);
  } finally { raw.close(); }
  const mixed = await inspect();
  process.stdout.write(JSON.stringify({ validControl, mixed }, null, 2) + "\n");
} finally {
  rmSync(root, { recursive: true, force: true });
}
