/** The `save-verify` READ-BACK for the PayPath work-study Save: only `present` settles it, and every other verdict parks. */
import { taskId } from "../../../rules/identity/ids.js";
import { defineTaskContract } from "../../task/task-contract.js";
import { UcpathPayPathWorkStudyTargetSchema } from "../../ui/ucpath-paypath.js";
import { UcpathWorkStudyVerdictSchema, workStudyProofExample, workStudySubject } from "./match-paypath-work-study.js";

export const UcpathVerifyPayPathWorkStudy = defineTaskContract({
  id: taskId("ucpath/verify-paypath-work-study"),
  title: "Verify filed PayPath work-study transaction",
  effect: "read",
  input: UcpathPayPathWorkStudyTargetSchema,
  output: UcpathWorkStudyVerdictSchema,
  errorCodes: ["unexpected-page-state", "subject-mismatch"],
  subject: workStudySubject,
  freshness: { defaultMaxAgeMs: 0, defaultOverride: "forbidden" },
  provenance: { default: "live" },
  scenarios: ["work-study/verified-save"],
  example: { state: "present", proof: workStudyProofExample },
});
