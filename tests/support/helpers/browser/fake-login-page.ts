
import type { Page } from "playwright";

export type FakeElementName =
  | "sso-submit"
  | "sso-username"
  | "sso-password"
  | "campus-link"
  | "portal-login"
  | "login-type-select"
  | "peoplesoft-signon"
  | "communities-login"
  | "kuali-app-chrome"
  | "stale-request"
  | "duo-refusal"
  | "training-reminder"
  | "i9-launch"
  | "i9-campus"
  | "i9-campus-select"
  | "i9-search-options"
  | "i9-training-dismiss"
  | "i9-training-confirm";


const ABSENT_UNLESS_SCRIPTED: ReadonlySet<FakeElementName> = new Set<FakeElementName>(["duo-refusal", "stale-request", "training-reminder"]);


export const NEVER_SETTLES = "fake:never-settles";

export interface FakeElementScript {
  /** How many nodes match. Default 1. */
  readonly count?: number;
  /** Throw instead of completing the action (a timeout, a detached node…). */
  readonly failWith?: string;
  /** Current value for a `<select>`-style control. */
  readonly value?: string;
  // TritON reposts the form when realm changes; verify the resulting selection independently.
  readonly valueAfterSelect?: string;
  /** Navigate the page when this element is actioned (click/select). */
  readonly navigatesTo?: string;
  // Count stays zero until waitFor settles, modeling Kuali client-rendered controls.
  readonly rendersAfterWait?: boolean;
}

export interface FakeCookie {
  readonly name: string;
  readonly domain: string;
  readonly value: string;
}

export interface FakePageScript {
  readonly url: string;
  readonly elements?: Partial<Record<FakeElementName, FakeElementScript>>;

  readonly elementsByUrl?: Readonly<Record<string, Partial<Record<FakeElementName, FakeElementScript>>>>;
  /** Where `goto` lands, keyed by requested URL; defaults to the requested URL. */
  readonly navigation?: Readonly<Record<string, string>>;
  /** A navigation rejected while another page navigation takes ownership. */
  readonly navigationFailures?: Readonly<Record<string, Readonly<{ message: string; landedAt: string }>>>;
  /** Where a `waitForURL` settles, in order. `undefined` entries time out. */
  readonly settlesTo?: readonly (string | undefined)[];
  /** The browser context's cookie store. Empty unless a test issues one. */
  readonly cookies?: readonly FakeCookie[];
  /** Cookies the context grows once the page reaches a given URL. */
  readonly cookiesByUrl?: Readonly<Record<string, readonly FakeCookie[]>>;
  /** Make the cookie store unreadable, so "unprovable" can be tested. */
  readonly cookieStoreFailsWith?: string;
}

export interface FakePageHarness {
  readonly page: Page;
  readonly url: () => string;
  readonly actions: () => readonly string[];
  readonly filled: () => readonly string[];
}

function classify(kind: string, argument: string): FakeElementName | undefined {
  if (kind === "locator" && argument === "#divSearchOptions") return "i9-search-options";
  if (kind === "locator" && argument === "#dropdownlist") return "i9-campus";
  if (kind === "role" && argument === "Tracker I-9 Complete Application") return "i9-launch";
  if (kind === "role" && argument === "Select") return "i9-campus-select";
  if (kind === "role" && argument === "Dismiss the Notification") return "i9-training-dismiss";
  if (kind === "role" && argument === "Yes") return "i9-training-confirm";
  if (kind === "locator" && argument === 'input[type="submit"][value*="Continue Log In"], button:has-text("Continue Log In")') return "training-reminder";
  if (kind === "locator" && argument.includes("_eventId_proceed")) return "sso-submit";
  if (kind === "locator" && (argument === "select" || argument.includes("authtype"))) return "login-type-select";
  if (kind === "locator" && argument.includes("ssousername")) return "sso-username";
  if (kind === "locator" && argument.includes("ssopassword")) return "sso-password";
  if (kind === "locator" && argument.includes("#userid")) return "peoplesoft-signon";
  if (kind === "locator" && argument.includes("#username")) return "communities-login";
  if (kind === "locator" && argument.includes("menuitem")) return "kuali-app-chrome";
  if (kind === "label" && /account id|user ?name|email address/i.test(argument)) return "sso-username";
  if (kind === "label" && /password/i.test(argument)) return "sso-password";
  if (kind === "role" && /university of california, san diego/i.test(argument)) return "campus-link";
  if (kind === "role" && /log in to ucpath/i.test(argument)) return "portal-login";
  if (kind === "text" && /stale request/i.test(argument)) return "stale-request";
  // The recipe passes a RegExp; match its source rather than a page sentence.
  if (kind === "text" && /cancell?ed/i.test(argument) && /timed out/i.test(argument)) return "duo-refusal";
  return undefined;
}

