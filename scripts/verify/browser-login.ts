import { recoverOwnedSmokeSlot, SmokeSlotRecoveryRefusedError } from "./browser-login-recovery.js";
import { ERROR_CATALOG } from "../../src/models/failures/error-catalog.js";
import { WorkerVerificationClaimSchema, WorkerVerificationClosureProofSchema } from "../../src/backend/storage/sqlite/run-store-contracts.js";
import { admitWorkerVerification, retireWorkerVerification } from "../../src/backend/storage/sqlite/worker-slots.js";
import { z } from "zod";
import { createCredentialStore } from "../../src/backend/storage/configuration/credential-store.js";
import { acquireEntrypointAdmission } from "../../src/backend/storage/admission/bootstrap-admission.js";
import { fileURLToPath } from "node:url";
import { hostConfigFacts } from "../../src/models/config/host-display.js";
/** Live login smoke against production SSO: it reports content-based login proof (never a value), and full Chromium is required to load the Duo extension. */
/** It never runs a workflow node and never commits a UCPath transaction. */
import { randomUUID } from "node:crypto";
import { lstatSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { rebuildRuntimeIsolation } from "../../src/backend/app/config/runtime-isolation.js";
import { composeDuoCeremonyGateFactory, duoCeremonyCredentialKey } from "../../src/backend/runtime/gates/duo-ceremony-gate.js";
import { SessionAcquisitionTimeoutError, sessionAcquisitionTimeoutText, WorkerSessionManager } from "../../src/backend/runtime/workers/worker-sessions.js";
import { systemClock } from "../../src/rules/time/clock.js";
import { resolveConfigWithProvenance } from "../../src/backend/app/config/resolve.js";
import { RuntimeInstanceSchema } from "../../src/models/config/instance.js";
import { assertNoMigratedEnvironmentKeys, hostAwareResolutionEnvironment } from "../../src/models/config/secrets.js";
import {
  BrowserSystemIdSchema,
  FingerprintSchema,
  WorkflowIdSchema, PositiveIntSchema, IsoInstantSchema,
} from "../../src/rules/identity/ids.js";
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
import { acquireRuntimeProcessLock, readRuntimeProcessLock, RuntimeProcessLockFileSchema, observeProcessIdentity, readLiveSmokeRuntimeFile, writeLiveSmokeRuntimeFileExclusive, removeOwnedLiveSmokeRuntimeFile } from "../../src/backend/storage/sqlite/runtime-process-locks.js";
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
      : current instanceof SmokeSlotOwnershipUnavailableError ? "SmokeSlotOwnershipUnavailableError"
      : current instanceof SmokeSlotRecoveryRefusedError ? "SmokeSlotRecoveryRefusedError"
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
    if (current instanceof SmokeSlotRecoveryRefusedError) {
      diagnostic.code = current.code;
      diagnostic.text = ERROR_CATALOG.LIVE_SMOKE_RECOVERY_REFUSED.text;
    }
    if (current instanceof SmokeSlotOwnershipUnavailableError) {
      diagnostic.code = "live-smoke-slot-ownership-unavailable";
      diagnostic.text = SMOKE_SLOT_OWNERSHIP_UNAVAILABLE_TEXT;
    }
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
  proveClosure?: () => void,
): Promise<void> {
  try {
    await sessions.closeAll("worker-stop");
    deleteProfile();
    proveClosure?.();
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
  onRetired: (() => void) | undefined,
  custody: Readonly<{ processLockRoot: string; stateRoot: string }>,
): Promise<void> {
  const owner = readRuntimeProcessLock(custody.processLockRoot, "live-smoke");
  if (owner === undefined) throw new SmokeSlotOwnershipUnavailableError();
  const slot = database.withAuthorityTransaction(repositories => admitWorkerVerification(repositories, {
    commandId: randomUUID(), workflow: "person-lookup", expectedPoolVersion: repositories.workerPools.get("person-lookup")?.version ?? 0,
    ...custody, owner, now: clock.now().toISOString(),
  }, randomUUID()));
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
      retireSmokeSlot(database, slot, clock);
      onRetired?.();
    } catch (error) { errors.push(error); }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, "live-smoke-operation-or-cleanup-failed");
}

