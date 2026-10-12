import type { UcpathTransactionRow } from "../../../src/models/ui/ucpath-smart-hr-termination.js";

export function createUcpathPendingRowFixtures(EID: UcpathTransactionRow["emplId"], NAME: string, EFFDT: string) {
  function row(overrides: Partial<UcpathTransactionRow> = {}): UcpathTransactionRow {
    return {
      transactionId: "T002209631",
      emplId: EID,
      action: "TER",
      approvalStatus: "Pending",
      startDate: EFFDT,
      displayedName: NAME,
      ...overrides,
    };
  }
  return { row };
}
