/**
 * The one place a Kuali read-back becomes a ref write-safety `ProbeVerdict`.
 *
 * Both the idempotency probe (beat ①) and the completion verifier (beat ⑥) run
 * the SAME reload read-back and the SAME translation, because they are asking
 * the same question at different times — "does this document carry this exact
 * value?" Sharing the translation is what makes ref write-safety §4's promise real: a
 * `present` found by recovery parses through the identical schema the normal
 * path used.
 *
 * Every arm carries evidence. There is no boolean anywhere on this path, and a
 * driver-side throw arrives here already shaped as `unknown` — never `absent`.
 */
import { FingerprintSchema } from "../../domain/ids.js";
import type { KualiTimekeeperTarget } from "../../domain/contracts/kuali/read-timekeeper-annotation.js";
import { KualiTimekeeperVerdictSchema } from "../../domain/contracts/kuali/read-timekeeper-annotation.js";
import type { KualiTimekeeperVerdict } from "../../domain/contracts/kuali/read-timekeeper-annotation.js";
import { kualiTimekeeperIdempotencyKey } from "../../domain/contracts/kuali/save-timekeeper-annotation.js";
import { sha256Hex } from "../../domain/sha256.js";
import {
  KUALI_RRSS_DISPLAYED_TIMEKEEPER,
  KUALI_RRSS_DOCUMENT_READY,
} from "../../domain/ui/kuali-rrss-document.js";
import type { KualiTimekeeperReadBack } from "../../domain/ui/kuali-rrss-document.js";
import { deriveIdempotencyKeyDigest } from "../../domain/write-safety.js";

/**
 * The exact question this read asked, hashed. It binds the absence to the
 * document AND the value — an absence gathered for a different value can never
 * be counted toward this key's settlement.
 */
export function kualiTimekeeperQueryDigest(target: KualiTimekeeperTarget): string {
  return FingerprintSchema.parse(sha256Hex(
    `hrauto:kuali-timekeeper-query:v1\0${target.actionId}\0${target.documentNumber}\0${target.timekeeperName}`,
  ));
}

/**
 * The evidence record's identity, DERIVED rather than random.
 *
 * `EvidenceRefSchema` requires a UUID-backed record id, and a task has no id
 * factory — but it also should not need one here: two reads of the same
 * document, for the same value, at the same instant ARE the same observation,
 * and deriving the id from exactly those three facts says so. A random id would
 * additionally make the same absence unequal to itself on replay.
 */
function kualiAbsenceEvidenceId(target: KualiTimekeeperTarget, observedAt: string): string {
  const digest = sha256Hex(
    `hrauto:kuali-timekeeper-absence:v1\0${target.actionId}\0${target.documentNumber}`
    + `\0${target.timekeeperName}\0${observedAt}`,
  );
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    `4${digest.slice(13, 16)}`,
    `8${digest.slice(17, 20)}`,
    digest.slice(20, 32),
  ].join("-");
}

export function kualiTimekeeperVerdict(
  target: KualiTimekeeperTarget,
  readBack: KualiTimekeeperReadBack,
): KualiTimekeeperVerdict {
  if (readBack.state === "present") {
    return KualiTimekeeperVerdictSchema.parse({ state: "present", proof: readBack.proof });
  }
  if (readBack.state === "unknown") {
    return KualiTimekeeperVerdictSchema.parse({
      state: "unknown",
      reason: readBack.reason,
      observedAt: readBack.observedAt,
    });
  }
  return KualiTimekeeperVerdictSchema.parse({
    state: "absent",
    evidence: {
      idempotencyKeyDigest: deriveIdempotencyKeyDigest("kuali", kualiTimekeeperIdempotencyKey(target)),
      source: KUALI_RRSS_DISPLAYED_TIMEKEEPER,
      sourceState: KUALI_RRSS_DOCUMENT_READY,
      observedAt: readBack.observedAt,
      queryDigest: kualiTimekeeperQueryDigest(target),
      evidenceRef: `observation:${kualiAbsenceEvidenceId(target, readBack.observedAt)}`,
    },
  });
}
