
import { FingerprintSchema } from "../../../rules/identity/ids.js";
import { redactedEvidenceId } from "../../../rules/redaction/redaction.js";
import {
  ucpathPendingSweepIdempotencyKey,
  ucpathPendingTransactionSetDigest,
} from "../../../models/systems/ucpath/delete-pending-terminations.js";
import { ucpathTerminationIdempotencyKey } from "../../../models/systems/ucpath/create-termination.js";
import { UcpathPendingSweepVerdictSchema } from "../../../models/systems/ucpath/match-pending-terminations.js";
import type { UcpathPendingSweepVerdict } from "../../../models/systems/ucpath/match-pending-terminations.js";
import { UcpathTerminationVerdictSchema } from "../../../models/systems/ucpath/match-existing-termination.js";
import type { UcpathTerminationVerdict } from "../../../models/systems/ucpath/match-existing-termination.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import {
  UCPATH_SS_SMART_HR_DISPLAYED_NAME,
  UcpathPendingTransactionSetSchema,
  isUcpathTerminationAction,
  isUcpathTerminationInProgress,
  ucpathPendingTransactionIdList,
} from "../../../models/ui/ucpath-smart-hr-termination.js";
import type {
  UcpathPendingTransactionSet,
  UcpathPendingSweepTarget,
  UcpathTransactionRow,
  UcpathTerminationTarget,
  UcpathTransactionScan,
} from "../../../models/ui/ucpath-smart-hr-termination.js";
import { deriveIdempotencyKeyDigest } from "../../../rules/write-safety/write-safety.js";
import {
  TERMINATION_RECEIPT_ACCEPTED_STATUSES,
  type TerminationReceipt,
} from "../../../rules/separations/termination-receipt.js";
import {
  UcpathTerminationFilingPresenceProofSchema,
  type UcpathTerminationFilingPresenceProof,
} from "../../../models/ui/ucpath-smart-hr-termination.js";

const SOURCE_STATE = "ucpath.ss-smart-hr.transaction-ready";

// Hash both person and effective date; absence for another date cannot settle this key.
export function ucpathTerminationQueryDigest(target: UcpathTerminationTarget): string {
  return FingerprintSchema.parse(sha256Hex(
    ["hrauto:ucpath-termination-query:v1", target.emplId, target.effectiveDate].join("\0"),
  ));
}

export function ucpathPendingSweepQueryDigest(target: UcpathPendingSweepTarget): string {
  return FingerprintSchema.parse(sha256Hex(
    [
      "hrauto:ucpath-pending-terminations-query:v2",
      target.emplId,
      ucpathPendingTransactionSetDigest(target.observedSet),
    ].join("\0"),
  ));
}

/** Partition and order one complete rich scan into an exact stable set. */
export function ucpathPendingTransactionSet(
  scan: Extract<UcpathTransactionScan, { readonly state: "read" }>,
): UcpathPendingTransactionSet {
  const ordered = [...scan.rows].sort((left, right) =>
    left.transactionId.localeCompare(right.transactionId));
  return UcpathPendingTransactionSetSchema.parse({
    kind: "ucpath-pending-termination-set",
    emplId: scan.emplId,
    eligible: ordered.filter(isUcpathTerminationInProgress),
    protected: ordered.filter((row) => !isUcpathTerminationInProgress(row)),
    observedAt: scan.observedAt,
    source: "ss-smart-hr-detail-read",
  });
}

function rowFacts(row: UcpathTransactionRow): readonly string[] {
  return [
    row.transactionId,
    row.emplId,
    row.action,
    row.approvalStatus,
    row.startDate,
    normalizeName(row.displayedName),
  ];
}

function sameRows(
  left: readonly UcpathTransactionRow[],
  right: readonly UcpathTransactionRow[],
): boolean {
  return left.length === right.length
    && left.every((row, index) => JSON.stringify(rowFacts(row)) === JSON.stringify(rowFacts(right[index])));
}