function retireSmokeSlot(database: AuthorityDatabase, original: WorkerSlotRecord, clock: Clock, mode: "live" | "recovery" = "live"): void {
  database.withAuthorityTransaction(repositories => {
    const hold = repositories.workerSlots.verification(original.workerId);
    if (hold === undefined) throw new SmokeSlotOwnershipUnavailableError();
    retireWorkerVerification(repositories, { commandId: randomUUID(), grantCommandId: hold.command.commandId,
      workerId: hold.slot.workerId, expectedRevision: hold.slot.membershipRevision,
      expectedPoolVersion: repositories.workerPools.get(hold.slot.workflow)?.version, now: clock.now().toISOString(),
      cleanup: { acquisitionId: hold.request.owner.acquisitionId, browsersClosed: true, profilesReleased: true, duoReleased: true,
        mode, evidence: hold.slot.phase === "starting" ? "browserless" : "closed" } }, randomUUID());
  });
}

const SmokeSlotClaimSchema = WorkerVerificationClaimSchema;
const SmokeClosureProofSchema = WorkerVerificationClosureProofSchema;
const SmokeProcessReleaseSchema = z.strictObject({ generation: PositiveIntSchema, acquisitionId: z.uuid(), releasedAt: IsoInstantSchema });
export const SMOKE_SLOT_OWNERSHIP_UNAVAILABLE_TEXT = "Smoke slot retirement requires this check's explicit slot ownership record and proved browser closure. Historical process-only claims cannot identify a slot.";
export class SmokeSlotOwnershipUnavailableError extends Error {
  readonly code = "live-smoke-slot-ownership-unavailable";
  constructor() { super(SMOKE_SLOT_OWNERSHIP_UNAVAILABLE_TEXT); this.name = "SmokeSlotOwnershipUnavailableError"; }
}

function smokeSlotClaimRoot(processLockRoot: string): string { return join(processLockRoot, "live-smoke-slots"); }

export function recordSmokeSlot(input: Readonly<{ database: AuthorityDatabase; processLockRoot: string; slot: WorkerSlotRecord;
  profileRunId: string; system: BrowserSystemId; credentialKey: Fingerprint }>) {
  const processClaim = readRuntimeProcessLock(input.processLockRoot, "live-smoke");
  if (processClaim?.pid !== process.pid || processClaim.releasedAt !== null) throw new SmokeSlotOwnershipUnavailableError();
  const hold = input.database.authority.workerSlots.verification(input.slot.workerId);
  if (hold === undefined || canonicalJsonStringify(hold.request.owner) !== canonicalJsonStringify(processClaim)
    || hold.request.processLockRoot !== input.processLockRoot
    || input.profileRunId !== hold.request.owner.acquisitionId) throw new SmokeSlotOwnershipUnavailableError();
  const slot = input.database.authority.workerSlots.observeVerificationAcquisition({ workerId: input.slot.workerId,
    grantCommandId: hold.command.commandId, now: hold.request.now });
  const claim = SmokeSlotClaimSchema.parse({ source: "live-smoke", slot, process: processClaim,
    profileRunId: input.profileRunId, system: input.system, credentialKey: input.credentialKey });
  const root = smokeSlotClaimRoot(input.processLockRoot);
  const name = `${processClaim.acquisitionId}.slot.json`;
  const custody = writeLiveSmokeRuntimeFileExclusive(root, name, canonicalJsonStringify(claim));
  let proofCustody: ReturnType<typeof writeLiveSmokeRuntimeFileExclusive> | undefined;
  return {
    proveClosure: (clock: Clock = systemClock) => {
      proofCustody = writeLiveSmokeRuntimeFileExclusive(root, `${processClaim.acquisitionId}.closed.json`,
        canonicalJsonStringify(SmokeClosureProofSchema.parse({ acquisitionId: processClaim.acquisitionId,
          workerId: input.slot.workerId, membershipRevision: input.slot.membershipRevision,
          browsersClosed: true, checkedAt: clock.now().toISOString() })));
    },
    remove: () => {
      if (proofCustody !== undefined) removeOwnedLiveSmokeRuntimeFile(root, `${processClaim.acquisitionId}.closed.json`, proofCustody);
      removeOwnedLiveSmokeRuntimeFile(root, name, custody);
    },
  };
}

