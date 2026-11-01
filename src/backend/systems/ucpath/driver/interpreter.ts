import { searchPersonMatchOnPage } from "./person-match-operation.js";
import type { Page } from "playwright";
import { recordBrowserAction } from "../../browser-shared/action-notes.js";
import { assertMintedMutationCapability } from "../../../../workflow-kit/mutation-capability.js";
import { EidSchema } from "../../../../rules/identity/ids.js";
import { UiActionProofSchema } from "../../../../models/ui/driver.js";
import type { UiActionProof } from "../../../../models/ui/driver.js";
import {
  UCPATH_PERSON_ORG_DISPLAYED_EID,
  UCPATH_PERSON_ORG_DISPLAYED_NAME,
  UCPATH_PERSON_ORG_EID_DISPLAY,
  UCPATH_PERSON_ORG_EID_INPUT,
  UCPATH_PERSON_ORG_NAME_DISPLAY,
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
    assertCurrent: () => void,
    page: Page,
    input: z.output<typeof SearchPersonOrgInputSchema>,
  ) => Promise<SearchPersonOrgOutput>;
  readonly readJobSummary: (
    assertCurrent: () => void,
    page: Page,
    input: Readonly<{ emplId: Eid }>,
    observedAt: string,
  ) => Promise<UcpathJobSummaryRead>;
}

const ucpathPersonOrgOperations: UcpathPersonOrgOperations = Object.freeze({
  searchPersonOrg: searchPersonOrgOnPage,
  readJobSummary: readJobSummaryOnPage,
});


export function createUcpathPersonOrgDriver(
  assertCurrent: () => void,
  page: Page,
  clock: Clock = systemClock,
  operations: UcpathPersonOrgOperations = ucpathPersonOrgOperations,
  smartHr: UcpathSmartHrOperations = ucpathSmartHrOperations,
): UcpathStoreDriver {
  let sweepSubjectEmplId: Eid | undefined;
  return {
    system: "ucpath",
    searchPersonMatch: async (input) => {
      assertCurrent();
      const result = await searchPersonMatchOnPage(assertCurrent, page, input);
      assertCurrent();
      return result;
    },
    async scanTerminationTransactions(input) {
      assertCurrent();
      const result = await smartHr.scanTerminationTransactions(assertCurrent, page, input, nowIso(clock));
      assertCurrent();
      return result;
    },
    async stageTermination(input) {
      assertCurrent();
      const result = await smartHr.stageTermination(assertCurrent, page, input, nowIso(clock));
      assertCurrent();
      return result;
    },
    async stagePendingTerminationSweep(input) {

      sweepSubjectEmplId = input.emplId;
      assertCurrent();
      const result = await smartHr.stagePendingTerminationSweep(assertCurrent, page, input, nowIso(clock));
      assertCurrent();
      return result;
    },
    async commit(id, capability) {

      assertMintedMutationCapability(capability);
      assertCurrent();
      const result = await smartHr.commit(assertCurrent, page, id, capability);
      assertCurrent();
      return result;
    },
    async searchPersonOrg(input) {
      assertCurrent();
      const result = await operations.searchPersonOrg(assertCurrent, page, input);
      assertCurrent();
      return result;
    },
    async readJobSummary(input) {
      assertCurrent();
      const result = await operations.readJobSummary(
        assertCurrent,
        page,
        input,
        IsoInstantSchema.parse(clock.now().toISOString()),
      );
      assertCurrent();
      return result;
    },
    async goto(screen) {
      throw new Error(
        `UCPath standalone navigation for ${String(screen)} is unsupported; every screen in this `
        + "store is reached through a subject-bound semantic operation",
      );
    },
    async waitFor(stateId) {
      const result = await waitForUcpathState(assertCurrent, page, stateId);
      assertCurrent();
      return result;
    },
    async fill(id, value) {
      if (id !== UCPATH_PERSON_ORG_EID_INPUT) throw new Error(`UCPath Person Org cannot fill ${id}`);
      const eid = EidSchema.parse(value);
      const element = ucpathElementById(id);
      if (element.effect !== "prepare") throw new Error(`${id} is not a prepare-class field`);
      assertCurrent();
      await waitForUcpathElementStates(assertCurrent, page, element);
      assertCurrent();
      await resolveUcpathElement(page, id).fill(eid);
      assertCurrent();
      recordBrowserAction("typed", id, eid);
      assertCurrent();
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
        const result = await readInProgressSubjectOnPage(assertCurrent, page, sweepSubjectEmplId);
        assertCurrent();
        return result;
      }

      if (id === UCPATH_SMART_HR_DISPLAYED_PERSON_NAME) {
        const result = await readStagedWizardSubjectOnPage(assertCurrent, page);
        assertCurrent();
        return result;
      }
      if (id === UCPATH_SS_SMART_HR_DISPLAYED_NAME) {
        assertCurrent();
        const raw = await page.locator('[id="NAME$0"]').first().textContent();
        const name = (raw ?? "").trim();
        if (name.length === 0) {
          throw new Error(
            `${String(id)} rendered no text; a transaction detail page with no name is not a `
            + "subject this read may bind to",
          );
        }
        assertCurrent();
        return name;
      }
      const elementId = id === UCPATH_PERSON_ORG_DISPLAYED_EID
        ? UCPATH_PERSON_ORG_EID_DISPLAY
        : id === UCPATH_PERSON_ORG_DISPLAYED_NAME
          ? UCPATH_PERSON_ORG_NAME_DISPLAY
          : undefined;
      if (elementId === undefined) throw new Error(`UCPath Person Org cannot read ${id}`);
      const element = ucpathElementById(elementId);
      assertCurrent();
      await waitForUcpathElementStates(assertCurrent, page, element);
      assertCurrent();
      const text = await resolveUcpathElement(page, elementId).textContent();
      if (text === null) throw new Error(`${id} rendered without text`);
      const trimmed = text.trim();
      if (trimmed.length === 0) throw new Error(`${id} rendered empty text`);
      assertCurrent();
      return id === UCPATH_PERSON_ORG_DISPLAYED_EID ? EidSchema.parse(trimmed) : trimmed;
    },
    async click(id: never): Promise<UiActionProof> {
      throw new Error(`UCPath Person Org has no registered non-commit click ${String(id)}`);
    },
  };
}
