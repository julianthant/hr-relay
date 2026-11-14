import type { FrameLocator, Page } from "playwright";
import { deepFreeze } from "../../../../rules/validation/immutability.js";
import { UCPATH_UI_REGISTRY } from "./ui-registry.js";

/** A header display field: PeopleSoft wraps each field in a `win0div…` container and labels it, so only the visible value element counts. */
const headerField = (frame: FrameLocator, field: string) => frame.locator(`[id*="${field}"]:not([id^="win0div"]):not(input):not(select):not(label):visible`);

/**
 * PayPath Actions anchors ported from the old workflow's selectors (verified there 2026-03-17 / 2026-04-24).
 * shortcut: every anchor except `emplIdInput` is unproven in Relay; the record anchors come from run 92dd9da8's capture and the legacy recipes (work-study-workflow-08 lists each), and the live dry-run sign-off on staging confirms or replaces them.
 */
export const UCPATH_PAYPATH_UI = deepFreeze({
  hrTasksUrl: "https://ucphrprdpub.universityofcalifornia.edu/psc/ucphrprd/EMPLOYEE/HRMS/c/NUI_FRAMEWORK.PT_AGSTARTPAGE_NUI.GBL?CONTEXTIDPARAMS=TEMPLATE_ID%3aPTPPNAVCOL&scname=ADMN_UC_ADMIN_LOC_HIRE_NAVCOLL&PanelCollapsible=Y&PTPPB_GROUPLET_ID=UC_HIRE_TASKS_TILE_FL&CRefName=UC_HIRE_TASKS_TILE_FL&AJAXTRANSFER=Y",
  frame: (page: Page): FrameLocator => page.frameLocator(UCPATH_UI_REGISTRY.root.selector),
  payPathCategory: (page: Page) => page.getByRole("link", { name: /^PayPath\/Additional Pay .*select to expand or collapse/u }),
  payPathActions: (page: Page) => page.getByRole("link", { name: "PayPath Actions", exact: true }),
  // Live probe 2026-11-13 (work-study-workflow-06): the accessible name carries the search operator ("Empl ID begins with").
  emplIdInput: (frame: FrameLocator) => frame.locator("#UC_E102_PP_SRCH_EMPLID"),
  searchButton: (frame: FrameLocator) => frame.locator("#PTS_CFG_CL_WRK_PTS_SRCH_BTN"),
  resultRows: (frame: FrameLocator) => frame.locator('tr[id^="trPTS_CFG_CL_STD_RSL"]'),
  noResults: (frame: FrameLocator) => frame.getByText(/No matching values were found/iu),
  alertOk: (page: Page) => page.getByRole("button", { name: "OK", exact: true }),
  alertText: (page: Page) => page.locator("#alertmsg, .PSALERTMSG, #ALERTMSG"),
  // Run 92dd9da8: the record loaded but `#UC_E102_PP_WRK_NAME_DISPLAY` never showed; the legacy recipe's `[id*="NAME_DISPLAY"]` arm, kept to the value element.
  nameDisplay: (frame: FrameLocator) => headerField(frame, "NAME_DISPLAY"),
  emplIdDisplay: (frame: FrameLocator) => headerField(frame, "EMPLID"),
  effectiveDateLabel: (frame: FrameLocator) => frame.getByText("Effective Date:", { exact: true }),
  positionChangeReasonLabel: (frame: FrameLocator) => frame.getByText("Position Change Reason:", { exact: true }),
  effectiveDate: (frame: FrameLocator) => frame.getByRole("textbox", { name: "Effective Date:" }),
  positionChangeReason: (frame: FrameLocator) => frame.getByRole("textbox", { name: "Position Change Reason:" }),
  positionPool: (frame: FrameLocator) => frame.getByRole("textbox", { name: "Position Pool:" }),
  positionNumber: (frame: FrameLocator) => frame.getByRole("textbox", { name: "Position Number:" }),
  // Run 92dd9da8's capture: a second "Position Data" link sits below the tab strip, which comes first.
  positionDataTab: (frame: FrameLocator) => frame.getByRole("link", { name: "Position Data", exact: true }).first(),
  jobDataTab: (frame: FrameLocator) => frame.getByRole("link", { name: "Job Data", exact: true }),
  jobDataComments: (frame: FrameLocator) => frame.getByRole("textbox", { name: "Comments", exact: true }),
  additionalPayDataTab: (frame: FrameLocator) => frame.getByRole("link", { name: "Additional Pay Data", exact: true }),
  initiatorComments: (frame: FrameLocator) => frame.getByRole("textbox", { name: "Initiator's Comments", exact: true }),
  saveAndSubmit: (frame: FrameLocator) => frame.locator('[id="UC_E102_PP_WRK_SUBMIT_BTN"]'),
  busy: (frame: FrameLocator) => frame.locator("#WAIT_win0"),
});
