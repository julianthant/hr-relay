
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync } from "node:fs";

import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";


import { PROTECTED_SETTINGS_SCHEMA_HASH, ProtectedSettingsApplyInputSchema, type ProtectedSettingsApplyInput, type ProtectedSettingsPatch } from "../../../src/models/config/protected-settings.js";
import { createCredentialStore, type CredentialStoreHooks } from "./synthetic-storage-admission.js";

export function createCredentialPersistenceFixtures(roots: string[], COMMAND_1: string, NOW_1: string) {
function fixture(hooks?: CredentialStoreHooks) {
  const stateRoot = mkdtempSync(join(realpathSync(tmpdir()), "hr-credential-store-"));
  roots.push(stateRoot);
  const tracker = join(stateRoot, ".tracker");
  mkdirSync(tracker, { mode: 0o755 });
  chmodSync(tracker, 0o755);
  const store = createCredentialStore({ stateRoot: tracker, hooks });
  return {
    stateRoot,
    tracker,
    directory: join(tracker, "credentials"),
    path: join(tracker, "credentials", "protected.json"),
    lockPath: join(tracker, "credentials", ".protected.lock"),
    store,
  };
}

function request(input: {
  readonly commandId: string;
  readonly writeId: string;
  readonly expectedRevision: number;
  readonly entries: ProtectedSettingsPatch;
  readonly updatedAt?: string;
}): ProtectedSettingsApplyInput {
  return ProtectedSettingsApplyInputSchema.parse({
    commandId: input.commandId,
    commandFingerprint: input.commandId === COMMAND_1 ? "1".repeat(64) : "2".repeat(64),
    expectedRevision: input.expectedRevision,
    protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH,
    writeId: input.writeId,
    entries: input.entries,
    updatedAt: input.updatedAt ?? NOW_1,
  });
}

function crashAfterCredentialRename(stateRoot: string, input: ProtectedSettingsApplyInput) {
  const moduleUrl = pathToFileURL(join(
    process.cwd(),
    "tests",
    "support",
    "helpers",
    "synthetic-storage-admission.ts",
  )).href;
  return spawnSync(process.execPath, [
    "--import",
    "tsx",
    "--input-type=module",
    "--eval",
    `import { createCredentialStore } from ${JSON.stringify(moduleUrl)};
     createCredentialStore({
       stateRoot: ${JSON.stringify(stateRoot)},
       hooks: { afterRename: () => process.kill(process.pid, "SIGKILL") },
     }).apply(${JSON.stringify(input)});`,
  ], { encoding: "utf8" });
}

function crashBeforeCredentialRename(stateRoot: string, input: ProtectedSettingsApplyInput) {
  const moduleUrl = pathToFileURL(join(
    process.cwd(),
    "tests",
    "support",
    "helpers",
    "synthetic-storage-admission.ts",
  )).href;
  return spawnSync(process.execPath, [
    "--import",
    "tsx",
    "--input-type=module",
    "--eval",
    `import { createCredentialStore } from ${JSON.stringify(moduleUrl)};
     createCredentialStore({
       stateRoot: ${JSON.stringify(stateRoot)},
       hooks: { beforeRename: () => process.kill(process.pid, "SIGKILL") },
     }).apply(${JSON.stringify(input)});`,
  ], { encoding: "utf8" });
}
return { fixture, request, crashAfterCredentialRename, crashBeforeCredentialRename };
}
