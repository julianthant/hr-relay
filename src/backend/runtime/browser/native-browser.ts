import type { BrowserProfileProbeFactory, BrowserProfileProbeOptions } from "../../storage/browser-roots.js";
import { createTimeoutDeadlineScheduler } from "../scheduling/timeout-deadline-scheduler.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import { chromium, type BrowserContext, type CDPSession, type ConnectOverCDPTransport, type Page } from "playwright";
import type { Clock } from "../../../rules/time/clock.js";
import { BrowserSessionClosureUnprovedError, BrowserProfileStillClosingError, type BrowserSessionCloseReason } from "../../../workflow-kit/session.js";
import { ERROR_CATALOG } from "../../../models/failures/error-catalog.js";
import { AuthoritySourceClosureUnprovedError, createBrowserSourceRecovery, retainAuthoritySourceClosure } from "../../storage/source-closure.js";

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
  stop(timeoutMs: number, graceful?: true): Promise<void>;
}

const PROFILE_IN_USE_MESSAGES = ["Failed to create a ProcessSingleton for your profile directory.", "Opening in existing browser session."] as const;
// CDP command ids are signed 32-bit; a negative id stays clear of Playwright's positive ids. Its reply is consumed here.
const BROWSER_CLOSE_MESSAGE_ID = -(2 ** 31);

interface PinnedFormAttempt {
  readonly form: HTMLFormElement;
  readonly button: HTMLButtonElement;
  readonly password: HTMLInputElement;
  readonly destination: string;
  readonly valid: () => boolean;
}

declare global {
  interface Window {
    readonly relaySsoFormGuard?: {
      readonly installationId: string;
      arm(key: string, attempt: PinnedFormAttempt): boolean;
      click(key: string, form: HTMLFormElement): boolean;
    };
  }
}

export interface NativeSsoGuardKeys {
  readonly installationId: string;
  readonly actionKey: string;
}

const ssoGuards = new WeakMap<BrowserContext, { keys: NativeSsoGuardKeys } | { error: unknown }>();

export function nativeSsoGuardKeys(context: BrowserContext): NativeSsoGuardKeys | undefined {
  const guard = ssoGuards.get(context);
  if (guard && "error" in guard) throw new Error("UCSD_SSO_GUARD_UNAVAILABLE", { cause: guard.error });
  return guard?.keys;
}

const submittingPages = new WeakSet<Page>();

