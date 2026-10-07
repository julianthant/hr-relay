import { AuthorityDatabase as RealAuthorityDatabase, AuthorityDatabaseOptionsSchema } from "../../../src/backend/storage/sqlite/authority-database.js";
import { ArchiveDatabase as RealArchiveDatabase } from "../../../src/backend/storage/sqlite/archive-database.js";
import { RuntimeAdmission } from "../../../src/backend/storage/admission/admission.js";

export type AuthorityDatabase = RealAuthorityDatabase;
export type ArchiveDatabase = RealArchiveDatabase;

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
type SyntheticArchiveStatic = Omit<typeof RealArchiveDatabase, "prototype" | "upgradeStopped" | "preflightCopy"> & {
  new(path: string, options?: ConstructorParameters<typeof RealArchiveDatabase>[2]): RealArchiveDatabase;
  upgradeStopped(path: string): void;
  preflightCopy(path: string): RealArchiveDatabase;
};

export const AuthorityDatabase = new Proxy(RealAuthorityDatabase, {
  get(target, property, receiver) {
    if (property === "open") {
      return (input: unknown, ...rest: OpenOptions) => {
        const path = AuthorityDatabaseOptionsSchema.parse(input).path;
        return target.open(RuntimeAdmission.syntheticFixture(path, "authority"), input, ...rest);
      };
    }
    if (property === "inspectExistingReadOnly") return (path: string, timeout?: number) =>
      target.inspectExistingReadOnly(RuntimeAdmission.syntheticFixture(path, "authority"), path, timeout);
    if (property === "inspectAuthorityReadIdentityReadOnly") return (path: string, timeout?: number) =>
      target.inspectAuthorityReadIdentityReadOnly(RuntimeAdmission.syntheticFixture(path, "authority"), path, timeout);
    if (property === "inspectSpanRunAuthorityReadOnly") return (path: string,
      roots: Parameters<typeof RealAuthorityDatabase.inspectSpanRunAuthorityReadOnly>[2], timeout?: number) =>
      target.inspectSpanRunAuthorityReadOnly(RuntimeAdmission.syntheticFixture(path, "authority"), path, roots, timeout);
    if (property === "inspectTimelineReadOnly") return (path: string, timeout?: number, recovery?: boolean) =>
      target.inspectTimelineReadOnly(RuntimeAdmission.syntheticFixture(path, "authority"), path, timeout, recovery);
    return Reflect.get(target, property, receiver) as unknown;
  },
}) as unknown as SyntheticAuthorityStatic;

export const ArchiveDatabase = new Proxy(RealArchiveDatabase, {
  construct(target, args) {
    const [path, options] = args as [string, ConstructorParameters<typeof RealArchiveDatabase>[2] | undefined];
    return new target(RuntimeAdmission.syntheticFixture(path, "archive"), path, options);
  },
  get(target, property, receiver) {
    if (property === "upgradeStopped") return (path: string) =>
      target.upgradeStopped(RuntimeAdmission.syntheticFixture(path, "archive"), path);
    if (property === "preflightCopy") return (path: string) =>
      target.preflightCopy(RuntimeAdmission.syntheticFixture(path, "archive"), path);
    return Reflect.get(target, property, receiver) as unknown;
  },
}) as unknown as SyntheticArchiveStatic;
