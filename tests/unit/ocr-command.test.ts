/**
 * The `ocr` command — the transport that makes routes 2 and 3 usable (D151).
 *
 * What matters here is that the transport adds NOTHING. It reads a file, calls
 * the gate, and reports. So the cases below are about the seams a transport can
 * get wrong: an unreadable file reported as a schema problem, a refusal that
 * exits zero, and a refusal that looks like a record.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { composeOcrCommand } from "../../src/server/ocr/compose.js";
import { OCR_FORM_TYPES } from "../../src/domain/ocr/form-registry.js";

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

describe("rebuild:cli ocr", () => {
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

  it("shows usage for no subcommand and refuses an unknown one", () => {
    assert.equal(run([]).output.startsWith("usage:"), true);
    assert.throws(() => run(["extract"]), /unknown ocr subcommand "extract"/);
  });
});