export async function withPinnedSsoPost(page: Page, destination: string, assertCurrent: () => void,
  submit: (allowPost: () => void) => Promise<void>): Promise<void> {
  assertCurrent();
  const source = new URL(page.url()), pin = new URL(destination);
  if (source.origin !== "https://a5.ucsd.edu" || source.username || source.password
    || !["/tritON/profile/SAML2/Redirect/SSO", "/idp/profile/SAML2/Redirect/SSO"].includes(source.pathname)
    || pin.origin !== source.origin || pin.username || pin.password || pin.pathname !== source.pathname
    || submittingPages.has(page)) throw new Error("UCSD_SSO_SCOPE");
  pin.hash = "";
  submittingPages.add(page);
  let session: CDPSession | undefined;
  let armed = false, complete = false, bypassRequested = false;
  let postedId: string | undefined;
  let refused: Promise<unknown> | undefined;
  let failure: { error: unknown } | undefined;
  const cleanup: unknown[] = [];
  try {
    const pipe = await page.context().newCDPSession(page);
    session = pipe;
    const { frameTree } = await pipe.send("Page.getFrameTree");
    pipe.on("Fetch.requestPaused", event => {
      const { requestId, request } = event;
      let command: Promise<unknown>;
      if (event.responseStatusCode !== undefined || event.responseErrorReason !== undefined) {
        // A 307 or 308 can resend this POST before the next document commits.
        if (event.responseStatusCode === 307 || event.responseStatusCode === 308) {
          failure ??= { error: new Error("UCSD_SSO_POST_REDIRECT_REFUSED") };
          command = pipe.send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" });
          refused = command;
        } else command = pipe.send("Fetch.continueResponse", { requestId });
      } else if (event.frameId === frameTree.frame.id && request.method !== "GET" && request.method !== "HEAD") {
        try {
          assertCurrent();
          if (failure || !armed || postedId || event.redirectedRequestId || request.method !== "POST" || request.url !== pin.href) {
            throw new Error("UCSD_SSO_POST_REFUSED");
          }
          postedId = requestId;
          command = pipe.send("Fetch.continueRequest", { requestId, interceptResponse: true });
        } catch (error) {
          failure ??= { error };
          command = pipe.send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" });
          if (!postedId || event.redirectedRequestId === postedId) refused = command;
        }
      } else command = pipe.send("Fetch.continueRequest", { requestId });
      void command.catch((error: unknown) => { failure ??= { error }; });
    });
    await pipe.send("Network.enable", { maxPostDataSize: 0 });
    await pipe.send("Fetch.enable", { patterns: [{ resourceType: "Document", requestStage: "Request" }] });
    assertCurrent();
    if (page.url() !== source.href) throw new Error("UCSD_SSO_SCOPE");
    bypassRequested = true;
    await pipe.send("Network.setBypassServiceWorker", { bypass: true });
    assertCurrent();
    await submit(() => {
      assertCurrent();
      if (failure) throw failure.error;
      if (armed || page.url() !== source.href) throw new Error("UCSD_SSO_SCOPE");
      armed = true;
    });
    if (!postedId) throw new Error("UCSD_SSO_SUBMIT_UNPROVED");
    complete = failure === undefined;
  } catch (error) { failure ??= { error }; }
  finally {
    if (session) {
      let stopPending = armed && !complete;
      armed = false;
      if (refused) {
        try { await refused; stopPending = false; } catch (error) { cleanup.push(error); }
      }
      if (stopPending) {
        try { await session.send("Page.stopLoading"); } catch (error) { cleanup.push(error); }
      }
      if (bypassRequested) {
        try { await session.send("Network.setBypassServiceWorker", { bypass: false }); } catch (error) { cleanup.push(error); }
      }
      try { await session.detach(); } catch (error) { cleanup.push(error); }
    }
    submittingPages.delete(page);
  }
  if (cleanup.length) throw new AggregateError(failure ? [failure.error, ...cleanup] : cleanup, "UCSD_SSO_CLEANUP");
  if (failure) throw failure.error;
}

