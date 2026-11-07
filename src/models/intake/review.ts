import { canonicalJsonStringify } from "../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../rules/validation/sha256.js";
import type { IntakeSession } from "./session.js";
import type { IntakePlanManifest } from "./manifest.js";

/** Exact earlier import identity, or the existing uniquely latest same-byte comparison. */
export function resolveIntakeComparison(session: IntakeSession, lookup: {
  get(id: string): IntakePlanManifest | undefined;
  findBySource(sha256: string): readonly IntakePlanManifest[];
}): IntakePlanManifest | undefined {
  const eligible = (row: IntakePlanManifest) => row.workflow === session.workflow
    && row.manifestId !== session.reservedManifestId && Date.parse(row.createdAt) <= Date.parse(session.createdAt);
  if (session.comparisonManifestId !== undefined) {
    const prior = lookup.get(session.comparisonManifestId);
    if (prior === undefined) throw new Error(`comparison manifest ${session.comparisonManifestId} is missing`);
    if (!eligible(prior)) throw new Error(`comparison manifest ${session.comparisonManifestId} is not an earlier import for ${session.workflow}`);
    return prior;
  }
  const candidates = lookup.findBySource(session.artifact.sha256).filter(eligible);
  if (candidates.length === 0) return undefined;
  const latestAt = Math.max(...candidates.map(row => Date.parse(row.createdAt)));
  const latest = candidates.filter(row => Date.parse(row.createdAt) === latestAt);
  if (latest.length !== 1) throw new Error(`intake session ${session.intakeSessionId} cannot select a unique prior manifest at ${new Date(latestAt).toISOString()}: candidates ${latest.map(row => row.manifestId).sort().join(", ")}`);
  return latest[0];
}

/** Timestamp of final execution is not part of the review; every other plan fact is. */
export function intakeReviewBinding(session: IntakeSession, manifest: IntakePlanManifest, prior: IntakePlanManifest | undefined): string {
  return sha256Hex(canonicalJsonStringify({ session, manifest: { ...manifest, createdAt: session.updatedAt }, prior: prior ?? null }));
}
