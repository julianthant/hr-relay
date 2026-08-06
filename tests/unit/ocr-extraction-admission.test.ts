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
    pageKind: "oath",
    record: { answers: {
      printedName: { state: "read", raw: "Battistessa, Johnnie", confidence: 0.97 },
      employeeId: { state: "read", raw: "10873698", confidence: 0.93 },
      signatureDate: { state: "read", raw: "07/21/2026", confidence: 0.95 },
      employeeSigned: { state: "read", raw: "yes", confidence: 0.99 },
      officerSigned: { state: "absent", reason: "blank" },
      ...overrides,
    } },
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
    assert.equal(byProvider.pageFingerprint, byAgent.pageFingerprint);
    assert.equal(byAgent.pageFingerprint, byOperator.pageFingerprint);
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
      const answer = admission.extraction.record!.answers.find((entry) => entry.path === "employeeId");
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
    delete (submission.record.answers as Record<string, unknown>).signatureDate;
    const admission = admitOcrExtraction(submission);
    assert.equal(admission.admitted, false);
    if (admission.admitted) throw new Error("unreachable");
    assert.equal(
      admission.problems.some((problem) => problem.includes("signatureDate not answered")),
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
    const reasons = Object.fromEntries(admission.extraction.record!.answers
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
      answersFingerprint(admission.extraction.record!.answers),
      answersFingerprint(admission.extraction.record!.answers.map((answer) =>
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
    assert.deepEqual(optionalMissing.extraction.record!.blockingPaths, []);

    const mandatoryMissing = admitOcrExtraction(oathSubmission(PROVIDER, {
      printedName: { state: "absent", reason: "illegible" },
    }));
    assert.equal(mandatoryMissing.admitted, true);
    if (!mandatoryMissing.admitted) throw new Error("unreachable");
    assert.deepEqual(mandatoryMissing.extraction.record!.blockingPaths, ["officerSigned", "printedName"]);
  });
});

describe("a scanned stack is loose paper", () => {
  it("accepts a page that is a DIFFERENT form, with no record and no invention", () => {
    // Real corpus: `detect-test.pdf` interleaves emergency-contact and oath
    // pages. Demanding oath answers from an EC page would force a producer to
    // invent them; failing the page would lose it. Classifying it is the truth.
    const admission = admitOcrExtraction({
      formType: "oath",
      source: PROVIDER,
      readAt: READ_AT,
      sourceSha256: PAGE_SHA,
      sourcePage: 7,
      pageKind: "emergency-contact",
      record: null,
    });
    assert.equal(admission.admitted, true, JSON.stringify(admission));
    if (!admission.admitted) throw new Error("unreachable");
    assert.equal(admission.extraction.record, null);
    assert.equal(admission.extraction.pageKind, "emergency-contact");
  });

  it("distinguishes boilerplate, unrelated and blank, which are not the same fact", () => {
    // Seven of every nine pages in an I-9 packet are instructions and Lists of
    // Acceptable Documents. `unrelated` means the operator put something in the
    // stack that does not belong; `blank` may mean the scanner double-fed. All
    // three carry no data, and only one of them is nobody's mistake.
    for (const pageKind of ["boilerplate", "unrelated", "blank"] as const) {
      const admission = admitOcrExtraction({
        formType: "oath",
        source: PROVIDER,
        readAt: READ_AT,
        sourceSha256: PAGE_SHA,
        sourcePage: 2,
        pageKind,
        record: null,
      });
      assert.equal(admission.admitted, true, `${pageKind}: ${JSON.stringify(admission)}`);
      if (!admission.admitted) throw new Error("unreachable");
      assert.equal(admission.extraction.pageKind, pageKind);
    }
  });

  it("folds the classification into the fingerprint, so disagreeing about WHAT a page is shows", () => {
    const asBlank = admitOcrExtraction({
      formType: "oath",
      source: PROVIDER,
      readAt: READ_AT,
      sourceSha256: PAGE_SHA,
      sourcePage: 2,
      pageKind: "blank",
      record: null,
    });
    const asBoilerplate = admitOcrExtraction({
      formType: "oath",
      source: OPERATOR,
      readAt: READ_AT,
      sourceSha256: PAGE_SHA,
      sourcePage: 2,
      pageKind: "boilerplate",
      record: null,
    });
    assert.equal(asBlank.admitted && asBoilerplate.admitted, true);
    if (!asBlank.admitted || !asBoilerplate.admitted) throw new Error("unreachable");
    // Two producers that both read "no data" but disagree about WHY have not
    // agreed, and the fingerprint has to say so.
    assert.notEqual(asBlank.extraction.pageFingerprint, asBoilerplate.extraction.pageFingerprint);
    assert.equal(extractionsAgree(asBlank.extraction, asBoilerplate.extraction), false);
  });

  it("refuses a page that claims another form AND carries a record", () => {
    const admission = admitOcrExtraction({ ...oathSubmission(PROVIDER), pageKind: "i9-section1" });
    assert.equal(admission.admitted, false);
    if (admission.admitted) throw new Error("unreachable");
    assert.equal(admission.problems.some((problem) => problem.includes("cannot also carry a record")), true);
  });

  it("refuses an oath page classified as oath that carries no record", () => {
    const admission = admitOcrExtraction({ ...oathSubmission(PROVIDER), record: null });
    assert.equal(admission.admitted, false);
    if (admission.admitted) throw new Error("unreachable");
    assert.equal(admission.problems.some((problem) => problem.includes("must carry its record")), true);
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
      const skeleton = buildAnswerSkeleton(formType) as { record: { answers: Record<string, unknown> } };
      // Same keys as the form declares — both directions.
      assert.deepEqual(
        Object.keys(skeleton.record.answers).toSorted((left, right) => left.localeCompare(right)),
        [...declaredPaths(formType)],
      );
    }
  });

  it("carries the form's hard-won extraction notes to every route", () => {
    // These are legacy's real prompt knowledge — recorded misreads, address
    // handling — and they belong with the form, not in one route's string.
    const oath = buildExtractionInstruction("oath");
    assert.equal(oath.includes("do NOT drop the leading `10`"), true);
    assert.equal(oath.includes("top margin"), true);
    const contact = buildExtractionInstruction("emergency-contact");
    assert.equal(contact.includes("10843962"), true, "the observed digit transposition is named");
    assert.equal(contact.includes("Sharaf"), true, "the observed letter drop is named");
    assert.equal(contact.includes("NEVER skip the contact's address"), true);
  });

  it("tells every route the page holds one person, and to classify before extracting", () => {
    for (const formType of OCR_FORM_TYPES) {
      const instruction = buildExtractionInstruction(formType);
      assert.equal(instruction.includes("ONE person per page"), true);
      assert.equal(instruction.includes("CLASSIFY the page first"), true);
      // The full page vocabulary reaches the brief, so a producer can name what
      // it actually saw rather than forcing it into the expected form.
      for (const kind of ["i9-section1", "boilerplate", "unrelated", "blank"]) {
        assert.equal(instruction.includes(kind), true, `${formType}: ${kind} never offered`);
      }
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
