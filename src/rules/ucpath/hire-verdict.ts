import { UcpathHireQuerySchema, UcpathHireScanSchema, UcpathHireVerdictSchema, UcpathHireProofSchema, ucpathHireKey, ucpathHireSearchDigest,
  type UcpathHireQuery, type UcpathHireFinding, type UcpathHireScan } from "../../models/ui/ucpath-hire.js";
import { deriveIdempotencyKeyDigest } from "../write-safety/write-safety.js";
import { redactedEvidenceId } from "../redaction/redaction.js";

const name = (value: string) => value.trim().replace(/\s+/gu, " ").toLowerCase();
export function ucpathHireVerdict(raw: UcpathHireQuery, read: UcpathHireScan) {
  const input = UcpathHireQuerySchema.parse({ mode: raw.mode, employee: raw.employee, expectedName: raw.expectedName, emplId: raw.emplId }), scan = UcpathHireScanSchema.parse(read);
  const key = ucpathHireKey(input), queryDigest = scan.queryDigest;
  const unknown = (reason: string) => UcpathHireVerdictSchema.parse({ state: "unknown", reason, observedAt: scan.observedAt });
  if (queryDigest !== ucpathHireSearchDigest(input.employee)) return unknown("hire-query-binding-mismatch");
  if (scan.state !== "complete") return unknown("hire-list-incomplete");
  const rows = scan.rows.filter(row => row.effectiveDate === input.employee.effectiveDate && row.positionNumber === input.employee.positionNumber);
  if (rows.some(row => name(row.displayedName) !== name(input.expectedName) || row.email.toLowerCase() !== input.employee.email.toLowerCase()
    || row.dob !== input.employee.dob || input.emplId !== null && row.emplId !== input.emplId)) return unknown("hire-list-identity-mismatch");
  if (rows.length > 1) return UcpathHireVerdictSchema.parse({ state: "ambiguous", matches: rows.length, observedAt: scan.observedAt, queryDigest,
    evidence: rows.map(row => `observation:${redactedEvidenceId("ucpath-hire-match", [row.transactionId, scan.observedAt])}`) });
  const row = rows[0];
  if (row === undefined) return UcpathHireVerdictSchema.parse({ state: "absent", evidence: {
    idempotencyKeyDigest: deriveIdempotencyKeyDigest("ucpath", key), source: "ucpath.hire.transactions", sourceState: "ucpath.hire.transactions-read",
    observedAt: scan.observedAt, queryDigest, evidenceRef: `observation:${redactedEvidenceId("ucpath-hire-absence", [key, scan.observedAt])}`,
  } });
  const proof = hireProofForTarget(raw, row);
  return proof === undefined ? unknown("hire-proof-mismatch") : UcpathHireVerdictSchema.parse({ state: "present", proof });
}

export function hireProofForTarget(input: UcpathHireQuery, row: UcpathHireFinding) {
  if (row.effectiveDate !== input.employee.effectiveDate || row.positionNumber !== input.employee.positionNumber
    || name(row.displayedName) !== name(input.expectedName) || row.email.toLowerCase() !== input.employee.email.toLowerCase()
    || row.dob !== input.employee.dob || input.emplId !== null && row.emplId !== input.emplId
    || "profileId" in input && row.profileId !== input.profileId) return undefined;
  const proof = UcpathHireProofSchema.safeParse({ ...row, kind: "ucpath-hire", source: "ss-smart-hr-detail-read" });
  return proof.success ? proof.data : undefined;
}
