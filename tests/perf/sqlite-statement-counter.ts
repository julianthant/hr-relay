
import { DatabaseSync } from "node:sqlite";

type PrepareFn = (typeof DatabaseSync)["prototype"]["prepare"];

export interface StatementCount {
  /** `prepare()` calls issued while the callback ran. */
  readonly statements: number;
}


export function countSqliteStatements<Result>(
  work: () => Result,
): { readonly value: Result; readonly count: StatementCount } {
  const prototype = DatabaseSync.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "prepare");
  if (descriptor === undefined || descriptor.writable !== true || descriptor.configurable !== true) {
    throw new Error(
      "node:sqlite's DatabaseSync.prototype.prepare is not a writable, configurable data property, "
      + "so this build cannot count SQLite statements; refusing to report a fabricated zero",
    );
  }
  const original = descriptor.value as PrepareFn;
  if (typeof original !== "function") {
    throw new Error("DatabaseSync.prototype.prepare is not a function; the counting window cannot be installed");
  }
  let statements = 0;
  const counting = function countingPrepare(this: DatabaseSync, ...args: Parameters<PrepareFn>): ReturnType<PrepareFn> {
    statements += 1;
    return original.apply(this, args);
  };
  Object.defineProperty(prototype, "prepare", { ...descriptor, value: counting });
  try {
    const value = work();
    return { value, count: { statements } };
  } finally {
    Object.defineProperty(prototype, "prepare", descriptor);
  }
}


export function assertStatementCounterObserves(database: Readonly<{ prepareProbe: () => void }>): void {
  const { count } = countSqliteStatements(() => {
    database.prepareProbe();
  });
  if (count.statements === 0) {
    throw new Error(
      "the SQLite statement counter observed 0 statements for a probe that prepares one; "
      + "the counting window is not reaching node:sqlite and every count below would be a lie",
    );
  }
}
