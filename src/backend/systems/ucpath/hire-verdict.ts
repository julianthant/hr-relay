import { UcpathHireQuerySchema, UcpathHireScanSchema, UcpathHireVerdictSchema, UcpathHireProofSchema, ucpathHireKey,
  type UcpathHireQuery, type UcpathHireScan } from "../../../models/ui/ucpath-hire.js";
import { deriveIdempotencyKeyDigest } from "../../../rules/write-safety/write-safety.js";
import { redactedEvidenceId } from "../../../rules/redaction/redaction.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";

const name = (value: string) => value.trim().replace(/\s+/gu, " ").toLowerCase();
export function ucpathHireVerdict(raw: UcpathHireQuery, read: UcpathHireScan) {
  const input = UcpathHireQuerySchema.parse({ mode: raw.mode, employee: raw.employee, expectedName: raw.expectedName, emplId: raw.emplId }), scan = UcpathHireScanSchema.parse(read);
  const key = ucpathHireKey(input), queryDigest = sha256Hex(key);
  const unknown = (reason: string) => UcpathHireVerdictSchema.parse({ state: "unknown", reason, observedAt: scan.observedAt });
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
  const proof = UcpathHireProofSchema.safeParse({ ...row, kind: "ucpath-hire", source: "ss-smart-hr-detail-read" });
  return proof.success ? UcpathHireVerdictSchema.parse({ state: "present", proof: proof.data }) : unknown("hire-status-refused");
}
