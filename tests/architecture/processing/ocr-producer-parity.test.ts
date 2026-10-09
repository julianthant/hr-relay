/**
 * D151 — every OCR producer is held to the same rules, structurally.
 *
 * The unit suite proves the three routes AGREE on a given page. This proves
 * they cannot be made to disagree:
 *
 * 1. `admitOcrExtraction` may not branch on `source`. A single `if` on who
 *    produced a value is all it takes for "the provider path is trusted" to
 *    creep in, and no test over sample inputs would necessarily catch it.
 * 2. Only the gate may mint an `AdmittedExtraction`. A transport that built one
 *    itself would be a second, unchecked admission path.
 * 3. The submitted-answer shape carries no `.optional()`. An optional field is
 *    exactly a field a producer can skip in silence, which is the thing the
 *    operator asked to make impossible.
 * 4. The generated instruction covers every declared field, both directions —
 *    so a field cannot be added to the registry and silently not asked for.
 *
 * Each static arm runs against a violating fixture through the same scanner.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { REPO_ROOT, repoRelative, walkFiles } from "../support/helpers/guard-files.js";
import { OCR_FORM_TYPES, declaredPaths, ocrForm } from "../../../src/models/ocr/form-registry.js";
import { buildAnswerSkeleton, buildExtractionInstruction } from "../../../src/models/ocr/instruction.js";

const GATE = "src/models/ocr/extraction.ts";

interface ScannedFile {
  readonly path: string;
  readonly source: string;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** The whole static rule set, as a pure function so fixtures can drive it. */
export function ocrParityViolations(files: readonly ScannedFile[]): string[] {
  const violations: string[] = [];
  for (const { path, source } of files) {
    const code = stripComments(source);

    if (path === GATE) {
      // Reading `submission.source` to COPY it onto the record is fine; testing
      // it is not. Only comparison and switching are refused.
      if (/\bsource\s*\.\s*kind\s*===/.test(code) || /switch\s*\(\s*[A-Za-z.]*source\s*\.\s*kind\s*\)/.test(code)) {
        violations.push(`${path}: branches on the extraction source; the gate must treat every producer alike`);
      }
      const answerShape = /SubmittedAnswerSchema[\s\S]*?^\]\);/m.exec(code)?.[0] ?? "";
      if (answerShape.includes(".optional()")) {
        violations.push(`${path}: the submitted-answer shape carries .optional(); a producer could skip that field`);
      }
      const submissionShape = /SubmittedExtractionSchema[\s\S]*?^\}\);/m.exec(code)?.[0] ?? "";
      if (submissionShape.includes(".optional()")) {
        violations.push(`${path}: the submission shape carries .optional(); a producer could skip that field`);
      }
    } else if (/AdmittedExtractionSchema\s*\.\s*parse/.test(code)) {
      violations.push(`${path}: mints an AdmittedExtraction; ${GATE} is the only admission path`);
    }
  }
  return violations;
}

function ocrSources(): ScannedFile[] {
  return [
    ...walkFiles(join(REPO_ROOT, "src/models/ocr"), { extensions: [".ts"] }),
    ...walkFiles(join(REPO_ROOT, "src/backend/processing/ocr"), { extensions: [".ts"] }),
    ...walkFiles(join(REPO_ROOT, "src/backend/processing/providers"), { extensions: [".ts"] }),
    ...walkFiles(join(REPO_ROOT, "src/backend/transports/cli"), { extensions: [".ts"] }),
  ].map((absolute) => ({ path: repoRelative(absolute), source: readFileSync(absolute, "utf8") }));
}

