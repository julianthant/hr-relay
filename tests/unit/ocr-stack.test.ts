/**
 * Stage 1 and 2 of the scanner pipeline (D157).
 *
 * The fixtures are the two REAL scans. `detect-test.pdf` is a
 * `VersaLink B7035` stack whose pages pair up per person; the 44-page
 * `Xerox Scan` is a `VersaLink C7020` stack whose first four pages are four
 * different people. Grouping has to be right on both, which is the whole reason
 * it matches by name rather than by neighbour.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  ClassifiedStackSchema,
  groupStack,
  personMatchKey,
  reportStack,
} from "../../src/domain/ocr/stack.js";
import { sha256Hex } from "../../src/domain/sha256.js";

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

describe("D157 person match key", () => {
  it("matches the two name orders the corpus actually contains", () => {
    // An I-9 Section 2 header reads `Clauldia, Drona A.`; a Section 1 spells the
    // same person across separate Last/First boxes.
    assert.equal(personMatchKey("Clauldia, Drona A."), personMatchKey("Drona Clauldia"));
    assert.equal(personMatchKey("BLAUCKEA, GRERA GRERE GRERI"), personMatchKey("Blauckea, Grera Grere Greri"));
  });

  it("drops a middle initial, so its absence cannot split one person in two", () => {
    assert.equal(personMatchKey("Goiset, Nadia, K"), personMatchKey("Goiset, Nadia"));
    assert.equal(personMatchKey("Tran, Mia, V"), personMatchKey("Mia Tran"));
  });

  it("refuses to identify anybody from a single name", () => {
    // A surname alone would group siblings onto one subject.
    assert.equal(personMatchKey("Clauldia"), null);
    assert.equal(personMatchKey("A."), null);
    assert.equal(personMatchKey("   "), null);
  });

  it("keeps genuinely different people apart", () => {
    assert.notEqual(personMatchKey("Brethea, Brauso J."), personMatchKey("Blauckea, Grera Grere Greri"));
    assert.notEqual(personMatchKey("Clauldia, Drona A."), personMatchKey("Casey, Kyle A."));
  });
});

describe("D157 grouping does not assume adjacency", () => {
  it("groups the real I-9 stack by NAME, never by neighbour", () => {
    // The first four pages of Xerox Scan_08052026141856.pdf: four different
    // people, alternating sections. Pairing neighbours would have attached
    // Casey's Section 1 from Cho's page.
    const grouping = groupStack(stack([
      [1, "i9-section2", "Clauldia, Drona A."],
      [2, "i9-section1", "Brethea, Brauso J."],
      [3, "i9-section2", "Cisneros, Metzli"],
      [4, "i9-section1", "BLAUCKEA, GRERA GRERE GRERI"],
    ]), "oath");
    // None of them is an oath page, so an oath run correctly claims none of it.
    assert.deepEqual(grouping.subjects, []);
    assert.deepEqual(grouping.otherForms.map((page) => page.sourcePage), [1, 2, 3, 4]);
  });

  it("pairs a person's pages however far apart they sit", () => {
    const grouping = groupStack(stack([
      [1, "oath", "Clauldia, Drona A."],
      [2, "oath", "Brethea, Brauso J."],
      [3, "oath", "Cisneros, Metzli"],
      [9, "oath", "Drona Clauldia"],
    ]), "oath");
    const casey = grouping.subjects.find((subject) => subject.displayName.includes("Clauldia"));
    // Pages 1 and 9 are one person; seven unrelated pages between them change
    // nothing, because the match is on the name.
    assert.deepEqual(casey?.pages.map((page) => page.sourcePage), [1, 9]);
    assert.equal(casey?.completeness, "duplicate");
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
      [1, "oath", "Clauldia, Drona A."],
      [2, "emergency-contact", "Brethea, Brauso J."],
      [3, "boilerplate", null],
      [4, "unrelated", null],
      [5, "blank", null],
      [6, "oath", null],
    ]);
    const report = reportStack(mixed, "oath");
    assert.equal(report.pagesClassified, 6);
    // The point of the check: a page in no bucket is a page nobody knows was
    // skipped.
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

describe("D160 the sectioned subject — an i9 spans two loose pages", () => {
  it("claims BOTH section kinds for an i9 run, and flags each half-person rather than pairing neighbours", () => {
    // The real first four pages of Xerox Scan_08052026141856.pdf: four
    // DIFFERENT people, alternating sections. Neighbour-pairing would have
    // attached Casey's Section 1 from Cho's page.
    const report = reportStack(stack([
      [1, "i9-section2", "Clauldia, Drona A."],
      [2, "i9-section1", "Brethea, Brauso J."],
      [3, "i9-section2", "Cisneros, Metzli"],
      [4, "i9-section1", "BLAUCKEA, GRERA GRERE GRERI"],
    ]), "i9");
    assert.deepEqual(report.subjects, { complete: 0, duplicate: 0, incomplete: 4 });
    assert.equal(report.pagesAccounted, 4);
    assert.deepEqual(
      report.byKind.map((kind) => [kind.pageKind, kind.belongsToThisRun]),
      [["i9-section1", true], ["i9-section2", true]],
    );

    const grouping = groupStack(stack([
      [1, "i9-section2", "Clauldia, Drona A."],
      [2, "i9-section1", "Brethea, Brauso J."],
    ]), "i9");
    // The orphan §2 is FLAGGED, never blocked (D157): the subject is listed
    // with exactly which page to go find.
    assert.deepEqual(grouping.subjects.map((subject) => [subject.pages[0].sourcePage, subject.missingKinds]), [
      [1, ["i9-section1"]],
      [2, ["i9-section2"]],
    ]);
  });

  it("completes a person from a §2 and a §1 however far apart, whatever the name order", () => {
    // An I-9 §2 header reads `Clauldia, Drona A.`; her §1 spells the same person
    // across separate boxes. Both pages name her independently — that is what
    // makes the pair matchable at all (D157).
    const grouping = groupStack(stack([
      [1, "i9-section2", "Clauldia, Drona A."],
      [2, "i9-section1", "Brethea, Brauso J."],
      [9, "i9-section1", "Drona Clauldia"],
    ]), "i9");
    const casey = grouping.subjects.find((subject) => subject.displayName.includes("Clauldia"));
    assert.deepEqual(casey?.pages, [
      { sourcePage: 1, pageKind: "i9-section2" },
      { sourcePage: 9, pageKind: "i9-section1" },
    ]);
    assert.equal(casey?.completeness, "complete");
    assert.deepEqual(casey?.missingKinds, []);
  });

  it("reports a duplicated section AND the still-missing one — one arm does not hide the other", () => {
    const grouping = groupStack(stack([
      [1, "i9-section1", "Clauldia, Drona A."],
      [2, "i9-section1", "Drona Clauldia"],
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
      [2, "i9-section1", "Brethea, Brauso J."],
    ]), "i9");
    assert.deepEqual(grouping.unidentified, [1]);
    assert.equal(grouping.subjects.length, 1);
  });
});
