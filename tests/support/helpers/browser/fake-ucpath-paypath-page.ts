import type { Page } from "playwright";

export type FakePayPathOutcome = "record" | "alert" | "no-results" | "grid" | "nothing";

/** Answers exactly the locators `UCPATH_PAYPATH_UI` builds and records every fill and click; waits reject at once when a control is not shown. */
export function fakeUcpathPayPathPage(options: Readonly<{
  outcome?: FakePayPathOutcome; alertText?: string; name?: string; headerEmplId?: string; ambiguousPositionNumber?: boolean;
}> = {}) {
  const outcome = options.outcome ?? "record";
  const actions: string[] = [];
  const gotos: string[] = [];
  let searched = false;
  const values: Record<string, string> = {
    name: options.name ?? "Lee, Jordan", "empl-id-display": options.headerEmplId ?? "10000001",
    "effective-date": "07/01/2026", "position-change-reason": "", "position-pool": "", "position-number": "40012345",
  };
  function control(key: string) {
    const shown = () => {
      if (key === "name" || key === "empl-id-display" || key in values) return searched && outcome === "record";
      if (key === "alert-ok" || key === "alert-text") return searched && outcome === "alert";
      if (key === "no-results") return searched && outcome === "no-results";
      if (key === "rows") return searched && outcome === "grid";
      return true;
    };
    const self = {
      first: () => self,
      count: async () => key === "position-number" && options.ambiguousPositionNumber === true ? 2 : key === "rows" ? (shown() ? 2 : 0) : shown() ? 1 : 0,
      isVisible: async () => shown(),
      waitFor: async () => { if (!shown()) throw new Error(`Timeout waiting for ${key}`); },
      innerText: async () => key === "alert-text" ? options.alertText ?? "" : values[key] ?? "",
      inputValue: async () => values[key] ?? "",
      fill: async (value: string) => { actions.push(`fill:${key}=${value}`); },
      click: async () => { actions.push(`click:${key}`); if (key === "search") searched = true; },
    };
    return self;
  }
  const textboxes: Record<string, string> = {
    "Empl ID": "empl-id-input", "Effective Date:": "effective-date", "Position Change Reason:": "position-change-reason",
    "Position Pool:": "position-pool", "Position Number:": "position-number",
  };
  const frameSelectors: Record<string, string> = {
    "body > *": "body", "#PTS_CFG_CL_WRK_PTS_SRCH_BTN": "search", 'tr[id^="trPTS_CFG_CL_STD_RSL"]': "rows",
    '[id="UC_E102_PP_WRK_NAME_DISPLAY"]': "name", '[id="UC_E102_PP_WRK_EMPLID"]': "empl-id-display",
  };
  const frame = {
    getByRole: (role: string, input: { name: string }) => {
      const key = textboxes[input.name];
      if (role !== "textbox" || key === undefined) throw new Error(`Unexpected PayPath frame role ${role}:${input.name}`);
      return control(key);
    },
    locator: (selector: string) => {
      const key = frameSelectors[selector];
      if (key === undefined) throw new Error(`Unexpected PayPath frame selector ${selector}`);
      return control(key);
    },
    getByText: (pattern: RegExp) => {
      if (!pattern.test("No matching values were found")) throw new Error("Unexpected PayPath text recipe");
      return control("no-results");
    },
  };
  const page = {
    url: () => "https://ucphrprdpub.universityofcalifornia.edu/",
    goto: async (destination: string) => { gotos.push(destination); return null; },
    frameLocator: () => frame,
    getByRole: (role: string, input: { name: string | RegExp }) => {
      if (role === "button" && input.name === "OK") return control("alert-ok");
      if (role === "link" && input.name === "PayPath Actions") return control("actions");
      if (role === "link" && input.name instanceof RegExp && input.name.test("PayPath/Additional Pay  select to expand or collapse")) return control("category");
      throw new Error(`Unexpected PayPath page role ${role}:${String(input.name)}`);
    },
    locator: (selector: string) => {
      if (selector !== "#alertmsg, .PSALERTMSG, #ALERTMSG") throw new Error(`Unexpected PayPath page selector ${selector}`);
      return control("alert-text");
    },
  } as unknown as Page;
  return { page, actions, gotos };
}
