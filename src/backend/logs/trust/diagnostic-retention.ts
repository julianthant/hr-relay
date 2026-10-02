import { lifecycleCommandId } from "../../../domain/identifiers.js";
import { CanonicalRunPurgeOutcomeSchema } from "../../storage/sqlite/run-store-contracts.js";
/**
 * Ref operator-trust §2.2's retention/pin sweep.
 *
 * "Ordinary bundles follow notes retention unless pinned by an active
 * knowledge/fix record or a write-recovery case" is modelled entirely inside
 * the bundle's own `retention` field, which is why this sweep needs no
 * cross-table join to be correct: a pin is a fact recorded at capture (or by an
 * explicit later re-capture), not a reference the sweep re-derives and could
 * get wrong. A pinned bundle is structurally unreachable from the due query and
 * throws if named directly.
 *
 * The artifacts an attachment points at are deliberately NOT deleted. They are
 * content-addressed and shared by digest, so a second bundle — or a receipt, or
 * a scenario fixture — may still reference exactly those bytes. The sweep
 * reports the now-unreferenced artifact ids; reclaiming them is an
 * artifact-store decision (a reference count the store does not keep today),
 * and inventing it here would be the kind of silent deletion ref operator-trust §10 warns
 * about.
 */
import { z } from "zod";
import type { Clock } from "../../../domain/clock.js";
import { ArtifactIdSchema, DiagnosticBundleIdSchema, IsoInstantSchema } from "../../../domain/ids.js";
import { planDiagnosticSweep } from "../../../domain/trust/diagnostic-capture.js";
import type { AuthorityRepositories } from "../../storage/sqlite/authority-database.js";

export const DiagnosticSweepReportSchema = z.strictObject({
  sweptAt: IsoInstantSchema,
  purged: z.array(DiagnosticBundleIdSchema),
  /** Artifact ids whose last diagnostic reference was just purged. */
  unreferencedArtifacts: z.array(ArtifactIdSchema),
  /** A bundle that was due at query time and gone by purge time; not an error. */
  vanished: z.array(DiagnosticBundleIdSchema),
});
export type DiagnosticSweepReport = z.infer<typeof DiagnosticSweepReportSchema>;

export interface DiagnosticRetentionSweep {
  sweep(): DiagnosticSweepReport;
}

export interface DiagnosticRetentionSweepDependencies {
  readonly authority: Pick<AuthorityRepositories, "diagnosticBundles">;
  readonly clock: Clock;
  readonly lifecycle: { purge(input: unknown): unknown };
}

export function createDiagnosticRetentionSweep(
  dependencies: DiagnosticRetentionSweepDependencies,
): DiagnosticRetentionSweep {
  const repository = dependencies.authority.diagnosticBundles;
  return Object.freeze({
    sweep: (): DiagnosticSweepReport => {
      const sweptAt = IsoInstantSchema.parse(dependencies.clock.now().toISOString());
      const due = repository.listRetentionDue(sweptAt);
      // The domain planner re-decides every candidate against the same instant.
      // The index answered "ordinary and expired"; this re-derivation is what a
      // test pins, and a disagreement between the two is a loud failure below.
      const dispositions = planDiagnosticSweep({ now: sweptAt, bundles: due });
      const purged: string[] = [];
      const vanished: string[] = [];
      const unreferenced = new Set<string>();
      for (const disposition of dispositions) {
        if (disposition.state !== "purge") {
          throw new Error(`diagnostic bundle ${disposition.bundleId} was indexed as due but plans to ${disposition.state}`);
        }
        const attachments = repository.listAttachments(disposition.bundleId);
        const outcome = CanonicalRunPurgeOutcomeSchema.parse(dependencies.lifecycle.purge({ commandId: lifecycleCommandId("diagnostic-retention", { bundleId: disposition.bundleId, sweptAt }),
          bundleId: disposition.bundleId, evidenceClass: "diagnostic-bundle" }));
        if (outcome.state === "refused") throw new Error(`retention refused: ${outcome.refusal.reason}`);
        if (outcome.purged === 0) {
          vanished.push(disposition.bundleId);
          continue;
        }
        purged.push(disposition.bundleId);
        for (const { attachment } of attachments) {
          if (repository.findByArtifact(attachment.artifactId).length === 0) {
            unreferenced.add(attachment.artifactId);
          }
        }
      }
      return DiagnosticSweepReportSchema.parse({
        sweptAt,
        purged,
        unreferencedArtifacts: [...unreferenced].sort(),
        vanished,
      });
    },
  });
}
