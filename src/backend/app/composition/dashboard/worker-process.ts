import type { ChildProcess } from "node:child_process";
import { spawn as spawnChildProcess } from "node:child_process";
import { lstatSync, rmdirSync } from "node:fs";
import { join } from "node:path";
import { ConfigSchema } from "../../../../models/config/schema.js";
import { DEVELOPMENT_DEBUG_MIRROR_ENV, workerBootstrapEnvironment } from "../../../../models/config/secrets.js";
import { WorkerControlRefusal } from "../../../../models/run/worker-control.js";
import { workerPoolMember } from "../../../../models/run/worker-slot.js";
import { PreflightAdmissionRefusal, type PreflightAdmission, type PreflightAdmissionScope } from "../../../../rules/preflight/preflight-admission.js";
import type { Clock } from "../../../../rules/time/clock.js";
import { BrowserSessionIdSchema } from "../../../../rules/identity/ids.js";
import { JsonValueSchema } from "../../../../rules/validation/canonical-json.js";
import type { IdFactory } from "../../../../rules/identity/identifiers.js";
import { createNominatimGeocodeAdapter } from "../../../processing/providers/geocode-adapters.js";
import type { WorkerMemberState, WorkerPoolRuntimeSeam } from "../../../runs/commands/command-kernel.js";
import { currentBuildId, PARENT_BUILD_ID_ENV } from "../../../runtime/build-id.js";
import { createNativeBrowserProbe } from "../../../runtime/browser/native-browser.js";
import type { MonotonicDeadlineScheduler } from "../../../runtime/scheduling/deadline-scheduler.js";
import { createIpcRouter } from "../../../runtime/workers/worker-ipc-router.js";
import { WORKER_MESSAGE_PREFIX } from "../../../runtime/workers/worker-messages.js";
import { createWorkerPool, WorkerPoolError, type WorkerMemberView, type WorkerPool, type WorkerPoolMember,
  type WorkerProcessPort } from "../../../runtime/workers/worker-pool.js";
import { RuntimeAdmission } from "../../../storage/admission/admission.js";
import { RuntimeLifetimeLock } from "../../../storage/admission/lifetime-lock.js";
import { assertPrivateProfilePath, createBrowserRoots } from "../../../storage/browser-roots.js";
import { AuthorityDatabase } from "../../../storage/sqlite/index.js";

/** Refresh, reopen, parked-write checks and close-for-removal each get this long to reply. */
export const WORKER_REQUEST_DEADLINE_MS = 120_000;

export interface WorkerCliLaunchSpec {
  readonly command: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly prefixArgs: readonly string[];
  readonly cwd: string;
}
export interface WorkerSpawnRequest {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly environment: NodeJS.ProcessEnv;
}
/** `nativeProcess` lets browser-profile removal prove the child's closure through the lifetime lock. */
export type WorkerProcessSpawner = (request: WorkerSpawnRequest) => WorkerProcessPort & { readonly nativeProcess?: ChildProcess };

// Launch through the secure environment bootstrap, never a parallel CLI path.
export function productionWorkerLaunch(repoRoot: string, environment?: NodeJS.ProcessEnv, development = false): WorkerCliLaunchSpec {
  return Object.freeze({
    command: process.execPath,
    environment: Object.freeze({ ...workerBootstrapEnvironment(environment), [PARENT_BUILD_ID_ENV]: currentBuildId(),
      ...(development ? { [DEVELOPMENT_DEBUG_MIRROR_ENV]: "1" } : {}) }),
    prefixArgs: Object.freeze([...(development ? ["--conditions=development"] : []), "--import", "tsx", join(repoRoot, "scripts", "dev", "secure-env-bootstrap.ts"), "cli"]),
    cwd: repoRoot,
  });
}

export interface WorkerPoolCompositionInput {
  readonly admission: RuntimeAdmission;
  readonly sessionGeneration: number;
  readonly profileRoot: string;
  readonly database: AuthorityDatabase;
  readonly clock: Clock;
  readonly scheduler: MonotonicDeadlineScheduler;
  readonly ids: IdFactory;
  readonly launch: WorkerCliLaunchSpec;
  readonly spawn: WorkerProcessSpawner;
  readonly settleExit: (member: WorkerPoolMember) => void | Promise<void>;
  readonly onChange?: (view: WorkerMemberView) => void;
  readonly onFault: (error: Error) => void;
  readonly onStopChannelClosed?: (error: Error) => void;
  /** A member start's readiness gate: a fresh preflight of the profile's current scope, aborted when the pool stops. */
  readonly preflight?: Readonly<{ admission: Pick<PreflightAdmission, "assertReady"> & { prepare(scope: PreflightAdmissionScope, signal: AbortSignal): Promise<unknown> };
    currentScope(): PreflightAdmissionScope }>;
  readonly assertAssistantEffect?: (commandId: string) => void;
  readonly platform?: NodeJS.Platform;
}

