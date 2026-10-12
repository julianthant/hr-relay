import { createCredentialStore } from "../../src/backend/storage/configuration/credential-store.js";
import { acquireEntrypointAdmission } from "../../src/backend/storage/admission/bootstrap-admission.js";
import { fileURLToPath } from "node:url";
import { hostConfigFacts } from "../../src/models/config/host-display.js";
/** Live login smoke against production SSO: it reports content-based login proof (never a value), and full Chromium is required to load the Duo extension. */
/** It never runs a workflow node and never commits a UCPath transaction. */
import { randomUUID } from "node:crypto";
import { lstatSync } from "node:fs";
import { join, resolve } from "node:path";
import { rebuildRuntimeIsolation } from "../../src/backend/app/config/runtime-isolation.js";
import { composeDuoCeremonyGateFactory } from "../../src/backend/runtime/gates/duo-ceremony-gate.js";
import { WorkerSessionManager } from "../../src/backend/runtime/workers/worker-sessions.js";
import { systemClock } from "../../src/rules/time/clock.js";
import { resolveConfigWithProvenance } from "../../src/backend/app/config/resolve.js";
import { RuntimeInstanceSchema } from "../../src/models/config/instance.js";
import { assertNoMigratedEnvironmentKeys, hostAwareResolutionEnvironment } from "../../src/models/config/secrets.js";
import {
  BrowserSystemIdSchema,
  FingerprintSchema,
  WorkflowIdSchema,
} from "../../src/rules/identity/ids.js";
import {
  BrowserProfileAdmissionSchema,
  deleteOwnedBrowserProfile,
  PlaywrightWorkerSessionFactory,
  workerProfileDirectory,
} from "../../src/backend/runtime/browser/browser-session-factory.js";
import type { BrowserDeadlineScheduler } from "../../src/backend/runtime/browser/browser-session-factory.js";
import { createCredentialSecretSource, readSettings } from "../../src/backend/runtime/settings/settings-runtime.js";
import { probePrimaryDisplay } from "../../src/backend/app/host/primary-display.js";
import type { AuthenticatedApplicationEvidence } from "../../src/backend/systems/browser-shared/login-contract.js";
import { AuthorityDatabase } from "../../src/backend/storage/sqlite/authority-database.js";
import { acquireRuntimeProcessLock, readRuntimeProcessLock } from "../../src/backend/storage/sqlite/runtime-process-locks.js";
import type { WorkerSlotRecord } from "../../src/models/run/worker-slot.js";
import type { DuoCeremonyGateHandle } from "../../src/backend/runtime/gates/duo-ceremony-gate.js";
import type { Clock } from "../../src/rules/time/clock.js";
import { taskStoreRegistry } from "../../src/backend/app/registries/task-registry.js";

const SUPPORTED = new Set(["ucpath", "crm"]);

const realScheduler: BrowserDeadlineScheduler = {
  schedule(deadlineMonotonicMs, onDeadline) {
    const handle = setTimeout(onDeadline, Math.max(0, deadlineMonotonicMs - systemClock.monotonicMs()));
    return { cancel: () => { clearTimeout(handle); } };
  },
};

function write(line: string): void {
  process.stdout.write(`${line}\n`);
}

function elapsed(since: number): string {
  return `${((systemClock.monotonicMs() - since) / 1_000).toFixed(1)}s`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch (error) {
    return `<unparseable navigation target: ${error instanceof Error ? error.message : String(error)}>`;
  }
}

export function smokeErrorDiagnostic(error: unknown): string {
  const detail = error instanceof Error ? error.stack ?? error.message : String(error);
  return error instanceof AggregateError
    ? [detail, ...error.errors.map((nested: unknown) => smokeErrorDiagnostic(nested))].join("\n")
    : detail;
}

export class SmokeSessionClosureError extends AggregateError {
  constructor(errors: readonly unknown[]) {
    super(errors, "live-smoke-session-closure-unproved");
    this.name = "SmokeSessionClosureError";
  }
}

export async function closeSmokeSessions(
  sessions: Pick<WorkerSessionManager, "closeAll">,
  deleteProfile: () => void,
  operationErrors: readonly unknown[],
): Promise<void> {
  try {
    await sessions.closeAll("worker-stop");
    deleteProfile();
  } catch (error) {
    throw new SmokeSessionClosureError([...operationErrors, error]);
  }
  if (operationErrors.length === 1) throw operationErrors[0];
  if (operationErrors.length > 1) throw new AggregateError(operationErrors, "live-smoke-session-cleanup-failed");
}

