/**
 * Ref data-intake-and-edit-data §7 vectors #1, #3, #6 and #13 — the mapping boundary.
 *
 * The suggestion scorer is the single most dangerous piece of intake, because
 * its output looks exactly like the answer. Legacy's `COLUMN_PATTERNS` decided
 * what a column meant and nobody was asked; the redesign keeps the knowledge
 * and moves the decision. That separation is only real if it is mechanical, so:
 *
 * - `suggestions.ts` may not reach a binding. It cannot name `confirmedAt`, and
 *   `ColumnBindingSchema` — whose `confirmedAt` is required — may be parsed in
 *   exactly one place.
 * - A binding resolves by header + occurrence, never by stored index.
 * - A projection target must reuse its canonical field's schema OBJECT.
 * - The whole intake domain stays bundle-safe, because the mapping grid is a
 *   browser surface and ref frontend-backend-integration §8.13's lesson was that a Node built-in six hops
 *   away kills the app at module evaluation.
 *
 * Each static arm is executed against a violating fixture through the same
 * scanning function, so a scan that stopped scanning would fail here.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { z } from "zod";
import { describe, it } from "vitest";
import { REPO_ROOT, walkFiles, repoRelative } from "./helpers/guard-files.js";
import { CANONICAL_FIELDS } from "../../src/domain/fields/registry.js";
import { defineIntakeProjection } from "../../src/domain/intake/projection.js";
import {
  ColumnMappingSchema,
  detectColumns,
  headerFingerprint,
  resolveSavedMapping,
  sourceColumnId,
} from "../../src/domain/intake/mapping.js";
import { SourceColumnIdSchema } from "../../src/domain/ids.js";

const INTAKE_ROOT = join(REPO_ROOT, "src/domain/intake");
const BINDING_MINT = "src/domain/intake/mapping.ts";

interface ScannedFile {
  readonly path: string;
  readonly source: string;
}

function intakeSources(): ScannedFile[] {
  return walkFiles(INTAKE_ROOT, { extensions: [".ts"] })
    .map((absolute) => ({ path: repoRelative(absolute), source: readFileSync(absolute, "utf8") }));
}

/** The whole static rule set, as a pure function over sources. */
export function intakeBoundaryViolations(files: readonly ScannedFile[]): string[] {
  const violations: string[] = [];
  for (const { path, source } of files) {
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

    if (/from\s+"node:/.test(code)) {
      violations.push(`${path}: imports a Node built-in; the mapping grid is a browser surface`);
    }
    if (path.endsWith("/suggestions.ts")) {
      if (/confirmedAt/.test(code)) {
        violations.push(`${path}: names confirmedAt, the field only an operator action supplies`);
      }
      if (/ColumnBindingSchema|ColumnMappingSchema/.test(code)) {
        violations.push(`${path}: reaches the binding schemas; a scorer must not be able to build one`);
      }
    }
    if (path !== BINDING_MINT && /ColumnBindingSchema\s*\.\s*parse/.test(code)) {
      violations.push(`${path}: parses a ColumnBinding; confirmBinding in ${BINDING_MINT} is the only mint`);
    }
  }
  return violations;
}

