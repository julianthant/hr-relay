import { createDuoCredentialStore } from "../../src/backend/storage/configuration/duo-credential-store.js";
import type { RuntimeAdmission } from "../../src/backend/storage/admission/admission.js";
import { captureSelectedProfileStorage, RuntimeCustodyUncertainError } from "../../src/backend/app/composition/storage-compose.js";
import { hasUnprovedSourceClosure } from "../../src/backend/storage/source-closure.js";
import { reconcileStartupCrash } from "../../src/backend/runs/lifecycle/startup-crash-recovery.js";
import { RunRecordService } from "../../src/backend/runs/lifecycle/run-record-service.js";
import { ERROR_CATALOG, ErrorCatalogCodeSchema } from "../../src/models/failures/error-catalog.js";

import { createCredentialStore } from "../../src/backend/storage/configuration/credential-store.js";
import { acquireEntrypointAdmission } from "../../src/backend/storage/admission/bootstrap-admission.js";
import { acquireRuntimeLifetimeLock, RuntimeLifetimeLock } from "../../src/backend/storage/admission/lifetime-lock.js";
import { fileURLToPath } from "node:url";
import { hostConfigFacts } from "../../src/models/config/host-display.js";
import { randomUUID } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { rebuildRuntimeIsolation } from "../../src/backend/app/config/runtime-isolation.js";
import { composeDuoCeremonyGateFactory, duoCeremonyCredentialKey } from "../../src/backend/runtime/gates/duo-ceremony-gate.js";
import { SessionAcquisitionTimeoutError, sessionAcquisitionTimeoutText, WorkerSessionManager } from "../../src/backend/runtime/workers/worker-sessions.js";
import { systemClock } from "../../src/rules/time/clock.js";
import { resolveConfigWithProvenance } from "../../src/backend/app/config/resolve.js";
import { RuntimeInstanceSchema } from "../../src/models/config/instance.js";
import { assertNoMigratedEnvironmentKeys, hostAwareResolutionEnvironment } from "../../src/models/config/secrets.js";
import { BrowserSystemIdSchema, FingerprintSchema, WorkflowIdSchema } from "../../src/rules/identity/ids.js";
import {
  BrowserProfileAdmissionSchema,
  deleteOwnedBrowserProfile,
  PlaywrightWorkerSessionFactory,
  workerProfileDirectory,
} from "../../src/backend/runtime/browser/browser-session-factory.js";
import type { BrowserSessionFactoryOptions, BrowserDeadlineScheduler } from "../../src/backend/runtime/browser/browser-session-factory.js";
import { createCredentialSecretSource, readSettings } from "../../src/backend/runtime/settings/settings-runtime.js";
import { probePrimaryDisplay } from "../../src/backend/app/host/primary-display.js";
import { BrowserLandingStallError, BrowserLoginError, DuoTerminalRefusalError } from "../../src/backend/systems/browser-shared/login-contract.js";
import type { AuthenticatedApplicationEvidence } from "../../src/backend/systems/browser-shared/login-contract.js";
import { AuthorityDatabase } from "../../src/backend/storage/sqlite/authority-database.js";
import type { BrowserSystemId, Fingerprint } from "../../src/rules/identity/ids.js";
import type { WorkerSlotRecord } from "../../src/models/run/worker-slot.js";
import type { DuoCeremonyGateHandle } from "../../src/backend/runtime/gates/duo-ceremony-gate.js";
import type { Clock } from "../../src/rules/time/clock.js";
import { canonicalJsonStringify } from "../../src/rules/validation/canonical-json.js";
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
    return new URL(url).hostname || "<unparseable navigation target>";
  } catch {
    return "<unparseable navigation target>";
  }
}

const SAFE_ERROR_IDENTITIES = new Set(["Error", "TypeError", "RangeError", "ReferenceError", "SyntaxError",
  "URIError", "EvalError", "AbortError", "TimeoutError", "ProfileCustodyUnavailableError", "DuoProvisioningError",
  "DuoCeremonyLeaseHeldError", "DuoCeremonyLeaseExpiredError", "DuoCeremonyReleaseFailedError"]);
const LOGIN_PHASES = new Set(["navigate-login-entry", "campus-discovery", "sso-form", "credential-fill",
  "sso-submit", "duo-clearance", "verify-landing"]);

