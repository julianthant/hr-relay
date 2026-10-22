
import { rebuildRuntimeIsolation } from "../../../src/backend/app/config/runtime-isolation.js";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync } from "node:fs";

import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";


import { PROTECTED_SETTINGS_SCHEMA_HASH, ProtectedSettingsApplyInputSchema, type ProtectedSettingsApplyInput, type ProtectedSettingsPatch } from "../../../src/models/config/protected-settings.js";
import { createCredentialStore, readForErasure, type CredentialStoreHooks } from "../../../src/backend/storage/configuration/credential-store.js";
import { acquireEntrypointAdmission } from "../../../src/backend/storage/admission/bootstrap-admission.js";
import { AuthorityDatabase } from "../../../src/backend/storage/sqlite/authority-database.js";
import { createProfileRegistry } from "../../../src/backend/profiles/registry.js";
import { composeProfileCredentialRepairInventory, composeProfileCredentialInitializationInventory } from "../../../src/backend/app/composition/profile-credential-inventory.js";
import { createBoundProfileFixture, findProfileFixtureAdmission, registerBoundProfile, unregisterBoundProfile } from "./admission-fixture.js";
import { CredentialEraseInputSchema, type CredentialEraseInput } from "../../../src/models/config/credential-store.js";
import { LogoutOperationSchema } from "../../../src/models/profiles/profile.js";
import { IsoInstantSchema } from "../../../src/rules/identity/ids.js";
import { systemClock } from "../../../src/rules/time/clock.js";

