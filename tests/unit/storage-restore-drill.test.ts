/**
 * The 2j restore drill, driven through the OPERATOR'S OWN COMMAND (D181).
 *
 * Doc 02 §Exit criteria asks that "a real-shaped copied authority DB passes
 * corruption → read-only degraded mode → checksummed-backup restore →
 * projection rebuild with claims/dependencies/checkpoints/intents/outboxes/
 * capture handoffs intact". `storage-recovery.test.ts` already proves the
 * offline restore SERVICE against that shape. What it cannot prove — because
 * the wiring did not exist — is that an operator with a corrupt database and a
 * shell can actually get there: `cli storage restore` was unbuilt, and
 * `RecoveryStopProofStore` refused every proof because nothing in production
 * had ever recorded a runtime-lock snapshot.
 *
 * So this file drills the whole path through `composeStorageCommand`, over a
 * real authority database seeded with one row in each family the exit
 * criterion names. Nothing is stubbed except the clock: the corruption is real
 * bytes written over a real SQLite file, the checksum is really re-verified,
 * the projections are really rebuilt against the staged copy, and the swap is
 * the real atomic rename.
 */
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { z } from "zod";
import { rebuildRuntimeIsolation } from "../../src/config/runtime-isolation.js";
import { manualClock } from "../../src/domain/clock.js";
import { CaptureSessionSchema } from "../../src/domain/capture.js";
import { AuthorityBackupService, AuthorityDatabase } from "../../src/infra/sqlite/index.js";
import {
  acquireRuntimeProcessLock,
  observeRuntimeLockSnapshot,
  readRuntimeProcessLock,
} from "../../src/infra/sqlite/runtime-process-locks.js";
import { composeStorageCommand } from "../../src/server/storage/compose.js";
import {
  COMMAND_FIXTURES,
  HASH_A,
  NOW,
  NOTIFICATION,
  UUID_7,
  WRITE_ATTEMPT,
  WRITE_INTENT_ATTEMPTING,
} from "./fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN } from "./fixtures/phase1f-run-fixtures.js";

const CLOCK = manualClock(new Date(NOW));
const LATER = "2026-08-01T09:00:00.000Z";
const CommandIdentitySchema = z.object({ commandId: z.string().min(1) });
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

interface DrillPaths {
  readonly repoRoot: string;
  readonly stateRoot: string;
  readonly authorityPath: string;
  readonly backupDirectory: string;
  readonly processLockRoot: string;
}

function drillPaths(): DrillPaths {
  const repoRoot = mkdtempSync(join(tmpdir(), "hrauto-2j-restore-"));
  roots.push(repoRoot);
  const stateRoot = join(repoRoot, rebuildRuntimeIsolation.stateRoot);
  mkdirSync(stateRoot, { recursive: true });
  // The command reads the running build's version out of its repo root, the
  // same way the dashboard composition does; the drill's root is a repo root.
  writeFileSync(join(repoRoot, "package.json"), JSON.stringify({ name: "drill", version: "0.1.0" }));
  return {
    repoRoot,
    stateRoot,
    authorityPath: join(stateRoot, "state.db"),
    backupDirectory: join(stateRoot, "backups", "authority"),
    processLockRoot: join(repoRoot, rebuildRuntimeIsolation.processLockRoot),
  };
}

function open(paths: DrillPaths): AuthorityDatabase {
  return AuthorityDatabase.open(
    { path: paths.authorityPath, busyTimeoutMs: 250, migrationOwner: "restore-drill" },
    CLOCK,
  );
}

/** `COMMAND_FIXTURES` is a `readonly unknown[]`, so its id is read by schema. */
function seededCommandId(): string {
  return CommandIdentitySchema.parse(COMMAND_FIXTURES[0]).commandId;
}

function captureSession() {
  return CaptureSessionSchema.parse({
    sessionId: UUID_7,
    tokenDigest: HASH_A,
    workflow: "person-lookup",
    state: "open",
    photoRefs: [],
    handoff: { state: "pending" },
    finalizationGeneration: 0,
    version: 1,
    createdAt: NOW,
    expiresAt: LATER,
  });
}

/**
 * One row in each durable family doc 02 §Exit criteria names, written through the
 * real repositories. `claimNext` is what makes the claim REAL — a hand-written
 * claim column would not be the thing the sweeper and the executor read.
 */