export function ucpathTerminationVerdict(
  target: UcpathTerminationTarget,
  scan: UcpathTransactionScan,
): UcpathTerminationVerdict {
  if (scan.state === "unreadable") {
    return UcpathTerminationVerdictSchema.parse({
      state: "unknown",
      reason: scan.reason,
      observedAt: scan.observedAt,
    });
  }
  const matches = scan.rows.filter(
    (row) => isUcpathTerminationAction(row.action) && row.startDate === target.effectiveDate,
  );
  if (matches.length > 1) {
    return UcpathTerminationVerdictSchema.parse({
      state: "ambiguous",
      matches: matches.length,
      observedAt: scan.observedAt,
      queryDigest: ucpathTerminationQueryDigest(target),
      evidence: matches.map((row) => `observation:${redactedEvidenceId("ucpath-termination-match", [
        String(target.emplId), target.effectiveDate, row.transactionId, scan.observedAt,
      ])}`),
    });
  }
  const [match] = matches;
  if (match !== undefined) {
    return UcpathTerminationVerdictSchema.parse({
      state: "present",
      proof: {
        kind: "ucpath-termination",
        emplId: match.emplId,
        effectiveDate: match.startDate,
        transactionId: match.transactionId,
        approvalStatus: match.approvalStatus,
        displayedName: match.displayedName,
        source: "ss-smart-hr-detail-read",
      },
    });
  }
  return UcpathTerminationVerdictSchema.parse({
    state: "absent",
    evidence: {
      idempotencyKeyDigest: deriveIdempotencyKeyDigest(
        "ucpath",
        ucpathTerminationIdempotencyKey(target),
      ),
      source: UCPATH_SS_SMART_HR_DISPLAYED_NAME,
      sourceState: SOURCE_STATE,
      observedAt: scan.observedAt,
      queryDigest: ucpathTerminationQueryDigest(target),
      evidenceRef: `observation:${redactedEvidenceId("ucpath-termination-absence", [
        String(target.emplId), target.effectiveDate, scan.observedAt,
      ])}`,
    },
  });
}


export function ucpathPendingSweepVerdict(
  target: UcpathPendingSweepTarget,
  scan: UcpathTransactionScan,
): UcpathPendingSweepVerdict {
  if (scan.state === "unreadable") {
    return UcpathPendingSweepVerdictSchema.parse({
      state: "unknown",
      reason: scan.reason,
      observedAt: scan.observedAt,
    });
  }
  let current: UcpathPendingTransactionSet;
  try {
    current = ucpathPendingTransactionSet(scan);
  } catch (error) {
    return UcpathPendingSweepVerdictSchema.parse({
      state: "unknown",
      reason: `the current UCPath transaction set is not canonical: ${error instanceof Error ? error.message : String(error)}`,
      observedAt: scan.observedAt,
    });
  }
  const protectedAgree = sameRows(current.protected, target.observedSet.protected);
  const eligibleAgree = sameRows(current.eligible, target.observedSet.eligible);
  const selectedAreAbsent = target.observedSet.eligible.length > 0 && current.eligible.length === 0;
  if (protectedAgree && (eligibleAgree || selectedAreAbsent)) {
    if (target.observedSet.eligible.length > 0 && eligibleAgree) {
      return UcpathPendingSweepVerdictSchema.parse({
        state: "absent",
        evidence: {
          idempotencyKeyDigest: deriveIdempotencyKeyDigest(
            "ucpath",
            ucpathPendingSweepIdempotencyKey(target),
          ),
          source: UCPATH_SS_SMART_HR_DISPLAYED_NAME,
          sourceState: SOURCE_STATE,
          observedAt: scan.observedAt,
          queryDigest: ucpathPendingSweepQueryDigest(target),
          evidenceRef: `observation:${redactedEvidenceId("ucpath-pending-termination-set", [
            String(target.emplId), ucpathPendingTransactionSetDigest(target.observedSet), scan.observedAt,
          ])}`,
        },
      });
    }
    return UcpathPendingSweepVerdictSchema.parse({
      state: "present",
      proof: {
        kind: "ucpath-pending-terminations-clear",
        emplId: scan.emplId,
        scannedRowCount: scan.scannedRowCount,
        observedAt: scan.observedAt,
        source: "ss-smart-hr-detail-read",
        version: 2,
        selectedTransactionIds: ucpathPendingTransactionIdList(
          target.observedSet.eligible,
        ),
        protectedTransactionIds: ucpathPendingTransactionIdList(
          target.observedSet.protected,
        ),
        setDigest: ucpathPendingTransactionSetDigest(target.observedSet),
      },
    });
  }
  return UcpathPendingSweepVerdictSchema.parse({
    state: "unknown",
    reason:
      "the current UCPath transaction set does not exactly match the machine-observed sweep set: "
      + "a protected row or eligible transaction is missing, changed, ambiguous, or newly present",
    observedAt: scan.observedAt,
  });
}

