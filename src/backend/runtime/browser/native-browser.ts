import type { BrowserProfileProbeFactory, BrowserProfileProbeOptions } from "../../storage/browser-roots.js";
import { createTimeoutDeadlineScheduler } from "../scheduling/timeout-deadline-scheduler.js";
import { z } from "zod";
import { chromium, type BrowserContext } from "playwright";
import type { Clock } from "../../../rules/time/clock.js";
import { BrowserSessionClosureUnprovedError, BrowserProfileStillClosingError, type BrowserSessionCloseReason } from "../../../workflow-kit/session.js";
import { ERROR_CATALOG } from "../../../models/failures/error-catalog.js";
import { AuthoritySourceClosureUnprovedError, retainAuthoritySourceClosure } from "../../storage/source-closure.js";

export class BrowserLaunchUncertainError extends BrowserSessionClosureUnprovedError {
  constructor(errors: readonly unknown[], message: string, options?: ErrorOptions) {
    super(errors, message, options); this.name = "BrowserLaunchUncertainError";
  }
}

export function hasUncertainBrowserLaunch(error: unknown): boolean {
  const pending = [error], seen = new Set<unknown>();
  while (pending.length > 0) {
    const value = pending.pop(); if (seen.has(value)) continue; seen.add(value);
    if (value instanceof BrowserLaunchUncertainError) return true;
    if (value instanceof Error) pending.push(value.cause);
    if (value instanceof AggregateError) { const errors: readonly unknown[] = value.errors; pending.push(...errors); }
  }
  return false;
}

export class NativeBrowserClosureUnprovedError extends AuthoritySourceClosureUnprovedError {
  readonly code = "BROWSER_CLOSURE_UNPROVED";
  constructor(errors: readonly unknown[]) { super(errors); this.name = "NativeBrowserClosureUnprovedError"; this.message = ERROR_CATALOG.BROWSER_CLOSURE_UNPROVED.text; }
}

export interface BrowserDeadlineScheduler {
  schedule(deadlineMonotonicMs: number, onDeadline: () => void): { cancel: () => void };
}

export interface PersistentContextLauncher {
  launch(input: Readonly<{
    profileDirectory: string;
    headless: boolean;
    extensionDirectory: string;
    acceptDownloads: boolean;
    downloadsPath: string;
    viewport: Readonly<{ width: number; height: number }>;
    timeoutMs?: number;
    nativeOnly?: true;
    disablePasswordManager?: true;
    defaultContextOptions?: true;
  }>): Promise<BrowserContext>;
}


export const DEFAULT_BROWSER_LAUNCHER: PersistentContextLauncher = {
  async launch(input) {
    return chromium.launchPersistentContext(input.profileDirectory, {
      channel: "chromium",
      headless: input.headless,
      ...(input.timeoutMs === undefined ? {} : { timeout: input.timeoutMs }),
      acceptDownloads: input.acceptDownloads,
      ...(input.defaultContextOptions === true && input.nativeOnly !== true ? {} : { downloadsPath: input.downloadsPath, viewport: input.viewport }),
      args: [
        ...(input.nativeOnly === true ? ["--disable-extensions"] : [`--disable-extensions-except=${input.extensionDirectory}`, `--load-extension=${input.extensionDirectory}`]),
        ...(input.disablePasswordManager === true ? ["--disable-features=PasswordManagerOnboarding,PasswordImport,PasswordManagerEnabled"] : []),
      ],
    });
  },
};

export interface ContextLifecycle {
  readonly closed: () => boolean;
}

export function observeContextLifecycle(context: BrowserContext): ContextLifecycle {
  let closed = false;
  context.on("close", () => {
    closed = true;
  });
  return { closed: () => closed };
}

export async function closeContextWithProof(
  options: Readonly<{ clock: Clock; scheduler: BrowserDeadlineScheduler; closeProofMs: number }>,
  context: BrowserContext, lifecycle: ContextLifecycle, system: string, reason: BrowserSessionCloseReason,
): Promise<void> {
  const { clock, scheduler, closeProofMs } = options;
  const deadline = clock.monotonicMs() + closeProofMs;
  let expire = (): void => undefined;
  const timedOut = new Promise<never>((_resolve, reject) => {
    const handle = scheduler.schedule(deadline, () => {
      reject(new Error(
        `${system} browser session close (${reason}) did not complete within its ${String(closeProofMs)}ms proof deadline`,
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

export interface NativeBrowserProbeInput {
  profileRoot: string;
  launch: Omit<Parameters<PersistentContextLauncher["launch"]>[0], "headless" | "acceptDownloads">;
  clock: Clock; scheduler: BrowserDeadlineScheduler; closeProofMs: number; signal: AbortSignal;
  launcher?: PersistentContextLauncher;
}
export function chromiumProfileInUse(error: unknown): boolean {
  return error instanceof Error && ["Failed to create a ProcessSingleton for your profile directory.", "Opening in existing browser session."]
    .some(message => error.message.includes(message));
}

export async function runNativeContextProbe(input: NativeBrowserProbeInput): Promise<void> {
  input.signal.throwIfAborted();
  let context: BrowserContext | undefined;
  try {
    context = await (input.launcher ?? DEFAULT_BROWSER_LAUNCHER).launch({ ...input.launch, headless: true, acceptDownloads: false, nativeOnly: true });
    const lifecycle = observeContextLifecycle(context);
    await closeContextWithProof(input, context, lifecycle, "native profile probe", "profile-reset");
  } catch (error) {
    if (chromiumProfileInUse(error)) {
        throw new BrowserProfileStillClosingError(error);
    }
    const failure = context === undefined ? new BrowserLaunchUncertainError([error], "native browser launch is uncertain", { cause: error }) : error;
    throw new NativeBrowserClosureUnprovedError([retainAuthoritySourceClosure([failure], { directory: { context, profileDirectory: input.launch.profileDirectory } })]);
  }
  input.signal.throwIfAborted();
}

export function createNativeBrowserProbe(input: Parameters<BrowserProfileProbeFactory>[0] & Readonly<{
  scheduler?: BrowserDeadlineScheduler; launcher?: PersistentContextLauncher;
}>): BrowserProfileProbeOptions {
  return Object.freeze({ signal: input.signal,
    async probe(profileRoot: string, profileDirectory: string): Promise<void> {
      z.number().positive().finite().parse(input.closeProofMs);
      await runNativeContextProbe({ ...input, profileRoot, scheduler: input.scheduler ?? createTimeoutDeadlineScheduler(input.clock),
        launch: { profileDirectory, extensionDirectory: "", downloadsPath: profileDirectory,
          viewport: { width: 800, height: 600 }, timeoutMs: input.launchTimeoutMs } });
    },
  });
}
