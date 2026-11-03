import type { UcpathFindingsDetail } from "../../../../models/dashboard/ucpath-findings.js";
import { ERROR_CATALOG } from "../../../../models/failures/error-catalog.js";

export interface FoundUcpathTransaction {
  transactionNumber: string;
  person: string;
  employeeId: string;
  transactionType: string;
  effectiveDate: string;
  submittedAt: string;
  match: "exact" | "ambiguous" | "different";
  detailVerified: boolean;
}
export type UcpathFoundPresentation =
  | { state: "loading" | "checking" | "unavailable" }
  | { state: "found"; complete: boolean; authoritative: boolean; rows: readonly FoundUcpathTransaction[] };
export type UcpathFoundDecision =
  | { kind: "submitted"; transactionNumber: string }
  | { kind: "not-submitted" }
  | { kind: "check-again"; transactionNumber?: string };

class UcpathFindingsIdentityError extends Error {
  readonly code = "LOGS_IDENTITY_REFUSED";
  constructor() {
    super(ERROR_CATALOG.LOGS_IDENTITY_REFUSED.text);
    this.name = "UcpathFindingsIdentityError";
  }
}

export function ucpathFoundPresentation(detail: UcpathFindingsDetail): UcpathFoundPresentation {
  if (detail.state === "unavailable") return { state: "unavailable" };
  return { state: "found", complete: detail.findings.completeness.state === "complete", authoritative: detail.authoritative,
    rows: detail.findings.rows.map((row, index) => {
      const match = detail.matches[index];
      if (match?.transactionId !== row.transactionId) throw new UcpathFindingsIdentityError();
      return { transactionNumber: row.transactionId, person: row.displayedName, employeeId: row.emplId,
        transactionType: row.action, effectiveDate: row.startDate, submittedAt: row.submittedAt,
        detailVerified: row.detailVerified, match: match.match };
    }) };
}
