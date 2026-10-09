
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { FIXTURE_DAY_WIRE } from "../../../../parity/helpers/fixture-day.js";
import { QueueSurfaceWireSchema } from "../../../../../src/models/dashboard/projection.js";
import {
  rowInfoFacts,
  type OperationSurfaceWire,
  type QueueSurfaceWire,
} from "../../../../../src/dashboard/surfaces/queue/queue-model.js";

const [base] = FIXTURE_DAY_WIRE.queueSurfaces;
if (base === undefined) throw new Error("the parity day fixture must serve at least one queue surface");

const LONG_VALUE = "re-read 1 — operator requested fresh 4568 rehearsal after resume freshness refusal";


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
    // Served absence reasons explain missing frozen data; composition metadata stays out of queue facts.
    const entries = rowInfoFacts(surfaceOf({ ...SINGLE_PRESENT, facts: ABSENT_FIELDS.facts }));
    assert.deepEqual(
      entries,
      [SUBTITLE_ENTRY, RUN_NUMBER_ENTRY],
      "no `Outcome` entry in either state",
    );
  });
});


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
