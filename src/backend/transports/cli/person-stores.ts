import { join } from "node:path";
import { RunIdSchema } from "../../../rules/identity/ids.js";
import type { RuntimeAdmission } from "../../storage/admission/admission.js";
import { AuthorityDatabase } from "../../storage/sqlite/authority-database.js";

/** Read one store as storage doctor does: read-only, never migrated, closed before the result is returned. */
export function readStore<Result>(owner: RuntimeAdmission, migrationOwner: string, read: (database: AuthorityDatabase) => Result): Result {
  const database = AuthorityDatabase.open(owner, { path: join(owner.stateRoot, "state.db"),
    busyTimeoutMs: 5000, migrationOwner, openMode: "storage-doctor-read-only-no-migrate" });
  try { return read(database); }
  finally { database.close(); }
}

export const PERSON_STORE_SIGN_IN_REQUIRED = "no ready person is signed in, and a person's store opens only while that person is signed in; sign in, stop the runtime and repeat";

export function selectPersonStores(machine: RuntimeAdmission) {
  const registry = machine.readProfileRegistry();
  const ready = registry.profiles.filter(row => row.lifecycle === "ready").map(row => row.profileId);
  const signedIn = registry.activeProfileId !== null && ready.includes(registry.activeProfileId) ? registry.activeProfileId : null;
  return { ready, signedIn, notChecked: ready.filter(profileId => profileId !== signedIn)
    .map(profileId => ({ profileId, reason: "signed-out" as const })) };
}

/** Each person keeps their own store under the machine root: admit one ready person, read their store, and release them whatever the read does. */
export function readPersonStore<Result>(machine: RuntimeAdmission, profileId: string, migrationOwner: string,
  read: (database: AuthorityDatabase) => Result): Result {
  const owner = machine.admitProfile(profileId);
  try { return readStore(owner, migrationOwner, read); }
  finally { owner.release(); }
}

/**
 * The one person whose store the machine admission may search for a run and repair: the signed-in person.
 * A person's store opens only while that person is signed in, so nobody else's store is opened, and every other case throws.
 */
export function findRunHolder(machine: RuntimeAdmission, run: string, person?: string): string {
  const runId = RunIdSchema.parse(run), { ready, signedIn, notChecked } = selectPersonStores(machine);
  if (person !== undefined && !ready.includes(person)) throw new Error(`person ${person} is not a ready person on this installation`);
  if (signedIn === null) throw new Error(PERSON_STORE_SIGN_IN_REQUIRED);
  if (person !== undefined && person !== signedIn) {
    throw new Error(`person ${person} is not signed in, and a person's store opens only while that person is signed in; sign in as that person, stop the runtime and repeat`);
  }
  if (readPersonStore(machine, signedIn, "span-root-repair-search", database => database.authority.runs.get(runId) !== undefined)) return signedIn;
  const unsearched = notChecked.map(({ profileId }) => profileId);
  throw new Error(`the store of the signed-in person ${signedIn} does not hold run ${runId}${unsearched.length === 0 ? ""
    : `; not searched, because they are not signed in: ${unsearched.join(", ")}`}`);
}
