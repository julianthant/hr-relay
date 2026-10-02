import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { rebuildRuntimeIsolation } from "../../../src/backend/app/config/runtime-isolation.js";
import { acquireEntrypointAdmission } from "../../../src/backend/storage/admission/bootstrap-admission.js";
import { RuntimeAdmission } from "../../../src/backend/storage/admission/admission.js";
import { AuthorityDatabase as ProductionAuthorityDatabase, AuthorityDatabaseOptionsSchema } from "../../../src/backend/storage/sqlite/authority-database.js";
import { createCredentialStore as productionCredentialStore } from "../../../src/backend/storage/configuration/credential-store.js";

const admissions = new Map<string, RuntimeAdmission>();
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
  for (const workspace of admissions.keys()) if (join(workspace, rebuildRuntimeIsolation.stateRoot) === resolve(root)) return fixtureAdmission(workspace);
  return RuntimeAdmission.syntheticRoots(resolve(root), join(resolve(root), "artifacts"));
}
export type AuthorityDatabase = ProductionAuthorityDatabase;
export const AuthorityDatabase = new Proxy(ProductionAuthorityDatabase, {
  get(target, property, receiver) {
    if (property === "open") return (input: unknown, ...rest: Parameters<typeof ProductionAuthorityDatabase.open> extends [unknown, unknown, ...infer R] ? R : never) => {
      const root = dirname(AuthorityDatabaseOptionsSchema.parse(input).path);
      return target.open(admissionForStateRoot(root), input, ...rest);
    };
    return Reflect.get(target, property, receiver) as unknown;
  },
}) as unknown as Omit<typeof ProductionAuthorityDatabase, "open"> & {
  open(input: unknown, clock?: Parameters<typeof ProductionAuthorityDatabase.open>[2]): ProductionAuthorityDatabase;
};
export function createCredentialStore(input: Omit<Parameters<typeof productionCredentialStore>[0], "admission">) {
  return productionCredentialStore({ ...input, admission: admissionForStateRoot(input.stateRoot) });
}
