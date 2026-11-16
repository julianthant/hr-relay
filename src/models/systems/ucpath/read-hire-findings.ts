import { defineTaskContract } from "../../task/task-contract.js";
import { taskId } from "../../../rules/identity/ids.js";
import { UcpathHireIdentitySchema, UcpathHireScanSchema, ucpathHireSearchDigest } from "../../ui/ucpath-hire.js";
import { UCPATH_HIRE_READ_CONTRACT } from "./hire-contract.js";

export const UcpathReadHireFindings = defineTaskContract({ ...UCPATH_HIRE_READ_CONTRACT, id: taskId("ucpath/read-hire-findings"), title: "Read UCPath hire transactions",
  input: UcpathHireIdentitySchema, output: UcpathHireScanSchema, errorCodes: ["UCPATH_HIRE_REFUSED", "BROWSER_SCREENSHOT_CAPTURE_FAILED"],
  example: { state: "complete", rows: [], queryDigest: ucpathHireSearchDigest({ firstName: "Fixture", lastName: "Hire" }), observedAt: "2026-09-01T18:00:00.000Z", source: "ss-smart-hr-list-and-detail" } });
