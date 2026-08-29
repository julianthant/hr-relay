import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "vitest";

const MIGRATION_PATH = resolve(process.cwd(), "docs/migrations/separations.md");
const CURRENT_CANARY_HEADING = "### 9.19 The 4537 canary mapping pass";
const NEXT_HEADING = "\n### ";

const PERSON_SECRET_REFERENCES = Object.freeze({
  employee: "<secret:separationsKualiFinalizationCanaryEmployeeName>",
  timekeeper: "<secret:separationsKualiFinalizationCanaryTimekeeperName>",
  eid: "<secret:separationsKualiFinalizationCanaryEid>",
});

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+*?.]/gu, "\\$&");
}

function currentCanaryMigrationSection(): string {
  const migration = readFileSync(MIGRATION_PATH, "utf8");
  const start = migration.indexOf(CURRENT_CANARY_HEADING);
  if (start < 0) throw new Error(`${MIGRATION_PATH} must retain the current 4537 migration section`);
  const end = migration.indexOf(NEXT_HEADING, start + CURRENT_CANARY_HEADING.length);
  return migration.slice(start, end < 0 ? undefined : end);
}

describe("current 4537 migration-person redaction", () => {
  it("uses public secret references for every direct canary person field", () => {
    const section = currentCanaryMigrationSection();

    assert.match(
      section,
      new RegExp(`EID\\*\\s+${escapeRegex(PERSON_SECRET_REFERENCES.eid)}`, "u"),
      "the document subject EID must be a public secret reference",
    );
    assert.match(
      section,
      new RegExp(`Employee Last Name, First Name\\*\\s+${escapeRegex(PERSON_SECRET_REFERENCES.employee)}`, "u"),
      "the document subject employee name must be a public secret reference",
    );
    assert.match(
      section,
      new RegExp(`\\| \\x60timekeeperName\\x60 \\|[^\\n]*${escapeRegex(PERSON_SECRET_REFERENCES.timekeeper)}`, "u"),
      "the document timekeeper value must be a public secret reference",
    );
  });

  it("refuses a direct eight-digit EID wherever the current 4537 prose labels an EID", () => {
    const section = currentCanaryMigrationSection();

    assert.doesNotMatch(
      section,
      /\b(?:EID|Empl ID)\*?(?:\s*=\s*|\s+)\d{8}\b/u,
      "a labelled current-canary EID must never be committed directly",
    );
  });
});