function installDocumentSsoGuard({ installationId, actionKey }: NativeSsoGuardKeys): void {
  if (window !== top || location.origin !== "https://a5.ucsd.edu"
    || !["/tritON/profile/SAML2/Redirect/SSO", "/idp/profile/SAML2/Redirect/SSO"].includes(location.pathname)) return;
  const navigation: unknown = Reflect.get(window, "navigation");
  const navigateEvent: unknown = Reflect.get(window, "NavigateEvent");
  if (!(navigation instanceof EventTarget) || !Reflect.get(navigation, "currentEntry") || typeof navigateEvent !== "function") return;
  const prototype: unknown = Reflect.get(navigateEvent, "prototype");
  if (typeof prototype !== "object" || prototype === null) return;
  if (!("sourceElement" in prototype) || !("formData" in prototype)) return;

  let attempt: PinnedFormAttempt | undefined;
  let unused = false, clicking = false, serialized = false, permitted = false;
  const submissions: SubmitEvent[] = [];
  window.addEventListener("submit", event => {
    if (!event.isTrusted || !attempt || (event.target !== attempt.form && event.target !== attempt.password.form)) return;
    if (!clicking || event.submitter !== attempt.button || event.target !== attempt.form || !attempt.valid()) event.preventDefault();
    else submissions.push(event);
  }, true);
  // Chromium snapshots submitter overrides before formdata, then checks the form is still connected.
  window.addEventListener("formdata", event => {
    const target = event.target;
    if (!event.isTrusted || !attempt || !(target instanceof HTMLFormElement) || (target !== attempt.form && target !== attempt.password.form)) return;
    if (target === attempt.form && target.target === "_self" && attempt.valid() && (!clicking || attempt.button.formTarget === "_self")) {
      if (clicking && submissions.length === 1) serialized = true;
      return;
    }
    permitted = false;
    event.stopImmediatePropagation();
    for (const name of new Set(event.formData.keys())) event.formData.delete(name);
    const parent = target.parentNode, next = target.nextSibling;
    target.remove();
    setTimeout(() => {
      if (parent && !target.parentNode) parent.insertBefore(target, next?.parentNode === parent ? next : null);
    }, 0);
  }, true);
  // This event precedes the initial fetch, including dispatch to a service worker.
  navigation.addEventListener("navigate", event => {
    if (!attempt || !("sourceElement" in event) || (event.sourceElement !== attempt.button && event.sourceElement !== attempt.form)) return;
    const destination = "destination" in event && event.destination;
    const allowed = permitted && event.sourceElement === attempt.button && "formData" in event && event.formData instanceof FormData
      && typeof destination === "object" && destination !== null && "url" in destination && destination.url === attempt.destination && attempt.valid();
    permitted = false;
    if (!allowed) event.preventDefault();
  }, true);
  const guard: NonNullable<Window["relaySsoFormGuard"]> = {
    installationId,
    arm(candidate, next) {
      if (candidate !== actionKey || navigator.serviceWorker.controller !== null || !next.valid()) return false;
      next.form.target = "_self";
      attempt = next;
      unused = true;
      permitted = false;
      return true;
    },
    click(candidate, form) {
      if (candidate !== actionKey || !unused || !attempt || attempt.form !== form || !attempt.valid() || navigator.serviceWorker.controller !== null) return false;
      unused = false;
      const button = attempt.button;
      const previous = button.getAttribute("formtarget");
      button.formTarget = "_self";
      clicking = true;
      serialized = false;
      submissions.length = 0;
      permitted = false;
      try {
        button.click();
        permitted = serialized && submissions.length === 1 && submissions[0]?.defaultPrevented === false && attempt.valid() && button.formTarget === "_self";
        return permitted;
      } finally {
        clicking = false;
        if (button.formTarget === "_self") {
          if (previous === null) button.removeAttribute("formtarget");
          else button.setAttribute("formtarget", previous);
        }
      }
    },
  };
  Object.defineProperty(window, "relaySsoFormGuard", { value: Object.freeze(guard) });
}

export async function installNativeSsoGuard(context: BrowserContext): Promise<void> {
  const keys = Object.freeze({ installationId: randomUUID(), actionKey: randomUUID() });
  try {
    await context.addInitScript(installDocumentSsoGuard, keys);
    ssoGuards.set(context, { keys });
  } catch (error) {
    // Only credential submission depends on this installation.
    ssoGuards.set(context, { error });
  }
}

