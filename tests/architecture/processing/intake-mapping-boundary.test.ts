import { readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { REPO_ROOT, walkFiles, repoRelative } from "../support/helpers/guard-files.js";

const INTAKE_ROOT = join(REPO_ROOT, "src/models/intake");
const BINDING_MINT = "src/models/intake/mapping.ts";

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
          path: "src/models/intake/suggestions.ts",
          source: "const binding = { targetFieldId, sourceColumnId, confirmedAt: now };",
        }]),
        ["src/models/intake/suggestions.ts: names confirmedAt, the field only an operator action supplies"],
      );
    });

    it("catches a scorer that reaches the binding schemas", () => {
      assert.deepEqual(
        intakeBoundaryViolations([{
          path: "src/models/intake/suggestions.ts",
          source: 'import { ColumnBindingSchema } from "./mapping.js";',
        }]),
        ["src/models/intake/suggestions.ts: reaches the binding schemas; a scorer must not be able to build one"],
      );
    });

    it("catches a second place minting a binding", () => {
      assert.deepEqual(
        intakeBoundaryViolations([{
          path: "src/backend/transports/http/routes/intake.ts",
          source: "return ColumnBindingSchema.parse(body);",
        }]),
        [
          "src/backend/transports/http/routes/intake.ts: parses a ColumnBinding; "
          + "confirmBinding in src/models/intake/mapping.ts is the only mint",
        ],
      );
    });

    it("catches a Node built-in entering the browser-reachable intake domain", () => {
      assert.deepEqual(
        intakeBoundaryViolations([{
          path: "src/models/intake/mapping.ts",
          source: 'import { createHash } from "node:crypto";',
        }]),
        ["src/models/intake/mapping.ts: imports a Node built-in; the mapping grid is a browser surface"],
      );
    });

    it("does not fire on a comment that merely discusses the rule", () => {
      assert.deepEqual(
        intakeBoundaryViolations([{
          path: "src/models/intake/suggestions.ts",
          source: "// A Suggestion has no confirmedAt and cannot reach ColumnBindingSchema.\nexport const x = 1;",
        }]),
        [],
      );
    });
  });
});
