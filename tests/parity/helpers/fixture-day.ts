import { CommandResultSchema,type CommandResult } from "../../../src/rules/commands/commands.js";
import { uuidOf } from "./fixture-identity.js";


export const FIXTURE_COMMAND_RESULTS: Readonly<Record<"applied" | "conflict" | "rejected", CommandResult>> = Object.freeze({
  applied: CommandResultSchema.parse({
    state: "applied",
    commandId: uuidOf(920),
    affectedTargets: [{ family: "run", runId: uuidOf(910) }],
  }),
  conflict: CommandResultSchema.parse({
    state: "conflict",
    commandId: uuidOf(921),
    currentVersion: 2,
    message: "the row moved while you were looking at it; the fresh projection replaces it",
  }),
  rejected: CommandResultSchema.parse({
    state: "rejected",
    commandId: uuidOf(922),
    code: "policy-refused",
    message: "a cancelled run cannot be retried from this surface",
  }),
});
export { FIXTURE_BOOTSTRAP } from "./fixture-bootstrap.js";
export { FIXTURE_IDENTITY_GATE,FIXTURE_IDENTITY_GATE_TYPED_EID,FIXTURE_PARKED_WRITE,FIXTURE_RUN_DETAILS,FIXTURE_SECTIONS } from "./fixture-detail.js";
export { FIXTURE_DIAGNOSTIC_BUNDLE,FIXTURE_DIAGNOSTIC_BUNDLE_MANIFEST,FIXTURE_DIAGNOSTIC_SCREENSHOT_BYTES } from "./fixture-diagnostic.js";
export { FIXTURE_APP_VERSION,FIXTURE_DAY,FIXTURE_DESCRIPTOR_HASH,FIXTURE_NOW,traceOf,uuidOf } from "./fixture-identity.js";
export { BACKFILL_GAP_DAY_WIRE,FIXTURE_DAY_WIRE,FIXTURE_IDS } from "./fixture-queue.js";
export { FIXTURE_EDITABLE_SETTINGS,FIXTURE_SETTINGS_FACTS } from "./fixture-settings.js";
export { FIXTURE_SEPARATIONS_START_PLAN,FIXTURE_START_PICKER_BOOTSTRAP,FIXTURE_START_PICKER_DAY_WIRE,FIXTURE_START_PICKER_DESCRIPTOR_HASH,FIXTURE_START_PLAN } from "./fixture-start.js";
export { FIXTURE_STORAGE_DEGRADED_BOOTSTRAP,FIXTURE_STORAGE_DOCTOR } from "./fixture-storage.js";
