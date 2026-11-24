import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { applicationDataWorkspace, rebuildRuntimeIsolation } from "../../app/config/runtime-isolation.js";
import { runtimeProfiles } from "../../../models/config/define-runtime-isolation.js";
import type { IsoInstant } from "../../../rules/identity/ids.js";
import type { RuntimeAdmission } from "../admission/admission.js";
import { RuntimeLifetimeLock } from "../admission/lifetime-lock.js";
import { createPrivateDirectory, fsyncPath, replacePrivateFile, writePrivateStage } from "../private-path.js";
import { checkStagedHistory, cloneHistoryArchive, historyArchivePath, writeCopyHistorySeed, writeHistoryArchive, type CopyHistorySeed } from "../sqlite/isolated-history-store.js";
import { withAuthorityDatabaseReadOnly } from "../sqlite/readonly-authority-snapshot.js";

function stageHistory(admission: RuntimeAdmission) {
  const directory = join(admission.stateRoot, "files"), path = historyArchivePath(admission.stateRoot);
  const stage = join(directory, `.imported-history-${randomUUID()}.sqlite`);
  const local = join(admission.stateRoot, "state.db"), binding = admission.profileBinding;
  createPrivateDirectory(directory, { recursive: true, mode: 0o700 });
  writePrivateStage(stage, new Uint8Array());
  return { stage, path, local, binding,
    validate() { checkStagedHistory(local, stage, binding); },
    publish() {
      admission.assertExclusive();
      fsyncPath(stage);
      replacePrivateFile(stage, historyArchivePath(admission.stateRoot));
      fsyncPath(directory);
    },
    close() { rmSync(stage, { force: true }); },
  };
}

/** Publish only after the source verifier and the workbook transaction both finish. */
export async function withStagedHistory<T>(admission: RuntimeAdmission,
  work: (stage: (source: Parameters<typeof writeHistoryArchive>[0], at: IsoInstant) => void) => Promise<T>) {
  let staging: ReturnType<typeof stageHistory> | undefined;
  let history: ReturnType<typeof writeHistoryArchive> | undefined;
  try {
    const library = await work((source, at) => {
      if (staging !== undefined) throw new Error("isolated-history-already-staged");
      staging = stageHistory(admission);
      history = writeHistoryArchive(source, staging.stage, staging.binding, at);
      staging.validate();
    });
    if (history === undefined || staging === undefined) throw new Error("isolated-history-missing");
    staging.publish();
    return { ...library, history };
  } finally { staging?.close(); }
}

/** The selected copy owns the staged archive. Its native authority is a read source only. */
export async function seedIsolatedHistory(admission: RuntimeAdmission, profile: "development" | "staging", seed: CopyHistorySeed) {
  if (profile !== "development" && profile !== "staging") throw new Error("copy-seed-destination-refused");
  admission.assertExclusive();
  admission.assertProfileRuntime();
  const workspace = applicationDataWorkspace(undefined, profile), lifetime = admission.lifetime;
  if (!(lifetime instanceof RuntimeLifetimeLock) || lifetime.port !== runtimeProfiles[profile].lockPort
    || admission.readInstallationContext()?.workspace !== workspace
    || admission.stateRoot !== join(workspace, rebuildRuntimeIsolation.stateRoot, "profiles", admission.profileBinding.profileId)) {
    throw new Error("copy-seed-destination-refused");
  }
  lifetime.assertWorkspace(workspace);
  const staging = stageHistory(admission);
  try {
    const cloned = await cloneHistoryArchive(staging.path, staging.stage);
    if (cloned) staging.validate();
    const result = withAuthorityDatabaseReadOnly(admission, staging.local,
      local => writeCopyHistorySeed(local, staging.stage, staging.binding, cloned, seed));
    staging.validate();
    admission.assertProfileRuntime();
    staging.publish();
    return result;
  } finally { staging.close(); }
}
