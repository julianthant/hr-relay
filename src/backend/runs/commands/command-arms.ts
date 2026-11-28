import { COMMAND_FAMILY_REGISTRY } from "../../../rules/commands/commands.js";
import { deepFreeze } from "../../../rules/validation/immutability.js";

const PHASE1_ACTIVE = {
  "ocr-review": ["correct-ocr-record", "discard-ocr-record", "restore-ocr-record", "add-ocr-record"],
  application: ["pause-all", "pause-all-and-quit"],
  'assistant-model-preference': ['set-assistant-model-preference'],
  "failure-resolution": ["annotate-failure"],
  "workflow-batch": ["set-batch-grouping"],
  start: ["start-run"],
  "worker-browser": [
    "check-parked-write",
    "plan-worker-count",
    "spawn-worker",
    "stop-worker",
    "remove-worker",
    "retry-worker",
    "pause-worker",
    "resume-worker",
    "refresh-browser",
    "reopen-browser",
  ],
  run: [
    "pause",
    "resume",
    "retry",
    "cancel",
    "bump",
    "rename",
    "delete",
    "recheck-write",
    "resolve-write-absent",
    "resolve-workbook-row",
    "resolve-workbook-reference-row",
  ],
  gate: ["resolve-gate"],

  notification: ["notification-read", "notification-unread", "notification-snooze", "notification-unsnooze", "notification-read-all", "notification-unread-all", "notification-snooze-all", "notification-unsnooze-all", "notification-clear"],

  intake: [
    "inspect-intake",
    "confirm-intake-mapping",
    "correct-intake-row",
    "exclude-intake-row",
    "validate-intake",
    "enqueue-intake-manifest",
  ],
  settings: ["apply-settings", "apply-protected-settings"],

} as const;

export const PHASE1_ACTIVE_COMMAND_ARMS = deepFreeze(PHASE1_ACTIVE);

function armActions(partition: Readonly<Record<string, readonly string[]>>, family: string): readonly string[] {
  const actions = Object.hasOwn(partition, family) ? partition[family] : undefined;
  if (actions === undefined) return [];
  return actions;
}


for (const { family, actions } of COMMAND_FAMILY_REGISTRY) {
  const active = armActions(PHASE1_ACTIVE, family);
  const available = actions.filter(action => action !== "recover-run");
  if (active.length !== available.length
    || new Set(active).size !== active.length
    || available.some((action) => !active.includes(action))) {
    throw new Error(`command arm partition does not cover family ${family} exactly`);
  }
}
