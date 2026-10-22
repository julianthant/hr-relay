import { createProfileVerifiers } from "../../../src/backend/profiles/verifier-store.js";
import { IsoInstantSchema } from "../../../src/rules/identity/ids.js";
import { tmpdir } from "node:os";
import { createProfileSession } from "../../../src/backend/profiles/profile-session.js";
import { createProfileRegistry } from "../../../src/backend/profiles/registry.js";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { rebuildRuntimeIsolation } from "../../../src/backend/app/config/runtime-isolation.js";
import { acquireEntrypointAdmission } from "../../../src/backend/storage/admission/bootstrap-admission.js";
import { RuntimeAdmission } from "../../../src/backend/storage/admission/admission.js";
import { AuthorityDatabase as ProductionAuthorityDatabase, AuthorityDatabaseOptionsSchema } from "../../../src/backend/storage/sqlite/authority-database.js";
import { createCredentialStore as productionCredentialStore } from "../../../src/backend/storage/configuration/credential-store.js";
import type { CredentialStore } from "../../../src/models/config/credential-store.js";

const admissions = new Map<string, RuntimeAdmission>();
const boundProfiles = new Map<string, { admission: RuntimeAdmission; machine: RuntimeAdmission; credentials: CredentialStore }>();

function registerBoundProfile(admission: RuntimeAdmission, machine: RuntimeAdmission): void {
  const credentials = productionCredentialStore({ admission, stateRoot: admission.stateRoot, erasureJournalAdmission: machine,
    erasureJournalPath: join(machine.stateRoot, "machine", "erasures", `${admission.profileBinding.profileId}.json`) });
  boundProfiles.set(admission.stateRoot, { admission, machine, credentials });
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

export function initializeAdmissionFixture(root: string): void {
  const canonical = resolve(root);
  if (admissions.has(canonical)) throw new Error("fixture installation already initialized");
  mkdirSync(join(canonical, rebuildRuntimeIsolation.artifactRoot), { recursive: true, mode: 0o700 });
  const initial = acquireEntrypointAdmission(canonical, "exclusive");
  initial.release();
  admissions.set(canonical, acquireEntrypointAdmission(canonical, "shared"));
}
export function fixtureAdmission(root: string): RuntimeAdmission {
  const canonical = resolve(root);
  const existing = admissions.get(canonical);
  if (existing !== undefined) {
    try { existing.assertLive(); return existing; }
    catch (error) {
      if (!(error instanceof Error) || error.message !== "runtime-admission: missing or released admission") throw error;
      const renewed = acquireEntrypointAdmission(canonical, "shared");
      admissions.set(canonical, renewed);
      return renewed;
    }
  }
  return RuntimeAdmission.syntheticRoots(join(canonical, rebuildRuntimeIsolation.stateRoot), join(canonical, rebuildRuntimeIsolation.artifactRoot));
}
export function installationAdmission(root: string): RuntimeAdmission {
  if (!admissions.has(resolve(root))) initializeAdmissionFixture(root);
  return fixtureAdmission(root);
}
export function releaseAdmissionFixture(root: string): void {
  const admission = admissions.get(resolve(root));
  admissions.delete(resolve(root));
  admission?.release();
}
export function releaseAdmissionFixtures(): void {
  for (const root of [...admissions.keys()]) releaseAdmissionFixture(root);
}
function admissionForStateRoot(root: string): RuntimeAdmission {
  const bound = boundProfiles.get(resolve(root))?.admission;
  if (bound !== undefined) { bound.assertLive(); return bound; }
  for (const workspace of admissions.keys()) if (join(workspace, rebuildRuntimeIsolation.stateRoot) === resolve(root)) return fixtureAdmission(workspace);
  return RuntimeAdmission.syntheticRoots(resolve(root), join(resolve(root), "artifacts"));
}
export type AuthorityDatabase = ProductionAuthorityDatabase;
export const AuthorityDatabase = new Proxy(ProductionAuthorityDatabase, {
  get(target, property, receiver) {
    if (property === "open") return (input: unknown, ...rest: Parameters<typeof ProductionAuthorityDatabase.open> extends [unknown, unknown, ...infer R] ? R : never) => {
      const root = dirname(AuthorityDatabaseOptionsSchema.parse(input).path);
      const admission = admissionForStateRoot(root);
      const [clock, writeHooks, terminalHooks, lifecycleHooks, credentials] = rest;
      return target.open(admission, input, clock, writeHooks, terminalHooks, lifecycleHooks,
        credentials ?? boundProfileCredentials(admission));
    };
    return Reflect.get(target, property, receiver) as unknown;
  },
}) as unknown as Omit<typeof ProductionAuthorityDatabase, "open"> & {
  open(input: unknown, clock?: Parameters<typeof ProductionAuthorityDatabase.open>[2]): ProductionAuthorityDatabase;
};
export function createCredentialStore(input: Omit<Parameters<typeof productionCredentialStore>[0], "admission">) {
  const entry = boundProfiles.get(resolve(input.stateRoot));
  if (entry !== undefined) {
    if (Object.keys(input).length === 1) return boundProfileCredentials(entry.admission);
    return productionCredentialStore({ erasureJournalAdmission: entry.machine,
      erasureJournalPath: join(entry.machine.stateRoot, "machine", "erasures", `${entry.admission.profileBinding.profileId}.json`),
      ...input, admission: entry.admission });
  }
  return productionCredentialStore({ ...input, admission: admissionForStateRoot(input.stateRoot) });
}

export function createBoundProfileFixture(options: { pending?: true } = {}) {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), "relay-bound-profile-")));
  const machine = acquireEntrypointAdmission(workspace, "exclusive");
  try {
    const fields = { firstName: "Fixture", lastName: "Example", email: "fixture@example.edu",
      password: "disposable-fixture-password", createdAt: "2026-10-01T12:00:00.000Z" };
    const session = createProfileSession({ admission: machine, machineRoot: machine.stateRoot,
      activity: { hasUnquiescedWork: () => false }, backupPaths: () => [], loginDataPaths: () => [] });
    const operation = machine.beginProfileSignUp({ firstName: fields.firstName, lastName: fields.lastName,
      createdAt: IsoInstantSchema.parse(fields.createdAt), emailKey: createProfileVerifiers(machine.stateRoot).emailKeyFor(fields.email),
      commandFingerprint: "a".repeat(64) });
    let admission = machine.admitProfile(createProfileRegistry(machine).storageClaim(operation.profileId));
    const stateRoot = admission.stateRoot;
    registerBoundProfile(admission, machine);
    const finish = () => {
      const active = session.signUp(fields);
      if (active.state !== "active" || active.profileId !== operation.profileId) throw new Error("bound profile fixture signup refused");
      admission.release();
      admission = machine.admitProfile(createProfileRegistry(machine).storageClaim(active.profileId));
      registerBoundProfile(admission, machine);
    };
    if (options.pending !== true) finish();
    return { workspace, machine, get admission() { return admission; }, stateRoot, path: join(stateRoot, "state.db"), finish,
      close() { boundProfiles.delete(stateRoot); admission.release(); machine.release(); rmSync(workspace, { recursive: true, force: true }); } };
  } catch (error) { machine.release(); rmSync(workspace, { recursive: true, force: true }); throw error; }
}
