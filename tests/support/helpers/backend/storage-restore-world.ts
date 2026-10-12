import { ATOMIC_WRITE_COMMIT as HISTORICAL_COMMIT, COMMAND_FIXTURES, NOW, WRITE_ATTEMPT, WRITE_INTENT_ATTEMPTING } from "../../fixtures/phase1c-contract-fixtures.js";
import { seedAtomicWriteOwner } from "../timeline-write-fixture.js";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { composeStorageCommand as composeNativeStorageCommand } from "../../../../src/backend/app/composition/storage-compose.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { type RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { AuthorityBackupService } from "../../../../src/backend/storage/sqlite/backup-service.js";

export interface DrillPaths {
  readonly repoRoot: string;
  readonly admission: RuntimeAdmission;
  readonly stateRoot: string;
  readonly authorityPath: string;
  readonly backupDirectory: string;
  readonly processLockRoot: string;
}



export function createStorageRestoreTestWorld() {
  const CLOCK = manualClock(new Date(NOW));

  const roots: string[] = [];

  const admissions = new Map<string,RuntimeAdmission>();

  async function composeStorageCommand(isolation:typeof rebuildRuntimeIsolation,args:readonly string[],clock:typeof CLOCK,repoRoot:string){const admission=admissions.get(repoRoot);assert.ok(admission);return composeNativeStorageCommand(isolation,args,clock,repoRoot,admission);}

  function drillPaths(): DrillPaths {
    const repoRoot = mkdtempSync(join(realpathSync(tmpdir()), "native-restore-drill-"));
    roots.push(repoRoot);
    const admission=acquireEntrypointAdmission(repoRoot,"exclusive");admissions.set(repoRoot,admission);
    const stateRoot = admission.stateRoot;
    mkdirSync(stateRoot, { recursive: true });
    // The command reads the running build's version out of its repo root, the
    // same way the dashboard composition does; the drill's root is a repo root.
    writeFileSync(join(repoRoot, "package.json"), JSON.stringify({ name: "drill", version: "0.1.0" }));
    return {
      repoRoot,
      admission,
      stateRoot,
      authorityPath: join(stateRoot, "state.db"),
      backupDirectory: join(stateRoot, "backups", "authority"),
      processLockRoot: join(repoRoot, rebuildRuntimeIsolation.processLockRoot),
    };
  }

  function open(paths: DrillPaths): AuthorityDatabase {
    return AuthorityDatabase.open(paths.admission,
      { path: paths.authorityPath, busyTimeoutMs: 250, migrationOwner: "restore-drill" },
      CLOCK,
    );
  }

  function seedRealShapedAuthority(database: AuthorityDatabase, paths:DrillPaths): Readonly<{
    claimGeneration: number;
    runId: string;
  }> {
    database.authority.commands.insert(COMMAND_FIXTURES[0]);
    seedAtomicWriteOwner(database,HISTORICAL_COMMIT,paths.authorityPath);
    const run=database.authority.runs.get(WRITE_INTENT_ATTEMPTING.runId);assert.ok(run);
    const claimGeneration=run.claimGeneration;
    const fenced = database.authority.writeIntents.fenceAttempt({
      intent: WRITE_INTENT_ATTEMPTING,
      attempt: WRITE_ATTEMPT,
    });
    assert.equal(fenced.state, "fenced");
    return { claimGeneration, runId: String(WRITE_INTENT_ATTEMPTING.runId) };
  }

  async function takeBackup(database: AuthorityDatabase, paths: DrillPaths): Promise<string> {
    const service = new AuthorityBackupService(paths.admission,database, { directory: paths.backupDirectory }, CLOCK);
    const report = await service.request({
      trigger: "operator",
      requiredGeneration: database.getMeta().authorityGeneration,
    });
    const manifest = report.manifests.at(-1);
    assert.ok(manifest !== undefined, "the backup run produced no manifest");
    return join(paths.backupDirectory, `${manifest.backupFileName}.manifest.json`);
  }

  function corrupt(paths: DrillPaths): void {
    const bytes = readFileSync(paths.authorityPath);
    bytes.fill(0x5a, 4096, Math.min(bytes.length, 40_960));
    writeFileSync(paths.authorityPath, bytes);
  }

  function pretendAliveIdentity(pid: number) {
    return {
      state: "alive" as const,
      identity: { platform: "darwin" as const, startToken: `synthetic-${String(pid)}` },
    };
  }

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
  const cleanup = () => {
    for(const admission of admissions.values())admission.release();admissions.clear();
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  };
  return { CLOCK, roots, admissions, composeStorageCommand, drillPaths, open, seedRealShapedAuthority, takeBackup, corrupt, pretendAliveIdentity, deadPid, cleanup };
}
