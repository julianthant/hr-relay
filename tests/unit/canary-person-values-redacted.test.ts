import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "vitest";

const REPO_ROOT = process.cwd();
const MIGRATION_PATH = join(REPO_ROOT, "docs", "migrations", "separations.md");
const PHASE_PATH = join(REPO_ROOT, "docs", "rebuild", "03b-finish-separations.md");

const SECRET_REFS = {
  eid: "<secret:HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_EID>",
  employeeName: "<secret:HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_EMPLOYEE_NAME>",
  timekeeperName: "<secret:HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_TIMEKEEPER_NAME>",
} as const;

const SECRET_ENV_KEYS = {
  eid: "HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_EID",
  employeeName: "HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_EMPLOYEE_NAME",
  timekeeperName: "HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_TIMEKEEPER_NAME",
} as const;

function sectionAfter(source: string, heading: string): string {
  const start = source.indexOf(heading);
  assert.notEqual(start, -1, `required heading is missing: ${heading}`);
  const end = source.indexOf("\n### ", start + heading.length);
  return source.slice(start, end === -1 ? source.length : end);
}

const migration = readFileSync(MIGRATION_PATH, "utf8");
const phase = readFileSync(PHASE_PATH, "utf8");
const current4537Sections = [
  sectionAfter(migration, "### 9.19 The 4537 canary mapping pass"),
  sectionAfter(migration, "### 9.31 The one-subject registry consolidation"),
].join("\n");
const d286Start = phase.indexOf("**D286 —");
const d286End = phase.indexOf("\n**Historical Phase-2 evidence", d286Start);
assert.notEqual(d286Start, -1, "D286 prose is missing");
assert.notEqual(d286End, -1, "D286 prose boundary is missing");
const d286 = phase.slice(d286Start, d286End);

describe("4537 person-value documentation redaction", () => {
  it("keeps direct eight-digit EIDs out of current 4537 sections", () => {
    assert.doesNotMatch(current4537Sections, /\b\d{8}\b/u);
    assert.doesNotMatch(d286, /\b\d{8}\b/u);
  });

  it("requires every registered person-value field to name its public secret reference", () => {
    const fieldLines = current4537Sections.split("\n").filter((line) =>
      /^EID\*\s/u.test(line)
      || /^Employee Last Name, First Name\*\s/u.test(line)
      || /\| `(?:EID\*|Employee Last Name, First Name\*|timekeeperName|Timekeeper Name:\*)` \|/u.test(line));
    assert.ok(fieldLines.length >= 6, "the current 4537 mapping must retain all registered person fields");
    for (const line of fieldLines) {
      const expected = /(?:^EID\*\s|\| `EID\*` \|)/u.test(line)
        ? SECRET_REFS.eid
        : /(?:^Employee Last Name, First Name\*\s|\| `Employee Last Name, First Name\*` \|)/u.test(line)
          ? SECRET_REFS.employeeName
          : SECRET_REFS.timekeeperName;
      assert.match(line, new RegExp(expected, "u"));
    }
  });

  it("records D286 as code-built but operationally pending", () => {
    assert.match(d286, /code\s+BUILT/u);
    assert.match(d286, /operationally PENDING/u);
    for (const reference of Object.values(SECRET_ENV_KEYS)) assert.match(d286, new RegExp(reference, "u"));
    assert.match(d286, /npx tsx --env-file=\.env -e/u);
    assert.match(d286, /exit\s+status 0/u);
    assert.match(d286, /no secret value/u);
  });
});
