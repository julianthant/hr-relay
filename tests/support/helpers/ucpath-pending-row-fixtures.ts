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

export function createDeterministicUcpathDriverRow(EID: UcpathTransactionRow["emplId"]) {
  function transactionRow(overrides: Partial<UcpathTransactionRow> = {}): UcpathTransactionRow {
    return {
      transactionId: "T009000001",
      emplId: EID,
      action: "TER",
      approvalStatus: "Pending",
      startDate: "06/11/2026",
      displayedName: "Person, Deterministic",
      ...overrides,
    };
  }
  return { transactionRow };
}
