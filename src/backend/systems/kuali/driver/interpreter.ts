
import type { ElementHandle, Locator, Page, Response } from "playwright";
import { recordBrowserAction } from "../../browser-shared/action-notes.js";
import { z } from "zod";
import type { Clock } from "../../../../rules/time/clock.js";
import { EidSchema, IsoInstantSchema } from "../../../../rules/identity/ids.js";
import type { ElementId, ObservationId } from "../../../../rules/identity/ids.js";
import { assertMintedMutationCapability } from "../../../../workflow-kit/mutation-capability.js";
import {
  KUALI_ACTION_LIST_DOCUMENT_LINK,
  KUALI_ACTION_LIST_MATCHED_NUMBER,
  KUALI_ACTION_LIST_READY,
  KUALI_ACTION_LIST_SEARCH_GO_BUTTON,
  KUALI_ACTION_LIST_SEARCH_INPUT,
  KualiActionListObservationSchema,
} from "../../../../models/ui/kuali-action-list.js";
import type { KualiActionListObservation } from "../../../../models/ui/kuali-action-list.js";
import type { MutationCapability, UiActionProof } from "../../../../models/ui/driver.js";
import { UiActionProofSchema } from "../../../../models/ui/driver.js";
import {
  KUALI_RRSS_DISPLAYED_EID,
  KUALI_RRSS_EID_FIELD,
  KUALI_RRSS_SAVE_BUTTON,
  KUALI_RRSS_TIMEKEEPER_FIELD,
  KualiActionIdSchema,
  KualiDocumentNumberSchema,
  KualiRrssDocumentDriverSchema,
} from "../../../../models/ui/kuali-rrss-document.js";
import type {
  KualiRrssDocumentDriver,
} from "../../../../models/ui/kuali-rrss-document.js";
import {
  KUALI_BLANK_OPTION_TEXT,
  KUALI_RRSS_DEPARTMENT_FIELD,
  KUALI_RRSS_EMPLOYEE_NAME_FIELD,
  KUALI_RRSS_FINAL_PAY_STUDENT_RADIO,
  KUALI_RRSS_LAST_DAY_WORKED_FIELD,
  KUALI_RRSS_LOCATION_FIELD,
  KUALI_RRSS_PAYROLL_TITLE_CODE_FIELD,
  KUALI_RRSS_PAYROLL_TITLE_FIELD,
  KUALI_RRSS_REQUEST_ACKNOWLEDGED_CHECKBOX,
  KUALI_RRSS_SEPARATION_DATE_FIELD,
  KUALI_RRSS_SEPARATION_READY,
  KUALI_RRSS_SUBMITTED_TEMPLATE_CHECKBOX,
  KUALI_RRSS_TERMINATION_EFF_DATE_FIELD,
  KUALI_RRSS_TERMINATION_TYPE_FIELD,
  KUALI_RRSS_TIMEKEEPER_COMMENTS_FIELD,
  KUALI_RRSS_TRANSACTION_NUMBER_FIELD,
  KUALI_SEPARATION_FORM_TYPE,
  KualiSeparationDocumentReadSchema,
  KualiSeparationDocumentSchema,
  KualiTransactionNumberSchema,
  parseKualiFormDate,
} from "../../../../models/ui/kuali-separation-document.js";
import type {
  KualiDateField,
  KualiFinalPayChoice,
  KualiOptionField,
  KualiSeparationDocumentRead,
  KualiTextField,
  KualiTransactionNumberField,
} from "../../../../models/ui/kuali-separation-document.js";
import {
  KUALI_FINALIZATION_FIELD_NAMES,
  KUALI_RRSS_FINALIZATION_FORM_KEYS,
  KUALI_RRSS_FINALIZATION_WIRE_ASSERTED,
  KUALI_RRSS_FINALIZATION_STAGED,
  KualiCommentsChangedError,
  KualiDepartmentOptionNotOfferedError,
  KualiFinalizationReadBackSchema,
  KualiFinalizationStageNotPersistedError,
  KualiFinalizationStagingSchema,
  KualiFinalizationTargetSchema,
  KualiObservedFinalizationFieldsSchema,
  KualiSaveRefusedError,
  KualiSavedFinalizationProofSchema,
  compareKualiFinalizationFields,
  kualiFinalizationFields,
} from "../../../../models/ui/kuali-separation-finalization.js";
import type {
  KualiFinalizationFields,
  KualiFinalizationReadBack,
  KualiFinalizationStaging,
  KualiFinalizationTarget,
  KualiObservedFinalizationFields,
} from "../../../../models/ui/kuali-separation-finalization.js";
import { KUALI_RRSS_SPACE_ID, KUALI_UI_REGISTRY } from "./ui-registry.js";
import type { KualiLocatorRecipe } from "./ui-registry.js";

const KUALI_HOST = "ucsd.kualibuild.com";
const NAVIGATION_TIMEOUT_MS = 60_000;
const STATE_TIMEOUT_MS = 30_000;
const FIELD_TIMEOUT_MS = 10_000;

// Save issues submitDocumentV2; status saved requests persistence without advancing the workflow.
const KUALI_GRAPHQL_PATH = "/app/api/v0/graphql";
const KUALI_SUBMIT_OPERATION = "submitDocumentV2";


const MODEL_COMMIT_TIMEOUT_MS = 20_000;
const SUBMIT_OBSERVE_TIMEOUT_MS = 30_000;

/** The private marker the model-commit barrier stamps on the staged control. */
const STAGED_PROPS_MARKER = "__hrautoStagedProps";


const INTERNAL_DIVISION_FIELD = "Division*";
const INTERNAL_EMPLOYEE_TYPE_FIELD = "Employee Type*";
const INTERNAL_STUDENT_TITLE_CODE_FIELD = "Student Title Code*";
const INTERNAL_ADDITIONAL_COMMENTS_FIELD = "Additional Separation Comments (Optional)";
const INTERNAL_FINAL_PAY_SUBMITTED = "Submitted Final Pay Request";
const INTERNAL_FINAL_PAY_TRANSFER = "Does not need Final Pay (transfer employee)";
const INTERNAL_FINAL_PAY_OTHER = "Other";

// Read each Final Pay radio; the group has no separate enumerable option list.
const FINAL_PAY_OPTION_LABELS: readonly string[] = Object.freeze([
  INTERNAL_FINAL_PAY_SUBMITTED,
  "Does not need Final Pay (student employee)",
  INTERNAL_FINAL_PAY_TRANSFER,
  INTERNAL_FINAL_PAY_OTHER,
]);

function elementLocator(id: ElementId): KualiLocatorRecipe {
  const element = KUALI_UI_REGISTRY.elements.find((candidate) => candidate.id === id);
  if (element === undefined) throw new Error(`Kuali UI registry has no element ${id}`);
  return element.locator;
}


function elementRecipe(id: ElementId): Extract<KualiLocatorRecipe, { kind: "role-exact-name" }> {
  const locator = elementLocator(id);
  if (locator.kind !== "role-exact-name") {
    throw new Error(`Kuali element ${id} is not addressed by an exact accessible name (${locator.kind})`);
  }
  return locator;
}


