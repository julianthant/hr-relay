import { SpanAuthorityReconciliationWireSchema } from "../../src/domain/dashboard/storage.js";
import { RunRecordSchema } from "../../src/domain/run/record.js";
import { seedAtomicWriteOwner } from "./helpers/timeline-write-fixture.js";
import { ATOMIC_WRITE_COMMIT, WRITE_INTENT_ATTEMPTING, WRITE_ATTEMPT } from "../fixtures/phase1c-contract-fixtures.js";
import { runQueuedSpanEvent } from "../../src/server/dashboard/commands/run-queued-span.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../src/domain/ids.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../src/infra/sqlite/migrations.js";
import { RunRecordService } from "../../src/core/run-record-service.js";
import { randomUUID } from "node:crypto";
import { createSpanJsonlWriter } from "../../src/infra/events/span-jsonl-writer.js";
import { createTimelineEmitter } from "../../src/infra/events/timeline-emitter.js";
import { QUEUED_RUN } from "../fixtures/phase1f-run-fixtures.js";
/**
 * D322: an authority backup is written ONLY by `cli storage backup`.
 *
 * The dashboard composition used to own a cadence (start / dirty 15-minute
 * tick / graceful drain). The operator retired it: the state root holds the
 * bare minimum and regenerates itself when deleted, and a SQLite backup exists
 * only when asked for. This file pins the three consequences on the real
 * command surface over a real authority database:
 *
 *  1. `storage backup` writes exactly one verified backup set + manifest at the
 *     live generation and prints the manifest it wrote;
 *  2. `storage backup` REFUSES when no authority exists — it never creates an
 *     empty database to back up;
 *  3. `storage doctor` no longer gates its exit code on a current backup: a
 *     healthy, reconciled authority with NO backup exits 0 and reports the
 *     backup arm as missing.
 */
import assert from "node:assert/strict";
import { truncateSync, copyFileSync, symlinkSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it, vi } from "vitest";
import { z } from "zod";
import { rebuildRuntimeIsolation } from "../../src/config/runtime-isolation.js";
import { manualClock } from "../../src/domain/clock.js";
import { AuthorityDatabase } from "../../src/infra/sqlite/index.js";
import { composeStorageCommand } from "../../src/server/storage/compose.js";
import { admitLocalEnvironmentFile } from "../../src/domain/secrets.js";
import { createCredentialStore } from "../../src/infra/config/credential-store.js";
import { readSettings } from "../../src/server/settings-runtime.js";

const CLOCK = manualClock(new Date("2026-09-03T12:00:00.000Z"));
const ManifestGenerationSchema = z.object({ authorityGeneration: z.number().int().nonnegative() });
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

interface Paths {
  readonly repoRoot: string;
  readonly stateRoot: string;
  readonly authorityPath: string;
  readonly backupDirectory: string;
}

function paths(): Paths {
  const repoRoot = mkdtempSync(join(tmpdir(), "hrauto-storage-backup-"));
  roots.push(repoRoot);
  const stateRoot = join(repoRoot, rebuildRuntimeIsolation.stateRoot);
  writeFileSync(join(repoRoot, "package.json"), JSON.stringify({ name: "backup-command", version: "0.1.0" }));
  return {
    repoRoot,
    stateRoot,
    authorityPath: join(stateRoot, "state.db"),
    backupDirectory: join(stateRoot, "backups", "authority"),
  };
}

function createAuthority(p: Paths): number {
  mkdirSync(p.stateRoot, { recursive: true });
  const database = AuthorityDatabase.open(
    { path: p.authorityPath, busyTimeoutMs: 250, migrationOwner: "backup-command-test" },
    CLOCK,
  );
  try {
    return database.getMeta().authorityGeneration;
  } finally {
    database.close();
  }
}

