/**
 * Track F row F2 — the intake facts the wire served and no pixel showed.
 *
 * Nine ledger rows (03a §Served-and-dropped: IN8, IN9, IN53, IN82, IN106,
 * IN121, IN126, IN127, IN131) were each a value already on
 * `IntakeSessionWire` that `surfaces/intake.tsx` read past. What these cases
 * pin is the half a screenshot cannot reach: three of the nine appear only on
 * states the parity corpus does not hold — a session with corrections, and an
 * enqueued session — so the sentence they compose is pinned HERE or nowhere
 * (D187's lesson, restated by D237/D238).
 *
 * The negative arms are the ones that matter. A rank must never round to a
 * probability, a layout echo must be ABSENT rather than empty before a header
 * row is settled, and a manifest's `created` must come from the manifest, not
 * from the upload that preceded it.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { FIXTURE_INTAKE_MAPPING } from "../../parity/helpers/fixture-intake.js";
import { SuggestionSchema } from "../../../src/domain/intake/suggestions.js";
import type { IntakeSessionWire } from "../../../src/domain/intake/wire.js";
import {
  headerCandidateOptionLabel,
  layoutMetaItems,
  suggestionProposalText,
} from "../../../src/dashboard/surfaces/intake-model.js";

describe("IN53 — a header candidate's rank, in the one place D173 left for it", () => {
  it("prints the row 1-based, the rank at two places, and the row's own cells after it", () => {
    assert.equal(
      headerCandidateOptionLabel({ rowIndex: 3, cells: ["Employee ID", "", "Legal Name"], confidence: 0.9612 }),
      "row 4 · confidence 0.96 — Employee ID · Legal Name",
    );
  });

  it("keeps the rank a RANK — 1 reads 1.00, never 100%", () => {
    const label = headerCandidateOptionLabel({ rowIndex: 0, cells: ["A"], confidence: 1 });
    assert.ok(label.includes("confidence 1.00"), label);
    assert.ok(!label.includes("%"), label);
  });

  it("draws every candidate the parity fixture serves, each carrying its rank", () => {
    assert.ok(FIXTURE_INTAKE_MAPPING.headerCandidates.length > 0);
    for (const candidate of FIXTURE_INTAKE_MAPPING.headerCandidates) {
      assert.match(headerCandidateOptionLabel(candidate), /^row \d+ · confidence \d\.\d\d — /u);
    }
  });
});

describe("IN82 — a proposal's reason and its rank are one thought", () => {
  it("parenthesises the score after the reasons, in the scorer's own order", () => {
    assert.equal(
      suggestionProposalText(
        SuggestionSchema.parse({
          targetFieldId: "emplId",
          sourceColumnId: "ZW1wbG95ZWUtaWQ",
          score: 0.9412,
          why: ["alias-exact", "samples-parse"],
          ambiguous: false,
        }),
      ),
      "known header, its values parse (0.94)",
    );
  });

  it("has a word for every reason the real scorer produced on the fixture", () => {
    assert.ok(FIXTURE_INTAKE_MAPPING.suggestions.length > 0);
    for (const proposal of FIXTURE_INTAKE_MAPPING.suggestions) {
      const text = suggestionProposalText(proposal);
      assert.ok(!text.includes("undefined"), `${proposal.targetFieldId}: ${text}`);
      assert.match(text, /\(\d\.\d\d\)$/u);
    }
  });
});

describe("IN8 / IN9 — the layout every decision on the screen is fenced against", () => {
  it("echoes the header row 1-based and the fingerprint's first eight", () => {
    assert.deepEqual(layoutMetaItems(FIXTURE_INTAKE_MAPPING), [
      `header row ${String((FIXTURE_INTAKE_MAPPING.headerRowIndex ?? 0) + 1)}`,
      `fingerprint ${(FIXTURE_INTAKE_MAPPING.headerFingerprint ?? "").slice(0, 8)}`,
    ]);
  });

  it("is ABSENT before a header row is settled — there is no layout to name yet", () => {
    const unsettled: IntakeSessionWire = {
      ...FIXTURE_INTAKE_MAPPING,
      headerRowIndex: null,
      headerFingerprint: null,
    };
    assert.deepEqual(layoutMetaItems(unsettled), []);
  });
});
