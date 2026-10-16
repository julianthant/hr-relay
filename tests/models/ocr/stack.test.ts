
import assert from "node:assert/strict";
import { describe,it } from "vitest";
import {
ClassifiedStackSchema,
groupStack,
personMatchKey,
reportStack,
} from "../../../src/models/ocr/stack.js";
import { sha256Hex } from "../../../src/rules/validation/sha256.js";

const AT = "2026-08-07T09:00:00.000Z";

function stack(pages: readonly [number, string, string | null][]) {
  return ClassifiedStackSchema.parse({
    sourceSha256: sha256Hex("stack"),
    classifiedAt: AT,
    pages: pages.map(([sourcePage, pageKind, subjectName]) => ({
      sourcePage, pageKind, subjectName, confidence: 0.95,
    })),
  });
}

describe("person match key", () => {
  it("matches the two name orders the corpus actually contains", () => {
    // An I-9 Section 2 header reads `Claurnaa, Drithe A.`; a Section 1 spells the
    // same person across separate Last/First boxes.
    assert.equal(personMatchKey("Claurnaa, Drithe A."), personMatchKey("Drithe Claurnaa"));
    assert.equal(personMatchKey("BLAUTHEA, GRALDI GRALDO GRATHA"), personMatchKey("Blauthea, Graldi Graldo Gratha"));
  });

  it("drops a middle initial, so its absence cannot split one person in two", () => {
    assert.equal(personMatchKey("Goiset, Nadia, K"), personMatchKey("Goiset, Nadia"));
    assert.equal(personMatchKey("Tran, Mia, V"), personMatchKey("Mia Tran"));
  });

  it("refuses to identify anybody from a single name", () => {
    // A surname alone would group siblings onto one subject.
    assert.equal(personMatchKey("Claurnaa"), null);
    assert.equal(personMatchKey("A."), null);
    assert.equal(personMatchKey("   "), null);
  });

  it("keeps genuinely different people apart", () => {
    assert.notEqual(personMatchKey("Breldaa, Braure J."), personMatchKey("Blauthea, Graldi Graldo Gratha"));
    assert.notEqual(personMatchKey("Claurnaa, Drithe A."), personMatchKey("Casey, Kyle A."));
  });
});

describe("grouping does not assume adjacency", () => {
  it("groups the real I-9 stack by NAME, never by neighbour", () => {

    const grouping = groupStack(stack([
      [1, "i9-section2", "Claurnaa, Drithe A."],
      [2, "i9-section1", "Breldaa, Braure J."],
      [3, "i9-section2", "Cisneros, Metzli"],
      [4, "i9-section1", "BLAUTHEA, GRALDI GRALDO GRATHA"],
    ]), "oath");
    // None of them is an oath page, so an oath run correctly claims none of it.
    assert.deepEqual(grouping.subjects, []);
    assert.deepEqual(grouping.otherForms.map((page) => page.sourcePage), [1, 2, 3, 4]);
  });

  it("pairs a person's pages however far apart they sit", () => {
    const grouping = groupStack(stack([
      [1, "oath", "Claurnaa, Drithe A."],
      [2, "oath", "Breldaa, Braure J."],
      [3, "oath", "Cisneros, Metzli"],
      [9, "oath", "Drithe Claurnaa"],
    ]), "oath");
    const claurnaa = grouping.subjects.find((subject) => subject.displayName.includes("Claurnaa"));
    // Pages 1 and 9 are one person; seven unrelated pages between them change
    // nothing, because the match is on the name.
    assert.deepEqual(claurnaa?.pages.map((page) => page.sourcePage), [1, 9]);
    assert.equal(claurnaa?.completeness, "duplicate");
    assert.equal(grouping.subjects.length, 3);
  });

  it("walks detect-test.pdf as an oath run and as an EC run", () => {
    // The real 7-page VersaLink B7035 stack: one orphan EC, then three
    // EC→oath pairs.
    const real = stack([
      [1, "emergency-contact", "Yuwen Jiang"],
      [2, "emergency-contact", null],
      [3, "oath", "Tran, Mia, V"],
      [4, "emergency-contact", "Nadia Goiset"],
      [5, "oath", "Goiset, Nadia, K"],
      [6, "emergency-contact", "Vincent Provenzano"],
      [7, "oath", "Provenzano, Vincent R."],
    ]);

    const oathRun = reportStack(real, "oath");
    assert.equal(oathRun.subjects.complete, 3);
    assert.deepEqual(
      oathRun.byKind.map((kind) => [kind.pageKind, kind.pages, kind.belongsToThisRun]),
      [["emergency-contact", 4, false], ["oath", 3, true]],
    );

    const contactRun = reportStack(real, "emergency-contact");
    assert.equal(contactRun.subjects.complete, 3, "the sticky-note page names nobody");
    // Page 2's name is under a sticky note — listed, never dropped.
    assert.deepEqual(contactRun.unidentifiedPages, [2]);
    assert.equal(contactRun.byKind.find((kind) => kind.pageKind === "oath")?.belongsToThisRun, false);
  });

  it("accounts for every page, so a count reconciles against the paper", () => {
    const mixed = stack([
      [1, "oath", "Claurnaa, Drithe A."],
      [2, "emergency-contact", "Breldaa, Braure J."],
      [3, "boilerplate", null],
      [4, "unrelated", null],
      [5, "blank", null],
      [6, "oath", null],
    ]);
    const report = reportStack(mixed, "oath");
    assert.equal(report.pagesClassified, 6);

    assert.equal(report.pagesAccounted, 6);

    const grouping = groupStack(mixed, "oath");
    assert.equal(grouping.subjects.length, 1);
    assert.deepEqual(grouping.unidentified, [6]);
    assert.deepEqual(grouping.otherForms.map((page) => page.sourcePage), [2]);
    assert.deepEqual(grouping.dataless.map((page) => page.sourcePage), [3, 4, 5]);
  });

  it("refuses a stack that classifies one page twice", () => {
    assert.throws(() => stack([[1, "oath", "A B"], [1, "oath", "C D"]]), /page 1 is classified twice/);
  });
});

