/**
 * The one place a Kuali finalization read-back becomes a doc-09 `ProbeVerdict`.
 *
 * Both the idempotency probe (beat ①) and the completion verifier (beat ⑥) run
 * the SAME reload read-back and the SAME translation, because they are asking
 * the same question at different times — "does this document carry this exact
 * finalization?" Sharing the translation is what makes doc 09 §4's promise
 * real: a `present` found by recovery parses through the identical schema the
 * normal path used.
 *
 * Every arm carries evidence. There is no boolean anywhere on this path, and a
 * driver-side throw arrives here already shaped as `unknown` — never `absent`.
 */
import { FingerprintSchema } from "../../domain/ids.js";
import type { KualiFinalizationVerdict } from "../../domain/contracts/kuali/match-separation-finalization.js";
import { KualiFinalizationVerdictSchema } from "../../domain/contracts/kuali/match-separation-finalization.js";
import { kualiFinalizationIdempotencyKey } from "../../domain/contracts/kuali/save-separation-finalization.js";
import { sha256Hex } from "../../domain/sha256.js";
import { KUALI_RRSS_DOCUMENT_READY } from "../../domain/ui/kuali-rrss-document.js";
import { KUALI_RRSS_DISPLAYED_TRANSACTION_NUMBER } from "../../domain/ui/kuali-separation-finalization.js";
import type {
  KualiFinalizationReadBack,
  KualiFinalizationTarget,
} from "../../domain/ui/kuali-separation-finalization.js";
import { deriveIdempotencyKeyDigest } from "../../domain/write-safety.js";

/**
 * The exact question this read asked, hashed.
 *
 * It binds the absence to the document AND to every staged value, not just to
 * the permanent key: the key asks "is this document finalized against this
 * transaction", while the READ asked "does it carry these ten values". An
 * absence gathered for a different field set is a different question and can
 * never be counted toward this key's settlement.
 */
export function kualiFinalizationQueryDigest(target: KualiFinalizationTarget): string {
  return FingerprintSchema.parse(sha256Hex(
    `hrauto:kuali-finalization-query:v1\0${target.actionId}\0${target.documentNumber}`
    + `\0${JSON.stringify(target.variables)}`,
  ));
}

/**
 * The evidence record's identity, DERIVED rather than random — two reads of the
 * same document, for the same variables, at the same instant ARE the same
 * observation, and a random id would make the same absence unequal to itself on
 * replay.
 */
function kualiFinalizationAbsenceEvidenceId(
  target: KualiFinalizationTarget,
  observedAt: string,
): string {
  const digest = sha256Hex(
    `hrauto:kuali-finalization-absence:v1\0${target.actionId}\0${target.documentNumber}`
    + `\0${JSON.stringify(target.variables)}\0${observedAt}`,
  );
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    `4${digest.slice(13, 16)}`,
    `8${digest.slice(17, 20)}`,
    digest.slice(20, 32),
  ].join("-");
}

export function kualiFinalizationVerdict(
  target: KualiFinalizationTarget,
  readBack: KualiFinalizationReadBack,
): KualiFinalizationVerdict {
  if (readBack.state === "present") {
    return KualiFinalizationVerdictSchema.parse({ state: "present", proof: readBack.proof });
  }
  if (readBack.state === "unknown") {
    return KualiFinalizationVerdictSchema.parse({
      state: "unknown",
      reason: readBack.reason,
      observedAt: readBack.observedAt,
    });
  }
  return KualiFinalizationVerdictSchema.parse({
    state: "absent",
    evidence: {
      idempotencyKeyDigest: deriveIdempotencyKeyDigest("kuali", kualiFinalizationIdempotencyKey(target)),
      source: KUALI_RRSS_DISPLAYED_TRANSACTION_NUMBER,
      sourceState: KUALI_RRSS_DOCUMENT_READY,
      observedAt: readBack.observedAt,
      queryDigest: kualiFinalizationQueryDigest(target),
      evidenceRef: `observation:${kualiFinalizationAbsenceEvidenceId(target, readBack.observedAt)}`,
    },
  });
}
