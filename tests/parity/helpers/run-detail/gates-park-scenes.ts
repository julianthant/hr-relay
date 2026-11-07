import { FIXTURE_DAY } from "../fixture-identity.js";
import { FIXTURE_IDS } from "../fixture-queue.js";
import type { ReferenceScene } from "../reference-scenes.js";

export const GATES_PARK_SCENES: Readonly<Record<"run-open-gate" | "run-parked-write", ReferenceScene>> = Object.freeze({
  "run-open-gate": { id: "run-open-gate", route: { day: FIXTURE_DAY, run: FIXTURE_IDS.openGateRun } },
  "run-parked-write": { id: "run-parked-write", route: { day: FIXTURE_DAY, run: FIXTURE_IDS.parkedRun } },
});
