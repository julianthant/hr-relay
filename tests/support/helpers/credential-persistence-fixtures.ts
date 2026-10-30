import { z } from "zod";
import assert from "node:assert/strict";
import { once } from "node:events";
import { RuntimeLifetimeLock } from "../../../src/backend/storage/admission/lifetime-lock.js";

import { rebuildRuntimeIsolation } from "../../../src/backend/app/config/runtime-isolation.js";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
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
const cleanups: (() => void | Promise<void>)[] = [];
async function fixture(hooks?: CredentialStoreHooks) {
  const stateRoot = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), "hr-credential-store-")));
  roots.push(stateRoot);
  const lifetime = await RuntimeLifetimeLock.acquire(0);
  const machine = acquireEntrypointAdmission(stateRoot, "shared", lifetime);
  mkdirSync(join(stateRoot, rebuildRuntimeIsolation.processLockRoot), { recursive: true, mode: 0o700 });
  const operation = machine.beginProfileSignUp({ firstName: "Synthetic", lastName: "Persistence", emailKey: "a".repeat(64),
    createdAt: IsoInstantSchema.parse(NOW_1), commandFingerprint: "a".repeat(64) });
  const admission = machine.admitProfile(createProfileRegistry(machine).storageClaim(operation.profileId));
  AuthorityDatabase.initializeProfile(admission);
  registerBoundProfile(admission, machine);
  cleanups.push(async () => { unregisterBoundProfile(admission); admission.release(); machine.release(); await lifetime.close(); });
  const tracker = admission.stateRoot, journalPath = join(machine.stateRoot, "machine", "erasures", `${operation.profileId}.json`);
  const options = { admission, stateRoot: tracker, erasureJournalAdmission: machine, erasureJournalPath: journalPath,
    initializationInventory: composeProfileCredentialInitializationInventory({ machine, admission, clock: systemClock, hostFacts: { primaryDisplay: null } }) };
  createCredentialStore(options).migrateHistory({ operation });
  const store = createCredentialStore({ ...options, hooks });
  return { stateRoot, lifetime, tracker, admission, machine, operation, journalPath,
    directory: join(tracker, "credentials"), path: join(tracker, "credentials", "protected.json"),
    lockPath: join(tracker, "credentials", ".protected.lock"), store };
}
async function registeredFixture(hooks?: CredentialStoreHooks) {
  const f = await createBoundProfileFixture();
  const journalPath = join(f.machine.stateRoot, "machine", "erasures", `${f.admission.profileBinding.profileId}.json`);
  const ordinary = createCredentialStore({ admission: f.admission, stateRoot: f.stateRoot, erasureJournalAdmission: f.machine, erasureJournalPath: journalPath, hooks,
    repairInventory: composeProfileCredentialRepairInventory({ machine: f.machine, admission: f.admission, clock: systemClock, hostFacts: { primaryDisplay: null } }) });
  let settlement: ReturnType<typeof f.machine.admitProfile> | undefined;
  let retained: ReturnType<typeof createCredentialStore> | undefined;
  let operation: ReturnType<typeof LogoutOperationSchema.parse> | undefined;
  let exactErase: CredentialEraseInput | undefined;
  cleanups.push(async () => { settlement?.release(); await f.close(); });
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
async function releaseFixtures(): Promise<void> {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
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

async function crashAtCredentialRename(stateRoot: string, input: ProtectedSettingsApplyInput, boundary: "before" | "after") {
  const owner = findProfileFixtureAdmission(stateRoot);
  const workspace = owner?.readInstallationContext()?.workspace;
  const lifetime = owner?.lifetime;
  if (workspace === undefined || !(lifetime instanceof RuntimeLifetimeLock)) throw new Error("fixture-issued-profile-workspace-required");
  const rootUrl = pathToFileURL(join(process.cwd(), "src", "backend")).href;
  const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", `
    import { readFileSync } from "node:fs";
    import { join } from "node:path";
    import { acquireSharedRuntimeAdmission } from ${JSON.stringify(rootUrl + "/storage/admission/admission.ts")};
    import { WorkerRuntimeLifetimeLock } from ${JSON.stringify(rootUrl + "/storage/admission/lifetime-lock.ts")};
    import { createProfileRegistry } from ${JSON.stringify(rootUrl + "/profiles/registry.ts")};
    import { createCredentialStore } from ${JSON.stringify(rootUrl + "/storage/configuration/credential-store.ts")};
    const lifetime = await WorkerRuntimeLifetimeLock.receive(Number(process.argv[1]), () => process.exit(1));
    const input = JSON.parse(readFileSync(0, "utf8"));
    const machine = acquireSharedRuntimeAdmission(input.workspace, lifetime);
    const profileId = input.stateRoot.split("/").at(-1);
    const child = machine.admitProfile(createProfileRegistry(machine).storageClaim(profileId));
    try {
      createCredentialStore({ admission: child, stateRoot: child.stateRoot, erasureJournalAdmission: machine,
        erasureJournalPath: join(machine.stateRoot, "machine", "erasures", profileId + ".json"),
        hooks: { [input.boundary === "before" ? "beforeRename" : "afterRename"]: () => process.kill(process.pid, "SIGKILL") }
      }).apply(input.request);
    } finally { child.release(); machine.release(); await lifetime.close(); process.disconnect(); }
  `, String(lifetime.port)], { stdio: ["pipe", "pipe", "pipe", "ipc"] });
  assert.ok(child.stdin && child.stdout && child.stderr);
  let stdout = "", stderr = "", inputFailure: Error | undefined;
  child.stdin.on("error", (error: Error) => { inputFailure ??= error; });
  child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => { stdout += chunk; });
  child.stderr.on("data", (chunk: string) => { stderr += chunk; });
  const closed = once(child, "close");
  try {
    child.stdin.end(JSON.stringify({ stateRoot, workspace, request: input, boundary }));
    await lifetime.share(child);
    const [status, signal] = z.tuple([z.number().int().nullable(), z.string().nullable()]).parse(await closed);
    if (inputFailure !== undefined) throw inputFailure;
    return { status, signal, stdout, stderr, error: undefined };
  } catch (error) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    try { await closed; } catch (cleanup) { throw new AggregateError([error, cleanup], "credential crash fixture and owned child closure failed", { cause: cleanup }); }
    throw error;
  }
}
function crashAfterCredentialRename(stateRoot: string, input: ProtectedSettingsApplyInput) { return crashAtCredentialRename(stateRoot, input, "after"); }
function crashBeforeCredentialRename(stateRoot: string, input: ProtectedSettingsApplyInput) { return crashAtCredentialRename(stateRoot, input, "before"); }
return { fixture, registeredFixture, releaseFixtures, request, crashAfterCredentialRename, crashBeforeCredentialRename };
}
