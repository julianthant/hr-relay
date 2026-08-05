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

  it("ranks a repeated merged-title row below the real header", () => {
    // A merged title that spills the same word across columns is a preamble.
    // Low distinctness is what demotes it — it stays above the confidence FLOOR
    // and loses on MARGIN, which is the right mechanism: the floor asks "is
    // anything good enough", the margin asks "is one clearly better".
    const rows = [
      ["Roster", "Roster", "Roster"],
      ["EID", "Name", "Dept"],
      ["10456712", "Cleckoa, Crithe", "HDH"],
    ];
    const discovery = rankHeaderRows(rows, NO_ALIASES);
    assert.equal(discovery.headerRowIndex, 1);
    assert.equal(discovery.reason, "preselected");
    const spill = discovery.candidates.find((candidate) => candidate.rowIndex === 0);
    const header = discovery.candidates.find((candidate) => candidate.rowIndex === 1);
    assert.equal(spill?.signals.distinct, 1 / 3, "one distinct value across three cells");
    assert.equal((header?.confidence ?? 0) - (spill?.confidence ?? 0) >= HEADER_PRESELECT_MARGIN, true);
  });

  it("reports no rows for a blank sheet rather than inventing a candidate", () => {
    assert.deepEqual(rankHeaderRows([], ALIASES), { headerRowIndex: null, candidates: [], reason: "no-rows" });
    assert.deepEqual(
      rankHeaderRows([["", ""], ["  ", ""]], ALIASES),
      { headerRowIndex: null, candidates: [], reason: "no-rows" },
    );
  });
});
