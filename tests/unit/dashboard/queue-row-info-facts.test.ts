/**
 * WHAT THE ⓘ HOLDS, and — as of 2026-09-01 — what it deliberately does not.
 *
 * The operator's rule: *"the subtitle and other important stuff related to the
 * run that doesnt fit into the queue row — something i dont need normally when
 * i glance at the queue row but i could maybe use sometimes to find out more
 * info."* Two exclusions fall out of that sentence, and each is pinned below
 * because each was previously rendered and could be re-added by a one-line
 * edit that no other test would notice:
 *
 *   NOT PRODUCT EXPLANATION — the panel-kind and containment paragraphs are
 *     facts about the product, identical on every row sharing a `panelKind`.
 *     They live in `surfaces/queue.tsx`, so this fold never held them; the
 *     popover's own composition is what dropped them.
 *   NOT THE RUN'S EXTRACTED VALUES — `facts[]` is the evidence receipt's
 *     output, already drawn on the row as chips. Both its present values AND
 *     its absence reason are gone from here.
 *
 * What remains is the SUBTITLE, which left the row's footer entirely
 * (`surfaces/queue.tsx`) because a provenance line holds when · which run ·
 * which trace · how long and a subtitle is none of those — plus the absence
 * reasons D230 / §9 D7 require, so a served gap can never read as a silent one.
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

const LONG_VALUE = "re-read 1 — operator requested fresh 4568 rehearsal after resume freshness refusal";

/*
  Every variant goes through the WIRE SCHEMA rather than being cast into shape.
  Half these fields are branded (`runNumber.value` is a `PositiveInt`), and a
  fixture assembled past the parser could pin the fold against a row the server
  could never send.
*/
const surfaceOf = (raw: unknown): QueueSurfaceWire => QueueSurfaceWireSchema.parse(raw);

const REASONS = {
  subtitle: "the run resolved no subject",
  liveMessage: "run has not started",
  runNumber: "this run predates run numbering",
  facts: "run is queued and has not produced a terminal result",
  memberPreview: "this group has fanned out to no members yet",
} as const;

