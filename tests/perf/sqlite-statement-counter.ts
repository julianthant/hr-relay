
import { DatabaseSync } from "node:sqlite";
import { systemClock } from "../../src/rules/time/clock.js";

type PrepareFn = (typeof DatabaseSync)["prototype"]["prepare"];

export interface StatementCount {
  /** `prepare()` calls issued while the callback ran. */
  readonly statements: number;
}


export function countSqliteStatements<Result>(
  work: () => Result,
): { readonly value: Result; readonly count: StatementCount } {
  const { value, statements } = traceSqliteStatements(work);
  return { value, count: { statements: statements.length } };
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

export interface PreparedStatementTrace {
  readonly sql: string;
  /** Monotonic milliseconds when `prepare()` was entered and returned. */
  readonly startedAt: number;
  readonly endedAt: number;
}

/** Every `prepare()` issued while the callback ran, with its SQL and how long it took. */
export function traceSqliteStatements<Result>(
  work: () => Result,
): { readonly value: Result; readonly statements: readonly PreparedStatementTrace[] } {
  const statements: PreparedStatementTrace[] = [];
  const prototype = DatabaseSync.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "prepare");
  if (descriptor === undefined || descriptor.writable !== true || descriptor.configurable !== true || typeof descriptor.value !== "function") {
    throw new Error(
      "node:sqlite's DatabaseSync.prototype.prepare is not a writable, configurable data property, "
      + "so this build cannot count SQLite statements; refusing to report a fabricated zero",
    );
  }
  const original = descriptor.value as PrepareFn;
  const tracing = function tracingPrepare(this: DatabaseSync, ...args: Parameters<PrepareFn>): ReturnType<PrepareFn> {
    const startedAt = systemClock.monotonicMs();
    const statement = original.apply(this, args);
    statements.push({ sql: args[0], startedAt, endedAt: systemClock.monotonicMs() });
    return statement;
  };
  Object.defineProperty(prototype, "prepare", { ...descriptor, value: tracing });
  try {
    return { value: work(), statements };
  } finally {
    Object.defineProperty(prototype, "prepare", descriptor);
  }
}
