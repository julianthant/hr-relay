import type { UcpathPayPathWorkStudyTarget } from "../../../models/ui/ucpath-paypath.js";
import type { UcpathWorkStudyVerdict } from "../../../models/systems/ucpath/match-paypath-work-study.js";
import type { UcpathStoreDriver } from "../../../models/ui/ucpath-driver.js";
import { directIdentifierDisplay } from "../../../rules/redaction/redaction.js";
import type { workStudyPrewriteVerdict } from "../../../rules/work-study/transaction-verdict.js";
import { firstDisagreeingName } from "./termination-verdict.js";

type Refuse = (code: "subject-mismatch", message: string, options: { subject: UcpathPayPathWorkStudyTarget["emplId"] }) => never;

type Fold = typeof workStudyPrewriteVerdict;

/** The probe's, the commit's and the verifier's one read: this person's SS Smart HR transaction findings folded by `fold`, refusing another person's rows. */
export async function readWorkStudyVerdict(driver: UcpathStoreDriver, input: UcpathPayPathWorkStudyTarget, fold: Fold, refuse: Refuse): Promise<UcpathWorkStudyVerdict> {
  const findings = await driver.readTransactionFindings({ emplId: input.emplId });
  if (findings.state === "read" && findings.emplId !== input.emplId) {
    return refuse("subject-mismatch", "UCPath transaction findings belong to another employee", { subject: input.emplId });
  }
  const disagreeing = firstDisagreeingName(findings, input.expectedName);
  if (disagreeing !== undefined) {
    return refuse("subject-mismatch",
      `UCPath returned a transaction for ${directIdentifierDisplay(disagreeing)} while the run named ${directIdentifierDisplay(input.expectedName)}; `
      + "a read of the wrong person's transaction list is not evidence about this one", { subject: input.emplId });
  }
  return fold(input, findings);
}