export type UcpathTerminationFilingPresenceVerdict =
  | Readonly<{ state: "present"; proof: UcpathTerminationFilingPresenceProof }>
  | Readonly<{
    state: "refused" | "unknown";
    reason: string;
    observedAt: UcpathTransactionScan["observedAt"];
  }>;


export function ucpathTerminationFilingPresence(
  receipt: TerminationReceipt,
  scan: UcpathTransactionScan,
): UcpathTerminationFilingPresenceVerdict {
  if (scan.state === "unreadable") {
    return { state: "unknown", reason: scan.reason, observedAt: scan.observedAt };
  }
  if (scan.emplId !== receipt.emplId) {
    return {
      state: "refused",
      reason: "the fresh UCPath filing search was for a different EID than the durable receipt",
      observedAt: scan.observedAt,
    };
  }
  const matches = scan.rows.filter((row) => row.transactionId === receipt.transactionNumber);
  if (matches.length !== 1) {
    return {
      state: "refused",
      reason: matches.length === 0
        ? "the exact durable UCPath filing transaction is absent from the fresh read"
        : "the exact durable UCPath filing transaction is ambiguous in the fresh read",
      observedAt: scan.observedAt,
    };
  }
  const [row] = matches;
  if (row === undefined) throw new Error("one exact filing match disappeared while it was being verified");
  if (row.emplId !== receipt.emplId
    || row.startDate !== receipt.effectiveDate
    || normalizeName(row.displayedName) !== normalizeName(receipt.displayedName)
    || !isUcpathTerminationAction(row.action)
    || !TERMINATION_RECEIPT_ACCEPTED_STATUSES.some((status) => status === row.approvalStatus)) {
    return {
      state: "refused",
      reason: "the exact durable UCPath filing changed EID, effective date, subject, action, or acceptable status",
      observedAt: scan.observedAt,
    };
  }
  return {
    state: "present",
    proof: UcpathTerminationFilingPresenceProofSchema.parse({
      kind: "ucpath-termination-filing-presence",
      transactionId: row.transactionId,
      emplId: row.emplId,
      effectiveDate: row.startDate,
      approvalStatus: row.approvalStatus,
      displayedName: row.displayedName,
      observedAt: scan.observedAt,
      source: "ss-smart-hr-detail-read",
      receiptDisposition: receipt.disposition,
      authority: "kuali-finalization-precondition",
    }),
  };
}

// The EID filter echoes input; displayed name is UCPath's independent subject evidence.
export function firstDisagreeingName(
  scan: UcpathTransactionScan,
  expectedName: string,
): string | undefined {
  if (scan.state === "unreadable") return undefined;
  const expected = normalizeName(expectedName);
  return scan.rows.find((row) => normalizeName(row.displayedName) !== expected)?.displayedName;
}

// UCPath and Kuali order name tokens differently; compare token multisets.
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .split(/[\s,]+/u)
    .filter((token) => token.length > 0)
    .sort()
    .join(" ");
}
