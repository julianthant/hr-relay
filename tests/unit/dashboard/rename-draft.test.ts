/**
 * The rename dialog's field rule (D233).
 *
 * The load-bearing case is the LAST one. `renameDraftProblem` exists to state a
 * bound where the operator types rather than where the wire refuses, and the
 * only way that stays true is if the two agree — a client rule stricter than
 * `RunDisplayNameSchema` refuses a legitimate name with a sentence no server
 * would ever say, and a looser one lets the operator meet a kernel error
 * instead of a field note. So the sweep asserts the BICONDITIONAL against the
 * durable schema itself, not a copy of its bounds.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { renameAnswer, renameDraftProblem } from "../../../src/dashboard/surfaces/run-detail/identity/rename-draft.js";
import { RunDisplayNameSchema } from "../../../src/domain/commands.js";

describe("the rename draft rule", () => {
  it("accepts an ordinary name and trims what the operator typed around it", () => {
    assert.equal(renameDraftProblem("Friday exception pack"), undefined);
    assert.equal(renameAnswer("  Friday exception pack  "), "Friday exception pack");
  });

  /*
   * Trailing whitespace is the one place this rule is deliberately LOOSER than
   * the schema: `RunDisplayNameSchema` demands an already-trimmed value, and a
   * person typing a name lands a trailing space constantly. Refusing that would
   * be refusing a name they typed correctly, so the draft is trimmed — and the
   * trim is the ONLY transformation, because normalising anything else would be
   * this surface rewriting what somebody wrote.
   */
  it("treats surrounding whitespace as typing, not as a refusal", () => {
    assert.equal(renameDraftProblem("  Friday  "), undefined);
    assert.equal(renameAnswer(" \t Friday \n "), "Friday");
    // …and interior whitespace is part of the name, untouched.
    assert.equal(renameAnswer("Friday  exception   pack"), "Friday  exception   pack");
  });

  it("refuses an empty draft, and a draft that is empty once trimmed", () => {
    for (const blank of ["", " ", "\t\t", "      "]) {
      assert.notEqual(renameDraftProblem(blank), undefined, JSON.stringify(blank));
      assert.equal(renameAnswer(blank), undefined);
    }
  });

  it("refuses past the schema's own 120 code points, counted in code points", () => {
    assert.equal(renameDraftProblem("x".repeat(120)), undefined);
    assert.notEqual(renameDraftProblem("x".repeat(121)), undefined);
    // An emoji is ONE code point and two UTF-16 units: a `.length` check would
    // refuse 61 of these, which the kernel accepts.
    assert.equal(renameDraftProblem("\u{1f600}".repeat(120)), undefined);
    assert.notEqual(renameDraftProblem("\u{1f600}".repeat(121)), undefined);
  });

  it("refuses control characters, which is how a pasted line break arrives", () => {
    assert.notEqual(renameDraftProblem("Friday\npack"), undefined);
    assert.notEqual(renameDraftProblem("Friday\tpack"), undefined);
  });

  it("refuses a decomposed name rather than normalising it on the operator's behalf", () => {
    const decomposed = "José";
    assert.notEqual(decomposed.normalize("NFC"), decomposed);
    assert.notEqual(renameDraftProblem(decomposed), undefined);
    // The composed form is a name, and it is accepted unchanged.
    assert.equal(renameDraftProblem("José"), undefined);
  });

  /**
   * THE AGREEMENT. Every draft this rule accepts must produce a value the
   * durable schema parses, and every draft it refuses must be one the schema
   * would have refused too — otherwise the field is enforcing a bound the
   * kernel does not hold, or hiding one it does.
   */
  it("agrees with RunDisplayNameSchema in both directions", () => {
    const corpus = [
      "Friday exception pack",
      "  Friday exception pack  ",
      "",
      "   ",
      "x".repeat(120),
      "x".repeat(121),
      " " + "x".repeat(120) + " ",
      "\u{1f600}".repeat(120),
      "\u{1f600}".repeat(121),
      "Friday\npack",
      "Friday\tpack",
      "José",
      "José",
      "0",
      "run — re-read 1",
      " ",
      "a\u0000b",
    ];
    for (const draft of corpus) {
      const problem = renameDraftProblem(draft);
      // What the composer would SEND for this draft: the trimmed text.
      const sendable = RunDisplayNameSchema.safeParse(draft.trim()).success;
      assert.equal(
        problem === undefined,
        sendable,
        `the field rule and RunDisplayNameSchema disagree about ${JSON.stringify(draft)} `
        + `(field: ${problem ?? "accepted"}; schema: ${sendable ? "accepted" : "refused"})`,
      );
      // And an accepted draft's answer is exactly what the schema accepted.
      assert.equal(renameAnswer(draft), sendable ? draft.trim() : undefined);
    }
  });
});
