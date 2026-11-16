import type { Page } from "playwright";
import { I9SearchRowSchema, type I9SearchRow } from "../../../../src/models/ui/i9.js";

export function fakeI9CreationPage(options: Readonly<{
  saveOutcome?: "route" | "ok" | "duplicate" | "error" | "unknown";
  remoteOutcome?: "success" | "error" | "both";
  redirectProfileId?: string;
  readOverrides?: Readonly<Record<string, string>>;
  worksiteLabel?: string;
  rows?: readonly I9SearchRow[];
  restricted?: boolean;
  summaryProfileId?: string;
  disabled?: boolean;
}> = {}) {
  let url = "https://wwwe.i9complete.com";
  let profileSaved = false, remoteCreated = false, profileOk = false, duplicate = false, profileError = false;
  let remoteSuccess = false, remoteError = false;
  const actions: string[] = [];
  const fields = new Map(Object.entries({ "First Name (Given Name)*": "Fixture", "Last Name (Family Name)*": "Hire", "Middle Name": "",
    "U.S. Social Security Number": "", "Date of Birth": "01/14/2000", "Employee's Email Address": "hire@example.test", "Start Date*": "" }));
  const wait = (visible: boolean): Promise<void> => visible ? Promise.resolve()
    : options.saveOutcome === "unknown" ? Promise.reject(new Error("synthetic named-outcome timeout")) : new Promise(() => {});
  const worksite = options.worksiteLabel ?? "6-000412 Example Worksite";
  let selectedWorksite = worksite;
  function control(kind: string, name = "") {
    const visible = () => kind === "ok" ? profileOk || remoteSuccess : kind === "duplicate" ? duplicate
      : kind === "profile-error" ? profileError : kind === "remote-success" ? remoteSuccess : kind === "remote-error" ? remoteError : true;
    return {
      count: async () => kind === "option" && !name ? 0 : 1,
      waitFor: async () => {
        if (kind === "option" && !name) throw new Error("fixture worksite option absent");
        await wait(visible());
      },
      isVisible: async () => visible(),
      isEnabled: async () => !options.disabled,
      inputValue: async () => {
        const value = options.readOverrides?.[name] ?? fields.get(name);
        if (value === undefined) throw new Error(`unexpected fixture field ${name}`);
        return value;
      },
      innerText: async () => { if (kind !== "worksite") throw new Error("unexpected fixture text read"); return selectedWorksite; },
      fill: async (value: string) => { if (!fields.has(name)) throw new Error(`unexpected fixture fill ${name}`); fields.set(name, value); actions.push(`fill:${name}`); },
      check: async () => { if (kind !== "radio") throw new Error("unexpected fixture checkbox"); actions.push("remote:section1"); },
      evaluate: async (operation: (element: { style: { display: string } }) => unknown) => operation({ style: { display: "block" } }),
      click: async () => {
        actions.push(`click:${kind}`);
        if (kind === "new-profile") {
          url = "https://wwwe.i9complete.com/employee/profile";
          for (const key of fields.keys()) fields.set(key, "");
          selectedWorksite = "";
        }
        if (kind === "option") selectedWorksite = worksite;
        if (kind === "save-profile") {
          profileSaved = true;
          const outcome = options.saveOutcome ?? "route";
          if (outcome === "route") url = "https://wwwe.i9complete.com/employee/profile/900001";
          if (outcome === "ok") profileOk = true;
          if (outcome === "duplicate") duplicate = true;
          if (outcome === "error") profileError = true;
        }
        if (kind === "create-remote") {
          remoteCreated = true;
          remoteSuccess = options.remoteOutcome !== "error";
          remoteError = options.remoteOutcome === "error" || options.remoteOutcome === "both";
        }
        if (kind === "ok") {
          profileOk = false; remoteSuccess = false;
          url = "https://wwwe.i9complete.com/employee/profile/900001";
        }
      },
    };
  }
  const page = {
    url: () => url,
    goto: async (destination: string) => {
      url = destination;
      if (/\/employee\/profile\/[1-9]\d*/u.test(new URL(url).pathname)) selectedWorksite = worksite;
      if (options.redirectProfileId !== undefined && /\/employee\/profile\/[1-9]\d*/u.test(new URL(url).pathname)) {
        url = `https://wwwe.i9complete.com/employee/profile/${options.redirectProfileId}`;
      }
      actions.push("navigate"); return null;
    },
    waitForURL: async (predicate: (current: URL) => boolean) => wait(predicate(new URL(url))),
    locator: (selector: string) => {
      if (selector === "#ui-datepicker-div") return control("datepicker");
      if (selector === ".ErrorMessage:visible") return control("remote-error");
      throw new Error(`unexpected creation selector ${selector}`);
    },
    getByRole: (role: string, input: { name: string | RegExp }) => {
      const name = input.name;
      if (role === "textbox" && typeof name === "string" && fields.has(name)) return control("field", name);
      if (role === "listbox" && name === "Worksite *") return control("worksite");
      if (role === "option" && name instanceof RegExp) return control("option", name.test(worksite) ? worksite : "");
      if (role === "link" && name === "create new I9: new employee") return control("new-profile");
      if (role === "button" && name === "Save & Continue") return control("save-profile");
      if (role === "button" && name === "Create I-9") return control("create-remote");
      if (role === "button" && name === "OK") return control("ok");
      if (role === "heading" && name === "Error Summary:") return control("profile-error");
      if (role === "dialog" && name === "Duplicate Employee Record") return control("duplicate");
      if (role === "radio" && name === "Remote - Section 1 Only") return control("radio");
      throw new Error(`unexpected creation role ${role}:${String(name)}`);
    },
    getByText: (pattern: RegExp) => {
      if (!pattern.test("Remote Access Form I-9 email(s) has been sent")) throw new Error("unexpected remote success recipe");
      return control("remote-success");
    },
  } as unknown as Page;
  const reads = {
    searchEmployees: async () => {
      actions.push("read:search");
      const rows = options.rows ?? (profileSaved || remoteCreated ? [I9SearchRowSchema.parse({ firstName: "Fixture", lastName: "Hire", employer: "Example",
        worksite, profileId: "900001", i9Id: remoteCreated ? "900002" : "", nextAction: "Complete Section 1", startDate: fields.get("Start Date*"), createdOn: "09/01/2026" })] : []);
      return { rows: [...rows], restricted: options.restricted ?? false };
    },
    readRecordSummary: async () => ({ i9Status: "unsigned" as const, signerName: "" as const,
      profileId: options.summaryProfileId ?? "900001", i9Id: "900002" }),
  };
  return { page, reads, actions, fields, setUrl: (value: string) => { url = value; } };
}
