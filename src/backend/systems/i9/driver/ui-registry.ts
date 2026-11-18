import type { Locator, Page } from "playwright";
import { deepFreeze } from "../../../../rules/validation/immutability.js";

export const I9_APP_ORIGIN = "https://wwwe.i9complete.com";

export const I9_CREATION_UI = deepFreeze({
  field: (page: Page, key: "firstName" | "lastName" | "middleName" | "ssn" | "dob" | "email") => page.getByRole("textbox", {
    name: { firstName: "First Name (Given Name)*", lastName: "Last Name (Family Name)*", middleName: "Middle Name",
      ssn: "U.S. Social Security Number", dob: "Date of Birth", email: "Employee's Email Address" }[key], exact: true }),
  createProfile: (page: Page) => page.getByRole("link", { name: "create new I9: new employee", exact: true }),
  worksite: (page: Page) => page.getByRole("listbox", { name: "Worksite *", exact: true }),
  worksiteOption: (page: Page, department: string) => page.getByRole("option", { name: new RegExp(`^6-${department}(?:\\s|$)`, "u") }),
  datepicker: (page: Page) => page.locator("#ui-datepicker-div"),
  saveProfile: (page: Page) => page.getByRole("button", { name: "Save & Continue", exact: true }),
  duplicate: (page: Page) => page.getByRole("dialog", { name: "Duplicate Employee Record", exact: true }),
  profileError: (page: Page) => page.getByRole("heading", { name: "Error Summary:", exact: true }),
  ok: (page: Page) => page.getByRole("button", { name: "OK", exact: true }),
  remoteSection1: (page: Page) => page.getByRole("radio", { name: "Remote - Section 1 Only", exact: true }),
  startDate: (page: Page) => page.getByRole("textbox", { name: "Start Date*", exact: true }),
  createRemote: (page: Page) => page.getByRole("button", { name: "Create I-9", exact: true }),
  remoteSuccess: (page: Page) => page.getByText(/^Remote Access Form I-9 (?:email\(s\)|message\(s\)) has been sent$/u, { exact: true }),
  remoteError: (page: Page) => page.locator(".ErrorMessage:visible"),
});

export const I9_UI_REGISTRY = deepFreeze({
  launch: (page: Page) => page.getByRole("link", { name: "Tracker I-9 Complete Application", exact: true }),
  campus: (page: Page) => page.locator("#dropdownlist"),
  selectCampus: (page: Page) => page.getByRole("button", { name: "Select", exact: true }),
  dismissTraining: (page: Page) => page.getByRole("button", { name: "Dismiss the Notification", exact: true }),
  confirmTraining: (page: Page) => page.getByRole("button", { name: "Yes", exact: true }),
  searchOptions: (page: Page) => page.locator("#divSearchOptions"),
  dialog: (page: Page) => page.getByRole("dialog", { name: "Search for Existing Employee", exact: true }),
  clear: (page: Page) => page.getByRole("link", { name: "Clear Search Filters & Results", exact: true }),
  lastName: (dialog: Locator) => dialog.getByRole("textbox", { name: "Last Name", exact: true }),
  firstName: (dialog: Locator) => dialog.getByRole("textbox", { name: /First Name/u }),
  ssn: (dialog: Locator) => dialog.getByRole("textbox", { name: "Social Security Number", exact: true }),
  profileId: (dialog: Locator) => dialog.getByRole("textbox", { name: "Profile ID", exact: true }),
  employeeId: (dialog: Locator) => dialog.getByRole("textbox", { name: "Employee ID", exact: true }),
  submitSearch: (page: Page) => page.getByRole("button", { name: "Search", exact: true }),
  resultRows: (dialog: Locator) => dialog.getByRole("grid").last().getByRole("row"),
  rowCells: (row: Locator) => row.getByRole("gridcell"),
  noResults: (dialog: Locator) => dialog.getByRole("heading", { name: /^No results found\. Search again/u }),
  restricted: (dialog: Locator) => dialog.getByText(/has not been granted access/iu).filter({ visible: true }),
  summaryHeading: (page: Page) => page.getByRole("heading", { name: "I-9 Record Summary Information", exact: true }),
  auditHeader: (page: Page) => page.getByRole("row", { name: /Audit History Event/u }),
  signedRow: (page: Page) => page.getByRole("row", { name: /Signed Section 2/u }).first(),
  auditCells: (row: Locator) => row.getByRole("cell"),
});
