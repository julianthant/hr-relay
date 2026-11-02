import { join } from "node:path";
import { ConfigSnapshotRecordSchema } from "../../../../models/config/snapshot.js";
import type { Clock } from "../../../../rules/time/clock.js";
import type { ContentAddressedArtifactWriter } from "../../../../workflow-kit/artifacts.js";
import { requireRuntimeAdmission } from "../../../storage/admission/admission-identity.js";
import type { RuntimeAdmission } from "../../../storage/admission/admission.js";
import { createArtifactSinkProjector, type ArtifactSinkProjector } from "../../../storage/artifacts/artifact-sink-projector.js";
import { createNamedFileOutputSink } from "../../../storage/artifacts/named-file-output-sink.js";
import { hasUnprovedSourceClosure, retainUnprovedSourceOwners } from "../../../storage/source-closure.js";
import type { AuthorityDatabase } from "../../../storage/sqlite/authority-database.js";

export function composeWorkerArtifactProjector(input: Readonly<{
  admission: RuntimeAdmission; database: AuthorityDatabase; artifacts: ContentAddressedArtifactWriter; clock: Clock;
}>): ArtifactSinkProjector {
  const admission = requireRuntimeAdmission(input.admission), { database } = input;
  const assertCurrent = () => admission.assertProfileRuntime();
  assertCurrent();
  const projector = createArtifactSinkProjector({ authority: database.authority, clock: input.clock, assertCurrent,
    withAuthorityTransaction: work => database.withAuthorityTransaction(work),
    lockDir: join(admission.stateRoot, "scratch", "artifact-sinks"),
    sinks: { "documents-file": createNamedFileOutputSink({ artifacts: input.artifacts, documentsDirectory(row) {
      assertCurrent();
      const run = database.authority.runs.get(row.sourceRunId);
      if (run === undefined) throw new Error("named-file-output-run-unavailable");
      const snapshot = ConfigSnapshotRecordSchema.parse(database.authority.configSnapshots.get(run.envelope.configSnapshotId));
      if (snapshot.configSnapshotId !== run.envelope.configSnapshotId || snapshot.fingerprint !== run.envelope.configFingerprint) throw new Error("named-file-output-config-snapshot-mismatch");
      return snapshot.config.paths.onboardingDocsDir;
    } }) },
  });
  return Object.freeze({ async projectOutbox(ids: readonly string[]) {
    try { return await projector.projectOutbox(ids); }
    catch (error) {
      if (hasUnprovedSourceClosure(error)) { admission.retainSourceClosure(error); retainUnprovedSourceOwners(error, { admission }); }
      throw error;
    }
  } });
}
