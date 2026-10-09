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
  FIXTURE_INTAKE_RERUN,
  FIXTURE_INTAKE_VALIDATED,
} from "../../../../parity/helpers/fixture-intake.js";
import { RowRejectSchema } from "../../../../../src/models/intake/manifest.js";
import { IntakeRowCorrectionSchema } from "../../../../../src/models/intake/session.js";
import { SuggestionSchema } from "../../../../../src/models/intake/suggestions.js";
import { IntakeSessionWireSchema, type IntakeSessionWire } from "../../../../../src/models/intake/wire.js";
import {
  correctionEditorLabel,
  correctionText,
  REJECT_KIND_LABEL,
  exclusionEditorLabel,
  headerCandidateOptionLabel,
  INTAKE_REVIEW_CONTROL_NAMES,
  INTAKE_REVIEW_COPY,
  intakeListPage,
  intakeListPageForSelection,
  layoutFingerprint,
  layoutMetaItems,
  manifestRowDetailFacts,
  manifestStage,
  manifestIdentifierFacts,
  manifestFacts,
  rerunStage,
  rerunIdentifierFacts,
  rerunMembershipDetailFacts,
  rejectionReviewEligibility,
  rejectionReviewLabel,
  sourceLabel,
  startRunsLabel,
  suggestionProposalText,
} from "../../../../../src/dashboard/surfaces/intake/intake-model.js";

describe("IN95 / IN99–IN122 — rejection review uses the demo's one vocabulary and one eligibility door", () => {
  it("pins every visible label in the table, editors, review acknowledgement and Well summaries", () => {
    assert.deepEqual(INTAKE_REVIEW_COPY, {
      tableLabel: "Rejected rows",
      columns: ["Row", "Kind", "Field / column", "Why", "Resolve"],
      noRejectionsTitle: "No rejections",
      noRejectionsDescription: "Every source row coerced and parsed cleanly against the bound fields. There is no list to review, so the plan is ready.",
      fixCell: "Fix cell",
      exclude: "Exclude…",
      correctedValue: "Corrected value",
      correctionDescription: "The source file is never rewritten. The correction is recorded in the manifest with the original beside it, and the value is re-coerced and re-parsed before it can become valid.",
      cancel: "Cancel",
      reCoerce: "Re-coerce this cell",
      reason: "Reason",
      exclusionError: "An exclusion without a reason is a row that vanished. Say why.",
      exclusionDescription: "Recorded in the manifest with a timestamp, so the receipt can never imply every source row ran.",
      exclusionPlaceholder: "duplicate export line — already filed last week",
      excludeWithReason: "Exclude with this reason",
      corrections: "Corrections",
      exclusions: "Exclusions",
      reviewDescription: "Rejection history includes corrected and excluded rows.",
      unresolvedBlocker: "rejection history has not been reviewed",
    });
    assert.equal(rejectionReviewLabel(1), "I have read all 1 rejected row");
    assert.equal(rejectionReviewLabel(4), "I have read all 4 rejected rows");
    assert.equal(startRunsLabel(1), "Start 1 run");
    assert.equal(startRunsLabel(3), "Start 3 runs");
    assert.equal(correctionEditorLabel(3, "Employee ID (EID)"), "Correct row 3 · Employee ID (EID)");
    assert.equal(exclusionEditorLabel(6), "Exclude row 6");
    assert.deepEqual(INTAKE_REVIEW_CONTROL_NAMES, {
      correctedValue: "intake-corrected-value",
      exclusionReason: "intake-exclusion-reason",
    });
  });

  it("refuses malformed editor labels instead of minting unstable control context", () => {
    assert.throws(() => correctionEditorLabel(0, "Employee ID (EID)"), /positive source row/u);
    assert.throws(() => correctionEditorLabel(3, "  "), /non-empty target label/u);
    assert.throws(() => exclusionEditorLabel(1.5), /positive source row/u);
  });

  it("refuses the client-side Run offer until the exact served rejection set is acknowledged", () => {
    const unreviewed = rejectionReviewEligibility(FIXTURE_INTAKE_VALIDATED, undefined);
    assert.equal(unreviewed.kind, "required");
    if (unreviewed.kind !== "required") return;
    assert.equal(unreviewed.rejectedRows, 4);
    assert.equal(unreviewed.reviewed, false);

    const reviewed = rejectionReviewEligibility(FIXTURE_INTAKE_VALIDATED, unreviewed.reviewKey);
    assert.equal(reviewed.kind, "required");
    assert.equal(reviewed.kind === "required" ? reviewed.reviewed : false, true);
  });

  it("revokes an acknowledgement when authority serves a newer session version", () => {
    const reviewed = rejectionReviewEligibility(FIXTURE_INTAKE_VALIDATED, undefined);
    assert.equal(reviewed.kind, "required");
    if (reviewed.kind !== "required") return;

    const newer = IntakeSessionWireSchema.parse({
      ...FIXTURE_INTAKE_VALIDATED,
      expectedVersion: FIXTURE_INTAKE_VALIDATED.expectedVersion + 1,
    });
    const stale = rejectionReviewEligibility(newer, reviewed.reviewKey);
    assert.equal(stale.kind, "required");
    assert.equal(stale.kind === "required" ? stale.reviewed : true, false);
  });

  it("does not require a review when the validated session has no rejected rows", () => {
    const clean = IntakeSessionWireSchema.parse({
      ...FIXTURE_INTAKE_VALIDATED,
      validation: {
        ...FIXTURE_INTAKE_VALIDATED.validation,
        rejected: [],
      },
    });
    assert.deepEqual(rejectionReviewEligibility(clean, "stale acknowledgement"), {
      kind: "not-required",
      rejectedRows: 0,
    });
  });
});