export async function withSmokeWorker(
  database: AuthorityDatabase,
  operation: (slot: WorkerSlotRecord, gates: Set<DuoCeremonyGateHandle>) => Promise<void>,
  clock: Clock = systemClock,
): Promise<void> {
  const slot = database.withAuthorityTransaction(repositories => {
    const workflow = WorkflowIdSchema.parse("person-lookup");
    const active = repositories.workerSlots.list(workflow).filter(candidate => candidate.retiredAt === null);
    const poolIndex = [1, 2, 3].find(index => !active.some(candidate => candidate.poolIndex === index));
    if (poolIndex === undefined) throw new Error("live-smoke-worker-pool-capacity-exceeded");
    const now = clock.now().toISOString();
    if (repositories.workerPools.get(workflow) === undefined) {
      const planned = repositories.workerPools.plan({ workflow, expectedVersion: 0,
        desiredWorkers: 0, requestedBy: "local-operator", now });
      if (planned.state !== "applied") throw new Error("live-smoke-worker-pool-admission-conflict");
    }
    return repositories.workerSlots.allocate({ workflow, poolIndex, commandId: null, now });
  });
  const gates = new Set<DuoCeremonyGateHandle>();
  const errors: unknown[] = [];
  try {
    await operation(slot, gates);
  } catch (error) {
    errors.push(error);
  }
  let released = true;
  for (const gate of gates) {
    try { gate.dispose(errors[0]); } catch (error) { released = false; errors.push(error); }
  }
  if (released && !(errors[0] instanceof SmokeSessionClosureError)) {
    try {
      database.withAuthorityTransaction(repositories => {
        const request = { workerId: slot.workerId, commandId: randomUUID(),
          expectedRevision: slot.membershipRevision, now: clock.now().toISOString() };
        const command = { commandId: request.commandId, family: "worker-browser", type: "stop-worker",
          requestedAt: request.now, requestedBy: "local-operator", source: "live-smoke",
          reason: "Retire the worker slot owned by this browser login check",
          target: { workerId: slot.workerId, expectedVersion: slot.membershipRevision } };
        repositories.commands.insert(command);
        const retired = repositories.workerSlots.retire(request);
        const target = { family: "worker-browser", workerId: slot.workerId };
        repositories.commandAudits.insert({ auditId: randomUUID(), request: command,
          result: { state: "applied", commandId: request.commandId, affectedTargets: [target] },
          versionChanges: [{ target, before: slot.membershipRevision, after: retired.membershipRevision }],
          affectedDependencyIds: [], completedAt: request.now });
      });
    } catch (error) { errors.push(error); }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, "live-smoke-operation-or-cleanup-failed");
}