/** Every field the fold reads, PRESENT — so a single absent arm is the only thing that can fire. */
const PRESENT_FIELDS = {
  subtitle: { state: "present", value: "person lookup" },
  liveMessage: { state: "present", value: "Cross-verifying against CRM" },
  runNumber: { state: "present", value: 7 },
  facts: { state: "present", value: [{ label: "Match", value: "EID 10873698" }] },
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

const SINGLE_PRESENT = { ...base, ...PRESENT_FIELDS };
const OPERATION_PRESENT = {
  ...operationBase,
  ...PRESENT_FIELDS,
  memberPreview: { state: "present", value: "EID 10873698 +2 more" },
};
const singleSurface = surfaceOf(SINGLE_PRESENT);
const operationSurface = surfaceOf(OPERATION_PRESENT);

/** The present subtitle's entry, which LEADS every list the fold returns. */
const SUBTITLE_ENTRY = { label: "Subtitle", state: "present", text: "person lookup" } as const;

/** The present run number reads in the ⓘ, whole, since the footer's `#N` became the attempt (2026-09-01). */
const RUN_NUMBER_ENTRY = { label: "Run number", state: "present", text: "#7 of this workflow" } as const;

describe("the ⓘ carries the subtitle, and carries it whole", () => {
  it("carries a present subtitle's FULL value — the row shows it nowhere else", () => {
    const entries = rowInfoFacts(surfaceOf({
      ...SINGLE_PRESENT,
      subtitle: { state: "present", value: LONG_VALUE },
    }));
    const subtitle = entries.find((entry) => entry.label === "Subtitle");
    assert.equal(subtitle?.state, "present");
    assert.equal(
      subtitle?.text,
      LONG_VALUE,
      "the footer no longer draws the subtitle at all, so a clipped copy here would be the only copy",
    );
    assert.equal(entries[0]?.label, "Subtitle", "it leads: the popover reads top-down the way the row does");
  });

  it("drops a subtitle that only repeats the row's title", () => {
    // The demo's `showId` guard (`DemoQueue.tsx:674`), which used to live in
    // the footer that no longer reads this field. Without it the popover
    // prints the row's own name back at it as a second fact.
    const entries = rowInfoFacts(surfaceOf({
      ...SINGLE_PRESENT,
      title: "EID 10873698",
      displayName: { state: "absent", reason: "the operator has not renamed this run" },
      subtitle: { state: "present", value: "EID 10873698" },
    }));
    assert.equal(
      entries.some((entry) => entry.label === "Subtitle"),
      false,
      "a subtitle equal to the title is the same string twice, not a second fact",
    );
  });
});

/**
 * THE EXCLUSION, pinned in both directions.
 *
 * `facts[]` is the run's own output and is already drawn on the row as chips.
 * It was rendered here until 2026-09-01 — both its values and its absence
 * reason — so re-adding either is a two-line edit. These are the tests that
 * make that edit go red instead of quietly turning the ⓘ back into a second
 * copy of the row.
 */
describe("the ⓘ excludes the run's extracted values", () => {
  it("lists no outcome fact, however many the receipt produced", () => {
    const entries = rowInfoFacts(surfaceOf({
      ...SINGLE_PRESENT,
      facts: { state: "present", value: [{ label: "Match", value: "one" }, { label: "Filed", value: "two" }] },
    }));
    assert.deepEqual(
      entries,
      [SUBTITLE_ENTRY, RUN_NUMBER_ENTRY],
      "the receipt's output belongs to the row's chips; repeating it here made the ⓘ a second row",
    );
  });

  it("does not explain an outcome's ABSENCE either", () => {
    // The absence arm is about the same field, and its served reason is
    // composition prose ("immutable receipt composition 2 predates
    // diagnostic-safe composition 3…") — the explanation the operator ruled out.
    const entries = rowInfoFacts(surfaceOf({ ...SINGLE_PRESENT, facts: ABSENT_FIELDS.facts }));
    assert.deepEqual(
      entries,
      [SUBTITLE_ENTRY, RUN_NUMBER_ENTRY],
      "no `Outcome` entry in either state",
    );
  });
});

/**
 * THE ABSENCE ARMS, each pinned so that deleting it or inverting its test goes
 * red.
 *
 * Distinct reasons can hide behind a served gap and the fold counts them all
 * (D230 / §9 D7): an arm that quietly stops reporting an absence is
 * indistinguishable from a server that had nothing to report, which is the
 * exact conflation this program bans.
 *
 * The assertions are `deepEqual` over the WHOLE entry list rather than a
 * `find`, because the list's ORDER is part of the contract — the ⓘ reads as the
 * row it was opened from — and a `find` cannot see an arm that fired twice, in
 * the wrong place, or with a neighbour's reason.
 */
describe("the ⓘ's absence arms", () => {
  it("reports NOTHING absent when the server served every field", () => {
    assert.deepEqual(rowInfoFacts(singleSurface), [SUBTITLE_ENTRY, RUN_NUMBER_ENTRY]);
    assert.deepEqual(rowInfoFacts(operationSurface), [SUBTITLE_ENTRY, RUN_NUMBER_ENTRY]);
  });

  it("reports the subtitle's own absence, and only it", () => {
    assert.deepEqual(rowInfoFacts(surfaceOf({ ...SINGLE_PRESENT, subtitle: ABSENT_FIELDS.subtitle })), [
      { label: "Subtitle", state: "absent", text: REASONS.subtitle },
      RUN_NUMBER_ENTRY,
    ]);
  });

  it("reports the live message's own absence, and only it", () => {
    assert.deepEqual(rowInfoFacts(surfaceOf({ ...SINGLE_PRESENT, liveMessage: ABSENT_FIELDS.liveMessage })), [
      SUBTITLE_ENTRY,
      { label: "Live message", state: "absent", text: REASONS.liveMessage },
      RUN_NUMBER_ENTRY,
    ]);
  });

  it("reports the run number's own absence, and only it", () => {
    assert.deepEqual(rowInfoFacts(surfaceOf({ ...SINGLE_PRESENT, runNumber: ABSENT_FIELDS.runNumber })), [
      SUBTITLE_ENTRY,
      { label: "Run number", state: "absent", text: REASONS.runNumber },
    ]);
  });

  it("reports a GROUP's missing member preview, and only for a group", () => {
    assert.deepEqual(
      rowInfoFacts(surfaceOf({ ...OPERATION_PRESENT, memberPreview: { state: "absent", reason: REASONS.memberPreview } })),
      [SUBTITLE_ENTRY, RUN_NUMBER_ENTRY, { label: "Members", state: "absent", text: REASONS.memberPreview }],
    );
    assert.deepEqual(
      rowInfoFacts(operationSurface),
      [SUBTITLE_ENTRY, RUN_NUMBER_ENTRY],
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
    ]);
  });

  it("lists every absence in the order the popover draws them", () => {
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
        { label: "Members", state: "absent", text: REASONS.memberPreview },
      ],
      "one deepEqual over the whole list: deleting any arm, or moving one, is red here",
    );
  });
});
