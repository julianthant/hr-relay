/**
 * The one place a UCPath transaction scan becomes a ref write-safety `ProbeVerdict`.
 *
 * ONE rich page read (D194/D201) and TWO folds, because ref write-safety §5 needs two
 * genuinely different probes of the same rows: "is this person already being
 * terminated effective THIS DATE?" and "does this person have ANY in-progress
 * termination?". The read classifies nothing; these folds do, unconditionally
 * and with no page access of their own.
 *
 * Both the beat-① probe and the beat-⑥ verifier run the same fold, because they
 * ask the same question at different times — which is what makes ref write-safety §4's
 * promise real: a `present` found by recovery parses through the identical
 * schema the normal path used.
 *
 * **A scan that could not be read is `unknown`, never `absent`.** That is
 * dangerous pattern D5 and D6 stated as code: legacy reports "no results
 * surfaced within the timeout" as a factual negative, and treats a matched row
 * whose `T#` could not be read as no match at all (**S46**), both of which
 * authorize a duplicate termination on a real person.
 */
import { FingerprintSchema } from "../../domain/ids.js";
import { redactedEvidenceId } from "../../domain/redaction.js";
import {
  ucpathPendingSweepIdempotencyKey,
  ucpathPendingTransactionSetDigest,
} from "../../domain/contracts/ucpath/delete-pending-terminations.js";
import { ucpathTerminationIdempotencyKey } from "../../domain/contracts/ucpath/create-termination.js";
import { UcpathPendingSweepVerdictSchema } from "../../domain/contracts/ucpath/match-pending-terminations.js";
import type { UcpathPendingSweepVerdict } from "../../domain/contracts/ucpath/match-pending-terminations.js";
import { UcpathTerminationVerdictSchema } from "../../domain/contracts/ucpath/match-existing-termination.js";
import type { UcpathTerminationVerdict } from "../../domain/contracts/ucpath/match-existing-termination.js";
import { sha256Hex } from "../../domain/sha256.js";
import {
  UCPATH_SS_SMART_HR_DISPLAYED_NAME,
  UcpathPendingTransactionSetSchema,
  isUcpathTerminationAction,
  isUcpathTerminationInProgress,
  ucpathPendingTransactionIdList,
} from "../../domain/ui/ucpath-smart-hr-termination.js";
import type {
  UcpathPendingTransactionSet,
  UcpathPendingSweepTarget,
  UcpathTransactionRow,
  UcpathTerminationTarget,
  UcpathTransactionScan,
} from "../../domain/ui/ucpath-smart-hr-termination.js";
import { deriveIdempotencyKeyDigest } from "../../domain/write-safety.js";
import {
  TERMINATION_RECEIPT_ACCEPTED_STATUSES,
  type TerminationReceipt,
} from "../../domain/separations/termination-receipt.js";
import {
  UcpathTerminationFilingPresenceProofSchema,
  type UcpathTerminationFilingPresenceProof,
} from "../../domain/ui/ucpath-smart-hr-termination.js";

const SOURCE_STATE = "ucpath.ss-smart-hr.transaction-ready";

/**
 * The exact question this read asked, hashed. It binds an absence to the person
 * AND the date, so an absence gathered for a different date can never be
 * counted toward this key's settlement.
 */
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

/**
 * The effective-date-keyed fold. `ambiguous` is a real arm and not a
 * defensive one: two `Terminat*` rows on one date is a state nobody may pick
 * from, and picking the first is how the wrong receipt gets recorded.
 */
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

/**
 * The date-agnostic fold, and note the POLARITY: the transaction it guards is
 * "this person has no in-progress termination rows", so `present` means there
 * is nothing to sweep and `absent` means there is.
 */
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

/**
 * Reconcile a durable termination receipt with a fresh SS Smart HR read. The
 * exact transaction id is the stable identity; every other load-bearing fact
 * must still agree, while the status may advance only among the three receipt
 * statuses that mean the termination remains in effect.
 */
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

/**
 * The subject check both probes run against EVERY row they read, before any
 * fold. A scan is filtered by EID, but the EID is the run's own filter echoed
 * back — the DISPLAYED NAME is UCPath's own answer, and it is the only thing on
 * this page that can catch a scan of the wrong person's transactions.
 *
 * Returns the offending row's name, or `undefined` when every row agrees.
 */
export function firstDisagreeingName(
  scan: UcpathTransactionScan,
  expectedName: string,
): string | undefined {
  if (scan.state === "unreadable") return undefined;
  const expected = normalizeName(expectedName);
  return scan.rows.find((row) => normalizeName(row.displayedName) !== expected)?.displayedName;
}

/**
 * UCPath renders `First Last` and Kuali renders `Last, First`, so the
 * comparison is over a token MULTISET rather than a string — the same rule
 * `classifyNameSimilarity` already applies one layer up, and the reason it
 * answers `same` for `Drose Clauckia` against `Clauckia, Drose`.
 */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .split(/[\s,]+/u)
    .filter((token) => token.length > 0)
    .sort()
    .join(" ");
}
