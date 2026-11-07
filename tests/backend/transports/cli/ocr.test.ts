
import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { composeOcrCommand } from "../../../../src/backend/transports/cli/ocr.js";
import { OCR_FORM_TYPES } from "../../../../src/models/ocr/form-registry.js";

const SUBMISSION = {
  formType: "oath",
  source: { kind: "local-agent", agentId: "codex-cli", invocation: "codex read page1.png" },
  readAt: "2026-08-06T09:00:00.000Z",
  sourceSha256: "3f1c0a2b4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8",
  sourcePage: 1,
  pageKind: "oath",
  record: {
    answers: {
      printedName: { state: "read", raw: "Battistessa, Johnnie", confidence: 0.97 },
      employeeId: { state: "read", raw: "10873698", confidence: 0.93 },
      signatureDate: { state: "read", raw: "07/21/2026", confidence: 0.95 },
      employeeSigned: { state: "read", raw: "yes", confidence: 0.99 },
      officerSigned: { state: "absent", reason: "illegible" },
    },
  },
};

function run(args: readonly string[], file: unknown = SUBMISSION) {
  return composeOcrCommand({
    args,
    cwd: "/workspace",
    readFile: () => (typeof file === "string" ? file : JSON.stringify(file)),
  });
}

describe("cli ocr", () => {
  it("lists every form with its field and mandatory counts", () => {
    const { output, exitCode } = run(["forms"]);
    assert.equal(exitCode, 0);
    for (const formType of OCR_FORM_TYPES) assert.equal(output.includes(formType), true);
    assert.match(output, /oath .* 5 fields \(3 mandatory\)/);
  });

  it("prints the generated instruction for a known form and refuses an unknown one", () => {
    const { output } = run(["instruction", "oath"]);
    assert.equal(output.startsWith("# Extract: Oath"), true);
    assert.throws(() => run(["instruction", "w2"]), /unknown OCR form type "w2"; known: oath, emergency-contact/);
  });

  it("admits a complete submission and reports what still needs a human", () => {
    const { output, exitCode } = run(["admit", "page1.json"]);
    assert.equal(exitCode, 0);
    assert.equal(output.startsWith("ADMITTED — oath page 1"), true);
    // The canonical field normalized the date; the transport did not.
    assert.equal(output.includes('signatureDate = "2026-07-21"'), true);
    assert.equal(output.includes("officerSigned — absent (illegible)"), true);
    assert.equal(output.includes("1 mandatory field(s) need a human"), true);
  });

  it("reports a page that is a different form as admitted with no records", () => {
    const other = { ...SUBMISSION, pageKind: "emergency-contact", record: null };
    const { output, exitCode } = run(["admit", "page7.json"], other);
    assert.equal(exitCode, 0);
    assert.equal(output.includes("is a emergency-contact page, not oath"), true);
    assert.equal(output.includes("nothing was skipped"), true);
  });

  it("EXITS NON-ZERO on refusal, so a caller need not parse prose", () => {
    const answers = { ...SUBMISSION.record.answers };
    delete (answers as Record<string, unknown>).signatureDate;
    const skipped = { ...SUBMISSION, record: { answers } };
    const { output, exitCode } = run(["admit", "page1.json"], skipped);
    assert.equal(exitCode, 1, "a refused submission that exits 0 would look accepted to tooling");
    assert.equal(output.startsWith("REFUSED"), true);
    assert.equal(output.includes("Nothing was recorded"), true);
    assert.equal(output.includes("signatureDate not answered"), true);
  });

  it("names an unreadable file as such rather than passing undefined to the gate", () => {
    // Otherwise a producer with a JSON typo gets told its formType is invalid.
    assert.throws(() => run(["admit", "page1.json"], "{ not json"), /is not readable JSON/);
  });

  it("carries the gate's verdict verbatim in --json, including the exit code", () => {
    const { output, exitCode } = run(["admit", "page1.json", "--json"]);
    assert.equal(exitCode, 0);
    const parsed: unknown = JSON.parse(output);
    assert.equal((parsed as { admitted: boolean }).admitted, true);
  });

  it("reports a stack for one workflow, naming what does not belong", () => {
    const classified = {
      sourceSha256: "3f1c0a2b4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8",
      classifiedAt: "2026-08-07T09:00:00.000Z",
      pages: [
        { sourcePage: 1, pageKind: "emergency-contact", subjectName: "Yuwen Jiang", confidence: 0.96 },
        { sourcePage: 2, pageKind: "emergency-contact", subjectName: null, confidence: 0.9 },
        { sourcePage: 3, pageKind: "oath", subjectName: "Tran, Mia, V", confidence: 0.95 },
      ],
    };
    const { output, exitCode } = run(["stack", "classified.json", "oath"], classified);
    assert.equal(exitCode, 0);
    assert.equal(output.includes("3 pages classified for a oath run (3 accounted for)"), true);
    assert.equal(output.includes("emergency-contact      2   ← NOT THIS WORKFLOW"), true);
    assert.equal(output.includes("1 subject(s) ready"), true);

    // The same stack read for the other workflow swaps which pages belong, and
    // surfaces the page whose name is under a sticky note.
    const contact = run(["stack", "classified.json", "emergency-contact"], classified);
    assert.equal(contact.output.includes("oath                   1   ← NOT THIS WORKFLOW"), true);
    assert.equal(contact.output.includes("name nobody readable: 2"), true);
  });

  it("claims both i9 sections for an i9 run and names each half-person's missing page", () => {
    // The real Xerox scan's shape: loose sections, no two adjacent pages one
    // person's. Casey's §2 sits on page 1; her §1 on page 9.
    const classified = {
      sourceSha256: "3f1c0a2b4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8",
      classifiedAt: "2026-08-07T09:00:00.000Z",
      pages: [
        { sourcePage: 1, pageKind: "i9-section2", subjectName: "Claurnaa, Drithe A.", confidence: 0.95 },
        { sourcePage: 2, pageKind: "i9-section1", subjectName: "Breldaa, Braure J.", confidence: 0.95 },
        { sourcePage: 9, pageKind: "i9-section1", subjectName: "Drithe Claurnaa", confidence: 0.94 },
      ],
    };
    const { output, exitCode } = run(["stack", "classified.json", "i9"], classified);
    assert.equal(exitCode, 0);
    assert.equal(output.includes("1 subject(s) ready, 1 incomplete"), true, output);
    assert.equal(output.includes("INCOMPLETE"), true);
    assert.equal(output.includes("missing i9-section2"), true);
    // Neither section kind is "NOT THIS WORKFLOW" on an i9 run.
    assert.equal(output.includes("NOT THIS WORKFLOW"), false);
  });

  it("shows usage for no subcommand and refuses an unknown one", () => {
    assert.equal(run([]).output.startsWith("usage:"), true);
    assert.throws(() => run(["extract"]), /unknown ocr subcommand "extract"/);
  });
});
