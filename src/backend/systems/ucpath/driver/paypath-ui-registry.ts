import type { FrameLocator, Page } from "playwright";
import { deepFreeze } from "../../../../rules/validation/immutability.js";
import { UCPATH_UI_REGISTRY } from "./ui-registry.js";

/**
 * PayPath Actions anchors ported from the old workflow's selectors (verified there 2026-03-17 / 2026-04-24).
 * shortcut: every anchor is unproven in Relay until the read-only live probe on work-study-workflow-01 records it; replace or confirm each one from that probe.
 * The Save-path anchors from `positionDataTab` on are unproven too: probe S1-S5 on work-study-workflow-02 records their legacy recipes and live results.
 */
export const UCPATH_PAYPATH_UI = deepFreeze({
  hrTasksUrl: "https://ucphrprdpub.universityofcalifornia.edu/psc/ucphrprd/EMPLOYEE/HRMS/c/NUI_FRAMEWORK.PT_AGSTARTPAGE_NUI.GBL?CONTEXTIDPARAMS=TEMPLATE_ID%3aPTPPNAVCOL&scname=ADMN_UC_ADMIN_LOC_HIRE_NAVCOLL&PanelCollapsible=Y&PTPPB_GROUPLET_ID=UC_HIRE_TASKS_TILE_FL&CRefName=UC_HIRE_TASKS_TILE_FL&AJAXTRANSFER=Y",
  frame: (page: Page): FrameLocator => page.frameLocator(UCPATH_UI_REGISTRY.root.selector),
  payPathCategory: (page: Page) => page.getByRole("link", { name: /^PayPath\/Additional Pay .*select to expand or collapse/u }),
  payPathActions: (page: Page) => page.getByRole("link", { name: "PayPath Actions", exact: true }),
  emplIdInput: (frame: FrameLocator) => frame.getByRole("textbox", { name: "Empl ID", exact: true }),
  searchButton: (frame: FrameLocator) => frame.locator("#PTS_CFG_CL_WRK_PTS_SRCH_BTN"),
  resultRows: (frame: FrameLocator) => frame.locator('tr[id^="trPTS_CFG_CL_STD_RSL"]'),
  noResults: (frame: FrameLocator) => frame.getByText(/No matching values were found/iu),
  alertOk: (page: Page) => page.getByRole("button", { name: "OK", exact: true }),
  alertText: (page: Page) => page.locator("#alertmsg, .PSALERTMSG, #ALERTMSG"),
  nameDisplay: (frame: FrameLocator) => frame.locator('[id="UC_E102_PP_WRK_NAME_DISPLAY"]'),
  emplIdDisplay: (frame: FrameLocator) => frame.locator('[id="UC_E102_PP_WRK_EMPLID"]'),
  effectiveDate: (frame: FrameLocator) => frame.getByRole("textbox", { name: "Effective Date:" }),
  positionChangeReason: (frame: FrameLocator) => frame.getByRole("textbox", { name: "Position Change Reason:" }),
  positionPool: (frame: FrameLocator) => frame.getByRole("textbox", { name: "Position Pool:" }),
  positionNumber: (frame: FrameLocator) => frame.getByRole("textbox", { name: "Position Number:" }),
  positionDataTab: (frame: FrameLocator) => frame.getByRole("link", { name: "Position Data", exact: true }),
  jobDataTab: (frame: FrameLocator) => frame.getByRole("link", { name: "Job Data", exact: true }),
  jobDataComments: (frame: FrameLocator) => frame.getByRole("textbox", { name: "Comments", exact: true }),
  additionalPayDataTab: (frame: FrameLocator) => frame.getByRole("link", { name: "Additional Pay Data", exact: true }),
  initiatorComments: (frame: FrameLocator) => frame.getByRole("textbox", { name: "Initiator's Comments", exact: true }),
  saveAndSubmit: (frame: FrameLocator) => frame.locator('[id="UC_E102_PP_WRK_SUBMIT_BTN"]'),
  busy: (frame: FrameLocator) => frame.locator("#WAIT_win0"),
});