async function launchOwnedChromium(input: Parameters<PersistentContextLauncher["launch"]>[0]): Promise<BrowserContext> {
  const timeoutMs = z.number().positive().parse(input.timeoutMs);
  const child = spawn(chromium.executablePath(), ["--remote-debugging-pipe",
    `--user-data-dir=${input.profileDirectory}`, "--no-first-run", "--no-default-browser-check", "--no-sandbox",
    "--enable-automation", "--enable-unsafe-extension-debugging", "--disable-dev-shm-usage",
    "--disable-background-networking", "--disable-component-update", "--disable-component-extensions-with-background-pages", "--disable-breakpad", "--disable-sync", "--disable-default-apps",
    "--no-service-autorun", "--password-store=basic", "--use-mock-keychain",
    "--disable-features=PasswordManagerOnboarding,PasswordImport,PasswordManagerEnabled",
    ...(input.nativeOnly ? ["--disable-extensions"] : [`--disable-extensions-except=${input.extensionDirectory}`, `--load-extension=${input.extensionDirectory}`]),
    ...(input.headless ? ["--headless=new", "--no-startup-window"] : ["--no-startup-window"])],
  { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"], windowsHide: false });
  let exited = false, spawned = false, profileInUse = false, diagnosticTail = "";
  const closed = new Promise<void>(resolve => { child.once("close", () => resolve()); });
  child.stderr?.on("data", (data: Buffer) => {
    diagnosticTail = (diagnosticTail + data.toString("utf8")).slice(-512);
    if (PROFILE_IN_USE_MESSAGES.some(message => diagnosticTail.includes(message))) profileInUse = true;
  });
  let birthFailure: Error | undefined, processFailure: Error | undefined, closeRefused: ((error: Error) => void) | undefined;
  child.once("spawn", () => { spawned = true; });
  const startup: { connecting?: Promise<BrowserContext> } = {};
  const exit = new Promise<void>(resolve => {
    child.on("error", error => { if (!spawned && child.pid === undefined) { birthFailure = error; resolve(); } else processFailure = error; });
    child.once("exit", () => { exited = true; resolve(); });
  });
  // The child handle is the process-birth capability; no PID lookup or name-based kill.
  input.ownedProcess?.(Object.freeze({ exited: () => exited,
    onExit(callback: () => void) { if (exited) queueMicrotask(callback); else child.once("exit", callback); },
    async stop(deadlineMs: number, graceful?: true) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([(async () => {
          if (!exited && birthFailure === undefined) {
            if (graceful) {
              const context = await startup.connecting, browser = context?.browser();
              if (!browser) throw new Error("DUO_SETUP_STOP_FAILED");
              if (browser.isConnected()) {
                const refused = new Promise<never>((_resolve, reject) => { closeRefused = reject; });
                transport.send({ id: BROWSER_CLOSE_MESSAGE_ID, method: "Browser.close" });
                await Promise.race([exit, refused]);
              }
            } else if (!child.kill("SIGKILL")) throw new Error("DUO_SETUP_STOP_FAILED", processFailure === undefined ? undefined : { cause: processFailure });
          }
          await exit; await Promise.allSettled([startup.connecting]);
        })(), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("DUO_SETUP_STOP_FAILED")), deadlineMs); })]);
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
      if ("id" in value && value.id === BROWSER_CLOSE_MESSAGE_ID) { if ("error" in value) closeRefused?.(new Error("DUO_SETUP_STOP_FAILED")); continue; }
      transport.onmessage?.(value);
    }
  });
  const stopped = exit.then(async () => { await closed; throw new Error(profileInUse && exited ? PROFILE_IN_USE_MESSAGES[0] : "DUO_SETUP_OPEN_FAILED", birthFailure === undefined ? undefined : { cause: birthFailure }); });
  startup.connecting = (async () => {
    const browser = await chromium.connectOverCDP(transport, { timeout: timeoutMs, noDefaults: true });
    const context = browser.contexts()[0];
    if (!context || browser.contexts().length !== 1) throw new Error("DUO_SETUP_OPEN_FAILED");
    const pipe = await browser.newBrowserCDPSession();
    await pipe.send("Browser.setDownloadBehavior", { behavior: "deny" });
    await pipe.detach();
    await installNativeSsoGuard(context);
    return context;
  })();
  const timedOut = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("DUO_SETUP_OPEN_FAILED")), timeoutMs); });
  try {
    return await Promise.race([startup.connecting, stopped, timedOut]);
  } catch (error) {
    try { await Promise.race([closed, timedOut]); }
    catch (closure) { throw new BrowserLaunchUncertainError([error, closure], "owned browser launch closure unproved", { cause: error }); }
    if (exited && profileInUse) throw new Error(PROFILE_IN_USE_MESSAGES[0], { cause: error });
    throw error;
  } finally { clearTimeout(timer); }
}