/** One pool per profile runtime, plus the kernel's seam over it. */
export function composeWorkerPool(input: WorkerPoolCompositionInput): Readonly<{
  pool: WorkerPool;
  seam: WorkerPoolRuntimeSeam;
  /** Starts every active member of the workflow that has no live process. */
  running(workflowId: string): boolean;
  ensureRunning(workflowId: string): Promise<void>;
  /** Boot: starts every active member of every pool; each failure shows on its card. */
  startActive(): Promise<void>;
  /** Takes startup work no caller waits for; `pool.stopAll` waits for it, so it never outlives the pool. */
  own(work: Promise<void>): void;
}> {
  const profileId = input.admission.profileBinding.profileId;
  const children = new Map<string, ChildProcess>();
  const fault = (error: unknown): Error => error instanceof Error ? error : new Error("worker pool fault", { cause: error });
  const respawned = new Set<string>();
  let respawnOpen = true;
  const poolRef: { current?: WorkerPool } = {};
  // Stopping the pool closes starts: a pending preflight aborts and no member starts after it.
  const starts = new AbortController();
  const owned = new Set<Promise<void>>(), ownedFailures: unknown[] = [];
  const assertStartsOpen = (): void => { if (starts.signal.aborted) throw new WorkerControlRefusal("worker-starts-closed"); };
  const releaseRespawn = (workerId: string): void => { respawned.delete(workerId); };
  const queuedWork = (workflowId: string): boolean => input.database.authority.runs.listByWorkflow(workflowId)
    .some(run => run.lifecycle.state === "queued" && run.pause === undefined);
  const onMemberChange = (view: WorkerMemberView): void => {
    input.onChange?.(view);
    const current = poolRef.current;
    if (current === undefined || !respawnOpen || view.state !== "exited" || view.exit?.outcome !== "crashed" || view.exit.settlement !== "settled") return;
    if (respawned.has(view.member.workerId) || !queuedWork(view.member.workflowId)) return;
    respawned.add(view.member.workerId);
    // onChange runs only after settleExit, so the replacement starts against a settled crash.
    void current.start(view.member).catch((error: unknown) => { input.onFault(fault(error)); });
  };
  const pool = createWorkerPool({
    profileId, sessionGeneration: input.sessionGeneration, clock: input.clock, scheduler: input.scheduler, ids: input.ids,
    platform: input.platform ?? process.platform,
    spawn: member => {
      input.admission.assertProfileRuntime();
      const port = input.spawn({ command: input.launch.command, cwd: input.launch.cwd, environment: input.launch.environment,
        args: [...input.launch.prefixArgs, "worker", member.workflowId, "--pool-index", String(member.poolIndex), "--worker-id", member.workerId,
          "--ordinal", String(member.ordinal), "--launch-command-id", input.ids.uuid(), "--profile-id", profileId,
          "--session-generation", String(input.sessionGeneration)] });
      if (port.nativeProcess === undefined) children.delete(member.workerId);
      else children.set(member.workerId, port.nativeProcess);
      return port;
    },
    // A crashed child can leave a root open; it is probed closed before the exit settles, so the replacement can launch.
    settleExit: async member => { await settleProfiles(member, "recover"); await input.settleExit(member); },
    onChange: onMemberChange,
    onFault: (_member, error) => { input.onFault(fault(error)); },
    onStopChannelClosed: (_member, error) => { input.onStopChannelClosed?.(fault(error)); },
  });
  poolRef.current = pool;
  const viewOf = (workerId: string): WorkerMemberView | undefined => pool.snapshot().find(view => view.member.workerId === workerId);
  const targetOf = (view: WorkerMemberView) => ({ workerId: view.member.workerId, lifetimeId: view.lifetimeId, expectedVersion: view.version });
  const live = (view: WorkerMemberView | undefined): view is WorkerMemberView => view !== undefined && view.state !== "exited";

  const ensure = async (member: WorkerPoolMember): Promise<void> => {
    if (live(viewOf(member.workerId))) return;
    assertStartsOpen();
    releaseRespawn(member.workerId);
    await pool.start(member);
  };
  const stop = async (workerId: string, reason: "operator" | "reset" | "remove"): Promise<void> => {
    const view = viewOf(workerId);
    if (view === undefined) return;
    await pool.stop(targetOf(view), reason);
  };
  /** Probes each of the member's registry roots under parent custody of its closed child; `remove` also deletes them. */
  const settleProfiles = async (member: WorkerPoolMember, mode: "recover" | "remove"): Promise<void> => {
    const roots = createBrowserRoots(input.admission), lifetime = input.admission.lifetime;
    const stoppedProcess = children.get(member.workerId);
    const retained = roots.inventory().roots.filter(row => row.profileId === profileId && row.owner.kind === "worker" && row.owner.workerId === member.workerId
      && (mode === "remove" || row.launch.state !== "closed" || row.native !== undefined));
    if (retained.length !== 0 && (stoppedProcess === undefined || !(lifetime instanceof RuntimeLifetimeLock))) throw new WorkerPoolError("WORKER_REMOVAL_CHILD_CLOSE_UNPROVED");
    if (stoppedProcess !== undefined && lifetime instanceof RuntimeLifetimeLock) await lifetime.awaitOwnedChildClosed(stoppedProcess);
    for (const row of retained) {
      const profileDirectory = join(input.admission.captureBrowserRegistryContext().machineRoot, row.directory);
      await roots.withUnused(profileDirectory, createNativeBrowserProbe({ clock: input.clock, scheduler: input.scheduler,
        closeProofMs: ConfigSchema.shape.browser.parse(undefined).closeProofMs, launchTimeoutMs: ConfigSchema.shape.timeouts.parse(undefined).sessionAcquireMs,
        signal: new AbortController().signal }), async ({ remove }) => { if (mode === "remove") remove(); },
      { profileId: row.profileId, profileRoot: input.profileRoot, profileDirectory, credentialFingerprint: row.credentialFingerprint,
        owner: { kind: "worker", database: input.database, workerId: member.workerId, ...(stoppedProcess === undefined ? {} : { stoppedProcess }) } });
    }
  };
  const removeProfiles = async (member: WorkerPoolMember): Promise<void> => {
    await settleProfiles(member, "remove");
    const directory = join(input.profileRoot, `w${String(member.ordinal)}`);
    assertPrivateProfilePath(input.profileRoot, directory);
    if (lstatSync(directory, { throwIfNoEntry: false }) !== undefined) rmdirSync(directory);
    children.delete(member.workerId);
  };

  const preflight = async (): Promise<void> => {
    if (input.preflight === undefined) return;
    try {
      await input.preflight.admission.prepare(input.preflight.currentScope(), starts.signal);
      input.preflight.admission.assertReady(input.preflight.currentScope());
    } catch (error) {
      if (error instanceof PreflightAdmissionRefusal) throw new WorkerControlRefusal(error.message, { cause: error });
      throw error;
    }
  };
  const seam: WorkerPoolRuntimeSeam = {
    async admit(commandId: string, options: Readonly<{ preflight: boolean }>): Promise<void> {
      let preflightFailure: { readonly error: unknown } | undefined;
      if (options.preflight) {
        try { await preflight(); } catch (error) { preflightFailure = { error }; }
      }
      // After the awaited preflight, whatever it decided: a grant revoked or expired meanwhile fails the effect before any refusal is audited.
      input.assertAssistantEffect?.(commandId);
      if (preflightFailure !== undefined) throw preflightFailure.error;
    },
    assertMember(target): WorkerMemberState {
      const view = viewOf(target.workerId);
      if (view === undefined ? target.lifetimeId !== null : view.lifetimeId !== target.lifetimeId || view.version !== target.expectedVersion) {
        throw new WorkerPoolError("WORKER_TARGET_STALE");
      }
      return view?.state ?? "absent";
    },
    async start(member) { assertStartsOpen(); releaseRespawn(member.workerId); await pool.start(member); },
    // A failed member start shows on its card and as a worker fault, whichever command asked for it.
    ensure: member => ensure(member).catch((error: unknown) => { input.onFault(fault(error)); throw error; }),
    stop,
    async remove(member) {
      const view = viewOf(member.workerId);
      if (view?.state === "running") await pool.request(targetOf(view), { type: "close-for-removal" }, WORKER_REQUEST_DEADLINE_MS);
      await stop(member.workerId, "remove");
      await removeProfiles(member);
    },
    async direct(workerId, directive) {
      const view = viewOf(workerId);
      if (view?.state !== "running") return;
      // The slot already holds the directive; a lost message only delays the card's activity.
      try { await (directive === "pause" ? pool.pause(targetOf(view)) : pool.resume(targetOf(view))); }
      catch (error) { input.onFault(fault(error)); }
    },
    async browser(target, type) {
      await pool.request(target, { type, browserSessionId: BrowserSessionIdSchema.parse(target.browserSessionId) }, WORKER_REQUEST_DEADLINE_MS);
    },
    async checkParkedWrite(target, command) {
      return await pool.request({ workerId: target.workerId, lifetimeId: target.lifetimeId, expectedVersion: target.expectedVersion },
        { type: "check-parked-write", command: JsonValueSchema.parse(command) }, WORKER_REQUEST_DEADLINE_MS);
    },
  };

  const activeMembers = (workflowId?: string): readonly WorkerPoolMember[] => input.database.authority.workerSlots.list(workflowId)
    .filter(slot => slot.retiredAt === null).map(workerPoolMember);
  const startAll = async (members: readonly WorkerPoolMember[]): Promise<void> => {
    await Promise.all(members.map(member => ensure(member).catch((error: unknown) => { input.onFault(fault(error)); })));
  };
  return Object.freeze({
    pool: Object.freeze({
      ...pool,
      stopAll: async (reason: Parameters<WorkerPool["stopAll"]>[0]) => {
        respawnOpen = false;
        starts.abort(new WorkerControlRefusal("worker-starts-closed"));
        const views = await pool.stopAll(reason);
        // Owned startup work settles once starts are closed and its members stopped; work owned meanwhile is swept too.
        while (owned.size > 0) await Promise.allSettled([...owned]);
        if (ownedFailures.length > 0) throw new AggregateError(ownedFailures, "worker-startup-work-failed");
        return views;
      },
    }),
    seam: Object.freeze(seam),
    running: (workflowId: string) => activeMembers(workflowId).some(member => live(viewOf(member.workerId))),
    /** Preflights once, then starts every member that is not live; throws when the workflow still has no live member. */
    ensureRunning: async (workflowId: string) => {
      const members = activeMembers(workflowId);
      if (members.every(member => live(viewOf(member.workerId)))) return;
      await preflight();
      await startAll(members);
      if (!members.some(member => live(viewOf(member.workerId)))) throw new WorkerControlRefusal("worker-start-failed");
    },
    startActive: () => startAll(activeMembers()),
    own: (work: Promise<void>) => {
      owned.add(work);
      void work.then(() => { owned.delete(work); }, (error: unknown) => { owned.delete(work); ownedFailures.push(error); });
    },
  });
}

