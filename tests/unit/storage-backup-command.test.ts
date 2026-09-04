/**
 * D322: an authority backup is written ONLY by `cli storage backup`.
 *
 * The dashboard composition used to own a cadence (start / dirty 15-minute
 * tick / graceful drain). The operator retired it: the state root holds the
 * bare minimum and regenerates itself when deleted, and a SQLite backup exists
 * only when asked for. This file pins the three consequences on the real
 * command surface over a real authority database:
 *
 *  1. `storage backup` writes exactly one verified backup + manifest at the
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
});
