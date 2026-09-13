import { expect } from "@playwright/test";
import { FIXTURE_DAY } from "./fixture-identity.js";
import { FIXTURE_IDS } from "./fixture-queue.js";
import type { ReferenceScene,SceneAnchors } from "./reference-scenes.js";
export const SCENES: readonly ReferenceScene[] = [
  { id: "run-open-gate", route: { day: FIXTURE_DAY, run: FIXTURE_IDS.openGateRun } },

  { id: "run-failed", route: { day: FIXTURE_DAY, run: FIXTURE_IDS.failedRun } },

  { id: "run-running", route: { day: FIXTURE_DAY, run: FIXTURE_IDS.runningRun } },

  { id: "run-done", route: { day: FIXTURE_DAY, run: FIXTURE_IDS.doneRun } },

  { id: "run-queued", route: { day: FIXTURE_DAY, run: FIXTURE_IDS.queuedRun } },

  /*
    The parked write (W2, ref write-safety §4.1). The corpus has photographed this run's
    `blocked` QUEUE ROW since it was written and had never once opened it — so
    the panel behind the one lifecycle the kernel refuses generic retry for was
    unphotographed while its two typed resolutions sat implemented, tested and
    unreachable. This is the reference that makes the resolution copy, the
    served fence facts and the `resolve-write-present` refusal all readable.
  */
  { id: "run-parked-write", route: { day: FIXTURE_DAY, run: FIXTURE_IDS.parkedRun } },

  // groupOf13 is the group the corpus gives a `group` panel detail to; the
  // smaller groups exist to exercise the QUEUE's well sizing, not the panel.
  { id: "run-group", route: { day: FIXTURE_DAY, run: FIXTURE_IDS.groupOf13 } },

  { id: "run-member", route: { day: FIXTURE_DAY, run: FIXTURE_IDS.memberRun } }];
export const ANCHORS: SceneAnchors = {
  "run-group": async (page) => {
    // D225's categorical strip: the segment disclosure button exists only on
    // the categorical arm, and its name carries the replay count.
    await expect(
      page.getByRole("button", { name: "UCPath termination — done, took 2m 48s, a step in it ran 2 times" }),
    ).toBeVisible();
  }};