async function exactlyOne(assertCurrent: () => void, page: Page, id: ElementId): Promise<Locator> {
  const recipe = elementRecipe(id);
  const locator = page.getByRole(recipe.role, { name: recipe.name, exact: recipe.exact });
  try {
    assertCurrent();
    await locator.first().waitFor({ state: "visible", timeout: FIELD_TIMEOUT_MS });
  } catch (error) {
    assertCurrent();
    // Not a swallow: an element that never renders is a page we cannot act on,
    // and the count check below would report "0" without saying why.
    throw new Error(
      `Kuali ${id} never became visible for role="${recipe.role}" name="${recipe.name}" within `
      + `${String(FIELD_TIMEOUT_MS)}ms; refusing to act on a page that does not show it`,
      { cause: error },
    );
  }
  assertCurrent();
  const count = await locator.count();
  if (count !== 1) {
    throw new Error(
      `Kuali ${id} resolved ${String(count)} nodes for role="${recipe.role}" name="${recipe.name}"; `
      + "exactly one is required and there is no fallback — refusing to act on an ambiguous page",
    );
  }
  assertCurrent();
  return locator;
}

function documentUrl(actionId: string): string {
  return `https://${KUALI_HOST}/build/space/${KUALI_RRSS_SPACE_ID}/actions/${actionId}`;
}


function actionListUrl(): string {
  return `https://${KUALI_HOST}/build/space/${KUALI_RRSS_SPACE_ID}/actions`;
}

// Kuali searches document numbers by substring; anchor the exact link name to avoid neighboring documents.
function documentLinks(page: Page, documentNumber: string): Locator {
  const recipe = elementLocator(KUALI_ACTION_LIST_DOCUMENT_LINK);
  if (recipe.kind !== "role-anchored-value-name") {
    throw new Error(
      `Kuali element ${KUALI_ACTION_LIST_DOCUMENT_LINK} is not an anchored-value recipe (${recipe.kind})`,
    );
  }

  const number = KualiDocumentNumberSchema.parse(documentNumber);
  return page.getByRole(recipe.role, { name: new RegExp(`^\\s*${number}\\s*$`, "u") });
}

// Kuali redirects document routes to view; stale action IDs silently return to the Action List.
function assertExactKualiDocumentUrl(rawUrl: string, actionId: string): void {
  const url = new URL(rawUrl);
  const expected = `/build/space/${KUALI_RRSS_SPACE_ID}/actions/${actionId}`;
  if (url.protocol !== "https:" || url.hostname !== KUALI_HOST
    || (url.pathname !== expected && url.pathname !== `${expected}/view`)) {
    throw new Error(
      `Kuali navigation expected ${documentUrl(actionId)} but landed on ${url.origin}${url.pathname}`,
    );
  }
}

// Kuali paints headings in stages; wait for a nonempty bare document number, not the first heading.
const DOCUMENT_NUMBER_HEADING_NAME = /^\s*\d{3,8}\s*$/u;


const BARE_DOCUMENT_NUMBER_NAME = /^\s*\d+\s*$/u;


const ACTION_LIST_FILTER_TIMEOUT_MS = 15_000;

type DocumentNumberProbe =
  | { readonly state: "read"; readonly documentNumber: string }
  | { readonly state: "unavailable"; readonly reason: string };


async function probeDocumentNumberHeading(assertCurrent: () => void, page: Page, actionId: string): Promise<DocumentNumberProbe> {
  const heading = page.getByRole("heading", { level: 1, name: DOCUMENT_NUMBER_HEADING_NAME });
  // A BOUNDED WAIT FOR THE SAME FACT, not a fallback: when no document-number
  // heading renders inside the bound, the identical refusal below still fires.
  try {
    assertCurrent();
    await heading.first().waitFor({ state: "attached", timeout: STATE_TIMEOUT_MS });
  } catch {
    assertCurrent();
    // Not a swallow: the timeout IS the observation, and the count check turns
    // it into the loud refusal an immediately-absent heading produced.
  }
  assertCurrent();
  const count = await heading.count();
  if (count === 0) {
    assertCurrent();
    return {
      state: "unavailable",
      reason: `Kuali action ${actionId} did not render a document-number heading within `
        + `${String(STATE_TIMEOUT_MS)}ms; the action id may be stale (a completed step redirects to the `
        + "Action List) — refusing to treat this page as a document",
    };
  }
  if (count !== 1) {
    assertCurrent();
    return {
      state: "unavailable",
      reason: `Kuali action ${actionId} rendered ${String(count)} document-number headings; exactly one is `
        + "required and there is no fallback — refusing to identify an ambiguous page",
    };
  }
  assertCurrent();
  const raw = await heading.textContent({ timeout: STATE_TIMEOUT_MS });
  const trimmed = (raw ?? "").trim();
  const parsed = KualiDocumentNumberSchema.safeParse(trimmed);
  if (!parsed.success) {
    assertCurrent();
    return {
      state: "unavailable",
      reason: `Kuali action ${actionId} heading "${trimmed}" is not a document number`,
    };
  }
  assertCurrent();
  return { state: "read", documentNumber: parsed.data };
}

async function readDocumentNumberHeading(assertCurrent: () => void, page: Page, actionId: string): Promise<string> {
  assertCurrent();
  const probe = await probeDocumentNumberHeading(assertCurrent, page, actionId);
  if (probe.state === "unavailable") throw new Error(probe.reason);
  assertCurrent();
  return probe.documentNumber;
}

// Check only the staging-owned keys in submitDocumentV2 data; do not reinterpret the rest of the document.
const SubmitVariablesSchema = z.object({
  actionId: z.string().min(1),
  documentId: z.string().min(1),
  data: z.record(z.string(), z.unknown()),
});

// A successful mutation body is not landing proof; name only fields that can show explicit refusal.
const SubmitResponseSchema = z.object({
  errors: z.array(z.object({ message: z.string() }).loose()).optional(),
  data: z.object({
    submitDocumentV2: z.object({
      status: z.string(),
      validations: z.unknown(),
    }).loose().nullish(),
  }).loose().nullish(),
});


type StagedExpectation = Readonly<{
  kind: "finalization";
  actionId: string;
  documentNumber: string;
  fields: KualiFinalizationFields;
}>;

/** Every Kuali input read trims; a padded value is the norm, not an anomaly. */
async function readTrimmedInput(assertCurrent: () => void, page: Page, id: ElementId): Promise<string> {
  assertCurrent();
  const locator = await exactlyOne(assertCurrent, page, id);
  assertCurrent();
  const raw = await locator.inputValue({ timeout: FIELD_TIMEOUT_MS });
  assertCurrent();
  return raw.trim();
}

async function readDisplayedEid(assertCurrent: () => void, page: Page): Promise<string> {
  assertCurrent();
  const value = await readTrimmedInput(assertCurrent, page, KUALI_RRSS_EID_FIELD);
  const parsed = EidSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `Kuali document displays "${value.slice(0, 4)}…" in the EID field, which is not a UCPath EID; `
      + "refusing to bind a subject to an unreadable identifier",
    );
  }
  assertCurrent();
  return parsed.data;
}

