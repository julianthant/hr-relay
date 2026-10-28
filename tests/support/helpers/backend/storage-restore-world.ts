import { AuthoritySourceClosureUnprovedError, retainAuthoritySourceClosure } from '../../../../src/backend/storage/source-closure.js';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { acquireEntrypointAdmission } from '../../../../src/backend/storage/admission/bootstrap-admission.js';
import { createProfileRegistry } from '../../../../src/backend/profiles/registry.js';
import { assertWorkerProcessCustody, observeProcessIdentity, ProcessStartIdentitySchema } from '../../../../src/backend/storage/sqlite/runtime-process-locks.js';
import { registerBoundProfile, unregisterBoundProfile } from '../admission-fixture.js';
import { fenceWriteFixture } from "../write-fence-fixture.js";
import { ATOMIC_WRITE_COMMIT as HISTORICAL_COMMIT, COMMAND_FIXTURES, NOW, WRITE_ATTEMPT, WRITE_INTENT_ATTEMPTING } from "../../fixtures/phase1c-contract-fixtures.js";
import { seedAtomicWriteOwner } from "../timeline-write-fixture.js";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { composeStorageCommand as composeNativeStorageCommand } from "../../../../src/backend/app/composition/storage-compose.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { type RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { createBoundProfileFixture, boundProfileCredentials } from "../admission-fixture.js";
import type { CredentialStore } from "../../../../src/models/config/credential-store.js";
import { AuthorityDatabase } from "../synthetic-database-admission.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { AuthorityBackupService } from "../../../../src/backend/storage/sqlite/backup-service.js";

export interface DrillPaths {
  readonly repoRoot: string;
  readonly admission: RuntimeAdmission;
  readonly stateRoot: string;
  readonly authorityPath: string;
  readonly backupDirectory: string;
  readonly processLockRoot: string;
  readonly credentials: CredentialStore;
  renewAfterRestore(): void;
}