describe("ref data-intake-and-edit-data §7 intake mapping boundary", () => {
  it("scans a non-empty intake domain", () => {
    const files = intakeSources();
    assert.equal(files.length >= 3, true, "expected mapping, projection and suggestions modules");
    assert.deepEqual(intakeBoundaryViolations(files), []);
  });

  describe("negative controls — the scan fails when it should", () => {
    it("catches a scorer that names the operator's confirmation instant", () => {
      assert.deepEqual(
        intakeBoundaryViolations([{
          path: "src/domain/intake/suggestions.ts",
          source: "const binding = { targetFieldId, sourceColumnId, confirmedAt: now };",
        }]),
        ["src/domain/intake/suggestions.ts: names confirmedAt, the field only an operator action supplies"],
      );
    });

    it("catches a scorer that reaches the binding schemas", () => {
      assert.deepEqual(
        intakeBoundaryViolations([{
          path: "src/domain/intake/suggestions.ts",
          source: 'import { ColumnBindingSchema } from "./mapping.js";',
        }]),
        ["src/domain/intake/suggestions.ts: reaches the binding schemas; a scorer must not be able to build one"],
      );
    });

    it("catches a second place minting a binding", () => {
      assert.deepEqual(
        intakeBoundaryViolations([{
          path: "src/backend/transports/dashboard/routes/intake.ts",
          source: "return ColumnBindingSchema.parse(body);",
        }]),
        [
          "src/backend/transports/dashboard/routes/intake.ts: parses a ColumnBinding; "
          + "confirmBinding in src/domain/intake/mapping.ts is the only mint",
        ],
      );
    });

    it("catches a Node built-in entering the browser-reachable intake domain", () => {
      assert.deepEqual(
        intakeBoundaryViolations([{
          path: "src/domain/intake/mapping.ts",
          source: 'import { createHash } from "node:crypto";',
        }]),
        ["src/domain/intake/mapping.ts: imports a Node built-in; the mapping grid is a browser surface"],
      );
    });

    it("does not fire on a comment that merely discusses the rule", () => {
      assert.deepEqual(
        intakeBoundaryViolations([{
          path: "src/domain/intake/suggestions.ts",
          source: "// A Suggestion has no confirmedAt and cannot reach ColumnBindingSchema.\nexport const x = 1;",
        }]),
        [],
      );
    });
  });

  describe("the behavioural half", () => {
    const WorkStudyInput = z.strictObject({
      emplId: CANONICAL_FIELDS.eid.schema,
      effectiveDate: CANONICAL_FIELDS.effectiveDate.schema,
    });
    const projection = defineIntakeProjection(WorkStudyInput, {
      emplId: CANONICAL_FIELDS.eid,
      effectiveDate: CANONICAL_FIELDS.effectiveDate,
    });

    it("refuses a target whose schema is a copy rather than the canonical object (#6)", () => {
      const Copied = z.strictObject({ emplId: z.string().regex(/^10\d{6}$/) });
      assert.throws(
        () => defineIntakeProjection(Copied, { emplId: CANONICAL_FIELDS.eid }),
        /must reuse the canonical eid schema object/,
      );
    });

    it("never resolves an absent column to whatever now sits at its index (#3)", () => {
      const detected = detectColumns(["Employee ID#", "Effective Date"], [["10456712"], ["07/01/2026"]]);
      const mapping = ColumnMappingSchema.parse({
        workflow: "work-study",
        intakeProjectionFingerprint: projection.fingerprint,
        fingerprint: headerFingerprint(detected),
        savedAt: "2026-08-05T18:00:00.000Z",
        headerRowIndex: 0,
        columns: detected.map(({ samples: _samples, ...rest }) => rest),
        bindings: [{
          targetFieldId: "emplId",
          canonicalFieldId: "eid",
          // A column that is NOT in the file, while index 0 is occupied.
          sourceColumnId: SourceColumnIdSchema.parse(sourceColumnId("Employee Number", 1)),
          confirmedAt: "2026-08-05T18:00:00.000Z",
        }],
      });
      const reuse = resolveSavedMapping({ mapping, detected, projection, workflow: "work-study" });
      assert.equal(reuse.outcome, "offered");
      if (reuse.outcome !== "offered") return;
      assert.equal(reuse.resolutions.every((entry) => entry.state === "unbound"), true);
      // `effectiveDate` was never bound by this fixture; `emplId` was bound and
      // lost its column, and the stored index did not rescue it.
      assert.deepEqual([...reuse.unboundRequired].sort(), ["effectiveDate", "emplId"]);
      assert.equal(reuse.readyToRun, false);
    });

    it("keeps two targets on one canonical concept separately bindable (#13)", () => {
      const NameInput = z.strictObject({
        employeeName: CANONICAL_FIELDS.fullName.schema,
        contactName: CANONICAL_FIELDS.fullName.schema,
      });
      const names = defineIntakeProjection(NameInput, {
        employeeName: CANONICAL_FIELDS.fullName,
        contactName: CANONICAL_FIELDS.fullName,
      });
      assert.deepEqual(
        names.targets.map((target) => target.targetFieldId).sort(),
        ["contactName", "employeeName"],
      );
    });
  });
});
