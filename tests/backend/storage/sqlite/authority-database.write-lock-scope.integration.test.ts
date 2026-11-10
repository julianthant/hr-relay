import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { afterAll, afterEach, describe, it, vi } from "vitest";
import { createDebugEventWriter } from "../../../../src/backend/logs/debug-events.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { createProfileFixtureSet } from "../../../support/helpers/admission-fixture.js";
import { runRecordOf } from "../../../support/helpers/backend/dashboard-harness.js";
import { AuthorityDatabase, AuthorityWriterBusyError } from "../../../support/helpers/synthetic-storage-admission.js";

const profileFixtures = createProfileFixtureSet();
afterAll(() => profileFixtures.close());
afterEach(() => { vi.restoreAllMocks(); });

const clock = manualClock(new Date("2026-08-28T16:00:00.000Z"));
const WHOLE_STORE = /\b(?:settings_snapshots|command_audits|workbook_\w+)\b/u;

function emitter(database: AuthorityDatabase) {
  return createDebugEventWriter({ repository: database.authority.timelineEvents, clock, build: "fixture" });
}

function traceSql(work: () => void): string[] {
  const statements: string[] = [];
  const exec = DatabaseSync.prototype.exec, prepare = DatabaseSync.prototype.prepare;
  vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (this: DatabaseSync, sql: string) { statements.push(sql); return exec.call(this, sql); });
  vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function (this: DatabaseSync, sql: string) { statements.push(sql); return prepare.call(this, sql); });
  try { work(); }
  finally { vi.restoreAllMocks(); }
  return statements;
}

function underWriteLock(statements: readonly string[]): string[] {
  const begin = statements.indexOf("BEGIN IMMEDIATE"), commit = statements.indexOf("COMMIT", begin);
  assert.ok(begin >= 0 && commit > begin, "the traced work commits one write transaction");
  return statements.slice(begin + 1, commit);
}

async function peers() {
  const profile = await profileFixtures.create();
  const database = AuthorityDatabase.open({ path: profile.path, busyTimeoutMs: 1000, migrationOwner: "write-lock-scope" }, clock);
  const peer = AuthorityDatabase.open({ path: profile.path, busyTimeoutMs: 1000, migrationOwner: "write-lock-scope-peer" }, clock);
  emitter(database).emit({ category: "boot", phase: "started", correlationId: "own-first" });
  emitter(peer).emit({ category: "boot", phase: "started", correlationId: "peer-commit" });
  return { profile, database, peer, async close() { peer.close(); database.close(); await profile.close(); } };
}

describe("authority write lock scope", () => {
  it("appends a timeline event after a peer commit without whole-store reads under the write lock", async () => {
    const f = await peers();
    try {
      const statements = traceSql(() => { emitter(f.database).emit({ category: "worker", phase: "started", correlationId: "traced" }); });
      assert.deepEqual(underWriteLock(statements).filter(sql => WHOLE_STORE.test(sql)), []);
    } finally { await f.close(); }
  });

  it("validates the whole store before the write lock when registering search declarations after a peer commit", async () => {
    const f = await peers();
    try {
      const run = runRecordOf({ seed: 7 }).envelope;
      const statements = traceSql(() => { f.database.registerRunSearchDeclarations([{ workflow: run.workflow, version: run.descriptorVersion,
        contractFingerprint: run.contractFingerprint, subjectProjection: null }]); });
      const begin = statements.indexOf("BEGIN IMMEDIATE"), firstWholeStore = statements.findIndex(sql => WHOLE_STORE.test(sql));
      assert.ok(firstWholeStore >= 0 && firstWholeStore < begin, "whole-store validation runs before BEGIN IMMEDIATE");
      assert.deepEqual(underWriteLock(statements).filter(sql => WHOLE_STORE.test(sql)), []);
    } finally { await f.close(); }
  });

  it("keeps validating the whole store on search reads after a peer commit", async () => {
    const f = await peers();
    try {
      const statements = traceSql(() => { f.database.authority.runs.search({ q: "", scope: "run", facets: {}, limit: 10 }); });
      assert.ok(statements.some(sql => /\bsettings_snapshots\b/u.test(sql)));
      assert.ok(statements.some(sql => /\bcommand_audits\b/u.test(sql)));
    } finally { await f.close(); }
  });

  it("names a busy write and writes nothing", async () => {
    const profile = await profileFixtures.create();
    const database = AuthorityDatabase.open({ path: profile.path, busyTimeoutMs: 50, migrationOwner: "write-lock-busy" }, clock);
    const raw = new DatabaseSync(profile.path);
    try {
      const count = () => Number(raw.prepare("SELECT count(*) AS n FROM timeline_events").get()?.n);
      const before = count();
      raw.exec("BEGIN IMMEDIATE");
      let thrown: unknown;
      try { emitter(database).emit({ category: "worker", phase: "started", correlationId: "busy" }); }
      catch (error) { thrown = error; }
      raw.exec("ROLLBACK");
      assert.ok(thrown instanceof AuthorityWriterBusyError);
      assert.equal(thrown.code, "DATABASE_WRITER_UNAVAILABLE");
      assert.ok(thrown.cause instanceof Error && "errcode" in thrown.cause);
      assert.equal(thrown.cause.errcode, 5);
      assert.equal(count(), before);
    } finally { raw.close(); database.close(); await profile.close(); }
  });
});
