import type { Page } from "playwright";
import { recordBrowserAction } from "../../browser-shared/action-notes.js";
import { assertMintedMutationCapability } from "../../../../workflow-kit/mutation-capability.js";
import { EidSchema } from "../../../../rules/identity/ids.js";
import { UiActionProofSchema } from "../../../../models/ui/driver.js";
import type { PageStateProof, UiActionProof } from "../../../../models/ui/driver.js";
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
} from "../../../../models/ui/ucpath-person-org.js";
import type { UcpathStoreDriver } from "../../../../models/ui/ucpath-driver.js";
import {
  UCPATH_SMART_HR_DISPLAYED_PERSON_NAME,
  UCPATH_SMART_HR_IN_PROGRESS_NAME,
  UCPATH_SS_SMART_HR_DISPLAYED_NAME,
} from "../../../../models/ui/ucpath-smart-hr-termination.js";
import {
  nowIso,
  readInProgressSubjectOnPage,
  readStagedWizardSubjectOnPage,
  ucpathSmartHrOperations,
} from "./smart-hr-operation.js";
import type { UcpathSmartHrOperations } from "./smart-hr-operation.js";
import type {
  SearchPersonOrgInputSchema,
  SearchPersonOrgOutput,
} from "../../../../models/systems/ucpath/search-person-org.js";
import type { z } from "zod";
import { IsoInstantSchema } from "../../../../rules/identity/ids.js";
import type { Eid } from "../../../../rules/identity/ids.js";
import type { Clock } from "../../../../rules/time/clock.js";
import { systemClock } from "../../../../rules/time/clock.js";
import type { UcpathJobSummaryRead } from "../../../../models/ui/ucpath-job-summary.js";
import { readJobSummaryOnPage, searchPersonOrgOnPage } from "./person-org-operation.js";
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
  readonly readJobSummary: (
    page: Page,
    input: Readonly<{ emplId: Eid }>,
    observedAt: string,
  ) => Promise<UcpathJobSummaryRead>;
}

export const ucpathPersonOrgOperations: UcpathPersonOrgOperations = Object.freeze({
  searchPersonOrg: searchPersonOrgOnPage,
  readJobSummary: readJobSummaryOnPage,
});


export function createUcpathPersonOrgDriver(
  page: Page,
  clock: Clock = systemClock,
  operations: UcpathPersonOrgOperations = ucpathPersonOrgOperations,
  smartHr: UcpathSmartHrOperations = ucpathSmartHrOperations,
): UcpathStoreDriver {
  let sweepSubjectEmplId: Eid | undefined;
  return {
    system: "ucpath",
    async scanTerminationTransactions(input) {
      return smartHr.scanTerminationTransactions(page, input, nowIso(clock));
    },
    async stageTermination(input) {
      return smartHr.stageTermination(page, input, nowIso(clock));
    },
    async stagePendingTerminationSweep(input) {

      sweepSubjectEmplId = input.emplId;
      return smartHr.stagePendingTerminationSweep(page, input, nowIso(clock));
    },
    async commit(id, capability) {

      assertMintedMutationCapability(capability);
      return smartHr.commit(page, id, capability);
    },
    async searchPersonOrg(input) {
      return operations.searchPersonOrg(page, input);
    },
    async readJobSummary(input) {
      return operations.readJobSummary(
        page,
        input,
        IsoInstantSchema.parse(clock.now().toISOString()),
      );
    },
    async goto(screen) {
      throw new Error(
        `UCPath standalone navigation for ${String(screen)} is unsupported; every screen in this `
        + "store is reached through a subject-bound semantic operation",
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
      recordBrowserAction("typed", id, eid);
      return UiActionProofSchema.parse({ elementId: id, effect: "prepare", performed: true });
    },
    async read(id) {

      // Direct Smart HR anchors have no proven registry selector provenance.
      if (id === UCPATH_SMART_HR_IN_PROGRESS_NAME) {
        if (sweepSubjectEmplId === undefined) {
          throw new Error(
            `${String(id)} was read before any sweep staged a page; there is no in-progress grid `
            + "row to name a subject from",
          );
        }
        return readInProgressSubjectOnPage(page, sweepSubjectEmplId);
      }

      if (id === UCPATH_SMART_HR_DISPLAYED_PERSON_NAME) {
        return readStagedWizardSubjectOnPage(page);
      }
      if (id === UCPATH_SS_SMART_HR_DISPLAYED_NAME) {
        const raw = await page.locator('[id="NAME$0"]').first().textContent();
        const name = (raw ?? "").trim();
        if (name.length === 0) {
          throw new Error(
            `${String(id)} rendered no text; a transaction detail page with no name is not a `
            + "subject this read may bind to",
          );
        }
        return name;
      }
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
