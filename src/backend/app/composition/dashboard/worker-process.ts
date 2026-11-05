import { readStartupProcessRecords } from "../../../storage/sqlite/runtime-process-locks.js";
import { rebuildRuntimeIsolation } from "../../config/runtime-isolation.js";
import { ConfigSchema } from "../../../../models/config/schema.js";
import { createNominatimGeocodeAdapter } from "../../../processing/providers/geocode-adapters.js";
import { assertPrivateProfilePath,createBrowserRoots } from "../../../storage/browser-roots.js";
import { WorkerControlRefusal } from "../../../../models/run/worker-control.js";
import { WorkerRetirementProofSchema,workerPoolMember } from "../../../../models/run/worker-slot.js";
import { PreflightAdmissionRefusal } from "../../../../rules/preflight/preflight-admission.js";
import { canonicalJsonStringify } from "../../../../rules/validation/canonical-json.js";
import { workerProfileDirectory } from "../../../runtime/browser/browser-session-factory.js";
import { createNativeBrowserProbe } from "../../../runtime/browser/native-browser.js";
import { createWorkerBrowserChannel } from "../../../runtime/workers/worker-browser-channel.js";
import { RuntimeAdmission } from "../../../storage/admission/admission.js";
import { type RuntimePreflight } from "../../preflight/runtime-admission.js";
import { spawn as spawnChildProcess } from "node:child_process";
import { lstatSync,rmdirSync } from "node:fs";
import { join } from "node:path";
import { DEVELOPMENT_DEBUG_MIRROR_ENV,workerBootstrapEnvironment } from "../../../../models/config/secrets.js";
import { isLiveWorker } from "../../../../models/run/worker.js";
import type { Clock } from "../../../../rules/time/clock.js";
import { type WorkerPoolRuntimeAdoption,type WorkerRuntimeContext } from "../../../runs/commands/command-kernel.js";
import type { MonotonicDeadlineScheduler } from "../../../runtime/scheduling/deadline-scheduler.js";
import { createWorkerPoolRuntimeExecutor } from "../../../runtime/workers/worker-loop.js";
import { createDashboardWorkerProcessSupervisor,type DashboardWorkerProcessSupervisor,type DashboardWorkerSupervisorDependencies,type WorkerCliLaunchSpec,type WorkerProcessSpawner } from "../../../runtime/workers/worker-supervisor.js";
import { RuntimeLifetimeLock } from "../../../storage/admission/lifetime-lock.js";
import { AuthorityDatabase } from "../../../storage/sqlite/index.js";

// Allow the CLI cold start to publish its lease before declaring a failed birth.
export const WORKER_BIRTH_POLL_MS = 250;

// Launch through the secure environment bootstrap, never a parallel CLI path.
export function productionWorkerLaunch(repoRoot: string, environment?: NodeJS.ProcessEnv, development = false): Readonly<{
  command: string;
  environment: NodeJS.ProcessEnv;
  prefixArgs: readonly string[];
  cwd: string;
}> {
  return Object.freeze({
    command: process.execPath,
    environment: Object.freeze({ ...workerBootstrapEnvironment(environment), ...(development ? { [DEVELOPMENT_DEBUG_MIRROR_ENV]: "1" } : {}) }),
    prefixArgs: Object.freeze([...(development ? ["--conditions=development"] : []), "--import", "tsx", join(repoRoot, "scripts", "dev", "secure-env-bootstrap.ts"), "cli"]),
    cwd: repoRoot,
  });
}
export const WORKER_BIRTH_TIMEOUT_MS = 60_000;

export interface WorkerProcessControlInput {
  readonly admission: RuntimeAdmission;
  readonly onExit: DashboardWorkerSupervisorDependencies["onExit"];
  readonly profileRoot: string;
  readonly database: AuthorityDatabase;
  readonly clock: Clock;
  readonly scheduler: MonotonicDeadlineScheduler;
  readonly launch: WorkerCliLaunchSpec;
  readonly spawn: WorkerProcessSpawner;
  readonly birth: Readonly<{ pollMs: number; timeoutMs: number }>;
  readonly onFault: (error: Error) => void;
  readonly preflight?: RuntimePreflight;
  readonly assertAssistantEffect?: (commandId: string) => void;
}


