import type { UcpathCandidate } from "../../models/systems/ucpath/search-person-org.js";

export function selectPreferredUcpathCandidate(candidates: readonly UcpathCandidate[]): UcpathCandidate | null {
  return [...candidates].sort((left, right) => {
    const leftActive = left.employeeStatus === "active";
    const rightActive = right.employeeStatus === "active";
    if (leftActive !== rightActive) return leftActive ? -1 : 1;
    if (left.hdh !== right.hdh) return left.hdh ? -1 : 1;
    return right.effectiveDate.localeCompare(left.effectiveDate);
  })[0] ?? null;
}