export const DEFAULT_BROWSER_LAUNCHER: PersistentContextLauncher = {
  async launch(input) {
    if (input.ownedProcess !== undefined) return launchOwnedChromium(input);
    const context = await chromium.launchPersistentContext(input.profileDirectory, {
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
    await installNativeSsoGuard(context);
    return context;
  },
};

export interface ContextLifecycle {
  readonly closed: () => boolean;
  readonly closure?: Promise<void>;
}

export function observeContextLifecycle(context: BrowserContext): ContextLifecycle {
  let closed = false;
  const closure = new Promise<void>(resolve => { context.on("close", () => { closed = true; resolve(); }); });
  return { closed: () => closed, closure };
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
  return error instanceof Error && PROFILE_IN_USE_MESSAGES.some(message => error.message.includes(message));
}

type NativeRecovery = { directory: string; prove(assertCurrent: () => void): Promise<void> };

export async function runNativeContextProbe(input: NativeBrowserProbeInput, retainRecovery?: (failure: NativeBrowserClosureUnprovedError, recovery: NativeRecovery) => void): Promise<void> {
  input.signal.throwIfAborted();
  let context: BrowserContext | undefined, lifecycle: ContextLifecycle | undefined, process: OwnedBrowserProcess | undefined;
  const close = async (assertCurrent: () => void, force = false) => {
    assertCurrent();
    if (process) {
      const deadline = input.clock.monotonicMs() + input.closeProofMs;
      await process.stop(Math.max(1, deadline - input.clock.monotonicMs()), force ? undefined : true); assertCurrent();
      if (lifecycle && !lifecycle.closed()) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try { await Promise.race([lifecycle.closure, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("native-browser-stop-unproved")), Math.max(0, deadline - input.clock.monotonicMs())); })]); }
        finally { clearTimeout(timer); }
      }
      if (!process.exited() || context && (!lifecycle?.closed() || context.pages().some(page => !page.isClosed()))) throw new Error("native-browser-stop-unproved");
    } else {
      if (!context || !lifecycle) throw new Error("native-browser-owner-unavailable");
      await closeContextWithProof(input, context, lifecycle, "native profile probe", "profile-reset");
    }
    assertCurrent();
  };
  try {
    context = await (input.launcher ?? DEFAULT_BROWSER_LAUNCHER).launch({ ...input.launch, headless: true, acceptDownloads: false, nativeOnly: true,
      ownedProcess: owned => { if (process) throw new Error("native-browser-owner-replaced"); process = owned; } });
    lifecycle = observeContextLifecycle(context);
    await close(() => input.signal.throwIfAborted());
  } catch (error) {
    if (chromiumProfileInUse(error) && (process === undefined || process.exited())) throw new BrowserProfileStillClosingError(error);
    const failure = context === undefined ? new BrowserLaunchUncertainError([error], "native browser launch is uncertain", { cause: error }) : error;
    const source = retainAuthoritySourceClosure([failure], { directory: { context, process, profileDirectory: input.launch.profileDirectory } });
    const retained = new NativeBrowserClosureUnprovedError([source]), recovery = createBrowserSourceRecovery();
    recovery.retain(source); recovery.retain(retained);
    retainRecovery?.(retained, { directory: input.launch.profileDirectory, async prove(assertCurrent) { await recovery.prove(() => close(assertCurrent, true)); } });
    throw retained;
  }
  input.signal.throwIfAborted();
}

export function createNativeBrowserProbe(input: Parameters<BrowserProfileProbeFactory>[0] & Readonly<{
  scheduler?: BrowserDeadlineScheduler; launcher?: PersistentContextLauncher;
}>): BrowserProfileProbeOptions {
  const nativeRecoveries = new WeakMap<NativeBrowserClosureUnprovedError, NativeRecovery>();
  return Object.freeze({ signal: input.signal,
    async recoverOwned(error: unknown, directory: string, assertCurrent: () => void): Promise<void> {
      const pending = [error], seen = new Set<unknown>();
      while (pending.length) {
        const value = pending.pop(); if (seen.has(value)) continue; seen.add(value);
        if (value instanceof NativeBrowserClosureUnprovedError) {
          const recovery = nativeRecoveries.get(value);
          if (recovery?.directory === directory) await recovery.prove(assertCurrent);
        }
        if (value instanceof AggregateError) { const errors: readonly unknown[] = value.errors; pending.push(...errors); }
        if (value instanceof Error) pending.push(value.cause);
      }
    },
    async probe(profileRoot: string, profileDirectory: string): Promise<void> {
      z.number().positive().finite().parse(input.closeProofMs);
      await runNativeContextProbe({ ...input, profileRoot, scheduler: input.scheduler ?? createTimeoutDeadlineScheduler(input.clock),
        launch: { profileDirectory, extensionDirectory: "", downloadsPath: profileDirectory,
          viewport: { width: 800, height: 600 }, timeoutMs: input.launchTimeoutMs } }, (failure, recovery) => { nativeRecoveries.set(failure, recovery); });
    },
  });
}
