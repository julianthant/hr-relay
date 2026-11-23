import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { join } from "node:path";
import type { RuntimeAdmission } from "../admission/admission.js";
import { createPrivateDirectory, fsyncPath, replacePrivateFile, writePrivateStage } from "../private-path.js";
import { checkStagedHistory, historyArchivePath, writeHistoryArchive } from "../sqlite/isolated-history-store.js";

/** Publish only after the source verifier and the workbook transaction both finish. */
export async function withStagedHistory<T>(admission: RuntimeAdmission,
  work: (stage: (source: Parameters<typeof writeHistoryArchive>[0], at: string) => void) => Promise<T>) {
  const directory = join(admission.stateRoot, "files");
  const stage = join(directory, `.imported-history-${randomUUID()}.sqlite`);
  let history: ReturnType<typeof writeHistoryArchive> | undefined;
  let created = false;
  try {
    const library = await work((source, at) => {
      historyArchivePath(admission.stateRoot);
      createPrivateDirectory(directory, { recursive: true, mode: 0o700 });
      writePrivateStage(stage, new Uint8Array());
      created = true;
      history = writeHistoryArchive(source, stage, admission.profileBinding, at);
      checkStagedHistory(join(admission.stateRoot, "state.db"), stage, admission.profileBinding);
    });
    if (history === undefined) throw new Error("isolated-history-missing");
    admission.assertExclusive();
    fsyncPath(stage);
    replacePrivateFile(stage, historyArchivePath(admission.stateRoot));
    fsyncPath(directory);
    return { ...library, history };
  } finally { if (created) rmSync(stage, { force: true }); }
}
