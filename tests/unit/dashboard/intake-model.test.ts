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
import {
  FIXTURE_INTAKE_MAPPING,
  FIXTURE_INTAKE_VALIDATED,
} from "../../parity/helpers/fixture-intake.js";
import { IntakeRowCorrectionSchema } from "../../../src/domain/intake/session.js";
import { SuggestionSchema } from "../../../src/domain/intake/suggestions.js";
import { IntakeSessionWireSchema, type IntakeSessionWire } from "../../../src/domain/intake/wire.js";
import {
  correctionText,
  headerCandidateOptionLabel,
  layoutMetaItems,
  manifestFacts,
  sourceLabel,
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

describe("IN121 — a correction is listed, and the half nothing serves is not invented", () => {
  it("names the field the operator corrected and the value they put there", () => {
    assert.equal(
      correctionText(
        IntakeRowCorrectionSchema.parse({
          sourceRow: 7,
          field: "emplId",
          correctedValue: "10012345",
          correctedAt: "2026-08-21T18:04:00.000Z",
        }),
        "Employee ID (EID)",
      ),
      "Employee ID (EID) → “10012345”",
    );
  });

  it("never spells an ORIGINAL — `IntakeRowCorrectionSchema` carries none", () => {
    const text = correctionText(
      IntakeRowCorrectionSchema.parse({
        sourceRow: 2,
        field: "name",
        correctedValue: "Ada Lovelace",
        correctedAt: "2026-08-21T18:04:00.000Z",
      }),
      "Legal name",
    );
    // One arrow, one quoted value: a second quoted pair would be a claim about
    // a cell nothing on this wire describes.
    assert.equal(text.split("“").length - 1, 1);
  });
});

const MANIFEST_ID = "3f2a9c14-77b8-4d6e-9a01-5c8e2b4f6a90";

describe("IN126 / IN127 / IN131 — the manifest block, from the wire and nowhere else", () => {
  // Parsed rather than spread-and-cast: the enqueued shape is exactly what the
  // route would serve, so a schema change reaches these cases instead of being
  // typed around.
  const enqueued: IntakeSessionWire = IntakeSessionWireSchema.parse({
    ...FIXTURE_INTAKE_VALIDATED,
    state: "enqueued",
    intakeManifestId: MANIFEST_ID,
    rerun: {
      intakeManifestId: MANIFEST_ID,
      createdAt: "2026-08-21T18:30:00.000Z",
      totals: { sourceRows: 5, valid: 3, rejected: 1, rejectionEvents: 1, excluded: 1, corrected: 1 },
      diff: { kind: "same-plan" },
    },
  });

  it("draws the source with its digest, the artifact and the manifest's own instant", () => {
    const keys = manifestFacts(enqueued).map((fact) => fact.key);
    assert.deepEqual(keys, ["manifest", "source", "artifact", "created", "rows"]);
    const source = manifestFacts(enqueued).find((fact) => fact.key === "source");
    assert.equal(source?.value, `${sourceLabel(enqueued)} · sha ${enqueued.artifact.sha256.slice(0, 12)}`);
    assert.equal(manifestFacts(enqueued).find((fact) => fact.key === "artifact")?.value, enqueued.artifact.id);
  });

  it("reads `created` off the MANIFEST, never off the upload that preceded it", () => {
    const shifted: IntakeSessionWire = IntakeSessionWireSchema.parse({
      ...enqueued,
      createdAt: "2020-01-01T00:00:00.000Z",
    });
    const created = manifestFacts(shifted).find((fact) => fact.key === "created");
    assert.ok(created !== undefined);
    // The session's own createdAt moved twenty-six years and the manifest's
    // instant did not: the block is about the manifest.
    assert.equal(created.value, manifestFacts(enqueued).find((fact) => fact.key === "created")?.value);
  });

  it("omits `created` rather than substituting one when no manifest view is served", () => {
    const withoutRerun: IntakeSessionWire = { ...enqueued, rerun: undefined };
    const keys = manifestFacts(withoutRerun).map((fact) => fact.key);
    assert.deepEqual(keys, ["manifest", "source", "artifact"]);
  });

  it("names a pre-D171 file as one that predates the field, never as a blank", () => {
    const unnamed: IntakeSessionWire = { ...enqueued, sourceName: undefined };
    const source = manifestFacts(unnamed).find((fact) => fact.key === "source");
    assert.ok(source !== undefined);
    assert.ok(source.value.startsWith("(this session predates file names) · sha "), source.value);
  });
});
