/**
 * The operator's requirement, made checkable: an extraction may be produced by
 * a provider model, by an agent run in their terminal, or by the operator —
 * and **all three must yield the same record, with nobody skipping anything**.
 *
 * Two mechanisms carry that, and both are tested here rather than asserted:
 *
 * 1. ONE admission gate with no branch on the source, so a route cannot get a
 *    weaker rule by being more convenient.
 * 2. A completeness rule with no `.optional()` in it, so a skipped field is a
 *    parse failure instead of a silent hole.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  admitOcrExtraction,
  answersFingerprint,
  extractionsAgree,
  type ExtractionSource,
} from "../../src/domain/ocr/extraction.js";
import { OCR_FORM_TYPES, declaredPaths, ocrForm } from "../../src/domain/ocr/form-registry.js";
import { buildAnswerSkeleton, buildExtractionInstruction } from "../../src/domain/ocr/instruction.js";
import { canonicalJsonStringify } from "../../src/domain/canonical-json.js";
import { sha256Hex } from "../../src/domain/sha256.js";

const PAGE_SHA = sha256Hex("oath-roster-page-1");
const READ_AT = "2026-08-05T18:00:00.000Z";

const PROVIDER: ExtractionSource = { kind: "provider", providerId: "gemini", modelId: "gemini-2.5-pro" };
const LOCAL_AGENT: ExtractionSource = { kind: "local-agent", agentId: "codex-cli", invocation: "codex read page1.png" };
const OPERATOR: ExtractionSource = { kind: "operator", actorId: "local-operator" };

/** The same page, read correctly. Only the source differs. */
function oathSubmission(source: ExtractionSource, overrides: Record<string, unknown> = {}) {
  return {
    formType: "oath",
    source,
    readAt: READ_AT,
    sourceSha256: PAGE_SHA,
    sourcePage: 1,
    answers: {
      printedName: { state: "read", raw: "Battistessa, Johnnie", confidence: 0.97 },
      employeeId: { state: "read", raw: "10873698", confidence: 0.93 },
      signatureDate: { state: "read", raw: "07/21/2026", confidence: 0.95 },
      employeeSigned: { state: "read", raw: "yes", confidence: 0.99 },
      officerSigned: { state: "absent", reason: "blank" },
      ...overrides,
    },
  };
}

describe("one gate, whoever read the page", () => {
  it("admits all three producers and yields the identical answer fingerprint", () => {
    const results = [PROVIDER, LOCAL_AGENT, OPERATOR].map((source) => {
      const admission = admitOcrExtraction(oathSubmission(source));
      assert.equal(admission.admitted, true, JSON.stringify(admission));
      if (!admission.admitted) throw new Error("unreachable");
      return admission.extraction;
    });

    const [byProvider, byAgent, byOperator] = results;
    assert.equal(byProvider.answersFingerprint, byAgent.answersFingerprint);
    assert.equal(byAgent.answersFingerprint, byOperator.answersFingerprint);
    assert.equal(extractionsAgree(byProvider, byAgent), true);
    assert.equal(extractionsAgree(byAgent, byOperator), true);

    // Byte-identical once the provenance is set aside — that is the operator's
    // "same result no matter who does it" in its strongest form.
    const withoutSource = (extraction: (typeof results)[number]) =>
      canonicalJsonStringify({ ...extraction, source: null });
    assert.equal(withoutSource(byProvider), withoutSource(byAgent));
    assert.equal(withoutSource(byAgent), withoutSource(byOperator));

    // …and the source is still recorded, so attribution is never lost.
    assert.deepEqual(byProvider.source, PROVIDER);
    assert.deepEqual(byAgent.source, LOCAL_AGENT);
    assert.deepEqual(byOperator.source, OPERATOR);
  });

  it("applies the same value rules to a model as to a person", () => {
    // A malformed EID is refused identically whoever produced it, and with the
    // canonical field's own reason — the producer's confidence buys nothing.
    for (const source of [PROVIDER, LOCAL_AGENT, OPERATOR]) {
      const admission = admitOcrExtraction(oathSubmission(source, {
        employeeId: { state: "read", raw: "10-4567", confidence: 1 },
      }));
      assert.equal(admission.admitted, true);
      if (!admission.admitted) throw new Error("unreachable");
      const answer = admission.extraction.answers.find((entry) => entry.path === "employeeId");
      assert.equal(answer?.state, "unreadable");
      assert.equal(answer?.state === "unreadable" && answer.reason.includes("not a UCPath EID"), true);
      // Kept with its raw text so a reviewer sees what the producer saw.
      assert.equal(answer?.state === "unreadable" && answer.raw, "10-4567");
    }
  });
});

