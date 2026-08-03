import { z } from "zod";
import type {
  SearchPersonOrgInputSchema,
  SearchPersonOrgOutput,
} from "../contracts/ucpath/search-person-org.js";
import { EidSchema } from "../ids.js";
import type { Eid } from "../ids.js";
import type { SystemDriver } from "./driver.js";

export const UcpathPersonOrgSearchScreenSchema = z.literal("ucpath.person-org.search").brand<"ScreenId">();
export const UcpathPersonOrgDetailScreenSchema = z.literal("ucpath.person-org.detail").brand<"ScreenId">();
export const UcpathPersonOrgSearchReadyStateSchema = z.literal("ucpath.person-org.search-ready").brand<"PageStateId">();
export const UcpathPersonOrgResultsReadyStateSchema = z.literal("ucpath.person-org.results-ready").brand<"PageStateId">();
export const UcpathPersonOrgNoResultsStateSchema = z.literal("ucpath.person-org.no-results").brand<"PageStateId">();
export const UcpathPersonOrgDetailReadyStateSchema = z.literal("ucpath.person-org.detail-ready").brand<"PageStateId">();
export const UcpathPersonOrgNavigationLinkSchema = z.literal("ucpath.person-org.navigation-link").brand<"ElementId">();
export const UcpathPersonOrgEidInputSchema = z.literal("ucpath.person-org.eid-input").brand<"ElementId">();
export const UcpathPersonOrgLastNameInputSchema = z.literal("ucpath.person-org.last-name-input").brand<"ElementId">();
export const UcpathPersonOrgGivenNameInputSchema = z.literal("ucpath.person-org.given-name-input").brand<"ElementId">();
export const UcpathPersonOrgSearchButtonSchema = z.literal("ucpath.person-org.search-button").brand<"ElementId">();
export const UcpathPersonOrgNoResultsStatusSchema = z.literal("ucpath.person-org.no-results-status").brand<"ElementId">();
export const UcpathPersonOrgResultsGridSchema = z.literal("ucpath.person-org.results-grid").brand<"ElementId">();
export const UcpathPersonOrgResultDrillInSchema = z.literal("ucpath.person-org.result-drill-in").brand<"ElementId">();
export const UcpathPersonOrgEidDisplaySchema = z.literal("ucpath.person-org.eid-display").brand<"ElementId">();
export const UcpathPersonOrgNameDisplaySchema = z.literal("ucpath.person-org.name-display").brand<"ElementId">();
export const UcpathPersonOrgAssignmentsGridSchema = z.literal("ucpath.person-org.assignments-grid").brand<"ElementId">();
export const UcpathPersonOrgReturnToSearchSchema = z.literal("ucpath.person-org.return-to-search").brand<"ElementId">();
export const UcpathPersonOrgDisplayedEidSchema = z.literal("ucpath.person-org.displayed-eid").brand<"ObservationId">();
export const UcpathPersonOrgDisplayedNameSchema = z.literal("ucpath.person-org.displayed-name").brand<"ObservationId">();

