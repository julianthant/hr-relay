import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, it } from "vitest";
import { AuthorityHealthPreflightRunner } from "../../../../src/backend/storage/sqlite/authority-health-runner.js";
import { doctorAuthorityStorage } from "../../../../src/backend/storage/sqlite/storage-doctor.js";
import { createTimelineEmitter } from "../../../../src/backend/storage/events/timeline-emitter.js";
import { systemClock } from "../../../../src/rules/time/clock.js";
import { CONFIG_SNAPSHOT } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { restoreSchema20CompletionFixture, restoreSchema22WorkerCustodyFixture } from "../../../support/fixtures/storage/historical-run-schema.js";
import { createCredentialDoctorFixtures } from "../../../support/helpers/credential-doctor-fixtures.js";

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.reverse()) await cleanup(); cleanups.length = 0; });
const { fixture } = createCredentialDoctorFixtures(cleanups);
const context = { signal: new AbortController().signal, timeoutMs: 10_000, deadlineMonotonicMs: 10_000, redaction: "presence-only" as const };

/** A copy of the live store preserved at a historical schema, as a restore leaves it under backups/suspects. */
function preserveSuspect(f: Awaited<ReturnType<typeof fixture>>, schema: 20 | 21, untombstonedRunId?: string, newerWriteRunId?: string): void {
  const directory = join(f.root, "backups", "suspects");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, `suspect-${"2".repeat(17)}-${randomUUID()}.sqlite`);
  const live = new DatabaseSync(f.options.authorityPath, { readOnly: true });
  try { live.exec(`VACUUM INTO '${path}'`); } finally { live.close(); }
  chmodSync(path, 0o600);
  const raw = new DatabaseSync(path, { enableForeignKeyConstraints: false });
  try {
    raw.exec("BEGIN EXCLUSIVE");
    if (schema === 20) restoreSchema20CompletionFixture(raw);
    else { restoreSchema22WorkerCustodyFixture(raw); raw.exec("UPDATE database_states SET schema_version=21; PRAGMA user_version=21"); }
    // The doctor reads only stable run columns from a suspect, so a bare queued row stands in for a run the current store lost.
    if (untombstonedRunId !== undefined) raw.prepare(`INSERT INTO runs(id,workflow,item_id,attempt,state,priority,claim_generation,version,settings_snapshot_id,
      descriptor_version,contract_fingerprint,trace_id,dry_run,local_day,enqueued_at,envelope_json,lifecycle_json,created_at,updated_at)
      VALUES(?,'person-lookup','item-1',1,'queued','interactive',0,1,?,1,?,?,1,'2026-11-07','2026-11-07T00:00:00.000Z','{}','{}','2026-11-07T00:00:00.000Z','2026-11-07T00:00:00.000Z')`)
      .run(untombstonedRunId, randomUUID(), "f".repeat(64), "a".repeat(32));
    // Newer write evidence than the current store holds: a later version and an attempt the current store lacks.
    if (newerWriteRunId !== undefined) {
      raw.prepare("UPDATE runs SET version=version+1 WHERE id=?").run(newerWriteRunId);
      raw.prepare("INSERT INTO write_attempts(id,intent_id,generation,run_id,payload_json,created_at) VALUES(?,?,1,?,'{}','2026-11-07T00:00:00.000Z')")
        .run(randomUUID(), randomUUID(), newerWriteRunId);
    }
    raw.exec("COMMIT");
  } finally { raw.close(); }
}

describe("storage doctor over a preserved suspect at a historical schema", () => {
  it.each([20, 21] as const)("reconciles span authority and keeps authority.health healthy for a schema-%i suspect", async (schema) => {
    const f = await fixture();
    preserveSuspect(f, schema);
    const report = await doctorAuthorityStorage(f.admission, f.options, undefined, f.credentialStore);
    assert.equal(report.spanAuthority.state, "reconciled", JSON.stringify(report.spanAuthority));
    const observation = await new AuthorityHealthPreflightRunner(f.admission, f.options, undefined, f.credentialStore).run(context);
    assert.equal(observation.state, "healthy", observation.summary);
  });

  it("still reports a schema-21 suspect run the current store neither retains nor tombstones", async () => {
    const f = await fixture();
    const runId = randomUUID();
    preserveSuspect(f, 21, runId);
    const report = await doctorAuthorityStorage(f.admission, f.options, undefined, f.credentialStore);
    assert.equal(report.spanAuthority.state, "degraded", JSON.stringify(report.spanAuthority));
    if (report.spanAuthority.state !== "degraded") return;
    assert.ok(report.spanAuthority.problems.some(problem => problem.state === "missing" && problem.runId === runId), JSON.stringify(report.spanAuthority.problems));
    const observation = await new AuthorityHealthPreflightRunner(f.admission, f.options, undefined, f.credentialStore).run(context);
    assert.equal(observation.state, "unhealthy", observation.summary);
  });

  it("reports restore-loss when a schema-21 suspect holds newer write evidence for a run the current store still has", async () => {
    const f = await fixture();
    f.database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
    f.database.authority.runs.enqueue(QUEUED_RUN);
    const e = QUEUED_RUN.envelope;
    createTimelineEmitter({ repository: f.database.authority.timelineEvents, clock: systemClock, pid: 4242 }).emit({
      ts: e.enqueuedAt, workflow: e.workflow, runId: e.runId, attempt: e.attempt, traceId: e.traceId, t: "run.queued", kind: "run",
      spanPath: e.traceId, itemId: e.itemId, shape: e.shape, priority: e.priority, dryRun: e.dryRun, actorId: "local-operator",
      title: "Restore-loss run", descriptorVersion: e.descriptorVersion, contractFingerprint: e.contractFingerprint,
      resolvedInstance: e.resolvedInstance, configFingerprint: e.configFingerprint, configSnapshotId: e.configSnapshotId });
    preserveSuspect(f, 21, undefined, e.runId);
    assert.ok(f.database.authority.runs.get(e.runId));
    const report = await doctorAuthorityStorage(f.admission, f.options, undefined, f.credentialStore);
    assert.equal(report.spanAuthority.state, "degraded", JSON.stringify(report.spanAuthority));
    if (report.spanAuthority.state !== "degraded") return;
    assert.ok(report.spanAuthority.problems.some(problem => problem.state === "restore-loss" && problem.runId === e.runId
      && problem.possibleExternalWrite === true), JSON.stringify(report.spanAuthority.problems));
  });
});
