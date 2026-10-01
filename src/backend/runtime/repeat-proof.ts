import { canonicalJsonStringify } from "../../domain/canonical-json.js";
import type { RunEnvelope } from "../../domain/run/envelope.js";
import type { SchemaBoundCanonicalValue } from "../../domain/schema-bound-value.js";
import { sha256Hex } from "../../domain/sha256.js";
import type { WriteIntentRecord } from "../../domain/write-safety.js";

/** A generic old receipt never identifies the newly authorized occurrence. */
export function isFreshOccurrenceProof(intent: WriteIntentRecord, envelope: RunEnvelope, proof: SchemaBoundCanonicalValue): boolean {
  if (intent.status === "observed-present" || intent.occurrence === undefined) return true;
  const occurrence = intent.occurrence;
  const source = envelope.sourceBound;
  const warnings = source?.warnings.filter((warning) => warning.nodeId === occurrence.nodeId
    && warning.taskId === intent.taskId && warning.system === intent.system
    && warning.businessKeyDigest === occurrence.businessKeyDigest);
  if (source === undefined || source.confirmationCommandId !== occurrence.confirmationCommandId
    || source.source.runId !== occurrence.sourceRunId || source.source.expectedVersion !== occurrence.sourceVersion
    || source.warningDigest !== occurrence.warningDigest || source.acknowledgment !== source.warningDigest
    || canonicalJsonStringify(warnings?.map(({ writeIntentId, evidenceDigest }) => ({ writeIntentId, evidenceDigest })))
      !== canonicalJsonStringify(occurrence.baselineEvidence)) {
    throw new Error("repeat occurrence does not match its immutable run authorization");
  }
  const digest = sha256Hex(canonicalJsonStringify(proof));
  return !occurrence.baselineEvidence.some((baseline) => baseline.evidenceDigest === digest);
}
