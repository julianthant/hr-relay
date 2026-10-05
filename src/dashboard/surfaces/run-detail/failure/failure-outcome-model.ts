import type { FailureDetailWire } from "../../../../domain/dashboard/run-detail.js";

export const FAILURE_OUTCOME: Record<FailureDetailWire["writeState"], { label: string; tone: "good" | "info" | "warning"; caution?: string }> = {
  "not-attempted": { label: "No write attempted", tone: "good" },
  prepared: { label: "Staged · not submitted", tone: "info" },
  attempting: { label: "Submission outcome unsettled", tone: "warning", caution: "Do not retry this submission." },
  committed: { label: "Submitted · verification incomplete", tone: "info", caution: "Do not submit this write again." },
  verified: { label: "Write committed and verified", tone: "info", caution: "Do not submit the verified write again." },
  unknown: { label: "Write outcome unknown", tone: "warning", caution: "Do not retry this submission." },
};

export const FAILURE_NEXT_STEP: Record<FailureDetailWire["remediation"][number]["kind"], string> = {
  "retry-when-served": "Retry only when this run offers a retry action.",
  "operator-action": "Review the source or transaction evidence. Check Details for the required correction.",
  configuration: "Restore the affected configuration before retrying. Check Details for the required correction.",
  "code-change": "Report this issue with the diagnostic reference. The implementation needs a correction.",
  "no-safe-action": "Keep this run held. No safe recovery action was identified.",
};

export function failureNextSteps(detail: Pick<FailureDetailWire, "writeState" | "remediation">): readonly string[] {
  if (detail.writeState === "unknown" || detail.writeState === "attempting") {
    return ["Check the target system and record independently verified evidence before any further submission.",
      ...new Set(detail.remediation.filter(action => action.kind !== "retry-when-served").map(action => FAILURE_NEXT_STEP[action.kind]))];
  }
  return [...new Set(detail.remediation.map(action => FAILURE_NEXT_STEP[action.kind]))];
}