export const UCPATH_PERSON_ORG_SEARCH_SCREEN = UcpathPersonOrgSearchScreenSchema.parse("ucpath.person-org.search");
export const UCPATH_PERSON_ORG_DETAIL_SCREEN = UcpathPersonOrgDetailScreenSchema.parse("ucpath.person-org.detail");
export const UCPATH_PERSON_ORG_SEARCH_READY = UcpathPersonOrgSearchReadyStateSchema.parse("ucpath.person-org.search-ready");
export const UCPATH_PERSON_ORG_RESULTS_READY = UcpathPersonOrgResultsReadyStateSchema.parse("ucpath.person-org.results-ready");
export const UCPATH_PERSON_ORG_NO_RESULTS = UcpathPersonOrgNoResultsStateSchema.parse("ucpath.person-org.no-results");
export const UCPATH_PERSON_ORG_DETAIL_READY = UcpathPersonOrgDetailReadyStateSchema.parse("ucpath.person-org.detail-ready");
export const UCPATH_PERSON_ORG_NAVIGATION_LINK = UcpathPersonOrgNavigationLinkSchema.parse("ucpath.person-org.navigation-link");
export const UCPATH_PERSON_ORG_EID_INPUT = UcpathPersonOrgEidInputSchema.parse("ucpath.person-org.eid-input");
export const UCPATH_PERSON_ORG_LAST_NAME_INPUT = UcpathPersonOrgLastNameInputSchema.parse("ucpath.person-org.last-name-input");
export const UCPATH_PERSON_ORG_GIVEN_NAME_INPUT = UcpathPersonOrgGivenNameInputSchema.parse("ucpath.person-org.given-name-input");
export const UCPATH_PERSON_ORG_SEARCH_BUTTON = UcpathPersonOrgSearchButtonSchema.parse("ucpath.person-org.search-button");
export const UCPATH_PERSON_ORG_NO_RESULTS_STATUS = UcpathPersonOrgNoResultsStatusSchema.parse("ucpath.person-org.no-results-status");
export const UCPATH_PERSON_ORG_RESULTS_GRID = UcpathPersonOrgResultsGridSchema.parse("ucpath.person-org.results-grid");
export const UCPATH_PERSON_ORG_RESULT_DRILL_IN = UcpathPersonOrgResultDrillInSchema.parse("ucpath.person-org.result-drill-in");
export const UCPATH_PERSON_ORG_EID_DISPLAY = UcpathPersonOrgEidDisplaySchema.parse("ucpath.person-org.eid-display");
export const UCPATH_PERSON_ORG_NAME_DISPLAY = UcpathPersonOrgNameDisplaySchema.parse("ucpath.person-org.name-display");
export const UCPATH_PERSON_ORG_ASSIGNMENTS_GRID = UcpathPersonOrgAssignmentsGridSchema.parse("ucpath.person-org.assignments-grid");
export const UCPATH_PERSON_ORG_RETURN_TO_SEARCH = UcpathPersonOrgReturnToSearchSchema.parse("ucpath.person-org.return-to-search");
export const UCPATH_PERSON_ORG_DISPLAYED_EID = UcpathPersonOrgDisplayedEidSchema.parse("ucpath.person-org.displayed-eid");
export const UCPATH_PERSON_ORG_DISPLAYED_NAME = UcpathPersonOrgDisplayedNameSchema.parse("ucpath.person-org.displayed-name");

export type UcpathPersonOrgScreens =
  | typeof UCPATH_PERSON_ORG_SEARCH_SCREEN
  | typeof UCPATH_PERSON_ORG_DETAIL_SCREEN;
export type UcpathPersonOrgStates =
  | typeof UCPATH_PERSON_ORG_SEARCH_READY
  | typeof UCPATH_PERSON_ORG_RESULTS_READY
  | typeof UCPATH_PERSON_ORG_NO_RESULTS
  | typeof UCPATH_PERSON_ORG_DETAIL_READY;
export type UcpathPersonOrgFields = Readonly<{ [UCPATH_PERSON_ORG_EID_INPUT]: Eid }>;
export type UcpathPersonOrgObservations = Readonly<{
  [UCPATH_PERSON_ORG_DISPLAYED_EID]: Eid;
  [UCPATH_PERSON_ORG_DISPLAYED_NAME]: string;
}>;
export type UcpathPersonOrgDriver = SystemDriver<
  "ucpath",
  UcpathPersonOrgScreens,
  UcpathPersonOrgStates,
  UcpathPersonOrgFields,
  UcpathPersonOrgObservations
> & Readonly<{
  /**
   * The semantic Person Org operation used by the task store. Its implementation owns every
   * navigation, result-grid, drill-in, and selection detail; tasks never receive a Page or a
   * selector recipe (docs 01 §3 and 02 §3.1).
   */
  searchPersonOrg(
    input: z.output<typeof SearchPersonOrgInputSchema>,
  ): Promise<SearchPersonOrgOutput>;
}>;

export function parseUcpathPersonOrgEid(input: string): Eid {
  return EidSchema.parse(input);
}
