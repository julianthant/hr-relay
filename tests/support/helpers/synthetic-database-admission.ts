import { createCredentialStore as productionCredentialStore } from "../../../src/backend/storage/configuration/credential-store.js";
import type { CredentialStore } from "../../../src/models/config/credential-store.js";
import { AuthorityDatabase as RealAuthorityDatabase, AuthorityDatabaseOptionsSchema } from "../../../src/backend/storage/sqlite/authority-database.js";
import { dirname, join, resolve, sep } from "node:path";
import { RuntimeAdmission } from "../../../src/backend/storage/admission/admission.js";
import type { Clock } from "../../../src/rules/time/clock.js";

type FixtureWorker = Readonly<{ database: RealAuthorityDatabase; workerId: string; generation: number | undefined;
  processId: number; clock: Clock }>;
const boundProfiles = new Map<string, { admission: RuntimeAdmission; machine: RuntimeAdmission; credentials: CredentialStore;
  workers: Set<FixtureWorker> }>();
const workerDatabases = new WeakSet<RealAuthorityDatabase>();

export function registerBoundProfile(admission: RuntimeAdmission, machine: RuntimeAdmission): void {
  const credentials = productionCredentialStore({ admission, stateRoot: admission.stateRoot, erasureJournalAdmission: machine,
    erasureJournalPath: join(machine.stateRoot, "machine", "erasures", `${admission.profileBinding.profileId}.json`) });
  const prior = boundProfiles.get(admission.stateRoot);
  if (prior !== undefined && prior.workers.size !== 0) throw new Error("fixture-worker-custody-retained");
  boundProfiles.set(admission.stateRoot, { admission, machine, credentials, workers: new Set() });
}

export function unregisterBoundProfile(admission: RuntimeAdmission): void {
  const entries = [...boundProfiles].filter(([, entry]) => entry.admission === admission);
  const entry = entries[0];
  if (entries.length !== 1 || entry === undefined) throw new Error("fixture-bound-profile-owner-required");
  if (entry[1].workers.size !== 0) throw new Error("fixture-worker-custody-retained");
  boundProfiles.delete(entry[0]);
}

export function assertBoundFixtureWorkersReleased(admission: RuntimeAdmission): void {
  const entries = [...boundProfiles].filter(([, entry]) => entry.admission === admission);
  const entry = entries[0];
  if (entries.length !== 1 || entry === undefined) throw new Error("fixture-bound-profile-owner-required");
  if (entry[1].workers.size !== 0) throw new Error("fixture-worker-custody-retained");
}

const syntheticWorkerStops = new WeakMap<object, { readonly path: string; readonly stop: () => void }>();

export function detachBoundFixtureWorkers(database: RealAuthorityDatabase): void {
  const registered = syntheticWorkerStops.get(database);
  if (registered === undefined) return;
  const admission = boundProfileAdmission(registered.path);
  const entry = boundProfiles.get(admission.stateRoot);
  if (entry === undefined) return;
  for (const worker of [...entry.workers]) {
    if (worker.database !== database) continue;
    entry.workers.delete(worker);
  }
}

export function stopSyntheticDatabaseWorkers(input: Pick<Parameters<typeof registerBoundFixtureWorker>[0], "database" | "path">): void {
  const registered = syntheticWorkerStops.get(input.database);
  if (registered === undefined || registered.path !== input.path) throw new Error("synthetic-database-fixture-unavailable");
  registered.stop();
}

