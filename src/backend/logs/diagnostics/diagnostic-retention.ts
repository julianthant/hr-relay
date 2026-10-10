import { lifecycleCommandId } from "../../../rules/identity/identifiers.js";
import { CanonicalRunPurgeOutcomeSchema } from "../../storage/sqlite/run-store-contracts.js";

import { z } from "zod";
import type { Clock } from "../../../rules/time/clock.js";
import { ArtifactIdSchema, DiagnosticBundleIdSchema, IsoInstantSchema } from "../../../rules/identity/ids.js";
import { planDiagnosticSweep } from "../../../models/trust/diagnostic-capture.js";
import type { AuthorityRepositories } from "../../storage/sqlite/authority-database.js";

export const DiagnosticSweepReportSchema = z.strictObject({
  sweptAt: IsoInstantSchema,
  purged: z.array(DiagnosticBundleIdSchema),

  unreferencedArtifacts: z.array(ArtifactIdSchema),

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
      // Re-evaluate retention at the same instant before purging indexed candidates.
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
