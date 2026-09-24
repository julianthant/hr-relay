import type { Page } from "playwright";
import { recordBrowserAction } from "../../../infra/browser/action-notes.js";
import { assertMintedMutationCapability } from "../../../base/mutation-capability.js";
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
import type { UcpathStoreDriver } from "../../../domain/ui/ucpath-driver.js";
import {
  UCPATH_SMART_HR_DISPLAYED_PERSON_NAME,
  UCPATH_SMART_HR_IN_PROGRESS_NAME,
  UCPATH_SS_SMART_HR_DISPLAYED_NAME,
} from "../../../domain/ui/ucpath-smart-hr-termination.js";
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
} from "../../../domain/contracts/ucpath/search-person-org.js";
import type { z } from "zod";
import { IsoInstantSchema } from "../../../domain/ids.js";
import type { Eid } from "../../../domain/ids.js";
import type { Clock } from "../../../domain/clock.js";
import { systemClock } from "../../../domain/clock.js";
import type { UcpathJobSummaryRead } from "../../../domain/ui/ucpath-job-summary.js";
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

/**
 * The store's ONE driver, joining both screen families (D197 rule 1, D206).
 *
 * The name is kept for its callers; what it returns is the whole
 * `UcpathStoreDriver`, because `defineTask(ucpathDriver, …)` binds a single
 * invariant declaration and a second one is what `task-driver-boundary`
 * refuses.
 */
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
      // The sweep's beat-③ subject lives on the page this call stages, and the
      // kernel reads it afterwards through `read()` with no arguments — so the
      // EID it must be read beside is retained here. The driver instance is
      // bound to one page and one run, which is what makes that honest.
      sweepSubjectEmplId = input.emplId;
      return smartHr.stagePendingTerminationSweep(page, input, nowIso(clock));
    },
    async commit(id, capability) {
      // Defence in depth, and deliberately not delegated: the token is checked
      // HERE as well as inside the operation, so an operations seam swapped for
      // a test double still cannot click without a sequencer-minted capability.
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
      recordBrowserAction("typed", id);
      return UiActionProofSchema.parse({ elementId: id, effect: "prepare", performed: true });
    },
    async read(id) {
      // The two Smart HR observations are read straight off their live anchors
      // rather than through the registry: neither is a PUBLISHED element,
      // because legacy has no selector key for either and a registry row with
      // no ported provenance is a fabricated one (D196's rule, D206 §4).
      if (id === UCPATH_SMART_HR_IN_PROGRESS_NAME) {
        if (sweepSubjectEmplId === undefined) {
          throw new Error(
            `${String(id)} was read before any sweep staged a page; there is no in-progress grid `
            + "row to name a subject from",
          );
        }
        return readInProgressSubjectOnPage(page, sweepSubjectEmplId);
      }
      // Beat ③ observes the page PREPARE LEFT BEHIND, which for the wizard is
      // Page C — so this reads Page C's label-anchored identity block, not
      // Page B's `#PERSON_NAME_NAME_DISPLAY`. Naming the Page-B anchor here is
      // what the first live dry run refused on.
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
