import { defineTaskContract } from "../../task/task-contract.js";
import { taskId } from "../../../rules/identity/ids.js";
import { I9RemoteTargetSchema, I9RemoteVerdictSchema } from "../../ui/i9-creation.js";

export const I9MatchRemoteRecord = defineTaskContract({
  id: taskId("i9/match-remote-record"), title: "Check for existing I-9 record", effect: "read",
  input: I9RemoteTargetSchema, output: I9RemoteVerdictSchema, errorCodes: ["I9_WRITE_REFUSED"],
  subject: { kind: "none", reason: "Discovers and independently verifies the exact saved I-9 identity and record before returning proof" },
  freshness: { defaultMaxAgeMs: 0, defaultOverride: "forbidden" }, provenance: { default: "live" },
  scenarios: ["onboarding/write-transactions"], example: { state: "unknown", reason: "record-unreadable", observedAt: "2026-09-01T18:00:00.000Z" },
});
