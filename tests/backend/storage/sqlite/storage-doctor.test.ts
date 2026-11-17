import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { candidateRestoreEligibility, STORAGE_HEALTH_CAUSE_RULES, storageHealthCauseOf } from "../../../../src/backend/storage/sqlite/storage-doctor.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../../../src/models/config/authority-schema-versions.js";

/** Every message that reaches the classifier today, copied from its throw site, with the code it gets. */
const THROWN: ReadonlyArray<readonly [string, string, string]> = [
  ["authority-database.ts application_id check", "existing database application_id 0 is not the HR authority store", "authority-not-sqlite"],
  ["SQLite open of a non-database file", "file is not a database", "authority-not-sqlite"],
  ["AuthoritySchemaVersionError, older or newer", "authority schema 30 does not match supported 29", "authority-schema-mismatch"],
  ["foreign-key check", "authority database foreign-key validation failed for 1 row(s)", "authority-foreign-key"],
  ["table registry check", "authority database tables do not match registry: actual=commands expected=commands,runs", "authority-schema-mismatch"],
  ["metadata version check", "authority schema metadata 28 disagrees with user_version 29", "authority-schema-mismatch"],
  ["invariant check", "authority database invariant validation failed: runs completion", "authority-invariant"],
  ["empty or absent file", "authority database /state/state.db is missing or empty", "authority-empty"],
  // Misfire kept until D2: `empty|missing` is tested first.
  ["completion revision query", "missing completion revision invariant", "authority-empty"],
  ["native record validation", "authority table commands failed native record validation: Invalid input", "authority-record-invalid"],
  // Misfire kept until D2: the inner text names a missing value.
  ["native record validation of missing settings", "authority table settings failed native record validation: saved settings missing", "authority-empty"],
  ["AuthorityWriterBusyError", "authority-writer-busy: database is locked", "authority-locked"],
  ["SQLite table lock", "database table is locked", "authority-locked"],
  ["config snapshot refinement", "config-snapshot-fingerprint-mismatch", "authority-record-invalid"],
  ["SQLite damage", "database disk image is malformed", "authority-corrupt"],
  ["integrity check", "quick_check returned 2 rows", "authority-corrupt"],
  ["anything else", "authority source changed during inspection", "authority-unavailable"],
];

/** Patterns that no thrown message reaches today; pinned so the order stays as it is. */
const UNREACHED: ReadonlyArray<readonly [string, string]> = [
  ["authority newer than supported", "authority-schema-newer"],
  ["strict record schema validation", "authority-record-invalid"],
  ["held by another migration owner", "authority-migration-locked"],
];

describe("storage health cause classification", () => {
  it("tests its rules in one frozen order", () => {
    expect(STORAGE_HEALTH_CAUSE_RULES.map(rule => rule.code)).toEqual([
      "authority-empty", "authority-not-sqlite", "authority-schema-newer", "authority-record-invalid", "authority-schema-mismatch",
      "authority-migration-locked", "authority-foreign-key", "authority-invariant", "authority-locked", "authority-corrupt",
    ]);
    expect(Object.isFrozen(STORAGE_HEALTH_CAUSE_RULES) && STORAGE_HEALTH_CAUSE_RULES.every(Object.isFrozen)).toBe(true);
  });

  for (const [site, message, code] of THROWN) it(`${site} → ${code}`, () => {
    expect(storageHealthCauseOf(new Error(message))).toEqual({ code, summary: message });
  });

  for (const [message, code] of UNREACHED) it(`unreached pattern "${message}" → ${code}`, () => {
    expect(storageHealthCauseOf(new Error(message)).code).toBe(code);
  });

  it("summarizes a non-error value on one line", () => {
    expect(storageHealthCauseOf("authority\n   database is\tlocked ")).toEqual({ code: "authority-locked", summary: "authority database is locked" });
  });
});

describe("candidate restore eligibility", () => {
  it("decides eligibility only behind the live admission that inspected the candidate", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "relay-candidate-eligibility-")));
    const admission = RuntimeAdmission.syntheticFixture(join(root, "state.db"));
    try {
      const facts = { schemaVersion: CURRENT_AUTHORITY_SCHEMA_VERSION, authorityAvailable: true, samePersonValid: () => true };
      expect(candidateRestoreEligibility(admission, facts)).toEqual({ state: "eligible" });
      admission.release();
      expect(() => candidateRestoreEligibility(admission, facts)).toThrow(/released/u);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
