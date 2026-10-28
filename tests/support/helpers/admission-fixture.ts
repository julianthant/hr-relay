import { credentialKeyCustody } from "../../../src/backend/storage/configuration/credential-key-custody.js";
import type { ProfileOnboardingDuoProvider } from "../../../src/backend/profiles/onboarding-duo.js";
import { registerBoundProfile, unregisterBoundProfile, assertBoundFixtureWorkersReleased, createBoundProfileCredentialStore, boundProfileCredentials, findProfileFixtureAdmission } from "./synthetic-database-admission.js";
export { registerBoundProfile, unregisterBoundProfile, createBoundProfileCredentialStore, boundProfileCredentials, findProfileFixtureAdmission, profileFixtureStorageAdmission, boundProfileAdmission } from "./synthetic-database-admission.js";
import { createCipheriv, createDecipheriv, generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { canonicalJsonStringify } from "../../../src/rules/validation/canonical-json.js";
import { composeProfileCredentialRepairInventory, composeProfileCredentialInitializationInventory } from "../../../src/backend/app/composition/profile-credential-inventory.js";
import { systemClock, type Clock } from "../../../src/rules/time/clock.js";
import { createProfileVerifiers } from "../../../src/backend/storage/configuration/verifier-store.js";
import { IsoInstantSchema } from "../../../src/rules/identity/ids.js";
import { tmpdir } from "node:os";
import { createProfileSession } from "../../../src/backend/profiles/profile-session.js";
import { createProfileRegistry } from "../../../src/backend/profiles/registry.js";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { rebuildRuntimeIsolation } from "../../../src/backend/app/config/runtime-isolation.js";
import { acquireEntrypointAdmission } from "../../../src/backend/storage/admission/bootstrap-admission.js";
import { RuntimeAdmission } from "../../../src/backend/storage/admission/admission.js";
import { AuthorityDatabase as ProductionAuthorityDatabase, AuthorityDatabaseOptionsSchema } from "../../../src/backend/storage/sqlite/authority-database.js";
import { createCredentialStore as productionCredentialStore } from "../../../src/backend/storage/configuration/credential-store.js";

const admissions = new Map<string, RuntimeAdmission>();
export function initializeAdmissionFixture(root: string): void {
  const canonical = resolve(root);
  if (admissions.has(canonical)) throw new Error("fixture installation already initialized");
  mkdirSync(join(canonical, rebuildRuntimeIsolation.artifactRoot), { recursive: true, mode: 0o700 });
  const initial = acquireEntrypointAdmission(canonical, "exclusive");
  initial.release();
  admissions.set(canonical, acquireEntrypointAdmission(canonical, "shared"));
}
export function fixtureAdmission(root: string): RuntimeAdmission {
  const canonical = resolve(root);
  const existing = admissions.get(canonical);
  if (existing !== undefined) {
    try { existing.assertLive(); return existing; }
    catch (error) {
      if (!(error instanceof Error) || error.message !== "runtime-admission: missing or released admission") throw error;
      const renewed = acquireEntrypointAdmission(canonical, "shared");
      admissions.set(canonical, renewed);
      return renewed;
    }
  }
  return RuntimeAdmission.syntheticRoots(join(canonical, rebuildRuntimeIsolation.stateRoot), join(canonical, rebuildRuntimeIsolation.artifactRoot));
}
export function installationAdmission(root: string): RuntimeAdmission {
  if (!admissions.has(resolve(root))) initializeAdmissionFixture(root);
  return fixtureAdmission(root);
}
export function releaseAdmissionFixture(root: string): void {
  const admission = admissions.get(resolve(root));
  admissions.delete(resolve(root));
  admission?.release();
}
export function releaseAdmissionFixtures(): void {
  for (const root of [...admissions.keys()]) releaseAdmissionFixture(root);
}
function admissionForStateRoot(root: string): RuntimeAdmission {
  const bound = findProfileFixtureAdmission(root);
  if (bound !== undefined) { bound.assertLive(); return bound; }
  for (const workspace of admissions.keys()) if (join(workspace, rebuildRuntimeIsolation.stateRoot) === resolve(root)) return fixtureAdmission(workspace);
  return RuntimeAdmission.syntheticRoots(resolve(root), join(resolve(root), "artifacts"));
}
export type AuthorityDatabase = ProductionAuthorityDatabase;
export const AuthorityDatabase = new Proxy(ProductionAuthorityDatabase, {
  get(target, property, receiver) {
    if (property === "open") return (input: unknown, ...rest: Parameters<typeof ProductionAuthorityDatabase.open> extends [unknown, unknown, ...infer R] ? R : never) => {
      const root = dirname(AuthorityDatabaseOptionsSchema.parse(input).path);
      const admission = admissionForStateRoot(root);
      const [clock, writeHooks, terminalHooks, lifecycleHooks, credentials] = rest;
      return target.open(admission, input, clock, writeHooks, terminalHooks, lifecycleHooks,
        credentials ?? boundProfileCredentials(admission));
    };
    return Reflect.get(target, property, receiver) as unknown;
  },
}) as unknown as Omit<typeof ProductionAuthorityDatabase, "open"> & {
  open(...args: Parameters<typeof ProductionAuthorityDatabase.open> extends [unknown, ...infer Rest] ? Rest : never): ProductionAuthorityDatabase;
};
export function createCredentialStore(input: Omit<Parameters<typeof productionCredentialStore>[0], "admission">) {
  const admission = findProfileFixtureAdmission(input.stateRoot);
  if (admission !== undefined) {
    if (Object.keys(input).length === 1) return boundProfileCredentials(admission);
    return createBoundProfileCredentialStore(admission, input);
  }
  return productionCredentialStore({ ...input, admission: admissionForStateRoot(input.stateRoot) });
}

export function readAuthenticatedCredentialFixture(machineRoot: string, profileId: string): unknown {
  const bytes = readFileSync(join(machineRoot, "profiles", profileId, "credentials", "protected.json"));
  if (bytes.byteLength > Math.ceil(16 * 1024 * 1024 / 3) * 4 + 4096) throw new Error("fixture-envelope-bound");
  const envelope = JSON.parse(bytes.toString("utf8")) as { schemaVersion: number; algorithm: string; installationId: string; profileId: string; keyId: string; nonce: string; tag: string; ciphertext: string };
  const key = credentialKeyCustody.read(JSON.parse(readFileSync(join(machineRoot, "machine", "credential-keys", `${profileId}.json`), "utf8")));
  if (envelope.schemaVersion !== 4 || envelope.algorithm !== "aes-256-gcm" || envelope.profileId !== profileId
    || key.profileId !== profileId || key.installationId !== envelope.installationId || key.keyId !== envelope.keyId) throw new Error("fixture-envelope-binding");
  const keyBytes = Buffer.from(key.key, "base64"), nonce = Buffer.from(envelope.nonce, "base64"), tag = Buffer.from(envelope.tag, "base64");
  if (keyBytes.length !== 32 || nonce.length !== 12 || tag.length !== 16
    || keyBytes.toString("base64") !== key.key || nonce.toString("base64") !== envelope.nonce || tag.toString("base64") !== envelope.tag) throw new Error("fixture-envelope-parameters");
  const decipher = createDecipheriv("aes-256-gcm", keyBytes, nonce, { authTagLength: 16 });
  decipher.setAAD(Buffer.from(canonicalJsonStringify({ domain: "relay:protected-current:v4", schemaVersion: 4, algorithm: envelope.algorithm,
    installationId: envelope.installationId, profileId, keyId: envelope.keyId }), "utf8"));
  decipher.setAuthTag(tag);
  const pending = decipher.update(Buffer.from(envelope.ciphertext, "base64")), final = decipher.final();
  return JSON.parse(Buffer.concat([pending, final]).toString("utf8")) as unknown;
}

export function rewriteAuthenticatedCredentialFixture(machineRoot: string, profileId: string, change: (payload: unknown) => unknown): void {
  const payload = change(readAuthenticatedCredentialFixture(machineRoot, profileId));
  const path = join(machineRoot, "profiles", profileId, "credentials", "protected.json");
  const envelope = JSON.parse(readFileSync(path, "utf8")) as { schemaVersion: number; algorithm: string; installationId: string; profileId: string; keyId: string };
  const key = credentialKeyCustody.read(JSON.parse(readFileSync(join(machineRoot, "machine", "credential-keys", `${profileId}.json`), "utf8")));
  const bytes = Buffer.from(canonicalJsonStringify(payload));
  if (bytes.byteLength > 16 * 1024 * 1024) throw new Error("fixture-payload-bound");
  const nonce = randomBytes(12), cipher = createCipheriv("aes-256-gcm", Buffer.from(key.key, "base64"), nonce, { authTagLength: 16 });
  cipher.setAAD(Buffer.from(canonicalJsonStringify({ domain: "relay:protected-current:v4", schemaVersion: 4, algorithm: envelope.algorithm,
    installationId: envelope.installationId, profileId, keyId: envelope.keyId })));
  const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
  writeFileSync(path, canonicalJsonStringify({ ...envelope, nonce: nonce.toString("base64"), ciphertext: ciphertext.toString("base64"), tag: cipher.getAuthTag().toString("base64") }), { mode: 0o600 });
}

const failedBoundProfileFixtures = new Set<Readonly<{
  workspace: string;
  admissions: readonly RuntimeAdmission[];
  primary: unknown;
}>>();

export function syntheticOnboardingDuo(accountName: () => string): ProfileOnboardingDuoProvider {
  return {
    async showBrowser(owner) { owner.assertCurrent(); },
    async openPortal(owner) { owner.assertCurrent(); },
    async closeBrowser() { return { state: "closed" }; },
    async start(attempt, bind, _reportFailure) {
      const capability = await bind({ contextId: randomBytes(16).toString("hex"), tabId: attempt.method === "key" ? 1 : 2,
        accountName: accountName(), origin: "https://fixture.duosecurity.com", rpId: "duosecurity.com" });
      const credentialId = randomBytes(32).toString("base64url");
      if (attempt.method === "key") {
        const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
        await capability.persistPending({ credentialId,
          privateKeyPkcs8: pair.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
          publicKeySpki: pair.publicKey.export({ type: "spki", format: "der" }).toString("base64"),
          transport: "usb", isResidentCredential: false, createdAt: new Date().toISOString() });
      }
      await capability.recordCeremony({ credentialId, requestId: randomUUID(),
        mechanism: attempt.method === "key" ? "fast-duo" : "native-platform", softwareInterceptionDisabled: attempt.method === "touch" });
      if (attempt.method === "touch") await capability.recordPortalAcceptance({ credentialId, requestId: randomUUID(), acceptance: "portal-accepted" });
    },
    async cancel() { return { state: "closed" }; },
  };
}

export function createSyntheticProfileSession(input: Parameters<typeof createProfileSession>[0]) {
  let accountName = "";
  const session = createProfileSession({ ...input, onboardingDuo: input.onboardingDuo ?? syntheticOnboardingDuo(() => accountName) });
  return { ...session,
    signUp(fields: Parameters<typeof session.signUp>[0]) {
      const draft = session.signUp(fields);
      if (draft.state === "onboarding") accountName = fields.email;
      return draft;
    },
    async close() { await session.closeOnboarding(); session.close(); },
  };
}

export async function readyProfileOnboarding(session: Pick<ReturnType<typeof createProfileSession>, "startOnboardingDuo" | "confirmOnboardingDuo" | "readOnboarding">,
  draft: ReturnType<ReturnType<typeof createProfileSession>["signUp"]>) {
  if (draft.state !== "onboarding") return draft;
  for (const method of ["key", "touch"] as const) {
    const started = await session.startOnboardingDuo(draft.token, draft.operationId, method);
    const attemptId = started.methods[method].attemptId;
    if (attemptId === undefined) throw new Error("fixture onboarding attempt missing");
    session.confirmOnboardingDuo(draft.token, draft.operationId, method, attemptId);
  }
  return session.readOnboarding(draft.token, draft.operationId);
}

export async function finishProfileOnboarding(session: Pick<ReturnType<typeof createProfileSession>, "startOnboardingDuo" | "confirmOnboardingDuo" | "completeOnboarding" | "readOnboarding">,
  draft: ReturnType<ReturnType<typeof createProfileSession>["signUp"]>) {
  if (draft.state !== "onboarding") return draft;
  const ready = await readyProfileOnboarding(session, draft);
  if (ready.state !== "onboarding" || ready.step !== "ready") throw new Error("fixture onboarding did not become ready");
  return session.completeOnboarding(draft.token, draft.operationId);
}

export async function createBoundProfileFixture(options: { pending?: true; sharedMachine?: true; workspace?: string } = {}) {
  if (options.pending === true && options.sharedMachine === true) throw new Error("pending profile fixture requires exclusive machine");
  const workspace = options.workspace === undefined
    ? realpathSync(mkdtempSync(join(tmpdir(), "relay-bound-profile-")))
    : realpathSync(options.workspace);
  const ownedAdmissions: RuntimeAdmission[] = [];
  try {
    let machine = acquireEntrypointAdmission(workspace, "exclusive");
    ownedAdmissions.push(machine);
    mkdirSync(join(workspace, rebuildRuntimeIsolation.processLockRoot), { recursive: true, mode: 0o700 });
    const fields = { firstName: "Fixture", lastName: "Example", email: "fixture@ucsd.edu",
      password: "disposable-fixture-password", createdAt: "2026-10-01T12:00:00.000Z" };
    const session = createSyntheticProfileSession({ admission: machine, machineRoot: machine.stateRoot,
      repairInventory: (child, request, writer, copies) => composeProfileCredentialRepairInventory({ machine, admission: child, clock: systemClock, hostFacts: { primaryDisplay: null } })(request, writer, copies),
      initializationInventory: (child, operation, writer, copies) => composeProfileCredentialInitializationInventory({ machine, admission: child, clock: systemClock, hostFacts: { primaryDisplay: null } })(operation, writer, copies),
      activity: { hasUnquiescedWork: () => false }, backupPaths: () => [], loginDataPaths: () => [] });
    let draft = options.pending === true ? undefined : session.signUp(fields);
    if (draft !== undefined && draft.state !== "onboarding") throw new Error("fixture draft was not created");
    const operation = draft ?? machine.beginProfileSignUp({ firstName: fields.firstName, lastName: fields.lastName,
      createdAt: IsoInstantSchema.parse(fields.createdAt), emailKey: createProfileVerifiers(machine.stateRoot).emailKeyFor(fields.email),
      commandFingerprint: "a".repeat(64) });
    let admission = machine.admitProfile(createProfileRegistry(machine).storageClaim(operation.profileId));
    ownedAdmissions.push(admission);
    const stateRoot = admission.stateRoot;
    registerBoundProfile(admission, machine);
    const finish = async () => {
      const current = draft ?? session.signUp(fields);
      if (current.state !== "onboarding" || current.profileId !== operation.profileId) throw new Error("fixture draft did not resume");
      draft = current;
      const active = await finishProfileOnboarding(session, current);
      if (active.state !== "active" || active.profileId !== operation.profileId) throw new Error("bound profile fixture signup refused");
      admission.release();
      admission = machine.admitProfile(createProfileRegistry(machine).storageClaim(active.profileId));
      ownedAdmissions.push(admission);
      registerBoundProfile(admission, machine);
      return active;
    };
    if (options.pending !== true) await finish();
    if (options.sharedMachine === true) {
      await session.close();
      admission.release();
      machine.release();
      machine = acquireEntrypointAdmission(workspace, "shared");
      ownedAdmissions.push(machine);
      admission = machine.admitProfile(createProfileRegistry(machine).storageClaim(operation.profileId));
      ownedAdmissions.push(admission);
      registerBoundProfile(admission, machine);
    }
    const renewAfterRestore = () => {
      assertBoundFixtureWorkersReleased(admission);
      admission.release();
      admission = machine.admitProfile(createProfileRegistry(machine).storageClaim(operation.profileId));
      ownedAdmissions.push(admission);
      registerBoundProfile(admission, machine);
      return { admission, credentials: boundProfileCredentials(admission) };
    };
    return { workspace, get machine() { return machine; }, get admission() { return admission; }, stateRoot, path: join(stateRoot, "state.db"), finish, renewAfterRestore,
      async close() { await session.close(); unregisterBoundProfile(admission); admission.release(); machine.release(); rmSync(workspace, { recursive: true, force: true }); } };
  } catch (error) {
    failedBoundProfileFixtures.add({ workspace, admissions: ownedAdmissions, primary: error });
    throw error;
  }
}

export async function openBoundDatabaseFixture(migrationOwner: string, clock: Clock = systemClock, busyTimeoutMs = 250,
  writeHooks?: Parameters<typeof AuthorityDatabase.open>[2], terminalHooks?: Parameters<typeof AuthorityDatabase.open>[3],
  lifecycleHooks?: Parameters<typeof AuthorityDatabase.open>[4]) {
  const profile = await createBoundProfileFixture();
  try {
    const database = AuthorityDatabase.open({ path: profile.path, busyTimeoutMs, migrationOwner }, clock, writeHooks, terminalHooks, lifecycleHooks);
    return { profile, database, path: profile.path, stateRoot: profile.stateRoot,
      async close() { database.close(); await profile.close(); } };
  } catch (error) {
    await profile.close();
    throw error;
  }
}
