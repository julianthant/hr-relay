/**
 * 2i-C: `editPolicyFor` — doc 03 D19's unlock rule with the reason always
 * shown. A row is editable only when its own field policy, the run-level
 * policy served with the section, and the LIVE queue status all agree, and
 * whichever one disagrees supplies the exact sentence on the lock.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { NodeIdSchema } from "../../../src/domain/ids.js";
import {
  editPolicyFor,
  freshnessNoteOf,
  groupEntriesByStep,
  liveLockReasonOf,
  type ContextDataEntry,
  type ContextDataPayload,
} from "../../../src/dashboard/surfaces/context-rail-model.js";

const EDITABLE_ENTRY = {
  label: "Invited on",
  valueRedacted: "2026-06-01",
  edit: {
    state: "editable",
    nodeId: "crm-dates",
    fieldPath: "invitedOn.value",
    value: "2026-06-01",
    pendingCorrection: { state: "none" },
  },
} as ContextDataEntry;

const EDITABLE_RUN = { state: "editable", expectedVersion: 4 } as ContextDataPayload["editing"];

describe("editPolicyFor", () => {
  it("is editable only when field, run, and live status all agree", () => {
    const policy = editPolicyFor(EDITABLE_ENTRY, EDITABLE_RUN, undefined);
    assert.deepEqual(policy, {
      kind: "editable",
      nodeId: "crm-dates",
      fieldPath: "invitedOn.value",
      recorded: "2026-06-01",
      pending: undefined,
    });
  });

  it("the field's own lock wins with its own reason — it is the most specific", () => {
    const entry = {
      ...EDITABLE_ENTRY,
      edit: { state: "locked", reason: "not declared correctable by this workflow" },
    } as ContextDataEntry;
    const locked = editPolicyFor(entry, { state: "locked", reason: "run is running" }, "live lock");
    assert.deepEqual(locked, { kind: "locked", reason: "not declared correctable by this workflow" });
  });

  it("the run-level lock covers every row alike", () => {
    const locked = editPolicyFor(
      EDITABLE_ENTRY,
      { state: "locked", reason: "run is terminal" },
      undefined,
    );
    assert.deepEqual(locked, { kind: "locked", reason: "run is terminal" });
  });

  it("the live signal locks a section the server served editable", () => {
    const reason = liveLockReasonOf("running");
    assert.ok(reason !== undefined);
    const locked = editPolicyFor(EDITABLE_ENTRY, EDITABLE_RUN, reason);
    assert.equal(locked.kind, "locked");
    if (locked.kind === "locked") assert.match(locked.reason, /now running/u);
  });

  it("carries a staged correction through to the policy", () => {
    const entry = {
      ...EDITABLE_ENTRY,
      edit: {
        ...EDITABLE_ENTRY.edit,
        pendingCorrection: {
          state: "pending",
          value: "2026-06-02",
          correctedAt: "2026-08-03T17:30:00.000Z",
        },
      },
    } as ContextDataEntry;
    const policy = editPolicyFor(entry, EDITABLE_RUN, undefined);
    assert.equal(policy.kind, "editable");
    if (policy.kind === "editable") {
      assert.deepEqual(policy.pending, { value: "2026-06-02", correctedAt: "2026-08-03T17:30:00.000Z" });
    }
  });
});

describe("liveLockReasonOf", () => {
  it("stays quiet exactly while the run remains resumable", () => {
    assert.equal(liveLockReasonOf(undefined), undefined);
    assert.equal(liveLockReasonOf("queued"), undefined);
    assert.equal(liveLockReasonOf("awaiting-approval"), undefined);
  });

  it("names the moved state for everything else", () => {
    for (const status of ["running", "done", "failed", "cancelled", "blocked", "partial"]) {
      const reason = liveLockReasonOf(status);
      assert.ok(reason !== undefined, status);
      assert.match(reason, new RegExp(`now ${status}`, "u"));
    }
  });
});

/**
 * D252 — the ledger's two levels and its reuse bound, as pure folds.
 *
 * Both arms of every question are pinned: an entry the build can attribute and
 * one it cannot, a bound that bites and the two ways a bound cannot bite.
 */
