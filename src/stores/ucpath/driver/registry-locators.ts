import type { FrameLocator, Locator, Page } from "playwright";
import type { ElementId, PageStateId } from "../../../domain/ids.js";
import { PageStateProofSchema } from "../../../domain/ui/driver.js";
import type { PageStateProof } from "../../../domain/ui/driver.js";
import { UCPATH_UI_REGISTRY } from "./ui-registry.js";

export type UcpathElementDefinition = (typeof UCPATH_UI_REGISTRY.elements)[number];

export function ucpathElementById(id: ElementId): UcpathElementDefinition {
  const element = UCPATH_UI_REGISTRY.elements.find((candidate) => candidate.id === id);
  if (element === undefined) throw new Error(`UCPath UI registry has no element ${id}`);
  return element;
}

function frameRoot(page: Page): FrameLocator {
  return page.frameLocator(UCPATH_UI_REGISTRY.root.selector);
}

function roleLocator(
  page: Page,
  element: UcpathElementDefinition,
  recipe: Extract<UcpathElementDefinition["locator"], { readonly kind: "role" }>,
): Locator {
  const options = { name: recipe.name, exact: recipe.exact };
  return element.scope === "page"
    ? page.getByRole(recipe.role, options)
    : frameRoot(page).getByRole(recipe.role, options);
}

function cssLocator(page: Page, element: UcpathElementDefinition, selector: string): Locator {
  return element.scope === "page" ? page.locator(selector) : frameRoot(page).locator(selector);
}

export function resolveUcpathElement(page: Page, id: ElementId): Locator {
  const element = ucpathElementById(id);
  const recipe = element.locator;
  if (recipe.kind === "role") return roleLocator(page, element, recipe);
  if (recipe.kind === "css") return cssLocator(page, element, recipe.selector);
  if (recipe.kind === "view-toggle") {
    return cssLocator(page, element, recipe.headerSelector)
      .getByText(/^View (?:All|\d+)$/u, { exact: true });
  }
  if (recipe.kind === "css-fallback") {
    const [first, ...rest] = recipe.selectors;
    if (first === undefined) throw new Error(`${element.id} has an empty CSS fallback recipe`);
    return rest.reduce(
      (locator, selector) => locator.or(cssLocator(page, element, selector)),
      cssLocator(page, element, first),
    );
  }
  throw new Error(`${element.id} is indexed and requires an explicit zero-based row index`);
}

export function resolveUcpathIndexedElement(page: Page, id: ElementId, index: number): Locator {
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new Error(`${id} requires a non-negative safe row index, received ${String(index)}`);
  }
  const element = ucpathElementById(id);
  if (element.locator.kind !== "indexed-css") {
    throw new Error(`${id} is not an indexed UCPath element`);
  }
  return cssLocator(
    page,
    element,
    `${element.locator.selectorPrefix}${String(index)}${element.locator.selectorSuffix}`,
  );
}

function stateById(id: PageStateId) {
  const state = UCPATH_UI_REGISTRY.states.find((candidate) => candidate.id === id);
  if (state === undefined) throw new Error(`UCPath UI registry has no page state ${id}`);
  return state;
}

export async function waitForUcpathState(page: Page, stateId: PageStateId): Promise<PageStateProof> {
  const state = stateById(stateId);
  for (const evidence of state.evidence) {
    await resolveUcpathElement(page, evidence.element).waitFor({
      state: "visible",
      timeout: state.timeoutMs,
    });
  }
  return PageStateProofSchema.parse({ system: "ucpath", stateId, matched: true });
}

export async function waitForUcpathElementStates(
  page: Page,
  element: UcpathElementDefinition,
): Promise<void> {
  for (const stateId of element.requiredStates) await waitForUcpathState(page, stateId);
}
