import { FIXTURE_DAY } from "../fixture-identity.js";
import { FIXTURE_IDS } from "../fixture-queue.js";
import type { ReferenceScene } from "../reference-scenes.js";

export const RECEIPTS_FAILURES_SCENES: Readonly<Record<"run-failed", ReferenceScene>> = Object.freeze({
  "run-failed": { id: "run-failed", route: { day: FIXTURE_DAY, run: FIXTURE_IDS.failedRun } },
});
