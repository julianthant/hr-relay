import type { Page } from "playwright";

const HEADER = (field: string) => `[id*="${field}"]:not([id^="win0div"]):not(input):not(select):not(label):visible`;

/** `already-dated` is the record run 92dd9da8 reached: header and tabs shown, Effective Date and Position Change Reason labels pointing at display text, no input boxes. */
export type FakePayPathOutcome = "record" | "already-dated" | "alert" | "no-results" | "grid" | "nothing";

/** Answers exactly the locators `UCPATH_PAYPATH_UI` builds and records every fill and click; waits reject at once when a control is not shown or is the one named in `missing`. Fills stick unless named in `revert`. */
export function fakeUcpathPayPathPage(options: Readonly<{
  outcome?: FakePayPathOutcome; alertText?: string; name?: string; nameCount?: number; headerEmplId?: string; ambiguousPositionNumber?: boolean;
  missing?: string; revert?: string; postbackClears?: string; alertAfterFill?: string; saveButtons?: number; saveDisabled?: boolean; alertAfterSave?: string; saveStays?: boolean;
}> = {}) {
  let outcome = options.outcome ?? "record";
  let alertText = options.alertText;
  const actions: string[] = [];
  const gotos: string[] = [];
  let searched = false, saved = false, pressed: string | undefined;
  const values: Record<string, string> = {
    name: options.name ?? "Lee, Jordan", "empl-id-display": options.headerEmplId ?? "10000001",
    "effective-date": "07/01/2026", "position-change-reason": "", "position-pool": "", "position-number": "40012345",
    "job-data-comments": "", "initiator-comments": "",
  };
  const alertNow = (text: string) => { outcome = "alert"; alertText = text; };
  const positionBoxes = new Set(["effective-date", "position-change-reason", "position-pool", "position-number"]);
  function control(key: string) {
    const shown = () => {
      if (key === "busy" || key === options.missing) return false;
      if (key === "name" || key === "empl-id-display" || key.endsWith("-label") || key in values || key.endsWith("-tab") || key === "save") {
        return searched && (outcome === "record" || outcome === "already-dated" && !positionBoxes.has(key) || outcome === "alert" && key === "save");
      }
      if (key === "alert-ok" || key === "alert-text") return searched && outcome === "alert";
      if (key === "no-results") return searched && outcome === "no-results";
      if (key === "rows") return searched && outcome === "grid";
      return true;
    };
    const self = {
      first: () => self,
      count: async () => key === "position-number" && options.ambiguousPositionNumber === true ? 2
        : key === "name" && options.nameCount !== undefined && shown() ? options.nameCount
        : key === "save" && options.saveButtons !== undefined ? options.saveButtons
          : key === "rows" ? (shown() ? 2 : 0) : shown() ? 1 : 0,
      isVisible: async () => shown(),
      isEnabled: async () => !(key === "save" && options.saveDisabled === true),
      /** A label's `for` target: display text on the already-dated record, nothing when its box is `missing`, else an input box. */
      evaluate: async () => {
        if (!shown()) throw new Error(`Timeout waiting for ${key}`);
        const box = key.replace(/-label$/u, "");
        return outcome === "already-dated" ? "text" : options.missing === box ? "none" : "input";
      },
      waitFor: async (wait?: { state?: string }) => {
        if (wait?.state === "detached") { if (!(key === "save" && saved && options.alertAfterSave === undefined && options.saveStays !== true)) throw new Error(`Timeout waiting for ${key} to detach`); return; }
        if (wait?.state === "hidden" ? shown() : !shown()) throw new Error(`Timeout waiting for ${key}`);
      },
      press: async (keyName: string) => { actions.push(`press:${key}=${keyName}`); pressed = key; },
      innerText: async () => key === "alert-text" ? alertText ?? "" : values[key] ?? "",
      inputValue: async () => values[key] ?? "",
      fill: async (value: string) => {
        actions.push(`fill:${key}=${value}`);
        if (key in values && options.revert !== key) values[key] = value;
        if (key !== "empl-id-input" && options.alertAfterFill !== undefined) alertNow(options.alertAfterFill);
      },
      click: async () => {
        actions.push(`click:${key}`);
        if (key === "search") searched = true;
        if (key === "save") saved = true;
        if (key === "save" && options.alertAfterSave !== undefined) alertNow(options.alertAfterSave);
      },
    };
    return self;
  }
  const textboxes: Record<string, string> = {
    "Effective Date:": "effective-date", "Position Change Reason:": "position-change-reason",
    "Position Pool:": "position-pool", "Position Number:": "position-number",
    Comments: "job-data-comments", "Initiator's Comments": "initiator-comments",
  };
  const labels: Record<string, string> = { "Effective Date:": "effective-date-label", "Position Change Reason:": "position-change-reason-label" };
  const tabs: Record<string, string> = { "Position Data": "position-data-tab", "Job Data": "job-data-tab", "Additional Pay Data": "additional-pay-tab" };
  const frameSelectors: Record<string, string> = {
    "body > *": "body", "#UC_E102_PP_SRCH_EMPLID": "empl-id-input", "#PTS_CFG_CL_WRK_PTS_SRCH_BTN": "search", 'tr[id^="trPTS_CFG_CL_STD_RSL"]': "rows",
    [HEADER("NAME_DISPLAY")]: "name", [HEADER("EMPLID")]: "empl-id-display",
    '[id="UC_E102_PP_WRK_SUBMIT_BTN"]': "save", "#WAIT_win0": "busy",
  };
  const frame = {
    getByRole: (role: string, input: { name: string }) => {
      if (role === "link" && tabs[input.name] !== undefined) return control(tabs[input.name] ?? "");
      const key = textboxes[input.name];
      if (role !== "textbox" || key === undefined) throw new Error(`Unexpected PayPath frame role ${role}:${input.name}`);
      return control(key);
    },
    locator: (selector: string) => {
      const key = frameSelectors[selector];
      if (key === undefined) throw new Error(`Unexpected PayPath frame selector ${selector}`);
      return control(key);
    },
    getByText: (text: string | RegExp, input?: { exact?: boolean }) => {
      if (input?.exact === true && typeof text === "string" && labels[text] !== undefined) return control(labels[text] ?? "");
      if (!(text instanceof RegExp) || !text.test("No matching values were found")) throw new Error("Unexpected PayPath text recipe");
      return control("no-results");
    },
  };
  const page = {
    url: () => "https://ucphrprdpub.universityofcalifornia.edu/",
    goto: async (destination: string) => { gotos.push(destination); return null; },
    /** The network-idle settle: a PeopleSoft postback named by `postbackClears` empties that field once the page settles after its Tab. */
    waitForLoadState: async () => {
      actions.push("settle");
      if (pressed !== undefined && pressed === options.postbackClears) values[pressed] = "";
      pressed = undefined;
    },
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
  return { page, actions, gotos, values };
}