export function retireOwnedSmokeSlots(input: Readonly<{ database: AuthorityDatabase; processLockRoot: string;
  stateRoot: string; clock?: Clock; observeProcess?: typeof observeProcessIdentity }>): void {
  const clock = input.clock ?? systemClock;
  readRuntimeProcessLock(input.processLockRoot, "live-smoke");
  const root = smokeSlotClaimRoot(input.processLockRoot);
  const directory = join(root, "live-smoke-claims");
  const metadata = lstatSync(directory, { throwIfNoEntry: false });
  if (metadata === undefined || !metadata.isDirectory() || metadata.isSymbolicLink()) throw new SmokeSlotOwnershipUnavailableError();
  const names = readdirSync(directory);
  if (names.length === 0) throw new SmokeSlotOwnershipUnavailableError();
  for (const name of names) if (!/^[a-f0-9-]{36}\.(slot|closed)\.json$/u.test(name)) throw new SmokeSlotOwnershipUnavailableError();
  for (const name of names.filter(candidate => candidate.endsWith(".closed.json"))) {
    if (!names.includes(name.replace(".closed.json", ".slot.json"))) throw new SmokeSlotOwnershipUnavailableError();
  }
  for (const name of names.filter(candidate => candidate.endsWith(".slot.json"))) {
    const record = readLiveSmokeRuntimeFile(root, name);
    const claim = SmokeSlotClaimSchema.parse(JSON.parse(record.text));
    if (name !== `${claim.process.acquisitionId}.slot.json`) throw new SmokeSlotOwnershipUnavailableError();
    const processClaim = RuntimeProcessLockFileSchema.parse(JSON.parse(readLiveSmokeRuntimeFile(input.processLockRoot,
      `${claim.process.generation}.claim.json`).text));
    const release = SmokeProcessReleaseSchema.parse(JSON.parse(readLiveSmokeRuntimeFile(input.processLockRoot,
      `${claim.process.generation}-${claim.process.acquisitionId}.release.json`).text));
    if (canonicalJsonStringify(processClaim) !== canonicalJsonStringify(claim.process)
      || release.generation !== processClaim.generation || release.acquisitionId !== processClaim.acquisitionId
      || (input.observeProcess ?? observeProcessIdentity)(processClaim.pid).state !== "gone") throw new SmokeSlotOwnershipUnavailableError();
    if (!names.includes(`${claim.process.acquisitionId}.closed.json`)) throw new SmokeSlotOwnershipUnavailableError();
    const proofRecord = readLiveSmokeRuntimeFile(root, `${claim.process.acquisitionId}.closed.json`);
    const proof = SmokeClosureProofSchema.parse(JSON.parse(proofRecord.text));
    if (proof.acquisitionId !== claim.process.acquisitionId || proof.workerId !== claim.slot.workerId
      || proof.membershipRevision !== claim.slot.membershipRevision) throw new SmokeSlotOwnershipUnavailableError();
    const slot = input.database.authority.workerSlots.get(claim.slot.workerId);
    const hold = input.database.authority.workerSlots.verification(claim.slot.workerId);
    if (hold === undefined || hold.request.stateRoot !== input.stateRoot || hold.request.processLockRoot !== input.processLockRoot
      || canonicalJsonStringify(hold.request.owner) !== canonicalJsonStringify(claim.process)) throw new SmokeSlotOwnershipUnavailableError();
    if (slot === undefined || canonicalJsonStringify(slot) !== canonicalJsonStringify(claim.slot)
      || input.database.authority.duoCeremonyLeases.get(claim.credentialKey)?.state === "held") throw new SmokeSlotOwnershipUnavailableError();
    const profileRoot = join(input.stateRoot, "scratch", "live-smoke", claim.profileRunId, "browsers");
    deleteOwnedBrowserProfile(profileRoot, join(profileRoot, `w${slot.ordinal}`));
    retireSmokeSlot(input.database, slot, clock, "recovery");
    removeOwnedLiveSmokeRuntimeFile(root, `${claim.process.acquisitionId}.closed.json`, proofRecord.custody);
    removeOwnedLiveSmokeRuntimeFile(root, name, record.custody);
  }
}