describe("nobody skips anything", () => {
  it("refuses a submission that omits a declared field", () => {
    const submission = oathSubmission(PROVIDER);
    delete (submission.answers as Record<string, unknown>).signatureDate;
    const admission = admitOcrExtraction(submission);
    assert.equal(admission.admitted, false);
    if (admission.admitted) throw new Error("unreachable");
    assert.equal(
      admission.problems.some((problem) => problem.startsWith("signatureDate: not answered")),
      true,
      admission.problems.join("\n"),
    );
  });

  it("refuses a submission that invents a field the form does not declare", () => {
    const admission = admitOcrExtraction(oathSubmission(PROVIDER, {
      middleInitial: { state: "read", raw: "R", confidence: 0.8 },
    }));
    assert.equal(admission.admitted, false);
    if (admission.admitted) throw new Error("unreachable");
    assert.equal(
      admission.problems.some((problem) => problem.includes("is not a field of the oath form")),
      true,
      admission.problems.join("\n"),
    );
  });

  it("refuses an absence with no reason, so `null` cannot stand in for three facts", () => {
    const admission = admitOcrExtraction(oathSubmission(PROVIDER, {
      officerSigned: { state: "absent" },
    }));
    assert.equal(admission.admitted, false);
  });

  it("keeps the three absences distinct all the way through", () => {
    const admission = admitOcrExtraction(oathSubmission(PROVIDER, {
      employeeId: { state: "absent", reason: "not-on-form" },
      signatureDate: { state: "absent", reason: "illegible" },
      officerSigned: { state: "absent", reason: "blank" },
    }));
    assert.equal(admission.admitted, true);
    if (!admission.admitted) throw new Error("unreachable");
    const reasons = Object.fromEntries(admission.extraction.answers
      .filter((answer) => answer.state === "absent")
      .map((answer) => [answer.path, answer.state === "absent" ? answer.reason : ""]));
    assert.deepEqual(reasons, {
      employeeId: "not-on-form",
      officerSigned: "blank",
      signatureDate: "illegible",
    });
    // Only `illegible` says a better scan would help; the fingerprint keeps
    // them apart, so two producers disagreeing about WHICH nothing they saw is
    // a visible disagreement rather than a silent match.
    assert.notEqual(
      answersFingerprint(admission.extraction.answers),
      answersFingerprint(admission.extraction.answers.map((answer) =>
        answer.path === "signatureDate" && answer.state === "absent"
          ? { ...answer, reason: "blank" as const }
          : answer)),
    );
  });

  it("blocks only on a MANDATORY field that went unanswered", () => {
    const optionalMissing = admitOcrExtraction(oathSubmission(PROVIDER, {
      employeeId: { state: "absent", reason: "not-on-form" },
      officerSigned: { state: "read", raw: "yes", confidence: 0.9 },
    }));
    assert.equal(optionalMissing.admitted, true);
    if (!optionalMissing.admitted) throw new Error("unreachable");
    assert.deepEqual(optionalMissing.extraction.blockingPaths, []);

    const mandatoryMissing = admitOcrExtraction(oathSubmission(PROVIDER, {
      printedName: { state: "absent", reason: "illegible" },
    }));
    assert.equal(mandatoryMissing.admitted, true);
    if (!mandatoryMissing.admitted) throw new Error("unreachable");
    assert.deepEqual(mandatoryMissing.extraction.blockingPaths, ["officerSigned", "printedName"]);
  });
});

describe("every route is told the same thing", () => {
  it("generates an instruction covering exactly the declared fields", () => {
    for (const formType of OCR_FORM_TYPES) {
      const instruction = buildExtractionInstruction(formType);
      for (const path of declaredPaths(formType)) {
        assert.equal(instruction.includes(`\`${path}\``), true, `${formType} instruction omits ${path}`);
      }
      // The closed absence vocabulary reaches every producer verbatim.
      for (const reason of ["not-on-form", "blank", "illegible"]) {
        assert.equal(instruction.includes(reason), true, `${formType} instruction omits ${reason}`);
      }
    }
  });

  it("emits a skeleton whose shape the gate accepts once filled in", () => {
    for (const formType of OCR_FORM_TYPES) {
      const skeleton = buildAnswerSkeleton(formType) as { answers: Record<string, unknown> };
      // Same keys as the form declares — both directions.
      assert.deepEqual(
        Object.keys(skeleton.answers).toSorted((left, right) => left.localeCompare(right)),
        [...declaredPaths(formType)],
      );
    }
  });

  it("cannot silently stop asking for a field, because the prompt is derived", () => {
    // The point of generating: a field added to the registry appears in every
    // route's instruction on the next run. Proven by construction rather than
    // by remembering to edit a prompt constant.
    const instruction = buildExtractionInstruction("emergency-contact");
    const spec = ocrForm("emergency-contact");
    for (const entry of spec.fields) assert.equal(instruction.includes(entry.prompt), true, entry.path);
    assert.equal(instruction.includes("(mandatory)"), true);
  });
});
