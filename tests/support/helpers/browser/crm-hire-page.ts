import type { Locator, Page } from "playwright";

class FixtureLocator {
  constructor(readonly nodes: readonly Element[]) {}
  async count() { return this.nodes.length; }
  first() { return this.nth(0); }
  nth(index: number): Locator {
    const node = this.nodes[index];
    return new FixtureLocator(node === undefined ? [] : [node]) as unknown as Locator;
  }
  async waitFor() {
    if (this.nodes.length !== 1) throw new Error("fixture has no unique visible element");
  }
  async textContent() {
    const node = this.nodes[0];
    if (node === undefined) throw new Error("fixture element is absent");
    return node.textContent;
  }
  async getAttribute(name: string) {
    const node = this.nodes[0];
    if (node === undefined) throw new Error("fixture element is absent");
    return node.getAttribute(name);
  }
  locator(selector: string): Locator {
    const nodes = this.nodes.flatMap(node => {
      if (selector !== "xpath=following-sibling::*[1][self::td]") return [...node.querySelectorAll(selector)];
      const sibling = node.nextElementSibling;
      return sibling?.tagName === "TD" ? [sibling] : [];
    });
    return new FixtureLocator(nodes) as unknown as Locator;
  }
  filter(options: { hasText?: string | RegExp }): Locator {
    const expected = options.hasText;
    return new FixtureLocator(this.nodes.filter(node => expected instanceof RegExp
      ? expected.test(node.textContent === null ? "" : node.textContent)
      : expected !== undefined && node.textContent?.includes(expected))) as unknown as Locator;
  }
}

export function createCrmHireFixturePage(render: (url: URL, visit: number) => { html: string; url?: string }) {
  let currentUrl = "https://act-crm.my.site.com/hr/ONB_SearchOnboardings";
  let root = document.implementation.createHTMLDocument();
  const visits = new Map<string, number>();
  const navigations: string[] = [];
  const page = {
    async goto(url: string) {
      navigations.push(url);
      const prior = visits.get(url);
      const visit = (prior === undefined ? 0 : prior) + 1;
      visits.set(url, visit);
      const rendered = render(new URL(url), visit);
      currentUrl = rendered.url === undefined ? url : rendered.url;
      root = document.implementation.createHTMLDocument();
      root.body.innerHTML = rendered.html;
      return null;
    },
    url: () => currentUrl,
    locator(selector: string) { return new FixtureLocator([...root.querySelectorAll(selector)]) as unknown as Locator; },
    getByRole(role: string, options: { name: string; exact: boolean }) {
      if (role !== "heading" || !options.exact) throw new Error("fixture only supports exact headings");
      return new FixtureLocator([...root.querySelectorAll("h1, h2, h3")].filter(node => node.textContent === options.name)) as unknown as Locator;
    },
  } as unknown as Page;
  return { page, navigations };
}
