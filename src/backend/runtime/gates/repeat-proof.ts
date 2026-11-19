import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import type { RunEnvelope } from "../../../models/run/envelope.js";
import type { SchemaBoundCanonicalValue } from "../../../models/validation/schema-bound-value.js";
import { repeatProofDigest } from "../../../models/run/rerun.js";
import type { WriteIntentRecord } from "../../../rules/write-safety/write-safety.js";

// A generic receipt cannot identify an explicitly authorized repeated occurrence.
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
  const digest = repeatProofDigest(proof, source.protectedBindings ?? occurrence.protectedBindings);
  return !occurrence.baselineEvidence.some((baseline) => baseline.evidenceDigest === digest);
}
