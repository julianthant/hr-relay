import {
  UcpathWorkStudyVerdictSchema, WORK_STUDY_FILED_STATUSES, ucpathWorkStudyIdempotencyKey, type UcpathWorkStudyVerdict,
} from "../../models/systems/ucpath/match-paypath-work-study.js";
import type { UcpathPayPathWorkStudyTarget } from "../../models/ui/ucpath-paypath.js";
import { UCPATH_SS_SMART_HR_DISPLAYED_NAME } from "../../models/ui/ucpath-smart-hr-termination.js";
import type { UcpathTransactionFindings } from "../../models/ui/ucpath-transaction-findings.js";
import { FingerprintSchema } from "../identity/ids.js";
import { redactedEvidenceId } from "../redaction/redaction.js";
import { sha256Hex } from "../validation/sha256.js";
import { deriveIdempotencyKeyDigest } from "../write-safety/write-safety.js";

/**
 * The SS Smart HR Action a filed PayPath work-study transaction shows.
 * shortcut: unproven; replace or confirm from probe S6 on work-study-workflow-02 before a real Save.
 */
export const WORK_STUDY_SMART_HR_ACTIONS = ["Data Chg"] as const;

const SOURCE_STATE = "ucpath.ss-smart-hr.transaction-ready";
const isWorkStudyAction = (action: string) => WORK_STUDY_SMART_HR_ACTIONS.some(known => known.toLowerCase() === action.trim().toLowerCase());
const isFiled = (status: string) => WORK_STUDY_FILED_STATUSES.some(filed => filed === status);

function queryDigest(target: UcpathPayPathWorkStudyTarget): string {
  return FingerprintSchema.parse(sha256Hex(["hrauto:ucpath-paypath-work-study-query:v1", target.emplId, target.effectiveDate].join("\0")));
}

/**
 * Folds one SS Smart HR transaction read into the four-state verdict for this person's work-study transaction on the target
 * effective date. Absence needs no transaction of any kind on that date, so an unproven Action label can never hide a filing;
 * the proof is the one filed work-study row and nothing else on that date. The caller owns the subject checks.
 */
export function workStudyTransactionVerdict(target: UcpathPayPathWorkStudyTarget, findings: UcpathTransactionFindings): UcpathWorkStudyVerdict {
  const unknown = (reason: string) => UcpathWorkStudyVerdictSchema.parse({ state: "unknown", reason, observedAt: findings.observedAt });
  if (findings.state === "unreadable") return unknown(findings.reason);
  if (findings.completeness.state !== "complete") return unknown("the SS Smart HR transaction search reached its row cap");
  const onDate = findings.rows.filter(row => row.startDate === target.effectiveDate);
  if (onDate.length === 0) {
    return UcpathWorkStudyVerdictSchema.parse({ state: "absent", evidence: {
      idempotencyKeyDigest: deriveIdempotencyKeyDigest("ucpath", ucpathWorkStudyIdempotencyKey(target)),
      source: UCPATH_SS_SMART_HR_DISPLAYED_NAME, sourceState: SOURCE_STATE, observedAt: findings.observedAt, queryDigest: queryDigest(target),
      evidenceRef: `observation:${redactedEvidenceId("ucpath-paypath-work-study-absence", [target.emplId, target.effectiveDate, findings.observedAt])}`,
    } });
  }
  const matches = onDate.filter(row => isWorkStudyAction(row.action));
  if (matches.length > 1) {
    return UcpathWorkStudyVerdictSchema.parse({
      state: "ambiguous", matches: matches.length, observedAt: findings.observedAt, queryDigest: queryDigest(target),
      evidence: matches.map(row => `observation:${redactedEvidenceId("ucpath-paypath-work-study-match", [target.emplId, target.effectiveDate, row.transactionId, findings.observedAt])}`),
    });
  }
  const [match] = matches;
  if (match === undefined || onDate.length > 1) return unknown("another kind of transaction shows this effective date");
  if (!isFiled(match.approvalStatus)) return unknown(`the work-study transaction on this date is ${match.approvalStatus}`);
  return UcpathWorkStudyVerdictSchema.parse({ state: "present", proof: {
    kind: "ucpath-paypath-work-study", emplId: match.emplId, effectiveDate: match.startDate, transactionId: match.transactionId,
    action: match.action, approvalStatus: match.approvalStatus, displayedName: match.displayedName, source: "ss-smart-hr-detail-read",
  } });
}