// Kuali text gadgets debounce into controlled React state; a DOM value alone is not model-commit proof.
// Stamp React props before the interaction so a model update cannot be missed.
async function stampModelProps(
  assertCurrent: () => void,
  handle: ElementHandle<SVGElement | HTMLElement>,
  documentNumber: string,
  what: string,
): Promise<void> {
  assertCurrent();
  const stamped = await handle.evaluate((node, marker) => {
    const element = node as unknown as Record<string, unknown>;
    const propsKey = Object.keys(element).find((key) => key.startsWith("__reactProps"));
    if (propsKey === undefined) return false;
    element[marker] = element[propsKey];
    return true;
  }, STAGED_PROPS_MARKER);
  if (!stamped) {
    throw new Error(
      `Kuali document ${documentNumber} exposes no React props on the ${what} control, so the point at `
      + "which it commits the typed value into the document model cannot be observed; refusing to reach "
      + "the fence on an unprovable staging",
    );
  }
  assertCurrent();
}

/** Half two: wait for the parent re-render that the model update causes. */
async function awaitModelPropsReplaced(
  assertCurrent: () => void,
  page: Page,
  handle: ElementHandle<SVGElement | HTMLElement>,
  documentNumber: string,
  what: string,
): Promise<void> {
  try {
    assertCurrent();
    await page.waitForFunction((bound: { node: SVGElement | HTMLElement; marker: string }) => {
      const element = bound.node as unknown as Record<string, unknown>;
      const propsKey = Object.keys(element).find((key) => key.startsWith("__reactProps"));
      if (propsKey === undefined) return false;
      const previous = element[bound.marker];
      return previous !== undefined && element[propsKey] !== previous;
    }, { node: handle, marker: STAGED_PROPS_MARKER }, { timeout: MODEL_COMMIT_TIMEOUT_MS, polling: 50 });
  } catch (error) {
    assertCurrent();
    // Not a swallow: the timeout IS the observation that the model never took
    // the value, and continuing would click Save on a payload without it.
    throw new Error(
      `Kuali document ${documentNumber} did not commit the staged ${what} value into its document model `
      + `within ${String(MODEL_COMMIT_TIMEOUT_MS)}ms (measured commit point: ~723ms after the last `
      + "keystroke); refusing to reach the fence",
      { cause: error },
    );
  }
  assertCurrent();
}

// Verify staged values under the exact form keys in the Save payload for this action ID.
function assertSubmitCarriedValue(
  request: Readonly<{ postData: () => string | null }>,
  expected: StagedExpectation,
): void {
  const raw = request.postData();
  if (raw === null) {
    throw new Error(
      `Kuali document ${expected.documentNumber} issued a ${KUALI_SUBMIT_OPERATION} with no request body; `
      + "the save cannot be proved to carry the staged values",
    );
  }
  const parsed: unknown = JSON.parse(raw);
  const variables = SubmitVariablesSchema.safeParse(
    (parsed as { variables?: unknown } | null)?.variables,
  );
  if (!variables.success) {
    throw new Error(
      `Kuali document ${expected.documentNumber} issued a ${KUALI_SUBMIT_OPERATION} whose variables do `
      + `not match the known save shape: ${variables.error.message}`,
    );
  }
  if (variables.data.actionId !== expected.actionId) {
    throw new Error(
      `Kuali save targeted action ${variables.data.actionId} but the staged document ${expected.documentNumber} `
      + `is action ${expected.actionId}; refusing to treat it as this write`,
    );
  }
  for (const [formKey, value] of stagedWireValues(expected)) {
    const sent = variables.data.data[formKey];
    if (sent === value) continue;
    throw new Error(
      `Kuali save on document ${expected.documentNumber} did NOT carry a staged value: `
      + `${KUALI_SUBMIT_OPERATION} sent ${JSON.stringify(sent ?? null)} at formKey ${formKey} instead of `
      + `${JSON.stringify(value)}. Kuali accepts and reports success for such a save while persisting `
      + "nothing of that field, so this is reported as a failed write, not a completed one",
    );
  }
}

// Non-text Kuali model values have different wire shapes; assert only derivable payload values and reload-compare all twelve fields.
function stagedWireValues(expected: StagedExpectation): readonly (readonly [string, unknown])[] {
  const pairs: (readonly [string, unknown])[] = [];
  for (const field of KUALI_FINALIZATION_FIELD_NAMES) {
    if (!KUALI_RRSS_FINALIZATION_WIRE_ASSERTED.includes(field)) continue;
    const formKey = KUALI_RRSS_FINALIZATION_FORM_KEYS[field];

    if (formKey === null) {
      throw new Error(
        `Kuali finalization field ${field} is asserted on the wire but its formKey has never been `
        + "observed; refusing to check a payload against a key this repository invented",
      );
    }
    pairs.push([formKey, expected.fields[field]] as const);
  }
  return pairs;
}

// GraphQL refusals can return HTTP 200; inspect refusal fields, then verify persisted values separately.
async function assertSubmitNotRefused(assertCurrent: () => void, response: Response, documentNumber: string): Promise<void> {
  if (!response.ok()) {
    throw new Error(
      `Kuali answered HTTP ${String(response.status())} to the save on document ${documentNumber}; `
      + "the write was refused at the transport level",
    );
  }
  let body: unknown;
  try {
    assertCurrent();
    body = await response.json();
  } catch (error) {
    assertCurrent();
    // Not a swallow: an unreadable answer means we cannot tell a refusal from
    // an acceptance, which is precisely the uncertainty this driver must raise.
    throw new Error(
      `Kuali's answer to the save on document ${documentNumber} was not readable JSON; the outcome is unknown`,
      { cause: error },
    );
  }
  const parsed = SubmitResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error(
      `Kuali's answer to the save on document ${documentNumber} does not match the known save-response `
      + `shape: ${parsed.error.message}`,
    );
  }
  if (parsed.data.errors !== undefined && parsed.data.errors.length > 0) {
    throw new KualiSaveRefusedError({
      documentNumber,
      refusal: parsed.data.errors.map((entry) => entry.message).join("; "),
    });
  }
  const result = parsed.data.data?.submitDocumentV2 ?? undefined;
  if (result === undefined || result === null) {
    throw new Error(
      `Kuali's answer to the save on document ${documentNumber} carried no ${KUALI_SUBMIT_OPERATION} result`,
    );
  }
  if (result.status !== "Ok") {
    throw new KualiSaveRefusedError({
      documentNumber,
      refusal: `${KUALI_SUBMIT_OPERATION} reported status ${JSON.stringify(result.status)}`,
    });
  }
  if (result.validations !== null && result.validations !== undefined) {
    throw new KualiSaveRefusedError({
      documentNumber,
      refusal: `${KUALI_SUBMIT_OPERATION} returned validations: `
        + JSON.stringify(result.validations).slice(0, 400),
    });
  }
  assertCurrent();
}

// Read form type from document.title; page-wide text can match app lists and dialog rows.
const DOCUMENT_TITLE_FORM_NAME = /^Form - (.+) - Kuali$/u;


// The document title can arrive after route paint; wait for the same fact within a bounded deadline.
async function readDocumentFormType(assertCurrent: () => void, page: Page): Promise<
  { readonly state: "read"; readonly formType: string }
  | { readonly state: "unreadable"; readonly observedTitle: string }