function seedRealShapedAuthority(database: AuthorityDatabase): Readonly<{
  claimGeneration: number;
  runId: string;
}> {
  database.authority.commands.insert(COMMAND_FIXTURES[0]);
  database.authority.runs.enqueue(QUEUED_RUN);
  const claimed = database.authority.runs.claimNext({
    workflow: QUEUED_RUN.envelope.workflow,
    workerId: "person-lookup-worker-1",
    now: NOW,
  });
  assert.equal(claimed.state, "claimed");
  const claimGeneration = claimed.state === "claimed" ? claimed.run.claimGeneration : -1;
  const fenced = database.authority.writeIntents.fenceAttempt({
    intent: WRITE_INTENT_ATTEMPTING,
    attempt: WRITE_ATTEMPT,
  });
  assert.equal(fenced.state, "fenced");
  database.authority.captureSessions.create(captureSession());
  return { claimGeneration, runId: String(QUEUED_RUN.envelope.runId) };
}

async function takeBackup(database: AuthorityDatabase, paths: DrillPaths): Promise<string> {
  const service = new AuthorityBackupService(database, { directory: paths.backupDirectory }, CLOCK);
  const report = await service.request({
    trigger: "operator",
    requiredGeneration: database.getMeta().authorityGeneration,
  });
  const manifest = report.manifests.at(-1);
  assert.ok(manifest !== undefined, "the backup run produced no manifest");
  return join(paths.backupDirectory, `${manifest.backupFileName}.manifest.json`);
}

/**
 * Corruption, not truncation. Overwriting the interior pages while leaving the
 * SQLite header intact is what produces `database disk image is malformed`
 * from `quick_check` rather than "file is not a database" from the very first
 * byte — the harder of the two for the doctor to name correctly.
 */
function corrupt(paths: DrillPaths): void {
  const bytes = readFileSync(paths.authorityPath);
  bytes.fill(0x5a, 4096, Math.min(bytes.length, 40_960));
  writeFileSync(paths.authorityPath, bytes);
}

