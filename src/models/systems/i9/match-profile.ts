import { defineTaskContract } from "../../task/task-contract.js";
import { taskId } from "../../../rules/identity/ids.js";
import { I9ProfileTargetSchema, I9ProfileVerdictSchema } from "../../ui/i9-creation.js";

export const I9MatchProfile = defineTaskContract({
  id: taskId("i9/match-profile"), title: "Check for existing I-9 profile", effect: "read",
  input: I9ProfileTargetSchema, output: I9ProfileVerdictSchema, errorCodes: ["I9_WRITE_REFUSED"],
  subject: { kind: "none", reason: "Discovers and independently verifies the exact saved I-9 identity and record before returning proof" },
  freshness: { defaultMaxAgeMs: 0, defaultOverride: "forbidden" }, provenance: { default: "live" },
  scenarios: ["onboarding/write-transactions"], example: { state: "unknown", reason: "record-unreadable", observedAt: "2026-09-01T18:00:00.000Z" },
});
