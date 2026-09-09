import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, it } from "vitest";
import { z } from "zod";
import { manualClock } from "../../src/domain/clock.js";
import { canonicalJsonStringify } from "../../src/domain/canonical-json.js";
import { ArchivedRunRecordSchema, archivedRunReferenceFingerprint } from "../../src/domain/archive/model.js";
import { HistoricalRunRecordV40Schema, RunRecordSchema } from "../../src/domain/run/record.js";
import { RunRecordService } from "../../src/core/run-record-service.js";
import { AuthorityDatabase } from "../../src/infra/sqlite/authority-database.js";
import { OfflineAuthorityRestoreService } from "../../src/infra/sqlite/offline-restore.js";
import { RecoveryStopProofStore } from "../../src/infra/sqlite/recovery-stop-proof.js";
import { observeRuntimeLockSnapshot } from "../../src/infra/sqlite/runtime-process-locks.js";
import { SQLITE_MIGRATIONS, AUTHORITY_APPLICATION_ID } from "../../src/infra/sqlite/migrations.js";
import { convertRunCompletions } from "../../src/infra/sqlite/completion-conversion.js";
import { backupStoppedAuthority, upgradeStorage } from "../../src/server/storage/upgrade.js";
import { inspectAuthorityBackupReadOnly } from "../../src/infra/compat/backup-inspection.js";
import { personLookupDescriptor } from "../helpers/registered-workflows.js";

const clock = manualClock(new Date("2026-09-09T12:00:00.000Z"));
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const FixtureSchema = z.object({
  sourceCommit: z.literal("dce3efc91685a33fc868376c054b15b7c0aad6f3"), schemaVersion: z.literal(40),
  request: z.object({ kind: z.enum(["success", "failure"]), commandId: z.string(), terminal: z.object({
    authorization: z.object({ runId: z.string() }).passthrough(),
  }).passthrough() }),
  archive: ArchivedRunRecordSchema,
  rows: z.record(z.string().regex(/^[a-z_]+$/u), z.array(z.record(z.string().regex(/^[a-z_]+$/u), z.union([z.string(), z.number(), z.null()])))),
});
function fixture(kind: "success" | "failure") {
  const saved = FixtureSchema.parse(JSON.parse(readFileSync(new URL(`./run-completion-fixtures/schema40-${kind}.json`, import.meta.url), "utf8")));
  const root = mkdtempSync(join(tmpdir(), "run-completion-migration-")); roots.push(root);
  const stateRoot = join(root, ".tracker"); mkdirSync(stateRoot);
  for (const file of ["package.json", "package-lock.json"]) copyFileSync(join(process.cwd(), file), join(root, file));
  const path = join(stateRoot, "state.db"); const raw = new DatabaseSync(path); raw.exec("PRAGMA foreign_keys=OFF");
  for (const migration of SQLITE_MIGRATIONS.filter(({ version }) => version <= 40)) for (const statement of migration.statements) raw.exec(statement);
  for (const [table, rows] of Object.entries(saved.rows)) for (const row of rows) {
    const names = Object.keys(row);
    raw.prepare(`INSERT INTO ${table} (${names.join(",")}) VALUES (${names.map(() => "?").join(",")})`).run(...Object.values(row));
  }
  raw.exec(`PRAGMA application_id=${String(AUTHORITY_APPLICATION_ID)}; PRAGMA user_version=40`); raw.close();
  const input = { stateRoot, processLockRoot: join(stateRoot, "locks"), environmentFile: join(stateRoot, ".env"), plan: false };
  return { saved, path, root, stateRoot, input };
}
function open(path: string) {
  return AuthorityDatabase.open({ path, busyTimeoutMs: 250, migrationOwner: "completion-proof" }, clock);
}
function conversion(path: string) {
  const raw = new DatabaseSync(path);
  try {
    raw.exec("PRAGMA foreign_keys=ON; BEGIN EXCLUSIVE");
    convertRunCompletions(raw);
    for (const migration of SQLITE_MIGRATIONS.filter(({ version }) => version > 40)) for (const statement of migration.statements) raw.exec(statement);
    raw.exec("UPDATE database_state SET schema_version=41; PRAGMA user_version=41; COMMIT");
  } catch (error) { raw.exec("ROLLBACK"); throw error; }
  finally { raw.close(); }
}

