import type { FrameLocator, Locator, Page } from "playwright";
import type { ElementId, PageStateId } from "../../../../rules/identity/ids.js";
import { PageStateProofSchema } from "../../../../models/ui/driver.js";
import type { PageStateProof } from "../../../../models/ui/driver.js";
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

/**
 * The positive precondition for clicking a nav-collection step.
 *
 * A PeopleSoft nav-collection page renders its shell first and loads the
 * registry root's content frame afterwards; a step control's handler routes
 * THROUGH that frame. Clicking while the frame still holds `about:blank` is
 * silently dropped — PeopleSoft neither errors nor navigates — so the step
 * click waits for the frame to hold a real, loaded document instead of for a
 * duration. Verified live 2026-08-04Z (EID 10873698): without this wait the
 * Person Organizational Summary step click is lost and the search form never
 * appears (30s timeout); with it the form is ready ~0.4s after the click.
 *
 * It is a WAIT target only, never a proof of what the frame contains — the
 * caller still waits for its own declared page state.
 */
export async function waitForUcpathContentFrameDocument(page: Page, timeoutMs: number): Promise<void> {
  const selector = UCPATH_UI_REGISTRY.root.selector;
  try {
    // `body > *` is document structure, not app knowledge: an unnavigated
    // frame holds `about:blank`, whose body has no children, so the first
    // rendered child IS the proof that the frame stopped being empty. The
    // wait is Playwright's, so it survives the shell's own navigations.
    await frameRoot(page).locator("body > *").first().waitFor({ state: "attached", timeout: timeoutMs });
  } catch (error) {
    throw new Error(
      `UCPath content frame ${selector} never rendered a document within ${String(timeoutMs)}ms; `
      + "a nav-collection step cannot be clicked against an empty frame",
      { cause: error },
    );
  }
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
