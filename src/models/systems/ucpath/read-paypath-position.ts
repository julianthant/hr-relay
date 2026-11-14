import { z } from "zod";
import { EidSchema, taskId } from "../../../rules/identity/ids.js";
import { defineTaskContract } from "../../task/task-contract.js";
import { UCPATH_PAYPATH_POSITION_READY, UCPATH_PAYPATH_REFUSAL_CODES, UcpathPayPathReadSchema } from "../../ui/ucpath-paypath.js";

export const UcpathReadPayPathPosition = defineTaskContract({
  id: taskId("ucpath/read-paypath-position"), title: "Read PayPath position data", effect: "read",
  input: z.strictObject({ emplId: EidSchema }), output: UcpathPayPathReadSchema,
  errorCodes: [...UCPATH_PAYPATH_REFUSAL_CODES, "BROWSER_SCREENSHOT_CAPTURE_FAILED"],
  subject: { kind: "none", reason: "The read refuses unless PayPath opens exactly one record whose header shows the requested Empl ID and a displayed name" },
  freshness: { defaultMaxAgeMs: 0, defaultOverride: "forbidden" }, provenance: { default: "live" },
  scenarios: ["work-study/planned-transaction"],
  example: {
    pageStateId: UCPATH_PAYPATH_POSITION_READY, emplId: "10000001", displayedName: "Lee, Jordan",
    position: { effectiveDate: "07/01/2026", positionChangeReason: "", positionPool: "", positionNumber: "40012345" },
    observedAt: "2026-08-03T18:00:00.000Z",
  },
});
