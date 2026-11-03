import { UcpathHireTargetSchema, UcpathHireStagingSchema, UcpathHireProofSchema, UCPATH_HIRE_STAGED,
  UcpathHireScanSchema, type UcpathHireTarget, type UcpathHireDriver, type UcpathHireScan } from "../../../../models/ui/ucpath-hire.js";
import { containsDryRunSample } from "../../../../models/workflow/dry-run.js";
import { assertMintedMutationCapability } from "../../../../workflow-kit/mutation-capability.js";

export function refuseHireOperations(): UcpathHireDriver {
  const refuse = async (): Promise<never> => { throw new Error("This UCPath fixture has no hire surface"); };
  return { readHireSubject: refuse, scanHireTransactions: refuse, stageHire: refuse, submitHire: refuse };
}
export function deterministicHireOperations(options: Readonly<{
  now: string; rows?: UcpathHireScan["rows"]; completeness?: UcpathHireScan["state"];
  observedName?: string; submitFailure?: Error; approvalStatus?: "Pending" | "Approved" | "Denied";
}>) {
  const rows = [...options.rows ?? []], events: string[] = [];
  let staged: UcpathHireTarget | undefined;
  const operations: UcpathHireDriver = {
    async readHireSubject() {
      if (staged === undefined) throw new Error("No staged hire subject");
      return options.observedName ?? staged.expectedName;
    },
    async scanHireTransactions() {
      events.push("probe:hire");
      return UcpathHireScanSchema.parse({ state: options.completeness ?? "complete", rows,
        observedAt: options.now, source: "ss-smart-hr-list-and-detail" });
    },
    async stageHire(raw, capture) {
      const target = UcpathHireTargetSchema.parse(raw); staged = undefined;
      const steps = ["template", "effective-date", "create-draft", "reason", "continue",
        ...(target.mode === "new-hire" ? ["personal-data", "legal-name", "lived-name", "dob", "national-id", "address", "phone", "email", "tracker-profile"]
          : ["resolve-eid", "independent-person-name"]),
        "job-data", "position", "classification", "rate-code", "rate", "frequency", "end-date", "earns-dist",
        ...(target.mode === "new-hire" ? ["employee-experience"] : []), "personal-data-return", "identity-readback", "comments", "initiator-comments", "new-id", "submit-enabled"];
      for (const step of steps) { events.push(`prepare:hire:${step}`); await capture(); }
      staged = target;
      return UcpathHireStagingSchema.parse({ stagedPageState: UCPATH_HIRE_STAGED, observedName: await operations.readHireSubject(), transactionIdDisplay: "NEW",
        template: target.mode === "new-hire" ? "UC_FULL_HIRE" : "UC_CONC_HIRE",
        reason: target.mode === "new-hire" ? "Hire - No Prior UC Affiliation" : "Concurrent Hire - Non Dual Emp" });
    },
    async submitHire(capability) {
      assertMintedMutationCapability(capability);
      const target = staged; if (target === undefined) throw new Error("Hire has not been staged");
      if (containsDryRunSample(target)) throw new Error("Preview hire cannot be submitted");
      staged = undefined; events.push("commit:hire");
      const row = { transactionId: `T${String(9000001 + rows.length).padStart(9, "0")}`, approvalStatus: options.approvalStatus ?? "Pending",
        action: "HIR" as const, displayedName: target.expectedName, emplId: target.emplId,
        effectiveDate: target.employee.effectiveDate, positionNumber: target.employee.positionNumber, email: target.employee.email,
        dob: target.employee.dob, detailVerified: true as const };
      rows.push(row);
      if (options.submitFailure !== undefined) throw options.submitFailure;
      return UcpathHireProofSchema.parse({ ...row, kind: "ucpath-hire", source: "ss-smart-hr-detail-read" });
    },
  };
  return Object.assign(operations, { events, rows });
}