describe("groupEntriesByStep (D252)", () => {
  const entryAt = (label: string, origin?: ContextDataEntry["origin"]): ContextDataEntry => ({
    label,
    valueRedacted: label,
    edit: { state: "locked", reason: "fixture" },
    ...(origin === undefined ? {} : { origin }),
  });
  const search = {
    nodeId: NodeIdSchema.parse("searching"),
    step: "Search UCPath",
    dir: "read",
    system: "ucpath",
  } as const;
  const dates = { nodeId: NodeIdSchema.parse("crm-dates"), step: "CRM dates", dir: "read" } as const;

  it("groups by the NODE, keeps arrival order, and re-joins a step whose rows are not adjacent", () => {
    const groups = groupEntriesByStep([
      entryAt("Selection", search),
      entryAt("Invited on", dates),
      entryAt("Active status", search),
    ]);
    assert.equal(groups.length, 2);
    assert.equal(groups[0]?.origin?.nodeId, "searching");
    assert.deepEqual(groups[0]?.rows.map((row) => row.index), [0, 2]);
    assert.deepEqual(groups[1]?.rows.map((row) => row.index), [1]);
  });

  it("collects every unattributable entry into ONE trailing group with no step", () => {
    const groups = groupEntriesByStep([
      entryAt("legacy-key"),
      entryAt("Selection", search),
      entryAt("another-legacy-key"),
    ]);
    // The unattributed group is created where the first such entry appears —
    // its rows keep their own indices, so nothing is re-ordered under the
    // operator; only the heading is absent, because none can be named.
    const unattributed = groups.find((group) => group.origin === undefined);
    assert.ok(unattributed);
    assert.deepEqual(unattributed.rows.map((row) => row.index), [0, 2]);
    assert.equal(groups.filter((group) => group.origin === undefined).length, 1);
  });

  it("distinguishes two steps that record a field of the SAME label", () => {
    const groups = groupEntriesByStep([
      entryAt("Name", search),
      entryAt("Name", dates),
    ]);
    assert.equal(groups.length, 2);
  });
});

describe("freshnessNoteOf (D252)", () => {
  const withFreshness = (freshness: ContextDataEntry["freshness"]): ContextDataEntry => ({
    label: "Invited on",
    valueRedacted: "2026-06-01",
    edit: { state: "locked", reason: "fixture" },
    origin: { nodeId: NodeIdSchema.parse("crm-dates"), step: "CRM dates", dir: "read" },
    ...(freshness === undefined ? {} : { freshness }),
  });
  const feeds = [{ nodeId: NodeIdSchema.parse("file-termination"), label: "File the termination" }];

  it("states the limit and the write it protects, and names the override policy", () => {
    const audited = freshnessNoteOf(withFreshness({ maxAge: 900_000, override: "audited", feeds }));
    assert.equal(audited, "Reusable for 15 min before File the termination. Reusing an older reading takes a recorded reason.");
    const forbidden = freshnessNoteOf(withFreshness({ maxAge: 900_000, override: "forbidden", feeds }));
    assert.match(forbidden ?? "", /must be re-read — no override can authorize it/u);
  });

  it("says NOTHING when the bound cannot bite — the executor's own two skips", () => {
    // `auditCheckpointFreshness` skips a checkpoint that reaches no commit …
    assert.equal(freshnessNoteOf(withFreshness({ maxAge: 900_000, override: "audited", feeds: [] })), undefined);
    // … and never compares against an infinite limit.
    assert.equal(freshnessNoteOf(withFreshness({ maxAge: "unbounded", override: "audited", feeds })), undefined);
    // An entry with no declared policy at all — a write, or a pre-D252 build.
    assert.equal(freshnessNoteOf(withFreshness(undefined)), undefined);
  });

  it("falls back to seconds below a minute rather than rounding a real bound to zero", () => {
    assert.match(
      freshnessNoteOf(withFreshness({ maxAge: 45_000, override: "forbidden", feeds })) ?? "",
      /Reusable for 45 s before/u,
    );
  });
});
