import { createCredentialStore as productionCredentialStore } from "../../../src/backend/storage/configuration/credential-store.js";
import type { CredentialStore } from "../../../src/models/config/credential-store.js";
import { AuthorityDatabase as RealAuthorityDatabase, AuthorityDatabaseOptionsSchema } from "../../../src/backend/storage/sqlite/authority-database.js";
import { dirname, join, resolve } from "node:path";
import { RuntimeAdmission } from "../../../src/backend/storage/admission/admission.js";

const boundProfiles = new Map<string, { admission: RuntimeAdmission; machine: RuntimeAdmission; credentials: CredentialStore }>();

export function registerBoundProfile(admission: RuntimeAdmission, machine: RuntimeAdmission): void {
  const credentials = productionCredentialStore({ admission, stateRoot: admission.stateRoot, erasureJournalAdmission: machine,
    erasureJournalPath: join(machine.stateRoot, "machine", "erasures", `${admission.profileBinding.profileId}.json`) });
  boundProfiles.set(admission.stateRoot, { admission, machine, credentials });
}

export function unregisterBoundProfile(admission: RuntimeAdmission): void {
  const entries = [...boundProfiles].filter(([, entry]) => entry.admission === admission);
  const entry = entries[0];
  if (entries.length !== 1 || entry === undefined) throw new Error("fixture-bound-profile-owner-required");
  boundProfiles.delete(entry[0]);
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