describe("C P2/P3/P4 historical completion conversion", () => {
  for (const kind of ["success", "failure"] as const) {
    it(`${kind}: stopped backup, conversion, lost acknowledgement replay, archive identity, restore and no-write repeat`, async () => {
      const f = fixture(kind);
      assert.throws(() => open(f.path), /upgrade-required/u);
      const historical = inspectAuthorityBackupReadOnly(f.path);
      assert.equal(historical.schemaVersion, 40);
      const backup = await backupStoppedAuthority(f.stateRoot, clock);
      const manifest = backup.manifests[0]; assert.ok(manifest);
      const backupPath = join(f.stateRoot, "backups", "authority", manifest.backupFileName);
      const source = readFileSync(f.path);
      await assert.rejects(upgradeStorage({ ...f.input, hooks: { beforeCommit: () => { throw new Error("C-before-commit"); } } }, clock), /C-before-commit/u);
      assert.deepEqual(readFileSync(f.path), source);
      await assert.rejects(upgradeStorage({ ...f.input, hooks: { afterCommit: () => { throw new Error("C-after-commit"); } } }, clock), /C-after-commit/u);
      assert.equal((await upgradeStorage(f.input, clock)).state, "converted");
      const settled = readFileSync(f.path);
      assert.equal((await upgradeStorage(f.input, clock)).state, "already-upgraded");
      assert.deepEqual(readFileSync(f.path), settled);
      const database = open(f.path);
      try {
        const service = new RunRecordService({ database, clock, ids: { uuid: () => "99000000-0000-4000-8000-000000000099" } });
        const id = f.saved.request.terminal.authorization.runId;
        const run = database.authority.runs.get(id); assert.ok(run?.completion);
        assert.equal(run.version, 6); assert.equal(run.completion.expectedVersion, 4);
        assert.deepEqual(database.authority.archivedRuns.get(id), f.saved.archive);
        assert.equal(archivedRunReferenceFingerprint(database.authority.archivedRuns.get(id)), archivedRunReferenceFingerprint(f.saved.archive));
        const generation = database.getMeta().authorityGeneration;
        assert.equal(service.terminalize(f.saved.request, personLookupDescriptor).state, "applied-already");
        assert.equal(kind === "success" ? database.terminalizeSuccess(f.saved.request.terminal).state
          : database.terminalizeFailure(personLookupDescriptor, f.saved.request.terminal).state, "replayed");
        const changed = structuredClone(f.saved.request);
        const claim = z.object({ workerId: z.string(), claimGeneration: z.number() }).parse(changed.terminal.authorization.claim);
        const mutations = [
          { expectedVersion: 3 }, { authorizedAt: "2026-09-08T00:00:00.000Z" },
          { claim: { ...claim, workerId: "different-owner" } },
          { claim: { ...claim, claimGeneration: claim.claimGeneration + 1 } },
          kind === "success" ? { resultDigest: "f".repeat(64) }
            : { failureId: "99000000-0000-4000-8000-000000000088" },
        ];
        for (const mutation of mutations) {
          const divergent = { ...f.saved.request, terminal: { ...f.saved.request.terminal,
            authorization: { ...f.saved.request.terminal.authorization, ...mutation } } };
          if (kind === "failure" && "failureId" in mutation) {
            divergent.terminal.failure = { ...z.record(z.string(), z.unknown()).parse(f.saved.request.terminal.failure), failureId: mutation.failureId };
          }
          assert.deepEqual(service.terminalize(divergent, personLookupDescriptor), { state: "refused", refusal: { reason: "replay-divergent" } });
        }
        if (kind === "success") {
          const outbox = z.object({ outbox: z.object({ outboxId: z.string() }).passthrough() }).parse(changed.terminal).outbox;
          const changedOutbox = { ...f.saved.request, terminal: { ...f.saved.request.terminal, outbox: { ...outbox, outboxId: "99000000-0000-4000-8000-000000000088" } } };
          assert.deepEqual(service.terminalize(changedOutbox, personLookupDescriptor), { state: "refused", refusal: { reason: "replay-divergent" } });
          assert.throws(() => database.terminalizeSuccess(changedOutbox.terminal), /historical terminal outbox replay differs/u);
        }
        assert.equal(database.getMeta().authorityGeneration, generation);
        const raw = new DatabaseSync(f.path);
        try {
          assert.deepEqual(raw.prepare("PRAGMA foreign_key_check").all(), []);
          assert.equal(raw.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name IN ('failures','run_terminal_authorizations','run_terminal_outbox')").get()?.n, 0);
          for (const table of ["commands", "command_audits", "archived_runs"]) {
            const before = f.saved.rows[table]; assert.ok(before);
            const after = raw.prepare(`SELECT record_json FROM ${table} ORDER BY record_key`).all().map((row) => row.record_json);
            assert.deepEqual(after, before.toSorted((a, b) => String(a.record_key).localeCompare(String(b.record_key))).map((row) => row.record_json));
          }
        } finally { raw.close(); }
      } finally { database.close(); }
      const sourceDatabaseIdentity = AuthorityDatabase.sourceDatabaseIdentity(f.path);
      const proofs = new RecoveryStopProofStore({ processLockRoot: f.input.processLockRoot, maxProofAgeMs: 60_000 }, clock);
      proofs.recordRuntimeState(observeRuntimeLockSnapshot({ processLockRoot: f.input.processLockRoot, sourceDatabaseIdentity }, clock));
      const stoppedSystemProof = proofs.issue({ observedBy: "local-operator", sourceDatabaseIdentity });
      const restore = new OfflineAuthorityRestoreService({ authorityPath: f.path,
        suspectDirectory: join(f.stateRoot, "suspects"), busyTimeoutMs: 250,
        processLockRoot: f.input.processLockRoot, stoppedProofMaxAgeMs: 60_000,
      }, async () => { throw new Error("historical completion restore cannot rebuild current projections"); }, clock);
      const restored = await restore.restore({ manifestPath: `${backupPath}.manifest.json`, stoppedSystemProof });
      assert.equal(restored.schemaVersion, 40);
      assert.equal(restored.projectionRebuilt, false);
      assert.deepEqual(readFileSync(f.path), readFileSync(backupPath));
      assert.equal(inspectAuthorityBackupReadOnly(f.path).schemaVersion, 40);
      assert.equal((await upgradeStorage(f.input, clock)).state, "converted");
      const reopened = open(f.path);
      try {
        assert.deepEqual(reopened.authority.archivedRuns.get(f.saved.request.terminal.authorization.runId), f.saved.archive);
        assert.equal(new RunRecordService({ database: reopened, clock, ids: { uuid: () => "99000000-0000-4000-8000-000000000099" } })
          .terminalize(f.saved.request, personLookupDescriptor).state, "applied-already");
      } finally { reopened.close(); }
    });
  }

  it("P3 preserves active, queued, requeued, cancelled and interrupted rows without inventing completion", () => {
    const f = fixture("success");
    const raw = new DatabaseSync(f.path);
    const original = f.saved.rows.workflow_runs?.[0]; assert.ok(original);
    const saved = HistoricalRunRecordV40Schema.parse(JSON.parse(String(original.record_json)));
    const lifecycles = [
      { state: "running", workerId: "completion-owner", claimedAt: saved.createdAt, heartbeatAt: saved.updatedAt },
      { state: "queued" },
      { state: "queued", requeuedFrom: "reassign" },
      { state: "terminal", outcome: "cancelled", endedAt: saved.updatedAt },
      { state: "terminal", outcome: "interrupted", endedAt: saved.updatedAt },
    ];
    const expected = new Map<string, string>();
    for (const [index, lifecycle] of lifecycles.entries()) {
      const runId = `99000000-0000-4000-8000-00000000000${String(index)}`;
      const run = HistoricalRunRecordV40Schema.parse({ ...saved,
        envelope: { ...saved.envelope, runId, itemId: runId, traceId: `pl-170000-000${String(index)}` }, lifecycle });
      const json = canonicalJsonStringify(run);
      const row = { ...original, record_key: runId, item_id: runId, record_json: json,
        state: run.lifecycle.state,
        owner_worker_id: "workerId" in run.lifecycle ? run.lifecycle.workerId : null,
        heartbeat_at: "heartbeatAt" in run.lifecycle ? run.lifecycle.heartbeatAt : null };
      const names = Object.keys(row);
      raw.prepare(`INSERT INTO workflow_runs (${names.join(",")}) VALUES (${names.map(() => "?").join(",")})`).run(...Object.values(row));
      expected.set(runId, json);
    }
    raw.close(); conversion(f.path);
    const current = new DatabaseSync(f.path);
    try {
      for (const [id, json] of expected) {
        const row = current.prepare("SELECT record_json FROM workflow_runs WHERE record_key=?").get(id);
        assert.equal(row?.record_json, json);
        assert.equal(RunRecordSchema.parse(JSON.parse(json)).completion, undefined);
      }
      assert.deepEqual(current.prepare("PRAGMA foreign_key_check").all(), []);
    } finally { current.close(); }
  });

  for (const fault of ["missing-authorization", "missing-result", "changed-outbox", "changed-claim", "unaccounted-version", "missing-failure"] as const) {
    it(`P3 refuses ${fault} atomically with source bytes retained`, () => {
      const f = fixture(fault === "missing-failure" ? "failure" : "success");
      const raw = new DatabaseSync(f.path); raw.exec("PRAGMA foreign_keys=OFF");
      if (fault === "missing-authorization") raw.exec("DELETE FROM run_terminal_authorizations");
      if (fault === "missing-result") raw.exec("DELETE FROM run_results");
      if (fault === "missing-failure") raw.exec("DELETE FROM failures");
      if (fault === "changed-outbox") raw.exec("UPDATE run_terminal_outbox SET record_json=json_set(record_json,'$.payload.resultDigest',printf('%064d',0))");
      if (fault === "changed-claim") raw.exec("UPDATE run_terminal_authorizations SET worker_id='different'");
      if (fault === "unaccounted-version") raw.exec("UPDATE workflow_runs SET version=version+1, record_json=json_set(record_json,'$.version',version+1)");
      raw.close(); const before = readFileSync(f.path);
      assert.throws(() => conversion(f.path), /run-completion-conversion-refused/u);
      assert.deepEqual(readFileSync(f.path), before);
    });
  }

  it("P3 preserves projected historical receipt bytes and P6 current schemas refuse fabricated/missing completion", () => {
    const f = fixture("success"); const raw = new DatabaseSync(f.path);
    const projected = { state: "projected", projectedAt: "2026-08-01T00:00:00.000Z", projectionFingerprint: "a".repeat(64) };
    raw.prepare("UPDATE run_terminal_outbox SET state='projected', record_json=json_set(record_json,'$.projection',json(?))").run(canonicalJsonStringify(projected));
    const bytes = raw.prepare("SELECT record_json FROM run_terminal_outbox").get()?.record_json; raw.close();
    conversion(f.path); const database = open(f.path);
    try {
      const run = database.authority.runs.get(f.saved.request.terminal.authorization.runId); assert.ok(run?.completion);
      assert.equal(run.completion.historical?.outboxJson, bytes);
      assert.equal(RunRecordSchema.safeParse({ ...run, completion: undefined }).success, false);
      assert.equal(RunRecordSchema.safeParse({ ...run, completion: { ...run.completion, historical: { schemaVersion: 40, authorizationJson: "{" } } }).success, false);
      assert.equal(RunRecordSchema.safeParse({ ...run, lifecycle: { state: "queued" } }).success, false);
    } finally { database.close(); }
  });
});