export function createStorageRestoreTestWorld() {
  const CLOCK = manualClock(new Date(NOW));

  const roots: string[] = [];

  const admissions = new Map<string, Pick<Awaited<ReturnType<typeof createBoundProfileFixture>>, 'admission' | 'close'>>();
  const attemptChildren = new Map<ReturnType<typeof spawn>, Promise<readonly PromiseSettledResult<unknown>[]>>();
  const retainedAttemptScratch = new Set<string>();
  const attemptDatabases = new Map<string, { database: AuthorityDatabase; closeDatabase: () => void }>();
  const attemptClosureFailures = new Set<AuthoritySourceClosureUnprovedError>();

  async function composeStorageCommand(isolation:typeof rebuildRuntimeIsolation,args:readonly string[],clock:typeof CLOCK,repoRoot:string){const fixture=admissions.get(repoRoot);assert.ok(fixture);return composeNativeStorageCommand(isolation,args,clock,repoRoot,fixture.admission,boundProfileCredentials(fixture.admission));}

  async function drillPaths(): Promise<DrillPaths> {
    const fixture = await createBoundProfileFixture();
    const repoRoot = fixture.workspace, stateRoot = fixture.stateRoot;
    roots.push(repoRoot);
    admissions.set(repoRoot, fixture);
    writeFileSync(join(repoRoot, "package.json"), JSON.stringify({ name: "drill", version: "0.1.0" }));
    return {
      repoRoot,
      get admission() { return fixture.admission; },
      get credentials() { return boundProfileCredentials(fixture.admission); },
      renewAfterRestore() { fixture.renewAfterRestore(); },
      stateRoot,
      authorityPath: fixture.path,
      backupDirectory: join(stateRoot, "backups", "authority"),
      processLockRoot: join(repoRoot, rebuildRuntimeIsolation.processLockRoot),
    };
  }

  async function attemptingDrillPaths(): Promise<{ paths: DrillPaths; database: AuthorityDatabase; closeDatabase: () => void }> {
    const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'relay-restore-attempt-')));
    retainedAttemptScratch.add(scratch);
    const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
    const child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('../../../support/processes/storage-restore-attempt-worker.ts', import.meta.url))], {
      cwd: sourceRoot, env: { ...process.env, TMPDIR: scratch }, detached: true,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    const ending = Promise.allSettled([once(child, 'exit'), once(child, 'close')]);
    attemptChildren.set(child, ending);
    const stdout: Buffer[] = [], stderr: Buffer[] = [];
    child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk));
    let machine: RuntimeAdmission | undefined;
    let admission: RuntimeAdmission | undefined;
    let database: AuthorityDatabase | undefined;
    let closure: { state: "closed" } | { state: "failed"; error: unknown } | undefined = undefined;
    const closeDatabase = () => {
      if (closure?.state === "closed") return;
      if (closure?.state === "failed") throw closure.error;
      if (database === undefined) return;
      try { database.close(); closure = { state: "closed" }; }
      catch (error) { closure = { state: "failed", error }; throw error; }
    };
    let registered = false;
    let workspace: string | undefined;
    try {
      const message: unknown = (await Promise.race([once(child, 'message'), ending.then(() => {
        throw new Error('storage-restore-attempt-worker-exited-before-checkpoint');
      })]))[0];
      const receipt = z.strictObject({ state: z.literal('attempting'), workspace: z.string().min(1),
        stateRoot: z.string().min(1), authorityPath: z.string().min(1), profileId: z.string().min(1),
        workerId: z.string().min(1), acquisitionId: z.uuid(), processLockRoot: z.string().min(1),
        pid: z.number().int().positive(), processIdentity: ProcessStartIdentitySchema,
        claimGeneration: z.number().int().positive(), runId: z.string().min(1),
        databaseClosed: z.literal(true), retained: z.literal(true) }).parse(message);
      assert.equal(receipt.pid, child.pid);
      assert.equal(realpathSync(receipt.workspace), receipt.workspace);
      assert.equal(dirname(receipt.workspace), scratch);
      assert.equal(receipt.processLockRoot, join(receipt.workspace, rebuildRuntimeIsolation.processLockRoot));
      assert.equal(receipt.authorityPath, join(receipt.stateRoot, "state.db"));
      const live = observeProcessIdentity(receipt.pid);
      assert.equal(live.state, 'alive');
      if (live.state !== 'alive') throw new Error('storage-restore-attempt-worker-not-alive');
      assert.deepEqual(live.identity, receipt.processIdentity);
      assertWorkerProcessCustody({ processLockRoot: receipt.processLockRoot, acquisitionId: receipt.acquisitionId,
        pid: receipt.pid, workerId: receipt.workerId, authorityPath: receipt.authorityPath });
      process.kill(-receipt.pid, 0);
      assert.equal(child.kill('SIGKILL'), true);
      const ended = await ending;
      for (const result of ended) {
        if (result.status !== 'fulfilled') throw result.reason;
        assert.equal(result.status, 'fulfilled');
        assert.deepEqual(result.value, [null, 'SIGKILL']);
      }
      for (const pid of [receipt.pid, -receipt.pid]) {
        assert.throws(() => process.kill(pid, 0), (error: unknown) => error instanceof Error
          && 'code' in error && error.code === 'ESRCH');
      }
      const descriptors = spawnSync('lsof', ['-nP', '-t', '+D', receipt.workspace], { encoding: 'utf8' });
      assert.equal(descriptors.error, undefined);
      assert.equal(descriptors.status, 1);
      assert.equal(descriptors.stdout, '');
      assert.equal(descriptors.stderr, '');
      attemptChildren.delete(child);
      workspace = receipt.workspace;
      machine = acquireEntrypointAdmission(receipt.workspace, 'exclusive');
      admission = machine.admitProfile(createProfileRegistry(machine).storageClaim(receipt.profileId));
      assert.equal(admission.stateRoot, receipt.stateRoot);
      registerBoundProfile(admission, machine); registered = true;
      const heldMachine = machine;
      let heldAdmission = admission;
      const fixture = { get admission() { return heldAdmission; }, async close() {
        unregisterBoundProfile(heldAdmission); heldAdmission.release(); heldMachine.release();
        rmSync(scratch, { recursive: true, force: true }); retainedAttemptScratch.delete(scratch);
      } };
      admissions.set(receipt.workspace, fixture);
      roots.push(receipt.workspace);
      writeFileSync(join(receipt.workspace, "package.json"), JSON.stringify({ name: "drill", version: "0.1.0" }));
      const paths: DrillPaths = { repoRoot: receipt.workspace, get admission() { return heldAdmission; },
        get credentials() { return boundProfileCredentials(heldAdmission); }, stateRoot: receipt.stateRoot,
        authorityPath: receipt.authorityPath, backupDirectory: join(receipt.stateRoot, "backups", "authority"),
        processLockRoot: receipt.processLockRoot, renewAfterRestore() {
          unregisterBoundProfile(heldAdmission); heldAdmission.release();
          heldAdmission = heldMachine.admitProfile(createProfileRegistry(heldMachine).storageClaim(receipt.profileId));
          registerBoundProfile(heldAdmission, heldMachine);
        } };
      database = open(paths);
      attemptDatabases.set(receipt.workspace, { database, closeDatabase });
      assert.equal(database.workerLifetimeCustody(receipt.workerId).state, 'dead');
      const run = database.authority.runs.get(receipt.runId);
      assert.ok(run);
      assert.equal(run.claimGeneration, receipt.claimGeneration);
      assert.equal(database.authority.writeIntents.get(WRITE_INTENT_ATTEMPTING.writeIntentId)?.status, 'attempting');
      return { paths, database, closeDatabase };
    } catch (error) {
      writeFileSync(join(scratch, 'child.stdout'), Buffer.concat(stdout), { mode: 0o600 });
      writeFileSync(join(scratch, 'child.stderr'), Buffer.concat(stderr), { mode: 0o600 });
      if (error instanceof AuthoritySourceClosureUnprovedError) {
        attemptClosureFailures.add(error); throw error;
      }
      try { closeDatabase(); }
      catch (closeError) {
        const retained = retainAuthoritySourceClosure([error, closeError], { database, admission, directory: { machine, child, scratch } });
        attemptClosureFailures.add(retained); throw retained;
      }
      try {
        if (registered && admission !== undefined) unregisterBoundProfile(admission);
        admission?.release(); machine?.release();
      } catch (cleanupError) {
        const retained = retainAuthoritySourceClosure([error, cleanupError], { database, admission,
          directory: { machine, child, scratch } });
        attemptClosureFailures.add(retained); throw retained;
      }
      if (workspace !== undefined) { admissions.delete(workspace); attemptDatabases.delete(workspace); }
      throw error;
    }
  }

  function open(paths: DrillPaths): AuthorityDatabase {
    return AuthorityDatabase.open(
      { path: paths.authorityPath, busyTimeoutMs: 250, migrationOwner: "restore-drill" }, CLOCK,
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
    const fenced = fenceWriteFixture(database, {
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
  const cleanup = async () => {
    for (const [child, ending] of attemptChildren) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await ending;
      if (child.pid !== undefined) for (const pid of [child.pid, -child.pid]) {
        assert.throws(() => process.kill(pid, 0), (error: unknown) => error instanceof Error
          && 'code' in error && error.code === 'ESRCH');
      }
    }
    attemptChildren.clear();
    if (attemptClosureFailures.size !== 0) throw new AggregateError([...attemptClosureFailures], 'storage-restore-attempt-closure-retained');
    for (const [root, fixture] of admissions) {
      const owner = attemptDatabases.get(root);
      try { owner?.closeDatabase(); }
      catch (error) {
        const retained = retainAuthoritySourceClosure([error], { database: owner?.database, directory: { fixture, owner } });
        attemptClosureFailures.add(retained); throw retained;
      }
      await fixture.close(); attemptDatabases.delete(root);
    }
    admissions.clear();
    roots.splice(0);
    assert.equal(retainedAttemptScratch.size, 0, 'storage-restore-attempt-scratch-retained');
  };
  return { CLOCK, roots, admissions, composeStorageCommand, drillPaths, attemptingDrillPaths, open, seedRealShapedAuthority, takeBackup, corrupt, pretendAliveIdentity, deadPid, cleanup };
}
