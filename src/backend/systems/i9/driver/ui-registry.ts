import type { Locator, Page } from "playwright";
import { deepFreeze } from "../../../../rules/validation/immutability.js";

export const I9_APP_ORIGIN = "https://wwwe.i9complete.com";

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
  noResults: (dialog: Locator) => dialog.getByRole("heading", { name: "No results found", exact: true }),
  restricted: (dialog: Locator) => dialog.getByText(/has not been granted access/iu),
  summaryHeading: (page: Page) => page.getByRole("heading", { name: "I-9 Record Summary Information", exact: true }),
  auditHeader: (page: Page) => page.getByRole("row", { name: /Audit History Event/u }),
  signedRow: (page: Page) => page.getByRole("row", { name: /Signed Section 2/u }).first(),
  auditCells: (row: Locator) => row.getByRole("cell"),
});
