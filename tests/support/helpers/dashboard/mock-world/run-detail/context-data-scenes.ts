import { FIXTURE_DAY } from "../fixture-identity.js";
import { FIXTURE_IDS } from "../fixture-queue.js";
import type { ReferenceScene } from "../reference-scenes.js";

export const CONTEXT_DATA_SCENES: Readonly<Record<"run-queued", ReferenceScene>> = Object.freeze({
  "run-queued": { id: "run-queued", route: { day: FIXTURE_DAY, run: FIXTURE_IDS.queuedRun } },
});
