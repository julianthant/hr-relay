import { DEFAULT_BROWSER_LAUNCHER as DEFAULT_LAUNCHER, BrowserProfileStillClosingError, ProfileCustodyUnavailableError,
  profileReservations, assertPrivateProfilePath, probeClosedBrowserProfile, closeContextWithProof, observeContextLifecycle,
  workerProfileDirectory, type ContextLifecycle, type BrowserDeadlineScheduler, type PersistentContextLauncher } from "./native-profile-probe.js";
export { BrowserProfileStillClosingError, ProfileCustodyUnavailableError, PROFILE_CUSTODY_UNAVAILABLE_TEXT, probeClosedBrowserProfile,
  workerProfileDirectory, type BrowserDeadlineScheduler, type PersistentContextLauncher } from "./native-profile-probe.js";
import { DuoCredentialSchema, DuoCredentialFileSchema } from "../../../models/config/duo-credential.js";
import { BrowserSessionClosureUnprovedError } from "../../../workflow-kit/session.js";
import { UCPATH_PENDING_READ_RECIPES } from "../../systems/ucpath/driver/ui-registry.js";
import { z } from "zod";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";

import { lstatSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import type { BrowserContext, Page } from "playwright";
import type {
  BrowserSessionCloseProof,
  BrowserSessionCloseReason,
  WorkerBrowserResource,
  WorkerBrowserSessionFactory,
  BrowserScreenshotEvidence,
} from "../../../workflow-kit/session.js";
import type { DuoCeremonyGate } from "../../../workflow-kit/duo-ceremony-lease.js";
import type { RuntimeIsolation } from "../../../models/config/define-runtime-isolation.js";
import type { Clock } from "../../../rules/time/clock.js";
import { RuntimeInstanceSchema, resolveSystemEntryUrl } from "../../../models/config/instance.js";
import type { RuntimeInstance } from "../../../models/config/instance.js";
import { AbsolutePathSchema } from "../../../models/config/schema.js";
import type { Config } from "../../../models/config/schema.js";
import { BrowserPresentationModeSchema } from "../../../models/run/envelope.js";
import type { BrowserPresentationMode } from "../../../models/run/envelope.js";
import {
  BrowserSessionIdSchema,
  BrowserSystemIdSchema,
  FingerprintSchema,
  WorkerIdSchema,
  WorkflowIdSchema,
  PositiveIntSchema,
} from "../../../rules/identity/ids.js";
import type { BrowserSystemId, Fingerprint, WorkerId, WorkflowId } from "../../../rules/identity/ids.js";
import {
  requireSecret,
  requireSecretFile,
  resolveSecretFileIdentity,
  type ProtectedSecretSource,
} from "../../../models/config/secrets.js";
import { assertAuthenticatedApplication } from "../../systems/browser-shared/authenticated-application.js";
import type { AuthenticatedApplicationEvidence } from "../../systems/browser-shared/login-contract.js";
import type { SystemLoginContext } from "../../systems/browser-shared/login-contract.js";
import { BROWSER_SYSTEM_BINDINGS } from "./system-bindings.js";
import type { BrowserSystemBinding, BrowserSystemBindings } from "./system-bindings.js";
import { attachBrowserDiagnostics } from "./browser-diagnostics.js";
import type { DebugEvent } from "../../../models/events/timeline.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import { ProtectedStoreRecordSchema } from "../../../models/config/protected-settings.js";
import { captureFullPage, FullPageCaptureRefusedError, FullPageCaptureRestoreError } from "./full-page-capture.js";

export const BrowserProfileAdmissionSchema = z.strictObject({
  workerId: WorkerIdSchema, system: BrowserSystemIdSchema, instance: RuntimeInstanceSchema,
  configFingerprint: FingerprintSchema, browserMode: BrowserPresentationModeSchema,
  signInFingerprint: FingerprintSchema,
  profileDirectory: AbsolutePathSchema, profileRevision: PositiveIntSchema,
  resetRequired: z.boolean(),
});
export type BrowserProfileAdmission = z.infer<typeof BrowserProfileAdmissionSchema>;

export interface BrowserSessionFactoryOptions {
  readonly config: Config;
  readonly protectedSecrets: ProtectedSecretSource;
  readonly isolation: RuntimeIsolation;
  readonly clock: Clock;
  readonly scheduler: BrowserDeadlineScheduler;
  readonly newSessionId: () => string;
  readonly slotOrdinal: (workerId: WorkerId, system: BrowserSystemId) => number;
  readonly admitProfile: (input: Readonly<{ workerId: WorkerId; system: BrowserSystemId; instance: RuntimeInstance;
    configFingerprint: Fingerprint; signInFingerprint: Fingerprint; browserMode: BrowserPresentationMode; profileDirectory: string }>) => Promise<BrowserProfileAdmission>;
  readonly bindings?: BrowserSystemBindings;
  readonly launcher?: PersistentContextLauncher;
  // Session proof diagnostics name the observed marker, never its sensitive value.
  readonly onAuthenticationEvidence?: (evidence: AuthenticatedApplicationEvidence) => void;

  readonly onNavigation?: (url: string) => void;
  readonly onDebug?: (workerId: WorkerId, event: Pick<DebugEvent, "phase" | "correlationId"> & Partial<Pick<DebugEvent, "code" | "durationMs" | "pinned">>) => void;
}

/** Resolved once per authentication; never logged, never interpolated. */
interface SsoCredentials {
  readonly userId: string;
  readonly password: string;
}



function browserModeFor(
  requested: BrowserPresentationMode | undefined,
  configuredHeadless: boolean,
): BrowserPresentationMode {
  const configured = configuredHeadless ? "headless" : "headed";
  return BrowserPresentationModeSchema.parse(requested === undefined ? configured : requested);
}


export function assertDuoAutopilotReady(config: Config): void {
  if (!config.features.duoWebAuthn) return;
  const manifest = join(config.paths.duoExtensionDir, "manifest.json");
  let isFile: boolean;
  try {
    isFile = statSync(manifest).isFile();
  } catch (error) {
    throw new Error(
      `Duo Autopilot extension is not loadable: ${manifest} is unreadable. Duo cannot clear unattended without it; place the unpacked extension there or set features.duoWebAuthn=false and expect a manual prompt.`,
      { cause: error },
    );
  }
  if (!isFile) {
    throw new Error(`Duo Autopilot extension is not loadable: ${manifest} is not a regular file`);
  }
  // `requireSecretFile` is the ONLY credential-file reader; it also enforces
  // the 0600-or-stricter permission and size limits ref clock-config-secrets requires.
  requireSecretFile("duoWebauthnCredential", config);
}

function bindingFor(bindings: BrowserSystemBindings, system: BrowserSystemId): BrowserSystemBinding {
  const binding = bindings[system];
  if (binding === undefined) {
    throw new Error(
      `${system} has no landed browser-session binding (driver + login recipe); refusing to open a browser that cannot be used`,
    );
  }
  return binding;
}

export class PlaywrightWorkerSessionFactory implements WorkerBrowserSessionFactory {
  readonly #options: BrowserSessionFactoryOptions;
  readonly #bindings: BrowserSystemBindings;
  readonly #launcher: PersistentContextLauncher;
  readonly #owned = new Map<string, Readonly<{ context: BrowserContext; lifecycle: ContextLifecycle }>>();

  constructor(options: BrowserSessionFactoryOptions) {
    this.#options = options;
    this.#bindings = options.bindings ?? BROWSER_SYSTEM_BINDINGS;
    this.#launcher = options.launcher ?? DEFAULT_LAUNCHER;
  }

  async probeProfile(input: Parameters<WorkerBrowserSessionFactory["probeProfile"]>[0]): Promise<void> {
    input.signal.throwIfAborted();
    const { config, clock, scheduler } = this.#options, system = BrowserSystemIdSchema.parse(input.system);
    const profileDirectory = workerProfileDirectory({ profileRoot: config.paths.browserProfileRoot,
      slotOrdinal: this.#options.slotOrdinal(WorkerIdSchema.parse(input.workerId), system), system });
    assertPrivateProfilePath(config.paths.browserProfileRoot, profileDirectory);
    if (profileReservations.has(profileDirectory)) throw new ProfileCustodyUnavailableError();
    mkdirSync(profileDirectory, { recursive: true, mode: 0o700 });
    try {
      await probeClosedBrowserProfile({ profileRoot: config.paths.browserProfileRoot, launcher: this.#launcher,
        launch: { profileDirectory, extensionDirectory: config.paths.duoExtensionDir, downloadsPath: config.paths.downloadsDir,
          viewport: { width: config.display.screenWidth, height: config.display.screenHeight }, timeoutMs: config.timeouts.sessionAcquireMs },
        clock, scheduler, closeProofMs: config.browser.closeProofMs, signal: input.signal });
    } catch (error) {
      if (error instanceof BrowserProfileStillClosingError || error instanceof ProfileCustodyUnavailableError) throw error;
      throw new BrowserSessionClosureUnprovedError([error], `${system} native profile probe closure is unproved`, { cause: error });
    }
  }

  async open(input: Readonly<{
    workerId: WorkerId;
    workflowId: WorkflowId;
    system: BrowserSystemId;
    instance?: string;
    configFingerprint: Fingerprint;
    browserMode?: BrowserPresentationMode;
    acceptDownloads: boolean;
    exclusive: boolean;
    signal: AbortSignal;
    duoCeremony: DuoCeremonyGate;
    acquisitionRemainingMs?: () => number;
    claimStaleRequestRecovery?: () => boolean;
  }>): Promise<WorkerBrowserResource> {
    const { config } = this.#options;
    const workerId = WorkerIdSchema.parse(input.workerId);
    WorkflowIdSchema.parse(input.workflowId);
    const system = BrowserSystemIdSchema.parse(input.system);
    const configFingerprint = FingerprintSchema.parse(input.configFingerprint);
    const browserMode = browserModeFor(input.browserMode, config.browser.headless);
    const instance = RuntimeInstanceSchema.parse(input.instance);
    const binding = bindingFor(this.#bindings, system);
    if (input.exclusive) {
      throw new Error(
        `${system} requested an identity-exclusive session; the exclusive OnBase lease is not landed in this factory`,
      );
    }
    if (input.signal.aborted) throw new Error(`${system} browser session open was cancelled before launch`);

    const profileDirectory = workerProfileDirectory({
      profileRoot: config.paths.browserProfileRoot,
      slotOrdinal: this.#options.slotOrdinal(workerId, system), system,
    });
    const signInFingerprint = browserSignInFingerprint(config, this.#options.protectedSecrets, system, instance);
    const profileIdentity = { workerId, system, instance, configFingerprint, signInFingerprint, browserMode, profileDirectory };
    const { profileRevision, resetRequired, ...admittedIdentity } = BrowserProfileAdmissionSchema.parse(await this.#options.admitProfile(profileIdentity));
    if (canonicalJsonStringify(admittedIdentity) !== canonicalJsonStringify(profileIdentity)) throw new ProfileCustodyUnavailableError();
    if (profileReservations.has(profileDirectory)) throw new ProfileCustodyUnavailableError();
    assertPrivateProfilePath(config.paths.browserProfileRoot, profileDirectory);
    assertDuoAutopilotReady(config);
    profileReservations.add(profileDirectory);
    if (resetRequired) {
      const previous = await this.#launchProfile(profileDirectory, browserMode, input.acceptDownloads, system);
      const lifecycle = observeContextLifecycle(previous);
      this.#owned.set(profileDirectory, { context: previous, lifecycle });
      try {
        await this.#closeWithProof(previous, lifecycle, system, "fresh-boundary");
        this.#releaseProfile(profileDirectory);
      } catch (error) {
        throw new BrowserSessionClosureUnprovedError([error], `${system} browser profile reset did not close its launch probe`, { cause: error });
      }
      deleteOwnedBrowserProfile(config.paths.browserProfileRoot, profileDirectory);
      profileReservations.add(profileDirectory);
    }
    const context = await this.#launchProfile(profileDirectory, browserMode, input.acceptDownloads, system);

    const lifecycle = observeContextLifecycle(context);
    try {
      this.#owned.set(profileDirectory, { context, lifecycle });
      if (config.features.duoWebAuthn) await provisionDuo(context, config);
      const existing = context.pages();
      const page = existing[0] ?? await context.newPage();
      const diagnostics = attachBrowserDiagnostics(page, this.#options.clock);
      let pageVersion = 1;
      const onNavigation = this.#options.onNavigation;
      page.on("framenavigated", (frame) => {
        pageVersion += 1;
        if (frame === page.mainFrame()) onNavigation?.(frame.url());
      });
      page.on("frameattached", () => { pageVersion += 1; });
      page.on("framedetached", () => { pageVersion += 1; });
      const sessionId = BrowserSessionIdSchema.parse(this.#options.newSessionId());
      const emit = (phase: DebugEvent["phase"], code?: string): void => this.#options.onDebug?.(workerId, { phase, correlationId: sessionId, ...(code === undefined ? {} : { code }) });
      const label = `worker ${workerId} ${system} session`;
      const resource: WorkerBrowserResource = {
        sessionId,
        system,
        ...(input.instance === undefined ? {} : { instance: input.instance }),
        configFingerprint,
        signInFingerprint,
        browserMode,
        profileDirectory,
        profileRevision,
        acceptDownloads: input.acceptDownloads,
        exclusive: input.exclusive,
        driver: binding.createDriver(page, this.#options.clock),
        beginDiagnostics: () => diagnostics.begin(),
        endDiagnostics: () => diagnostics.end(),
        screenshot: async (): Promise<BrowserScreenshotEvidence> => {
          const version = pageVersion;
          const identity = { pageVersion: version, sessionId, observedAt: this.#options.clock.now().toISOString() };
          const unavailable = (reason: Extract<BrowserScreenshotEvidence, { state: "unavailable" }>["reason"]): BrowserScreenshotEvidence => Object.freeze({ ...identity, state: "unavailable", reason });
          if (page.isClosed()) return unavailable("page-closed");
          try {
            const proof = await binding.verifyAuthenticated({ page, config, recordEvidence: this.#recordEvidence });
            if (!proof.authenticated) return unavailable("authentication-unverified");
            const frames = page.frames();
            const secretControls = 'input[type="password"], input[autocomplete="one-time-code"], input[autocomplete="current-password"], input[autocomplete="new-password"]';
            for (const frame of frames) if (await frame.locator(secretControls).count() > 0) return unavailable("secret-controls-present");
            if (pageVersion !== version) return unavailable("page-changed");
            const capture = await captureFullPage(page, {
              secretControls,
              afterCapture: async () => {
                const after = await binding.verifyAuthenticated({ page, config, recordEvidence: this.#recordEvidence });
                if (!after.authenticated || pageVersion !== version) throw new FullPageCaptureRefusedError("page-changed");
              },
              mask: () => page.frames().map(frame => frame.locator(UCPATH_PENDING_READ_RECIPES.ssn)),
              assertSafe: async () => {
                if (pageVersion !== version) throw new FullPageCaptureRefusedError("page-changed");
                for (const frame of page.frames()) if (await frame.locator(secretControls).count() > 0) throw new FullPageCaptureRefusedError("secret-controls-present");
                if (pageVersion !== version) throw new FullPageCaptureRefusedError("page-changed");
              },
            });
            if (pageVersion !== version) return unavailable("page-changed");
            for (const frame of frames) if (await frame.locator(secretControls).count() > 0) return unavailable("secret-controls-present");
            if (pageVersion !== version) return unavailable("page-changed");
            return Object.freeze({ ...identity, state: "available", ...capture, diagnosticAttachments: diagnostics.snapshot() });
          } catch (error) {
            if (error instanceof FullPageCaptureRestoreError) throw error;
            if (error instanceof FullPageCaptureRefusedError) return unavailable(error.reason);
            if (pageVersion !== version) return unavailable("page-changed");
            return unavailable("verification-failed");
          }
        },
        authentication: {
          authenticate: async (requested: BrowserSystemId, options): Promise<"logged-in" | "already-authenticated"> => {
            if (requested !== system) {
              throw new Error(`${system} browser session cannot authenticate ${requested}`);
            }
            if (options.instance !== undefined && options.instance !== instance) {
              throw new Error(
                `${system} browser session was opened for instance ${instance} but login requested ${options.instance}`,
              );
            }
            const loginContext: SystemLoginContext = {
              page,
              config,
              instance,
              label,
              signal: options.signal ?? input.signal,
              credentials: readSsoCredentials(this.#options.protectedSecrets),
              recordEvidence: this.#recordEvidence,
              duoCeremony: input.duoCeremony,
              ...(input.claimStaleRequestRecovery === undefined ? {} : { claimStaleRequestRecovery: input.claimStaleRequestRecovery }),
              ...(input.acquisitionRemainingMs === undefined ? {} : { acquisitionRemainingMs: input.acquisitionRemainingMs }),
            };
            emit("started");
            try {
              const result = await binding.login(loginContext);
              emit("settled");
              return result;
            } catch (error) { emit("failed", "session-authentication-failed"); throw error; }
          },
        },
        reset: async (resetInput): Promise<void> => {
          await this.#resetToNeutralState(binding, page, instance, label, resetInput.signal);
          emit("reset");
        },
        close: async (closeInput): Promise<BrowserSessionCloseProof> => {
          await this.#closeWithProof(context, lifecycle, system, closeInput.reason);
          this.#releaseProfile(profileDirectory);
          diagnostics.dispose();
          emit("released");
          return Object.freeze({ sessionId, system, pagesClosed: true, contextClosed: true });
        },
      };
      return Object.freeze(resource);
    } catch (error) {
      // The context exists but the resource does not, so nothing else can ever
      // close it. Prove the cleanup here or surface BOTH failures.
      try {
        await this.#closeWithProof(context, lifecycle, system, "login-failed");
        this.#releaseProfile(profileDirectory);
      } catch (closeError) {
        throw new BrowserSessionClosureUnprovedError(
          [error, closeError],
          `${system} browser session setup failed and its context could not be proven closed`,
          { cause: closeError },
        );
      }
      throw error;
    }
  }


  async discardProfile(input: Readonly<{
    workerId: WorkerId;
    system: BrowserSystemId;
    instance?: string;
    configFingerprint: Fingerprint;
    browserMode?: BrowserPresentationMode;
  }>): Promise<Readonly<{ profileDirectory: string }>> {
    const { config } = this.#options;
    const browserMode = browserModeFor(input.browserMode, config.browser.headless);
    const profileDirectory = workerProfileDirectory({
      profileRoot: config.paths.browserProfileRoot,
      slotOrdinal: this.#options.slotOrdinal(input.workerId, input.system),
      system: input.system,
    });
    const instance = RuntimeInstanceSchema.parse(input.instance);
    const identity = { ...input, instance, browserMode, profileDirectory, signInFingerprint: browserSignInFingerprint(config, this.#options.protectedSecrets, input.system, instance) };
    const { profileRevision: _revision, resetRequired: _reset, ...admitted } = BrowserProfileAdmissionSchema.parse(await this.#options.admitProfile(identity));
    if (canonicalJsonStringify(admitted) !== canonicalJsonStringify(identity)) throw new ProfileCustodyUnavailableError();
    if (profileReservations.has(profileDirectory)) throw new ProfileCustodyUnavailableError();
    assertPrivateProfilePath(config.paths.browserProfileRoot, profileDirectory);
    deleteOwnedBrowserProfile(config.paths.browserProfileRoot, profileDirectory);
    return Object.freeze({ profileDirectory });
  }

  async #launchProfile(profileDirectory: string, browserMode: BrowserPresentationMode, acceptDownloads: boolean, system: BrowserSystemId, timeoutMs?: number): Promise<BrowserContext> {
    const { config } = this.#options;
    try {
      mkdirSync(dirname(profileDirectory), { recursive: true, mode: 0o700 });
      return await this.#launcher.launch({ profileDirectory, headless: browserMode === "headless",
        extensionDirectory: config.paths.duoExtensionDir, acceptDownloads, downloadsPath: config.paths.downloadsDir,
        viewport: { width: config.display.screenWidth, height: config.display.screenHeight },
        ...(timeoutMs === undefined ? {} : { timeoutMs }) });
    } catch (error) {
      if (error instanceof Error && ["Failed to create a ProcessSingleton for your profile directory.", "Opening in existing browser session."]
        .some(message => error.message.includes(message))) {
        profileReservations.delete(profileDirectory);
        throw new BrowserProfileStillClosingError(error);
      }
      throw new BrowserSessionClosureUnprovedError([error], `${system} browser launch failed and its closure is unproved`, { cause: error });
    }
  }

  #releaseProfile(profileDirectory: string): void {
    const owned = this.#owned.get(profileDirectory);
    if (owned === undefined || !owned.lifecycle.closed() || owned.context.pages().length !== 0) throw new ProfileCustodyUnavailableError();
    this.#owned.delete(profileDirectory);
    profileReservations.delete(profileDirectory);
  }

  readonly #recordEvidence = (evidence: AuthenticatedApplicationEvidence): void => {
    this.#options.onAuthenticationEvidence?.(evidence);
  };

  // Neutral reset must pass the same authenticated-application proof as login.
  async #resetToNeutralState(
    binding: BrowserSystemBinding,
    page: Page,
    instance: RuntimeInstance,
    label: string,
    signal: AbortSignal,
  ): Promise<void> {
    const { config } = this.#options;
    if (signal.aborted) {
      throw new Error(`${binding.system} neutral reset was cancelled before navigation`);
    }
    const entry = resolveSystemEntryUrl(config, binding.system, instance, label);
    await page.goto(entry, {
      waitUntil: "domcontentloaded",
      timeout: config.timeouts.navigationMs,
    });
    await assertAuthenticatedApplication(
      binding.system,
      { page, config, recordEvidence: this.#recordEvidence },
      binding.verifyAuthenticated,
      "the neutral reset did not land on the authenticated application; the session is no longer reusable",
    );
  }

  async #closeWithProof(
    context: BrowserContext,
    lifecycle: ContextLifecycle,
    system: BrowserSystemId,
    reason: BrowserSessionCloseReason,
  ): Promise<void> {
    return closeContextWithProof({ clock: this.#options.clock, scheduler: this.#options.scheduler,
      closeProofMs: this.#options.config.browser.closeProofMs }, context, lifecycle, system, reason);
  }
}


export function deleteOwnedBrowserProfile(profileRoot: string, profileDirectory: string): void {
  const root = AbsolutePathSchema.parse(profileRoot), directory = AbsolutePathSchema.parse(profileDirectory);
  assertPrivateProfilePath(root, directory);
  if ([...profileReservations].some(path => path === directory || path.startsWith(`${directory}${sep}`))) throw new ProfileCustodyUnavailableError();
  const verify = (path: string): void => {
    const metadata = lstatSync(path, { throwIfNoEntry: false });
    if (metadata === undefined) return;
    if (metadata.isSymbolicLink() || metadata.uid !== (process.getuid?.() ?? -1) || (metadata.mode & 0o022) !== 0
      || !(metadata.isDirectory() || metadata.isFile()) || metadata.isFile() && metadata.nlink !== 1) throw new ProfileCustodyUnavailableError();
    if (metadata.isDirectory()) for (const name of readdirSync(path)) {
      if (["SingletonLock", "SingletonSocket", "SingletonCookie"].includes(name)) throw new ProfileCustodyUnavailableError();
      verify(join(path, name));
    }
  };
  verify(directory);
  rmSync(directory, { recursive: true, force: true });
  if (lstatSync(directory, { throwIfNoEntry: false }) !== undefined) throw new ProfileCustodyUnavailableError();
}

export class DuoProvisioningError extends Error {
  readonly code = "duo-extension-provisioning-unavailable";
  constructor() { super("Duo extension session provisioning could not be verified."); this.name = "DuoProvisioningError"; }
}

export function browserSignInFingerprint(config: Config, secrets: ProtectedSecretSource, system: BrowserSystemId, instance: RuntimeInstance): Fingerprint {
  const { entries } = ProtectedStoreRecordSchema.parse(secrets.read());
  const urls = system === "new-kronos" ? config.urls.newKronos : system === "old-kronos" ? config.urls.oldKronos : config.urls[system];
  return FingerprintSchema.parse(sha256Hex(canonicalJsonStringify({ system, instance, urls,
    credentialIds: { userId: entries.ucpathUserId?.valueId ?? null, password: entries.ucpathPassword?.valueId ?? null },
    duo: { enabled: config.features.duoWebAuthn, credentialPath: config.paths.duoCredential,
      extensionPath: config.paths.duoExtensionDir, publicIdentity: config.features.duoWebAuthn ? resolveSecretFileIdentity("duoWebauthnCredential", config) : null },
  })));
}

async function provisionDuo(context: BrowserContext, config: Config): Promise<void> {
  const ownedWorker = (url: string): boolean => /^chrome-extension:\/\/[a-p]{32}\/src\/background\.js$/u.test(url);
  try {
    const parsed = DuoCredentialFileSchema.parse(JSON.parse(requireSecretFile("duoWebauthnCredential", config).toString("utf8")));
    const credentials = Array.isArray(parsed) ? parsed : "credentials" in parsed ? parsed.credentials : [parsed];
    const current = context.serviceWorkers().filter(worker => ownedWorker(worker.url()));
    if (current.length > 1) throw new DuoProvisioningError();
    const worker = current[0] ?? await context.waitForEvent("serviceworker", { predicate: worker => ownedWorker(worker.url()), timeout: config.timeouts.navigationMs });
    await worker.evaluate(provisionDuoSession, credentials);
  } catch { throw new DuoProvisioningError(); }
}

interface ExtensionStorageArea {
  get?: (key: string) => unknown;
  set?: (items: Record<string, unknown>) => unknown;
  setAccessLevel?: (options: { accessLevel: string }) => unknown;
}

// Playwright runs this from its source text inside the extension worker, so it declares no inner functions:
// the runtime compiler wraps those in a module helper the worker does not have.
async function provisionDuoSession(credentials: readonly z.infer<typeof DuoCredentialSchema>[]): Promise<void> {
  const storage = (globalThis as { chrome?: { storage?: { session?: ExtensionStorageArea; local?: ExtensionStorageArea } } }).chrome?.storage;
  const session = storage?.session, local = storage?.local;
  if (typeof session?.get !== "function" || typeof session.set !== "function" || typeof session.setAccessLevel !== "function"
    || typeof local?.get !== "function") throw new Error("duo-session-storage-unavailable");
  const persistent: unknown = await local.get("duoCredentials");
  if (persistent !== null && typeof persistent === "object" && "duoCredentials" in persistent) throw new Error("duo-persistent-credential-refused");
  await session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  await session.set({ duoCredentials: credentials });
  const stored: unknown = await session.get("duoCredentials");
  const copies: unknown = stored !== null && typeof stored === "object" && "duoCredentials" in stored ? stored.duoCredentials : undefined;
  if (!Array.isArray(copies) || copies.length !== credentials.length) throw new Error("duo-session-provisioning-unverified");
  // Chrome storage returns object keys sorted, so compare field by field.
  for (const [index, original] of credentials.entries()) {
    const copy: unknown = copies[index];
    if (copy === null || typeof copy !== "object" || Object.keys(copy).length !== Object.keys(original).length) throw new Error("duo-session-provisioning-unverified");
    for (const [key, value] of Object.entries(original)) if (Reflect.get(copy, key) !== value) throw new Error("duo-session-provisioning-unverified");
  }
}

// UCSD systems share an SSO realm and credential pair, but hold distinct application sessions.
function readSsoCredentials(source: ProtectedSecretSource): SsoCredentials {
  return {
    userId: requireSecret("ucpathUserId", source),
    password: requireSecret("ucpathPassword", source),
  };
}
