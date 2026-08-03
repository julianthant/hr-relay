/**
 * A scripted stand-in for a Playwright `Page`, just wide enough to drive the
 * store login recipes without a browser.
 *
 * Locators are classified by what the recipe ASKS FOR — the SSO submit control,
 * the username/password fields, the campus-discovery link, the portal log-in
 * control, CRM's login-type picker, the Shibboleth stale-request text — so a
 * test scripts page STATE ("the SSO form never renders") rather than selector
 * strings. If a recipe ever asks for something unclassified, the fake fails
 * loud instead of quietly reporting "not found", which would let a broken
 * recipe look like a legitimately absent element.
 */
import type { Page } from "playwright";

export type FakeElementName =
  | "sso-submit"
  | "sso-username"
  | "sso-password"
  | "campus-link"
  | "portal-login"
  | "login-type-select"
  | "stale-request";

export interface FakeElementScript {
  /** How many nodes match. Default 1. */
  readonly count?: number;
  /** Throw instead of completing the action (a timeout, a detached node…). */
  readonly failWith?: string;
  /** Current value for a `<select>`-style control. */
  readonly value?: string;
  /** Navigate the page when this element is actioned (click/select). */
  readonly navigatesTo?: string;
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
}

export interface FakePageHarness {
  readonly page: Page;
  readonly url: () => string;
  readonly actions: () => readonly string[];
  readonly filled: () => readonly string[];
}

function classify(kind: string, argument: string): FakeElementName | undefined {
  if (kind === "locator" && argument.includes("_eventId_proceed")) return "sso-submit";
  if (kind === "locator" && argument === "select") return "login-type-select";
  if (kind === "locator" && argument.includes("j_username")) return "sso-username";
  if (kind === "locator" && argument.includes("j_password")) return "sso-password";
  if (kind === "label" && /user ?name|email address/i.test(argument)) return "sso-username";
  if (kind === "label" && /password/i.test(argument)) return "sso-password";
  if (kind === "role" && /university of california, san diego/i.test(argument)) return "campus-link";
  if (kind === "role" && /log in to ucpath/i.test(argument)) return "portal-login";
  if (kind === "text" && /stale request/i.test(argument)) return "stale-request";
  return undefined;
}

export function fakeLoginPage(script: FakePageScript): FakePageHarness {
  let current = script.url;
  const actions: string[] = [];
  const filled: string[] = [];
  const settlements = [...(script.settlesTo ?? [])];

  const scriptFor = (name: FakeElementName): FakeElementScript =>
    script.elementsByUrl?.[current]?.[name] ?? script.elements?.[name] ?? {};

  function makeLocator(name: FakeElementName | undefined): Record<string, unknown> {
    const locator: Record<string, unknown> = {
      first: () => locator,
      or: (other: Record<string, unknown>) => (name === undefined ? other : locator),
      count: async () => {
        if (name === undefined) return 0;
        return scriptFor(name).count ?? 1;
      },
      waitFor: async () => {
        if (name === undefined) throw new Error("fake page: waitFor on an unclassified locator");
        const element = scriptFor(name);
        if ((element.count ?? 1) === 0) throw new Error(`fake page: ${name} never appeared`);
        if (element.failWith !== undefined) throw new Error(element.failWith);
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
        return element.value ?? "";
      },
      selectOption: async () => {
        if (name === undefined) throw new Error("fake page: selectOption on an unclassified locator");
        const element = scriptFor(name);
        if (element.failWith !== undefined) throw new Error(element.failWith);
        actions.push(`select:${name}`);
        return [];
      },
    };
    return locator;
  }

  const page = {
    url: () => current,
    goto: async (target: string) => {
      actions.push(`goto:${target}`);
      current = script.navigation?.[target] ?? target;
      return null;
    },
    waitForURL: async (predicate: (url: URL) => boolean) => {
      const settled = settlements.shift();
      if (settled === undefined) throw new Error("fake page: waitForURL timed out");
      if (!predicate(new URL(settled))) throw new Error("fake page: waitForURL timed out");
      current = settled;
    },
    locator: (selector: string) => makeLocator(classify("locator", selector)),
    getByLabel: (text: string) => makeLocator(classify("label", text)),
    getByText: (text: string) => makeLocator(classify("text", text)),
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