describe("intake evidence lists stay locally bounded without hiding rows", () => {
  it("bounds every page while preserving exact access to every source row", () => {
    const sourceRows = Array.from({ length: 23 }, (_, index) => index + 1);

    const pages = [0, 1, 2].map((pageIndex) => intakeListPage(sourceRows, pageIndex));

    assert.deepEqual(pages.map((page) => page.items), [
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      [11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
      [21, 22, 23],
    ]);
  });

  it("refuses an out-of-range page instead of rendering a false empty state", () => {
    assert.throws(
      () => intakeListPage(["row 1", "row 2"], 1),
      /intake list page 2 is outside 1 page for 2 items/u,
    );
  });

  it("keeps every remaining row reachable when the current final page shrinks away", () => {
    const remainingRows = ["row 1", "row 2", "row 3", "row 4", "row 5", "row 6", "row 7", "row 8"];

    const page = intakeListPageForSelection(remainingRows, "rerun:prior:added", {
      owner: "rerun:prior:added",
      totalItems: 12,
      pageIndex: 1,
    });

    assert.deepEqual(
      { pageIndex: page.pageIndex, totalItems: page.totalItems, items: page.items },
      { pageIndex: 0, totalItems: 8, items: remainingRows },
    );
  });

  it("refuses a malformed prior page instead of hiding it behind a shrink reset", () => {
    assert.throws(
      () => intakeListPageForSelection(["row 1"], "rerun:prior:added", {
        owner: "rerun:prior:added",
        totalItems: 2,
        pageIndex: 1,
      }),
      /intake list page 2 is outside 1 page for 2 items/u,
    );
  });
});

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

  it("keeps the full fenced fingerprint available behind the compact footer value", () => {
    assert.equal(layoutFingerprint(FIXTURE_INTAKE_MAPPING), FIXTURE_INTAKE_MAPPING.headerFingerprint);
  });

  it("is ABSENT before a header row is settled — there is no layout to name yet", () => {
    const unsettled: IntakeSessionWire = {
      ...FIXTURE_INTAKE_MAPPING,
      headerRowIndex: null,
      headerFingerprint: null,
    };
    assert.deepEqual(layoutMetaItems(unsettled), []);
    assert.equal(layoutFingerprint(unsettled), undefined);
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
const MANIFEST_CREATED_AT = "2026-08-21T18:30:00.000Z";
const MANIFEST_TOTALS = {
  sourceRows: 5,
  valid: 3,
  rejected: 1,
  rejectionEvents: 1,
  excluded: 1,
  corrected: 1,
};
const TERMINAL_MANIFEST = {
  manifestId: MANIFEST_ID,
  mappingFingerprint: FIXTURE_INTAKE_VALIDATED.artifact.sha256,
  mappingSnapshotHash: FIXTURE_INTAKE_VALIDATED.artifact.sha256,
  intakeProjectionFingerprint: FIXTURE_INTAKE_VALIDATED.artifact.sha256,
  workflowContractFingerprint: FIXTURE_INTAKE_VALIDATED.artifact.sha256,
  canonicalInputSchemaHash: FIXTURE_INTAKE_VALIDATED.artifact.sha256,
  createdAt: MANIFEST_CREATED_AT,
  totals: MANIFEST_TOTALS,
  sourceRowDispositions: [
    { sourceRow: 1, disposition: "valid", itemId: "11111111-1111-4111-8111-111111111111", currentRejectIds: [] },
    { sourceRow: 2, disposition: "valid", itemId: "22222222-2222-4222-8222-222222222222", currentRejectIds: [] },
    { sourceRow: 3, disposition: "valid", itemId: "33333333-3333-4333-8333-333333333333", currentRejectIds: [] },
    {
      sourceRow: 4,
      disposition: "rejected",
      currentRejectIds: ["44444444-4444-4444-8444-444444444444"],
    },
    { sourceRow: 5, disposition: "excluded", currentRejectIds: [] },
  ],
  validRows: [
    {
      sourceRow: 1,
      itemId: "11111111-1111-4111-8111-111111111111",
      inputHash: FIXTURE_INTAKE_VALIDATED.artifact.sha256,
      parsedInput: { emplId: "10456712" },
    },
    {
      sourceRow: 2,
      itemId: "22222222-2222-4222-8222-222222222222",
      inputHash: FIXTURE_INTAKE_VALIDATED.artifact.sha256,
      parsedInput: { emplId: "10998801" },
    },
    {
      sourceRow: 3,
      itemId: "33333333-3333-4333-8333-333333333333",
      inputHash: FIXTURE_INTAKE_VALIDATED.artifact.sha256,
      parsedInput: { emplId: "10123456" },
    },
  ],
};

describe("IN126 / IN127 / IN131 — the manifest block, from the wire and nowhere else", () => {
  // Parsed rather than spread-and-cast: the enqueued shape is exactly what the
  // route would serve, so a schema change reaches these cases instead of being
  // typed around.
  const enqueued: IntakeSessionWire = IntakeSessionWireSchema.parse({
    ...FIXTURE_INTAKE_VALIDATED,
    state: "enqueued",
    intakeManifestId: MANIFEST_ID,
    manifest: TERMINAL_MANIFEST,
    rerun: {
      intakeManifestId: MANIFEST_ID,
      createdAt: MANIFEST_CREATED_AT,
      totals: MANIFEST_TOTALS,
      diff: { kind: "same-plan" },
    },
  });

  it("draws the source with its digest, terminal fingerprints, artifact and the manifest's own instant", () => {
    const keys = manifestFacts(enqueued).map((fact) => fact.key);
    assert.deepEqual(keys, [
      "plan id",
      "source",
      "artifact",
      "mapping fingerprint",
      "mapping snapshot",
      "intake projection",
      "workflow contract",
      "canonical input schema",
      "created",
      "totals",
    ]);
    const source = manifestFacts(enqueued).find((fact) => fact.key === "source");
    assert.equal(source?.value, `${sourceLabel(enqueued)} · sha ${enqueued.artifact.sha256.slice(0, 12)}`);
    assert.equal(manifestFacts(enqueued).find((fact) => fact.key === "artifact")?.value, enqueued.artifact.id);
  });

  it("keeps each full opaque identifier available behind the dense manifest rows", () => {
    assert.deepEqual(manifestIdentifierFacts(enqueued), [
      { key: "plan id", value: MANIFEST_ID },
      { key: "source sha256", value: enqueued.artifact.sha256 },
      { key: "artifact id", value: enqueued.artifact.id },
      { key: "mapping fingerprint", value: enqueued.manifest?.mappingFingerprint },
      { key: "mapping snapshot", value: enqueued.manifest?.mappingSnapshotHash },
      { key: "intake projection", value: enqueued.manifest?.intakeProjectionFingerprint },
      { key: "workflow contract", value: enqueued.manifest?.workflowContractFingerprint },
      { key: "canonical input schema", value: enqueued.manifest?.canonicalInputSchemaHash },
    ]);
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

  it("keeps the terminal creation instant when the prior-rerun view is absent", () => {
    const withoutRerun: IntakeSessionWire = { ...enqueued, rerun: undefined };
    const keys = manifestFacts(withoutRerun).map((fact) => fact.key);
    assert.ok(keys.includes("created"));
    assert.equal(
      manifestFacts(withoutRerun).find((fact) => fact.key === "created")?.value,
      manifestFacts(enqueued).find((fact) => fact.key === "created")?.value,
    );
  });

  it("names a pre-D171 file as one that predates the field, never as a blank", () => {
    const unnamed: IntakeSessionWire = { ...enqueued, sourceName: undefined };
    const source = manifestFacts(unnamed).find((fact) => fact.key === "source");
    assert.ok(source !== undefined);
    assert.ok(source.value.startsWith("(this session predates file names) · sha "), source.value);
  });
});

describe("IN123 / IN125 — a manifest identity is reserved before it is committed", () => {
  it("says reserved, never committed, while a validated session holds its preflight identity", () => {
    const reserved: IntakeSessionWire = IntakeSessionWireSchema.parse({
      ...FIXTURE_INTAKE_VALIDATED,
      reservedManifestId: MANIFEST_ID,
    });

    assert.deepEqual(manifestStage(reserved), {
      kind: "reserved",
      manifestId: MANIFEST_ID,
    });
  });

  it("names the absent legacy arm instead of inventing a manifest identity", () => {
    assert.deepEqual(manifestStage(FIXTURE_INTAKE_VALIDATED), { kind: "unavailable" });
  });
});

describe("IN123 / IN124 / IN128–IN136 — a terminal manifest is rendered from its terminal projection", () => {
  const enqueued: IntakeSessionWire = IntakeSessionWireSchema.parse({
    ...FIXTURE_INTAKE_VALIDATED,
    state: "enqueued",
    reservedManifestId: MANIFEST_ID,
    intakeManifestId: MANIFEST_ID,
    manifest: TERMINAL_MANIFEST,
    rerun: {
      intakeManifestId: MANIFEST_ID,
      createdAt: MANIFEST_CREATED_AT,
      totals: MANIFEST_TOTALS,
      diff: { kind: "same-plan" },
    },
  });

  it("keeps the committed id, all fingerprints, derived totals and disposition rows together", () => {
    const stage = manifestStage(enqueued);
    assert.equal(stage.kind, "terminal");
    if (stage.kind !== "terminal") return;

    assert.deepEqual(stage.facts.map((fact) => fact.key), [
      "plan id",
      "source",
      "artifact",
      "mapping fingerprint",
      "mapping snapshot",
      "intake projection",
      "workflow contract",
      "canonical input schema",
      "created",
      "totals",
    ]);
    assert.equal(stage.facts[0]?.value, MANIFEST_ID);
    assert.equal(stage.facts.at(-1)?.value, "5 rows · 3 valid · 1 rejected · 1 excluded · 1 corrected");
    assert.deepEqual(stage.rows.map((row) => [row.sourceRow, row.disposition, row.itemId, row.inputHash, row.parsedInput]), [
      [1, "valid", "11111111-1111-4111-8111-111111111111", FIXTURE_INTAKE_VALIDATED.artifact.sha256, "emplId=10456712"],
      [2, "valid", "22222222-2222-4222-8222-222222222222", FIXTURE_INTAKE_VALIDATED.artifact.sha256, "emplId=10998801"],
      [3, "valid", "33333333-3333-4333-8333-333333333333", FIXTURE_INTAKE_VALIDATED.artifact.sha256, "emplId=10123456"],
      [4, "rejected", undefined, undefined, "rejects: 44444444-4444-4444-8444-444444444444"],
      [5, "excluded", undefined, undefined, "—"],
    ]);
  });

  it("keeps a valid row's full evidence available to its detail disclosure", () => {
    const stage = manifestStage(enqueued);
    assert.equal(stage.kind, "terminal");
    if (stage.kind !== "terminal") return;
    const row = stage.rows[0];
    assert.ok(row !== undefined);

    assert.deepEqual(manifestRowDetailFacts(row), [
      { key: "item id", value: "11111111-1111-4111-8111-111111111111" },
      { key: "input hash", value: FIXTURE_INTAKE_VALIDATED.artifact.sha256 },
      { key: "parsed input", value: "emplId=10456712" },
    ]);
  });
});

describe("IN139 / IN142 / IN143 — rerun is a named absence, or its exact changed evidence", () => {
  it("keeps a source with no earlier manifest as an explicit empty state", () => {
    assert.deepEqual(rerunStage(FIXTURE_INTAKE_VALIDATED), { kind: "none" });
  });

  it("preserves axes, membership, and hash-only changed inputs without exposing parsed values", () => {
    const changed: IntakeSessionWire = IntakeSessionWireSchema.parse({
      ...FIXTURE_INTAKE_VALIDATED,
      reservedManifestId: MANIFEST_ID,
      rerun: {
        intakeManifestId: MANIFEST_ID,
        createdAt: MANIFEST_CREATED_AT,
        totals: MANIFEST_TOTALS,
        diff: {
          kind: "changed",
          changes: [{ what: "mapping", was: "a".repeat(64), now: "b".repeat(64) }],
          added: [TERMINAL_MANIFEST.validRows[0]],
          removed: [TERMINAL_MANIFEST.validRows[1]],
          changedInputs: [{
            itemId: TERMINAL_MANIFEST.validRows[2]?.itemId ?? "33333333-3333-4333-8333-333333333333",
            beforeInputHash: "c".repeat(64),
            afterInputHash: "d".repeat(64),
          }],
        },
      },
    });
    const stage = rerunStage(changed);
    assert.equal(stage.kind, "changed");
    if (stage.kind !== "changed") return;

    assert.deepEqual(stage.axes, [{ label: "the mapping", was: "a".repeat(64), now: "b".repeat(64) }]);
    assert.deepEqual(stage.added.map((row) => row.itemId), ["11111111-1111-4111-8111-111111111111"]);
    assert.deepEqual(stage.removed.map((row) => row.itemId), ["22222222-2222-4222-8222-222222222222"]);
    assert.deepEqual(stage.changedInputs, [{
      itemId: "33333333-3333-4333-8333-333333333333",
      beforeInputHash: "c".repeat(64),
      afterInputHash: "d".repeat(64),
    }]);
    assert.equal(JSON.stringify(stage.changedInputs).includes("emplId"), false);
  });

  it("keeps the full prior manifest and changed-axis hashes in one detail disclosure", () => {
    const stage = rerunStage(FIXTURE_INTAKE_RERUN);
    assert.equal(stage.kind, "changed");
    if (stage.kind !== "changed") return;

    assert.deepEqual(rerunIdentifierFacts(stage), [
      { key: "prior manifest id", value: "7b92095b-bb90-4ca2-b373-8402790fb7f8" },
      { key: "the mapping — previous", value: "a".repeat(64) },
      { key: "the mapping — current", value: "b".repeat(64) },
    ]);
  });

  it("keeps each membership input hash whole behind its compact row", () => {
    const stage = rerunStage(FIXTURE_INTAKE_RERUN);
    assert.equal(stage.kind, "changed");
    if (stage.kind !== "changed") return;
    const row = stage.added[0];
    assert.ok(row !== undefined);

    assert.deepEqual(rerunMembershipDetailFacts(row), [
      { key: "item id", value: row.itemId },
      { key: "input hash", value: row.inputHash },
    ]);
  });
});

describe("the rejection badge names what an operator can act on", () => {
  /**
   * D276 item 1, ledger 3 row IN101. The badge printed the wire's own
   * discriminant, which names the validator that refused the row rather than
   * the thing in the spreadsheet that is wrong.
   */
  const servedKinds = RowRejectSchema.options.map((option) => option.shape.kind.value);

  it("answers every kind the schema can serve, and no kind it cannot", () => {
    assert.deepEqual([...servedKinds].sort(), Object.keys(REJECT_KIND_LABEL).sort());
  });

  it("never falls back to the wire's own discriminant", () => {
    for (const kind of servedKinds) {
      const label = REJECT_KIND_LABEL[kind];
      assert.notEqual(label, kind, `the ${kind} badge still prints the wire discriminant`);
      assert.ok(!label.includes("-"), `the ${kind} badge reads like an identifier: ${label}`);
    }
  });
});
