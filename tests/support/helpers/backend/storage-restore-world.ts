import { randomUUID } from "node:crypto";
import { RunRecordSchema, runClaim } from "../../../../src/models/run/record.js";
import { WorkerPoolMemberSchema, type WorkerPoolMember } from "../../../../src/models/run/worker-slot.js";
import { WorkerLeaseRecordSchema, type WorkerLeaseRecord } from "../../../../src/models/run/worker.js";
import { RuntimeAlreadyRunningError, RuntimeLifetimeLock } from "../../../../src/backend/storage/admission/lifetime-lock.js";
import { AuthoritySourceClosureUnprovedError, retainAuthoritySourceClosure } from '../../../../src/backend/storage/source-closure.js';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { FakeKeyringEntry, credentialKeychainTestEnvironment } from "../credential-keychain-fake.js";
import { acquireEntrypointAdmission } from '../../../../src/backend/storage/admission/bootstrap-admission.js';
import { createProfileRegistry } from '../../../../src/backend/profiles/registry.js';
import { registerBoundProfile, unregisterBoundProfile, createBoundProfileFixture, boundProfileCredentials } from "../admission-fixture.js";
import { fenceWriteFixture } from "../write-fence-fixture.js";
import { ATOMIC_WRITE_COMMIT as HISTORICAL_COMMIT, COMMAND_FIXTURES, NOW, WRITE_ATTEMPT, WRITE_INTENT_ATTEMPTING } from "../../fixtures/phase1c-contract-fixtures.js";
import { seedAtomicWriteOwner } from "../timeline-write-fixture.js";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from 'node:path';
import { composeStorageCommand as composeNativeStorageCommand } from "../../../../src/backend/app/composition/storage-compose.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { type RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import type { CredentialStore } from "../../../../src/models/config/credential-store.js";
import { AuthorityDatabase } from "../synthetic-database-admission.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { AuthorityBackupService } from "../../../../src/backend/storage/sqlite/backup-service.js";

/** ESRCH: no such process. EPERM: the ID now belongs to another user's process, so our child is gone (CI reuses IDs quickly). */
function isNotOurProcess(error: unknown): boolean {
  const code = error instanceof Error && "code" in error ? error.code : undefined;
  return code === "ESRCH" || code === "EPERM";
}

export interface DrillPaths {
  readonly repoRoot: string;
  readonly lifetime: RuntimeLifetimeLock;
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

  const admissions = new Map<string, Pick<Awaited<ReturnType<typeof createBoundProfileFixture>>, 'admission' | 'close' | 'lifetime'>>();
  const attemptChildren = new Map<ReturnType<typeof spawn>, Promise<readonly PromiseSettledResult<unknown>[]>>();
  const retainedAttemptScratch = new Set<string>();
  const attemptDatabases = new Map<string, { database: AuthorityDatabase; closeDatabase: () => void;
    shareWithSuccessor(child: ReturnType<typeof spawn>): Promise<void> }>();
  let successorPermitsIssued = 0;
  const attemptClosureFailures = new Set<AuthoritySourceClosureUnprovedError>();

  async function composeStorageCommand(isolation:typeof rebuildRuntimeIsolation,args:readonly string[],clock:typeof CLOCK,repoRoot:string){const fixture=admissions.get(repoRoot);assert.ok(fixture);return composeNativeStorageCommand(isolation,args,clock,repoRoot,fixture.admission,boundProfileCredentials(fixture.admission));}

  async function drillPaths(): Promise<DrillPaths> {
    const fixture = await createBoundProfileFixture();
    const repoRoot = fixture.workspace, stateRoot = fixture.stateRoot;
    roots.push(repoRoot);
    admissions.set(repoRoot, fixture);
    writeFileSync(join(repoRoot, "package.json"), JSON.stringify({ name: "drill", version: "0.1.0" }));
    return {
      repoRoot, lifetime: fixture.lifetime,
      get admission() { return fixture.admission; },
      get credentials() { return boundProfileCredentials(fixture.admission); },
      renewAfterRestore() { fixture.renewAfterRestore(); },
      stateRoot,
      authorityPath: fixture.path,
      backupDirectory: join(stateRoot, "backups", "authority"),
      processLockRoot: join(repoRoot, rebuildRuntimeIsolation.processLockRoot),
    };
  }

