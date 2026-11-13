import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { profileBrowserClosure } from "../../../../src/backend/runtime/browser/profile-browser-closure.js";
import { reconcileStoppedLogout } from "../../../../src/backend/runs/lifecycle/startup-crash-recovery.js";
import type { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH, ProtectedSettingsApplyInputSchema } from "../../../../src/models/config/protected-settings.js";
import { LogoutOperationSchema } from "../../../../src/models/profiles/profile.js";
import { systemClock } from "../../../../src/rules/time/clock.js";
import { createCredentialStore, createSyntheticProfileSession, finishProfileOnboarding } from "../admission-fixture.js";
import { registerBoundProfile, unregisterBoundProfile } from "../synthetic-database-admission.js";
import { runtimeLifetimeLock } from "./runtime-lifetime.js";

type Session = ReturnType<typeof createSyntheticProfileSession>;
type SessionInput = Omit<Parameters<typeof createSyntheticProfileSession>[0], "admission" | "machineRoot">;

/** One temp installation with real profile sessions whose logout settles through a real native source owner. */
export async function createProfileSessionWorld() {
  const root = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), "hr-profiles-")));
  const lifetime = await runtimeLifetimeLock();
  const machine = acquireEntrypointAdmission(root, "shared", lifetime);
  function credentialsFor(owner: RuntimeAdmission) {
    // The registry only lets this lookup return the owner's store. The caller keeps that store and may release the owner.
    registerBoundProfile(owner, machine);
    try {
      return createCredentialStore({ stateRoot: owner.stateRoot });
    } finally {
      unregisterBoundProfile(owner);
    }
  }
  mkdirSync(join(root, rebuildRuntimeIsolation.processLockRoot), { recursive: true, mode: 0o700 });
  const machineRoot = machine.stateRoot;
  const sessions = new Set<Session>();
  const settlers = new WeakMap<Session, (operationId: string) => Promise<void>>();

  function open(input: SessionInput = {}): Session {
    const databases = new Map<string, AuthorityDatabase>(), completed = new Map<string, { profileId: string; epoch: number }>();
    const session = createSyntheticProfileSession({ ...input, machineRoot, admission: machine,
      prepareLogout(profileId, owner) {
        let database = databases.get(profileId);
        if (database === undefined) {
          database = AuthorityDatabase.open(owner, { path: join(owner.stateRoot, "state.db"), busyTimeoutMs: 1000, migrationOwner: "profile-session-world" },
            input.clock ?? systemClock, undefined, undefined, undefined, credentialsFor(owner));
          databases.set(profileId, database);
        }
        return { source: database.capturePendingLogoutSource(), intentFailed(error): never { throw error; } };
      },
      prepareLogoutContinuation() {},
      completedLogout: operationId => completed.get(operationId),
      closeStorage(profileId) { databases.get(profileId)?.close(); databases.delete(profileId); },
      activity: input.activity ?? { hasUnquiescedWork: () => false },
    });
    settlers.set(session, async operationId => {
      const operation = LogoutOperationSchema.parse(JSON.parse(readFileSync(join(machineRoot, "machine", "operations", `${operationId}.json`), "utf8")));
      const database = databases.get(operation.profileId);
      if (database === undefined) throw new Error("profile-session-world logout native source missing");
      const stopped = await database.settlePendingLogout(machine, operation, { browserClosure: profileBrowserClosure, recover: reconcileStoppedLogout });
      await stopped.complete();
      completed.set(operationId, { profileId: operation.profileId, epoch: operation.sessionGeneration + 1 });
      stopped.dispose();
    });
    sessions.add(session);
    return session;
  }

  async function logOut(session: Session, token: string, at: string) {
    const result = session.logOut(token, { at });
    if (result.state !== "cancelling" || result.operationId === undefined) return result;
    const settle = settlers.get(session);
    if (settle === undefined) throw new Error("profile-session-world logout owner missing");
    await settle(result.operationId);
    return session.resumeLogout(result.operationId);
  }

  async function signUp(session: Session, fields: { firstName: string; lastName: string; email: string; password: string; createdAt: string }) {
    const active = await finishProfileOnboarding(session, session.signUp(fields));
    if (active.state !== "active") throw new Error(`profile-session-world sign-up ${active.state}`);
    return active;
  }

  /** The signed-in profile's saved UCPath sign-in, read through its own credential store. */
  function savedLogin(profileId: string): { userId: string | undefined; password: string | undefined } {
    const owner: RuntimeAdmission = machine.admitProfile(profileId);
    try {
      const entries = credentialsFor(owner).read().entries;
      return { userId: entries.ucpathUserId?.value, password: entries.ucpathPassword?.value };
    } finally { owner.release(); }
  }

  /** Save protected entries the way a Settings edit does: an ordinary protected apply with its own command id. */
  function saveInSettings(profileId: string, entries: Partial<Record<"ucpathUserId" | "ucpathPassword" | "sharepointOnboardingRosterUrl", { set: string } | { clear: true }>>): void {
    const owner: RuntimeAdmission = machine.admitProfile(profileId);
    try {
      const store = credentialsFor(owner);
      const applied = store.apply(ProtectedSettingsApplyInputSchema.parse({ commandId: randomUUID(), commandFingerprint: "b".repeat(64), expectedRevision: store.read().revision,
        protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH, writeId: randomUUID(), updatedAt: "2026-09-06T12:30:00.000Z", entries }));
      if (applied.state !== "applied") throw new Error(`profile-session-world settings apply ${applied.state}`);
    } finally { owner.release(); }
  }

  /** Every credential file of a profile, as bytes, so a signed-out profile can be proved untouched without opening it. */
  function credentialBytes(profileId: string): Record<string, string> {
    const directory = join(machineRoot, "profiles", profileId, "credentials");
    const files: [string, string][] = readdirSync(directory).sort().map(name => [name, readFileSync(join(directory, name), "base64")]);
    return Object.fromEntries([...files, ["key-head", readFileSync(join(machineRoot, "machine", "credential-keys", `${profileId}.json`), "base64")]]);
  }

  function verifierBytes(): string { return readFileSync(join(machineRoot, "machine", "profile-verifiers.json"), "utf8"); }

  async function close(): Promise<void> {
    try { for (const session of sessions) await session.close(); }
    finally { sessions.clear(); machine.release(); rmSync(root, { recursive: true, force: true }); }
  }

  return { machine, machineRoot, open, logOut, signUp, savedLogin, saveInSettings, credentialBytes, verifierBytes, close };
}
