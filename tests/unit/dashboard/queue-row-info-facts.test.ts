/**
 * A row's outcome facts are drawn as CHIPS, and a chip is a single-line token
 * that clips its paint (`ds/primitives-core.tsx`). The full value used to be
 * reachable one way only — the element's `title` — which is a hover surface: a
 * touch user has no hover, and a keyboard user is never shown one. DESIGN.md
 * bans exactly that ("Put load-bearing information in a tooltip only … it goes
 * in the UI or in a Popover"), and the row already HAS the sanctioned Popover.
 *
 * So the ⓘ now carries both halves of the fact story: why a fact is missing,
 * and — the half it was silently short of — what a present fact says IN FULL.
 * The decision is a pure fold so it is pinned here rather than by a screenshot.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { FIXTURE_DAY_WIRE } from "../../parity/helpers/fixture-day.js";
import { QueueSurfaceWireSchema } from "../../../src/domain/dashboard/projection.js";
import {
  rowInfoFacts,
  type OperationSurfaceWire,
  type QueueSurfaceWire,
} from "../../../src/dashboard/surfaces/queue-model.js";

const [base] = FIXTURE_DAY_WIRE.queueSurfaces;
if (base === undefined) throw new Error("the parity day fixture must serve at least one queue surface");

const LONG_VALUE = "PPSMTCH-2026-08-26-oath-batch-7-amendment-third-pass-final-corrected";

function withFacts(facts: QueueSurfaceWire["facts"]): QueueSurfaceWire {
  return { ...base, facts };
}

describe("the ⓘ's fact list (the chip's clipped value, reachable without a mouse)", () => {
  it("carries a present fact's FULL value, not the label alone", () => {
    const entries = rowInfoFacts(withFacts({
      state: "present",
      value: [{ label: "Match", value: LONG_VALUE }],
    }));
    const match = entries.find((entry) => entry.label === "Match");
    assert.equal(match?.state, "present");
    assert.equal(
      match?.text,
      LONG_VALUE,
      "the popover exists to un-clip the chip, so it must hold the whole value verbatim",
    );
  });

  it("still reports an absent fact by the SERVER's reason, never as a blank", () => {
    const entries = rowInfoFacts(withFacts({ state: "absent", reason: "the run produced no outcome yet" }));
    const outcome = entries.find((entry) => entry.label === "Outcome");
    assert.equal(outcome?.state, "absent");
    assert.equal(outcome?.text, "the run produced no outcome yet");
    assert.equal(
      entries.some((entry) => entry.state === "present" && entry.label === "Match"),
      false,
      "an absent fact set has no values to un-clip",
    );
  });

  it("keeps absence and value distinguishable rather than folding both into one string", () => {
    const entries = rowInfoFacts(withFacts({
      state: "present",
      value: [{ label: "Match", value: "one" }, { label: "Filed", value: "two" }],
    }));
    assert.deepEqual(
      entries.filter((entry) => entry.state === "present").map((entry) => [entry.label, entry.text]),
      [["Match", "one"], ["Filed", "two"]],
      "every served fact is listed, in the order the server sent them",
    );
  });
});

/**
 * THE FIVE ABSENCE ARMS, each pinned so that deleting it or inverting its test
 * goes red.
 *
 * Four distinct reasons can hide behind an empty fact band and the fold counts
 * all four, plus a fifth that only a group has (D230 / §9 D7). The tests above
 * exercise `facts` alone, so four of the five survived deletion: an arm that
 * quietly stops reporting an absence is indistinguishable from a server that
 * had nothing to report, which is the exact conflation this program bans.
 *
 * The assertions are `deepEqual` over the WHOLE entry list rather than a
 * `find`, because the list's ORDER is part of the contract — the ⓘ reads as the
 * row it was opened from — and a `find` cannot see an arm that fired twice, in
 * the wrong place, or with a neighbour's reason.
 */
const REASONS = {
  subtitle: "the run resolved no subject",
  liveMessage: "run has not started",
  runNumber: "this run predates run numbering",
  facts: "run is queued and has not produced a terminal result",
  memberPreview: "this group has fanned out to no members yet",
} as const;

const ONE_FACT = { label: "Match", value: "EID 10873698" } as const;
const ONE_FACT_ENTRY = { label: "Match", state: "present", text: "EID 10873698" } as const;

/** Every field the fold reads, PRESENT — so a single absent arm is the only thing that can fire. */
const PRESENT_FIELDS = {
  subtitle: { state: "present", value: "person lookup" },
  liveMessage: { state: "present", value: "Cross-verifying against CRM" },
  runNumber: { state: "present", value: 7 },
  facts: { state: "present", value: [ONE_FACT] },
} as const;

const ABSENT_FIELDS = {
  subtitle: { state: "absent", reason: REASONS.subtitle },
  liveMessage: { state: "absent", reason: REASONS.liveMessage },
  runNumber: { state: "absent", reason: REASONS.runNumber },
  facts: { state: "absent", reason: REASONS.facts },
} as const;

