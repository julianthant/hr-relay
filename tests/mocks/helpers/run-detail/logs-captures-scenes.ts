import { FIXTURE_DAY } from "../fixture-identity.js";
import { FIXTURE_IDS } from "../fixture-queue.js";
import type { ReferenceScene } from "../reference-scenes.js";

export const LOGS_CAPTURES_SCENES: Readonly<Record<"run-running", ReferenceScene>> = Object.freeze({
  "run-running": { id: "run-running", route: { day: FIXTURE_DAY, run: FIXTURE_IDS.runningRun } },
});
