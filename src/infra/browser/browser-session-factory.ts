/**
 * The real `WorkerBrowserSessionFactory` (doc 05 §§1,4 · doc 11 §4).
 *
 * One worker browser session = one persistent Chromium context, one page, one
 * system, one resolved instance, one config fingerprint. The factory owns
 * exactly four things and nothing else:
 *
 * 1. **Launch.** Playwright's FULL bundled Chromium (`channel: "chromium"`) in
 *    a persistent context, with the Duo Autopilot MV3 extension loaded so the
 *    Duo WebAuthn ceremony clears in-page. Both are hard requirements, not
 *    preferences: Chrome stable disabled `--load-extension`, the lightweight
 *    headless shell cannot run extensions at all, and an extension needs a
 *    persistent context (`duo-autopilot/README.md`).
 * 2. **Isolation.** The profile lives under the rebuild's own absolute
 *    `paths.browserProfileRoot` (default: the isolation contract's root) and
 *    the isolation contract's `browserSessionNamespace`, namespaced per
 *    `(worker, system, instance, configFingerprint)` — never a literal path,
 *    never a cwd-relative one, never a directory the legacy runtime could also
 *    open.
 * 3. **Authentication.** It hands the store's login recipe a live page plus
 *    credentials resolved through `domain/secrets.ts`, the single credential
 *    reader. The factory itself never reads the environment.
 * 4. **Provable teardown.** `close()` returns a proof only after observing
 *    every page closed AND the context's own close event, within a bounded
 *    deadline. Anything else THROWS, and the session manager then retains the
 *    resource as poisoned rather than believing an unproven cleanup.
 */
import { mkdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import type { BrowserContext, Page } from "playwright";
import type {
  BrowserSessionCloseProof,
  BrowserSessionCloseReason,
  WorkerBrowserResource,
  WorkerBrowserSessionFactory,
} from "../../base/session.js";
import type { RuntimeIsolation } from "../../config/define-runtime-isolation.js";
import type { Clock } from "../../domain/clock.js";
import { RuntimeInstanceSchema, resolveSystemEntryUrl } from "../../domain/config/instance.js";
import type { RuntimeInstance } from "../../domain/config/instance.js";
import { AbsolutePathSchema } from "../../domain/config/schema.js";
import type { Config } from "../../domain/config/schema.js";
import {
  BrowserSessionIdSchema,
  BrowserSystemIdSchema,
  FingerprintSchema,
  WorkerIdSchema,
  WorkflowIdSchema,
} from "../../domain/ids.js";
import type { BrowserSystemId, Fingerprint, WorkerId, WorkflowId } from "../../domain/ids.js";
import { requireSecret, requireSecretFile } from "../../domain/secrets.js";
import { assertAuthenticatedApplication } from "./authenticated-application.js";
import type { AuthenticatedApplicationEvidence } from "./login-contract.js";
import type { SystemLoginContext } from "./login-contract.js";
import { BROWSER_SYSTEM_BINDINGS } from "./system-bindings.js";
import type { BrowserSystemBinding, BrowserSystemBindings } from "./system-bindings.js";

/**
 * Structurally identical to the kernel's `MonotonicDeadlineScheduler`. It is
 * re-declared here rather than imported because `core` sits ABOVE `infra` in
 * the layer matrix; composition passes the one real scheduler to both.
 */
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
  readonly isolation: RuntimeIsolation;
  readonly clock: Clock;
  readonly scheduler: BrowserDeadlineScheduler;
  readonly newSessionId: () => string;
  readonly bindings?: BrowserSystemBindings;
  readonly launcher?: PersistentContextLauncher;
  /**
   * A diagnostic sink for the marker that PROVED a session — what the login or
   * the neutral reset actually observed, never a value. Operator surfaces and
   * the live smoke read it; production composition may omit it. It carries no
   * data the runtime branches on, so an absent observer changes nothing.
   */
  readonly onAuthenticationEvidence?: (evidence: AuthenticatedApplicationEvidence) => void;
  /**
   * Main-frame navigations, in order. Also purely diagnostic: it is how a live
   * smoke can SHOW that a login really traversed `a5.ucsd.edu` and Duo instead
   * of asking the reader to infer it from elapsed time.
   */
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

/**
 * The on-disk profile for one worker browser session.
 *
 * Every segment below the root is derived from the runtime-isolation contract
 * and the session identity — there is no profile-root literal here, and the
 * `browserSessionNamespace` segment is what keeps a rebuild profile from ever
 * being the legacy one even if both roots were ever pointed at the same
 * directory. The config fingerprint is part of the path because D116 forbids
 * reusing a context authenticated or configured under another run snapshot;
 * sharing one profile directory across fingerprints would reintroduce exactly
 * that through disk state.
 *
 * `profileRoot` is an explicit ABSOLUTE base (`config.paths.browserProfileRoot`,
 * whose default is the isolation contract's root resolved once in
 * `domain/config/schema.ts`). It is a parameter rather than a re-resolution of
 * the isolation literal for two reasons: `resolve(".auth")` is
 * cwd-dependent, so a worker started elsewhere would silently open a different
 * profile home; and a caller that must NOT touch the operator's real profile
 * root — every unit test — has to be able to say so, rather than being forced
 * through the real credential directory. A relative root is refused loudly.
 */
export function workerProfileDirectory(input: Readonly<{
  profileRoot: string;
  isolation: RuntimeIsolation;
  workerId: WorkerId;
  system: BrowserSystemId;
  instance: RuntimeInstance;
  configFingerprint: Fingerprint;
}>): string {
  const root = AbsolutePathSchema.parse(input.profileRoot);
  const worker = WorkerIdSchema.parse(input.workerId);
  const system = BrowserSystemIdSchema.parse(input.system);
  const instance = RuntimeInstanceSchema.parse(input.instance);
  const fingerprint = FingerprintSchema.parse(input.configFingerprint);
  return resolve(
    root,
    input.isolation.browserSessionNamespace,
    worker,
    `${system}-${instance}-${fingerprint.slice(0, 12)}`,
  );
}

/**
 * Proves the Duo Autopilot prerequisites BEFORE a browser exists, so a missing
 * extension or credential is a legible refusal rather than a login that hangs
 * on an unanswerable prompt.
 */
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
  // the 0600-or-stricter permission and size limits doc 11 §6 requires.
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
    acceptDownloads: boolean;
    exclusive: boolean;
    signal: AbortSignal;
  }>): Promise<WorkerBrowserResource> {
    const { config, isolation } = this.#options;
    const workerId = WorkerIdSchema.parse(input.workerId);
    WorkflowIdSchema.parse(input.workflowId);
    const system = BrowserSystemIdSchema.parse(input.system);
    const configFingerprint = FingerprintSchema.parse(input.configFingerprint);
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
      isolation, workerId, system, instance, configFingerprint,
    });
    mkdirSync(profileDirectory, { recursive: true });

    const context = await this.#launcher.launch({
      profileDirectory,
      headless: config.browser.headless,
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
        acceptDownloads: input.acceptDownloads,
        exclusive: input.exclusive,
        driver: binding.createDriver(page, this.#options.clock),
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
              credentials: readSsoCredentials(),
              recordEvidence: this.#recordEvidence,
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

  readonly #recordEvidence = (evidence: AuthenticatedApplicationEvidence): void => {
    this.#options.onAuthenticationEvidence?.(evidence);
  };

  /**
   * doc 05 §4: a clean release returns to the system's verified neutral state
   * before reuse. Re-navigating to the entry route and re-running the system's
   * FULL authentication proof is what makes "reusable" an observation instead
   * of an assumption — a session that silently dropped to SSO fails here, and
   * the manager poison-closes it.
   *
   * Until 2026-08-03 this checked a URL predicate alone, so PeopleSoft's signon
   * page (same host, same route shape, titled "Oracle PeopleSoft Sign-in")
   * passed as the authenticated application and left a "reusable" session that
   * would have scraped a sign-in page as HR data. It now runs exactly what the
   * login recipe must pass — there is ONE definition of authenticated, not two.
   */
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

  /**
   * Bounded, PROVEN teardown. Playwright resolves `close()` without telling you
   * what actually closed, so this observes the context's own close event and
   * every page's `isClosed()`. An unproven or timed-out close throws.
   */
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

/**
 * The UCSD SSO credential pair. Every UCSD system in scope authenticates
 * against the same realm (legacy
 * hr-automation@793abe1f8265f3213ffe8a80d6cfd9860a32a1dc
 * `src/infra/auth/login.ts` records this for CRM, OnBase, Kuali, Kronos and
 * ServiceNow), so one registered secret pair serves them all. Missing values
 * throw `SecretMissingError` naming the KEY, never a value.
 */
function readSsoCredentials(): SsoCredentials {
  return {
    userId: requireSecret("ucpathUserId"),
    password: requireSecret("ucpathPassword"),
  };
}
