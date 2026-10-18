import { createAwaitingQueueFixtures } from "../../../support/helpers/dashboard/awaiting-queue-fixtures.js";
import assert_m0 from 'node:assert/strict';
import { describe as describe_m0,it as it_m0 } from 'vitest';
import { queueDisplayGroups as queueDisplayGroups_m0,visibleRunIds as visibleRunIds_m0 } from "../../../../src/dashboard/surfaces/queue/queue-model.js";
import { FIXTURE_DAY_WIRE as FIXTURE_DAY_WIRE_m0 } from "../../../parity/helpers/fixture-queue.js";

import assert_m1 from "node:assert/strict";
import { describe as describe_m1,it as it_m1 } from "vitest";
import {
queueGateAge as queueGateAge_m1,
queueRowAccessibleName as queueRowAccessibleName_m1
} from "../../../../src/dashboard/surfaces/queue/queue-model.js";


import assert_m2 from "node:assert/strict";
import { describe as describe_m2,it as it_m2 } from "vitest";
import { attentionRunIds as attentionRunIds_m2 } from "../../../../src/dashboard/surfaces/queue/queue-model.js";
import { QueueSurfaceWireSchema as QueueSurfaceWireSchema_m2 } from "../../../../src/models/dashboard/projection.js";

import assert_m3 from "node:assert/strict";
import { describe as describe_m3,it as it_m3 } from "vitest";
import {
checkedByYouCount as checkedByYouCount_m3,
toggleCheckedByYou as toggleCheckedByYou_m3,
type MemberSurfaceWire as MemberSurfaceWire_m3
} from "../../../../src/dashboard/surfaces/queue/queue-model.js";
import { FIXTURE_DAY_WIRE as FIXTURE_DAY_WIRE_m3 } from "../../../parity/helpers/fixture-day.js";

import assert_m4 from "node:assert/strict";
import { describe as describe_m4,it as it_m4 } from "vitest";
import {
attentionRunIds as attentionRunIds_m4,
bandOf as bandOf_m4,
filterQueueSurfaces as filterQueueSurfaces_m4,
groupQueueAttempts as groupQueueAttempts_m4,
sortQueueBand as sortQueueBand_m4,
visibleRunIds as visibleRunIds_m4
} from "../../../../src/dashboard/surfaces/queue/queue-model.js";
import { QueueSurfaceWireSchema as QueueSurfaceWireSchema_m4 } from "../../../../src/models/dashboard/projection.js";

import assert_m5 from "node:assert/strict";
import { describe as describe_m5,it as it_m5 } from "vitest";
import {
rowInfoFacts as rowInfoFacts_m5,
type OperationSurfaceWire as OperationSurfaceWire_m5,
type QueueSurfaceWire as QueueSurfaceWire_m5
} from "../../../../src/dashboard/surfaces/queue/queue-model.js";
import { QueueSurfaceWireSchema as QueueSurfaceWireSchema_m5 } from "../../../../src/models/dashboard/projection.js";
import { FIXTURE_DAY_WIRE as FIXTURE_DAY_WIRE_m5 } from "../../../parity/helpers/fixture-day.js";


{


describe_m0('Relay presentation models', () => {
  it_m0('groups only Attention mode and shares flat sorting with keyboard navigation', () => {
    const rows = FIXTURE_DAY_WIRE_m0.queueSurfaces.filter(row => row.surfaceKind !== 'member');
    assert_m0.equal(queueDisplayGroups_m0(rows, 'attention', '2026-08-03T18:00:00Z').length, 4);
    for (const sort of ['newest', 'oldest', 'longest'] as const) {
      const groups = queueDisplayGroups_m0(rows, sort, '2026-08-03T18:00:00Z');
      assert_m0.equal(groups.length, 1); assert_m0.equal(groups[0].key, null);
      const ordered = groups[0].rows;
      const durations = ordered.map(row => Date.parse(row.endedAt.state === 'present' ? row.endedAt.value : '2026-08-03T18:00:00Z') - Date.parse(row.startedAt));
      if (sort === 'longest') assert_m0.deepEqual(durations, [...durations].sort((a,b) => b-a));
      else { const dates = ordered.map(row => Date.parse(row.startedAt)); assert_m0.deepEqual(dates, [...dates].sort((a,b) => sort === 'oldest' ? a-b : b-a)); }
      assert_m0.deepEqual(visibleRunIds_m0(rows, sort, '2026-08-03T18:00:00Z'), ordered.map(row => String(row.runId)));
    }
  });
});
}

