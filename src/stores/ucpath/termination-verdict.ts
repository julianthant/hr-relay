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
import { ucpathPendingSweepIdempotencyKey } from "../../domain/contracts/ucpath/delete-pending-terminations.js";
import { ucpathTerminationIdempotencyKey } from "../../domain/contracts/ucpath/create-termination.js";
import { UcpathPendingSweepVerdictSchema } from "../../domain/contracts/ucpath/match-pending-terminations.js";
import type { UcpathPendingSweepVerdict } from "../../domain/contracts/ucpath/match-pending-terminations.js";
import { UcpathTerminationVerdictSchema } from "../../domain/contracts/ucpath/match-existing-termination.js";
import type { UcpathTerminationVerdict } from "../../domain/contracts/ucpath/match-existing-termination.js";
import { sha256Hex } from "../../domain/sha256.js";
import {
  UCPATH_SS_SMART_HR_DISPLAYED_NAME,
  isUcpathTerminationAction,
  isUcpathTerminationInProgress,
} from "../../domain/ui/ucpath-smart-hr-termination.js";
import type {
  UcpathPendingSweepTarget,
  UcpathTerminationTarget,
  UcpathTransactionScan,
} from "../../domain/ui/ucpath-smart-hr-termination.js";
import { deriveIdempotencyKeyDigest } from "../../domain/write-safety.js";

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
    ["hrauto:ucpath-pending-terminations-query:v1", target.emplId].join("\0"),
  ));
}

/**
 * The evidence record's identity, DERIVED rather than random — two reads of the
 * same question at the same instant ARE the same observation, and a random id
 * would additionally make the same absence unequal to itself on replay.
 */
function evidenceId(namespace: string, parts: readonly string[]): string {
  const digest = sha256Hex(`hrauto:${namespace}:v1\0${parts.join("\0")}`);
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    `4${digest.slice(13, 16)}`,
    `8${digest.slice(17, 20)}`,
    digest.slice(20, 32),
  ].join("-");
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
      evidence: matches.map((row) => `observation:${evidenceId("ucpath-termination-match", [
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
      evidenceRef: `observation:${evidenceId("ucpath-termination-absence", [
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
  const inProgress = scan.rows.filter(isUcpathTerminationInProgress);
  if (inProgress.length === 0) {
    return UcpathPendingSweepVerdictSchema.parse({
      state: "present",
      proof: {
        kind: "ucpath-pending-terminations-clear",
        emplId: scan.emplId,
        scannedRowCount: scan.scannedRowCount,
        observedAt: scan.observedAt,
        source: "ss-smart-hr-detail-read",
      },
    });
  }
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
      evidenceRef: `observation:${evidenceId("ucpath-pending-terminations", [
        String(target.emplId), scan.observedAt,
      ])}`,
    },
  });
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