export function fakeLoginPage(script: FakePageScript): FakePageHarness {
  let current = script.url;
  const actions: string[] = [];
  const filled: string[] = [];
  const settlements = [...(script.settlesTo ?? [])];
  const selected = new Set<FakeElementName>();
  const rendered = new Set<FakeElementName>();
  const mainFrame = {
    url: () => current,
    getByText: (text: string | RegExp) => makeLocator(classify("text", String(text))),
  };
  let navigationGeneration = 0;
  const navigationListeners = new Set<() => void>();
  const frameObservers = new Set<(frame: typeof mainFrame) => void>();
  const navigate = (url: string): void => {
    current = url;
    navigationGeneration += 1;
    for (const listener of navigationListeners) listener();
    for (const observe of frameObservers) observe(mainFrame);
  };

  const scriptFor = (name: FakeElementName): FakeElementScript =>
    script.elementsByUrl?.[current]?.[name]
    ?? script.elements?.[name]
    ?? (ABSENT_UNLESS_SCRIPTED.has(name) ? { count: 0 } : {});

  function makeLocator(name: FakeElementName | undefined): Record<string, unknown> {
    const locator: Record<string, unknown> = {
      first: () => locator,
      filter: () => locator,
      evaluateAll: async (_fn: unknown, expectedUrl: string) =>
        expectedUrl === current && name === "duo-refusal" && (scriptFor(name).count ?? 1) > 0,
      elementHandle: async () => {
        const generation = navigationGeneration;
        return {
          isVisible: async () => (locator.isVisible as () => Promise<boolean>)(),
          isEditable: async () => name === "sso-username" || name === "sso-password",
          isEnabled: async () => name === "sso-submit",
          evaluateHandle: async () => ({ dispose: async () => undefined }),
          evaluate: async (_fn: unknown, input: {
            action: { kind: "prove" | "submit" } | { kind: "username" | "password"; value: string };
            password: { fill: (value: string) => Promise<void> }; button: { click: () => Promise<void> };
          }) => {
            if (name !== "sso-username" || generation !== navigationGeneration) return false;
            const action = input.action;
            if (action.kind === "username") await (locator.fill as (value: string) => Promise<void>)(action.value);
            if (action.kind === "password") await input.password.fill(action.value);
            if (action.kind === "submit") await input.button.click();
            return true;
          },
          fill: async (value: string) => {
            if (generation !== navigationGeneration) throw new Error("fake page: original element detached");
            await (locator.fill as (value: string) => Promise<void>)(value);
          },
          click: async (options: unknown) => {
            if (generation !== navigationGeneration) throw new Error("fake page: original element detached");
            await (locator.click as (options: unknown) => Promise<void>)(options);
          },
          dispose: async () => undefined,
        };
      },
      or: (other: Record<string, unknown>) => (name === undefined ? other : locator),
      count: async () => {
        if (name === undefined) return 0;
        const element = scriptFor(name);
        if (element.rendersAfterWait === true && !rendered.has(name)) return 0;
        return element.count ?? 1;
      },
      isVisible: async () => {
        if (name === undefined) return false;
        const element = scriptFor(name);
        if (element.failWith !== undefined) throw new Error(element.failWith);
        return (element.count ?? 1) > 0;
      },
      waitFor: async () => {
        if (name === undefined) throw new Error("fake page: waitFor on an unclassified locator");
        const element = scriptFor(name);
        if ((element.count ?? 1) === 0) throw new Error(`fake page: ${name} never appeared`);
        if (element.failWith !== undefined) throw new Error(element.failWith);
        rendered.add(name);
      },
      fill: async (value: string) => {
        if (name === undefined) throw new Error("fake page: fill on an unclassified locator");
        const element = scriptFor(name);
        if ((element.count ?? 1) === 0 || element.failWith !== undefined) {
          throw new Error(element.failWith ?? `fake page: ${name} is absent`);
        }
        filled.push(`${name}=${value}`);
      },
      click: async () => {
        if (name === undefined) throw new Error("fake page: click on an unclassified locator");
        const element = scriptFor(name);
        if ((element.count ?? 1) === 0 || element.failWith !== undefined) {
          throw new Error(element.failWith ?? `fake page: ${name} is absent`);
        }
        actions.push(`click:${name}`);
        if (element.navigatesTo !== undefined) navigate(element.navigatesTo);
        else if (name === "sso-submit") navigate(current);
      },
      inputValue: async () => {
        if (name === undefined) throw new Error("fake page: inputValue on an unclassified locator");
        const element = scriptFor(name);
        if (element.failWith !== undefined) throw new Error(element.failWith);
        if (selected.has(name)) return element.valueAfterSelect ?? element.value ?? "";
        return element.value ?? "";
      },
      selectOption: async () => {
        if (name === undefined) throw new Error("fake page: selectOption on an unclassified locator");
        const element = scriptFor(name);
        if (element.failWith !== undefined) throw new Error(element.failWith);
        actions.push(`select:${name}`);
        selected.add(name);
        return [];
      },
    };
    return locator;
  }

  const browserContext = {
    cookies: async (): Promise<readonly FakeCookie[]> => {
      if (script.cookieStoreFailsWith !== undefined) throw new Error(script.cookieStoreFailsWith);
      return [...(script.cookies ?? []), ...(script.cookiesByUrl?.[current] ?? [])];
    },
  };

  const page = {
    url: () => current,
    mainFrame: () => mainFrame,
    frames: () => [mainFrame],
    on: (_event: "framenavigated", listener: (frame: typeof mainFrame) => void) => frameObservers.add(listener),
    off: (_event: "framenavigated", listener: (frame: typeof mainFrame) => void) => frameObservers.delete(listener),
    waitForEvent: async (_event: string, options: Readonly<{ predicate: (frame: unknown) => boolean; timeout: number }>) =>
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          navigationListeners.delete(listener);
          reject(new Error("fake page: navigation event timed out"));
        }, options.timeout);
        const listener = (): void => {
          if (!options.predicate(mainFrame)) return;
          clearTimeout(timer);
          navigationListeners.delete(listener);
          resolve(mainFrame);
        };
        navigationListeners.add(listener);
      }),
    title: async () => "Fixture login page",
    context: () => browserContext,
    goto: async (target: string) => {
      actions.push(`goto:${target}`);
      const failure = script.navigationFailures?.[target];
      if (failure !== undefined) {
        current = failure.landedAt;
        throw new Error(failure.message);
      }
      navigate(script.navigation?.[target] ?? target);
      return null;
    },
    waitForURL: async (predicate: (url: URL) => boolean) => {
      const settled = settlements.shift();
      if (settled === NEVER_SETTLES) return await new Promise<void>(() => undefined);
      if (settled === undefined) throw new Error("fake page: waitForURL timed out");
      if (!predicate(new URL(settled))) throw new Error("fake page: waitForURL timed out");
      navigate(settled);
    },
    locator: (selector: string) => makeLocator(classify("locator", selector)),
    getByLabel: (text: string) => makeLocator(classify("label", text)),
    getByText: (text: string | RegExp) => makeLocator(classify("text", String(text))),
    getByRole: (_role: string, options: Readonly<{ name: string | RegExp }>) =>
      makeLocator(classify("role", String(options.name))),
  };

  return {
    page: page as unknown as Page,
    url: () => current,
    actions: () => Object.freeze([...actions]),
    filled: () => Object.freeze([...filled]),
  };
}
