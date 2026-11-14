import { hireProofForTarget } from "../ucpath/hire-verdict.js";
import type { z } from "zod";
import { OnboardingWritePlanSchema } from "../../models/workflows/onboarding/read-write-plan.js";
import { OnboardingRosterCellsSchema, ONBOARDING_ROSTER_TYPE_ID } from "../../models/workflows/onboarding/roster.js";
import { I9RemoteProofSchema } from "../../models/ui/i9-creation.js";
import { UcpathHireProofSchema } from "../../models/ui/ucpath-hire.js";
import { WorkbookReferenceWriteSchema } from "../../models/processing/workbooks/read-result.js";

export function onboardingMasterResults(plan: z.infer<typeof OnboardingWritePlanSchema>, receipt: z.infer<typeof UcpathHireProofSchema>, i9: z.infer<typeof I9RemoteProofSchema> | null) {
  const writePlan = OnboardingWritePlanSchema.parse(plan), hire = UcpathHireProofSchema.parse(receipt);
  if (hireProofForTarget(writePlan.hire, hire) === undefined) throw new Error("master-hire-receipt-does-not-match-roster");
  const remote = i9 === null ? null : I9RemoteProofSchema.parse(i9);
  if (writePlan.hire.mode === "new-hire" && (remote === null || hire.profileId !== remote.profileId
    || remote.startDate !== hire.effectiveDate || remote.email.toLowerCase() !== hire.email.toLowerCase())) throw new Error("master-hire-i9-receipts-disagree");
  if (writePlan.hire.mode === "rehire" && (remote !== null || hire.profileId !== null)) throw new Error("master-concurrent-hire-has-i9-write");
  const cells = OnboardingRosterCellsSchema.parse({ transactionNumber: hire.transactionId, ...(hire.emplId === null ? {} : { eid: hire.emplId }) });
  return WorkbookReferenceWriteSchema.parse({ kind: "patch-reference", writeId: "onboarding-results", typeId: ONBOARDING_ROSTER_TYPE_ID,
    referenceDigest: writePlan.roster.referenceDigest, key: writePlan.roster.rowKey.email,
    values: Object.entries(cells).map(([fieldId, value]) => ({ fieldId, value })) });
}
