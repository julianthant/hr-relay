import { randomUUID } from "node:crypto";
import type { BrowserContext, CDPSession, Page } from "playwright";

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
