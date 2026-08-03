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
export const UcpathPersonOrgDetailReadyStateSchema = z.literal("ucpath.person-org.detail-ready").brand<"PageStateId">();
export const UcpathPersonOrgEidInputSchema = z.literal("ucpath.person-org.eid-input").brand<"ElementId">();
export const UcpathPersonOrgEidDisplaySchema = z.literal("ucpath.person-org.eid-display").brand<"ElementId">();
export const UcpathPersonOrgDisplayedEidSchema = z.literal("ucpath.person-org.displayed-eid").brand<"ObservationId">();

export const UCPATH_PERSON_ORG_SEARCH_SCREEN = UcpathPersonOrgSearchScreenSchema.parse("ucpath.person-org.search");
export const UCPATH_PERSON_ORG_DETAIL_SCREEN = UcpathPersonOrgDetailScreenSchema.parse("ucpath.person-org.detail");
export const UCPATH_PERSON_ORG_SEARCH_READY = UcpathPersonOrgSearchReadyStateSchema.parse("ucpath.person-org.search-ready");
export const UCPATH_PERSON_ORG_DETAIL_READY = UcpathPersonOrgDetailReadyStateSchema.parse("ucpath.person-org.detail-ready");
export const UCPATH_PERSON_ORG_EID_INPUT = UcpathPersonOrgEidInputSchema.parse("ucpath.person-org.eid-input");
export const UCPATH_PERSON_ORG_EID_DISPLAY = UcpathPersonOrgEidDisplaySchema.parse("ucpath.person-org.eid-display");
export const UCPATH_PERSON_ORG_DISPLAYED_EID = UcpathPersonOrgDisplayedEidSchema.parse("ucpath.person-org.displayed-eid");

export type UcpathPersonOrgScreens =
  | typeof UCPATH_PERSON_ORG_SEARCH_SCREEN
  | typeof UCPATH_PERSON_ORG_DETAIL_SCREEN;
export type UcpathPersonOrgStates =
  | typeof UCPATH_PERSON_ORG_SEARCH_READY
  | typeof UCPATH_PERSON_ORG_DETAIL_READY;
export type UcpathPersonOrgFields = Readonly<{ [UCPATH_PERSON_ORG_EID_INPUT]: Eid }>;
export type UcpathPersonOrgObservations = Readonly<{ [UCPATH_PERSON_ORG_DISPLAYED_EID]: Eid }>;
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
