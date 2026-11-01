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
