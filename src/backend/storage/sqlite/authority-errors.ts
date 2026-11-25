import { z } from "zod";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../../models/config/authority-schema-versions.js";
import { ERROR_CATALOG } from "../../../models/failures/error-catalog.js";
import { bindErrorOrigin } from "../../../models/failures/error-origins.js";
import { isNativeRecordIntegrityFailure } from "./native-record-row.js";

export class AuthoritySchemaVersionError extends Error {
  readonly code = "authority-schema-mismatch";
  constructor(readonly schemaVersion: number) {
    super(`authority schema ${schemaVersion} does not match supported ${CURRENT_AUTHORITY_SCHEMA_VERSION}`);
    this.name = "AuthoritySchemaVersionError";
  }
}
bindErrorOrigin(AuthoritySchemaVersionError, error => error.schemaVersion > CURRENT_AUTHORITY_SCHEMA_VERSION ? "profile-newer" : "unknown-error");

/** A registered person database this build must not read or repair: newer, or an unsupported format. */
export class AuthorityFormatUnsupportedError extends Error {
  constructor(readonly code: "STORAGE_PROFILE_NEWER_VERSION" | "STORAGE_PROFILE_FORMAT_UNSUPPORTED", options?: ErrorOptions) {
    super(ERROR_CATALOG[code].text, options);
    this.name = "AuthorityFormatUnsupportedError";
  }
}
bindErrorOrigin(AuthorityFormatUnsupportedError, error => error.code === "STORAGE_PROFILE_NEWER_VERSION" ? "profile-newer" : "profile-format-unsupported");

export class AuthorityWriterBusyError extends Error {
  readonly code = "DATABASE_WRITER_UNAVAILABLE";
  constructor(options: ErrorOptions) {
    super("authority-writer-busy: database is locked", options);
    this.name = "AuthorityWriterBusyError";
  }
}

/** A copy's history and native connections kept showing different commits; a later read can pair them. */
export class AuthoritySnapshotChangedError extends Error {
  readonly code = "STORAGE_SNAPSHOT_CHANGED";
  constructor() {
    super("isolated-history-snapshot-changed");
    this.name = "AuthoritySnapshotChangedError";
  }
}

const integrityFailures = new WeakSet<Error>();

export function authorityIntegrityError(message: string): Error {
  const error = new Error(message);
  integrityFailures.add(error);
  return error;
}

export type StartupFailureClassification = Readonly<{ kind: "damaged" }> | Readonly<{ kind: "missing-run-search-projection" }>
  | Readonly<{ kind: "version-skew"; error: AuthorityFormatUnsupportedError }> | Readonly<{ kind: "intact" }>;

/** SQLite's own verdict: SQLITE_CORRUPT (11) or SQLITE_NOTADB (26), on the error or its direct cause. */
export function isSqliteDamage(error: unknown): boolean {
  for (const value of [error, error instanceof Error ? error.cause : undefined]) {
    if (value instanceof Error && "errcode" in value && (value.errcode === 11 || value.errcode === 26)) return true;
  }
  return false;
}

/** Combined failures can include a changed source or unproved closure, so cannot certify damage. */
export function isAuthorityInspectionIntegrityFailure(error: unknown): boolean {
  return error instanceof Error && !(error instanceof AggregateError) && (integrityFailures.has(error) || isSqliteDamage(error));
}

// Imported readers use plain Errors for these stored-data contradictions.
const importedIntegrityFailures = new Set([
  "run row is missing whole-record JSON",
  "run lifecycle JSON must contain exactly the non-envelope record",
  "run row columns do not match the native schema",
  "run-current-settlement-ambiguous",
  "run-settlement-context-mismatch",
  "command-row-identity-mismatch",
  "command-row-outcome-mismatch",
  "command-row-outcome-missing",
  "command-audit-settlement-mismatch",
  "run-lifecycle-request-binding-mismatch",
  "run-lifecycle-request-fence-mismatch",
  "deleted-run-tally-duplicate",
  "timeline-record-invalid",
  "timeline-event-column-mismatch",
  "assistant-conversation-expiry-invalid",
  "assistant-attachment-bytes-invalid",
  "assistant-preference-audit-invalid",
  "assistant-preference-current-missing-with-history",
  "assistant-preference-current-divergent",
  "imported-artifact-row-identity-mismatch",
  "generated artifact mirrored columns disagree with its strict record JSON",
  "extracted-artifact-row-identity-mismatch",
  "settings-current-command-audit-binding-mismatch",
  "settings-current-missing-with-history",
  "settings-row-identity-mismatch",
  "settings-initialization-command-missing",
  "settings-initialization-audit-missing",
  "settings-initialization-binding-mismatch",
  "settings-current-command-audit-missing",
  "settings-snapshot-missing",
  "settings-snapshot-binding-mismatch",
  "settings-snapshot-preferences-mismatch",
  "unconfirmed-write-publication-forbidden",
  "confirmed-write-publication-intent-mismatch",
  "confirmed-write-publication-proof-mismatch",
  "notification-publication-owner-mismatch",
  "notification-publication-identity-mismatch",
  "notification-publication-source-conflict",
  "notification-health-identity-mismatch",
  "run-search-actor-source-invalid",
  "run-search-actor-source-duplicate",
  "run-search-actor-ambiguous",
  "run-search-declaration-identity-mismatch",
  "run-search-build-prefix-invalid",
  "run-search-source-coverage-invalid",
  "run-search-source-metadata-invalid",
  "run-search-index-corrupt",
  "run-search-retained-actor-source-mismatch",
  "run-search-retained-actor-source-missing",
  "run-search-subject-invalid",
]);

function importedReaderFoundInvalidData(message: string): boolean {
  return importedIntegrityFailures.has(message)
    || /^run row [a-z_]+ does not match its whole-record JSON$/u.test(message)
    || /^deleted-run-row-[a-z_]+-mismatch$/u.test(message);
}

function storedDataFailedValidation(error: unknown): boolean {
  const seen = new Set<Error>();
  let confirmed = false;
  for (let failure = error; failure instanceof Error && !seen.has(failure); failure = failure.cause) {
    if (failure instanceof AggregateError) return false;
    if ("errcode" in failure) return isSqliteDamage(failure);
    if ("code" in failure && typeof failure.code === "string") {
      // Some validators wrap a failed SQL read as a record error. Check its cause before using the wrapper.
      if (/^(?:ERR_|E[A-Z0-9]+$)/u.test(failure.code)) return false;
      if (failure.code === "WORKBOOK_STORAGE_CORRUPT") confirmed = true;
    }
    if (integrityFailures.has(failure) || isNativeRecordIntegrityFailure(failure) || failure instanceof z.ZodError || failure instanceof SyntaxError
      || importedReaderFoundInvalidData(failure.message)) confirmed = true;
    seen.add(failure);
  }
  return confirmed;
}

export function inspectStoredData<T>(inspect: () => T): T {
  try { return inspect(); }
  catch (error) {
    if (error instanceof Error && storedDataFailedValidation(error)) integrityFailures.add(error);
    throw error;
  }
}

export class CredentialContextRequiredError extends Error {
  readonly code = "CREDENTIAL_CONTEXT_REQUIRED";
  constructor() {
    super(ERROR_CATALOG.CREDENTIAL_CONTEXT_REQUIRED.text);
    this.name = "CredentialContextRequiredError";
  }
}