export function createCredentialPersistenceFixtures(roots: string[], COMMAND_1: string, NOW_1: string) {
const cleanups: (() => void)[] = [];
function fixture(hooks?: CredentialStoreHooks) {
  const stateRoot = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), "hr-credential-store-")));
  roots.push(stateRoot);
  const machine = acquireEntrypointAdmission(stateRoot, "shared");
  mkdirSync(join(stateRoot, rebuildRuntimeIsolation.processLockRoot), { recursive: true, mode: 0o700 });
  const operation = machine.beginProfileSignUp({ firstName: "Synthetic", lastName: "Persistence", emailKey: "a".repeat(64),
    createdAt: IsoInstantSchema.parse(NOW_1), commandFingerprint: "a".repeat(64) });
  const admission = machine.admitProfile(createProfileRegistry(machine).storageClaim(operation.profileId));
  AuthorityDatabase.initializeProfile(admission);
  registerBoundProfile(admission, machine);
  cleanups.push(() => { unregisterBoundProfile(admission); admission.release(); machine.release(); });
  const tracker = admission.stateRoot, journalPath = join(machine.stateRoot, "machine", "erasures", `${operation.profileId}.json`);
  const options = { admission, stateRoot: tracker, erasureJournalAdmission: machine, erasureJournalPath: journalPath,
    initializationInventory: composeProfileCredentialInitializationInventory({ machine, admission, clock: systemClock, hostFacts: { primaryDisplay: null } }) };
  createCredentialStore(options).migrateHistory({ operation });
  const store = createCredentialStore({ ...options, hooks });
  return { stateRoot, tracker, admission, machine, operation, journalPath,
    directory: join(tracker, "credentials"), path: join(tracker, "credentials", "protected.json"),
    lockPath: join(tracker, "credentials", ".protected.lock"), store };
}
function registeredFixture(hooks?: CredentialStoreHooks) {
  const f = createBoundProfileFixture();
  const journalPath = join(f.machine.stateRoot, "machine", "erasures", `${f.admission.profileBinding.profileId}.json`);
  const ordinary = createCredentialStore({ admission: f.admission, stateRoot: f.stateRoot, erasureJournalAdmission: f.machine, erasureJournalPath: journalPath, hooks,
    repairInventory: composeProfileCredentialRepairInventory({ machine: f.machine, admission: f.admission, clock: systemClock, hostFacts: { primaryDisplay: null } }) });
  let settlement: ReturnType<typeof f.machine.admitProfile> | undefined;
  let retained: ReturnType<typeof createCredentialStore> | undefined;
  let operation: ReturnType<typeof LogoutOperationSchema.parse> | undefined;
  let exactErase: CredentialEraseInput | undefined;
  cleanups.push(() => { settlement?.release(); f.close(); });
  return { stateRoot: f.workspace, tracker: f.stateRoot, admission: f.admission, machine: f.machine, journalPath,
    directory: join(f.stateRoot, "credentials"), path: join(f.stateRoot, "credentials", "protected.json"),
    lockPath: join(f.stateRoot, "credentials", ".protected.lock"), store: ordinary,
    erase(input: CredentialEraseInput) {
      const request = CredentialEraseInputSchema.parse(input);
      exactErase ??= request;
      if (retained === undefined) {
        const registry = createProfileRegistry(f.machine);
        operation = LogoutOperationSchema.parse({ schemaVersion: 1, kind: "logout", operationId: randomUUID(), profileId: f.admission.profileBinding.profileId,
          at: request.updatedAt, phase: "erasing", commandId: request.commandId, writeId: request.writeId, expectedRevision: request.expectedRevision });
        f.machine.publishProfileOperation(operation);
        registry.advanceSession(null); registry.update(operation.profileId, { lifecycle: "cancelling" });
        settlement = f.machine.admitProfile(registry.settlementClaim(operation.operationId));
        retained = createCredentialStore({ admission: settlement, stateRoot: f.stateRoot, erasureJournalAdmission: f.machine, erasureJournalPath: journalPath, hooks,
          repairInventory: composeProfileCredentialRepairInventory({ machine: f.machine, admission: settlement, clock: systemClock, hostFacts: { primaryDisplay: null } }) });
      }
      return retained.erase(request);
    },
    recoverErasure() {
      if (retained === undefined || exactErase === undefined) throw new Error("fixture-exact-erasure-required");
      return retained.erase(exactErase);
    },
    readErasure() {
      if (retained === undefined || operation === undefined) throw new Error("fixture-exact-erasure-required");
      return readForErasure(retained, operation.operationId);
    },
    retryErasure(input: CredentialEraseInput) {
      if (retained === undefined) throw new Error("fixture-exact-erasure-required");
      return retained.erase(input);
    },
  };
}
function releaseFixtures(): void {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
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

function crashAtCredentialRename(stateRoot: string, input: ProtectedSettingsApplyInput, boundary: "before" | "after") {
  const workspace = findProfileFixtureAdmission(stateRoot)?.readInstallationContext()?.workspace;
  if (workspace === undefined) throw new Error("fixture-issued-profile-workspace-required");
  const rootUrl = pathToFileURL(join(process.cwd(), "src", "backend")).href;
  return spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", `
    import { readFileSync } from "node:fs";
    import { join } from "node:path";
    import { acquireEntrypointAdmission } from ${JSON.stringify(rootUrl + "/storage/admission/bootstrap-admission.ts")};
    import { createProfileRegistry } from ${JSON.stringify(rootUrl + "/profiles/registry.ts")};
    import { createCredentialStore } from ${JSON.stringify(rootUrl + "/storage/configuration/credential-store.ts")};
    const input = JSON.parse(readFileSync(0, "utf8"));
    const machine = acquireEntrypointAdmission(input.workspace, "shared");
    const profileId = input.stateRoot.split("/").at(-1);
    const child = machine.admitProfile(createProfileRegistry(machine).storageClaim(profileId));
    try {
      createCredentialStore({ admission: child, stateRoot: child.stateRoot, erasureJournalAdmission: machine,
        erasureJournalPath: join(machine.stateRoot, "machine", "erasures", profileId + ".json"),
        hooks: { [input.boundary === "before" ? "beforeRename" : "afterRename"]: () => process.kill(process.pid, "SIGKILL") }
      }).apply(input.request);
    } finally { child.release(); machine.release(); }
  `], { encoding: "utf8", input: JSON.stringify({ stateRoot, workspace, request: input, boundary }) });
}
function crashAfterCredentialRename(stateRoot: string, input: ProtectedSettingsApplyInput) { return crashAtCredentialRename(stateRoot, input, "after"); }
function crashBeforeCredentialRename(stateRoot: string, input: ProtectedSettingsApplyInput) { return crashAtCredentialRename(stateRoot, input, "before"); }
return { fixture, registeredFixture, releaseFixtures, request, crashAfterCredentialRename, crashBeforeCredentialRename };
}