export function smokeErrorDiagnostic(error: unknown): string {
  const diagnostics: Record<string, string>[] = [];
  const seen = new Set<Error>();
  const pending: unknown[] = [error];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!(current instanceof Error) || seen.has(current)) continue;
    seen.add(current);
    const identity = current instanceof BrowserLandingStallError ? "BrowserLandingStallError"
      : current instanceof SessionAcquisitionTimeoutError ? "SessionAcquisitionTimeoutError"
      : current instanceof DuoTerminalRefusalError ? "DuoTerminalRefusalError"
      : current instanceof BrowserLoginError ? "BrowserLoginError"
      : current instanceof SmokeVerificationRefusedError ? "SmokeVerificationRefusedError"
      : current instanceof SmokeSessionClosureError ? "SmokeSessionClosureError"
      : current instanceof AggregateError ? "AggregateError"
      : SAFE_ERROR_IDENTITIES.has(current.name) ? current.name : "Error";
    const diagnostic: Record<string, string> = { error: identity };
    if (current instanceof BrowserLoginError) {
      const system = BrowserSystemIdSchema.safeParse(current.system);
      if (system.success) diagnostic.system = system.data;
      const phase = current.step;
      if (LOGIN_PHASES.has(phase)) diagnostic.phase = phase;
      diagnostic.host = typeof current.observedUrl === "string" ? hostOf(current.observedUrl) : "<unparseable navigation target>";
    }
    const code = ErrorCatalogCodeSchema.safeParse("code" in current ? current.code : undefined);
    if (code.success) { diagnostic.code = code.data; diagnostic.text = ERROR_CATALOG[code.data].text; }
    if (current instanceof SessionAcquisitionTimeoutError) {
      diagnostic.code = "browser-session-acquisition-timeout";
      diagnostic.text = sessionAcquisitionTimeoutText(current.boundMs);
      diagnostic.phase = "acquisition";
      const system = BrowserSystemIdSchema.safeParse(current.system);
      if (system.success) diagnostic.system = system.data;
    }
    if (current instanceof DuoTerminalRefusalError) {
      diagnostic.code = "DUO_TERMINAL_REFUSAL";
      diagnostic.text = ERROR_CATALOG.DUO_TERMINAL_REFUSAL.text;
      diagnostic.host = current.host;
      diagnostic.path = current.path;
      diagnostic.title = current.title;
    }
    if (current instanceof BrowserLandingStallError) {
      diagnostic.code = current.code;
      diagnostic.text = ERROR_CATALOG[current.code].text;
      diagnostic.host = current.host;
      diagnostic.path = current.path;
      diagnostic.title = current.title;
    }
    diagnostics.push(diagnostic);
    pending.push(current.cause);
    if (current instanceof AggregateError && Array.isArray(current.errors)) {
      for (const nested of current.errors.toReversed()) pending.push(nested);
    }
  }
  return JSON.stringify(diagnostics);
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

export class SmokeVerificationRefusedError extends AggregateError {
  readonly code = "LIVE_SMOKE_VERIFICATION_REFUSED";
  constructor(errors: readonly unknown[]) {
    super(errors, ERROR_CATALOG.LIVE_SMOKE_VERIFICATION_REFUSED.text);
    this.name = "SmokeVerificationRefusedError";
  }
}

export async function withSmokeWorker(
  database: AuthorityDatabase,
  operation: (slot: WorkerSlotRecord, gates: Set<DuoCeremonyGateHandle>) => Promise<void>,
  clock: Clock,
  verification: Readonly<{ lock: RuntimeLifetimeLock; installationId: string; profileId: string;
    profileRunId: string; system: BrowserSystemId; credentialKey: Fingerprint }>,
): Promise<void> {
  const { lock, ...identity } = verification;
  let slot: WorkerSlotRecord;
  try {
    slot = database.admitVerificationWorker({ ...identity, lockPort: lock.port, commandId: randomUUID(), workflow: "person-lookup",
      expectedPoolVersion: database.authority.workerPools.get("person-lookup")?.version ?? 0,
      leaseGeneration: 1, now: clock.now().toISOString() }, lock);
  } catch (error) { throw new SmokeVerificationRefusedError([error]); }
  const gates = new Set<DuoCeremonyGateHandle>(), errors: unknown[] = [];
  try { await operation(slot, gates); } catch (error) { errors.push(error); }
  let released = true;
  for (const gate of gates) {
    try { gate.dispose(errors[0]); } catch (error) { released = false; errors.push(error); }
  }
  if (!released || errors.some(error => error instanceof SmokeSessionClosureError || hasUnprovedSourceClosure(error))) throw new RuntimeCustodyUncertainError(errors);
  try {
    const hold = database.authority.workerSlots.verification(slot.workerId);
    if (hold === undefined) throw new Error("live-smoke-verification-reservation-missing");
    database.retireVerificationWorker({ installationId: identity.installationId, profileId: identity.profileId,
      commandId: randomUUID(), grantCommandId: hold.command.commandId, workerId: slot.workerId,
      expectedRevision: slot.membershipRevision, expectedPoolVersion: database.authority.workerPools.get(slot.workflow)?.version,
      now: clock.now().toISOString(), cleanup: "closed" }, lock);
  } catch (error) { errors.push(new SmokeVerificationRefusedError([error])); }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new SmokeVerificationRefusedError(errors);
}