export function createSmokeProfileAdmission(input: Readonly<{
  database: AuthorityDatabase;
  processLockRoot: string;
  acquisitionId: string;
  workerId: WorkerSlotRecord["workerId"];
  ordinal: number;
  system: ReturnType<typeof BrowserSystemIdSchema.parse>;
  profileRoot: string;
}>): BrowserSessionFactoryOptions["admitProfile"] {
  let admittedIdentity: string | undefined;
  let readmitted = false;
  return profile => {
    const lock = readRuntimeProcessLock(input.processLockRoot, "live-smoke");
    const hold = input.database.authority.workerSlots.verification(input.workerId);
    const claim = SmokeSlotClaimSchema.parse(JSON.parse(readLiveSmokeRuntimeFile(smokeSlotClaimRoot(input.processLockRoot), `${input.acquisitionId}.slot.json`).text));
    if (hold === undefined || hold.slot.phase !== "waiting" || hold.slot.ordinal !== input.ordinal
      || hold.request.processLockRoot !== input.processLockRoot
      || canonicalJsonStringify(hold.request.owner) !== canonicalJsonStringify(lock)
      || canonicalJsonStringify(claim.slot) !== canonicalJsonStringify(hold.slot)
      || canonicalJsonStringify(claim.process) !== canonicalJsonStringify(lock)
      || claim.profileRunId !== hold.request.owner.acquisitionId
      || claim.system !== input.system || input.profileRoot !== join(hold.request.stateRoot, "scratch", "live-smoke", hold.request.owner.acquisitionId, "browsers")) throw new Error("live-smoke-profile-custody-unavailable");
    const directory = workerProfileDirectory({ profileRoot: input.profileRoot, slotOrdinal: input.ordinal, system: input.system });
    const admission = BrowserProfileAdmissionSchema.parse({ ...profile, profileRevision: 1, resetRequired: false });
    const identity = canonicalJsonStringify(admission);
    if (lock?.pid !== process.pid || lock.releasedAt !== null || lock.acquisitionId !== input.acquisitionId
      || profile.workerId !== input.workerId || profile.system !== input.system || profile.profileDirectory !== directory
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
    return Promise.resolve(admission);
  };
}

async function main(): Promise<void> {
  const requested = process.argv[2];
  const retireOwned = requested === "--retire-owned-slots";
  const recoverOwned = requested === "--recover-owned-slot";
  const recoverAcquisitionId = recoverOwned ? z.uuid().parse(process.argv[3]) : undefined;
  if (!retireOwned && !recoverOwned && (requested === undefined || !SUPPORTED.has(requested))) {
    throw new Error(`usage: live-browser-login-smoke <${[...SUPPORTED].join("|")}> [--headed] [--cold] | --retire-owned-slots | --recover-owned-slot <acquisitionId>`);
  }
  const system = retireOwned || recoverOwned ? undefined : BrowserSystemIdSchema.parse(requested);
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
  if (recoverAcquisitionId !== undefined) {
    recoverOwnedSmokeSlot({ database, processLockRoot, stateRoot, acquisitionId: recoverAcquisitionId });
    write("[smoke] exact owned slot retired with fresh recovery proof");
    return;
  }
  if (retireOwned) {
    retireOwnedSmokeSlots({ database, processLockRoot, stateRoot });
    write("[smoke] owned slots retired with recorded closure proof");
    return;
  }
  if (system === undefined) throw new Error("live-smoke-system-unavailable");
  let ownedRecord: ReturnType<typeof recordSmokeSlot> | undefined;
  await withSmokeWorker(database, async (slot, gates) => {
  const { workerId, ordinal } = slot;
  const hostFacts = hostConfigFacts(hostAwareResolutionEnvironment(probePrimaryDisplay));
  const record = database.withAuthorityTransaction((repositories) => readSettings(repositories));
  const config = resolveConfigWithProvenance(record.settings, hostFacts, systemClock).config;
  const profileRunId = z.uuid().parse(processLock.acquisitionId);
  const smokeProfileRoot = join(stateRoot, "scratch", "live-smoke", profileRunId, "browsers");
  ownedRecord = recordSmokeSlot({ database, processLockRoot, slot, profileRunId, system, credentialKey: duoCeremonyCredentialKey(config) });
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
    admitProfile: createSmokeProfileAdmission({ database, processLockRoot, acquisitionId: z.uuid().parse(processLock.acquisitionId),
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
    () => { deleteOwnedBrowserProfile(smokeProfileRoot, join(smokeProfileRoot, `w${ordinal}`)); }, sessionErrors, () => { ownedRecord?.proveClosure(); });
  write("[smoke] every session closed with proof");
  }, systemClock, () => { ownedRecord?.remove(); }, { processLockRoot, stateRoot });
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