describe("2j — corruption → degraded → restore → rebuild, through the CLI", () => {
  it("names the corruption read-only, restores the named backup, and keeps every authority family", async () => {
    const paths = drillPaths();
    const database = open(paths);
    const seeded = seedRealShapedAuthority(database);
    const generation = database.getMeta().authorityGeneration;
    const manifestPath = await takeBackup(database, paths);
    // A row written AFTER the backup is the control: it must be gone
    // afterwards, because a restore that silently kept it would not be a
    // restore of the bytes the manifest checksums.
    database.authority.notifications.create(NOTIFICATION);
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
    // …and it left the corrupt bytes exactly as they were: a doctor that
    // repaired anything would destroy the evidence the restore quarantines.
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
    const quarantined = readdirSync(join(paths.stateRoot, "suspects"));
    const suspects = quarantined.filter((name) => name.endsWith(".sqlite"));
    assert.equal(suspects.length, 1, quarantined.join(","));
    assert.equal(
      readFileSync(join(paths.stateRoot, "suspects", suspects[0] ?? "")).equals(afterDoctor),
      true,
    );

    // 4 — every family the exit criterion names survived.
    const reopened = open(paths);
    try {
      assert.deepEqual(reopened.authority.commands.get(seededCommandId()), COMMAND_FIXTURES[0]);
      const run = reopened.authority.runs.get(seeded.runId);
      assert.ok(run !== undefined);
      assert.equal(run.claimGeneration, seeded.claimGeneration);
      assert.equal(run.lifecycle.state, "claimed");
      assert.deepEqual(
        reopened.authority.writeIntents.get(WRITE_INTENT_ATTEMPTING.writeIntentId),
        WRITE_INTENT_ATTEMPTING,
      );
      assert.deepEqual(reopened.authority.captureSessions.get(UUID_7), captureSession());
      assert.equal(reopened.getMeta().authorityGeneration, generation);
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
  });

  it("refuses while a live process holds a runtime lock, and touches nothing", async () => {
    const paths = drillPaths();
    const database = open(paths);
    seedRealShapedAuthority(database);
    const manifestPath = await takeBackup(database, paths);
    database.close();
    corrupt(paths);
    const corrupted = readFileSync(paths.authorityPath);

    // This test process IS a live pid, which is exactly the condition.
    const held = acquireRuntimeProcessLock(
      { processLockRoot: paths.processLockRoot, name: "server", pid: process.pid },
      CLOCK,
    );
    try {
      const refused = await composeStorageCommand(
        rebuildRuntimeIsolation,
        ["restore", "--from", manifestPath],
        CLOCK,
        paths.repoRoot,
      );
      assert.equal(refused.exitCode, 1);
      assert.match(refused.output, /authority restore REFUSED/u);
      assert.match(refused.output, new RegExp(`server process lock generation 1 is active for pid ${String(process.pid)}`, "u"));
      assert.match(refused.output, /the live authority database was not modified/u);
      assert.match(refused.output, new RegExp(`server=ACTIVE pid ${String(process.pid)}`, "u"));
      assert.equal(readFileSync(paths.authorityPath).equals(corrupted), true);
      assert.equal(existsSync(join(paths.stateRoot, "suspects")), false);
    } finally {
      held.release();
    }

    // Released, the same command succeeds — the refusal was about the lock,
    // not about the backup.
    const after = await composeStorageCommand(
      rebuildRuntimeIsolation,
      ["restore", "--from", manifestPath],
      CLOCK,
      paths.repoRoot,
    );
    assert.equal(after.exitCode, 0, after.output);
  });

  it("observes a crashed holder as stopped rather than bricking recovery", async () => {
    const paths = drillPaths();
    const database = open(paths);
    seedRealShapedAuthority(database);
    const manifestPath = await takeBackup(database, paths);
    database.close();
    corrupt(paths);

    // A worker that died without releasing: the file still says `held`, but
    // the pid is gone. Refusing here forever would make a crash unrecoverable.
    acquireRuntimeProcessLock(
      { processLockRoot: paths.processLockRoot, name: "workers", pid: deadPid() },
      CLOCK,
    );
    const snapshot = observeRuntimeLockSnapshot(
      { processLockRoot: paths.processLockRoot, sourceDatabaseIdentity: AuthorityDatabase.sourceDatabaseIdentity(paths.authorityPath) },
      CLOCK,
    );
    assert.equal(snapshot.processLocks.workers.state, "stopped");
    // The lock FILE is untouched by the observation — nothing rewrites another
    // process's record to make a restore possible.
    assert.equal(readRuntimeProcessLock(paths.processLockRoot, "workers")?.releasedAt, null);

    const restored = await composeStorageCommand(
      rebuildRuntimeIsolation,
      ["restore", "--from", manifestPath],
      CLOCK,
      paths.repoRoot,
    );
    assert.equal(restored.exitCode, 0, restored.output);
  });

  it("refuses a second live holder of one role lock", () => {
    const paths = drillPaths();
    const first = acquireRuntimeProcessLock(
      { processLockRoot: paths.processLockRoot, name: "server", pid: process.pid },
      CLOCK,
    );
    assert.throws(
      () => acquireRuntimeProcessLock(
        { processLockRoot: paths.processLockRoot, name: "server", pid: process.pid },
        CLOCK,
      ),
      /server process lock is held by live pid/u,
    );
    first.release();
    // Released, the next acquire takes the NEXT generation — that advance is
    // what fences a stopped-system proof issued before the restart.
    const second = acquireRuntimeProcessLock(
      { processLockRoot: paths.processLockRoot, name: "server", pid: process.pid },
      CLOCK,
    );
    assert.equal(second.generation, 2);
    second.release();
  });

  it("refuses restore without an exact named manifest", async () => {
    const paths = drillPaths();
    const database = open(paths);
    seedRealShapedAuthority(database);
    database.close();
    const usage = await composeStorageCommand(
      rebuildRuntimeIsolation,
      ["restore"],
      CLOCK,
      paths.repoRoot,
    );
    assert.equal(usage.exitCode, 2);
    assert.match(usage.output, /requires the exact backup manifest/u);
    // A missing manifest is a refusal that names the file, never a fall-back
    // to whatever backup happens to be newest.
    const missing = await composeStorageCommand(
      rebuildRuntimeIsolation,
      ["restore", "--from", join(paths.backupDirectory, "no-such.manifest.json")],
      CLOCK,
      paths.repoRoot,
    );
    assert.equal(missing.exitCode, 1);
    assert.match(missing.output, /no-such\.manifest\.json does not exist/u);
  });
});

/**
 * A pid that is certainly not running. Node reserves nothing here, so the loop
 * walks upward until the OS reports `ESRCH`; on a machine where every id is
 * taken the test fails loudly rather than silently choosing a live process.
 */
function deadPid(): number {
  for (let candidate = 2 ** 21; candidate < 2 ** 21 + 512; candidate += 1) {
    if (!pidExists(candidate)) return candidate;
  }
  throw new Error("could not find a dead pid to stand in for a crashed worker");
}

function pidExists(pid: number): boolean {
  const outcome = probePid(pid);
  return outcome.state === "present";
}

function probePid(pid: number): Readonly<{ state: "present" | "absent" }> {
  try {
    process.kill(pid, 0);
    return { state: "present" };
  } catch (error) {
    return { state: typeof error === "object" && error !== null && Reflect.get(error, "code") === "ESRCH" ? "absent" : "present" };
  }
}
