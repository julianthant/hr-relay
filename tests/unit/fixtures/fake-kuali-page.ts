/**
 * A scripted stand-in for a Playwright `Page`, just wide enough to drive the
 * Kuali RRSS document driver's identification path without a browser.
 *
 * It exists for one measured fact. Kuali Build renders this route in stages
 * (live, doc 4489, 2026-08-04): ~0.4s no headings at all, ~1.5s
 * `["", "Action", "Action List"]` — the document heading is present and EMPTY
 * beside two decoy headings — and ~3.0s `["4489", "Action", "Action List"]`.
 * So the recipe cannot be "the first h1" (it reads `""`) and cannot be "the
 * first non-empty h1" (it reads "Action"); it has to match the SHAPE of a
 * document number. This fake reproduces exactly that neighbourhood so the
 * narrowing is pinned rather than remembered.
 */
import type { Locator, Page } from "playwright";

export interface FakeKualiPageScript {
  readonly url: string;
  /** Level-1 heading texts in DOM order. */
  readonly headings: readonly string[];
  /** Value of the `EID*` textbox. */
  readonly eid: string;
  /** Value of the `Timekeeper Name:*` textbox. */
  readonly timekeeper: string;
}

function matchesName(text: string, name: string | RegExp | undefined, exact: boolean | undefined): boolean {
  if (name === undefined) return true;
  if (name instanceof RegExp) return name.test(text);
  return exact === true ? text === name : text.includes(name);
}

export function fakeKualiPage(script: FakeKualiPageScript): { page: Page; navigations: () => readonly string[] } {
  const navigations: string[] = [];

  const textLocator = (values: readonly string[]): Locator => {
    const locator = {
      first: () => locator,
      count: async () => values.length,
      waitFor: async () => {
        if (values.length === 0) throw new Error("fake kuali page: locator never appeared");
      },
      textContent: async () => values[0] ?? null,
      inputValue: async () => values[0] ?? "",
    };
    return locator as unknown as Locator;
  };

  const page = {
    url: () => script.url,
    goto: async (target: string) => {
      navigations.push(target);
      return null;
    },
    getByRole: (role: string, options?: Readonly<{ level?: number; name?: string | RegExp; exact?: boolean }>) => {
      if (role === "heading") {
        if (options?.level !== 1) return textLocator([]);
        return textLocator(script.headings.filter((text) => matchesName(text, options.name, options.exact)));
      }
      if (role === "textbox") {
        if (matchesName("EID*", options?.name, options?.exact)) return textLocator([script.eid]);
        if (matchesName("Timekeeper Name:*", options?.name, options?.exact)) return textLocator([script.timekeeper]);
        return textLocator([]);
      }
      return textLocator([]);
    },
  };
  return { page: page as unknown as Page, navigations: () => Object.freeze([...navigations]) };
}