describe("cli storage backup (D322)", () => {
  it("M18 real restore warns about displaced fenced evidence without resurrecting the run", async () => {
    const p = paths(); createAuthority(p);
    const backup = await composeStorageCommand(rebuildRuntimeIsolation, ["backup"], CLOCK, p.repoRoot);
    assert.equal(backup.exitCode, 0, backup.output);
    const manifest = readdirSync(p.backupDirectory).find((name) => name.endsWith(".manifest.json")); assert.ok(manifest);
    const database = AuthorityDatabase.open({ path: p.authorityPath, busyTimeoutMs: 500, migrationOwner: "fenced-restore-proof" }, CLOCK);
    const e = QUEUED_RUN.envelope;
    try { database.authority.runs.enqueue(QUEUED_RUN); } finally { database.close(); }
    const emitter = createSpanJsonlWriter({ stateRoot: p.stateRoot, clock: CLOCK, pid: 4242 });
    emitter.emit({ t: "run.queued", kind: "run", ts: CLOCK.now().toISOString(), workflow: e.workflow, runId: e.runId, attempt: e.attempt,
      traceId: e.traceId, spanPath: e.traceId, itemId: e.itemId, shape: e.shape, priority: e.priority, dryRun: false,
      actorId: "local-operator", title: "Synthetic missing-authority fixture", descriptorVersion: e.descriptorVersion, contractFingerprint: e.contractFingerprint,
      resolvedInstance: e.resolvedInstance, configFingerprint: e.configFingerprint, configSnapshotId: e.configSnapshotId });
    emitter.emit({ t: "transaction.fenced", ts: CLOCK.now().toISOString(), workflow: e.workflow, runId: e.runId, attempt: e.attempt,
      traceId: e.traceId, spanPath: `${e.traceId}/synthetic-write`, parentSpanPath: e.traceId, node: "synthetic-write", taskId: "ucpath/synthetic-write" });
    const beforeRestore = AuthorityDatabase.open({ path: p.authorityPath, busyTimeoutMs: 500, migrationOwner: "timeline-restore-proof" }, CLOCK);
    try {
      const timeline = createTimelineEmitter({ repository: beforeRestore.authority.timelineEvents, clock: CLOCK, pid: 4242 });
      for (const name of readdirSync(join(p.stateRoot, "spans"))) {
        for (const line of readFileSync(join(p.stateRoot, "spans", name), "utf8").trimEnd().split("\n")) timeline.emit(JSON.parse(line));
      }
      assert.equal(beforeRestore.authority.timelineEvents.page({}).length, 2);
    } finally { beforeRestore.close(); }
    const restore = await composeStorageCommand(rebuildRuntimeIsolation, ["restore", "--from", join(p.backupDirectory, manifest), "--json"], CLOCK, p.repoRoot);
    assert.equal(restore.exitCode, 0, restore.output);
    const restoreReport = z.object({ suspectFileName: z.string() }).parse(JSON.parse(restore.output));
    const doctor = await composeStorageCommand(rebuildRuntimeIsolation, ["doctor", "--json"], CLOCK, p.repoRoot);
    assert.equal(doctor.exitCode, 1, doctor.output);
    const observed = z.object({ spanAuthority: z.unknown() }).parse(JSON.parse(doctor.output));
    assert.equal(z.object({ state: z.string() }).parse(observed.spanAuthority).state, "degraded", JSON.stringify(observed.spanAuthority));
    const report = z.object({ spanAuthority: z.object({ state: z.literal("degraded"),
      problems: z.array(z.object({ state: z.string(), runId: z.string(), possibleExternalWrite: z.boolean().optional() })) }) }).parse(JSON.parse(doctor.output));
    assert.ok(report.spanAuthority.problems.some((problem) => problem.state === "missing"
      && problem.runId === e.runId && problem.possibleExternalWrite === true));
    const suspect = AuthorityDatabase.open({ path: join(p.stateRoot, "suspects", restoreReport.suspectFileName),
      busyTimeoutMs: 500, migrationOwner: "preserved-timeline-read", openMode: "storage-doctor-read-only-no-migrate" }, CLOCK);
    try {
      assert.ok(suspect.authority.runs.get(e.runId));
      assert.deepEqual(suspect.authority.timelineEvents.page({}).map((record) =>
        record.payload.kind === "span" ? record.payload.event.t : record.payload.kind), ["run.queued", "transaction.fenced"]);
    } finally { suspect.close(); }
    for (let count = 0; count < 2; count++) {
      const reopened = AuthorityDatabase.open({ path: p.authorityPath, busyTimeoutMs: 500, migrationOwner: "missing-stays-absent" }, CLOCK);
      try { assert.deepEqual(new RunRecordService({ database: reopened, clock: CLOCK, ids: { uuid: randomUUID }, publishQueued: () => { throw new Error("read must never publish"); } }).read(e.runId), { state: "absent", runId: e.runId });
        assert.equal(reopened.authority.runs.get(e.runId), undefined); assert.equal(reopened.authority.deletedRuns.get(e.runId), undefined); }
      finally { reopened.close(); }
    }
    const next = AuthorityDatabase.open({ path: p.authorityPath, busyTimeoutMs: 500, migrationOwner: "new-identity-after-restore" }, CLOCK);
    try {
      const nextId = randomUUID(); next.authority.runs.enqueue({ ...QUEUED_RUN, envelope: { ...e, runId: nextId } });
      assert.equal(next.authority.runs.get(e.runId), undefined); assert.ok(next.authority.runs.get(nextId));
    } finally { next.close(); }
  });
  it("reports a lost write attempt even when the restored run still exists at the same version", async () => {
    const p = paths(); createAuthority(p);
    const initial = AuthorityDatabase.open({ path: p.authorityPath, busyTimeoutMs: 500, migrationOwner: "retained-restore-owner" }, CLOCK);
    try {
      seedAtomicWriteOwner(initial, ATOMIC_WRITE_COMMIT);
      const run = initial.authority.runs.get(WRITE_INTENT_ATTEMPTING.runId);
      if (run === undefined) throw new Error("missing owner");
      createTimelineEmitter({ repository: initial.authority.timelineEvents, clock: CLOCK }).emit(
        runQueuedSpanEvent({ run, actorId: LOCAL_OPERATOR_ACTOR_ID, title: "Retained restore owner" }));
    } finally { initial.close(); }
    assert.equal((await composeStorageCommand(rebuildRuntimeIsolation, ["backup"], CLOCK, p.repoRoot)).exitCode, 0);
    const manifest = readdirSync(p.backupDirectory).find((name) => name.endsWith(".manifest.json")); assert.ok(manifest);
    const newer = AuthorityDatabase.open({ path: p.authorityPath, busyTimeoutMs: 500, migrationOwner: "newer-write" }, CLOCK);
    try { newer.authority.writeIntents.fenceAttempt({ intent: WRITE_INTENT_ATTEMPTING, attempt: WRITE_ATTEMPT }); }
    finally { newer.close(); }
    const restore = await composeStorageCommand(rebuildRuntimeIsolation, ["restore", "--from", join(p.backupDirectory, manifest), "--json"], CLOCK, p.repoRoot);
    assert.equal(restore.exitCode, 0, restore.output);
    const doctor = await composeStorageCommand(rebuildRuntimeIsolation, ["doctor", "--json"], CLOCK, p.repoRoot);
    assert.equal(doctor.exitCode, 1, doctor.output);
    const report = z.object({ spanAuthority: z.object({ state: z.literal("degraded"), problems: z.array(z.object({
      state: z.string(), runId: z.string(), possibleExternalWrite: z.boolean().optional() })) }) }).parse(JSON.parse(doctor.output));
    assert.ok(report.spanAuthority.problems.some((problem) => problem.state === "restore-loss"
      && problem.runId === WRITE_INTENT_ATTEMPTING.runId && problem.possibleExternalWrite === true));
    const wire = z.object({ spanAuthority: z.unknown() }).parse(JSON.parse(doctor.output));
    assert.equal(SpanAuthorityReconciliationWireSchema.safeParse(wire.spanAuthority).success, true);
    const text = await composeStorageCommand(rebuildRuntimeIsolation, ["doctor"], CLOCK, p.repoRoot);
    assert.ok(text.output.includes("newer preserved authority evidence; possibleExternalWrite=true"));
  });

  it.each(["corrupt", "file-symlink", "directory-symlink", "changed-during-read"] as const)(
    "refuses %s preserved authority evidence without leaking supplied content", async (damage) => {
      const p = paths(); createAuthority(p);
      const directory = join(p.stateRoot, "suspects");
      const name = "suspect-20260903120000000-87000000-0000-4000-8000-000000000008.sqlite";
      const source = join(directory, name);
      const privateText = "synthetic-preserved-private-value";
      if (damage === "directory-symlink") symlinkSync(p.backupDirectory, directory);
      else {
        mkdirSync(directory);
        if (damage === "file-symlink") symlinkSync(p.authorityPath, source);
        else if (damage === "corrupt") writeFileSync(source, privateText);
        else copyFileSync(p.authorityPath, source);
      }
      const original = AuthorityDatabase.inspectTimelineReadOnly.bind(AuthorityDatabase);
      const spy = vi.spyOn(AuthorityDatabase, "inspectTimelineReadOnly").mockImplementation((path, timeout, recovery) => {
        const result = original(path, timeout, recovery);
        if (damage === "changed-during-read" && path === name) writeFileSync(path, privateText);
        return result;
      });
      try {
        const doctor = await composeStorageCommand(rebuildRuntimeIsolation, ["doctor", "--json"], CLOCK, p.repoRoot);
        assert.equal(doctor.exitCode, 1, doctor.output);
        assert.equal(z.object({ spanAuthority: z.object({ state: z.literal("unavailable") }) }).parse(
          JSON.parse(doctor.output)).spanAuthority.state, "unavailable");
        assert.equal(doctor.output.includes(privateText), false);
      } finally { spy.mockRestore(); }
    });

  it.each(["database count", "file count", "bytes"] as const)("bounds preserved authority %s", async (limit) => {
    const p = paths(); createAuthority(p);
    const directory = join(p.stateRoot, "suspects"); mkdirSync(directory);
    const count = limit === "file count" ? 385 : limit === "database count" ? 129 : 1;
    for (let index = 0; index < count; index++) {
      const name = `suspect-20260903120000000-87000000-0000-4000-8000-${String(index).padStart(12, "0")}.sqlite`;
      const path = join(directory, name);
      writeFileSync(path, "");
      if (limit === "bytes") truncateSync(path, 256 * 1024 * 1024 + 1);
    }
    const doctor = await composeStorageCommand(rebuildRuntimeIsolation, ["doctor", "--json"], CLOCK, p.repoRoot);
    assert.equal(doctor.exitCode, 1, doctor.output);
    const report = z.object({ spanAuthority: z.object({ state: z.literal("unavailable"), cause: z.object({ summary: z.string() }) }) }).parse(JSON.parse(doctor.output));
    assert.equal(report.spanAuthority.cause.summary, `preserved authority ${limit} ${limit === "bytes" ? "exceed" : "exceeds"} the inspection limit`);
  });

  it("accounts a preserved run after explicit deletion without reviving it", async () => {
    const p = paths(); createAuthority(p);
    const initial = AuthorityDatabase.open({ path: p.authorityPath, busyTimeoutMs: 500, migrationOwner: "deleted-preserved-owner" }, CLOCK);
    try {
      initial.authority.runs.enqueue(QUEUED_RUN);
      createTimelineEmitter({ repository: initial.authority.timelineEvents, clock: CLOCK }).emit(
        runQueuedSpanEvent({ run: RunRecordSchema.parse(QUEUED_RUN), actorId: LOCAL_OPERATOR_ACTOR_ID, title: "Deleted restore owner" }));
      initial.authority.runs.transition({ runId: QUEUED_RUN.envelope.runId, expectedVersion: QUEUED_RUN.version,
        lifecycle: { state: "terminal", outcome: "cancelled", endedAt: CLOCK.now().toISOString() }, now: CLOCK.now().toISOString() });
    } finally { initial.close(); }
    const directory = join(p.stateRoot, "suspects"); mkdirSync(directory);
    copyFileSync(p.authorityPath, join(directory, "suspect-20260903120000000-87000000-0000-4000-8000-000000000009.sqlite"));
    const current = AuthorityDatabase.open({ path: p.authorityPath, busyTimeoutMs: 500, migrationOwner: "delete-preserved-owner" }, CLOCK);
    try { current.authority.runs.delete({ runId: QUEUED_RUN.envelope.runId, origin: "queue", commandId: randomUUID(), now: CLOCK.now().toISOString() }); }
    finally { current.close(); }
    const doctor = await composeStorageCommand(rebuildRuntimeIsolation, ["doctor", "--json"], CLOCK, p.repoRoot);
    assert.equal(doctor.exitCode, 0, doctor.output);
    assert.equal(z.object({ spanAuthority: z.object({ state: z.literal("reconciled") }) }).parse(
      JSON.parse(doctor.output)).spanAuthority.state, "reconciled");
  });

  it("admits only the four approved cleanup-only names through plan/apply without importing values", async () => {
    const p = paths();
    const retired = ["I9_USER_ID", "I9_PASSWORD", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"];
    const values = retired.map((_, index) => `synthetic-retired-private-${String(index)}`);
    const source = retired.map((name, index) => `${name}=${values[index]}`).join("\n") + "\n";
    const environmentFile = join(p.repoRoot, ".env");
    writeFileSync(environmentFile, source, { mode: 0o600 });
    const before = readdirSync(p.repoRoot);
    const plan = await composeStorageCommand(rebuildRuntimeIsolation, ["upgrade", "--plan", "--json"], CLOCK, p.repoRoot);
    assert.equal(plan.exitCode, 0, plan.output);
    const planned = z.object({ importedKeys: z.array(z.string()), envKeysToRemove: z.array(z.string()), credentials: z.literal("empty") }).parse(JSON.parse(plan.output));
    assert.deepEqual(planned.importedKeys, []);
    assert.deepEqual(planned.envKeysToRemove, [...retired].sort());
    assert.deepEqual(readdirSync(p.repoRoot), before);
    const applied = await composeStorageCommand(rebuildRuntimeIsolation, ["upgrade", "--json"], CLOCK, p.repoRoot);
    assert.equal(applied.exitCode, 0, applied.output);
    assert.deepEqual(JSON.parse(applied.output), { ...JSON.parse(plan.output), state: "converted" });
    const database = AuthorityDatabase.open({ path: p.authorityPath, busyTimeoutMs: 500, migrationOwner: "cleanup-only-proof" }, CLOCK);
    try { assert.deepEqual(readSettings(database.authority).settings, {}); }
    finally { database.close(); }
    assert.equal(createCredentialStore({ stateRoot: p.stateRoot }).read().revision, 1);
    assert.equal(existsSync(join(p.stateRoot, "credentials")), false);
    const backup = await composeStorageCommand(rebuildRuntimeIsolation, ["backup", "--json"], CLOCK, p.repoRoot);
    assert.equal(backup.exitCode, 0, backup.output);
    for (const value of values) {
      assert.equal([plan.output, applied.output, backup.output].some((output) => output.includes(value)), false);
      assert.equal(readFileSync(p.authorityPath).includes(Buffer.from(value)), false);
      for (const name of readdirSync(p.backupDirectory)) assert.equal(readFileSync(join(p.backupDirectory, name)).includes(Buffer.from(value)), false);
    }
    const settled = readFileSync(p.authorityPath);
    const repeat = await composeStorageCommand(rebuildRuntimeIsolation, ["upgrade", "--json"], CLOCK, p.repoRoot);
    assert.equal(repeat.exitCode, 0, repeat.output);
    assert.equal(z.object({ state: z.literal("already-upgraded") }).parse(JSON.parse(repeat.output)).state, "already-upgraded");
    assert.deepEqual(readFileSync(p.authorityPath), settled);
    assert.equal(readFileSync(environmentFile, "utf8"), source);
    for (const name of retired) {
      writeFileSync(environmentFile, `${name}=synthetic-private\n`, { mode: 0o600 });
      const env = {};
      assert.throws(() => admitLocalEnvironmentFile(environmentFile, env));
      assert.deepEqual(env, {});
    }
    writeFileSync(environmentFile, source, { mode: 0o600 });
    assert.equal(readFileSync(environmentFile, "utf8"), source);
  });
  it("reports a migration value refusal by catalog key without echoing its value", async () => {
    const p = paths(); const source = "HRAUTO_DEFAULT_WORKERS=synthetic-invalid-private-input\n";
    writeFileSync(join(p.repoRoot, ".env"), source, { mode: 0o600 });
    const result = await composeStorageCommand(rebuildRuntimeIsolation, ["upgrade", "--plan", "--json"], CLOCK, p.repoRoot);
    assert.equal(result.exitCode, 1);
    assert.deepEqual(JSON.parse(result.output), { state: "refused-or-incomplete", code: "invalid-value", key: "concurrency.defaultWorkers" });
    assert.equal(result.output.includes("synthetic-invalid-private-input"), false); assert.equal(existsSync(p.stateRoot), false);
    assert.equal(readFileSync(join(p.repoRoot, ".env"), "utf8"), source);
  });
  it.each(["--force", "--skip-backup", "--allow-mixed"])("M19 refuses unsupported upgrade flag %s before touching the root", async (flag) => {
    const p = paths(); const before = readdirSync(p.repoRoot);
    const result = await composeStorageCommand(rebuildRuntimeIsolation, ["upgrade", flag], CLOCK, p.repoRoot);
    assert.equal(result.exitCode, 2); assert.ok(result.output.includes(flag)); assert.deepEqual(readdirSync(p.repoRoot), before);
  });
  it("writes exactly one verified backup and manifest at the live generation", async () => {
    const p = paths();
    const generation = createAuthority(p);
    assert.equal(existsSync(p.backupDirectory), false, "no backup exists before the operator asks");

    const outcome = await composeStorageCommand(rebuildRuntimeIsolation, ["backup"], CLOCK, p.repoRoot);
    assert.equal(outcome.exitCode, 0, outcome.output);
    assert.match(outcome.output, /^backup: verified — authority-g\d+-/u);

    const entries = readdirSync(p.backupDirectory).sort();
    assert.equal(entries.length, 2, entries.join(", "));
    const manifestName = entries.find((name) => name.endsWith(".manifest.json"));
    const backupName = entries.find((name) => name.endsWith(".sqlite"));
    assert.ok(manifestName !== undefined && backupName !== undefined, entries.join(", "));
    assert.equal(manifestName, `${backupName}.manifest.json`);
    assert.ok(outcome.output.includes(backupName));
    const manifest = ManifestGenerationSchema.parse(
      JSON.parse(readFileSync(join(p.backupDirectory, manifestName), "utf8")),
    );
    assert.equal(manifest.authorityGeneration, generation);
    // No temporary file survives a completed run.
    assert.deepEqual(entries.filter((name) => name.endsWith(".tmp")), []);
  });

  it("refuses when no authority database exists and creates nothing", async () => {
    const p = paths();
    const outcome = await composeStorageCommand(rebuildRuntimeIsolation, ["backup"], CLOCK, p.repoRoot);
    assert.equal(outcome.exitCode, 1);
    assert.match(outcome.output, /storage backup REFUSED — no authority database exists/u);
    assert.equal(existsSync(p.authorityPath), false, "a refused backup must not mint an authority");
    assert.equal(existsSync(p.backupDirectory), false);
  });

  it("lets the doctor exit 0 on a healthy reconciled authority with no backup, reporting it missing", async () => {
    const p = paths();
    createAuthority(p);
    const doctor = await composeStorageCommand(rebuildRuntimeIsolation, ["doctor"], CLOCK, p.repoRoot);
    assert.equal(doctor.exitCode, 0, doctor.output);
    assert.match(doctor.output, /^authority: healthy/mu);
    assert.match(doctor.output, /^backup: MISSING/mu);

    await composeStorageCommand(rebuildRuntimeIsolation, ["backup"], CLOCK, p.repoRoot);
    const after = await composeStorageCommand(rebuildRuntimeIsolation, ["doctor"], CLOCK, p.repoRoot);
    assert.equal(after.exitCode, 0, after.output);
    assert.match(after.output, /^backup: current/mu);
  });
  it.each(["missing", "malformed"])("restores SQLite before reporting %s independent credentials", async (credentialState) => {
    const p = paths(); createAuthority(p);
    const backup = await composeStorageCommand(rebuildRuntimeIsolation, ["backup"], CLOCK, p.repoRoot);
    assert.equal(backup.exitCode, 0, backup.output);
    const manifest = readdirSync(p.backupDirectory).find((name) => name.endsWith(".manifest.json"));
    assert.ok(manifest);
    const credentialPath = join(p.stateRoot, "credentials", "protected.json");
    if (credentialState === "malformed") {
      mkdirSync(join(p.stateRoot, "credentials"), { mode: 0o700 });
      writeFileSync(credentialPath, "synthetic-malformed-credential-canary", { mode: 0o600 });
    }
    const restored = await composeStorageCommand(rebuildRuntimeIsolation,
      ["restore", "--from", join(p.backupDirectory, manifest), "--json"], CLOCK, p.repoRoot);
    assert.equal(restored.exitCode, 0, restored.output);
    const report = z.object({ state: z.literal("restored"), credentials: z.object({ state: z.enum(["available", "unavailable"]) }) }).parse(JSON.parse(restored.output));
    assert.equal(report.credentials.state, credentialState === "missing" ? "available" : "unavailable");
    assert.equal(restored.output.includes("synthetic-malformed-credential-canary"), false);
    if (credentialState === "malformed") assert.equal(readFileSync(credentialPath, "utf8"), "synthetic-malformed-credential-canary");
    else assert.equal(existsSync(join(p.stateRoot, "credentials")), false);
    assert.equal(AuthorityDatabase.inspectExistingReadOnly(p.authorityPath).schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
  });

});
