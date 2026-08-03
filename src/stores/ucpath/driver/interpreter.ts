import type { Page } from "playwright";
import { EidSchema } from "../../../domain/ids.js";
import { UiActionProofSchema } from "../../../domain/ui/driver.js";
import type { PageStateProof, UiActionProof } from "../../../domain/ui/driver.js";
import {
  UCPATH_PERSON_ORG_DETAIL_READY,
  UCPATH_PERSON_ORG_DETAIL_SCREEN,
  UCPATH_PERSON_ORG_DISPLAYED_EID,
  UCPATH_PERSON_ORG_DISPLAYED_NAME,
  UCPATH_PERSON_ORG_ASSIGNMENTS_GRID,
  UCPATH_PERSON_ORG_EID_DISPLAY,
  UCPATH_PERSON_ORG_EID_INPUT,
  UCPATH_PERSON_ORG_NAME_DISPLAY,
  UCPATH_PERSON_ORG_NO_RESULTS,
  UCPATH_PERSON_ORG_RESULTS_READY,
  UCPATH_PERSON_ORG_SEARCH_READY,
  UCPATH_PERSON_ORG_SEARCH_SCREEN,
} from "../../../domain/ui/ucpath-person-org.js";
import type { UcpathPersonOrgDriver } from "../../../domain/ui/ucpath-person-org.js";
import type {
  SearchPersonOrgInputSchema,
  SearchPersonOrgOutput,
} from "../../../domain/contracts/ucpath/search-person-org.js";
import type { z } from "zod";
import { searchPersonOrgOnPage } from "./person-org-operation.js";
import {
  resolveUcpathElement,
  ucpathElementById,
  waitForUcpathElementStates,
  waitForUcpathState,
} from "./registry-locators.js";

export interface UcpathPersonOrgOperations {
  readonly searchPersonOrg: (
    page: Page,
    input: z.output<typeof SearchPersonOrgInputSchema>,
  ) => Promise<SearchPersonOrgOutput>;
}

export const ucpathPersonOrgOperations: UcpathPersonOrgOperations = Object.freeze({
  searchPersonOrg: searchPersonOrgOnPage,
});

export function createUcpathPersonOrgDriver(
  page: Page,
  operations: UcpathPersonOrgOperations = ucpathPersonOrgOperations,
): UcpathPersonOrgDriver {
  return {
    system: "ucpath",
    async searchPersonOrg(input) {
      return operations.searchPersonOrg(page, input);
    },
    async goto(screen) {
      if (screen !== UCPATH_PERSON_ORG_SEARCH_SCREEN && screen !== UCPATH_PERSON_ORG_DETAIL_SCREEN) {
        throw new Error(`UCPath Person Org navigation received an unknown screen ${screen}`);
      }
      throw new Error(
        `UCPath Person Org standalone navigation for ${screen} is unsupported; use the subject-bound searchPersonOrg operation`,
      );
    },
    async waitFor(stateId) {
      return waitForUcpathState(page, stateId);
    },
    async fill(id, value) {
      if (id !== UCPATH_PERSON_ORG_EID_INPUT) throw new Error(`UCPath Person Org cannot fill ${id}`);
      const eid = EidSchema.parse(value);
      const element = ucpathElementById(id);
      if (element.effect !== "prepare") throw new Error(`${id} is not a prepare-class field`);
      await waitForUcpathElementStates(page, element);
      await resolveUcpathElement(page, id).fill(eid);
      return UiActionProofSchema.parse({ elementId: id, effect: "prepare", performed: true });
    },
    async read(id) {
      const elementId = id === UCPATH_PERSON_ORG_DISPLAYED_EID
        ? UCPATH_PERSON_ORG_EID_DISPLAY
        : id === UCPATH_PERSON_ORG_DISPLAYED_NAME
          ? UCPATH_PERSON_ORG_NAME_DISPLAY
          : undefined;
      if (elementId === undefined) throw new Error(`UCPath Person Org cannot read ${id}`);
      const element = ucpathElementById(elementId);
      await waitForUcpathElementStates(page, element);
      const text = await resolveUcpathElement(page, elementId).textContent();
      if (text === null) throw new Error(`${id} rendered without text`);
      const trimmed = text.trim();
      if (trimmed.length === 0) throw new Error(`${id} rendered empty text`);
      return id === UCPATH_PERSON_ORG_DISPLAYED_EID ? EidSchema.parse(trimmed) : trimmed;
    },
    async click(id: never): Promise<UiActionProof> {
      throw new Error(`UCPath Person Org has no registered non-commit click ${String(id)}`);
    },
  };
}

export const UCPATH_PERSON_ORG_DRIVER_VOCABULARY = {
  screens: [UCPATH_PERSON_ORG_SEARCH_SCREEN, UCPATH_PERSON_ORG_DETAIL_SCREEN],
  states: [
    UCPATH_PERSON_ORG_SEARCH_READY,
    UCPATH_PERSON_ORG_RESULTS_READY,
    UCPATH_PERSON_ORG_NO_RESULTS,
    UCPATH_PERSON_ORG_DETAIL_READY,
  ],
  fields: [UCPATH_PERSON_ORG_EID_INPUT],
  displays: [
    UCPATH_PERSON_ORG_EID_DISPLAY,
    UCPATH_PERSON_ORG_NAME_DISPLAY,
    UCPATH_PERSON_ORG_ASSIGNMENTS_GRID,
  ],
  observations: [UCPATH_PERSON_ORG_DISPLAYED_EID, UCPATH_PERSON_ORG_DISPLAYED_NAME],
} as const;

export type { PageStateProof, UiActionProof };