{


const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const NOW = "2026-08-14T17:00:00.000Z";
const RUN_ID = "11111111-1111-4111-8111-111111111111";

const { surface } = createAwaitingQueueFixtures(RUN_ID, HASH_A, HASH_B, NOW);

describe_m1("queueGateAge", () => {
  it_m1("measures the SERVED gate instant against the panel's calibrated now", () => {
    const row = surface({
      gateOpenedAt: { state: "present", value: "2026-08-14T16:42:00.000Z" },
    });
    assert_m1.equal(queueGateAge_m1(row, NOW), "18m 0s");
  });

  it_m1("answers nothing for a row the server dated no gate on", () => {
    // The negative arm is the load-bearing one: an absent gate must speak no
    // age at all, never a `0s` nobody measured.
    assert_m1.equal(queueGateAge_m1(surface({ status: "running" }), NOW), undefined);
  });
});

describe_m1("the row's accessible name carries the age", () => {
  // Check the age suffix independently of the status wording.
  it_m1("reads `{title} — {status} · {age}` (DemoQueue.tsx:818)", () => {
    const row = surface({
      gateOpenedAt: { state: "present", value: "2026-08-14T16:42:00.000Z" },
    });
    assert_m1.equal(queueRowAccessibleName_m1(row, NOW), "Jordan Reyes — review · 18m 0s");
  });

  it_m1("leaves an ungated row's name exactly as it was", () => {
    const row = surface({ status: "running" });
    assert_m1.equal(queueRowAccessibleName_m1(row, NOW), "Jordan Reyes — running");
  });
});
}

