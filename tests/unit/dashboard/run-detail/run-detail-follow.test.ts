/**
 * The open run-detail panel follows its run (D257, ref dashboard-surfaces §"Wave-2
 * connection-proof presentation deltas").
 *
 * The defect these pin, from the Track C connection proof (separations §9.22
 * item 4): `useRunDetail` refetched only when `runId` or the command/Data-edit
 * nonce moved, and NOTHING bumped that nonce from the day stream. So the panel
 * an operator had open through the gate approval froze on the wire as of that
 * click and stayed there while the run resumed, ran three more nodes and
 * terminalized — its header still read `Queued` beside a queue row reading
 * `Done · took 8m 20s`, and because `receipt` only enters `availableSections`
 * at terminal, **the evidence receipt was unreachable from a panel you had
 * open**.
 *
 * The follow is keyed on the run's own served `rowRevision`. This tree renders
 * no React in the unit lane, so the decision is a pure fold and it is pinned
 * here; the effect around it is a `setTimeout` and a `setState`.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  followedRunDetailRevision,
  planRunDetailFollow,
  RUN_DETAIL_FOLLOW_SETTLE_MS,
  type RunDetailFollowState,
} from "../../../../src/dashboard/state/use-run-detail.js";

const RUN = "e1b8ae3e-0000-4000-8000-000000000001";
const OTHER_RUN = "21ed4aa0-0000-4000-8000-000000000002";

describe("the open panel follows its run (D257)", () => {
  it("holds while the run is not moving — a follow is not a poll", () => {
    assert.deepEqual(planRunDetailFollow({ runId: RUN, revision: 22 }, RUN, 22), { action: "hold" });
  });

  it("settles a MOVED revision through the coalescing window", () => {
    assert.deepEqual(planRunDetailFollow({ runId: RUN, revision: 22 }, RUN, 23), {
      action: "settle",
      next: { runId: RUN, revision: 23 },
    });
    assert.ok(RUN_DETAIL_FOLLOW_SETTLE_MS > 0, "a zero window would refetch per stream envelope");
  });

  /**
   * The proof's own transition: the run was at rev 22 when the operator
   * approved the gate, and it terminalized several revisions later. Every one
   * of those is a fact about the run moving, and the last one is what the
   * panel must be reading at.
   */
  it("keeps up across a burst, adopting the LATEST served revision each time", () => {
    let state: RunDetailFollowState = { runId: RUN, revision: 22 };
    for (const served of [23, 24, 27]) {
      const step = planRunDetailFollow(state, RUN, served);
      assert.equal(step.action, "settle");
      if (step.action !== "settle") return;
      state = { runId: step.next.runId, revision: step.next.revision };
    }
    assert.deepEqual(state, { runId: RUN, revision: 27 });
  });

  it("adopts a run SWITCH at once — the switch already refetched", () => {
    assert.deepEqual(planRunDetailFollow({ runId: RUN, revision: 22 }, OTHER_RUN, 9), {
      action: "adopt",
      next: { runId: OTHER_RUN, revision: 9 },
    });
    assert.deepEqual(planRunDetailFollow({ runId: RUN, revision: 22 }, undefined, undefined), {
      action: "adopt",
      next: { runId: undefined, revision: undefined },
    });
  });

  it("follows nothing for a run the open day does not hold", () => {
    // An archived run, or a run from another day: no row, no revision, and
    // nothing that could move it.
    assert.deepEqual(planRunDetailFollow({ runId: RUN, revision: undefined }, RUN, undefined), {
      action: "hold",
    });
  });

  it("keys on the SERVED revision while the state lags a switch, so one open is one read", () => {
    // The render in which `runId` has changed but the effect has not run yet.
    assert.equal(followedRunDetailRevision({ runId: RUN, revision: 22 }, OTHER_RUN, 9), 9);
    // ...and the render after it, once the state caught up.
    assert.equal(followedRunDetailRevision({ runId: OTHER_RUN, revision: 9 }, OTHER_RUN, 9), 9);
    // A revision still settling keys on the ADOPTED value, which is what makes
    // the window a window: the fetch does not move until the state does.
    assert.equal(followedRunDetailRevision({ runId: RUN, revision: 22 }, RUN, 27), 22);
  });
});
