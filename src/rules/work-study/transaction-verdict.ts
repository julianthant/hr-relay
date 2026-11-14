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
 * shortcut: unproven, with the three facts this fold also assumes: that PayPath transactions are listed in the SS Smart HR
 * search at all, that a row's start date is the PayPath effective date, and that the PayPath header name matches the SS
 * Smart HR detail name. Replace or confirm each from probe S6 on work-study-workflow-02 before a real Save.
 */
export const WORK_STUDY_SMART_HR_ACTIONS = ["Data Chg"] as const;

const SOURCE_STATE = "ucpath.ss-smart-hr.transaction-ready";
const isWorkStudyAction = (action: string) => WORK_STUDY_SMART_HR_ACTIONS.some(known => known.toLowerCase() === action.trim().toLowerCase());
const isFiled = (status: string) => WORK_STUDY_FILED_STATUSES.some(filed => filed === status);

function queryDigest(target: UcpathPayPathWorkStudyTarget): string {
  return FingerprintSchema.parse(sha256Hex(["hrauto:ucpath-paypath-work-study-query:v1", target.emplId, target.effectiveDate].join("\0")));
}

function absent(target: UcpathPayPathWorkStudyTarget, findings: Extract<UcpathTransactionFindings, { state: "read" }>): UcpathWorkStudyVerdict {
  return UcpathWorkStudyVerdictSchema.parse({ state: "absent", evidence: {
    idempotencyKeyDigest: deriveIdempotencyKeyDigest("ucpath", ucpathWorkStudyIdempotencyKey(target)),
    source: UCPATH_SS_SMART_HR_DISPLAYED_NAME, sourceState: SOURCE_STATE, observedAt: findings.observedAt, queryDigest: queryDigest(target),
    evidenceRef: `observation:${redactedEvidenceId("ucpath-paypath-work-study-absence", [target.emplId, target.effectiveDate, findings.observedAt])}`,
  } });
}

function complete(findings: UcpathTransactionFindings): Extract<UcpathTransactionFindings, { state: "read" }> | string {
  if (findings.state === "unreadable") return findings.reason;
  if (findings.completeness.state !== "complete") return "the SS Smart HR transaction search reached its row cap";
  return findings;
}

/**
 * Before any Save: absent only when no transaction of any kind carries the effective date. Any row on that date is unknown, so
 * the run refuses with nothing staged: nothing yet ties a row to reason JRL or pool F, so an existing row is never taken as
 * this person's filing. The caller owns the subject checks.
 */
export function workStudyPrewriteVerdict(target: UcpathPayPathWorkStudyTarget, findings: UcpathTransactionFindings): UcpathWorkStudyVerdict {
  const read = complete(findings);
  if (typeof read === "string") return UcpathWorkStudyVerdictSchema.parse({ state: "unknown", reason: read, observedAt: findings.observedAt });
  if (read.rows.some(row => row.startDate === target.effectiveDate)) {
    return UcpathWorkStudyVerdictSchema.parse({ state: "unknown", reason: "a transaction already shows this effective date; file this person by hand", observedAt: findings.observedAt });
  }
  return absent(target, read);
}

/**
 * After the Save and Submit click: the pre-write probe proved the effective date empty, so the proof is the one filed
 * work-study row now on that date and nothing else; two are ambiguous, and anything else on the date, a Denied, Error or
 * Pushed Back row, or a capped or unreadable search is unknown. The caller owns the subject checks.
 */
export function workStudySavedVerdict(target: UcpathPayPathWorkStudyTarget, findings: UcpathTransactionFindings): UcpathWorkStudyVerdict {
  const read = complete(findings);
  const unknown = (reason: string) => UcpathWorkStudyVerdictSchema.parse({ state: "unknown", reason, observedAt: findings.observedAt });
  if (typeof read === "string") return unknown(read);
  const onDate = read.rows.filter(row => row.startDate === target.effectiveDate);
  if (onDate.length === 0) return absent(target, read);
  const matches = onDate.filter(row => isWorkStudyAction(row.action));
  if (matches.length > 1) {
    return UcpathWorkStudyVerdictSchema.parse({
      state: "ambiguous", matches: matches.length, observedAt: read.observedAt, queryDigest: queryDigest(target),
      evidence: matches.map(row => `observation:${redactedEvidenceId("ucpath-paypath-work-study-match", [target.emplId, target.effectiveDate, row.transactionId, read.observedAt])}`),
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
