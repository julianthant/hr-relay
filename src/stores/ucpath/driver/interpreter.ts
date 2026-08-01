import type { FrameLocator, Locator, Page } from "playwright";
import { EidSchema } from "../../../domain/ids.js";
import type { ElementId, PageStateId } from "../../../domain/ids.js";
import { PageStateProofSchema, UiActionProofSchema } from "../../../domain/ui/driver.js";
import type { MutationCapability, PageStateProof, UiActionProof } from "../../../domain/ui/driver.js";
import {
  UCPATH_PERSON_ORG_DETAIL_READY,
  UCPATH_PERSON_ORG_DETAIL_SCREEN,
  UCPATH_PERSON_ORG_DISPLAYED_EID,
  UCPATH_PERSON_ORG_EID_DISPLAY,
  UCPATH_PERSON_ORG_EID_INPUT,
  UCPATH_PERSON_ORG_SEARCH_READY,
  UCPATH_PERSON_ORG_SEARCH_SCREEN,
} from "../../../domain/ui/ucpath-person-org.js";
import type { UcpathPersonOrgDriver } from "../../../domain/ui/ucpath-person-org.js";
import { UCPATH_UI_REGISTRY } from "./ui-registry.js";

type ElementDefinition = (typeof UCPATH_UI_REGISTRY.elements)[number];

function elementById(id: ElementId): ElementDefinition {
  const element = UCPATH_UI_REGISTRY.elements.find((candidate) => candidate.id === id);
  if (!element) throw new Error(`UCPath UI registry has no element ${id}`);
  return element;
}

function frameRoot(page: Page): FrameLocator {
  return page.frameLocator(UCPATH_UI_REGISTRY.root.selector);
}

function resolveLocator(page: Page, element: ElementDefinition): Locator {
  const root = frameRoot(page);
  if (element.locator.kind === "role") {
    return root.getByRole(element.locator.role, {
      name: element.locator.name,
      exact: element.locator.exact,
    });
  }
  return root.locator(element.locator.selector);
}

function stateById(id: PageStateId) {
  const state = UCPATH_UI_REGISTRY.states.find((candidate) => candidate.id === id);
  if (!state) throw new Error(`UCPath UI registry has no page state ${id}`);
  return state;
}

export function createUcpathPersonOrgDriver(page: Page): UcpathPersonOrgDriver {
  return {
    system: "ucpath",
    async goto(screen) {
      if (screen !== UCPATH_PERSON_ORG_SEARCH_SCREEN && screen !== UCPATH_PERSON_ORG_DETAIL_SCREEN) {
        throw new Error(`UCPath Person Org navigation received an unknown screen ${screen}`);
      }
      throw new Error(`UCPath Person Org navigation for ${screen} is not yet wired; session-owned navigation lands in Phase 1f`);
    },
    async waitFor(stateId) {
      const state = stateById(stateId);
      for (const evidence of state.evidence) {
        await resolveLocator(page, elementById(evidence.element)).waitFor({
          state: "visible",
          timeout: state.timeoutMs,
        });
      }
      return PageStateProofSchema.parse({ system: "ucpath", stateId, matched: true });
    },
    async fill(id, value) {
      if (id !== UCPATH_PERSON_ORG_EID_INPUT) throw new Error(`UCPath Person Org cannot fill ${id}`);
      const eid = EidSchema.parse(value);
      const element = elementById(id);
      if (element.effect !== "prepare") throw new Error(`${id} is not a prepare-class field`);
      await resolveLocator(page, element).fill(eid);
      return UiActionProofSchema.parse({ elementId: id, effect: "prepare", performed: true });
    },
    async read(id) {
      if (id !== UCPATH_PERSON_ORG_DISPLAYED_EID) throw new Error(`UCPath Person Org cannot read ${id}`);
      const observation = UCPATH_UI_REGISTRY.observations.find((candidate) => candidate.id === id);
      if (!observation) throw new Error(`UCPath UI registry has no observation ${id}`);
      const text = await resolveLocator(page, elementById(observation.read.element)).textContent();
      if (text === null) throw new Error(`${id} rendered without text`);
      return EidSchema.parse(text.trim());
    },
    async click(id: never): Promise<UiActionProof> {
      throw new Error(`UCPath Person Org has no registered non-commit click ${String(id)}`);
    },
    async commit(id: never, _capability: MutationCapability): Promise<UiActionProof> {
      throw new Error(`UCPath Person Org has no registered external-commit element ${String(id)}`);
    },
  };
}

export const UCPATH_PERSON_ORG_DRIVER_VOCABULARY = {
  screens: [UCPATH_PERSON_ORG_SEARCH_SCREEN, UCPATH_PERSON_ORG_DETAIL_SCREEN],
  states: [UCPATH_PERSON_ORG_SEARCH_READY, UCPATH_PERSON_ORG_DETAIL_READY],
  fields: [UCPATH_PERSON_ORG_EID_INPUT],
  displays: [UCPATH_PERSON_ORG_EID_DISPLAY],
  observations: [UCPATH_PERSON_ORG_DISPLAYED_EID],
} as const;

export type { PageStateProof, UiActionProof };