describe("D151 OCR producer parity", () => {
  it("scans a non-empty OCR surface and finds it clean", () => {
    const files = ocrSources();
    assert.equal(files.length >= 3, true, "expected the registry, the gate and the instruction builder");
    assert.equal(files.some(({ path }) => path === GATE), true);
    assert.deepEqual(ocrParityViolations(files), []);
  });

  it("covers every declared field in the generated instruction, both directions", () => {
    for (const formType of OCR_FORM_TYPES) {
      const instruction = buildExtractionInstruction(formType);
      const declared = declaredPaths(formType);
      for (const path of declared) {
        assert.equal(instruction.includes(`\`${path}\``), true, `${formType}: ${path} is never asked for`);
      }
      // The other direction: the skeleton a producer copies must name exactly
      // the declared set, so it cannot teach a producer about a field that no
      // longer exists or omit one that does.
      const skeleton = buildAnswerSkeleton(formType) as {
        pageKind: string;
        record: { answers: Record<string, unknown> };
      };
      // A one-page form's kind spells its form type; a sectioned form's
      // skeleton shows one of its DATA kinds — never the bare form type, which
      // is not a page kind at all for the I-9.
      assert.equal(
        (ocrForm(formType).pageKinds as readonly string[]).includes(skeleton.pageKind),
        true,
        "the skeleton must show a data-bearing classification of this form",
      );
      assert.deepEqual(
        Object.keys(skeleton.record.answers).toSorted((left, right) => left.localeCompare(right)),
        [...declared],
      );
      // Classification and record count reach every route, or a producer could
      // silently answer a page that is not this form, or one row of twelve.
      assert.equal(instruction.includes("CLASSIFY the page first"), true, `${formType}: no classification rule`);
      assert.equal(
        instruction.includes("ONE person per page"),
        true,
        `${formType}: the brief does not say how many records a page yields`,
      );
      // Every extraction note reaches the brief verbatim — that knowledge was
      // learned from real misreads and must not live in one route's string.
      for (const note of ocrForm(formType).extractionNotes) {
        assert.equal(instruction.includes(note), true, `${formType}: an extraction note never reaches the brief`);
      }
      // Every mandatory field is marked as such in the brief.
      for (const spec of ocrForm(formType).fields) {
        if (!spec.mandatory) continue;
        assert.equal(
          instruction.includes(`\`${spec.path}\` (mandatory)`),
          true,
          `${formType}: ${spec.path} is mandatory but the brief does not say so`,
        );
      }
      // A sectioned field's page kinds reach the brief, and the skeleton is
      // consistent with its own example classification: a field not on the
      // example page is shown `not-on-form`, exactly as the gate demands. A
      // skeleton demonstrating a value read from a box its page does not have
      // would teach every producer the violation.
      for (const spec of ocrForm(formType).fields) {
        if (spec.onPageKinds === null) continue;
        assert.equal(
          instruction.includes(`Only on ${spec.onPageKinds.map((kind) => `\`${kind}\``).join(" / ")} pages`),
          true,
          `${formType}: ${spec.path}'s section never reaches the brief`,
        );
        if (!(spec.onPageKinds as readonly string[]).includes(skeleton.pageKind)) {
          assert.deepEqual(
            skeleton.record.answers[spec.path],
            { state: "absent", reason: "not-on-form" },
            `${formType}: the skeleton answers ${spec.path} on a page that has no such box`,
          );
        }
      }
    }
  });

  describe("negative controls — the scan fails when it should", () => {
    it("catches a gate that branches on who produced the value", () => {
      assert.deepEqual(
        ocrParityViolations([{
          path: GATE,
          source: 'if (submission.source.kind === "provider") { return trustIt(); }',
        }]),
        [`${GATE}: branches on the extraction source; the gate must treat every producer alike`],
      );
      assert.deepEqual(
        ocrParityViolations([{
          path: GATE,
          source: "switch (submission.source.kind) { default: break; }",
        }]),
        [`${GATE}: branches on the extraction source; the gate must treat every producer alike`],
      );
    });

    it("catches an optional field sneaking into the answer shape", () => {
      const violations = ocrParityViolations([{
        path: GATE,
        source: [
          "export const SubmittedAnswerSchema = z.discriminatedUnion(\"state\", [",
          "  z.strictObject({ state: z.literal(\"read\"), raw: z.string().optional() }),",
          "]);",
        ].join("\n"),
      }]);
      assert.equal(
        violations.includes(`${GATE}: the submitted-answer shape carries .optional(); a producer could skip that field`),
        true,
        violations.join("\n"),
      );
    });

    it("catches a second module minting an admitted record", () => {
      assert.deepEqual(
        ocrParityViolations([{
          path: "src/backend/transports/cli/ocr.ts",
          source: "return AdmittedExtractionSchema.parse(whateverTheModelSaid);",
        }]),
        [`src/backend/transports/cli/ocr.ts: mints an AdmittedExtraction; ${GATE} is the only admission path`],
      );
    });

    it("does not fire on the gate copying the source onto the record", () => {
      assert.deepEqual(
        ocrParityViolations([{
          path: GATE,
          source: "return { formType, source: submission.source, readAt: submission.readAt };",
        }]),
        [],
      );
    });

    it("does not fire on a comment describing the rule", () => {
      assert.deepEqual(
        ocrParityViolations([{
          path: GATE,
          source: '// Never write `source.kind === "provider"` here.\nexport const x = 1;',
        }]),
        [],
      );
    });
  });
});
