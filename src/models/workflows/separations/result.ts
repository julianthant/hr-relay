import { z } from "zod";
import { ResolvedIdentitySubjectSchema } from "../../../rules/separations/identity-approval.js";
import { TerminationReceiptSchema } from "../../../rules/separations/termination-receipt.js";
import { OmittedStepResultArmSchema } from "../../workflow/step-omission.js";
import { KualiSavedFinalizationProofSchema } from "../../ui/kuali-separation-finalization.js";
import { UcpathPendingSweepSettlementProofSchema } from "../../ui/ucpath-smart-hr-termination.js";

export const SeparationsResultSchema = z.strictObject({
  documentNumber: z.string().min(1),
  /** The subject established by machine verification or operator approval. */
  approved: ResolvedIdentitySubjectSchema,
  // The one employment row the termination was filed against.
  employment: z.strictObject({
    emplRecord: z.string().min(1),
    payrollTitleCode: z.string().min(1),
    payrollTitle: z.string().min(1),
  }),
  /** Which Kuali department option was staged, and the UCPath code it was keyed by. */
  department: z.strictObject({
    option: z.string().min(1),
    departmentCode: z.string().min(1),
  }),
  /** What the run reconciled, beside what the form carried. */
  dates: z.strictObject({
    kualiLastDayWorked: z.string().min(1),
    lastDayWorked: z.string().min(1),
    kualiSeparationDate: z.string().min(1),
    separationDate: z.string().min(1),
    terminationEffectiveDate: z.string().min(1),
    lastDayWorkedChanged: z.boolean(),
    separationDateChanged: z.boolean(),
  }),
  /** Whether the sweep had anything to do, and what the grid showed after it. */
  pendingSweep: z.union([
    z.strictObject({
      disposition: z.enum(["committed", "already-present"]),
      proof: UcpathPendingSweepSettlementProofSchema,
    }),
    OmittedStepResultArmSchema,
  ]),
  /** §4c's completion shape: the receipt PAIR, checked rather than carried — the number alone is never a proof. */
  termination: TerminationReceiptSchema,
  // The landing proof is always the reload read-back's.
  finalization: z.union([
    z.strictObject({
      disposition: z.enum(["committed", "already-present"]),
      proof: KualiSavedFinalizationProofSchema,
    }),
    OmittedStepResultArmSchema,
  ]),
});