export function composeWorkerProcessControl(input: WorkerProcessControlInput): Readonly<{
  supervisor: DashboardWorkerProcessSupervisor;
  workerRuntime: WorkerPoolRuntimeAdoption;
}> {
  const browserChannel = createWorkerBrowserChannel(input);
  const supervisor = createDashboardWorkerProcessSupervisor({
    onExit: input.onExit,
    settleNonBirth: () => input.database.settleNeverSpawnedWorkers(),
    nonBirthOwner: input.database,
    launch: input.launch,
    spawn: input.spawn,
    browserControl: browserChannel,
    prepareAdmission: async request => {
      if (request.command !== "spawn-worker" || input.preflight === undefined) return;
      try {
        const scope = input.preflight.currentScope();
        await input.preflight.admission.prepare(scope, new AbortController().signal);
        input.preflight.admission.assertReady(input.preflight.currentScope());
      } catch (error) {
        throw new WorkerControlRefusal(error instanceof PreflightAdmissionRefusal ? error.message : "Worker preflight could not verify readiness.");
      }
    },
    admission: request => input.database.withAuthorityTransaction(repositories => {
      if (request.commandId === undefined) throw new WorkerControlRefusal("worker-control-command-identity-unavailable");
      input.assertAssistantEffect?.(request.commandId);
      if (request.command === "spawn-worker" && input.preflight !== undefined) {
        try { input.preflight.admission.assertReady(input.preflight.currentScope()); }
        catch (error) { if (error instanceof PreflightAdmissionRefusal) throw new WorkerControlRefusal(error.message); throw error; }
      }
      const standing = "member" in request ? repositories.workerSlots.recovery(request.member.workerId) : undefined;
      if (standing !== undefined && request.command === "spawn-worker") {
        const binding = standing.request.binding, lease = repositories.workerLeases.get(request.member.workerId), active = repositories.runtimeConfig.get();
        if (standing.command.commandId !== request.commandId || request.command !== "spawn-worker"
          || canonicalJsonStringify(binding.member) !== canonicalJsonStringify(request.member) || lease?.lifecycle.state !== "stopped"
          || lease.leaseGeneration !== binding.lifetime.leaseGeneration || lease.controlRevision !== binding.reservedControlRevision
          || lease.controlCommandId !== request.commandId || binding.operation.kind !== "retry"
          || active?.configSnapshotId !== binding.operation.configSnapshotId || active.configFingerprint !== binding.operation.configFingerprint) throw new WorkerControlRefusal("worker-standing-recovery-admission-changed");
        input.database.assertStoppedWorkerLifetime(binding.member, binding.lifetime);
        return;
      }
      const record = repositories.workerControls.get(request.commandId);
      if (record === undefined || record.request.type !== request.command && !(request.command === "spawn-worker" && record.lifecycle?.operation.kind === "retry")) throw new WorkerControlRefusal("worker-control-command-not-admitted");
      if (record.lifecycle?.operation.kind === "retry") {
        const active = repositories.runtimeConfig.get();
        const lease = repositories.workerLeases.get(record.lifecycle.member.workerId);
        if (record.phase.state !== "executing" || lease?.lifecycle.state !== "stopped" || lease.leaseGeneration !== record.lifecycle.lifetime.leaseGeneration
          || lease.controlRevision !== record.lifecycle.reservedControlRevision || lease.controlCommandId !== record.commandId
          || active?.configSnapshotId !== record.lifecycle.operation.configSnapshotId || active.configFingerprint !== record.lifecycle.operation.configFingerprint) throw new WorkerControlRefusal("worker-retry-current-authority-changed");
        return;
      }
      if (request.command === "spawn-worker") {
        const lease = repositories.workerLeases.get(request.member.workerId);
        if (lease !== undefined) input.database.assertStoppedWorkerLifetime(request.member,
          { leaseGeneration: lease.leaseGeneration, processId: lease.processId, startedAt: lease.lifecycle.startedAt });
      }
      if (input.clock.nowMs() >= Date.parse(record.expiresAt)) throw new WorkerControlRefusal("worker-control-expired-before-effect");
      if ("workerId" in record.request.target) {
        const lease = repositories.workerLeases.get(record.request.target.workerId);
        const basis = record.request.target.controlBasis;
        if (lease === undefined || !isLiveWorker(lease) || basis === undefined || lease.leaseGeneration !== basis.leaseGeneration
          || lease.controlRevision !== basis.controlRevision + 1 || lease.controlCommandId !== record.commandId) throw new WorkerControlRefusal("worker-control-basis-changed-before-effect");
      } else if ((repositories.workerPools.get(record.request.target.workflowId)?.version ?? 0) !== (record.roster?.admittedVersion ?? record.request.target.expectedVersion)) throw new WorkerControlRefusal("worker-pool-version-changed-before-effect");
    }),
    leases: {
      observe: (workerId) => {
        const lease = input.database.authority.workerLeases.get(workerId);
        if (lease === undefined || !isLiveWorker(lease)) return undefined;
        return { processId: lease.processId, startedAt: lease.lifecycle.startedAt };
      },
    },
    gracefulStop: {
      request: (member, directive) => input.database.withAuthorityTransaction((repositories) => {
        const lease = repositories.workerLeases.get(member.workerId);
        if (lease === undefined) {
          throw new Error(
            `graceful stop for ${member.workerId} found no worker lease; the durable directive has nowhere to land`,
          );
        }
        if (!isLiveWorker(lease)) {
          throw new Error(
            `graceful stop for ${member.workerId} found the lease ${lease.lifecycle.state}; `
            + "a stopped lease takes no directive",
          );
        }
        if (directive.commandId !== undefined) {
          const record = repositories.workerControls.get(directive.commandId);
          if (record === undefined) throw new WorkerControlRefusal("worker-control-command-not-admitted");
          if ("workerId" in record.request.target) {
            const basis = record.request.target.controlBasis;
            if (basis === undefined || lease.leaseGeneration !== basis.leaseGeneration || lease.controlRevision !== basis.controlRevision + 1 || lease.controlCommandId !== record.commandId) throw new WorkerControlRefusal("worker-control-basis-changed-before-effect");
          }
        }
        const outcome = repositories.workerLeases.control({
          ...(directive.commandId === undefined ? {} : { commandId: directive.commandId }),
          workerId: member.workerId,
          expectedVersion: lease.version,
          control: {
            directive: "stop",
            requestedAt: directive.requestedAt,
            requestedBy: directive.requestedBy,
            ...(directive.reason === undefined ? {} : { reason: directive.reason }),
          },
          now: directive.requestedAt,
        });
        if (outcome.state !== "applied") {
          throw new Error(
            `graceful stop for ${member.workerId} could not write the durable directive: ${outcome.message}`,
          );
        }
        return Object.freeze({
          requestedAt: directive.requestedAt,
          // The WRITE's own before/after — what command authority audits;
          // a later lease read would absorb unrelated bumps into it.
          leaseVersions: Object.freeze({ before: lease.version, after: outcome.lease.version }),
        });
      }),
    },
    clock: input.clock,
    scheduler: input.scheduler,
    birth: input.birth,
    standingRecoverySettled: commandId => {
      const audit = input.database.authority.lifecycleJournal.findAuditByCommand(commandId);
      return audit !== undefined && "kind" in audit && audit.kind === "run-lifecycle" && audit.result.kind === "worker-recovery";
    },
    assertStoppedLifetime: (member, lifetime) => { input.database.assertStoppedWorkerLifetime(member, lifetime); },
    proveRetirement: async (member, child) => {
      const capture = () => input.database.withAuthorityTransaction(repositories => {
        const slot = repositories.workerSlots.get(member.workerId);
        const lease = repositories.workerLeases.get(member.workerId);
        const pending = repositories.workerControls.pending(`worker-pool:${member.workflowId}`);
        const standing = repositories.workerSlots.recovery(member.workerId);
        const reservation = pending.find(control => control.request.type === "plan-worker-count" && control.phase.state === "executing"
          && control.roster?.excess.some(original => canonicalJsonStringify(original) === canonicalJsonStringify(slot))
          || control.lifecycle !== undefined && control.phase.state === "executing" && canonicalJsonStringify(control.lifecycle.member) === canonicalJsonStringify(member)
            && (control.lifecycle.operation.kind === "retry" || control.closure !== undefined));
        if (slot === undefined || slot.retiredAt !== null || slot.membershipRevision !== member.membershipRevision
          || canonicalJsonStringify(workerPoolMember(slot)) !== canonicalJsonStringify(member) || (standing === undefined ? reservation === undefined || pending.length !== 1
            : standing.request.binding.member.membershipRevision !== member.membershipRevision || pending.length !== 0)
          || lease !== undefined && isLiveWorker(lease)
          || repositories.workerControls.browsers(member.workerId).some(browser => browser.health !== "closed")) throw new WorkerControlRefusal("worker-retirement-closure-not-proved");
        input.database.assertWorkerLifecycleRelease(member.workerId);
        const browsers = repositories.workerControls.browsers(member.workerId);
        for (const browser of browsers) {
          if (browser.profileDirectory !== workerProfileDirectory({ profileRoot: input.profileRoot, slotOrdinal: slot.ordinal, system: browser.system })) throw new WorkerControlRefusal("worker-retirement-profile-identity-mismatch");
        }
        const launches = repositories.workerControls.list().filter(control => control.request.type === "spawn-worker" && control.request.payload.workerId === member.workerId);
        const spawnAdmitted = input.database.workerHasSpawnRequest(member.workerId);
        return { browsers, launches, spawnAdmitted, browserSystems: lease?.browserSystems, processId: lease?.processId, identity: canonicalJsonStringify({ slot, lease: lease ?? null, pending, standing: standing ?? null, browsers, launches, spawnAdmitted }) };
      });
      const before = capture(), roots = createBrowserRoots(input.admission);
      const directory = join(input.profileRoot, `w${String(member.ordinal)}`);
      const retained = roots.inventory().roots.filter(row => row.profileId === input.admission.profileBinding.profileId && row.owner.kind === "worker" && row.owner.workerId === member.workerId);
      const process = child?.nativeProcess, lifetime = input.admission.lifetime;
      const requiresChild = before.processId !== undefined && before.processId !== null || process !== undefined
        || retained.length !== 0 || lstatSync(directory, { throwIfNoEntry: false }) !== undefined;
      if (!requiresChild && (before.launches.length !== 0 || before.spawnAdmitted)) throw new WorkerControlRefusal("worker-retirement-non-birth-capability-required");
      const rootAssertions: Array<() => void> = [];
      const assertCurrent = () => {
        input.admission.assertProfileRuntime();
        if (capture().identity !== before.identity) throw new WorkerControlRefusal("worker-retirement-owner-changed");
        if (requiresChild) {
          if (process === undefined || !(lifetime instanceof RuntimeLifetimeLock)
            || before.processId !== undefined && before.processId !== null && process.pid !== before.processId) throw new WorkerControlRefusal("worker-retirement-child-close-unproved");
          lifetime.assertOwnedChildClosed(process);
        }
        for (const assertRoot of rootAssertions) assertRoot();
      };
      if (requiresChild) {
        if (process === undefined || !(lifetime instanceof RuntimeLifetimeLock)) throw new WorkerControlRefusal("worker-retirement-child-close-unproved");
        await lifetime.awaitOwnedChildClosed(process);
        assertCurrent();
        for (const row of retained) {
          const profileDirectory = join(input.admission.captureBrowserRegistryContext().machineRoot, row.directory);
          const browser = before.browsers.find(browser => browser.profileDirectory === profileDirectory);
          if (!before.browserSystems?.some(system => profileDirectory === workerProfileDirectory({ profileRoot: input.profileRoot, slotOrdinal: member.ordinal, system }))
            || browser === undefined && (row.credentialFingerprint !== null || row.launch.state !== "closed" || row.native !== undefined)) {
            throw new WorkerControlRefusal("worker-retirement-profile-identity-mismatch");
          }
          const assertRoot = await roots.withUnused(profileDirectory, createNativeBrowserProbe({ clock: input.clock, scheduler: input.scheduler,
            closeProofMs: ConfigSchema.shape.browser.parse(undefined).closeProofMs, launchTimeoutMs: ConfigSchema.shape.timeouts.parse(undefined).sessionAcquireMs,
            signal: new AbortController().signal }), async ({ remove, assertCurrent: assertRoot }) => {
            assertCurrent();
            remove();
            return assertRoot;
          },
          { profileId: row.profileId, profileRoot: input.profileRoot, profileDirectory, credentialFingerprint: browser?.signInFingerprint ?? null,
            owner: { kind: "worker", database: input.database, workerId: member.workerId, stoppedProcess: process } });
          rootAssertions.push(assertRoot);
          assertCurrent();
        }
        assertCurrent();
        assertPrivateProfilePath(input.profileRoot, directory);
        if (lstatSync(directory, { throwIfNoEntry: false }) !== undefined) rmdirSync(directory);
      }
      assertCurrent();
      return Object.freeze({ proof: WorkerRetirementProofSchema.parse({ workerId: member.workerId, membershipRevision: member.membershipRevision,
        checkedAt: input.clock.now().toISOString(), processStopped: true, browsersClosed: true, exclusive: true }), assertCurrent });
    },
    onFault: input.onFault,
  });
  input.database.bindWorkerNonBirthSupervisor(supervisor, slot => {
    input.admission.assertProfileRuntime();
    const roots = createBrowserRoots(input.admission).inventory().roots;
    const installation = input.admission.readInstallationContext();
    if (installation === undefined) throw new WorkerControlRefusal("worker-non-birth-installation-unavailable");
    const processes = readStartupProcessRecords(join(installation.workspace, rebuildRuntimeIsolation.processLockRoot));
    if (processes.some(record => record.name === "workers" && ("workerId" in record ? record.workerId === slot.workerId
      : record.admission.authorityPath === join(input.admission.stateRoot, "state.db")))
      || roots.some(row => row.profileId === input.admission.profileBinding.profileId && row.owner.kind === "worker" && row.owner.workerId === slot.workerId)
      || lstatSync(join(input.profileRoot, `w${String(slot.ordinal)}`), { throwIfNoEntry: false }) !== undefined) throw new WorkerControlRefusal("worker-non-birth-retained-profile");
  });
  return Object.freeze({
    supervisor,
    workerRuntime: Object.freeze({ recordControlAudit: (commandId: string) => input.database.recordWorkerNonBirthRefusal(commandId), pool: { ...createWorkerPoolRuntimeExecutor(supervisor, input.database.authority.workerSlots, { database: input.database, clock: input.clock }),
      checkParkedWrite: (context: WorkerRuntimeContext) => browserChannel.check(context.command.commandId) } }),
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
    nominatim.attach(child);
    let transfer: Promise<void>;
    try { transfer = lock.share(child); lock.observeOwnedChildClosure(child); }
    catch (error) { transfer = Promise.reject(error instanceof Error ? error : new Error("worker lifetime transfer failed", { cause: error })); }
    void transfer.catch(error => {
      child.kill("SIGKILL");
      child.emit("error", error);
    });
    return Object.freeze({
      nativeProcess: child,
      pid: child.pid,
      kill: (signal: "SIGTERM" | "SIGKILL"): boolean => child.kill(signal),
      onExit: (listener: (code: number | null, signal: string | null) => void): void => {
        child.on("exit", (code, signal) => {
          listener(code, signal);
        });
      },
      onError: (listener: (error: Error) => void): void => {
        child.on("error", (error) => {
          listener(error);
        });
      },
    });
  };
}
