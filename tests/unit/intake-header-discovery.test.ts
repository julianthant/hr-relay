/**
 * Doc 06 §3 header discovery, and §7 vector #9 in particular.
 *
 * Legacy located the header row by finding a RECOGNIZED column name, so a
 * spreadsheet full of novel headings had no header row at all and the file was
 * rejected before the operator could say what anything meant. These cases pin
 * the replacement: structure decides, aliases only help, and an unclear answer
 * is returned as a choice rather than as a guess.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  HEADER_PRESELECT_MARGIN,
  canonicalAliasIndex,
  rankHeaderRows,
} from "../../src/domain/intake/header-discovery.js";
import { CANONICAL_FIELDS, CANONICAL_FIELD_IDS } from "../../src/domain/fields/registry.js";

const NO_ALIASES: ReadonlySet<string> = new Set();
const ALIASES = canonicalAliasIndex(CANONICAL_FIELD_IDS.map((id) => CANONICAL_FIELDS[id]));

describe("doc 06 §3 header discovery", () => {
  it("finds a header beneath a preamble using structure alone", () => {
    const rows = [
      ["Work-Study July Export", "", ""],
      ["", "", ""],
      ["Employee ID#", "Effective Date", "Dept"],
      ["10456712", "07/01/2026", "HDH"],
      ["10998801", "07/01/2026", "HDH"],
    ];
    // No aliases at all: the answer must not depend on recognizing a heading.
    const blind = rankHeaderRows(rows, NO_ALIASES);
    assert.equal(blind.headerRowIndex, 2);
    assert.equal(blind.reason, "preselected");

    // Aliases may only raise confidence, never change the answer.
    const informed = rankHeaderRows(rows, ALIASES);
    assert.equal(informed.headerRowIndex, 2);
    assert.equal(informed.candidates[0].confidence >= blind.candidates[0].confidence, true);
    assert.equal(informed.candidates[0].signals.aliasHits > 0, true);
  });

  it("reaches header selection for a file with zero known headings (§7 #9)", () => {
    const rows = [
      ["Zephyr", "Quixote", "Marimba"],
      ["Nimbus", "Halcyon", "Tessellate"],
      ["Vellum", "Obsidian", "Pinnacle"],
    ];
    const discovery = rankHeaderRows(rows, ALIASES);
    // Novel headings must still produce candidates — the operator chooses.
    assert.equal(discovery.candidates.length >= 2, true);
    assert.equal(discovery.candidates.every((candidate) => candidate.cells.length === 3), true);
  });

  it("returns a choice rather than picking between indistinguishable rows", () => {
    const rows = [
      ["Alpha", "Bravo", "Charlie"],
      ["Delta", "Echo", "Foxtrot"],
      ["Golf", "Hotel", "India"],
    ];
    const discovery = rankHeaderRows(rows, NO_ALIASES);
    assert.equal(discovery.headerRowIndex, null);
    assert.equal(discovery.reason, "ambiguous-candidates");
  });

  it("never proposes a row with no data beneath it", () => {
    const rows = [
      ["Employee ID#", "Effective Date"],
      ["10456712", "07/01/2026"],
    ];
    const discovery = rankHeaderRows(rows, ALIASES);
    assert.deepEqual(discovery.candidates.map((candidate) => candidate.rowIndex), [0]);
    assert.equal(discovery.headerRowIndex, 0);
  });

  it("scores a numeric data row below a text header row", () => {
    const rows = [
      ["Employee ID#", "Effective Date", "Dept"],
      ["10456712", "2026-07-01", "HDH"],
      ["10998801", "2026-07-02", "HDH"],
      ["10998802", "2026-07-03", "HDH"],
    ];
    const discovery = rankHeaderRows(rows, NO_ALIASES);
    assert.equal(discovery.headerRowIndex, 0);
    const header = discovery.candidates.find((candidate) => candidate.rowIndex === 0);
    const dataRow = discovery.candidates.find((candidate) => candidate.rowIndex === 1);
    assert.equal(header !== undefined && dataRow !== undefined, true);
    assert.equal((header?.confidence ?? 0) > (dataRow?.confidence ?? 1), true);
    assert.equal(dataRow?.signals.textShaped, 1 / 3, "the EID and the ISO date both read as data");
  });

  it("ranks a merged title row below the real header on width and distinctness", () => {
    // A merged title occupies one cell of a wide sheet. `widthMatch` is
    // asymmetric, so spanning FEWER columns than the data is what demotes it.
    const rows = [
      ["Onboarding Roster — July 2026", "", "", ""],
      ["EID", "Legal Name", "Dept", "Start Date"],
      ["10456712", "Cleckoa, Crithe", "HDH", "07/01/2026"],
      ["10998801", "Roe, Rick", "HDH", "07/01/2026"],
    ];
    const discovery = rankHeaderRows(rows, NO_ALIASES);
    assert.equal(discovery.headerRowIndex, 1);
    assert.equal(discovery.reason, "preselected");
    const title = discovery.candidates.find((candidate) => candidate.rowIndex === 0);
    const header = discovery.candidates.find((candidate) => candidate.rowIndex === 1);
    assert.equal(title?.signals.widthMatch, 1 / 4, "one cell against four columns of data");
    assert.equal((header?.confidence ?? 0) - (title?.confidence ?? 0) >= HEADER_PRESELECT_MARGIN, true);
  });

  it("does not penalize a header for spanning more columns than its data fills", () => {
    // Measured on a real UCSD onboarding roster (2026-08-05): 30 headings over
    // data rows filling ~12 cells. The symmetric width rule scored that header
    // 0.00 and lost the sheet; a header spanning more than its data is normal.
    const headings = Array.from({ length: 12 }, (_, index) => `Column ${String(index + 1)}`);
    const sparse = (seed: number) => [
      `value-${String(seed)}`, "Yes", "", "", "HDH", "", "", "", "", "", "", "",
    ];
    const rows = [headings, sparse(1), sparse(2), sparse(3)];
    const discovery = rankHeaderRows(rows, NO_ALIASES);
    assert.equal(discovery.headerRowIndex, 0);
    assert.equal(discovery.candidates[0].signals.widthMatch, 1);
  });

  it("separates a header from its data on values that appear in no other row", () => {
    // The dominant signal, and a principle rather than a fit: a heading is a
    // LABEL and does not appear among the data, while a status or department
    // repeats down its column. Real roster: header 0.97–1.00, data 0.27–0.52.
    const rows = [
      ["EID", "Legal Name", "Dept", "Status"],
      ["10456712", "Cleckoa, Crithe", "HDH", "Active"],
      ["10998801", "Roe, Rick", "HDH", "Active"],
      ["10998802", "Poe, Edgar", "HDH", "Active"],
    ];
    const discovery = rankHeaderRows(rows, NO_ALIASES);
    assert.equal(discovery.candidates[0].rowIndex, 0);
    assert.equal(discovery.candidates[0].signals.soleUse, 1);
    const dataRow = discovery.candidates.find((candidate) => candidate.rowIndex === 1);
    assert.equal((dataRow?.signals.soleUse ?? 1) <= 0.5, true, "Dept and Status repeat below");
  });

  it("counts sole use across OTHER rows, so two identical headings do not self-penalize", () => {
    // Doc 06 §2.1 exists to keep two `Name` columns distinct; the ranking must
    // not treat that supported layout as evidence against the header row.
    const rows = [
      ["Name", "Name", "EID"],
      ["Cleckoa, Crithe", "Roe, Rick", "10456712"],
      ["Poe, Edgar", "Coe, Joe", "10998801"],
    ];
    const blind = rankHeaderRows(rows, NO_ALIASES);
    assert.equal(blind.candidates[0].rowIndex, 0);
    assert.equal(blind.candidates[0].signals.soleUse, 1, "the duplicate heading must not self-penalize");
    // With three rows of entirely unique data there is little structural
    // evidence either way, so blind ranking puts the header first but declines
    // to preselect. That is the designed degradation, not a defect.
    assert.equal(blind.headerRowIndex, null);
    assert.equal(blind.reason, "ambiguous-candidates");

    // Recognizing `Name` and `EID` is exactly what the capped alias bonus is
    // for: it breaks the tie without ever being required.
    const informed = rankHeaderRows(rows, ALIASES);
    assert.equal(informed.headerRowIndex, 0);
    assert.equal(informed.candidates[0].signals.aliasHits, 3);
  });

  it("reports no rows for a blank sheet rather than inventing a candidate", () => {
    assert.deepEqual(rankHeaderRows([], ALIASES), { headerRowIndex: null, candidates: [], reason: "no-rows" });
    assert.deepEqual(
      rankHeaderRows([["", ""], ["  ", ""]], ALIASES),
      { headerRowIndex: null, candidates: [], reason: "no-rows" },
    );
  });
});
