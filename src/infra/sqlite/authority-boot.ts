import { existsSync, statSync } from "node:fs";
import type { Clock } from "../../domain/clock.js";
import { systemClock } from "../../domain/clock.js";
import { AuthorityDatabase, AuthorityDatabaseOptionsSchema } from "./authority-database.js";
import {
  AuthorityBootReportSchema,
  StorageHealthCauseSchema,
  type AuthorityBootReport,
  type StorageHealthCause,
} from "./recovery-contracts.js";

/**
 * A cause `summary` is a ONE-LINE human sentence — it is printed inside the
 * doctor's report, the Settings surface, and a notification title. The
 * failures that produce it are frequently zod errors whose `message` is a
 * pretty-printed multi-line JSON array, and pasting that into a line-oriented
 * report buried the very sentence the operator needed (observed in the 2j
 * drill: `authority: DEGRADED —` followed by twenty lines of issue objects).
 * Collapsing runs of whitespace keeps every word — nothing is truncated or
 * dropped — while making the line a line.
 */
function oneLine(message: string): string {
  return message.replace(/\s+/gu, " ").trim();
}

export function storageHealthCauseFromError(error: unknown): StorageHealthCause {
  const summary = oneLine(error instanceof Error ? error.message : String(error));
  let code: StorageHealthCause["code"];
  if (/empty|missing/i.test(summary)) code = "authority-empty";
  else if (/not a database|file is not a database|not the HR authority store/i.test(summary)) code = "authority-not-sqlite";
  else if (/newer than supported/i.test(summary)) code = "authority-schema-newer";
  else if (/strict record schema validation/i.test(summary)) code = "authority-record-invalid";
  else if (/schema|tables do not match registry|user_version/i.test(summary)) code = "authority-schema-mismatch";
  else if (/migration owner/i.test(summary)) code = "authority-migration-locked";
  else if (/foreign-key/i.test(summary)) code = "authority-foreign-key";
  else if (/invariant/i.test(summary)) code = "authority-invariant";
  else if (/database is locked|database table is locked/i.test(summary)) code = "authority-locked";
  else if (/malformed|corrupt|quick_check/i.test(summary)) code = "authority-corrupt";
  else code = "authority-unavailable";
  return StorageHealthCauseSchema.parse({ code, summary });
}

export class AuthorityMutationUnavailableError extends Error {
  readonly code = "AUTHORITY_MUTATION_UNAVAILABLE";
  readonly operation: "enqueue" | "claim" | "commit" | "control";
  readonly health: StorageHealthCause;

  constructor(operation: "enqueue" | "claim" | "commit" | "control", health: StorageHealthCause) {
    super(`authority mutation ${operation} is unavailable in degraded read-only mode: ${health.summary}`);
    this.name = "AuthorityMutationUnavailableError";
    this.operation = operation;
    this.health = health;
  }
}

export class AuthorityBootStore implements Disposable {
  #database: AuthorityDatabase | undefined;
  #report: AuthorityBootReport;

  private constructor(database: AuthorityDatabase | undefined, report: AuthorityBootReport) {
    this.#database = database;
    this.#report = report;
  }

  static open(input: unknown, clock: Clock = systemClock): AuthorityBootStore {
    const options = AuthorityDatabaseOptionsSchema.parse(input);
    const checkedAt = clock.now().toISOString();
    const existed = existsSync(options.path);
    if (existed && statSync(options.path).size === 0) {
      const cause = storageHealthCauseFromError(new Error(`authority database ${options.path} exists but is empty`));
      return new AuthorityBootStore(undefined, AuthorityBootReportSchema.parse({
        state: "degraded-read-only",
        checkedAt,
        mutationAvailability: "blocked",
        cause,
      }));
    }
    if (existed) {
      try {
        AuthorityDatabase.inspectExistingReadOnly(options.path, options.busyTimeoutMs);
      } catch (error) {
        return new AuthorityBootStore(undefined, AuthorityBootReportSchema.parse({
          state: "degraded-read-only",
          checkedAt,
          mutationAvailability: "blocked",
          cause: storageHealthCauseFromError(error),
        }));
      }
    }
    try {
      const database = AuthorityDatabase.open(options, clock);
      return new AuthorityBootStore(database, AuthorityBootReportSchema.parse({
        state: "healthy",
        checkedAt,
        mutationAvailability: "available",
        inspection: AuthorityDatabase.inspectExistingReadOnly(options.path, options.busyTimeoutMs),
      }));
    } catch (error) {
      return new AuthorityBootStore(undefined, AuthorityBootReportSchema.parse({
        state: "degraded-read-only",
        checkedAt,
        mutationAvailability: "blocked",
        cause: storageHealthCauseFromError(error),
      }));
    }
  }

  report(): AuthorityBootReport {
    return this.#report;
  }

  requireWritable(operation: "enqueue" | "claim" | "commit" | "control"): AuthorityDatabase {
    if (this.#database !== undefined) return this.#database;
    if (this.#report.state !== "degraded-read-only") {
      throw new Error("authority boot store has neither a writable database nor a degraded health cause");
    }
    throw new AuthorityMutationUnavailableError(operation, this.#report.cause);
  }

  close(): void {
    this.#database?.close();
    this.#database = undefined;
  }

  [Symbol.dispose](): void {
    this.close();
  }
}