describe("the sectioned subject — an i9 spans two loose pages", () => {
  it("claims BOTH section kinds for an i9 run, and flags each half-person rather than pairing neighbours", () => {

    const report = reportStack(stack([
      [1, "i9-section2", "Claurnaa, Drithe A."],
      [2, "i9-section1", "Breldaa, Braure J."],
      [3, "i9-section2", "Cisneros, Metzli"],
      [4, "i9-section1", "BLAUTHEA, GRALDI GRALDO GRATHA"],
    ]), "i9");
    assert.deepEqual(report.subjects, { complete: 0, duplicate: 0, incomplete: 4 });
    assert.equal(report.pagesAccounted, 4);
    assert.deepEqual(
      report.byKind.map((kind) => [kind.pageKind, kind.belongsToThisRun]),
      [["i9-section1", true], ["i9-section2", true]],
    );

    const grouping = groupStack(stack([
      [1, "i9-section2", "Claurnaa, Drithe A."],
      [2, "i9-section1", "Breldaa, Braure J."],
    ]), "i9");

    assert.deepEqual(grouping.subjects.map((subject) => [subject.pages[0].sourcePage, subject.missingKinds]), [
      [1, ["i9-section1"]],
      [2, ["i9-section2"]],
    ]);
  });

  it("completes a person from a §2 and a §1 however far apart, whatever the name order", () => {
    // Match I-9 sections by independently supplied names, not page adjacency.
    const grouping = groupStack(stack([
      [1, "i9-section2", "Claurnaa, Drithe A."],
      [2, "i9-section1", "Breldaa, Braure J."],
      [9, "i9-section1", "Drithe Claurnaa"],
    ]), "i9");
    const claurnaa = grouping.subjects.find((subject) => subject.displayName.includes("Claurnaa"));
    assert.deepEqual(claurnaa?.pages, [
      { sourcePage: 1, pageKind: "i9-section2" },
      { sourcePage: 9, pageKind: "i9-section1" },
    ]);
    assert.equal(claurnaa?.completeness, "complete");
    assert.deepEqual(claurnaa?.missingKinds, []);
  });

  it("reports a duplicated section AND the still-missing one — one arm does not hide the other", () => {
    const grouping = groupStack(stack([
      [1, "i9-section1", "Claurnaa, Drithe A."],
      [2, "i9-section1", "Drithe Claurnaa"],
    ]), "i9");
    assert.equal(grouping.subjects.length, 1);
    assert.equal(grouping.subjects[0].completeness, "duplicate");
    assert.deepEqual(grouping.subjects[0].missingKinds, ["i9-section2"]);
  });

  it("keeps a one-page form's grouping exactly as it was", () => {
    const grouping = groupStack(stack([[1, "oath", "Tran, Mia, V"]]), "oath");
    assert.deepEqual(grouping.subjects.map((subject) => [subject.completeness, subject.missingKinds]), [
      ["complete", []],
    ]);
  });

  it("sends an unreadable-name section to unidentified rather than guessing its person", () => {
    const grouping = groupStack(stack([
      [1, "i9-section2", null],
      [2, "i9-section1", "Breldaa, Braure J."],
    ]), "i9");
    assert.deepEqual(grouping.unidentified, [1]);
    assert.equal(grouping.subjects.length, 1);
  });
});