> {
  try {
    assertCurrent();
    await page.waitForFunction(
      (pattern: string) => new RegExp(pattern, "u").test(document.title),
      DOCUMENT_TITLE_FORM_NAME.source,
      { timeout: STATE_TIMEOUT_MS, polling: 100 },
    );
  } catch {
    assertCurrent();
    // Not a swallow: the timeout IS the observation, and the check below turns
    // it into a refusal that quotes whatever the page actually titled itself.
  }
  assertCurrent();
  const title = await page.title();
  const matched = DOCUMENT_TITLE_FORM_NAME.exec(title);
  const formType = matched?.[1]?.trim();
  if (formType === undefined || formType.length === 0) {
    assertCurrent();
    return { state: "unreadable", observedTitle: title };
  }
  assertCurrent();
  return { state: "read", formType };
}

async function waitForDocumentReady(assertCurrent: () => void, page: Page, actionId: string): Promise<string> {
  assertCurrent();
  assertExactKualiDocumentUrl(page.url(), actionId);
  assertCurrent();
  const documentNumber = await readDocumentNumberHeading(assertCurrent, page, actionId);
  assertCurrent();
  await exactlyOne(assertCurrent, page, KUALI_RRSS_EID_FIELD);
  assertCurrent();
  return documentNumber;
}