export function createSmokeProfileAdmission(input: Readonly<{ database: AuthorityDatabase; lock: RuntimeLifetimeLock;
  workerId: string; ordinal: number; system: BrowserSystemId; stateRoot: string; profileRoot: string }>): BrowserSessionFactoryOptions["admitProfile"] {
  let admittedIdentity: string | undefined, readmitted = false;
  return profile => {
    input.lock.assertHeld();
    const hold = input.database.authority.workerSlots.verification(input.workerId);
    if (hold === undefined || hold.slot.ordinal !== input.ordinal || hold.request.system !== input.system
      || input.profileRoot !== join(input.stateRoot, "scratch", "live-smoke", hold.request.profileRunId, "browsers")) throw new Error("live-smoke-profile-custody-unavailable");
    const directory = workerProfileDirectory({ profileRoot: input.profileRoot, slotOrdinal: input.ordinal, system: input.system });
    const admitted = BrowserProfileAdmissionSchema.parse({ ...profile, profileRevision: 1, resetRequired: false });
    const identity = canonicalJsonStringify(admitted);
    if (profile.workerId !== input.workerId || profile.system !== input.system || profile.profileDirectory !== directory
      || admittedIdentity !== undefined && identity !== admittedIdentity) throw new Error("live-smoke-profile-custody-unavailable");
    const existing = lstatSync(directory, { throwIfNoEntry: false });
    if (existing !== undefined && (admittedIdentity === undefined || readmitted)) throw new Error("live-smoke-profile-custody-unavailable");
    for (let cursor = directory; ; cursor = dirname(cursor)) {
      const metadata = lstatSync(cursor, { throwIfNoEntry: false });
      if (metadata !== undefined && (!metadata.isDirectory() || metadata.isSymbolicLink()
        || process.getuid !== undefined && metadata.uid !== process.getuid() || (metadata.mode & 0o077) !== 0)) throw new Error("live-smoke-profile-custody-unavailable");
      if (cursor === input.profileRoot) break;
      if (cursor === dirname(cursor)) throw new Error("live-smoke-profile-custody-unavailable");
    }
    if (existing !== undefined && !realpathSync(directory).startsWith(`${realpathSync(input.profileRoot)}${sep}`)) throw new Error("live-smoke-profile-custody-unavailable");
    admittedIdentity = identity;
    if (existing !== undefined) readmitted = true;
    input.database.authority.workerSlots.observeVerificationAcquisition({ workerId: input.workerId,
      grantCommandId: hold.command.commandId, now: systemClock.now().toISOString() });
    return Promise.resolve(admitted);
  };
}

async function main(): Promise<void> {
  const lock = await acquireRuntimeLifetimeLock(rebuildRuntimeIsolation.lockPort);
  let retain = false;
  try { await runAdmittedSmoke(lock); }
  catch (error) { retain = error instanceof RuntimeCustodyUncertainError || hasUnprovedSourceClosure(error); throw error; }
  finally { if (!retain) await lock.close(); }
}

