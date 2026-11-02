import { chromium, type BrowserContext } from "playwright";
import type { Clock } from "../../../rules/time/clock.js";
import type { BrowserSessionCloseReason } from "../../../workflow-kit/session.js";
import { ERROR_CATALOG } from "../../../models/failures/error-catalog.js";
import { AuthoritySourceClosureUnprovedError, retainAuthoritySourceClosure } from "../../storage/source-closure.js";

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

export class BrowserProfileStillClosingError extends Error {
  readonly code = "BROWSER_PROFILE_STILL_CLOSING";
  constructor(cause: unknown) { super(ERROR_CATALOG.BROWSER_PROFILE_STILL_CLOSING.text, { cause }); this.name = "BrowserProfileStillClosingError"; }
}

export const DEFAULT_BROWSER_LAUNCHER: PersistentContextLauncher = {
  async launch(input) {
    return chromium.launchPersistentContext(input.profileDirectory, {
      // The extension requires the full bundled Chromium; the headless shell
      // cannot load one (fast-duo/README.md).
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
    throw new NativeBrowserClosureUnprovedError([retainAuthoritySourceClosure([error], { directory: { context, profileDirectory: input.launch.profileDirectory } })]);
  }
  input.signal.throwIfAborted();
}
