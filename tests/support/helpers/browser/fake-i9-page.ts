import type { Page } from "playwright";

export function i9SearchRow(overrides: Partial<{ lastName: string; firstName: string; profileId: string; i9Id: string; nextAction: string }> = {}): string[] {
  const row = { lastName: "Example", firstName: "Person", profileId: "900001", i9Id: "900002", nextAction: "Purge", ...overrides };
  return [row.lastName, row.firstName, "Example Employer", "Example Worksite", row.profileId, row.i9Id, row.nextAction, "01/01/2030", "01/01/2030"];
}

export function fakeI9Page(options: Readonly<{
  rows?: readonly (readonly string[])[];
  restricted?: boolean;
  signedCells?: readonly string[] | null;
  summaryRoute?: string;
  missingAudit?: boolean;
  missingResults?: boolean;
  restrictedProbeFails?: boolean;
  routeAfterAudit?: string;
  onGoto?: () => void;
}> = {}) {
  let url = "https://wwwe.i9complete.com";
  let searched = false;
  let auditReady = false;
  const actions: string[] = [];
  const fields = new Map<string, string>();
  const rows = options.rows ?? [i9SearchRow()];
  const signedCells = options.signedCells === undefined ? ["2", "01/01/2030", "Signed Section 2", "Example Representative"] : options.signedCells;
  type Target = "options" | "dialog" | "clear" | "search" | "grid" | "rows" | "row" | "gridcell" | "empty" | "restricted" | "heading" | "header" | "signed" | "cells" | "field" | "settled";
  function locator(target: Target, index = 0, field = "") {
    const count = (): number => {
      if (target === "rows" || target === "row") return searched ? rows.length : 0;
      if (target === "empty") return searched && rows.length === 0 && !options.missingResults ? 1 : 0;
      if (target === "restricted") {
        if (options.restrictedProbeFails) throw new Error("restriction probe detached");
        return options.restricted ? 1 : 0;
      }
      if (target === "signed") {
        if (!auditReady) throw new Error("audit was read before it was ready");
        return signedCells === null ? 0 : 1;
      }
      return 1;
    };
    const result = {
      first: () => result,
      last: () => result,
      nth: (rowIndex: number) => locator("row", rowIndex),
      or: () => locator("settled"),
      count: async () => count(),
      isVisible: async () => count() > 0,
      waitFor: async (input: { state: string }) => {
        actions.push(`wait:${target}:${input.state}`);
        if (target === "header") {
          if (options.missingAudit) throw new Error("audit table never rendered");
          auditReady = true;
          if (options.routeAfterAudit !== undefined) url = options.routeAfterAudit;
        }
        if (target === "settled" && options.missingResults) throw new Error("search results never rendered");
        if (input.state === "hidden" && count() > 0) throw new Error("stale search results");
      },
      click: async () => {
        actions.push(`click:${target}`);
        if (target === "clear") { searched = false; fields.clear(); }
        if (target === "search") searched = true;
      },
      fill: async (value: string) => { fields.set(field, value); },
      allTextContents: async () => {
        if (target === "gridcell") {
          const row = rows[index];
          if (row === undefined) throw new Error("fixture row missing");
          return row;
        }
        if (target === "cells" && signedCells !== null) return signedCells;
        throw new Error(`unexpected text read: ${target}`);
      },
      getByRole: (role: string, input?: { name: string | RegExp }) => byRole(role, input),
      filter: () => result,
      getByText: (text: RegExp) => {
        if (!text.test("has not been granted access")) throw new Error("unknown text recipe");
        return locator("restricted");
      },
    };
    function byRole(role: string, input?: { name: string | RegExp }) {
      if (role === "grid") return locator("grid");
      if (role === "row" && target === "grid") return locator("rows");
      if (role === "gridcell" && target === "row") return locator("gridcell", index);
      if (role === "cell" && target === "signed") return locator("cells");
      if (role === "textbox" && target === "dialog") return locator("field", 0, String(input?.name));
      if (role === "heading" && input?.name instanceof RegExp && input.name.test("No results found. Search again or click Create New Profile to create a new employee.")) return locator("empty");
      throw new Error(`unknown nested role ${role} in ${target}`);
    }
    return result;
  }
  const page = {
    url: () => url,
    goto: async (destination: string) => {
      actions.push(`goto:${destination}`);
      url = destination.includes("/summary/") ? (options.summaryRoute ?? destination) : destination;
      searched = false;
      auditReady = false;
      options.onGoto?.();
      return null;
    },
    locator: (selector: string) => {
      if (selector !== "#divSearchOptions") throw new Error(`unknown CSS recipe: ${selector}`);
      return locator("options");
    },
    getByRole: (role: string, input: { name: string | RegExp }) => {
      if (role === "dialog" && input.name === "Search for Existing Employee") return locator("dialog");
      if (role === "link" && input.name === "Clear Search Filters & Results") return locator("clear");
      if (role === "button" && input.name === "Search") return locator("search");
      if (role === "heading" && input.name === "I-9 Record Summary Information") return locator("heading");
      if (role === "row" && String(input.name) === "/Audit History Event/u") return locator("header");
      if (role === "row" && String(input.name) === "/Signed Section 2/u") return locator("signed");
      throw new Error(`unknown page role ${role}: ${String(input.name)}`);
    },
  } as unknown as Page;
  return { page, actions, fields };
}
