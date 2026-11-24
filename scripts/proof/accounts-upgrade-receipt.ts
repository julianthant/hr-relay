import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { lstatSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";
import { applicationDataWorkspace, copySigninFixtureWorkspace, rebuildRuntimeIsolation, runtimeProfile } from "../../src/backend/app/config/runtime-isolation.js";
import { probeOwnedViteServer } from "../../src/backend/app/host/local-vite-probe.js";
import { BrowserRootsSchema } from "../../src/backend/storage/browser-root-contract.js";
import { noSymlinkAncestry, readPrivateFile, statDirectory, type DirectoryIdentity } from "../../src/backend/storage/configuration/credential-safe-file.js";
import { createDashboardClient, type DashboardClient } from "../../src/dashboard/client/index.js";
import { runtimeProfiles } from "../../src/models/config/define-runtime-isolation.js";
import { ErrorCatalogCodeSchema } from "../../src/models/failures/error-catalog.js";
import { ProfileRegistryDocumentSchema, ProfileRegistryRowSchema, ProfileVerifierDocumentSchema } from "../../src/models/profiles/profile.js";
import { ProfilePasswordChangeRequestSchema, type PublicProfileState } from "../../src/models/profiles/public-profile.js";
import { CommandRejectionCodeSchema, ProtectedSettingsCommandRequestSchema } from "../../src/rules/commands/commands.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../src/rules/identity/ids.js";
import { systemClock } from "../../src/rules/time/clock.js";
import { runDevDashboard } from "../dev/dashboard.js";
import { assertCopySigninTarget, driveCopySignin, readCopySigninCredentials } from "../profiles/copy-signin.js";

const CommitSchema = z.string().regex(/^[0-9a-f]{40}$/u);
const BuildSchema = z.strictObject({ candidate: CommitSchema, checkout: CommitSchema });
type Build = z.infer<typeof BuildSchema>;
const RegistrySchema = ProfileRegistryDocumentSchema.extend({ profiles: z.array(ProfileRegistryRowSchema.extend({ relayEmail: z.string().min(1).optional() })) });
type RegistryRow = z.infer<typeof RegistrySchema>["profiles"][number];
type ProofState = Pick<Extract<PublicProfileState, { state: "active" }>, "state" | "profileId">
  | Pick<Extract<PublicProfileState, { state: "refused" | "error" }>, "state" | "code">
  | Readonly<{ state: "signed-out" | "cancelling" | "onboarding" }>;

interface Snapshot {
  readonly selected: string | null;
  readonly row: Pick<RegistryRow, "profileId" | "relayEmail">;
  readonly protectedBytes: Buffer;
  readonly verifierBytes: Buffer;
}

interface InspectedCopy {
  readonly snapshot: Snapshot;
  readonly ucpathUsername: string;
  readonly ucpathPassword: string;
  readonly pairProvesVerifier: boolean;
  readonly loginWrittenLast: boolean;
}

interface ProofSession {
  resume(): Promise<ProofState>;
  recover(): Promise<{ state: ProofState; password: string }>;
  changeRelayPassword(currentPassword: string, newPassword: string): Promise<void>;
  saveUcpathPassword(password: string): Promise<void>;
  verifyUcpathPassword(password: string): Promise<void>;
}

export interface UpgradeProofDependencies {
  inspect(profileId?: string): Promise<InspectedCopy>;
  snapshot(profileId: string): Snapshot;
  withSession(run: (session: ProofSession) => Promise<void>): Promise<void>;
  approveRecovery(): Promise<boolean>;
  testPassword(): string;
}

const RefusalCodeSchema = z.union([ErrorCatalogCodeSchema, CommandRejectionCodeSchema]);
type ProofCode = z.infer<typeof RefusalCodeSchema>
  | "COPY_ADMISSION_UNCONFIRMED" | "COPY_AUTHORITY_CHANGED" | "COPY_DASHBOARD_UNAVAILABLE" | "COPY_NOT_PRISTINE"
  | "COPY_RESTORE_UNCONFIRMED" | "COPY_SESSION_NOT_ISSUED" | "COPY_TARGET_REFUSED" | "COPY_VERIFIER_MISMATCH"
  | "INTERRUPTED_LOGIN_REPAIR_UNCONFIRMED" | "RELAY_CHANGE_UNCONFIRMED" | "UCPATH_SAVE_UNCONFIRMED";

class ProofRefusal extends Error {
  constructor(readonly code: ProofCode) { super(code); this.name = "ProofRefusal"; }
}

function requireProof(condition: unknown, code: ProofCode): asserts condition {
  if (!condition) throw new ProofRefusal(code);
}

const digest = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");

function snapshotHashes(snapshot: Snapshot) {
  return { protected: digest(snapshot.protectedBytes), verifiers: digest(snapshot.verifierBytes), registryRow: digest(JSON.stringify(snapshot.row)) };
}

function verifierMaterial(snapshot: Snapshot, omitActive = false): string {
  const { profiles } = ProfileVerifierDocumentSchema.parse(JSON.parse(snapshot.verifierBytes.toString("utf8")));
  requireProof(new Set(profiles.map(row => row.profileId)).size === profiles.length && profiles.some(row => row.profileId === snapshot.row.profileId), "COPY_VERIFIER_MISMATCH");
  return JSON.stringify(profiles.filter(row => !omitActive || row.profileId !== snapshot.row.profileId)
    .map(({ profileId, emailKey, salt, passwordVerifier }) => ({ profileId, emailKey, salt, passwordVerifier }))
    .sort((a, b) => a.profileId.localeCompare(b.profileId)));
}

function refused(state: ProofState): ProofCode | undefined {
  return "code" in state ? ErrorCatalogCodeSchema.parse(state.code) : undefined;
}

export async function runAccountsUpgradeProof(build: Build, deps: UpgradeProofDependencies) {
  const receipt = {
    issue: 464, proof: "4.6(1)", build: BuildSchema.parse(build), outcome: "failed" as "failed" | "passed" | "operator-required",
    interruptedLoginRepaired: false,
    checks: {
      sessionIssued: false, protectedUnchangedOnAdmission: false, verifierRowsUnchangedOnAdmission: false,
      registryGainedRelayEmail: false, protectedUnchangedOnRelayChange: false, verifiersUnchangedOnUcpathSave: false,
      passwordsRestored: false,
    },
    hashes: {} as Partial<Record<"before" | "resumeRefused" | "repaired" | "admitted" | "relayChanged" | "relayRestored" | "ucpathSaved" | "restored", ReturnType<typeof snapshotHashes>>>,
    codes: [] as ProofCode[],
  };
  let failureCode: ProofCode = "COPY_TARGET_REFUSED";
  try {
    const before = await deps.inspect();
    const profileId = before.snapshot.row.profileId;
    receipt.hashes.before = snapshotHashes(before.snapshot);
    requireProof(before.snapshot.selected === profileId && before.snapshot.row.relayEmail === undefined, "COPY_NOT_PRISTINE");
    const originalMaterial = verifierMaterial(before.snapshot);
    let originalPassword = before.ucpathPassword;
    let repaired: Snapshot | undefined;
    const checkAndChange = async (session: ProofSession, state: ProofState, baseline: Snapshot) => {
      requireProof(state.state === "active" && state.profileId === profileId, refused(state) ?? "COPY_SESSION_NOT_ISSUED");
      const admitted = deps.snapshot(profileId);
      receipt.hashes.admitted = snapshotHashes(admitted);
      const { checks } = receipt;
      checks.sessionIssued = admitted.selected === profileId;
      checks.protectedUnchangedOnAdmission = admitted.protectedBytes.equals(baseline.protectedBytes);
      checks.verifierRowsUnchangedOnAdmission = verifierMaterial(admitted) === originalMaterial;
      checks.registryGainedRelayEmail = admitted.row.relayEmail !== undefined
        && (repaired === undefined ? admitted.row.relayEmail === before.ucpathUsername : admitted.row.relayEmail === repaired.row.relayEmail);
      requireProof(checks.sessionIssued && checks.protectedUnchangedOnAdmission && checks.verifierRowsUnchangedOnAdmission
        && checks.registryGainedRelayEmail, "COPY_ADMISSION_UNCONFIRMED");

      const testPassword = deps.testPassword();
      requireProof(testPassword !== originalPassword, "COPY_TARGET_REFUSED");
      requireProof(ProfilePasswordChangeRequestSchema.safeParse({ currentPassword: testPassword, newPassword: originalPassword }).success,
        "COPY_RESTORE_UNCONFIRMED");
      const otherVerifiers = verifierMaterial(admitted, true);
      failureCode = "RELAY_CHANGE_UNCONFIRMED";
      await session.changeRelayPassword(originalPassword, testPassword);
      try {
        const changed = deps.snapshot(profileId);
        receipt.hashes.relayChanged = snapshotHashes(changed);
        checks.protectedUnchangedOnRelayChange = changed.protectedBytes.equals(admitted.protectedBytes);
        requireProof(checks.protectedUnchangedOnRelayChange && verifierMaterial(changed) !== originalMaterial
          && verifierMaterial(changed, true) === otherVerifiers, "RELAY_CHANGE_UNCONFIRMED");
      } finally {
        await session.changeRelayPassword(testPassword, originalPassword);
      }
      const relayRestored = deps.snapshot(profileId);
      receipt.hashes.relayRestored = snapshotHashes(relayRestored);
      requireProof(relayRestored.protectedBytes.equals(admitted.protectedBytes)
        && verifierMaterial(relayRestored, true) === otherVerifiers, "COPY_RESTORE_UNCONFIRMED");

      failureCode = "UCPATH_SAVE_UNCONFIRMED";
      await session.saveUcpathPassword(testPassword);
      try {
        const saved = deps.snapshot(profileId);
        receipt.hashes.ucpathSaved = snapshotHashes(saved);
        checks.verifiersUnchangedOnUcpathSave = saved.verifierBytes.equals(relayRestored.verifierBytes);
        requireProof(checks.verifiersUnchangedOnUcpathSave && !saved.protectedBytes.equals(relayRestored.protectedBytes), "UCPATH_SAVE_UNCONFIRMED");
        await session.verifyUcpathPassword(testPassword);
      } finally {
        await session.saveUcpathPassword(originalPassword);
      }
      failureCode = "COPY_DASHBOARD_UNAVAILABLE";
    };

    failureCode = "COPY_DASHBOARD_UNAVAILABLE";
    await deps.withSession(async session => {
      const state = await session.resume();
      if (state.state === "active") {
        requireProof(before.pairProvesVerifier, "COPY_VERIFIER_MISMATCH");
        await checkAndChange(session, state, before.snapshot);
        return;
      }
      const code = refused(state) ?? "COPY_SESSION_NOT_ISSUED";
      receipt.codes.push(code);
      const afterRefusal = deps.snapshot(profileId);
      receipt.hashes.resumeRefused = snapshotHashes(afterRefusal);
      if (code !== "PROFILE_AUTHORITY_UNAVAILABLE" || before.pairProvesVerifier || !before.loginWrittenLast) return;
      requireProof(afterRefusal.row.relayEmail === undefined && afterRefusal.protectedBytes.equals(before.snapshot.protectedBytes)
        && verifierMaterial(afterRefusal) === originalMaterial, "COPY_AUTHORITY_CHANGED");
      if (!await deps.approveRecovery()) { receipt.outcome = "operator-required"; return; }
      failureCode = "INTERRUPTED_LOGIN_REPAIR_UNCONFIRMED";
      const recovered = await session.recover();
      const afterRepair = deps.snapshot(profileId);
      receipt.hashes.repaired = snapshotHashes(afterRepair);
      requireProof(recovered.state.state === "active" && recovered.state.profileId === profileId,
        refused(recovered.state) ?? "INTERRUPTED_LOGIN_REPAIR_UNCONFIRMED");
      requireProof(afterRepair.row.relayEmail !== undefined && !afterRepair.protectedBytes.equals(before.snapshot.protectedBytes)
        && verifierMaterial(afterRepair) === originalMaterial, "INTERRUPTED_LOGIN_REPAIR_UNCONFIRMED");
      originalPassword = recovered.password;
      repaired = afterRepair;
      failureCode = "COPY_DASHBOARD_UNAVAILABLE";
    });

    if (repaired !== undefined) {
      const recovery = await deps.inspect(profileId);
      requireProof(recovery.pairProvesVerifier && recovery.ucpathPassword === originalPassword
        && recovery.snapshot.protectedBytes.equals(repaired.protectedBytes), "INTERRUPTED_LOGIN_REPAIR_UNCONFIRMED");
      receipt.interruptedLoginRepaired = true;
      const repairedBaseline = repaired;
      await deps.withSession(async session => { await checkAndChange(session, await session.resume(), repairedBaseline); });
    }
    if (!receipt.checks.sessionIssued) return receipt;
    failureCode = "COPY_RESTORE_UNCONFIRMED";
    const restored = await deps.inspect(profileId);
    receipt.hashes.restored = snapshotHashes(restored.snapshot);
    receipt.checks.passwordsRestored = restored.pairProvesVerifier && restored.ucpathPassword === originalPassword
      && restored.ucpathUsername === (repaired?.row.relayEmail ?? before.ucpathUsername)
      && receipt.hashes.restored.verifiers === receipt.hashes.relayRestored?.verifiers;
    requireProof(receipt.checks.passwordsRestored, failureCode);
    receipt.outcome = "passed";
  } catch (error) {
    receipt.outcome = "failed";
    const code = error instanceof ProofRefusal ? error.code : error instanceof Error && "code" in error
      ? RefusalCodeSchema.safeParse(error.code).data ?? failureCode : failureCode;
    if (!receipt.codes.includes(code)) receipt.codes.push(code);
  }
  return receipt;
}

const ports = runtimeProfiles.development;
const origin = `http://127.0.0.1:${String(ports.frontendPort)}`;
const stateRoute = "/api/v1/profile/state";
const resumeRoute = "/api/v1/profile/resume";
const resumeKey = "relay.profile.resume";
const repo = fileURLToPath(new URL("../..", import.meta.url));

function privateBytes(path: string, label: "lock" | "protected.json", maxBytes: number): Buffer {
  const ancestry = new Map<string, DirectoryIdentity>();
  requireProof(noSymlinkAncestry(dirname(path), ancestry), "COPY_TARGET_REFUSED");
  const file = readPrivateFile(path, { label, maxBytes });
  requireProof(file !== undefined && noSymlinkAncestry(dirname(path), ancestry), "COPY_TARGET_REFUSED");
  return file.bytes;
}

export function copySnapshots(workspace: string) {
  const state = join(workspace, rebuildRuntimeIsolation.stateRoot);
  const machine = join(state, "machine");
  return (profileId: string): Snapshot => {
    const id = z.uuid().parse(profileId);
    const registry = RegistrySchema.parse(JSON.parse(privateBytes(join(machine, "profiles.json"), "lock", 1_048_576).toString("utf8")));
    const [row, duplicate] = registry.profiles.filter(candidate => candidate.profileId === id);
    requireProof(row !== undefined && duplicate === undefined, "COPY_AUTHORITY_CHANGED");
    return { selected: registry.activeProfileId, row,
      protectedBytes: privateBytes(join(state, "profiles", id, "credentials", "protected.json"), "protected.json", 25 * 1024 * 1024),
      verifierBytes: privateBytes(join(machine, "profile-verifiers.json"), "lock", 1_048_576) };
  };
}

async function inspectStoppedCopy(workspace: string, snapshot: UpgradeProofDependencies["snapshot"], profileId?: string): Promise<InspectedCopy> {
  assertCopySigninTarget("development", workspace, rebuildRuntimeIsolation);
  privateBytes(join(workspace, ".tracker", "control", "installation.json"), "lock", 16_384);
  const [{ acquireRuntimeLifetimeLock }, { acquireEntrypointAdmission }, { createCredentialStore }, { createProfileVerifiers }] = await Promise.all([
    import("../../src/backend/storage/admission/lifetime-lock.js"),
    import("../../src/backend/storage/admission/bootstrap-admission.js"),
    import("../../src/backend/storage/configuration/credential-store.js"),
    import("../../src/backend/storage/configuration/verifier-store.js"),
  ]);
  const lock = await acquireRuntimeLifetimeLock(ports.lockPort);
  try {
    const machine = acquireEntrypointAdmission(workspace, "exclusive", lock);
    try {
      const registry = machine.readProfileRegistry();
      const row = registry.profiles.find(candidate => candidate.profileId === (profileId ?? registry.activeProfileId));
      requireProof(row !== undefined && row.profileId === registry.activeProfileId, "COPY_SESSION_NOT_ISSUED");
      requireProof(row.lifecycle === "ready" && row.registration.onboardingCompletion !== undefined && row.duoState === "ready", "PROFILE_TRANSITION_BLOCKED");
      const browserRoots = BrowserRootsSchema.parse(JSON.parse(privateBytes(join(machine.stateRoot, "machine", "browser-roots.json"), "lock", 1_048_576).toString("utf8")));
      requireProof(browserRoots.installationId === registry.installationId
        && browserRoots.roots.every(root => root.launch.state === "closed" && root.native === undefined), "COPY_TARGET_REFUSED");
      const observed = snapshot(row.profileId);
      const admission = machine.admitProfile(row.profileId);
      try {
        const store = createCredentialStore({ admission, stateRoot: admission.stateRoot });
        const { entries } = store.read();
        const ucpathUsername = entries.ucpathUserId?.value, ucpathPassword = entries.ucpathPassword?.value;
        requireProof(ucpathUsername !== undefined && ucpathPassword !== undefined, "PROFILE_AUTHORITY_UNAVAILABLE");
        const verifiers = createProfileVerifiers(machine.stateRoot);
        const owner = verifiers.identify(ucpathUsername);
        const writers = store.lastEntryWriters();
        const loginWrites = new Set([digest("relay-login-change"), digest("relay-login-change-restore")]);
        return { snapshot: observed, ucpathUsername, ucpathPassword,
          pairProvesVerifier: owner !== "unknown" && owner.profileId === row.profileId && verifiers.passwordMatches(row.profileId, ucpathPassword),
          loginWrittenLast: [writers.ucpathUserId, writers.ucpathPassword].every(writer => writer?.operation === "set" && loginWrites.has(writer.commandFingerprint)) };
      } finally { admission.release(); }
    } finally { machine.release(); }
  } finally { await lock.close(); }
}

async function waitForFrontend(ownerNonce: string, signal: AbortSignal): Promise<void> {
  const deadline = systemClock.monotonicMs() + 30_000;
  while (systemClock.monotonicMs() < deadline) {
    signal.throwIfAborted();
    const result = await probeOwnedViteServer({ port: ports.frontendPort, ownerNonce, signal, clock: systemClock,
      deadlineMonotonicMs: Math.min(deadline, systemClock.monotonicMs() + 2000) });
    if (result.state === "owned") return;
    if (result.reason !== "probe-request-failed" && result.reason !== "probe-deadline-expired") break;
    await delay(100, undefined, { signal });
  }
  throw new ProofRefusal("DASHBOARD_FRONTEND_NOT_OWNED");
}

async function recoverCopySignin(dashboard: DashboardClient): Promise<{ state: ProofState; password: string }> {
  const initial = await dashboard.readProfileSession();
  requireProof(initial.state === "signed-out" && initial.resumable !== true && initial.signUpRequired !== true
    && initial.logoutIncomplete !== true, refused(initial) ?? "INTERRUPTED_LOGIN_REPAIR_UNCONFIRMED");
  const credentials = readCopySigninCredentials(join(homedir(), ".config", "relay", "operator-signin.env"));
  const refuseUnexpected = () => { throw new ProofRefusal("INTERRUPTED_LOGIN_REPAIR_UNCONFIRMED"); };
  let signIn: PublicProfileState | undefined;
  try {
    await driveCopySignin("development", {
      readProfileSession: () => Promise.resolve(initial),
      resumeProfile: refuseUnexpected,
      async signInProfile(request) { signIn = await dashboard.signInProfile(request); return signIn; },
      signUpProfile: refuseUnexpected, openProfileOnboardingPortal: refuseUnexpected, completeProfileOnboarding: refuseUnexpected,
    }, () => credentials);
  } catch {
    throw new ProofRefusal((signIn === undefined ? undefined : refused(signIn)) ?? "INTERRUPTED_LOGIN_REPAIR_UNCONFIRMED");
  }
  return { state: await dashboard.readProfileSession(), password: credentials.RELAY_PASSWORD };
}

function copySession(dashboard: DashboardClient): ProofSession {
  const settings = async () => {
    const { protectedSettings } = await dashboard.editableSettings();
    requireProof(protectedSettings.state === "available", "PROFILE_AUTHORITY_UNAVAILABLE");
    return protectedSettings;
  };
  return {
    resume: () => dashboard.resumeProfile(),
    recover: () => recoverCopySignin(dashboard),
    async changeRelayPassword(currentPassword, newPassword) {
      const result = await dashboard.changeProfilePassword({ currentPassword, newPassword });
      requireProof(result.state === "changed" && result.durability === undefined,
        "code" in result ? ErrorCatalogCodeSchema.parse(result.code) : "RELAY_CHANGE_UNCONFIRMED");
    },
    async saveUcpathPassword(password) {
      const current = await settings();
      const result = await dashboard.applySettings(ProtectedSettingsCommandRequestSchema.parse({
        family: "settings", type: "apply-protected-settings", source: "settings-surface", requestedBy: LOCAL_OPERATOR_ACTOR_ID,
        commandId: randomUUID(), requestedAt: systemClock.now().toISOString(), target: { expectedRevision: current.readback.revision },
        payload: { protectedSchemaHash: current.protectedSchemaHash, writeId: randomUUID(), entries: { ucpathPassword: { set: password } } },
      }));
      requireProof(result.state === "applied" && result.affectedTargets.some(target => target.family === "protected-settings"
        && target.revision === current.readback.revision + 1), result.state === "rejected" ? result.code : "UCPATH_SAVE_UNCONFIRMED");
    },
    async verifyUcpathPassword(password) {
      requireProof((await settings()).entries.ucpathPassword?.value === password, "UCPATH_SAVE_UNCONFIRMED");
    },
  };
}

async function withCopySession(workspace: string, run: (session: ProofSession) => Promise<void>): Promise<void> {
  assertCopySigninTarget("development", workspace, rebuildRuntimeIsolation);
  const browserDirectory = join(workspace, "copy-signin-browser");
  requireProof(noSymlinkAncestry(browserDirectory, new Map()), "PROFILE_SIGN_IN_REFUSED");
  statDirectory(browserDirectory, "copy sign-in browser", 0o700);
  requireProof(["SingletonLock", "SingletonSocket", "SingletonCookie"].every(name =>
    lstatSync(join(browserDirectory, name), { throwIfNoEntry: false }) === undefined), "COPY_TARGET_REFUSED");
  const ready = Promise.withResolvers<string>(), signals = new EventEmitter(), stop = new AbortController();
  const halt = () => { stop.abort(); signals.emit("SIGTERM"); };
  const finished = runDevDashboard({ profile: "development", signals, copySignin: {
    backendEntry: fileURLToPath(new URL("../profiles/copy-signin.ts", import.meta.url)), ready: ready.resolve, phone: halt,
  } }).finally(() => { stop.abort(); });
  process.on("SIGINT", halt);
  process.on("SIGTERM", halt);
  try {
    const nonce = await Promise.race([ready.promise, delay(120_000, undefined, { signal: stop.signal, ref: false }).then(() => {
      throw new ProofRefusal("COPY_DASHBOARD_UNAVAILABLE");
    })]);
    await waitForFrontend(nonce, stop.signal);
    const { chromium } = await import("playwright");
    const context = await chromium.launchPersistentContext(browserDirectory, { headless: true, channel: "chromium", serviceWorkers: "block",
      acceptDownloads: false, args: ["--no-proxy-server", "--disable-features=PasswordManagerOnboarding,PasswordImport,PasswordManagerEnabled"] });
    try {
      await context.route("**/*", route => route.request().url() === `${origin}/`
        ? route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Relay upgrade proof</title>" }) : route.abort());
      const page = context.pages()[0] ?? await context.newPage();
      await page.goto(origin);
      let proof = await page.evaluate(key => localStorage.getItem(key), resumeKey);
      requireProof(proof !== null, "PROFILE_SIGN_IN_REFUSED");
      const dashboard = createDashboardClient({ baseUrl: origin, async fetchImpl(input, init) {
        const url = new URL(input);
        requireProof(url.origin === origin && !url.username && !url.password, "DASHBOARD_FRONTEND_NOT_OWNED");
        const headers = new Headers(init?.headers);
        if (proof !== null && (url.pathname === stateRoute || url.pathname === resumeRoute)) headers.set("x-relay-resume", proof);
        const response = await fetch(url, { ...init, headers, redirect: "error", signal: AbortSignal.any([stop.signal, AbortSignal.timeout(30_000)]) });
        const next = response.ok ? response.headers.get("x-relay-resume") : null;
        if (next !== null) {
          proof = next;
          await page.evaluate(({ key, value }) => { localStorage.setItem(key, value); }, { key: resumeKey, value: next });
        }
        return response;
      } });
      await run(copySession(dashboard));
    } finally { await context.close(); }
  } finally {
    halt();
    try { requireProof(await finished === 0, "COPY_DASHBOARD_UNAVAILABLE"); }
    finally { process.removeListener("SIGINT", halt); process.removeListener("SIGTERM", halt); }
  }
}

async function approveInterruptedRecovery(): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try { return (await terminal.question("Interrupted Relay login change proved. Type repair to sign in with the old Relay login from the copy sign-in env file: ")).trim() === "repair"; }
  finally { terminal.close(); }
}

function checkedBuild(candidate: string): Build {
  const git = (args: readonly string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const build = BuildSchema.parse({ candidate, checkout: git(["rev-parse", "HEAD"]) });
  requireProof(git(["status", "--porcelain"]) === "", "COPY_TARGET_REFUSED");
  git(["merge-base", "--is-ancestor", build.candidate, build.checkout]);
  return build;
}

const usage = "RELAY_RUNTIME_PROFILE=development npx tsx scripts/proof/accounts-upgrade-receipt.ts --candidate <reviewed-464-sha>";

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { candidate: { type: "string" }, help: { type: "boolean" } } });
  if (values.help === true) {
    process.stdout.write(`${usage}\n\nPrepare the isolated development profile on the pre-upgrade build using copy-signin.ts development.\n`
      + "Close its dashboard window without signing out. Run the proof on the Mac from a clean checkout containing this rig, Copy Sign-In, and the reviewed #464 commit.\n"
      + "Keep the operator present. If the proof confirms an interrupted login change, the operator can approve repair with the old Relay login in the copy sign-in env file.\n"
      + "The proof uses the development ports and data root. It writes and posts a redacted receipt on #464.\n");
    return;
  }
  const candidate = CommitSchema.parse(values.candidate);
  const build = checkedBuild(candidate);
  requireProof(process.platform === "darwin" && runtimeProfile === "development" && copySigninFixtureWorkspace() === undefined, "COPY_TARGET_REFUSED");
  delete process.env.DEBUG;
  const workspace = applicationDataWorkspace(undefined, "development");
  const snapshot = copySnapshots(workspace);
  const receipt = await runAccountsUpgradeProof(build, {
    inspect: profileId => inspectStoppedCopy(workspace, snapshot, profileId), snapshot,
    withSession: run => withCopySession(workspace, run), approveRecovery: approveInterruptedRecovery,
    testPassword: () => randomBytes(32).toString("base64url"),
  });
  const path = join(mkdtempSync(join(tmpdir(), "relay-accounts-upgrade-")), "receipt.md");
  writeFileSync(path, `### Relay account upgrade proof 4.6(1)\n\n\`\`\`json\n${JSON.stringify(receipt, null, 2)}\n\`\`\`\n`, { mode: 0o600, flag: "wx" });
  process.stdout.write(`Accounts upgrade ${receipt.outcome}. Receipt ${path}\n`);
  try {
    execFileSync("gh", ["issue", "comment", "464", "--repo", "julianthant/hr-relay", "--body-file", path], { stdio: ["ignore", "ignore", "pipe"] });
  } catch {
    process.stderr.write("ACCOUNTS_UPGRADE_RECEIPT_POST_FAILED\n");
    process.exitCode = 1;
  }
  if (receipt.outcome !== "passed") process.exitCode = 1;
}

const entry = process.argv[1];
if (entry !== undefined && pathToFileURL(entry).href === import.meta.url) {
  try { await main(); }
  catch (error) {
    process.stderr.write(`${error instanceof ProofRefusal ? error.code : "COPY_TARGET_REFUSED"}\n${usage}\n`);
    process.exitCode = 1;
  }
}
