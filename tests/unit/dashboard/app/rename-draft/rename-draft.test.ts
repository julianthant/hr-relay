
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { renameAnswer, renameDraftProblem } from "../../../../../src/dashboard/surfaces/run-detail/identity/rename-draft.js";
import { RunDisplayNameSchema } from "../../../../../src/rules/commands/commands.js";

describe("the rename draft rule", () => {
  it("accepts an ordinary name and trims what the operator typed around it", () => {
    assert.equal(renameDraftProblem("Friday exception pack"), undefined);
    assert.equal(renameAnswer("  Friday exception pack  "), "Friday exception pack");
  });

  // Drafts admit trailing whitespace; trim only when composing the schema-bound value.
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
