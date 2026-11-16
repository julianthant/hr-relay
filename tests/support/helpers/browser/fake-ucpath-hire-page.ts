import type { Page } from "playwright";
import { UCPATH_HIRE_PROOF_EXAMPLE } from "../../../../src/models/ui/ucpath-hire.js";

export function fakeUcpathHirePage(options: Readonly<{
  rehire?: boolean; headerName?: string; disabled?: boolean; resetRate?: boolean; unknownSubmit?: boolean;
  submitSignal?: "confirmation" | "person-match" | "select-action" | "error";
  saved?: Omit<Partial<typeof UCPATH_HIRE_PROOF_EXAMPLE>, "approvalStatus"> & { approvalStatus?: string }; wrongConfirmation?: boolean;
  staleFilter?: boolean; presetName?: string; existingRows?: readonly typeof UCPATH_HIRE_PROOF_EXAMPLE[]; paged?: boolean; driftAfterDetail?: boolean;
}> = {}) {
  const origin = "https://ucphrprdpub.universityofcalifornia.edu/psc/ucphrprd/EMPLOYEE/HRMS/c/";
  let url = `${origin}ADMINISTER_WORKFORCE_(GBL).HR_TBH_JOB.GBL`, view: "wizard" | "clear" | "empty" | "detail" | "list" = "wizard";
  let submitted = false, selected = 0, expanded = !options.paged, returned = false, tab = options.rehire ? "Job Data" : "Personal Data", checked = false;
  const actions: string[] = [], visited = new Set<string>();
  const proof = { ...UCPATH_HIRE_PROOF_EXAMPLE, ...options.saved };
  const records = options.existingRows ?? [proof];
  const current = () => records[selected] ?? proof;
  const visibleRowCount = () => expanded ? records.length : Math.min(records.length, 1);
  const fields = new Map<string, string>(["Select Template", "Effective Date", "Empl ID", "Legal First Name", "Legal Last Name", "Legal Middle Name",
    "First Name", "Last Name", "Middle Name", "Date of Birth", "National ID", "Address Line 1", "Address Line 2", "City", "State", "Postal Code",
    "Tracker Profile ID", "Position Number", "Employee Classification", "Comp Rate Code", "Compensation Rate", "Compensation Frequency", "Expected Job End Date",
    "comments", "initiator", "email", "phone", "reason", "search-name", "filter:UC_TRANSACT_ID", "filter:EMPLID", "filter:ACTION", "filter:APPR_STATUS", "filter:BUSINESS_UNIT"].map(key => [key, ""]));
  if (options.rehire) { fields.set("Legal First Name", "Fixture"); fields.set("Legal Last Name", "Hire"); }
  function control(key: string) {
    const visible = () => ["submit-error", "person-match", "select-action"].includes(key) ? submitted && key === (options.submitSignal === "error" ? "submit-error" : options.submitSignal)
      : key === "ok" ? !submitted && options.rehire === true || submitted && options.submitSignal === "confirmation"
      : key === "rows" || key === "counter" ? view === "list" : key === "empty" ? view === "empty"
      : key === "transaction" ? view === "wizard" || view === "detail" : true;
    const text = () => key === "transaction" ? view === "wizard" ? "NEW" : current().transactionId
      : key === "status" ? current().approvalStatus : key === "header" ? options.headerName ?? "Fixture Hire"
      : key === "confirmation" ? options.wrongConfirmation ? "Unexpected warning" : "Person ID 10800000 already exists in the system for Fixture Hire. Select OK to continue the hire process with this Person ID."
      : key === "routing" ? `Transaction: ${current().transactionId}, ID: ${current().emplId ?? "NEW"}, Effdt: 2026-09-11,`
      : key === "detail-name" ? current().displayedName : key === "detail-action" ? current().action : key === "detail-date" ? current().effectiveDate
      : key === "counter" ? `1-${String(visibleRowCount())} of ${String(records.length)}` : key.startsWith("row-name:") ? records[Number(key.slice(9))]?.displayedName : key.startsWith("row-id:") ? options.driftAfterDetail && returned ? "T009999999" : records[Number(key.slice(7))]?.transactionId : key === "name-operator-selected" ? "begins with" : key === "reason-selected" ? fields.get("reason") : fields.get(key);
    return {
      count: async () => key === "rows" ? view === "list" ? visibleRowCount() : 0 : key === "transaction" ? view === "detail" || view === "wizard" ? 1 : 0 : key === "empty" ? view === "empty" ? 1 : 0 : 1,
      isVisible: async () => visible(),
      waitFor: async () => { if (!visible()) await new Promise(() => {}); },
      evaluate: async () => fields.has(key),
      inputValue: async () => {
        if (key === "filter:UC_TRANSACT_ID" && options.staleFilter) return "T009999999";
        const persisted = { "Tracker Profile ID": current().profileId ?? "", "Position Number": current().positionNumber, email: current().email, "Date of Birth": current().dob.replace(/^(\d{4})-(\d{2})-(\d{2})$/u, "$2/$3/$1") };
        const value = view === "detail" ? Object.entries(persisted).find(([field]) => field === key)?.[1] ?? fields.get(key) : fields.get(key);
        if (value === undefined) throw new Error(`Unexpected hire input ${key}`); return value;
      },
      innerText: async () => { const value = text(); if (value === undefined) throw new Error(`Unexpected hire text ${key}`); return value; },
      fill: async (value: string) => {
        if (!fields.has(key)) throw new Error(`Unexpected hire fill ${key}`);
        fields.set(key, value); actions.push(`fill:${key}`);
        if (key === "Compensation Frequency" && options.resetRate) fields.set("Compensation Rate", "");
      },
      press: async () => { actions.push(`blur:${key}`); },
      selectOption: async (value: { label: string }) => { fields.set(key, value.label); actions.push(`select:${key}`); },
      locator: (selector: string) => { if (selector !== "option:checked" || key !== "reason" && key !== "name-operator") throw new Error("Unexpected nested hire recipe"); return control(key === "reason" ? "reason-selected" : "name-operator-selected"); },
      check: async () => { checked = true; }, isChecked: async () => key === "case-sensitive" ? false : checked,
      isEnabled: async () => !options.disabled,
      first: () => control(key),
      click: async () => {
        actions.push(`click:${key}`);
        if (key.startsWith("tab:")) { tab = key.slice(4); visited.add(tab); }
        if (key === "search") view = submitted || options.existingRows !== undefined ? records.length === 1 ? "detail" : "list" : "empty";
        if (key === "back") { view = "list"; expanded = !options.paged; returned = true; }
        if (key === "view-all") expanded = true;
        if (key.startsWith("drill:")) { selected = Number(key.slice(6)); view = "detail"; }
        if (key === "save") {
          if (tab !== "Personal Data" || !visited.has("Job Data") && !options.rehire || !visited.has("Earns Dist")
            || !options.rehire && !visited.has("Employee Experience")) throw new Error("Hire tab walk incomplete");
          submitted = true;
          if (!options.unknownSubmit && options.submitSignal === undefined) { view = "detail"; url = `${origin}UC_EXTENSIONS.UC_SS_TBH.GBL`; }
        }
      },
    };
  }
  const selectors: Record<string, string> = { "#PERSON_NAME_NAME_DISPLAY": "header", "#UC_SS_TRANSACT_UC_TRANSACT_ID": "transaction", "#UC_SS_TRANSACT_APPR_STATUS": "status",
    "#HR_TBH_WRK_DESCRLONG_NOTES": "comments", "#UC_SS_TRANSACT_COMMENTS": "initiator", "#HR_TBH_WRK_EMPLID_PROMPT2": "Empl ID",
    '[id="HR_TBH_G_SCR_WK_TBH_G_LG_DD1$6"]': "phone-type", '[id="HR_TBH_G_SCR_WK_TBH_G_SH_EDIT2$6"]': "phone", '[id="HR_TBH_G_SCR_WK_TBH_G_CHK3$6"]': "phone-preferred",
    '[id="HR_TBH_G_SCR_WK_TBH_G_LG_DD1$7"]': "email-type", '[id="HR_TBH_G_SCR_WK_TBH_G_LG_EDIT2$7"]': "email",
    '[id="#ICOK"]': "ok", ".PSERROR, #ALERTMSG, .ps_alert-error": "submit-error",
    "#UC_SS_TBH_DVW_NAME": "search-name", "#PTS_CFG_CL_WRK_PTS_SRCH_BTN": "search", 'tr[id^="trPTS_CFG_CL_STD_RSL"]': "rows", '[id="#ICList"]': "back",
     '[id="NAME$span$0"]': "detail-name", '[id="UC_SS_TBH_VW_ACTION$0"]': "detail-action", '[id="UC_SS_TBH_VW_START_DT$0"]': "detail-date" };
  const page = {
    url: () => url,
    goto: async (destination: string) => {
      url = destination; view = destination.endsWith("UC_SS_TBH.GBL") ? "clear" : "wizard";
      if (view === "clear") fields.set("search-name", options.presetName ?? ""); return null;
    },
    waitForURL: async (predicate: (value: URL) => boolean) => { if (!predicate(new URL(url))) { if (options.unknownSubmit) throw new Error("Synthetic unknown hire outcome"); await new Promise(() => {}); } },
    locator: (selector: string) => {
      if (selector === '[id="UC_SS_TBH_DVW_NAME$op"]') return control("name-operator");
      if (/^#UC_SS_TBH_DVW_(?:UC_TRANSACT_ID|EMPLID|ACTION|APPR_STATUS|BUSINESS_UNIT)$/u.test(selector)) return control(`filter:${selector.replace("#UC_SS_TBH_DVW_", "")}`);
      const rowId = /^\[id="PTS_CFG_CL_RSLT_NUI_SRCH0\$11\$\$(\d+)"\]$/u.exec(selector);
      if (rowId !== null) return control(`row-id:${rowId[1]}`);
      const rowName = /^\[id="PTS_CFG_CL_RSLT_NUI_SRCH2\$13\$\$(\d+)"\]$/u.exec(selector);
      if (rowName !== null) return control(`row-name:${rowName[1]}`);
      const drill = /^\[id="PTS_CFG_CL_RSLT_PTS_DRILLIN\$40\$\$(\d+)"\]$/u.exec(selector);
      if (drill !== null) return control(`drill:${drill[1]}`);
      const key = selectors[selector]; if (key === undefined) throw new Error(`Unexpected hire selector ${selector}`); return control(key); },
    getByRole: (role: string, input: { name: string }) => {
      if (role === "textbox" && fields.has(input.name)) return control(input.name);
      if (role === "checkbox" && input.name === "Case Sensitive") return control("case-sensitive");
      if (role === "tab") return control(`tab:${input.name}`);
      if (role === "link" && input.name === "View All") return control("view-all");
      const buttons: Record<string, string> = { "Create Transaction": "draft", "Continue": "continue", "Save and Submit": "save", "OK": "ok" };
      const key = buttons[input.name]; if (role !== "button" || key === undefined) throw new Error(`Unexpected hire role ${role}:${input.name}`); return control(key);
    },
    getByLabel: (name: string) => { if (name !== "Reason Code") throw new Error("Unexpected hire label"); return control("reason"); },
    getByText: (pattern: string | RegExp) => {
      if (pattern === "Person Match Found") return control("person-match");
      if (pattern === "Select an Action") return control("select-action");
      if (typeof pattern === "string") return control("counter");
      if (pattern.test("Person ID 10800000 already exists in the system for Fixture Hire. Select OK to continue the hire process with this Person ID.")) return control("confirmation");
      if (pattern.test("No matching values were found")) return control("empty");
      if (pattern.test("1-1 of 1")) return control("counter");
      if (pattern.test(`Transaction: ${current().transactionId}`)) return control("routing");
      throw new Error("Unexpected hire text recipe");
    },
  } as unknown as Page;
  return { page, actions, fields };
}