async function main(): Promise<void> {
  const requested = process.argv[2];
  if (requested === undefined || !SUPPORTED.has(requested)) {
    throw new Error(`usage: live-browser-login-smoke <${[...SUPPORTED].join("|")}> [--headed] [--cold] [--reuse]`);
  }
  const system = BrowserSystemIdSchema.parse(requested);
  if (process.argv.includes("--reuse")) throw new Error("live-smoke-profile-reuse-unavailable: developer smoke profiles require a fresh owned launch");
  const headed = process.argv.includes("--headed");
  if (process.argv.includes("--worker")) throw new Error("live-smoke-worker-selection-unavailable: the check allocates its own worker slot");
  const workspace = fileURLToPath(new URL("../..", import.meta.url));
  const admission = acquireEntrypointAdmission(workspace, "shared");
  try {
  assertNoMigratedEnvironmentKeys();
  const stateRoot = admission.stateRoot;
  const processLockRoot = join(workspace, rebuildRuntimeIsolation.processLockRoot);
  const processLock = acquireRuntimeProcessLock(
    { processLockRoot, name: "live-smoke", pid: process.pid },
    systemClock,
  );

  // The Duo ceremony lease lives in the REAL authority database, so two
  // smokes (or a smoke beside a worker) serialize their ceremonies for real.
  const database = AuthorityDatabase.open(
    admission,
    { path: join(stateRoot, "state.db"), busyTimeoutMs: 5000, migrationOwner: "live-smoke" },
    systemClock,
  );
  try {
  await withSmokeWorker(database, async (slot, gates) => {
  const { workerId, ordinal } = slot;
  const hostFacts = hostConfigFacts(hostAwareResolutionEnvironment(probePrimaryDisplay));
  const record = database.withAuthorityTransaction((repositories) => readSettings(repositories));
  const config = resolveConfigWithProvenance(record.settings, hostFacts, systemClock).config;
  const smokeProfileRoot = join(stateRoot, "scratch", "live-smoke", randomUUID(), "browsers");
  const smokeConfig = { ...config, paths: { ...config.paths, browserProfileRoot: smokeProfileRoot } };
  const workflowId = WorkflowIdSchema.parse("person-lookup");
  const instance = RuntimeInstanceSchema.parse("prod");
  const configFingerprint = FingerprintSchema.parse(
    randomUUID().replaceAll("-", "").padEnd(64, "0").slice(0, 64),
  );

  if (process.argv.includes("--cold")) {
    const profileDirectory = workerProfileDirectory({
      profileRoot: smokeProfileRoot, slotOrdinal: ordinal, system,
    });
    deleteOwnedBrowserProfile(smokeProfileRoot, profileDirectory);
    write("[smoke] cold start: fresh owned profile selected");
  }

  const evidence: AuthenticatedApplicationEvidence[] = [];
  const hops: string[] = [];
  const protectedAuthority = createCredentialStore({ admission, stateRoot });
  const factory = new PlaywrightWorkerSessionFactory({
    config: { ...smokeConfig, browser: { ...config.browser, headless: !headed } },
    protectedSecrets: createCredentialSecretSource(protectedAuthority),
    isolation: rebuildRuntimeIsolation,
    clock: systemClock,
    scheduler: realScheduler,
    newSessionId: () => randomUUID(),
    slotOrdinal: requestedWorker => { if (requestedWorker !== workerId) throw new Error("live-smoke-profile-owner-mismatch"); return ordinal; },
    admitProfile: profile => {
      const lock = readRuntimeProcessLock(processLockRoot, "live-smoke");
      if (lock?.pid !== process.pid || lock.acquisitionId !== processLock.acquisitionId
        || profile.workerId !== workerId || profile.profileDirectory !== workerProfileDirectory({ profileRoot: smokeProfileRoot, slotOrdinal: ordinal, system })
        || lstatSync(profile.profileDirectory, { throwIfNoEntry: false }) !== undefined) throw new Error("live-smoke-profile-custody-unavailable");
      return Promise.resolve(BrowserProfileAdmissionSchema.parse({ ...profile, profileRevision: 1, resetRequired: false }));
    },
    onAuthenticationEvidence: (observed) => {
      evidence.push(observed);
      write(`[evidence] ${observed.system} @ ${observed.url}`);
      write(`[evidence]   positive: ${observed.positive}`);
      write(`[evidence]   negative: ${observed.negative}`);
    },
    onNavigation: (url) => {
      hops.push(url);
      // Host only: a Shibboleth/Duo hop URL carries execution ids and SAML
      // payloads that have no business in a log.
      write(`[hop] ${String(hops.length).padStart(2, "0")} ${hostOf(url)}`);
    },
  });

  // Lock before the database opens and release after close, so `cli storage restore` sees the live owner;
  // differently-named smokes share the authority database, so one smoke brings a database that needs migrating to the current schema first.
  const duoFactory = composeDuoCeremonyGateFactory({
    config, leases: database.authority.duoCeremonyLeases, clock: systemClock, scheduler: realScheduler,
  });

  const started = systemClock.monotonicMs();
  const sessions = new WorkerSessionManager({
    workerId,
    workflowId,
    stores: taskStoreRegistry,
    factory,
    clock: systemClock,
    scheduler: realScheduler,
    acquireDeadlineMs: config.timeouts.sessionAcquireMs,
    defaultBrowserMode: headed ? "headed" : "headless",
    duoCeremony: { openGate: input => {
      const gate = duoFactory.openGate(input);
      gates.add(gate);
      return gate;
    } },
    onEvent: (event) => {
      const detail = event.type === "browser-session:start" ? ` login=${event.login}` : "";
      write(`[session] ${event.type} ${event.system} ${event.sessionId}${detail} (+${elapsed(started)})`);
    },
  });
  const sessionErrors: unknown[] = [];
  try {
  sessions.bindRunConfigFingerprint(configFingerprint);
  await sessions.withDriver(
    { system, access: "read", session: "reuse-worker" },
    instance,
    new AbortController().signal,
    async (driver) => {
      write(`[smoke] authenticated ${driver.system}; the lease callback holds a live driver (+${elapsed(started)})`);
    },
  );
  // The lease releases through the neutral reset, which re-runs the SAME proof.
  // Two evidence records — login and reset — is what a real session produces.
  if (evidence.length < 2) {
    throw new Error(
      `${system} smoke observed ${String(evidence.length)} authentication proof(s); a login and its neutral reset must each produce one`,
    );
  }
  write(`[smoke] hop chain (hosts, in order): ${[...new Set(hops.map(hostOf))].join(" → ")}`);
  write(`[smoke] ${system} login + neutral reset verified in ${elapsed(started)}`);
  } catch (error) {
    sessionErrors.push(error);
  }
  await closeSmokeSessions(sessions,
    () => { deleteOwnedBrowserProfile(smokeProfileRoot, join(smokeProfileRoot, `w${ordinal}`)); }, sessionErrors);
  write("[smoke] every session closed with proof");
  });
  } finally {
    database.close();
    processLock.release();
  }
  } finally {
    admission.release();
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error: unknown) => {
  process.exitCode = 1;
  process.stderr.write(`${smokeErrorDiagnostic(error)}\n`);
});
