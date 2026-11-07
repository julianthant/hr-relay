import { join } from "node:path";
import { ConfigSnapshotRecordSchema } from "../../../../models/config/snapshot.js";
import type { Clock } from "../../../../rules/time/clock.js";
import type { ContentAddressedArtifactWriter } from "../../../../workflow-kit/artifacts.js";
import { requireRuntimeAdmission } from "../../../storage/admission/admission-identity.js";
import type { RuntimeAdmission } from "../../../storage/admission/admission.js";
import { createArtifactSinkProjector, type ArtifactSinkProjector } from "../../../storage/artifacts/artifact-sink-projector.js";
import { createNamedFileOutputSink } from "../../../storage/artifacts/named-file-output-sink.js";
import { fixedLayoutOutputPath,readFixedLayoutIntent } from "../../../storage/maintenance/fixed-layout.js";
import { hasUnprovedSourceClosure, retainUnprovedSourceOwners } from "../../../storage/source-closure.js";
import type { AuthorityDatabase } from "../../../storage/sqlite/authority-database.js";
import type { ArtifactOutboxStorageRecord } from "../../../storage/sqlite/storage-records.js";
import { createXlsxRetentionSink } from "../../../storage/artifacts/xlsx-retention-sink.js";
import { i9CheckTrackerTable } from "../../../../rules/i9-check/workbook.js";

export function composeWorkerArtifactProjector(input: Readonly<{
  admission: RuntimeAdmission; database: AuthorityDatabase; artifacts: ContentAddressedArtifactWriter; clock: Clock;
}>): ArtifactSinkProjector {
  const admission = requireRuntimeAdmission(input.admission), { database } = input;
  const assertCurrent = () => admission.assertProfileRuntime();
  assertCurrent();
  const outputPath = (row: ArtifactOutboxStorageRecord, key: "onboardingDocsDir" | "i9CheckTrackerPath") => {
    assertCurrent();
    const run = database.authority.runs.get(row.sourceRunId);
    if (run === undefined) throw new Error("named-file-output-run-unavailable");
    const snapshot = ConfigSnapshotRecordSchema.parse(database.authority.configSnapshots.get(run.envelope.configSnapshotId));
    if (snapshot.configSnapshotId !== run.envelope.configSnapshotId || snapshot.fingerprint !== run.envelope.configFingerprint) throw new Error("named-file-output-config-snapshot-mismatch");
    if (snapshot.config.paths.stateRoot === admission.stateRoot) return snapshot.config.paths[key];
    const context = admission.readInstallationContext();
    if (context === undefined) throw new Error("named-file-output-installation-unavailable");
    const layout = readFixedLayoutIntent(context.workspace), binding = admission.profileBinding;
    const profile = layout?.profiles.find(row => row.profileId === binding.profileId);
    if (layout?.phase !== "complete" || layout.installationId !== binding.installationId
      || profile?.sourceRoot !== snapshot.config.paths.stateRoot || profile.authorityPath !== join(admission.stateRoot, "state.db")
      || snapshot.config.paths.artifactRoot !== join(profile.sourceRoot, "artifacts")) throw new Error("named-file-output-layout-binding-mismatch");
    assertCurrent();
    return fixedLayoutOutputPath(snapshot.config.paths[key], profile.sourceRoot, admission.stateRoot);
  };
  const projector = createArtifactSinkProjector({ authority: database.authority, clock: input.clock, assertCurrent,
    withAuthorityTransaction: work => database.withAuthorityTransaction(work),
    lockDir: join(admission.stateRoot, "scratch", "artifact-sinks"),
    sinks: {
      "documents-file": createNamedFileOutputSink({ artifacts: input.artifacts, documentsDirectory: row => outputPath(row, "onboardingDocsDir") }),
      "xlsx-retention": createXlsxRetentionSink({ artifacts: input.artifacts, workbookPath: row => outputPath(row, "i9CheckTrackerPath"), view: i9CheckTrackerTable }),
    },
  });
  return Object.freeze({ async projectOutbox(ids: readonly string[]) {
    try { return await projector.projectOutbox(ids); }
    catch (error) {
      if (hasUnprovedSourceClosure(error)) { admission.retainSourceClosure(error); retainUnprovedSourceOwners(error, { admission }); }
      throw error;
    }
  } });
}
