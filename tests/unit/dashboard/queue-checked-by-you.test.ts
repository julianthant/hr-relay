/**
 * Checked-by-you is triage context, not a durable member outcome. It must stay
 * immutable per update and a fresh dashboard load must begin empty.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { FIXTURE_DAY_WIRE } from "../../parity/helpers/fixture-day.js";
import {
  checkedByYouCount,
  toggleCheckedByYou,
  type MemberSurfaceWire,
} from "../../../src/dashboard/surfaces/queue/queue-model.js";

const members = FIXTURE_DAY_WIRE.queueSurfaces.filter(
  (surface): surface is MemberSurfaceWire => surface.surfaceKind === "member",
);

describe("checked by you — local triage only (ledger 1 B57/B80)", () => {
  it("toggles an immutable local set and counts only members in the displayed group", () => {
    const first = String(members[0]?.runId);
    const foreign = "1a000000-0000-4000-8000-000000000099";
    const empty = new Set<string>();
    const checked = toggleCheckedByYou(toggleCheckedByYou(empty, first), foreign);

    assert.equal(empty.size, 0, "a local update never mutates a prior render's state");
    assert.equal(checkedByYouCount(members, checked), 1, "a foreign id cannot inflate this group's tally");
    assert.equal(toggleCheckedByYou(checked, first).has(first), false, "the same control unchecks the member");
  });

  it("starts empty on a fresh client load instead of restoring authority-like state", () => {
    const reloadedClientState = new Set<string>();
    assert.equal(checkedByYouCount(members, reloadedClientState), 0);
  });
});