const operationBase = FIXTURE_DAY_WIRE.queueSurfaces.find(
  (row): row is OperationSurfaceWire => row.surfaceKind === "operation",
);
if (operationBase === undefined) throw new Error("the parity day fixture must serve at least one operation surface");

/*
  Every variant goes through the WIRE SCHEMA rather than being cast into shape.
  Half these fields are branded (`runNumber.value` is a `PositiveInt`), and a
  fixture assembled past the parser could pin the fold against a row the server
  could never send.
*/
const surfaceOf = (raw: unknown): QueueSurfaceWire => QueueSurfaceWireSchema.parse(raw);

const SINGLE_PRESENT = { ...base, ...PRESENT_FIELDS };
const OPERATION_PRESENT = {
  ...operationBase,
  ...PRESENT_FIELDS,
  memberPreview: { state: "present", value: "EID 10873698 +2 more" },
};
const singleSurface = surfaceOf(SINGLE_PRESENT);
const operationSurface = surfaceOf(OPERATION_PRESENT);

describe("the ⓘ's absence arms", () => {
  it("reports NOTHING absent when the server served every field", () => {
    assert.deepEqual(rowInfoFacts(singleSurface), [ONE_FACT_ENTRY]);
    assert.deepEqual(rowInfoFacts(operationSurface), [ONE_FACT_ENTRY]);
  });

  it("reports the subtitle's own absence, and only it", () => {
    assert.deepEqual(rowInfoFacts(surfaceOf({ ...SINGLE_PRESENT, subtitle: ABSENT_FIELDS.subtitle })), [
      { label: "Subtitle", state: "absent", text: REASONS.subtitle },
      ONE_FACT_ENTRY,
    ]);
  });

  it("reports the live message's own absence, and only it", () => {
    assert.deepEqual(rowInfoFacts(surfaceOf({ ...SINGLE_PRESENT, liveMessage: ABSENT_FIELDS.liveMessage })), [
      { label: "Live message", state: "absent", text: REASONS.liveMessage },
      ONE_FACT_ENTRY,
    ]);
  });

  it("reports the run number's own absence, and only it", () => {
    assert.deepEqual(rowInfoFacts(surfaceOf({ ...SINGLE_PRESENT, runNumber: ABSENT_FIELDS.runNumber })), [
      { label: "Run number", state: "absent", text: REASONS.runNumber },
      ONE_FACT_ENTRY,
    ]);
  });

  it("reports the outcome's own absence, which leaves no present value to list", () => {
    assert.deepEqual(rowInfoFacts(surfaceOf({ ...SINGLE_PRESENT, facts: ABSENT_FIELDS.facts })), [
      { label: "Outcome", state: "absent", text: REASONS.facts },
    ]);
  });

  it("reports a GROUP's missing member preview, and only for a group", () => {
    assert.deepEqual(
      rowInfoFacts(surfaceOf({ ...OPERATION_PRESENT, memberPreview: { state: "absent", reason: REASONS.memberPreview } })),
      [{ label: "Members", state: "absent", text: REASONS.memberPreview }, ONE_FACT_ENTRY],
    );
    assert.deepEqual(
      rowInfoFacts(operationSurface),
      [ONE_FACT_ENTRY],
      "a group that HAS a preview has no absence to report",
    );
  });

  it("never asks a non-group for a member preview it does not carry", () => {
    // `single` has no `memberPreview` key at all. Inverting the `surfaceKind`
    // half of that arm reads `.state` off `undefined` here rather than falling
    // quietly through, so this case cannot pass by accident.
    assert.deepEqual(rowInfoFacts(surfaceOf({ ...SINGLE_PRESENT, ...ABSENT_FIELDS })), [
      { label: "Subtitle", state: "absent", text: REASONS.subtitle },
      { label: "Live message", state: "absent", text: REASONS.liveMessage },
      { label: "Run number", state: "absent", text: REASONS.runNumber },
      { label: "Outcome", state: "absent", text: REASONS.facts },
    ]);
  });

  it("lists all five absences in the order the popover draws them", () => {
    assert.deepEqual(
      rowInfoFacts(surfaceOf({
        ...OPERATION_PRESENT,
        ...ABSENT_FIELDS,
        memberPreview: { state: "absent", reason: REASONS.memberPreview },
      })),
      [
        { label: "Subtitle", state: "absent", text: REASONS.subtitle },
        { label: "Live message", state: "absent", text: REASONS.liveMessage },
        { label: "Run number", state: "absent", text: REASONS.runNumber },
        { label: "Outcome", state: "absent", text: REASONS.facts },
        { label: "Members", state: "absent", text: REASONS.memberPreview },
      ],
      "one deepEqual over the whole list: deleting any arm, or moving one, is red here",
    );
  });
});