export function registerBoundFixtureWorker(input: FixtureWorker & Readonly<{ path: string }>): void {
  const admission = boundProfileAdmission(input.path);
  const entry = boundProfiles.get(admission.stateRoot);
  if (entry?.admission !== admission || input.database.getSourceDatabaseIdentity() !== RealAuthorityDatabase.sourceDatabaseIdentity(input.path)) {
    throw new Error("fixture-worker-database-owner-mismatch");
  }
  if ([...entry.workers].some(worker => worker.workerId === input.workerId)) throw new Error("fixture-worker-owner-already-retained");
  const worker = Object.freeze({ database: input.database, workerId: input.workerId, generation: input.generation,
    processId: input.processId, clock: input.clock });
  entry.workers.add(worker);
  if (workerDatabases.has(input.database)) return;
  workerDatabases.add(input.database);
  syntheticWorkerStops.set(input.database, { path: input.path, stop: () => {
const retained = [...entry.workers].filter(value => value.database === input.database);
const failures: unknown[] = [];
for (const owner of retained) {
    try {
      const lease = owner.database.authority.workerLeases.get(owner.workerId);
      if (owner.generation === undefined && lease !== undefined) throw new Error("fixture-worker-lifetime-replaced");
      // Closing this connection must not stop a replacement lifetime.
      if (owner.generation !== undefined && (lease === undefined || lease.leaseGeneration !== owner.generation || lease.processId !== owner.processId)) continue;
      owner.database.assertWorkerLifecycleRelease(owner.workerId);
      if (owner.database.authority.workerControls.browsers(owner.workerId).some(browser => browser.health !== "closed")) {
        throw new Error("fixture-worker-browser-closure-unproved");
      }
      if (lease !== undefined && lease.lifecycle.state !== "stopped") {
        const now = owner.clock.now().toISOString();
        const stopped = owner.database.authority.workerLeases.reportLifecycle({ workerId: owner.workerId,
          leaseGeneration: lease.leaseGeneration, now, lifecycle: { state: "stopped", startedAt: lease.lifecycle.startedAt,
            stoppedAt: now, reason: "shutdown" } });
        if (stopped.state !== "applied") throw new Error("fixture-worker-stop-conflict");
      }
    } catch (error) {
      failures.push(error);
    }
  }
if (failures.length !== 0) throw new AggregateError(failures, "fixture-worker-closure-unproved");
  } });
  const close = input.database.close.bind(input.database);
  let databaseClosed = false;
  input.database.close = () => {
    if (!databaseClosed) stopSyntheticDatabaseWorkers(input);
    const retained = [...entry.workers].filter(value => value.database === input.database);
    if (!databaseClosed) { close(); databaseClosed = true; }
    for (const owner of retained) entry.workers.delete(owner);
  };
}

export function boundFixtureWorker(database: RealAuthorityDatabase, path: string, workerId: string): boolean {
  const admission = boundProfileAdmission(path), entry = boundProfiles.get(admission.stateRoot);
  if (entry?.admission !== admission || database.getSourceDatabaseIdentity() !== RealAuthorityDatabase.sourceDatabaseIdentity(path)) return false;
  const owner = [...entry.workers].find(worker => worker.database === database && worker.workerId === workerId);
  if (owner === undefined) return false;
  const lease = database.authority.workerLeases.get(workerId), slot = database.authority.workerSlots.get(workerId);
  return slot?.retiredAt === null && lease !== undefined && lease.leaseGeneration === owner.generation && lease.processId === owner.processId
    && lease.lifecycle.state !== "stopped";
}

export function createBoundProfileCredentialStore(admission: RuntimeAdmission, options: Omit<Parameters<typeof productionCredentialStore>[0], "admission" | "erasureJournalAdmission" | "erasureJournalPath">): CredentialStore {
  const entry = boundProfiles.get(admission.stateRoot);
  if (entry?.admission !== admission || options.stateRoot !== admission.stateRoot) throw new Error("fixture-bound-profile-credential-owner-required");
  return productionCredentialStore({ ...options, admission, erasureJournalAdmission: entry.machine,
    erasureJournalPath: join(entry.machine.stateRoot, "machine", "erasures", `${admission.profileBinding.profileId}.json`) });
}

export function boundProfileCredentials(admission: RuntimeAdmission): CredentialStore {
  const entry = boundProfiles.get(admission.stateRoot);
  if (entry?.admission !== admission) throw new Error("fixture-bound-profile-credential-owner-required");
  admission.assertLive();
  return entry.credentials;
}

export function findProfileFixtureInWorkspace(workspace: string): RuntimeAdmission | undefined {
  const root = resolve(workspace);
  for (const [stateRoot, entry] of boundProfiles) {
    if (stateRoot === root || stateRoot.startsWith(`${root}${sep}`)) {
      entry.admission.assertLive();
      return entry.admission;
    }
  }
  return undefined;
}

export function findProfileFixtureAdmission(stateRoot: string): RuntimeAdmission | undefined {
  const admission = boundProfiles.get(resolve(stateRoot))?.admission;
  admission?.assertLive();
  return admission;
}

export function profileFixtureStorageAdmission(path: string): RuntimeAdmission {
  const canonical = resolve(path);
  const admission = boundProfiles.get(dirname(canonical))?.admission;
  if (admission === undefined || canonical !== join(admission.stateRoot, "state.db")) throw new Error("fixture-bound-profile-path-required");
  admission.assertLive();
  return admission;
}

