import { readProtectedCredentials } from "../../../models/config/secrets.js";
import { fileStatus, privateFileNumber } from "../../storage/file-identity.js";
import type { ExclusiveSessionLease } from "../../../models/sessions/exclusive-session-lease.js";
import { ERROR_CATALOG } from "../../../models/failures/error-catalog.js";
import { createNativeBrowserProbe, BrowserLaunchUncertainError, chromiumProfileInUse, DEFAULT_BROWSER_LAUNCHER as DEFAULT_LAUNCHER, closeContextWithProof, observeContextLifecycle, type ContextLifecycle, type BrowserDeadlineScheduler, type PersistentContextLauncher } from "./native-browser.js";
import { BrowserProfileStillClosingError, BrowserSessionClosureUnprovedError } from "../../../workflow-kit/session.js";
import { privatePathRejects } from "../../storage/private-path.js";
import type { BrowserRoots, BrowserRootLaunch, BrowserRootLaunchInput } from "../../storage/browser-roots.js";
import type { AuthorityDatabase } from "../../storage/sqlite/authority-database.js";
import { hasUnprovedSourceClosure, retainAuthoritySourceClosure } from "../../storage/source-closure.js";
import { provisionWorkflowDuo } from "./workflow-duo-provider.js";
import type { DuoSigningSource } from "../../storage/configuration/duo-signing.js";
import { stageFastDuoExtension } from "./fast-duo-extension.js";
import { ProfileCustodyUnavailableError, profileReservations, assertPrivateProfilePath, workerProfileDirectory } from "../../storage/browser-roots.js";
export { ProfileCustodyUnavailableError, PROFILE_CUSTODY_UNAVAILABLE_TEXT, workerProfileDirectory } from "../../storage/browser-roots.js";
export type { BrowserDeadlineScheduler, PersistentContextLauncher } from "./native-browser.js";
import { UCPATH_PENDING_READ_RECIPES } from "../../systems/ucpath/driver/ui-registry.js";
import { z } from "zod";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { lstatSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import type { BrowserContext, Frame, Page } from "playwright";
import type {
  BrowserSessionCloseProof,
  BrowserSessionCloseReason,
  WorkerBrowserResource,
  WorkerBrowserSessionFactory,
  BrowserScreenshotEvidence,
} from "../../../workflow-kit/session.js";
import { assertDuoCeremonyLeaseToken, type DuoCeremonyLeaseToken, type DuoCeremonyGate } from "../../../workflow-kit/duo-ceremony-lease.js";
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
import { captureFullPage, FullPageCaptureRefusedError, FullPageCaptureRestoreError } from "./full-page-capture.js";
import { serializeErrorCauses } from "../../../models/failures/error-origins.js";

export const BrowserProfileAdmissionSchema = z.strictObject({
  workerId: WorkerIdSchema, system: BrowserSystemIdSchema, instance: RuntimeInstanceSchema,
  configFingerprint: FingerprintSchema, browserMode: BrowserPresentationModeSchema,
  signInFingerprint: FingerprintSchema,
  profileDirectory: AbsolutePathSchema, profileRevision: PositiveIntSchema,
  resetRequired: z.boolean(),
});
export type BrowserProfileAdmission = z.infer<typeof BrowserProfileAdmissionSchema>;

export interface BrowserSessionFactoryOptions {
  readonly browserRoots: BrowserRoots;
  readonly browserOwner: Readonly<{ database: AuthorityDatabase; profileId: string }>;
  readonly config: Config;
  readonly duo?: DuoSigningSource;
  readonly protectedSecrets: ProtectedSecretSource;
  readonly isolation: RuntimeIsolation;
  readonly clock: Clock;
  readonly scheduler: BrowserDeadlineScheduler;
  readonly newSessionId: () => string;
  readonly assertCurrent: (workerId: WorkerId) => void;
  readonly slotOrdinal: (workerId: WorkerId, system: BrowserSystemId) => number;
  readonly admitProfile: (input: Readonly<{ workerId: WorkerId; system: BrowserSystemId; instance: RuntimeInstance;
    configFingerprint: Fingerprint; signInFingerprint: Fingerprint; browserMode: BrowserPresentationMode; profileDirectory: string }>, purpose?: "acquire" | "cleanup") => Promise<BrowserProfileAdmission>;
  readonly bindings?: BrowserSystemBindings;
  readonly launcher?: PersistentContextLauncher;
  // Session proof diagnostics name the observed marker, never its sensitive value.
  readonly onAuthenticationEvidence?: (evidence: AuthenticatedApplicationEvidence) => void;

  readonly onNavigation?: (url: string) => void;
  readonly onDebug?: (workerId: WorkerId, event: Pick<DebugEvent, "phase" | "correlationId"> & Partial<Pick<DebugEvent, "code" | "durationMs" | "pinned" | "message" | "stack" | "reason" | "area">>) => void;
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


export function assertFastDuoReady(config: Config, duo?: DuoSigningSource): void {
  if (!config.features.duoWebAuthn) return;
  const manifest = join(config.paths.duoExtensionDir, "workflow-manifest.json");
  let isFile: boolean;
  try {
    isFile = statSync(manifest).isFile();
  } catch (error) {
    throw new Error(
      `Fast Duo extension is not loadable: ${manifest} is unreadable. Duo cannot clear unattended without it; place the unpacked extension there or set features.duoWebAuthn=false and expect a manual prompt.`,
      { cause: error },
    );
  }
  if (!isFile) {
    throw new Error(`Fast Duo extension is not loadable: ${manifest} is not a regular file`);
  }
  if (duo === undefined) throw new DuoProvisioningError();
  duo.assertCurrent();
  duo.credentials();
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

// A Playwright message starts "<object>.<method>: [<Class>: ]", and the page chooses the class text; only these fixed names leave it.
const PLAYWRIGHT_OBJECTS = new Set(["page", "frame", "locator", "elementHandle", "jsHandle", "browserContext"]);
const PLAYWRIGHT_METHODS = new Set(["evaluate", "evaluateAll", "evaluateHandle", "screenshot", "setViewportSize", "waitForTimeout", "count",
  "cookies", "isVisible", "waitFor", "inputValue", "textContent", "frameElement", "goto"]);
const PAGE_ERROR_CLASSES = new Set(["Error", "TypeError", "ReferenceError", "RangeError", "SyntaxError", "EvalError", "URIError", "AggregateError"]);
function playwrightCall(error: unknown): string | undefined {
  const match = error instanceof Error ? /^([A-Za-z]+)\.([A-Za-z]+): (?:([A-Za-z]+): )?/u.exec(error.message) : null;
  if (match === null) return undefined;
  const [, object, method, errorClass] = match;
  const call = PLAYWRIGHT_OBJECTS.has(object) && PLAYWRIGHT_METHODS.has(method) ? `${object}-${method}`.toLowerCase() : "unknown-call";
  return errorClass === undefined ? call : `${call}-${PAGE_ERROR_CLASSES.has(errorClass) ? errorClass.toLowerCase() : "page-error"}`;
}

export class PlaywrightWorkerSessionFactory implements WorkerBrowserSessionFactory {
  readonly #options: BrowserSessionFactoryOptions;
  readonly #bindings: BrowserSystemBindings;
  readonly #launcher: PersistentContextLauncher;
  readonly #launches = new Map<string, BrowserRootLaunch>();
  readonly #owned = new Map<string, Readonly<{ context: BrowserContext; lifecycle: ContextLifecycle; duo?: Awaited<ReturnType<typeof provisionWorkflowDuo>> }>>();

  constructor(options: BrowserSessionFactoryOptions) {
    this.#options = options;
    this.#bindings = options.bindings ?? BROWSER_SYSTEM_BINDINGS;
    this.#launcher = options.launcher ?? DEFAULT_LAUNCHER;
  }

  async probeProfile(input: Parameters<WorkerBrowserSessionFactory["probeProfile"]>[0]): Promise<void> {
    input.signal.throwIfAborted();
    this.#options.assertCurrent(WorkerIdSchema.parse(input.workerId));
    const { config, clock, scheduler } = this.#options, system = BrowserSystemIdSchema.parse(input.system);
    const profileDirectory = workerProfileDirectory({ profileRoot: config.paths.browserProfileRoot,
      slotOrdinal: this.#options.slotOrdinal(WorkerIdSchema.parse(input.workerId), system), system });
    assertPrivateProfilePath(config.paths.browserProfileRoot, profileDirectory);
    if (profileReservations.has(profileDirectory)) throw new ProfileCustodyUnavailableError();
    try {
      await this.#options.browserRoots.probe(this.#rootInput(WorkerIdSchema.parse(input.workerId), profileDirectory, null), createNativeBrowserProbe({
        launcher: this.#launcher, clock, scheduler, closeProofMs: config.browser.closeProofMs,
        launchTimeoutMs: config.timeouts.sessionAcquireMs, signal: input.signal }));
    } catch (error) {
      if (error instanceof BrowserProfileStillClosingError || error instanceof ProfileCustodyUnavailableError) throw error;
      throw new BrowserSessionClosureUnprovedError([error], `${system} native profile probe closure is unproved`, { cause: error });
    }
    this.#options.assertCurrent(WorkerIdSchema.parse(input.workerId));
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
    replacesSessionId?: string;
  }>): Promise<WorkerBrowserResource> {
    const { config } = this.#options;
    const workerId = WorkerIdSchema.parse(input.workerId);
    let refusal: Readonly<{ error: unknown }> | undefined;
    const assertCurrent = (): void => {
      if (refusal !== undefined) throw refusal.error;
      this.#options.assertCurrent(workerId);
    };
    assertCurrent();
    WorkflowIdSchema.parse(input.workflowId);
    const system = BrowserSystemIdSchema.parse(input.system);
    const configFingerprint = FingerprintSchema.parse(input.configFingerprint);
    const browserMode = browserModeFor(input.browserMode, config.browser.headless);
    const instance = RuntimeInstanceSchema.parse(input.instance);
    const binding = bindingFor(this.#bindings, system);
    if ((binding.exclusive === true) !== input.exclusive) throw new Error("browser-session-exclusivity-mismatch");
    if (input.signal.aborted) throw new Error(`${system} browser session open was cancelled before launch`);

    const profileDirectory = workerProfileDirectory({
      profileRoot: config.paths.browserProfileRoot,
      slotOrdinal: this.#options.slotOrdinal(workerId, system), system,
    });
    const signInFingerprint = browserSignInFingerprint(config, this.#options.protectedSecrets, system, instance, this.#options.duo);
    const profileIdentity = { workerId, system, instance, configFingerprint, signInFingerprint, browserMode, profileDirectory };
    const { profileRevision, resetRequired, ...admittedIdentity } = BrowserProfileAdmissionSchema.parse(await this.#options.admitProfile(profileIdentity));
    assertCurrent();
    if (canonicalJsonStringify(admittedIdentity) !== canonicalJsonStringify(profileIdentity)) throw new ProfileCustodyUnavailableError();
    if (profileReservations.has(profileDirectory)) throw new ProfileCustodyUnavailableError();
    assertPrivateProfilePath(config.paths.browserProfileRoot, profileDirectory);
    assertFastDuoReady(config, this.#options.duo);
    const sessionId = BrowserSessionIdSchema.parse(this.#options.newSessionId());
    const exclusiveLease = input.exclusive ? await this.#acquireExclusiveSession({ workerId, sessionId, system, instance,
      signal: input.signal, assertCurrent, ...(input.replacesSessionId === undefined ? {} : { replacesSessionId: input.replacesSessionId }), ...(input.acquisitionRemainingMs === undefined ? {} : { remainingMs: input.acquisitionRemainingMs }) }) : undefined;
    let launchStarted = false;
    let reserved = false;
    let context: BrowserContext;
    try {
      input.signal.throwIfAborted(); assertCurrent();
      if (profileReservations.has(profileDirectory)) throw new ProfileCustodyUnavailableError();
      profileReservations.add(profileDirectory);
      reserved = true;
      const rootOwner = this.#rootInput(workerId, profileDirectory, signInFingerprint);
      if (resetRequired) {
        profileReservations.delete(profileDirectory);
        reserved = false;
        await this.#unusedProfile(rootOwner, async unused => { assertCurrent(); unused.remove(); });
        profileReservations.add(profileDirectory);
        reserved = true;
      }
      input.signal.throwIfAborted(); assertCurrent();
      launchStarted = true;
      context = await this.#launchProfile(rootOwner, browserMode, input.acceptDownloads, system);
    } catch (error) {
      if (!launchStarted && !hasUnprovedSourceClosure(error)) {
        if (reserved) profileReservations.delete(profileDirectory);
        if (exclusiveLease !== undefined) {
          try { this.#options.browserOwner.database.authority.exclusiveSessionLeases.release(exclusiveLease, this.#options.clock.now().toISOString()); }
          catch (releaseError) { throw new AggregateError([error, releaseError], "exclusive session prelaunch cleanup failed", { cause: releaseError }); }
        }
      }
      throw error;
    }

    const lifecycle = observeContextLifecycle(context);
    let signingToken: DuoCeremonyLeaseToken | undefined;
    try {
      this.#owned.set(profileDirectory, { context, lifecycle });
      assertCurrent();
      if (config.features.duoWebAuthn) {
        const source = this.#options.duo;
        if (source === undefined) throw new DuoProvisioningError();
        const duo = await provisionWorkflowDuo({ context, config, source, accountName: requireSecret("ucpathUserId", this.#options.protectedSecrets),
          assertSigningScope: () => {
            assertCurrent();
            assertDuoCeremonyLeaseToken(signingToken, { system });
            if (signingToken.holder.workerId !== workerId || signingToken.credentialKey !== source.identity()
              || this.#options.clock.nowMs() >= Date.parse(signingToken.expiresAt)) throw new DuoProvisioningError();
          },
          assertOwner: () => { input.signal.throwIfAborted(); assertCurrent();
            if (lifecycle.closed() || this.#owned.get(profileDirectory)?.context !== context) throw new DuoProvisioningError(); } }).catch(error => { throw new DuoProvisioningError({ cause: error }); });
        this.#owned.set(profileDirectory, { context, lifecycle, duo });
      }
      assertCurrent();
      const existing = context.pages();
      const page = existing[0] ?? await context.newPage();
      assertCurrent();
      const recordEvidence = (evidence: AuthenticatedApplicationEvidence): void => { assertCurrent(); this.#options.onAuthenticationEvidence?.(evidence); };
      let pageVersion = 1;
      const detach = (): void => {
        page.off("framenavigated", navigated);
        page.off("frameattached", frameChanged);
        page.off("framedetached", frameChanged);
      };
      const observeEvent = (): Readonly<{ state: "current" | "revoked" }> => {
        try { assertCurrent(); return { state: "current" }; }
        catch (error) {
          const errors = [error];
          refusal = { error };
          try { detach(); } catch (cleanupError) { errors.push(cleanupError); }
          try { diagnostics.dispose(); } catch (cleanupError) { errors.push(cleanupError); }
          if (errors.length > 1) refusal = { error: new AggregateError(errors, "Browser event subscription cleanup failed") };
          return { state: "revoked" };
        }
      };
      const navigated = (frame: Frame): void => {
        if (observeEvent().state === "revoked") return;
        pageVersion += 1;
        if (frame === page.mainFrame()) this.#options.onNavigation?.(frame.url());
      };
      const frameChanged = (): void => { if (observeEvent().state === "current") pageVersion += 1; };
      const diagnostics = attachBrowserDiagnostics(page, this.#options.clock, observeEvent);
      page.on("framenavigated", navigated);
      page.on("frameattached", frameChanged);
      page.on("framedetached", frameChanged);
      let closeProof: BrowserSessionCloseProof | undefined;
      let profileReleased = false;
      const emit = (phase: DebugEvent["phase"], code?: string): void => { assertCurrent(); this.#options.onDebug?.(workerId, { phase, correlationId: sessionId, ...(code === undefined ? {} : { code }) }); };
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
        driver: binding.createDriver(page, this.#options.clock, assertCurrent),
        beginDiagnostics: () => { assertCurrent(); diagnostics.begin(); },
        endDiagnostics: () => diagnostics.end(),
        screenshot: async (sampleLabels?: readonly string[]): Promise<BrowserScreenshotEvidence> => {
          assertCurrent();
          const version = pageVersion;
          const identity = { pageVersion: version, sessionId, observedAt: this.#options.clock.now().toISOString() };
          const unavailable = (reason: Extract<BrowserScreenshotEvidence, { state: "unavailable" }>["reason"]): BrowserScreenshotEvidence => Object.freeze({ ...identity, state: "unavailable", reason });
          if (page.isClosed()) return unavailable("page-closed");
          try {
            const proof = await binding.verifyAuthenticated({ page, config, recordEvidence, assertCurrent });
            assertCurrent();
            if (!proof.authenticated) return unavailable("authentication-unverified");
            const frames = page.frames();
            const secretControls = 'input[type="password"], input[autocomplete="one-time-code"], input[autocomplete="current-password"], input[autocomplete="new-password"]';
            // The capture observer watches only the light DOM, so an unpainted control is tolerated there alone.
            const secretPresent = async (frame: Frame): Promise<boolean> => {
              assertCurrent();
              const painted = await frame.locator(secretControls).filter({ visible: true }).count();
              assertCurrent();
              if (painted > 0) return true;
              const reachable = await frame.locator(secretControls).count();
              assertCurrent();
              const watched = await frame.evaluate(selector => document.querySelectorAll(selector).length, secretControls);
              assertCurrent();
              return reachable !== watched;
            };
            for (const frame of frames) {
              if (await secretPresent(frame)) return unavailable("secret-controls-present");
            }
            if (pageVersion !== version) return unavailable("page-changed");
            const capture = await captureFullPage(page, {
              ...(sampleLabels === undefined ? {} : { sampleLabels }),
              assertCurrent,
              secretControls,
              afterCapture: async () => {
                assertCurrent();
                const after = await binding.verifyAuthenticated({ page, config, recordEvidence, assertCurrent });
                assertCurrent();
                if (!after.authenticated || pageVersion !== version) throw new FullPageCaptureRefusedError("page-changed");
              },
              mask: () => page.frames().map(frame => frame.locator(UCPATH_PENDING_READ_RECIPES.ssn)),
              assertSafe: async () => {
                assertCurrent();
                if (pageVersion !== version) throw new FullPageCaptureRefusedError("page-changed");
                for (const frame of page.frames()) {
                  if (await secretPresent(frame)) throw new FullPageCaptureRefusedError("secret-controls-present");
                }
                if (pageVersion !== version) throw new FullPageCaptureRefusedError("page-changed");
              },
            });
            assertCurrent();
            if (pageVersion !== version) return unavailable("page-changed");
            for (const frame of frames) {
              if (await secretPresent(frame)) return unavailable("secret-controls-present");
            }
            if (pageVersion !== version) return unavailable("page-changed");
            return Object.freeze({ ...identity, state: "available", ...capture, diagnosticAttachments: diagnostics.snapshot() });
          } catch (error) {
            if (error instanceof FullPageCaptureRestoreError) throw error;
            assertCurrent();
            if (error instanceof FullPageCaptureRefusedError) return unavailable(error.reason);
            if (pageVersion !== version) return unavailable("page-changed");
            const call = playwrightCall(error);
            for (const [index, cause] of serializeErrorCauses(error).entries()) {
              this.#options.onDebug?.(workerId, { phase: "failed", correlationId: sessionId,
                reason: "capture-cause", code: cause.code, message: cause.name, stack: cause.stack, ...(index === 0 && call !== undefined ? { area: call } : {}) });
            }
            return unavailable("verification-failed");
          }
        },
        authentication: {
          authenticate: async (requested: BrowserSystemId, options): Promise<"logged-in" | "already-authenticated"> => {
            assertCurrent();
            if (requested !== system) {
              throw new Error(`${system} browser session cannot authenticate ${requested}`);
            }
            if (options.instance !== undefined && options.instance !== instance) {
              throw new Error(
                `${system} browser session was opened for instance ${instance} but login requested ${options.instance}`,
              );
            }
            const claimStaleRequestRecovery = input.claimStaleRequestRecovery;
            const acquisitionRemainingMs = input.acquisitionRemainingMs;
            const loginContext: SystemLoginContext = {
              page,
              assertCurrent,
              config,
              instance,
              label,
              signal: options.signal ?? input.signal,
              credentials: readSsoCredentials(this.#options.protectedSecrets),
              recordEvidence,
              duoCeremony: input.duoCeremony,
              withDuoSigningScope: async (token, run) => {
                assertCurrent();
                assertDuoCeremonyLeaseToken(token, { system });
                if (signingToken !== undefined || token.holder.workerId !== workerId) throw new DuoProvisioningError();
                signingToken = token;
                try { const result = await run(); assertCurrent(); return result; } finally { signingToken = undefined; }
              },
              ...(claimStaleRequestRecovery === undefined ? {} : { claimStaleRequestRecovery: () => { assertCurrent(); return claimStaleRequestRecovery.call(input); } }),
              ...(acquisitionRemainingMs === undefined ? {} : { acquisitionRemainingMs: () => { assertCurrent(); return acquisitionRemainingMs.call(input); } }),
            };
            emit("started");
            try {
              this.#owned.get(profileDirectory)?.duo?.assertCurrent();
              const result = await binding.login(loginContext);
              assertCurrent();
              this.#owned.get(profileDirectory)?.duo?.assertCurrent();
              emit("settled");
              return result;
            } catch (error) { emit("failed", "session-authentication-failed"); throw error; }
          },
        },
        reset: async (resetInput): Promise<void> => {
          assertCurrent();
          try { await this.#resetToNeutralState(binding, page, instance, label, resetInput.signal, assertCurrent, recordEvidence); }
          catch (error) { emit("failed", "session-reset-failed"); throw error; }
          emit("reset");
        },
        close: async (closeInput): Promise<BrowserSessionCloseProof> => {
          if (closeProof !== undefined) return closeProof;
          detach();
          if (!profileReleased) {
            await this.#closeWithProof(context, lifecycle, system, closeInput.reason);
            this.#releaseProfile(profileDirectory);
            profileReleased = true;
          }
          diagnostics.dispose();
          if (exclusiveLease !== undefined) this.#options.browserOwner.database.authority.exclusiveSessionLeases.release(exclusiveLease, this.#options.clock.now().toISOString());
          closeProof = Object.freeze({ sessionId, system, pagesClosed: true, contextClosed: true,
            ...(exclusiveLease === undefined ? {} : { exclusiveLeaseReleased: true }) });
          if (observeEvent().state === "current") emit("released");
          return closeProof;
        },
      };
      return Object.freeze(resource);
    } catch (error) {
      // The context exists but the resource does not, so nothing else can ever
      // close it. Prove the cleanup here or surface BOTH failures.
      try {
        await this.#closeWithProof(context, lifecycle, system, "login-failed");
        this.#releaseProfile(profileDirectory);
        if (exclusiveLease !== undefined) this.#options.browserOwner.database.authority.exclusiveSessionLeases.release(exclusiveLease, this.#options.clock.now().toISOString());
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
    this.#options.assertCurrent(input.workerId);
    const browserMode = browserModeFor(input.browserMode, config.browser.headless);
    const profileDirectory = workerProfileDirectory({
      profileRoot: config.paths.browserProfileRoot,
      slotOrdinal: this.#options.slotOrdinal(input.workerId, input.system),
      system: input.system,
    });
    const instance = RuntimeInstanceSchema.parse(input.instance);
    const identity = { ...input, instance, browserMode, profileDirectory, signInFingerprint: browserSignInFingerprint(config, this.#options.protectedSecrets, input.system, instance, this.#options.duo) };
    const { profileRevision: _revision, resetRequired: _reset, ...admitted } = BrowserProfileAdmissionSchema.parse(await this.#options.admitProfile(identity, "cleanup"));
    this.#options.assertCurrent(input.workerId);
    if (canonicalJsonStringify(admitted) !== canonicalJsonStringify(identity)) throw new ProfileCustodyUnavailableError();
    if (profileReservations.has(profileDirectory)) throw new ProfileCustodyUnavailableError();
    assertPrivateProfilePath(config.paths.browserProfileRoot, profileDirectory);
    await this.#unusedProfile(this.#rootInput(input.workerId, profileDirectory, identity.signInFingerprint), async unused => { unused.remove(); });
    return Object.freeze({ profileDirectory });
  }

  #rootInput(workerId: WorkerId, profileDirectory: string, credentialFingerprint: string | null): BrowserRootLaunchInput {
    return { profileId: this.#options.browserOwner.profileId, profileRoot: this.#options.config.paths.browserProfileRoot,
      profileDirectory, credentialFingerprint, owner: { kind: "worker", database: this.#options.browserOwner.database, workerId } };
  }

  async #unusedProfile(owner: BrowserRootLaunchInput, body: Parameters<BrowserRoots["withUnused"]>[2]): Promise<void> {
    const { config, clock, scheduler } = this.#options;
    await this.#options.browserRoots.withUnused(owner.profileDirectory, createNativeBrowserProbe({ launcher: this.#launcher,
      clock, scheduler, closeProofMs: config.browser.closeProofMs, launchTimeoutMs: config.timeouts.sessionAcquireMs,
      signal: new AbortController().signal }), body, owner);
  }

  async #launchProfile(owner: BrowserRootLaunchInput, browserMode: BrowserPresentationMode, acceptDownloads: boolean, system: BrowserSystemId, timeoutMs?: number): Promise<BrowserContext> {
    const { config } = this.#options;
    const profileDirectory = owner.profileDirectory, launch = this.#options.browserRoots.beginLaunch(owner);
    this.#launches.set(profileDirectory, launch);
    const extensionDirectory = join(profileDirectory, "relay-extension");
    try {
      mkdirSync(dirname(profileDirectory), { recursive: true, mode: 0o700 });
      if (config.features.duoWebAuthn) {
        mkdirSync(profileDirectory, { recursive: true, mode: 0o700 });
        deleteOwnedExtension(config.paths.browserProfileRoot, extensionDirectory);
        stageFastDuoExtension(config.paths.duoExtensionDir, extensionDirectory, "workflow");
      }
    } catch (error) {
      launch.uncertain(error);
    }
    let context: BrowserContext | undefined;
    try {
      context = await this.#launcher.launch({ profileDirectory, ...(config.features.duoWebAuthn ? {} : { nativeOnly: true }), headless: browserMode === "headless",
        extensionDirectory, acceptDownloads, downloadsPath: config.paths.downloadsDir,
        viewport: { width: config.display.screenWidth, height: config.display.screenHeight },
        ...(timeoutMs === undefined ? {} : { timeoutMs }) });
      launch.opened();
      return context;
    } catch (error) {
      if (context === undefined && chromiumProfileInUse(error)) {
        launch.closing(); launch.closed(); this.#launches.delete(profileDirectory); profileReservations.delete(profileDirectory);
        throw new BrowserProfileStillClosingError(error);
      }
      const uncertain = new BrowserLaunchUncertainError([error], `${system} browser launch closure is unproved`, { cause: error });
      const failure = retainAuthoritySourceClosure([uncertain], { directory: { context, profileDirectory, system } });
      try { return launch.uncertain(failure); }
      catch (retained) { throw new BrowserLaunchUncertainError([error, retained], `${system} browser launch closure is unproved`, { cause: error }); }
    }
  }

  #releaseProfile(profileDirectory: string): void {
    const owned = this.#owned.get(profileDirectory);
    if (owned === undefined || !owned.lifecycle.closed() || owned.context.pages().length !== 0) throw new ProfileCustodyUnavailableError();
    const launch = this.#launches.get(profileDirectory);
    if (launch === undefined) throw new ProfileCustodyUnavailableError();
    launch.closed(); this.#launches.delete(profileDirectory);
    this.#owned.delete(profileDirectory);
    profileReservations.delete(profileDirectory);
  }

  // Neutral reset must pass the same authenticated-application proof as login.
  async #resetToNeutralState(
    binding: BrowserSystemBinding,
    page: Page,
    instance: RuntimeInstance,
    label: string,
    signal: AbortSignal,
    assertCurrent: () => void,
    recordEvidence: (evidence: AuthenticatedApplicationEvidence) => void,
  ): Promise<void> {
    const { config } = this.#options;
    if (signal.aborted) {
      throw new Error(`${binding.system} neutral reset was cancelled before navigation`);
    }
    const entry = resolveSystemEntryUrl(config, binding.system, instance, label);
    assertCurrent();
    await page.goto(entry, {
      waitUntil: "domcontentloaded",
      timeout: config.timeouts.navigationMs,
    });
    assertCurrent();
    await assertAuthenticatedApplication(
      binding.system,
      { page, config, recordEvidence, assertCurrent },
      binding.verifyAuthenticated,
      "the neutral reset did not land on the authenticated application; the session is no longer reusable",
    );
  }

  async #acquireExclusiveSession(input: Readonly<{ workerId: WorkerId; sessionId: string; system: BrowserSystemId; instance: RuntimeInstance;
    signal: AbortSignal; assertCurrent: () => void; remainingMs?: () => number; replacesSessionId?: string }>): Promise<ExclusiveSessionLease> {
    const entry = new URL(resolveSystemEntryUrl(this.#options.config, input.system, input.instance, `${input.system} identity lease`));
    const account = requireSecret("ucpathUserId", this.#options.protectedSecrets).trim().toLocaleLowerCase("en-US");
    if (account.length === 0) throw new Error("onbase-session-identity-unavailable");
    const identityKey = sha256Hex(canonicalJsonStringify({ application: new URL(".", entry).href, account }));
    const deadline = this.#options.clock.monotonicMs() + this.#options.config.timeouts.sessionAcquireMs;
    for (;;) {
      input.signal.throwIfAborted(); input.assertCurrent();
      const outcome = this.#options.browserOwner.database.authority.exclusiveSessionLeases.acquire({ identityKey,
        workerId: input.workerId, sessionId: input.sessionId, now: this.#options.clock.now().toISOString(),
        ...(input.replacesSessionId === undefined ? {} : { replacesSessionId: input.replacesSessionId }) });
      if (outcome.state === "acquired") return outcome.lease;
      const remaining = Math.min(deadline - this.#options.clock.monotonicMs(), input.remainingMs?.() ?? Infinity);
      if (remaining <= 0) throw new OnbaseSessionHeldError();
      await new Promise<void>((resolve, reject) => {
        const timer = this.#options.scheduler.schedule(this.#options.clock.monotonicMs() + Math.min(200, remaining), () => {
          input.signal.removeEventListener("abort", aborted); resolve();
        });
        const aborted = () => {
          timer.cancel();
          const cause: unknown = input.signal.reason;
          reject(cause instanceof Error ? cause : new Error("onbase-session-acquisition-cancelled", { cause }));
        };
        input.signal.addEventListener("abort", aborted, { once: true });
        if (input.signal.aborted) { input.signal.removeEventListener("abort", aborted); aborted(); }
      });
    }
  }

  async #closeWithProof(
    context: BrowserContext,
    lifecycle: ContextLifecycle,
    system: BrowserSystemId,
    reason: BrowserSessionCloseReason,
  ): Promise<void> {
    const owned = [...this.#owned.entries()].find(([, owned]) => owned.context === context), duo = owned?.[1].duo;
    const launch = owned === undefined ? undefined : this.#launches.get(owned[0]);
    const errors: unknown[] = [];
    try { if (launch === undefined) throw new ProfileCustodyUnavailableError(); launch.closing(); }
    catch (error) { errors.push(error); }
    const deadline = this.#options.clock.monotonicMs() + this.#options.config.browser.closeProofMs;
    let timer: ReturnType<BrowserDeadlineScheduler["schedule"]> | undefined;
    const brokerClose = duo === undefined ? undefined : Promise.race([duo.stop(), new Promise<never>((_resolve, reject) => {
      timer = this.#options.scheduler.schedule(deadline,
        () => reject(new Error("duo-broker-close-unproved")));
    })]);
    if (brokerClose !== undefined) {
      try { await brokerClose; } catch (error) { errors.push(error); }
    }
    timer?.cancel();
    try {
      await closeContextWithProof({ clock: this.#options.clock, scheduler: this.#options.scheduler,
        closeProofMs: Math.max(0, deadline - this.#options.clock.monotonicMs()) }, context, lifecycle, system, reason);
    } catch (error) { errors.push(error); }
    if (errors.length > 0) {
      const failure = retainAuthoritySourceClosure(errors, { directory: { context, owned, launch } });
      try { if (launch !== undefined) launch.uncertain(failure); }
      catch (retained) { errors.push(retained); }
      throw new BrowserSessionClosureUnprovedError([...errors, failure], `${system} browser session closure is unproved`, { cause: errors[0] });
    }
  }
}


function deleteOwnedExtension(profileRoot: string, profileDirectory: string): void {
  const root = AbsolutePathSchema.parse(profileRoot), directory = AbsolutePathSchema.parse(profileDirectory);
  if (!directory.endsWith(`${sep}relay-extension`)) throw new ProfileCustodyUnavailableError();
  assertPrivateProfilePath(root, directory);
  if ([...profileReservations].some(path => path === directory || path.startsWith(`${directory}${sep}`))) throw new ProfileCustodyUnavailableError();
  const verify = (path: string): void => {
    const metadata = fileStatus(path, true);
    if (metadata === undefined) return;
    if (metadata.isSymbolicLink() || privatePathRejects(path, metadata, "group-write")
      || !(metadata.isDirectory() || metadata.isFile()) || metadata.isFile() && privateFileNumber(metadata.nlink) !== 1) throw new ProfileCustodyUnavailableError();
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
  constructor(options?: ErrorOptions) { super("Duo extension session provisioning could not be verified.", options); this.name = "DuoProvisioningError"; }
}

export function browserSignInFingerprint(config: Config, secrets: ProtectedSecretSource, system: BrowserSystemId, instance: RuntimeInstance, duo?: DuoSigningSource): Fingerprint {
  const { entries } = readProtectedCredentials(secrets);
  const urls = system === "new-kronos" ? config.urls.newKronos : system === "old-kronos" ? config.urls.oldKronos : config.urls[system];
  return FingerprintSchema.parse(sha256Hex(canonicalJsonStringify({ system, instance, urls,
    credentialIds: { userId: entries.ucpathUserId?.valueId ?? null, password: entries.ucpathPassword?.valueId ?? null },
    duo: { enabled: config.features.duoWebAuthn, extensionPath: config.paths.duoExtensionDir, publicIdentity: config.features.duoWebAuthn
      ? (() => { if (duo === undefined) throw new DuoProvisioningError(); duo.assertCurrent(); return duo.identity(); })() : null },
  })));
}

// UCSD systems share an SSO realm and credential pair, but hold distinct application sessions.
function readSsoCredentials(source: ProtectedSecretSource): SsoCredentials {
  return {
    userId: requireSecret("ucpathUserId", source),
    password: requireSecret("ucpathPassword", source),
  };
}

export class OnbaseSessionHeldError extends Error {
  readonly code = "ONBASE_SESSION_HELD";
  constructor() { super(ERROR_CATALOG.ONBASE_SESSION_HELD.text); this.name = "OnbaseSessionHeldError"; }
}
