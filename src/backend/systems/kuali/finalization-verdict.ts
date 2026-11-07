import { valueFreeProtectedData } from "../../../models/write-safety/protected-input.js";

import { FingerprintSchema } from "../../../rules/identity/ids.js";
import type { KualiFinalizationVerdict } from "../../../models/systems/kuali/match-separation-finalization.js";
import { KualiFinalizationVerdictSchema } from "../../../models/systems/kuali/match-separation-finalization.js";
import { kualiFinalizationIdempotencyKey } from "../../../models/systems/kuali/save-separation-finalization.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import { KUALI_RRSS_DOCUMENT_READY } from "../../../models/ui/kuali-rrss-document.js";
import { KUALI_RRSS_DISPLAYED_TRANSACTION_NUMBER } from "../../../models/ui/kuali-separation-finalization.js";
import type {
  KualiFinalizationReadBack,
  KualiFinalizationTarget,
} from "../../../models/ui/kuali-separation-finalization.js";
import { deriveIdempotencyKeyDigest } from "../../../rules/write-safety/write-safety.js";

// Absence binds every staged value as well as document and transaction; another field set is another question.
export function kualiFinalizationQueryDigest(target: KualiFinalizationTarget): string {
  return FingerprintSchema.parse(sha256Hex(
    `hrauto:kuali-finalization-query:v1\0${JSON.stringify(valueFreeProtectedData({ actionId: target.actionId,
      documentNumber: target.documentNumber, variables: target.variables }, target.protectedBindings))}`,
  ));
}


function kualiFinalizationAbsenceEvidenceId(
  target: KualiFinalizationTarget,
  observedAt: string,
): string {
  const digest = sha256Hex(
    `hrauto:kuali-finalization-absence:v1\0${kualiFinalizationQueryDigest(target)}\0${observedAt}`,
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
