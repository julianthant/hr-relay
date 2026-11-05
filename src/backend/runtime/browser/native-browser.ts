import type { BrowserProfileProbeFactory, BrowserProfileProbeOptions } from "../../storage/browser-roots.js";
import { createTimeoutDeadlineScheduler } from "../scheduling/timeout-deadline-scheduler.js";
import { z } from "zod";
import { spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import { chromium, type BrowserContext, type ConnectOverCDPTransport } from "playwright";
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
    ownedProcess?: (process: OwnedBrowserProcess) => void;
  }>): Promise<BrowserContext>;
}

export interface OwnedBrowserProcess {
  exited(): boolean;
  onExit(callback: () => void): void;
  stop(timeoutMs: number): Promise<void>;
}

async function launchOwnedChromium(input: Parameters<PersistentContextLauncher["launch"]>[0]): Promise<BrowserContext> {
  const timeoutMs = z.number().positive().parse(input.timeoutMs);
  const child = spawn(chromium.executablePath(), ["--remote-debugging-pipe",
    `--user-data-dir=${input.profileDirectory}`, "--no-first-run", "--no-default-browser-check",
    "--enable-automation", "--enable-unsafe-extension-debugging", "--disable-dev-shm-usage",
    "--disable-features=PasswordManagerOnboarding,PasswordImport,PasswordManagerEnabled",
    `--disable-extensions-except=${input.extensionDirectory}`, `--load-extension=${input.extensionDirectory}`, "--no-startup-window"],
  { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"], windowsHide: false });
  let exited = false, spawned = false;
  let birthFailure: Error | undefined, processFailure: Error | undefined;
  child.once("spawn", () => { spawned = true; });
  const startup: { connecting?: Promise<BrowserContext> } = {};
  const exit = new Promise<void>(resolve => {
    child.on("error", error => { if (!spawned && child.pid === undefined) { birthFailure = error; resolve(); } else processFailure = error; });
    child.once("exit", () => { exited = true; resolve(); });
  });
  // The child handle is the process-birth capability; no PID lookup or name-based kill.
  input.ownedProcess?.(Object.freeze({ exited: () => exited,
    onExit(callback: () => void) { if (exited) queueMicrotask(callback); else child.once("exit", callback); },
    async stop(deadlineMs: number) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (!exited && birthFailure === undefined && !child.kill("SIGKILL")) throw new Error("DUO_SETUP_STOP_FAILED", processFailure === undefined ? undefined : { cause: processFailure });
      await Promise.race([(async () => { await exit; await Promise.allSettled([startup.connecting]); })(), new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("DUO_SETUP_STOP_FAILED")), deadlineMs);
      })]);
    } finally { clearTimeout(timer); }
  } }));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const writePipe = child.stdio[3], readPipe = child.stdio[4];
  if (!(writePipe instanceof Writable) || !(readPipe instanceof Readable)) throw new Error("DUO_SETUP_OPEN_FAILED");
  const transport: ConnectOverCDPTransport = {
    send(message) { writePipe.write(JSON.stringify(message) + "\0"); },
    close() { writePipe.end(); readPipe.destroy(); },
  };
  const decoder = new StringDecoder("utf8");
  let pending = "";
  const disconnect = () => { transport.onclose?.("DUO_SETUP_TRANSPORT_CLOSED"); };
  writePipe.on("error", disconnect); readPipe.on("error", disconnect); readPipe.on("close", disconnect);
  readPipe.on("data", (data: Buffer) => {
    pending += decoder.write(data);
    for (let end = pending.indexOf("\0"); end !== -1; end = pending.indexOf("\0")) {
      const raw = pending.slice(0, end); pending = pending.slice(end + 1);
      let value: unknown;
      try { value = JSON.parse(raw); }
      catch { transport.close(); disconnect(); return; }
      if (typeof value !== "object" || value === null || Array.isArray(value)) { transport.close(); disconnect(); return; }
      transport.onmessage?.(value);
    }
  });
  const stopped = exit.then(() => { throw new Error("DUO_SETUP_OPEN_FAILED", birthFailure === undefined ? undefined : { cause: birthFailure }); });
  startup.connecting = (async () => {
    const browser = await chromium.connectOverCDP(transport, { timeout: timeoutMs, noDefaults: true });
    const context = browser.contexts()[0];
    if (!context || browser.contexts().length !== 1) throw new Error("DUO_SETUP_OPEN_FAILED");
    const pipe = await browser.newBrowserCDPSession();
    await pipe.send("Browser.setDownloadBehavior", { behavior: "deny" });
    await pipe.detach();
    return context;
  })();
  try {
    return await Promise.race([startup.connecting, stopped, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("DUO_SETUP_OPEN_FAILED")), timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}


export const DEFAULT_BROWSER_LAUNCHER: PersistentContextLauncher = {
  async launch(input) {
    if (input.ownedProcess !== undefined) return launchOwnedChromium(input);
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