{


const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const NOW = "2026-08-14T17:00:00.000Z";

const runId = (n: number): string =>
  `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;

function surface(input: Record<string, unknown>) {
  return QueueSurfaceWireSchema_m2.parse({
    itemId: input.runId ?? runId(9),
    workflowId: "person-lookup",
    traceId: "pl-120000-1111",
    attempt: 1,
    lineage: { state: "root" },
    actorId: "local-operator",
    appVersion: { state: "present", value: "1.0.0" },
    descriptorVersion: 1,
    descriptorHash: HASH_A,
    configFingerprint: HASH_B,
    resolvedInstances: [],
    dryRun: false,
  priority: "interactive",
  runNumber: { state: "present", value: 1 },
  session: { state: "absent", reason: "This fixture has no run session." },
  containment: "root",
  linkedRuns: [],
  facts: { state: "absent", reason: "run is running and has not produced a terminal result" },
    startedAt: NOW,
    updatedAt: NOW,
    endedAt: { state: "absent", reason: "run has not ended" },
    gateOpenedAt: { state: "absent", reason: "no gate has opened on this run" },
    displayName: { state: "absent", reason: "the operator has not renamed this run" },
    title: "A run",
    subtitle: { state: "absent", reason: "no second identifier" },
    liveMessage: { state: "absent", reason: "no message" },
    warnings: { state: "absent", reason: "no warning set has been derived" },
    pipeline: [],
    panelKind: "run",
    availableSections: ["logs"],
    actions: [],
    rowRevision: 1,
    surfaceKind: "single",
    ...input,
  });
}

describe_m2("attentionRunIds — the band and the key cannot disagree", () => {
  it_m2("selects exactly the NEEDS YOU band's rows, in the drawn order", () => {
    const rows = [
      surface({ runId: runId(1), status: "running" }),
      surface({ runId: runId(2), status: "awaiting-approval" }),
      surface({
        runId: runId(3),
        status: "done",
        endedAt: { state: "present", value: NOW },
      }),
      surface({ runId: runId(4), status: "blocked" }),
    ];
    // `awaiting-approval` and `blocked` are the two statuses the band draws;
    // the order is the band's, so the waiting row precedes the parked one.
    assert_m2.deepEqual(attentionRunIds_m2(rows, "attention", NOW), [runId(2), runId(4)]);
  });
});
}

{


const members = FIXTURE_DAY_WIRE_m3.queueSurfaces.filter(
  (surface): surface is MemberSurfaceWire_m3 => surface.surfaceKind === "member",
);

describe_m3("checked by you — local triage only", () => {
  it_m3("toggles an immutable local set and counts only members in the displayed group", () => {
    const first = String(members[0]?.runId);
    const foreign = "1a000000-0000-4000-8000-000000000099";
    const empty = new Set<string>();
    const checked = toggleCheckedByYou_m3(toggleCheckedByYou_m3(empty, first), foreign);

    assert_m3.equal(empty.size, 0, "a local update never mutates a prior render's state");
    assert_m3.equal(checkedByYouCount_m3(members, checked), 1, "a foreign id cannot inflate this group's tally");
    assert_m3.equal(toggleCheckedByYou_m3(checked, first).has(first), false, "the same control unchecks the member");
  });

  it_m3("starts empty on a fresh client load instead of restoring authority-like state", () => {
    const reloadedClientState = new Set<string>();
    assert_m3.equal(checkedByYouCount_m3(members, reloadedClientState), 0);
  });
});
}

{


const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const NOW = "2026-08-14T17:00:00.000Z";

const runId = (n: number): string => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;

function surface(input: Record<string, unknown>) {
  return QueueSurfaceWireSchema_m4.parse({
    itemId: input.itemId ?? input.runId ?? runId(9),
    workflowId: "person-lookup",
    traceId: "pl-120000-1111",
    attempt: 1,
    lineage: { state: "root" },
    actorId: "local-operator",
    appVersion: { state: "present", value: "1.0.0" },
    descriptorVersion: 1,
    descriptorHash: HASH_A,
    configFingerprint: HASH_B,
    resolvedInstances: [],
    dryRun: false,
    priority: "interactive",
    runNumber: { state: "present", value: 1 },
    session: { state: "absent", reason: "This fixture has no run session." },

    containment: input.surfaceKind === "member" ? "member" : "root",
    linkedRuns: [],
    facts: { state: "absent", reason: "run is running and has not produced a terminal result" },
    startedAt: NOW,
    updatedAt: NOW,
    endedAt: { state: "absent", reason: "run has not ended" },
    gateOpenedAt: { state: "absent", reason: "no gate has opened on this run" },
    displayName: { state: "absent", reason: "the operator has not renamed this run" },
    title: "A run",
    subtitle: { state: "absent", reason: "no second identifier" },
    liveMessage: { state: "absent", reason: "no message" },
    warnings: { state: "absent", reason: "no warning set has been derived" },
    pipeline: [],
    panelKind: "run",
    availableSections: ["logs"],
    actions: [],
    rowRevision: 1,
    surfaceKind: "single",
    ...input,
  });
}

/** a settled row needs its terminal instant, and the schema enforces that */
function settled(input: Record<string, unknown>) {
  return surface({ endedAt: { state: "present", value: NOW }, ...input });
}

describe_m4("sortQueueBand — `attention`", () => {

  it_m4("ranks by status, in the demo's own order", () => {
    const rows = [
      settled({ runId: runId(1), status: "cancelled" }),
      settled({ runId: runId(2), status: "done" }),
      settled({ runId: runId(3), status: "partial" }),
      surface({ runId: runId(4), status: "queued" }),
      surface({ runId: runId(5), status: "running" }),
      surface({ runId: runId(6), status: "blocked" }),
      settled({ runId: runId(7), status: "failed" }),
      surface({ runId: runId(8), status: "awaiting-approval" }),
    ];
    assert_m4.deepEqual(
      sortQueueBand_m4(rows, "attention", NOW).map((row) => row.status),
      ["awaiting-approval", "failed", "blocked", "running", "queued", "partial", "done", "cancelled"],
    );
  });

  it_m4("breaks a rank tie with the NEWEST first", () => {
    const older = surface({ runId: runId(1), status: "running", startedAt: "2026-08-14T09:00:00.000Z" });
    const newer = surface({ runId: runId(2), status: "running", startedAt: "2026-08-14T16:00:00.000Z" });
    assert_m4.deepEqual(
      sortQueueBand_m4([older, newer], "attention", NOW).map((row) => String(row.runId)),
      [String(newer.runId), String(older.runId)],
    );
  });

  it_m4("leaves the three named orders alone", () => {
    const older = surface({ runId: runId(1), status: "running", startedAt: "2026-08-14T09:00:00.000Z" });
    const newer = surface({ runId: runId(2), status: "awaiting-approval", startedAt: "2026-08-14T16:00:00.000Z" });
    // `oldest` must not be re-ranked by status — the waiting row is newer and
    // still sorts last, which is the whole point of a named order.
    assert_m4.deepEqual(
      sortQueueBand_m4([newer, older], "oldest", NOW).map((row) => String(row.runId)),
      [String(older.runId), String(newer.runId)],
    );
  });
});

describe_m4("member ordering", () => {

  it_m4("ranks doneWarnings with parked, and sinks cancelled below a clean done", () => {
    const members = [
      surface({ runId: runId(1), surfaceKind: "member", status: "done", endedAt: { state: "present", value: NOW }, lineage: { state: "child", parentRunId: runId(9) } }),
      surface({ runId: runId(2), surfaceKind: "member", status: "cancelled", endedAt: { state: "present", value: NOW }, lineage: { state: "child", parentRunId: runId(9) } }),
      surface({ runId: runId(3), surfaceKind: "member", status: "queued", lineage: { state: "child", parentRunId: runId(9) } }),
      surface({ runId: runId(4), surfaceKind: "member", status: "partial", endedAt: { state: "present", value: NOW }, lineage: { state: "child", parentRunId: runId(9) } }),
      surface({ runId: runId(5), surfaceKind: "member", status: "failed", endedAt: { state: "present", value: NOW }, lineage: { state: "child", parentRunId: runId(9) } }),
    ];
    const operation = surface({
      runId: runId(9),
      surfaceKind: "operation",
      status: "running",
      memberRunIds: members.map((member) => String(member.runId)),
      memberRollup: { total: 5, terminal: 4, failed: 1 },
      memberPreview: { state: "absent", reason: "this fixture names no member subjects" },
    });
    assert_m4.deepEqual(
      visibleRunIds_m4([operation, ...members], "attention", NOW),
      [runId(9), runId(5), runId(4), runId(3), runId(2), runId(1)],
    );
  });

  // Equal-status members retain served order; fixture ids are not a real ordering key.
  it_m4("keeps the projection's own order inside one rank", () => {
    const members = [3, 4, 5].map((n) =>
      surface({
        runId: runId(n),
        surfaceKind: "member",
        status: "failed",
        endedAt: { state: "present", value: NOW },
        lineage: { state: "child", parentRunId: runId(9) },
      }),
    );
    const operation = surface({
      runId: runId(9),
      surfaceKind: "operation",
      status: "running",
      memberRunIds: members.map((member) => String(member.runId)),
      memberRollup: { total: 3, terminal: 3, failed: 3 },
      memberPreview: { state: "absent", reason: "this fixture names no member subjects" },
    });
    assert_m4.deepEqual(visibleRunIds_m4([operation, ...members], "attention", NOW), [
      runId(9),
      runId(3),
      runId(4),
      runId(5),
    ]);
  });
});

describe_m4("logical item attempt grouping", () => {
  it_m4("keeps selected-day attempts under one item and scopes identity by workflow", () => {
    const first = settled({ runId: runId(1), itemId: runId(8), attempt: 1, status: "failed" });
    const retry = settled({ runId: runId(2), itemId: runId(8), attempt: 2, status: "done" });
    const otherWorkflow = settled({ runId: runId(3), workflowId: "other-workflow", itemId: runId(8), attempt: 1, status: "done" });

    const groups = groupQueueAttempts_m4([first, otherWorkflow, retry]);
    assert_m4.equal(groups.length, 2);
    assert_m4.deepEqual(groups[0]?.attempts.map((row) => row.attempt), [2, 1]);
    assert_m4.equal(groups[0]?.representative.runId, retry.runId);
    assert_m4.equal(groups[1]?.representative.workflowId, "other-workflow");
    assert_m4.deepEqual(visibleRunIds_m4([first, retry]), [first.runId, retry.runId]);
  });

  it_m4("refuses two served run identities for the same workflow item attempt", () => {
    const first = settled({ runId: runId(1), itemId: runId(8), attempt: 1, status: "failed" });
    const duplicate = settled({ runId: runId(2), itemId: runId(8), attempt: 1, status: "done" });
    assert_m4.throws(() => groupQueueAttempts_m4([first, duplicate]), /duplicate attempt/u);
  });

  it_m4("keeps every sibling attempt when one attempt matches the status filter", () => {
    const failed = settled({ runId: runId(1), itemId: runId(8), attempt: 1, status: "failed" });
    const retry = settled({ runId: runId(2), itemId: runId(8), attempt: 2, status: "done" });
    const otherItem = settled({ runId: runId(3), itemId: runId(7), status: "done" });
    const otherWorkflow = settled({ runId: runId(4), workflowId: "other-workflow", itemId: runId(8), status: "done" });

    assert_m4.deepEqual(
      filterQueueSurfaces_m4([failed, retry, otherItem, otherWorkflow], "failed").map((row) => row.runId),
      [failed.runId, retry.runId],
    );
  });

  it_m4("does not promote historical attention over the selected item's current attempt", () => {
    const failed = settled({ runId: runId(1), itemId: runId(8), attempt: 1, status: "failed" });
    const retry = settled({ runId: runId(2), itemId: runId(8), attempt: 2, status: "done" });
    assert_m4.deepEqual(attentionRunIds_m4([failed, retry]), []);
  });
});


it_m4("keeps Cancelling in the active band ahead of queued and completed work", () => {
  const cancelling = surface({ runId: runId(1), status: "cancelling" });
  assert_m4.equal(bandOf_m4("cancelling"), "active");
  assert_m4.deepEqual(sortQueueBand_m4([
    settled({ runId: runId(2), status: "done" }),
    surface({ runId: runId(3), status: "queued" }), cancelling,
  ], "attention", NOW).map(({ status }) => status), ["cancelling", "queued", "done"]);
});
}

{


const [base] = FIXTURE_DAY_WIRE_m5.queueSurfaces;
if (base === undefined) throw new Error("the parity day fixture must serve at least one queue surface");

const LONG_VALUE = "re-read 1 — operator requested fresh 4568 rehearsal after resume freshness refusal";


const surfaceOf = (raw: unknown): QueueSurfaceWire_m5 => QueueSurfaceWireSchema_m5.parse(raw);

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

const operationBase = FIXTURE_DAY_WIRE_m5.queueSurfaces.find(
  (row): row is OperationSurfaceWire_m5 => row.surfaceKind === "operation",
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

describe_m5("the ⓘ carries the subtitle, and carries it whole", () => {
  it_m5("carries a present subtitle's FULL value — the row shows it nowhere else", () => {
    const entries = rowInfoFacts_m5(surfaceOf({
      ...SINGLE_PRESENT,
      subtitle: { state: "present", value: LONG_VALUE },
    }));
    const subtitle = entries.find((entry) => entry.label === "Subtitle");
    assert_m5.equal(subtitle?.state, "present");
    assert_m5.equal(
      subtitle?.text,
      LONG_VALUE,
      "the footer no longer draws the subtitle at all, so a clipped copy here would be the only copy",
    );
    assert_m5.equal(entries[0]?.label, "Subtitle", "it leads: the popover reads top-down the way the row does");
  });

  it_m5("drops a subtitle that only repeats the row's title", () => {

    const entries = rowInfoFacts_m5(surfaceOf({
      ...SINGLE_PRESENT,
      title: "EID 10873698",
      displayName: { state: "absent", reason: "the operator has not renamed this run" },
      subtitle: { state: "present", value: "EID 10873698" },
    }));
    assert_m5.equal(
      entries.some((entry) => entry.label === "Subtitle"),
      false,
      "a subtitle equal to the title is the same string twice, not a second fact",
    );
  });
});


describe_m5("the ⓘ excludes the run's extracted values", () => {
  it_m5("lists no outcome fact, however many the receipt produced", () => {
    const entries = rowInfoFacts_m5(surfaceOf({
      ...SINGLE_PRESENT,
      facts: { state: "present", value: [{ label: "Match", value: "one" }, { label: "Filed", value: "two" }] },
    }));
    assert_m5.deepEqual(
      entries,
      [SUBTITLE_ENTRY, RUN_NUMBER_ENTRY],
      "the receipt's output belongs to the row's chips; repeating it here made the ⓘ a second row",
    );
  });

  it_m5("does not explain an outcome's ABSENCE either", () => {
    // Served absence reasons explain missing frozen data; composition metadata stays out of queue facts.
    const entries = rowInfoFacts_m5(surfaceOf({ ...SINGLE_PRESENT, facts: ABSENT_FIELDS.facts }));
    assert_m5.deepEqual(
      entries,
      [SUBTITLE_ENTRY, RUN_NUMBER_ENTRY],
      "no `Outcome` entry in either state",
    );
  });
});


describe_m5("the ⓘ's absence arms", () => {
  it_m5("reports NOTHING absent when the server served every field", () => {
    assert_m5.deepEqual(rowInfoFacts_m5(singleSurface), [SUBTITLE_ENTRY, RUN_NUMBER_ENTRY]);
    assert_m5.deepEqual(rowInfoFacts_m5(operationSurface), [SUBTITLE_ENTRY, RUN_NUMBER_ENTRY]);
  });

  it_m5("reports the subtitle's own absence, and only it", () => {
    assert_m5.deepEqual(rowInfoFacts_m5(surfaceOf({ ...SINGLE_PRESENT, subtitle: ABSENT_FIELDS.subtitle })), [
      { label: "Subtitle", state: "absent", text: REASONS.subtitle },
      RUN_NUMBER_ENTRY,
    ]);
  });

  it_m5("reports the live message's own absence, and only it", () => {
    assert_m5.deepEqual(rowInfoFacts_m5(surfaceOf({ ...SINGLE_PRESENT, liveMessage: ABSENT_FIELDS.liveMessage })), [
      SUBTITLE_ENTRY,
      { label: "Live message", state: "absent", text: REASONS.liveMessage },
      RUN_NUMBER_ENTRY,
    ]);
  });

  it_m5("reports the run number's own absence, and only it", () => {
    assert_m5.deepEqual(rowInfoFacts_m5(surfaceOf({ ...SINGLE_PRESENT, runNumber: ABSENT_FIELDS.runNumber })), [
      SUBTITLE_ENTRY,
      { label: "Run number", state: "absent", text: REASONS.runNumber },
    ]);
  });

  it_m5("reports a GROUP's missing member preview, and only for a group", () => {
    assert_m5.deepEqual(
      rowInfoFacts_m5(surfaceOf({ ...OPERATION_PRESENT, memberPreview: { state: "absent", reason: REASONS.memberPreview } })),
      [SUBTITLE_ENTRY, RUN_NUMBER_ENTRY, { label: "Members", state: "absent", text: REASONS.memberPreview }],
    );
    assert_m5.deepEqual(
      rowInfoFacts_m5(operationSurface),
      [SUBTITLE_ENTRY, RUN_NUMBER_ENTRY],
      "a group that HAS a preview has no absence to report",
    );
  });

  it_m5("never asks a non-group for a member preview it does not carry", () => {

    assert_m5.deepEqual(rowInfoFacts_m5(surfaceOf({ ...SINGLE_PRESENT, ...ABSENT_FIELDS })), [
      { label: "Subtitle", state: "absent", text: REASONS.subtitle },
      { label: "Live message", state: "absent", text: REASONS.liveMessage },
      { label: "Run number", state: "absent", text: REASONS.runNumber },
    ]);
  });

  it_m5("lists every absence in the order the popover draws them", () => {
    assert_m5.deepEqual(
      rowInfoFacts_m5(surfaceOf({
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
}