async function runAdmittedSmoke(lock: RuntimeLifetimeLock): Promise<void> {
  const requested = process.argv[2];
  if (requested === undefined || !SUPPORTED.has(requested)) throw new Error(`usage: live-browser-login-smoke <${[...SUPPORTED].join("|")}> [--headed] [--cold]`);
  const system = BrowserSystemIdSchema.parse(requested);
  if (process.argv.includes("--reuse")) throw new Error("live-smoke-profile-reuse-unavailable: developer smoke profiles require a fresh owned launch");
  const headed = process.argv.includes("--headed");
  if (process.argv.includes("--worker")) throw new Error("live-smoke-worker-selection-unavailable: the check allocates its own worker slot");
  const workspace = fileURLToPath(new URL("../..", import.meta.url));
  const machine = acquireEntrypointAdmission(workspace, "shared", lock);
  let admission: RuntimeAdmission | undefined, database: AuthorityDatabase | undefined, operationFailure: { error: unknown } | undefined;
  try {
    const selected = captureSelectedProfileStorage(machine);
    admission = machine.admitProfile(selected.profileId);
    const profileAdmission = admission;
    const stateRoot = profileAdmission.stateRoot;
    const credentials = createCredentialStore({ admission: profileAdmission, stateRoot, erasureJournalAdmission: machine,
      erasureJournalPath: join(machine.stateRoot, "machine", "erasures", `${selected.profileId}.json`) });
    assertNoMigratedEnvironmentKeys();
    database = AuthorityDatabase.open(profileAdmission, { path: selected.authorityPath, busyTimeoutMs: 5000, migrationOwner: "live-smoke" },
      systemClock, undefined, undefined, undefined, credentials);
    const openedDatabase = database;
    const lifecycle = new RunRecordService({ database: openedDatabase, clock: systemClock, ids: { uuid: randomUUID },
      publishQueued: () => { throw new Error("live-smoke-unrequested-enqueue"); } });
    reconcileStartupCrash({ machine, admission: profileAdmission, database: openedDatabase, lifecycle, clock: systemClock, lock });
    const record = database.withAuthorityTransaction(repositories => readSettings(repositories));
    const config = resolveConfigWithProvenance(record.settings, hostConfigFacts(hostAwareResolutionEnvironment(probePrimaryDisplay)),
      systemClock, { stateRoot, artifactRoot: admission.artifactRoot }).config;
    const duo = createDuoCredentialStore(profileAdmission, machine, systemClock);
    const profileRunId = randomUUID();
  await withSmokeWorker(openedDatabase, async (slot, gates) => {
  const { workerId, ordinal } = slot;
  const smokeProfileRoot = join(stateRoot, "scratch", "live-smoke", profileRunId, "browsers");
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
  const factory = new PlaywrightWorkerSessionFactory({
    duo,
    assertCurrent: requestedWorker => {
      selected.assertCurrent(); profileAdmission.assertProfileRuntime(); lock.assertHeld();
      const hold = openedDatabase.authority.workerSlots.verification(workerId);
      if (requestedWorker !== workerId || hold === undefined || hold.slot.ordinal !== ordinal || hold.request.system !== system
        || hold.request.profileRunId !== profileRunId || hold.request.credentialKey !== duoCeremonyCredentialKey(config, duo)) throw new Error("live-smoke-profile-owner-mismatch");
    },
    config: { ...smokeConfig, browser: { ...config.browser, headless: !headed } },
    protectedSecrets: createCredentialSecretSource(credentials),
    isolation: rebuildRuntimeIsolation,
    clock: systemClock,
    scheduler: realScheduler,
    newSessionId: () => randomUUID(),
    slotOrdinal: requestedWorker => { if (requestedWorker !== workerId) throw new Error("live-smoke-profile-owner-mismatch"); return ordinal; },
    admitProfile: createSmokeProfileAdmission({ database: openedDatabase, lock, stateRoot,
      workerId, ordinal, system, profileRoot: smokeProfileRoot }),
    onAuthenticationEvidence: (observed) => {
      evidence.push(observed);
      write(`[evidence] ${observed.system} @ ${hostOf(observed.url)}`);
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

  const duoFactory = composeDuoCeremonyGateFactory({
    config, duo, leases: openedDatabase.authority.duoCeremonyLeases, clock: systemClock, scheduler: realScheduler,
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
    onObservation: observation => { openedDatabase.authority.workerControls.observe({ ...observation, leaseGeneration: 1 }); },
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
  }, systemClock, { lock, ...profileAdmission.profileBinding, profileRunId, system, credentialKey: duoCeremonyCredentialKey(config, duo) });
  } catch (error) { operationFailure = { error }; }
  try {
    if (!(operationFailure?.error instanceof RuntimeCustodyUncertainError) && !hasUnprovedSourceClosure(operationFailure?.error)) {
      database?.close(); admission?.release(); machine.release();
    }
  } catch (error) { throw new RuntimeCustodyUncertainError(operationFailure === undefined ? [error] : [operationFailure.error, error]); }
  if (operationFailure !== undefined) throw operationFailure.error;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error: unknown) => {
  process.exitCode = 1;
  process.stderr.write(`${smokeErrorDiagnostic(error)}\n`);
});