export function boundProfileAdmission(path: string): RuntimeAdmission {
  const admission = profileFixtureStorageAdmission(path);
  admission.assertProfileRuntime();
  return admission;
}


export type AuthorityDatabase = RealAuthorityDatabase;
const fixturePaths = new WeakMap<RealAuthorityDatabase, string>();

export function syntheticDatabasePath(database: RealAuthorityDatabase): string {
  const path = fixturePaths.get(database);
  if (path === undefined) throw new Error("synthetic database path missing");
  return path;
}

type WithoutAdmission<F extends (...args: never[]) => unknown> = Parameters<F> extends [unknown, ...infer Rest] ? Rest : never;
type OpenOptions = Parameters<typeof RealAuthorityDatabase.open> extends [unknown, unknown, ...infer Rest] ? Rest : never;
type SyntheticAuthorityStatic = Omit<typeof RealAuthorityDatabase,
  "open" | "inspectExistingReadOnly" | "inspectAuthorityReadIdentityReadOnly" | "inspectSpanRunAuthorityReadOnly" | "inspectTimelineReadOnly"> & {
  open(...args: WithoutAdmission<typeof RealAuthorityDatabase.open>): RealAuthorityDatabase;
  inspectExistingReadOnly(...args: WithoutAdmission<typeof RealAuthorityDatabase.inspectExistingReadOnly>): ReturnType<typeof RealAuthorityDatabase.inspectExistingReadOnly>;
  inspectAuthorityReadIdentityReadOnly(...args: WithoutAdmission<typeof RealAuthorityDatabase.inspectAuthorityReadIdentityReadOnly>): ReturnType<typeof RealAuthorityDatabase.inspectAuthorityReadIdentityReadOnly>;
  inspectSpanRunAuthorityReadOnly(...args: WithoutAdmission<typeof RealAuthorityDatabase.inspectSpanRunAuthorityReadOnly>): ReturnType<typeof RealAuthorityDatabase.inspectSpanRunAuthorityReadOnly>;
  inspectTimelineReadOnly(...args: WithoutAdmission<typeof RealAuthorityDatabase.inspectTimelineReadOnly>): ReturnType<typeof RealAuthorityDatabase.inspectTimelineReadOnly>;
};
export const AuthorityDatabase = new Proxy(RealAuthorityDatabase, {
  get(target, property, receiver) {
    if (property === "open") {
      return (input: unknown, ...rest: OpenOptions) => {
        const path = AuthorityDatabaseOptionsSchema.parse(input).path;
        const admission = boundProfileAdmission(path);
        const [clock, writeHooks, terminalHooks, lifecycleHooks, credentials] = rest;
        const database = target.open(admission, input, clock, writeHooks, terminalHooks, lifecycleHooks,
          credentials ?? boundProfileCredentials(admission));
        fixturePaths.set(database, path);
        return database;
      };
    }
    if (property === "inspectExistingReadOnly") return (path: string, timeout?: number) =>
      target.inspectExistingReadOnly((findProfileFixtureAdmission(dirname(path)) ?? RuntimeAdmission.syntheticFixture(path)), path, timeout);
    if (property === "inspectAuthorityReadIdentityReadOnly") return (path: string, timeout?: number) =>
      target.inspectAuthorityReadIdentityReadOnly((findProfileFixtureAdmission(dirname(path)) ?? RuntimeAdmission.syntheticFixture(path)), path, timeout);
    if (property === "inspectSpanRunAuthorityReadOnly") return (path: string,
      roots: Parameters<typeof RealAuthorityDatabase.inspectSpanRunAuthorityReadOnly>[2], timeout?: number) =>
      target.inspectSpanRunAuthorityReadOnly((findProfileFixtureAdmission(dirname(path)) ?? RuntimeAdmission.syntheticFixture(path)), path, roots, timeout);
    if (property === "inspectTimelineReadOnly") return (path: string, timeout?: number, recovery?: boolean) =>
      target.inspectTimelineReadOnly((findProfileFixtureAdmission(dirname(path)) ?? RuntimeAdmission.syntheticFixture(path)), path, timeout, recovery);
    return Reflect.get(target, property, receiver) as unknown;
  },
}) as unknown as SyntheticAuthorityStatic;
