/**
 * Pure Context/Data presentation folds: grouping by producing step and freshness copy.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { NodeIdSchema } from "../../../src/domain/ids.js";
import { ContractFieldPathSchema } from "../../../src/domain/contracts/base.js";
import {
  freshnessNoteOf,
  groupEntriesByStep,
  type ContextDataEntry,
} from "../../../src/dashboard/surfaces/run-detail/context-rail-model.js";

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
    coordinate: { nodeId: NodeIdSchema.parse("searching"), fieldPath: ContractFieldPathSchema.parse("selection.status") },
    checkpoint: { state: "absent", reason: "no-checkpoint-for-run" },
    valueState: "absent",
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
    coordinate: { nodeId: NodeIdSchema.parse("crm-dates"), fieldPath: ContractFieldPathSchema.parse("invitedOn.value") },
    checkpoint: { state: "absent", reason: "no-checkpoint-for-run" },
    valueState: "absent",
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