  async function attemptingDrillPaths(heldRoot?: Readonly<{
    kind: "root" | "inherited-child";
    inspect(input: Readonly<{ repoRoot: string; authorityPath: string; stateRoot: string; port: number; manifestPath: string;
      closeRootListener(): Promise<void> }>): Promise<void>;
  }>, accounting?: Readonly<{ backupAfterCommit: boolean }>, options: Readonly<{ crashedHolder?: true }> = {}): Promise<{
    paths: DrillPaths; database: AuthorityDatabase; closeDatabase: () => void; manifestPath: string; beforeManifestPath: string;
    originalChild: { pid: number; signal: "SIGKILL" };
    workerLease: WorkerLeaseRecord;
  }> {
    if (options.crashedHolder === true) assert.equal(heldRoot, undefined);
    const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'relay-restore-attempt-')));
    retainedAttemptScratch.add(scratch);
    const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
    const portOwner = await RuntimeLifetimeLock.acquire(0), port = portOwner.port;
    await portOwner.close();
    let lifetimeLock: RuntimeLifetimeLock | undefined;
    const child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('../../../support/processes/storage-restore-attempt-worker.ts', import.meta.url)), String(port), options.crashedHolder === true ? 'crashed-holder' : heldRoot?.kind ?? 'root', ...(accounting === undefined ? [] : [accounting.backupAfterCommit ? 'after' : 'before'])], {
      cwd: sourceRoot, env: credentialKeychainTestEnvironment({ ...process.env, TMPDIR: scratch }), detached: true,
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
      const awaitingReceipt = Promise.race([once(child, 'message'), ending.then(() => {
        throw new Error('storage-restore-attempt-worker-exited-before-checkpoint');
      })]);
      const message: unknown = (await awaitingReceipt)[0];
      const receipt = z.strictObject({ state: z.literal('attempting'), workspace: z.string().min(1),
        stateRoot: z.string().min(1), authorityPath: z.string().min(1), profileId: z.string().min(1),
        installationId: z.uuid(), workerId: z.string().min(1), processLockRoot: z.string().min(1),
        keychain: z.array(z.tuple([z.string().min(1), z.string().min(1)])).length(1), manifestPath: z.string().min(1), beforeManifestPath: z.string().min(1),
        pid: z.number().int().positive(),
        claimGeneration: z.number().int().positive(), runId: z.string().min(1),
        databaseClosed: z.literal(true), retained: z.literal(true), workerLease: WorkerLeaseRecordSchema }).parse(message);
      assert.equal(receipt.pid, child.pid);
      assert.equal(realpathSync(receipt.workspace), receipt.workspace);
      assert.equal(dirname(receipt.workspace), scratch);
      assert.equal(receipt.processLockRoot, join(receipt.workspace, rebuildRuntimeIsolation.processLockRoot));
      assert.equal(receipt.authorityPath, join(receipt.stateRoot, "state.db"));
      await assert.rejects(async () => {
        const competing = await RuntimeLifetimeLock.acquire(port);
        try { assert.fail("attempt controller listener was not retained"); }
        finally { await competing.close(); }
      }, RuntimeAlreadyRunningError);
      assert.equal(receipt.stateRoot, join(receipt.workspace, rebuildRuntimeIsolation.stateRoot, "profiles", receipt.profileId));
      assert.equal(dirname(receipt.manifestPath), join(receipt.stateRoot, "backups", "authority"));
      assert.equal(dirname(receipt.beforeManifestPath), join(receipt.stateRoot, "backups", "authority"));
      assert.equal(receipt.keychain[0]?.[0], `Relay:${receipt.installationId}:${receipt.profileId}`);
      FakeKeyringEntry.import(receipt.keychain);
      const nextMessage = () => Promise.race([once(child, 'message'), ending.then(() => {
        throw new Error('storage-restore-attempt-worker-exited-before-release');
      })]);
      if (heldRoot !== undefined) {
        await heldRoot.inspect({ repoRoot: receipt.workspace, authorityPath: receipt.authorityPath, stateRoot: receipt.stateRoot,
          port, manifestPath: receipt.manifestPath, async closeRootListener() {
            assert.equal(heldRoot.kind, "inherited-child");
            const closed = nextMessage(); child.send({ state: "close-root-listener" });
            assert.deepEqual((await closed)[0], { state: "root-listener-closed" });
          } });
        if (heldRoot.kind === "inherited-child") {
          const closed = nextMessage(); child.send({ state: "release-inherited" });
          assert.deepEqual((await closed)[0], { state: "inherited-closed" });
        }
      }
      assert.equal(receipt.workerLease.workerId, receipt.workerId);
      assert.equal(receipt.workerLease.processId, receipt.pid);
      assert.notEqual(receipt.workerLease.lifecycle.state, "stopped");
      assert.equal(child.exitCode, null); assert.equal(child.signalCode, null);
      process.kill(-receipt.pid, 0);
      assert.equal(child.kill('SIGKILL'), true);
      const ended = await ending;
      for (const result of ended) {
        if (result.status !== 'fulfilled') throw result.reason;
        assert.equal(result.status, 'fulfilled');
        assert.deepEqual(result.value, [null, 'SIGKILL']);
      }
      for (const pid of [receipt.pid, -receipt.pid]) {
        assert.throws(() => process.kill(pid, 0), isNotOurProcess);
      }
      const descriptors = spawnSync('lsof', ['-nP', '-t', '+D', receipt.workspace], { encoding: 'utf8' });
      assert.equal(descriptors.error, undefined);
      assert.equal(descriptors.status, 1);
      assert.equal(descriptors.stdout, '');
      assert.equal(descriptors.stderr, '');
      attemptChildren.delete(child);
      workspace = receipt.workspace;
      lifetimeLock = await RuntimeLifetimeLock.acquire(port);
      machine = acquireEntrypointAdmission(receipt.workspace, 'exclusive', lifetimeLock);
      admission = machine.admitProfile(createProfileRegistry(machine).storageClaim(receipt.profileId));
      assert.equal(admission.stateRoot, receipt.stateRoot);
      assert.equal(admission.profileBinding.installationId, receipt.installationId);
      registerBoundProfile(admission, machine); registered = true;
      let heldMachine = machine;
      const heldLifetime = lifetimeLock;
      let heldAdmission = admission;
      const fixture = { lifetime: heldLifetime, get admission() { return heldAdmission; }, async close() {
        unregisterBoundProfile(heldAdmission); heldAdmission.release(); heldMachine.release(); await heldLifetime.close();
        rmSync(scratch, { recursive: true, force: true }); retainedAttemptScratch.delete(scratch);
      } };
      admissions.set(receipt.workspace, fixture);
      roots.push(receipt.workspace);
      writeFileSync(join(receipt.workspace, "package.json"), JSON.stringify({ name: "drill", version: "0.1.0" }));
      const paths: DrillPaths = { repoRoot: receipt.workspace, lifetime: heldLifetime, get admission() { return heldAdmission; },
        get credentials() { return boundProfileCredentials(heldAdmission); }, stateRoot: receipt.stateRoot,
        authorityPath: receipt.authorityPath, backupDirectory: join(receipt.stateRoot, "backups", "authority"),
        processLockRoot: receipt.processLockRoot, renewAfterRestore() {
          unregisterBoundProfile(heldAdmission); heldAdmission.release();
          heldAdmission = heldMachine.admitProfile(createProfileRegistry(heldMachine).storageClaim(receipt.profileId));
          registerBoundProfile(heldAdmission, heldMachine);
        } };
      database = open(paths);
      attemptDatabases.set(receipt.workspace, { database, closeDatabase, async shareWithSuccessor(successor) {
        try {
          closeDatabase();
          unregisterBoundProfile(heldAdmission); heldAdmission.release(); heldMachine.release();
          heldMachine = acquireEntrypointAdmission(receipt.workspace, "shared", heldLifetime);
          heldAdmission = heldMachine.admitProfile(createProfileRegistry(heldMachine).storageClaim(receipt.profileId));
          registerBoundProfile(heldAdmission, heldMachine);
          await heldLifetime.share(successor);
        } catch (error) {
          const retained = retainAuthoritySourceClosure([error], { admission: { heldMachine, heldAdmission },
            directory: { successor, scratch, heldLifetime } });
          attemptClosureFailures.add(retained); throw retained;
        }
      } });
      assert.equal(child.signalCode, 'SIGKILL');
      assert.deepEqual(database.authority.workerLeases.get(receipt.workerId), receipt.workerLease);
      const run = database.authority.runs.get(receipt.runId);
      assert.ok(run);
      assert.equal(run.claimGeneration, receipt.claimGeneration);
      assert.equal(database.authority.writeIntents.get(WRITE_INTENT_ATTEMPTING.writeIntentId)?.status, accounting === undefined ? 'attempting' : 'committed');
      return { paths, database, closeDatabase, manifestPath: receipt.manifestPath, beforeManifestPath: receipt.beforeManifestPath,
        originalChild: { pid: receipt.pid, signal: "SIGKILL" }, workerLease: receipt.workerLease };
    } catch (error) {
      writeFileSync(join(scratch, 'child.stdout'), Buffer.concat(stdout), { mode: 0o600 });
      writeFileSync(join(scratch, 'child.stderr'), Buffer.concat(stderr), { mode: 0o600 });
      if (error instanceof AuthoritySourceClosureUnprovedError) {
        const retained = retainAuthoritySourceClosure([error], { database, admission, directory: { machine, child, scratch, lifetimeLock } });
        attemptClosureFailures.add(retained); throw retained;
      }
      try { closeDatabase(); }
      catch (closeError) {
        const retained = retainAuthoritySourceClosure([error, closeError], { database, admission, directory: { machine, child, scratch, lifetimeLock } });
        attemptClosureFailures.add(retained); throw retained;
      }
      try {
        if (registered && admission !== undefined) unregisterBoundProfile(admission);
        admission?.release(); machine?.release(); await lifetimeLock?.close();
      } catch (cleanupError) {
        const retained = retainAuthoritySourceClosure([error, cleanupError], { database, admission,
          directory: { machine, child, scratch, lifetimeLock } });
        attemptClosureFailures.add(retained); throw retained;
      }
      if (workspace !== undefined) { admissions.delete(workspace); attemptDatabases.delete(workspace); }
      throw error;
    }
  }

  async function renewConfirmedInSuccessor(paths: DrillPaths, input: Readonly<{
    runId: string; member: WorkerPoolMember; oldLeaseGeneration: number; oldProcessId: number; oldLeaseStartedAt: string;
    oldClaimGeneration: number; oldAttempt: number;
    expectedPoolVersion: number; now: string;
  }>) {
    const owner = attemptDatabases.get(paths.repoRoot); assert.ok(owner);
    const nonce = randomUUID(), scratch = dirname(paths.repoRoot);
    const successor = spawn(process.execPath, ["--import", "tsx", fileURLToPath(new URL("../../../support/processes/storage-restore-attempt-worker.ts", import.meta.url)),
      "successor-renew-confirmed", String(paths.lifetime.port), paths.repoRoot, paths.admission.profileBinding.profileId], {
      cwd: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.."), detached: true,
      env: credentialKeychainTestEnvironment({ ...process.env, TMPDIR: scratch }), stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    const ending = Promise.allSettled([once(successor, "exit"), once(successor, "close")]);
    attemptChildren.set(successor, ending);
    const stdout: Buffer[] = [], stderr: Buffer[] = [];
    successor.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
    successor.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
    const receive = () => Promise.race([once(successor, "message"), ending.then(() => {
      throw new Error("confirmed-successor-exited-before-receipt");
    })]);
    try {
      const ready = receive();
      await owner.shareWithSuccessor(successor);
      assert.deepEqual((await ready)[0], { state: "successor-ready" });
      const renewed = receive();
      successorPermitsIssued++;
      successor.send({ nonce, ...input });
      const receipt = z.strictObject({ state: z.literal("successor-renewed"), nonce: z.uuid(),
        run: RunRecordSchema, member: WorkerPoolMemberSchema, lease: WorkerLeaseRecordSchema,
        previousLifetime: z.strictObject({ workerId: z.string().min(1), processId: z.number().int().positive(),
          leaseGeneration: z.number().int().positive(), startedAt: z.string().min(1) }) }).parse((await renewed)[0]);
      assert.equal(receipt.nonce, nonce); assert.deepEqual(receipt.member, input.member);
      assert.deepEqual(receipt.previousLifetime, { workerId: input.member.workerId, processId: input.oldProcessId,
        leaseGeneration: input.oldLeaseGeneration, startedAt: input.oldLeaseStartedAt });
      assert.equal(receipt.run.envelope.runId, input.runId); assert.equal(receipt.run.envelope.attempt, input.oldAttempt);
      assert.equal(receipt.run.claimGeneration, input.oldClaimGeneration + 1);
      const claim = runClaim(receipt.run); assert.ok(claim); assert.equal(claim.workerId, input.member.workerId);
      assert.equal(receipt.lease.workerId, input.member.workerId); assert.equal(receipt.lease.processId, successor.pid);
      assert.equal(receipt.lease.leaseGeneration, input.oldLeaseGeneration + 1);
      assert.ok("workerLifetime" in receipt.run.lifecycle);
      assert.deepEqual(receipt.run.lifecycle.workerLifetime, { membershipRevision: input.member.membershipRevision,
        leaseGeneration: receipt.lease.leaseGeneration });
      for (const closed of await ending) {
        if (closed.status !== "fulfilled") throw closed.reason;
        assert.deepEqual(closed.value, [0, null]);
      }
      assert.ok(successor.pid !== undefined);
      for (const pid of [successor.pid, -successor.pid]) assert.throws(() => process.kill(pid, 0), isNotOurProcess);
      const descriptors = spawnSync("lsof", ["-nP", "-t", "+D", paths.repoRoot], { encoding: "utf8" });
      assert.equal(descriptors.error, undefined); assert.equal(descriptors.status, 1);
      assert.equal(descriptors.stdout, ""); assert.equal(descriptors.stderr, "");
      attemptChildren.delete(successor);
      return { ...receipt, ownedExit: { pid: successor.pid, code: 0, signal: null } };
    } catch (error) {
      writeFileSync(join(scratch, "successor.stdout"), Buffer.concat(stdout), { mode: 0o600 });
      writeFileSync(join(scratch, "successor.stderr"), Buffer.concat(stderr), { mode: 0o600 });
      const retained = retainAuthoritySourceClosure([error], { admission: paths.admission, directory: { owner, successor, scratch, lifetime: paths.lifetime } });
      attemptClosureFailures.add(retained); throw retained;
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
      return { state: isNotOurProcess(error) ? "absent" : "present" };
    }
  }
  const cleanup = async () => {
    for (const [child, ending] of attemptChildren) {
      if (child.pid !== undefined && child.exitCode === null && child.signalCode === null) process.kill(-child.pid, 'SIGKILL');
      await ending;
      if (child.pid !== undefined) for (const pid of [child.pid, -child.pid]) {
        assert.throws(() => process.kill(pid, 0), isNotOurProcess);
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
  return { CLOCK, roots, admissions, composeStorageCommand, drillPaths, attemptingDrillPaths, renewConfirmedInSuccessor,
    get successorPermitsIssued() { return successorPermitsIssued; }, open, seedRealShapedAuthority, takeBackup, corrupt, pretendAliveIdentity, deadPid, cleanup };
}
