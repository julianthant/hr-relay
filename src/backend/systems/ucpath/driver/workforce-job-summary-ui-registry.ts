import type { Locator, Page } from "playwright";
import { deepFreeze } from "../../../../rules/validation/immutability.js";

/**
 * Workforce Job Summary (WF_JOB_SUMMARY) anchors, taken from the page facts the old dashboard verified live
 * (search and Fluid results grid 2026-06-24, detail header 2026-06-18, frozen job grids 2026-08-20, campus discovery 2026-06-22);
 * the detail header's Empl ID was verified live by Relay on 2026-11-17.
 * The page is a Fluid component with no content iframe, so every anchor is page-scoped.
 */
export const UCPATH_WORKFORCE_JOB_SUMMARY_UI = deepFreeze({
  url: "https://ucphrprdpub.universityofcalifornia.edu/psc/ucphrprd/EMPLOYEE/HRMS/c/ADMINISTER_WORKFORCE_(GBL).WF_JOB_SUMMARY.GBL",
  componentUrlMarker: "WF_JOB_SUMMARY",
  campusDiscoveryUrlMarker: "ucpathdiscovery",
  campusDiscoveryUcsdLink: (page: Page) => page.getByRole("link", { name: "University of California, San Diego" }),
  emplIdInput: (page: Page) => page.getByRole("textbox", { name: "Empl ID" }),
  searchButton: (page: Page) => page.getByRole("button", { name: "Search", exact: true }),
  noResults: (page: Page) => page.getByText("No matching values were found.", { exact: true }),
  /** One clickable row per employee record; the row's own onclick drills in, and some renderings add a nested "Drill in" link. */
  resultRows: (page: Page) => page.locator("tr[id^=\"trPTS_CFG_CL_STD_RSL\"]"),
  resultDrillIn: (row: Locator) => row.getByRole("link", { name: /drill in/iu }).or(row).first(),
  /** Result cells by search column: SRCH1 Empl Record, SRCH11 Job Code, SRCH13 Payroll Status. The `$` keeps SRCH1 off SRCH11/SRCH13. */
  resultEmplRecord: (row: Locator) => row.locator("span[id^=\"PTS_CFG_CL_RSLT_NUI_SRCH1$\"]"),
  resultJobCode: (row: Locator) => row.locator("span[id^=\"PTS_CFG_CL_RSLT_NUI_SRCH11$\"]"),
  resultPayrollStatus: (row: Locator) => row.locator("span[id^=\"PTS_CFG_CL_RSLT_NUI_SRCH13$\"]"),
  personName: (page: Page) => page.locator("#DERIVED_NAME_DISPLAY_NAME"),
  /** The detail header's Empl ID, in the same header table as the name (verified live 2026-11-17, multi-record subject). */
  displayedEmplId: (page: Page) => page.locator("#PER_ORG_ASGN_VW_EMPLID"),
  /** The detail tabs render as links styled as tabs on some loads, so match either role. */
  workLocationTab: (page: Page) => page.getByRole("tab", { name: "Work Location" })
    .or(page.getByRole("link", { name: "Work Location", exact: true })).first(),
  jobInformationTab: (page: Page) => page.getByRole("tab", { name: "Job Information" })
    .or(page.getByRole("link", { name: "Job Information", exact: true })).first(),
  /** A frozen-column grid: the left table holds Org Relationship, Empl Record, Effective Date, Seq; the right table, row-aligned, holds the open tab's columns. */
  frozenLeftTableId: "tdgblWF_JOB_SUMM$0",
  frozenRightTableId: "tdgbrWF_JOB_SUMM$0",
});
