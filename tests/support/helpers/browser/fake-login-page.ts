
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
  | "duo-refusal";


const ABSENT_UNLESS_SCRIPTED: ReadonlySet<FakeElementName> = new Set<FakeElementName>(["duo-refusal"]);


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

  const scriptFor = (name: FakeElementName): FakeElementScript =>
    script.elementsByUrl?.[current]?.[name]
    ?? script.elements?.[name]
    ?? (ABSENT_UNLESS_SCRIPTED.has(name) ? { count: 0 } : {});

  function makeLocator(name: FakeElementName | undefined): Record<string, unknown> {
    const locator: Record<string, unknown> = {
      first: () => locator,
      or: (other: Record<string, unknown>) => (name === undefined ? other : locator),
      count: async () => {
        if (name === undefined) return 0;
        const element = scriptFor(name);
        if (element.rendersAfterWait === true && !rendered.has(name)) return 0;
        return element.count ?? 1;
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
        if (element.navigatesTo !== undefined) current = element.navigatesTo;
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
    title: async () => "Fixture login page",
    context: () => browserContext,
    goto: async (target: string) => {
      actions.push(`goto:${target}`);
      const failure = script.navigationFailures?.[target];
      if (failure !== undefined) {
        current = failure.landedAt;
        throw new Error(failure.message);
      }
      current = script.navigation?.[target] ?? target;
      return null;
    },
    waitForURL: async (predicate: (url: URL) => boolean) => {
      const settled = settlements.shift();
      if (settled === NEVER_SETTLES) return await new Promise<void>(() => undefined);
      if (settled === undefined) throw new Error("fake page: waitForURL timed out");
      if (!predicate(new URL(settled))) throw new Error("fake page: waitForURL timed out");
      current = settled;
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