export function createKualiRrssDocumentDriver(assertCurrent: () => void, page: Page, clock: Clock): KualiRrssDocumentDriver {
  // The ONE time source (ref clock-config-secrets): every observation instant this driver stamps
  // comes from the injected clock, never from `new Date()`.
  const now = (): string => IsoInstantSchema.parse(clock.now().toISOString());

  /** See `StagedExpectation` — the staging this page's `Save` may act on, if any. */
  let staged: StagedExpectation | undefined;


  // Retain the proved document number; rereading would be a new observation under the retained proof identity.
  let matchedActionListNumber: string | undefined;




  async function readActionListForDocument(input: Readonly<{
    documentNumber: string;
  }>): Promise<KualiActionListObservation> {
    const documentNumber = KualiDocumentNumberSchema.parse(input.documentNumber);
    // A navigation away from a document discards Kuali's in-page form model, so
    // any staging is gone — the same invariant `openDocument` maintains.
    staged = undefined;
    matchedActionListNumber = undefined;
    assertCurrent();
    await page.goto(actionListUrl(), {
      waitUntil: "domcontentloaded",
      timeout: NAVIGATION_TIMEOUT_MS,
    });
    assertCurrent();
    recordBrowserAction("opened", "kuali.action-list");

    assertCurrent();
    const search = await exactlyOne(assertCurrent, page, KUALI_ACTION_LIST_SEARCH_INPUT);
    assertCurrent();
    const go = await exactlyOne(assertCurrent, page, KUALI_ACTION_LIST_SEARCH_GO_BUTTON);
    assertCurrent();
    await search.fill(documentNumber, { timeout: FIELD_TIMEOUT_MS });
    assertCurrent();
    recordBrowserAction("typed", KUALI_ACTION_LIST_SEARCH_INPUT, documentNumber);
    assertCurrent();
    await go.click({ timeout: FIELD_TIMEOUT_MS });
    assertCurrent();
    recordBrowserAction("clicked", KUALI_ACTION_LIST_SEARCH_GO_BUTTON);

    const matched = documentLinks(page, documentNumber);
    try {
      assertCurrent();
      await matched.first().waitFor({ state: "attached", timeout: ACTION_LIST_FILTER_TIMEOUT_MS });
    } catch {
      assertCurrent();
      // No matched action is a valid absence; the observation below retains the list contents and zero links.
    }
    assertCurrent();
    const matchedLinks = await matched.evaluateAll((elements) => elements.map((element) => ({
      name: (element.textContent ?? "").trim(),
      href: element.getAttribute("href"),
    })));
    assertCurrent();
    const listed = await page
      .getByRole("link", { name: BARE_DOCUMENT_NUMBER_NAME })
      .evaluateAll((elements) => elements.map((element) => (element.textContent ?? "").trim()));
    if (matchedLinks.length > 0) matchedActionListNumber = documentNumber;
    assertCurrent();
    return KualiActionListObservationSchema.parse({
      pageStateId: KUALI_ACTION_LIST_READY,
      space: KUALI_RRSS_SPACE_ID,
      requestedDocumentNumber: documentNumber,
      matchedLinks,
      listedDocumentNumbers: listed,
      observedAt: now(),
    });
  }

  async function openDocument(input: Readonly<{
    actionId: string;
    documentNumber: string;
  }>): Promise<Readonly<{
    actionId: string;
    documentNumber: string;
    observedEid: string;
  }>> {
    const actionId = KualiActionIdSchema.parse(input.actionId);
    const expectedNumber = KualiDocumentNumberSchema.parse(input.documentNumber);
    // Navigation discards Kuali's form model; clear retained staging proof before reload.
    staged = undefined;
    assertCurrent();
    await page.goto(documentUrl(actionId), {
      waitUntil: "domcontentloaded",
      timeout: NAVIGATION_TIMEOUT_MS,
    });
    assertCurrent();
    recordBrowserAction("opened", "kuali.separation-document");
    assertCurrent();
    const observedNumber = await waitForDocumentReady(assertCurrent, page, actionId);
    if (observedNumber !== expectedNumber) {
      throw new Error(
        `Kuali action ${actionId} opened document ${observedNumber}, but the run named ${expectedNumber}; `
        + "action ids are not stable across workflow steps — refusing to act on a different document",
      );
    }
    assertCurrent();
    const result = {
      actionId,
      documentNumber: observedNumber,
      observedEid: await readDisplayedEid(assertCurrent, page),
    };
    assertCurrent();
    return result;
  }

  /* ── The separation-document read (2i chunk 2) ─────────────────────────── */

  /** A `<select>`: its selected option text and its COMPLETE option list (§3.2). */
  async function readSelect(id: ElementId): Promise<{
    readonly selected: string;
    readonly options: readonly string[];
  }> {
    assertCurrent();
    const locator = await exactlyOne(assertCurrent, page, id);
    assertCurrent();
    const read = await locator.evaluate((node) => {
      const select = node as HTMLSelectElement;
      const options = Array.from(select.options).map((option) => option.text);
      const selected = select.options[select.selectedIndex]?.text;
      return { selected, options };
    });
    if (read.selected === undefined) {
      // An invalid selectedIndex is unreadable; never guess the first dropdown option.
      throw new Error(
        `Kuali ${id} has no option text at its selected index; refusing to guess which option is chosen`,
      );
    }
    assertCurrent();
    return { selected: read.selected.trim(), options: read.options.map((option) => option.trim()) };
  }

  async function readCheckbox(id: ElementId): Promise<boolean> {
    assertCurrent();
    const locator = await exactlyOne(assertCurrent, page, id);
    assertCurrent();
    const result = await locator.isChecked({ timeout: FIELD_TIMEOUT_MS });
    assertCurrent();
    return result;
  }


  async function exactlyOneInternal(
    role: "textbox" | "combobox" | "radio",
    name: string,
  ): Promise<Locator> {
    const locator = page.getByRole(role, { name, exact: true });
    try {
      assertCurrent();
      await locator.first().waitFor({ state: "attached", timeout: FIELD_TIMEOUT_MS });
    } catch (error) {
      assertCurrent();
      throw new Error(
        `Kuali driver-internal control role="${role}" name="${name}" never attached within `
        + `${String(FIELD_TIMEOUT_MS)}ms; refusing to read a document that does not show it`,
        { cause: error },
      );
    }
    assertCurrent();
    const count = await locator.count();
    if (count !== 1) {
      throw new Error(
        `Kuali driver-internal control role="${role}" name="${name}" resolved ${String(count)} nodes; `
        + "exactly one is required and there is no fallback",
      );
    }
    assertCurrent();
    return locator;
  }

  async function readInternalText(name: string): Promise<string> {
    assertCurrent();
    const locator = await exactlyOneInternal("textbox", name);
    assertCurrent();
    const result = (await locator.inputValue({ timeout: FIELD_TIMEOUT_MS })).trim();
    assertCurrent();
    return result;
  }

  async function readInternalSelect(name: string): Promise<{
    readonly selected: string;
    readonly options: readonly string[];
  }> {
    assertCurrent();
    const locator = await exactlyOneInternal("combobox", name);
    assertCurrent();
    const read = await locator.evaluate((node) => {
      const select = node as HTMLSelectElement;
      return {
        selected: select.options[select.selectedIndex]?.text,
        options: Array.from(select.options).map((option) => option.text),
      };
    });
    if (read.selected === undefined) {
      throw new Error(
        `Kuali driver-internal select "${name}" has no option text at its selected index; `
        + "refusing to guess which option is chosen",
      );
    }
    assertCurrent();
    return { selected: read.selected.trim(), options: read.options.map((option) => option.trim()) };
  }

  const textField = (value: string): KualiTextField => (value.length === 0
    ? { state: "absent", reason: "the control is present on the form and holds no value" }
    : { state: "present", value });

  const optionField = (value: string): KualiOptionField => (
    value === KUALI_BLANK_OPTION_TEXT || value.length === 0
      ? {
        state: "absent",
        reason: `the select sits on Kuali's blank sentinel ${JSON.stringify(KUALI_BLANK_OPTION_TEXT)}`,
      }
      : { state: "present", value });

  async function readSeparationDocument(input: Readonly<{
    actionId: string;
    documentNumber: string;
  }>): Promise<KualiSeparationDocumentRead> {
    const actionId = KualiActionIdSchema.parse(input.actionId);
    const expectedNumber = KualiDocumentNumberSchema.parse(input.documentNumber);
    // A navigation discards Kuali's in-page form model; nothing this read does
    // may leave a staging behind that a later `commit` could click on.
    staged = undefined;
    assertCurrent();
    await page.goto(documentUrl(actionId), {
      waitUntil: "domcontentloaded",
      timeout: NAVIGATION_TIMEOUT_MS,
    });
    assertCurrent();
    recordBrowserAction("opened", "kuali.separation-document");
    assertCurrent();
    assertExactKualiDocumentUrl(page.url(), actionId);

    assertCurrent();
    const heading = await probeDocumentNumberHeading(assertCurrent, page, actionId);
    if (heading.state === "unavailable") {
      assertCurrent();
      return KualiSeparationDocumentReadSchema.parse({
        state: "document-unavailable",
        actionId,
        observedUrl: page.url(),
        reason: heading.reason,
        observedAt: now(),
      });
    }
    if (heading.documentNumber !== expectedNumber) {
      assertCurrent();
      return KualiSeparationDocumentReadSchema.parse({
        state: "document-number-mismatch",
        actionId,
        expectedNumber,
        observedNumber: heading.documentNumber,
        observedAt: now(),
      });
    }


    assertCurrent();
    const formType = await readDocumentFormType(assertCurrent, page);
    if (formType.state === "unreadable") {
      assertCurrent();
      return KualiSeparationDocumentReadSchema.parse({
        state: "document-unavailable",
        actionId,
        observedUrl: page.url(),
        reason: `Kuali document ${heading.documentNumber} never titled itself `
          + `${JSON.stringify(DOCUMENT_TITLE_FORM_NAME.source)} within ${String(STATE_TIMEOUT_MS)}ms `
          + `(observed title ${JSON.stringify(formType.observedTitle)}); the form's own type cannot be read`,
        observedAt: now(),
      });
    }
    if (formType.formType !== KUALI_SEPARATION_FORM_TYPE) {
      assertCurrent();
      return KualiSeparationDocumentReadSchema.parse({
        state: "not-a-separation-document",
        actionId,
        documentNumber: heading.documentNumber,
        observedFormType: formType.formType,
        observedAt: now(),
      });
    }

    assertCurrent();
    const rawEid = await readTrimmedInput(assertCurrent, page, KUALI_RRSS_EID_FIELD);
    const parsedEid = rawEid.length === 0 ? undefined : EidSchema.safeParse(rawEid);
    if (parsedEid !== undefined && !parsedEid.success) {
      assertCurrent();
      return KualiSeparationDocumentReadSchema.parse({
        state: "unreadable-eid",
        actionId,
        documentNumber: heading.documentNumber,
        raw: rawEid,
        observedAt: now(),
      });
    }

    assertCurrent();
    const dates: { field: "lastDayWorked" | "separationDate" | "terminationEffectiveDate"; raw: string }[] = [
      { field: "lastDayWorked", raw: await readTrimmedInput(assertCurrent, page, KUALI_RRSS_LAST_DAY_WORKED_FIELD) },
      { field: "separationDate", raw: await readTrimmedInput(assertCurrent, page, KUALI_RRSS_SEPARATION_DATE_FIELD) },
      {
        field: "terminationEffectiveDate",
        raw: await readTrimmedInput(assertCurrent, page, KUALI_RRSS_TERMINATION_EFF_DATE_FIELD),
      },
    ];
    const parsedDates = new Map<string, KualiDateField>();
    for (const { field, raw } of dates) {
      if (raw.length === 0) {
        parsedDates.set(field, {
          state: "absent",
          reason: "the date control is present on the form and holds no value",
        });
        continue;
      }
      const value = parseKualiFormDate(raw);
      if (value === null) {
        // S8, kept verbatim: a non-blank date we cannot read is a refusal that
        // names the field and the value, never a blank and never a guess.
        assertCurrent();
        return KualiSeparationDocumentReadSchema.parse({
          state: "unparseable-date",
          actionId,
          documentNumber: heading.documentNumber,
          field,
          raw,
          observedAt: now(),
        });
      }
      parsedDates.set(field, { state: "present", raw, value });
    }
    const dateField = (field: string): KualiDateField => {
      const value = parsedDates.get(field);
      if (value === undefined) throw new Error(`Kuali separation read did not visit date field ${field}`);
      return value;
    };

    assertCurrent();
    const terminationType = await readSelect(KUALI_RRSS_TERMINATION_TYPE_FIELD);
    assertCurrent();
    const department = await readSelect(KUALI_RRSS_DEPARTMENT_FIELD);
    assertCurrent();
    const division = await readInternalSelect(INTERNAL_DIVISION_FIELD);
    assertCurrent();
    const employeeType = await readInternalSelect(INTERNAL_EMPLOYEE_TYPE_FIELD);
    assertCurrent();
    const studentTitleCode = await readInternalSelect(INTERNAL_STUDENT_TITLE_CODE_FIELD);

    assertCurrent();
    const rawTransactionNumber = await readTrimmedInput(assertCurrent, page, KUALI_RRSS_TRANSACTION_NUMBER_FIELD);
    const transactionNumber: KualiTransactionNumberField = rawTransactionNumber.length === 0
      ? { state: "absent", reason: "the transaction-number control is present on the form and holds no value" }
      : KualiTransactionNumberSchema.safeParse(rawTransactionNumber).success
        ? { state: "present", value: rawTransactionNumber }
        : {
          state: "unrecognized",
          raw: rawTransactionNumber,
          reason: "the value is not a UCPath transaction number (T followed by 6-12 digits); it is kept "
            + "verbatim rather than reported as empty, because 'the field holds something we do not "
            + "recognise' and 'the field is empty' are different facts",
        };


    assertCurrent();
    const finalPayChoice = await readFinalPayChoice(heading.documentNumber);

    assertCurrent();
    const result = KualiSeparationDocumentReadSchema.parse({
      state: "read",
      document: KualiSeparationDocumentSchema.parse({
        pageStateId: KUALI_RRSS_SEPARATION_READY,
        actionId,
        documentNumber: heading.documentNumber,
        formType: { observed: formType.formType, matches: true },
        employee: {
          name: textField(await readTrimmedInput(assertCurrent, page, KUALI_RRSS_EMPLOYEE_NAME_FIELD)),
          eid: parsedEid === undefined || !parsedEid.success
            ? { state: "absent", reason: "the EID control is present on the form and holds no value" }
            : { state: "present", value: parsedEid.data },
          employeeType: optionField(employeeType.selected),
          studentTitleCode: optionField(studentTitleCode.selected),
          division: optionField(division.selected),
          location: textField(await readTrimmedInput(assertCurrent, page, KUALI_RRSS_LOCATION_FIELD)),
        },
        separation: {
          terminationType: optionField(terminationType.selected),
          lastDayWorked: dateField("lastDayWorked"),
          separationDate: dateField("separationDate"),
          additionalComments: textField(await readInternalText(INTERNAL_ADDITIONAL_COMMENTS_FIELD)),
        },
        timekeeper: {
          requestAcknowledged: await readCheckbox(KUALI_RRSS_REQUEST_ACKNOWLEDGED_CHECKBOX),
          name: textField(await readTrimmedInput(assertCurrent, page, KUALI_RRSS_TIMEKEEPER_FIELD)),
          comments: textField(await readTrimmedInput(assertCurrent, page, KUALI_RRSS_TIMEKEEPER_COMMENTS_FIELD)),
        },
        finalTransactions: {
          terminationEffectiveDate: dateField("terminationEffectiveDate"),
          department: optionField(department.selected),
          payrollTitleCode: textField(await readTrimmedInput(assertCurrent, page, KUALI_RRSS_PAYROLL_TITLE_CODE_FIELD)),
          payrollTitle: textField(await readTrimmedInput(assertCurrent, page, KUALI_RRSS_PAYROLL_TITLE_FIELD)),
          submittedTerminationTemplate: await readCheckbox(KUALI_RRSS_SUBMITTED_TEMPLATE_CHECKBOX),
          transactionNumber,
          finalPay: finalPayChoice === undefined
            ? { state: "absent", reason: "no Final Pay radio in the group is selected" }
            : { state: "present", value: finalPayChoice },
        },
        options: {
          terminationType: terminationType.options,
          division: division.options,
          employeeType: employeeType.options,
          studentTitleCode: studentTitleCode.options,
          department: department.options,
          finalPay: FINAL_PAY_OPTION_LABELS,
        },
        observedAt: now(),
      }),
    });
    assertCurrent();
    return result;
  }

  /* ── The finalization write (chunk 5) ──────────────────────────────────── */

  async function readInternalChecked(name: string): Promise<boolean> {
    assertCurrent();
    const locator = await exactlyOneInternal("radio", name);
    assertCurrent();
    const result = await locator.isChecked({ timeout: FIELD_TIMEOUT_MS });
    assertCurrent();
    return result;
  }

  // No Final Pay radio is explicit absence; two selected radios are an ambiguous page and refuse.
  async function readFinalPayChoice(documentNumber: string): Promise<KualiFinalPayChoice | undefined> {
    assertCurrent();
    const checks: readonly (readonly [KualiFinalPayChoice, boolean])[] = [
      ["submitted-final-pay-request",
        await readInternalChecked(INTERNAL_FINAL_PAY_SUBMITTED)],
      ["does-not-need-final-pay-student", await readCheckbox(KUALI_RRSS_FINAL_PAY_STUDENT_RADIO)],
      ["does-not-need-final-pay-transfer",
        await readInternalChecked(INTERNAL_FINAL_PAY_TRANSFER)],
      ["other",
        await readInternalChecked(INTERNAL_FINAL_PAY_OTHER)],
    ];
    const selected = checks.filter(([, checked]) => checked);
    if (selected.length > 1) {
      throw new Error(
        `Kuali document ${documentNumber} reports ${String(selected.length)} Final Pay radios checked at `
        + "once; a radio group with two selections is a page we cannot describe",
      );
    }
    assertCurrent();
    return selected[0]?.[0];
  }

  // Read all twelve controls and the complete department options without classifying valid blank values.
  async function readFinalizationFields(documentNumber: string): Promise<{
    readonly fields: KualiObservedFinalizationFields;
    readonly departmentOptions: readonly string[];
  }> {
    assertCurrent();
    const department = await readSelect(KUALI_RRSS_DEPARTMENT_FIELD);
    assertCurrent();
    const finalPay = await readFinalPayChoice(documentNumber);
    assertCurrent();
    const result = {
      fields: KualiObservedFinalizationFieldsSchema.parse({
        department: department.selected,
        payrollTitleCode: await readTrimmedInput(assertCurrent, page, KUALI_RRSS_PAYROLL_TITLE_CODE_FIELD),
        payrollTitle: await readTrimmedInput(assertCurrent, page, KUALI_RRSS_PAYROLL_TITLE_FIELD),
        requestAcknowledged: await readCheckbox(KUALI_RRSS_REQUEST_ACKNOWLEDGED_CHECKBOX),
        timekeeperName: await readTrimmedInput(assertCurrent, page, KUALI_RRSS_TIMEKEEPER_FIELD),

        lastDayWorked: await readTrimmedInput(assertCurrent, page, KUALI_RRSS_LAST_DAY_WORKED_FIELD),
        separationDate: await readTrimmedInput(assertCurrent, page, KUALI_RRSS_SEPARATION_DATE_FIELD),
        terminationEffectiveDate: await readTrimmedInput(assertCurrent, page, KUALI_RRSS_TERMINATION_EFF_DATE_FIELD),
        submittedTerminationTemplate: await readCheckbox(KUALI_RRSS_SUBMITTED_TEMPLATE_CHECKBOX),
        transactionNumber: await readTrimmedInput(assertCurrent, page, KUALI_RRSS_TRANSACTION_NUMBER_FIELD),
        finalPay: finalPay ?? null,
        timekeeperComments: await readTrimmedInput(assertCurrent, page, KUALI_RRSS_TIMEKEEPER_COMMENTS_FIELD),
      }),
      departmentOptions: department.options,
    };
    assertCurrent();
    return result;
  }

  // Kuali can drop fill input; verify readback and wait for the document model before fencing.
  async function stageText(
    id: ElementId,
    value: string,
    what: string,
    documentNumber: string,
  ): Promise<void> {
    assertCurrent();
    const field = await exactlyOne(assertCurrent, page, id);
    assertCurrent();
    const handle = await field.elementHandle({ timeout: FIELD_TIMEOUT_MS });
    if (handle === null) {
      throw new Error(
        `Kuali document ${documentNumber} lost the ${what} control while staging; refusing to reach the fence`,
      );
    }
    try {
      assertCurrent();
      await stampModelProps(assertCurrent, handle, documentNumber, what);
      assertCurrent();
      await field.fill(value, { timeout: FIELD_TIMEOUT_MS });
      assertCurrent();
      recordBrowserAction("typed", id, value);
      assertCurrent();
      let displayed = (await field.inputValue({ timeout: FIELD_TIMEOUT_MS })).trim();
      if (displayed !== value) {
        assertCurrent();
        await field.clear({ timeout: FIELD_TIMEOUT_MS });
        assertCurrent();
        recordBrowserAction("cleared", id);
        assertCurrent();
        await field.pressSequentially(value, { delay: 30, timeout: FIELD_TIMEOUT_MS });
        assertCurrent();
        recordBrowserAction("typed", id, value);
        assertCurrent();
        displayed = (await field.inputValue({ timeout: FIELD_TIMEOUT_MS })).trim();
      }
      if (displayed !== value) return;
      assertCurrent();
      await awaitModelPropsReplaced(assertCurrent, page, handle, documentNumber, what);
    } finally {
      await handle.dispose();
    }
    assertCurrent();
  }

  // Stamp discrete controls before interaction; unlike text gadgets they may update without debounce.
  async function stageDiscrete(
    locator: Locator,
    act: () => Promise<void>,
    what: string,
    documentNumber: string,
  ): Promise<void> {
    assertCurrent();
    const handle = await locator.elementHandle({ timeout: FIELD_TIMEOUT_MS });
    if (handle === null) {
      throw new Error(
        `Kuali document ${documentNumber} lost the ${what} control while staging; refusing to reach the fence`,
      );
    }
    try {
      assertCurrent();
      await stampModelProps(assertCurrent, handle, documentNumber, what);
      assertCurrent();
      await act();
      assertCurrent();
      await awaitModelPropsReplaced(assertCurrent, page, handle, documentNumber, what);
    } finally {
      await handle.dispose();
    }
    assertCurrent();
  }


  async function finalPayLocator(choice: KualiFinalPayChoice): Promise<Locator> {
    if (choice === "does-not-need-final-pay-student") {
      const result = await exactlyOne(assertCurrent, page, KUALI_RRSS_FINAL_PAY_STUDENT_RADIO);
      assertCurrent();
      return result;
    }
    if (choice === "submitted-final-pay-request") {
      const result = await exactlyOneInternal("radio", INTERNAL_FINAL_PAY_SUBMITTED);
      assertCurrent();
      return result;
    }
    if (choice === "does-not-need-final-pay-transfer") {
      const result = await exactlyOneInternal("radio", INTERNAL_FINAL_PAY_TRANSFER);
      assertCurrent();
      return result;
    }
    const result = await exactlyOneInternal("radio", INTERNAL_FINAL_PAY_OTHER);
    assertCurrent();
    return result;
  }

  async function stageSeparationFinalization(
    input: KualiFinalizationTarget,
  ): Promise<KualiFinalizationStaging> {
    const target = KualiFinalizationTargetSchema.parse(input);
    const fields = kualiFinalizationFields(target.variables);
    staged = undefined;
    assertCurrent();
    const view = await openDocument({
      actionId: target.actionId,
      documentNumber: target.documentNumber,
    });
    assertCurrent();
    const before = await readFinalizationFields(view.documentNumber);

    // Preserve the comments read upstream; a changed field must refuse instead of overwriting an edit.
    if (before.fields.timekeeperComments !== target.variables.observedExistingComments) {
      throw new KualiCommentsChangedError({
        documentNumber: view.documentNumber,
        expected: target.variables.observedExistingComments,
        observed: before.fields.timekeeperComments,
      });
    }
    // **S55.** Refuse an option the live control does not offer, and record the
    // whole list it did offer.
    if (!before.departmentOptions.includes(fields.department)) {
      throw new KualiDepartmentOptionNotOfferedError({
        documentNumber: view.documentNumber,
        requested: fields.department,
        observedOptions: before.departmentOptions,
      });
    }

    // ONE pass, every field, from the staged variables only.
    assertCurrent();
    const departmentControl = await exactlyOne(assertCurrent, page, KUALI_RRSS_DEPARTMENT_FIELD);
    assertCurrent();
    await stageDiscrete(
      departmentControl,
      async () => {
        assertCurrent();
        await departmentControl.selectOption({ label: fields.department }, { timeout: FIELD_TIMEOUT_MS });
        assertCurrent();
        recordBrowserAction("selected", KUALI_RRSS_DEPARTMENT_FIELD, fields.department);
        assertCurrent();
      },
      "department",
      view.documentNumber,
    );
    assertCurrent();
    await stageText(KUALI_RRSS_PAYROLL_TITLE_CODE_FIELD, fields.payrollTitleCode, "payroll title code", view.documentNumber);
    assertCurrent();
    await stageText(KUALI_RRSS_PAYROLL_TITLE_FIELD, fields.payrollTitle, "payroll title", view.documentNumber);
    assertCurrent();
    const acknowledged = await exactlyOne(assertCurrent, page, KUALI_RRSS_REQUEST_ACKNOWLEDGED_CHECKBOX);
    assertCurrent();
    await stageDiscrete(
      acknowledged,
      async () => {
        assertCurrent();
        await acknowledged.setChecked(fields.requestAcknowledged, { timeout: FIELD_TIMEOUT_MS });
        assertCurrent();
        recordBrowserAction("set", KUALI_RRSS_REQUEST_ACKNOWLEDGED_CHECKBOX, fields.requestAcknowledged);
        assertCurrent();
      },
      "request acknowledged",
      view.documentNumber,
    );
    assertCurrent();
    await stageText(KUALI_RRSS_TIMEKEEPER_FIELD, fields.timekeeperName, "timekeeper name", view.documentNumber);

    assertCurrent();
    await stageText(
      KUALI_RRSS_LAST_DAY_WORKED_FIELD,
      fields.lastDayWorked,
      "last day worked",
      view.documentNumber,
    );
    assertCurrent();
    await stageText(
      KUALI_RRSS_SEPARATION_DATE_FIELD,
      fields.separationDate,
      "separation date",
      view.documentNumber,
    );
    assertCurrent();
    await stageText(
      KUALI_RRSS_TERMINATION_EFF_DATE_FIELD,
      fields.terminationEffectiveDate,
      "termination effective date",
      view.documentNumber,
    );
    assertCurrent();
    const template = await exactlyOne(assertCurrent, page, KUALI_RRSS_SUBMITTED_TEMPLATE_CHECKBOX);
    assertCurrent();
    await stageDiscrete(
      template,
      async () => {
        assertCurrent();
        await template.setChecked(fields.submittedTerminationTemplate, { timeout: FIELD_TIMEOUT_MS });
        assertCurrent();
        recordBrowserAction("set", KUALI_RRSS_SUBMITTED_TEMPLATE_CHECKBOX, fields.submittedTerminationTemplate);
        assertCurrent();
      },
      "submitted termination template",
      view.documentNumber,
    );
    assertCurrent();
    await stageText(KUALI_RRSS_TRANSACTION_NUMBER_FIELD, fields.transactionNumber, "transaction number", view.documentNumber);
    assertCurrent();
    const finalPay = await finalPayLocator(fields.finalPay);
    assertCurrent();
    await stageDiscrete(
      finalPay,
      async () => {
        assertCurrent();
        await finalPay.check({ timeout: FIELD_TIMEOUT_MS });
        assertCurrent();
        recordBrowserAction("checked", "kuali.rrss.final-pay", fields.finalPay);
        assertCurrent();
      },
      "final pay radio",
      view.documentNumber,
    );
    assertCurrent();
    await stageText(KUALI_RRSS_TIMEKEEPER_COMMENTS_FIELD, fields.timekeeperComments, "timekeeper comments", view.documentNumber);

    // Every control read back, against the exact staged field set.
    assertCurrent();
    const after = await readFinalizationFields(view.documentNumber);
    const mismatches = compareKualiFinalizationFields(fields, after.fields);
    if (mismatches.length > 0) {
      throw new KualiFinalizationStageNotPersistedError({
        documentNumber: view.documentNumber,
        mismatches,
      });
    }
    // The Save button must already resolve uniquely BEFORE the fence: a page
    // that cannot name exactly one Save is a page we must not fence on.
    assertCurrent();
    await exactlyOne(assertCurrent, page, KUALI_RRSS_SAVE_BUTTON);
    staged = {
      kind: "finalization",
      actionId: view.actionId,
      documentNumber: view.documentNumber,
      fields,
    };
    assertCurrent();
    return KualiFinalizationStagingSchema.parse({
      stagedPageState: KUALI_RRSS_FINALIZATION_STAGED,
      actionId: view.actionId,
      documentNumber: view.documentNumber,
      observedEid: view.observedEid,
      previousFields: before.fields,
      stagedFields: fields,
      observedDepartmentOptions: after.departmentOptions,
      observedAt: now(),
    });
  }

  async function readSavedSeparationFinalization(
    input: KualiFinalizationTarget,
  ): Promise<KualiFinalizationReadBack> {
    const target = KualiFinalizationTargetSchema.parse(input);
    const expected = kualiFinalizationFields(target.variables);
    try {
      // The reload IS the proof mechanism. Reading the in-page form model would
      // report the staged values whether or not the save landed.
      assertCurrent();
      await page.reload({ waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
      assertCurrent();
      const view = await openDocument({
        actionId: target.actionId,
        documentNumber: target.documentNumber,
      });
      assertCurrent();
      const observed = await readFinalizationFields(view.documentNumber);
      const mismatches = compareKualiFinalizationFields(expected, observed.fields);
      if (mismatches.length === 0) {
        assertCurrent();
        return KualiFinalizationReadBackSchema.parse({
          state: "present",
          proof: KualiSavedFinalizationProofSchema.parse({
            kind: "kuali-saved-finalization",
            actionId: view.actionId,
            documentNumber: view.documentNumber,
            observedEid: view.observedEid,
            fields: expected,
            source: "reload-read-back",
          }),
          observedAt: now(),
        });
      }
      assertCurrent();
      return KualiFinalizationReadBackSchema.parse({
        state: "absent",
        actionId: view.actionId,
        documentNumber: view.documentNumber,
        observedEid: view.observedEid,
        observedFields: observed.fields,
        mismatches,
        observedAt: now(),
      });
    } catch (error) {
      assertCurrent();
      // A failed check is NOT "found nothing". Everything that throws becomes
      // `unknown`, which parks — it can never become retry authority.
      assertCurrent();
      return KualiFinalizationReadBackSchema.parse({
        state: "unknown",
        reason: `Kuali finalization reload read-back failed: ${error instanceof Error ? error.message : "non-Error thrown"}`,
        observedAt: now(),
      });
    }
  }

  async function read(id: ObservationId): Promise<string> {
    if (id === KUALI_ACTION_LIST_MATCHED_NUMBER) {
      const matched = matchedActionListNumber;
      if (matched === undefined) {
        throw new Error(
          `Kuali ${KUALI_ACTION_LIST_MATCHED_NUMBER} has no value on this page: no Action-List resolve has `
          + "matched a document here, and there is no number to read that would not be a guess",
        );
      }
      assertCurrent();
      return matched;
    }
    if (id === KUALI_RRSS_DISPLAYED_EID) {
      const result = await readDisplayedEid(assertCurrent, page);
      assertCurrent();
      return result;
    }
    throw new Error(`Kuali driver has no observation recipe for ${id}`);
  }

  async function commit(id: ElementId, capability: MutationCapability): Promise<UiActionProof> {
    // Beat ⑤: a capability this process's write sequencer did not mint cannot
    // click. This runs BEFORE the locator is even resolved.
    assertMintedMutationCapability(capability);
    if (id !== KUALI_RRSS_SAVE_BUTTON) {
      throw new Error(`Kuali driver refuses to commit through ${id}; only ${KUALI_RRSS_SAVE_BUTTON} may be clicked`);
    }
    const expectation = staged;
    if (expectation === undefined) {
      throw new Error(
        "Kuali driver refuses to click Save without a staging on this exact page; a Save with nothing "
        + "staged re-submits the document unchanged and Kuali still answers 200 with `Form saved`",
      );
    }
    assertCurrent();
    const save = await exactlyOne(assertCurrent, page, KUALI_RRSS_SAVE_BUTTON);
    // Arm the observation BEFORE the click: the mutation is issued within a
    // second of it, and a listener attached afterwards would race it.
    assertCurrent();
    const settled = page.waitForResponse(
      (response) => {
        assertCurrent();
        return response.url().includes(KUALI_GRAPHQL_PATH)
        && (response.request().postData() ?? "").includes(KUALI_SUBMIT_OPERATION);
      },
      { timeout: SUBMIT_OBSERVE_TIMEOUT_MS },
    );
    void settled.catch(() => { /* The original promise is awaited below unless revocation refuses. */ });
    assertCurrent();
    await save.click({ timeout: FIELD_TIMEOUT_MS });
    assertCurrent();
    recordBrowserAction("clicked", KUALI_RRSS_SAVE_BUTTON);
    // Wait for the specific save mutation response; networkidle and Form saved do not prove retained values.
    let response: Response;
    try {
      assertCurrent();
      response = await settled;
    } catch (error) {
      assertCurrent();
      throw new Error(
        `Kuali Save on document ${expectation.documentNumber} issued no answered ${KUALI_SUBMIT_OPERATION} `
        + `within ${String(SUBMIT_OBSERVE_TIMEOUT_MS)}ms; the click cannot be described and the outcome is unknown`,
        { cause: error },
      );
    }
    assertCurrent();
    assertSubmitCarriedValue(response.request(), expectation);
    assertCurrent();
    await assertSubmitNotRefused(assertCurrent, response, expectation.documentNumber);
    assertCurrent();
    return UiActionProofSchema.parse({ elementId: id, effect: "external-commit", performed: true });
  }

  const driver: KualiRrssDocumentDriver = {
    system: "kuali" as const,
    read,
    readActionListForDocument,
    readSeparationDocument,
    stageSeparationFinalization,
    readSavedSeparationFinalization,
    commit,
  };
  return Object.freeze(z.custom<KualiRrssDocumentDriver>(() => true).parse(
    KualiRrssDocumentDriverSchema.parse(driver),
  ));
}
