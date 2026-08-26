/**
 * A counting window over `node:sqlite`'s prepared statements — the ONE
 * instrument this lane uses for "how many SQLite queries did that surface
 * cost" (ref frontend-backend-integration §7.4, the D264 baseline).
 *
 * Why the prototype and not a wrapper around the authority store: the finding
 * being measured (`docs/plans/2026-08-20-dashboard-architecture-audit.md` §3.3
 * P2/P4) is stated in SQLite hits, and a wrapper around the read PORT counts
 * logical calls, which is a different number that would stop agreeing with the
 * SQL the moment a repository method issued two statements. `AuthorityDatabase`
 * prepares every statement at the point of use (`this.#database.prepare(...)`
 * with no cache), so one `prepare()` is one statement executed.
 *
 * What it does NOT count, said out loud rather than left to be discovered:
 * `DatabaseSync.exec()`, which this tree uses for DDL and transaction control
 * (`BEGIN`/`COMMIT`). A measured READ runs no DDL, and the transaction
 * statements are a fixed two per write — so a count taken over a read is exact,
 * and a count taken over a write is exact up to its transaction control.
 *
 * The patch is installed and removed around one callback and fails loud if the
 * property is not writable: a counter that silently counted nothing would be
 * exactly the "check that cannot fail" this repository bans.
 */
import { DatabaseSync } from "node:sqlite";

type PrepareFn = (typeof DatabaseSync)["prototype"]["prepare"];

export interface StatementCount {
  /** `prepare()` calls issued while the callback ran. */
  readonly statements: number;
}

/**
 * Runs `work` with a counting `prepare`, restores the original, and returns
 * both the work's value and the count.
 */
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

/**
 * A self-check the harness runs before it reports any count: the window must
 * observe a statement it knows was executed. Without this, a future Node that
 * stopped routing `prepare` through the prototype would turn every count in
 * the baseline table into a silent zero.
 */
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
