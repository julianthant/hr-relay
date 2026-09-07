import { RunRecordService } from "../../src/core/run-record-service.js";
import { randomUUID } from "node:crypto";
import { createSpanJsonlWriter } from "../../src/infra/events/span-jsonl-writer.js";
import { QUEUED_RUN } from "./fixtures/phase1f-run-fixtures.js";
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
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { z } from "zod";
import { rebuildRuntimeIsolation } from "../../src/config/runtime-isolation.js";
import { manualClock } from "../../src/domain/clock.js";
import { AuthorityDatabase } from "../../src/infra/sqlite/index.js";
import { composeStorageCommand } from "../../src/server/storage/compose.js";

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
  it("M18 real restore leaves fenced span-only identity absent and reports possible external write", async () => {
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
    const restore = await composeStorageCommand(rebuildRuntimeIsolation, ["restore", "--from", join(p.backupDirectory, manifest), "--json"], CLOCK, p.repoRoot);
    assert.equal(restore.exitCode, 0, restore.output);
    const doctor = await composeStorageCommand(rebuildRuntimeIsolation, ["doctor", "--json"], CLOCK, p.repoRoot);
    assert.equal(doctor.exitCode, 1);
    const report = z.object({ spanAuthority: z.object({ problems: z.array(z.object({ state: z.literal("missing"), runId: z.string(), possibleExternalWrite: z.literal(true) })) }) }).parse(JSON.parse(doctor.output));
    assert.deepEqual(report.spanAuthority.problems, [{ state: "missing", runId: e.runId, possibleExternalWrite: true }]);
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
    assert.equal(AuthorityDatabase.inspectExistingReadOnly(p.authorityPath).schemaVersion, 32);
  });

});
