
import { mkdirSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import type { BrowserContext, Page } from "playwright";
import type {
  BrowserSessionCloseProof,
  BrowserSessionCloseReason,
  WorkerBrowserResource,
  WorkerBrowserSessionFactory,
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
} from "../../../rules/identity/ids.js";
import type { BrowserSystemId, Fingerprint, WorkerId, WorkflowId } from "../../../rules/identity/ids.js";
import {
  requireSecret,
  requireSecretFile,
  type ProtectedSecretSource,
} from "../../../models/config/secrets.js";
import { assertAuthenticatedApplication } from "../../systems/browser-shared/authenticated-application.js";
import type { AuthenticatedApplicationEvidence } from "../../systems/browser-shared/login-contract.js";
import type { SystemLoginContext } from "../../systems/browser-shared/login-contract.js";
import { BROWSER_SYSTEM_BINDINGS } from "./system-bindings.js";
import type { BrowserSystemBinding, BrowserSystemBindings } from "./system-bindings.js";

// Keep the acquisition scheduler structural so both ports use the same timer without a module cycle.
export interface BrowserDeadlineScheduler {
  schedule(deadlineMonotonicMs: number, onDeadline: () => void): { cancel: () => void };
}

/** The Playwright launch seam, so a unit test can drive open/close without a real browser. */
export interface PersistentContextLauncher {
  launch(input: Readonly<{
    profileDirectory: string;
    headless: boolean;
    extensionDirectory: string;
    acceptDownloads: boolean;
    downloadsPath: string;
    viewport: Readonly<{ width: number; height: number }>;
  }>): Promise<BrowserContext>;
}

export interface BrowserSessionFactoryOptions {
  readonly config: Config;
  readonly protectedSecrets: ProtectedSecretSource;
  readonly isolation: RuntimeIsolation;
  readonly clock: Clock;
  readonly scheduler: BrowserDeadlineScheduler;
  readonly newSessionId: () => string;
  readonly bindings?: BrowserSystemBindings;
  readonly launcher?: PersistentContextLauncher;
  // Session proof diagnostics name the observed marker, never its sensitive value.
  readonly onAuthenticationEvidence?: (evidence: AuthenticatedApplicationEvidence) => void;

  readonly onNavigation?: (url: string) => void;
}

/** Resolved once per authentication; never logged, never interpolated. */
interface SsoCredentials {
  readonly userId: string;
  readonly password: string;
}

const DEFAULT_LAUNCHER: PersistentContextLauncher = {
  async launch(input) {
    return chromium.launchPersistentContext(input.profileDirectory, {
      // The extension requires the full bundled Chromium; the headless shell
      // cannot load one (duo-autopilot/README.md).
      channel: "chromium",
      headless: input.headless,
      acceptDownloads: input.acceptDownloads,
      downloadsPath: input.downloadsPath,
      viewport: input.viewport,
      args: [
        `--disable-extensions-except=${input.extensionDirectory}`,
        `--load-extension=${input.extensionDirectory}`,
      ],
    });
  },
};


export function workerProfileDirectory(input: Readonly<{
  profileRoot: string;
  isolation: RuntimeIsolation;
  workerId: WorkerId;
  system: BrowserSystemId;
  instance: RuntimeInstance;
  configFingerprint: Fingerprint;
  browserMode?: BrowserPresentationMode;
}>): string {
  const root = AbsolutePathSchema.parse(input.profileRoot);
  const worker = WorkerIdSchema.parse(input.workerId);
  const system = BrowserSystemIdSchema.parse(input.system);
  const instance = RuntimeInstanceSchema.parse(input.instance);
  const fingerprint = FingerprintSchema.parse(input.configFingerprint);
  const browserMode = BrowserPresentationModeSchema.parse(
    input.browserMode === undefined ? "headless" : input.browserMode,
  );
  return resolve(
    root,
    input.isolation.browserSessionNamespace,
    worker,
    `${system}-${instance}-${fingerprint.slice(0, 12)}-${browserMode}`,
  );
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
  // the 0600-or-stricter permission and size limits ref clock-config-secrets §6 requires.
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

  constructor(options: BrowserSessionFactoryOptions) {
    this.#options = options;
    this.#bindings = options.bindings ?? BROWSER_SYSTEM_BINDINGS;
    this.#launcher = options.launcher ?? DEFAULT_LAUNCHER;
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
  }>): Promise<WorkerBrowserResource> {
    const { config, isolation } = this.#options;
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

    assertDuoAutopilotReady(config);
    const profileDirectory = workerProfileDirectory({
      profileRoot: config.paths.browserProfileRoot,
      isolation, workerId, system, instance, configFingerprint, browserMode,
    });
    mkdirSync(profileDirectory, { recursive: true });

    const context = await this.#launcher.launch({
      profileDirectory,
      headless: browserMode === "headless",
      extensionDirectory: config.paths.duoExtensionDir,
      acceptDownloads: input.acceptDownloads,
      downloadsPath: config.paths.downloadsDir,
      viewport: { width: config.display.screenWidth, height: config.display.screenHeight },
    });

    const lifecycle = observeContextLifecycle(context);
    try {
      const existing = context.pages();
      const page = existing[0] ?? await context.newPage();
      const onNavigation = this.#options.onNavigation;
      if (onNavigation !== undefined) {
        page.on("framenavigated", (frame) => {
          if (frame === page.mainFrame()) onNavigation(frame.url());
        });
      }
      const sessionId = BrowserSessionIdSchema.parse(this.#options.newSessionId());
      const label = `worker ${workerId} ${system} session`;
      const resource: WorkerBrowserResource = {
        sessionId,
        system,
        ...(input.instance === undefined ? {} : { instance: input.instance }),
        configFingerprint,
        browserMode,
        profileDirectory,
        acceptDownloads: input.acceptDownloads,
        exclusive: input.exclusive,
        driver: binding.createDriver(page, this.#options.clock),
        screenshot: async () => Object.freeze({
          bytes: new Uint8Array(await page.screenshot({ type: "png" })),
          width: config.display.screenWidth,
          height: config.display.screenHeight,
        }),
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
            };
            return binding.login(loginContext);
          },
        },
        reset: async (resetInput): Promise<void> => {
          await this.#resetToNeutralState(binding, page, instance, label, resetInput.signal);
        },
        close: async (closeInput): Promise<BrowserSessionCloseProof> => {
          await this.#closeWithProof(context, lifecycle, system, closeInput.reason);
          return Object.freeze({ sessionId, system, pagesClosed: true, contextClosed: true });
        },
      };
      return Object.freeze(resource);
    } catch (error) {
      // The context exists but the resource does not, so nothing else can ever
      // close it. Prove the cleanup here or surface BOTH failures.
      try {
        await this.#closeWithProof(context, lifecycle, system, "login-failed");
      } catch (closeError) {
        throw new AggregateError(
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
    const { config, isolation } = this.#options;
    const browserMode = browserModeFor(input.browserMode, config.browser.headless);
    const profileDirectory = workerProfileDirectory({
      profileRoot: config.paths.browserProfileRoot,
      isolation,
      workerId: input.workerId,
      system: input.system,
      instance: RuntimeInstanceSchema.parse(input.instance),
      configFingerprint: input.configFingerprint,
      browserMode,
    });
    const namespaceRoot = resolve(config.paths.browserProfileRoot, isolation.browserSessionNamespace);
    if (!profileDirectory.startsWith(`${namespaceRoot}/`)) {
      throw new Error(`refusing to discard ${profileDirectory}: it is outside the rebuild browser-profile namespace ${namespaceRoot}`);
    }
    rmSync(profileDirectory, { recursive: true, force: true });
    mkdirSync(profileDirectory, { recursive: true });
    return Object.freeze({ profileDirectory });
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

  // Playwright close resolution alone is not teardown proof; verify context and process termination.
  async #closeWithProof(
    context: BrowserContext,
    lifecycle: ContextLifecycle,
    system: BrowserSystemId,
    reason: BrowserSessionCloseReason,
  ): Promise<void> {
    const { clock, scheduler, config } = this.#options;
    const deadline = clock.monotonicMs() + config.browser.closeProofMs;
    let expire = (): void => undefined;
    const timedOut = new Promise<never>((_resolve, reject) => {
      const handle = scheduler.schedule(deadline, () => {
        reject(new Error(
          `${system} browser session close (${reason}) did not complete within its ${String(config.browser.closeProofMs)}ms proof deadline`,
        ));
      });
      expire = (): void => handle.cancel();
    });
    const pages = context.pages();
    try {
      await Promise.race([
        (async (): Promise<void> => {
          for (const page of pages) await page.close({ runBeforeUnload: false });
          await context.close();
        })(),
        timedOut,
      ]);
    } finally {
      expire();
    }
    const openPages = pages.filter((page) => !page.isClosed());
    if (openPages.length > 0) {
      throw new Error(
        `${system} browser session close (${reason}) left ${String(openPages.length)} page(s) open; closure cannot be proven`,
      );
    }
    if (context.pages().length > 0) {
      throw new Error(
        `${system} browser session close (${reason}) left new pages open; closure cannot be proven`,
      );
    }
    if (!lifecycle.closed()) {
      throw new Error(
        `${system} browser session close (${reason}) never emitted its context close event; closure cannot be proven`,
      );
    }
  }
}

interface ContextLifecycle {
  readonly closed: () => boolean;
}

function observeContextLifecycle(context: BrowserContext): ContextLifecycle {
  let closed = false;
  context.on("close", () => {
    closed = true;
  });
  return { closed: () => closed };
}

// UCSD systems share an SSO realm and credential pair, but hold distinct application sessions.
function readSsoCredentials(source: ProtectedSecretSource): SsoCredentials {
  return {
    userId: requireSecret("ucpathUserId", source),
    password: requireSecret("ucpathPassword", source),
  };
}
