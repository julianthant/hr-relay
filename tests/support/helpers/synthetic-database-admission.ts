import { boundProfileAdmission, boundProfileCredentials, findProfileFixtureAdmission } from "./admission-fixture.js";
import { AuthorityDatabase as RealAuthorityDatabase, AuthorityDatabaseOptionsSchema } from "../../../src/backend/storage/sqlite/authority-database.js";
import { dirname } from "node:path";
import { RuntimeAdmission } from "../../../src/backend/storage/admission/admission.js";

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
