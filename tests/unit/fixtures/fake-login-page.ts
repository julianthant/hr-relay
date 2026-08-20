/**
 * A scripted stand-in for a Playwright `Page`, just wide enough to drive the
 * store login recipes without a browser.
 *
 * Locators are classified by what the recipe ASKS FOR — the SSO submit control,
 * the username/password fields, the campus-discovery link, the portal log-in
 * control, CRM's login-type picker, the Shibboleth stale-request text, and the
 * two application-side sign-in forms (PeopleSoft's signon, Salesforce
 * Communities' login) — so a test scripts page STATE ("the SSO form never
 * renders") rather than selector strings. If a recipe ever asks for something
 * unclassified, the fake fails loud instead of quietly reporting "not found",
 * which would let a broken recipe look like a legitimately absent element.
 *
 * The fake also serves the browser CONTEXT's cookie store, because that is
 * where the positive half of an authentication proof lives (2026-08-03): a
 * scripted page can look exactly like the authenticated application and still
 * have no session cookie, which is the state a URL check could not see.
 */
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

/**
 * Page states that are EXCEPTIONAL, so a script that does not mention them does
 * not have them (D243).
 *
 * Every other element defaults to present, which is the right default for a
 * control a recipe expects to find. Duo's terminal refusal is the opposite: it
 * is the screen a login lands on when it has already failed, and defaulting it
 * present would make every unrelated arm in this suite report a Duo refusal —
 * an assertion that passes for the wrong reason is the same defect this fake
 * exists to prevent.
 */
const ABSENT_UNLESS_SCRIPTED: ReadonlySet<FakeElementName> = new Set<FakeElementName>(["duo-refusal"]);

/**
 * A `waitForURL` settlement that NEVER resolves — a real page that simply sits
 * where it is. This is the live shape of the wedge §9.21 reproduced: the URL
 * stays on the Duo prompt for the whole window while the refusal renders beside
 * it, so a test that models the stall as an instant timeout cannot tell a wait
 * that OBSERVES the refusal from one that merely outlives its own bound.
 */
export const NEVER_SETTLES = "fake:never-settles";

export interface FakeElementScript {
  /** How many nodes match. Default 1. */
  readonly count?: number;
  /** Throw instead of completing the action (a timeout, a detached node…). */
  readonly failWith?: string;
  /** Current value for a `<select>`-style control. */
  readonly value?: string;
  /**
   * The value the control reports AFTER a selection. TritON's login-type picker
   * re-posts the whole form on change, so "did the realm actually switch" is a
   * second observation, not an assumption.
   */
  readonly valueAfterSelect?: string;
  /** Navigate the page when this element is actioned (click/select). */
  readonly navigatesTo?: string;
  /**
   * Model a CLIENT-RENDERED control: `count()` reports 0 until a `waitFor` has
   * resolved for it, and `count` afterwards. This is the shape Kuali Build
   * actually has (measured live 2026-08-04: the space paints zero `[role]`
   * nodes at `domcontentloaded` and its menubar ~1s later), and it is what
   * distinguishes a probe that WAITS for a fact from one that samples it once.
   */
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
  /**
   * Per-URL element state, checked before `elements`. This is what makes the
   * fake model a real page transition — the SSO form is genuinely gone once
   * the authenticated app renders, so a recipe's landing check is meaningful.
   */
  readonly elementsByUrl?: Readonly<Record<string, Partial<Record<FakeElementName, FakeElementScript>>>>;
  /** Where `goto` lands, keyed by requested URL; defaults to the requested URL. */
  readonly navigation?: Readonly<Record<string, string>>;
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
  // The recipe asks with a RegExp, so `argument` here is that pattern's SOURCE
  // (`/login request .*(?:canceled|cancelled) or timed out/i`) rather than a
  // sentence — the two spellings are alternated inside a group, so the phrase
  // is not contiguous and only its parts can be matched.
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
    context: () => browserContext,
    goto: async (target: string) => {
      actions.push(`goto:${target}`);
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