// Spawn absolute argv without a shell; inherited stderr keeps bootstrap failures visible.
export function realWorkerProcessSpawner(lock: RuntimeLifetimeLock, nominatim: ReturnType<typeof createNominatimGeocodeAdapter>): WorkerProcessSpawner {
  return (request) => {
    lock.assertHeld();
    const child = spawnChildProcess(request.command, [...request.args], {
      cwd: request.cwd,
      env: request.environment,
      stdio: ["inherit", "inherit", "inherit", "ipc"],
    });
    let workerMessage: (message: unknown) => void = () => undefined;
    if (child.pid !== undefined) {
      const router = createIpcRouter({ on: (event, listener) => child.on(event, listener), off: (event, listener) => child.off(event, listener),
        disconnect: () => { if (child.connected) child.disconnect(); } }, error => { child.emit("error", error); });
      router.register(WORKER_MESSAGE_PREFIX, message => { workerMessage(message); });
      nominatim.attach(child, router);
      child.once("exit", () => { router.close(); });
      let transfer: Promise<void>;
      try { transfer = lock.share(child); lock.observeOwnedChildClosure(child); }
      catch (error) { transfer = Promise.reject(error instanceof Error ? error : new Error("worker lifetime transfer failed", { cause: error })); }
      void transfer.catch((error: unknown) => {
        child.kill("SIGKILL");
        child.emit("error", error);
      });
    }
    const port: ReturnType<WorkerProcessSpawner> = {
      nativeProcess: child,
      pid: child.pid,
      send: (message, callback) => { child.send(message, error => { callback(error ?? null); }); },
      kill: signal => signal === undefined ? child.kill() : child.kill(signal),
      disconnect: () => { if (child.connected) child.disconnect(); },
      onDisconnect: listener => { child.on("disconnect", listener); },
      onExit: listener => { child.on("exit", (code, signal) => { listener(code, signal); }); },
      onError: listener => { child.on("error", listener); },
      onWorkerMessage: listener => { workerMessage = listener; },
    };
    return Object.freeze(port);
  };
}
