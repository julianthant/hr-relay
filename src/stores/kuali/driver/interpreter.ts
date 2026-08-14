/**
 * The Kuali RRSS-document driver — the only module in this store that touches a
 * raw Playwright `Page`.
 *
 * Every locator is resolved from `KUALI_UI_REGISTRY` by semantic id; there are
 * no inline selectors and no fallbacks. Three rules run through the whole file
 * and each of them exists because of a recorded incident or probe finding:
 *
 *  1. **Exactly one match, or throw.** Kuali's `Save` shares its action group
 *     with `Send Back` and `Mark Complete`, which advance the workflow. A
 *     second match means the DOM moved and we no longer know what we would be
 *     clicking, so we refuse instead of taking `.first()`.
 *  2. **Trim every read.** Kuali inputs return whitespace-padded values (legacy
 *     `kuali/LESSONS.md:49-54`: doc #4241 returned `" 10772489"`).
 *  3. **A save is never proof.** `commit` returns only that the click happened
 *     AND that the mutation it issued carried the staged value. Landing proof
 *     comes exclusively from `readSavedTimekeeper`, which RELOADS first
 *     (doc 09 §13 OQ1 (a)).
 *  4. **The DOM holding the value is not Kuali holding the value.** A Kuali
 *     Build text gadget debounces into the document model; only the model is
 *     serialized by `submitDocumentV2`. Staging therefore waits for the model
 *     commit (`awaitModelCommit`) and the commit re-proves it on the wire
 *     (`assertSubmitCarriedValue`). Both were added 2026-08-04 after a fenced,
 *     `200`-answered, `Form saved`-rendering save persisted nothing.
 *
 * Ported with provenance from legacy hr-automation@793abe1f8265f3213ffe8a80d6cfd9860a32a1dc:
 * `src/systems/kuali/selectors.ts` (the three recipes, via the registry),
 * `src/systems/kuali/navigate.ts:16-39` (`fillWithVerify`'s read-back-or-throw
 * discipline) and `:626-652` (`clickSave`). The deep-link open is NOT a port —
 * legacy has no URL builder and only ever reached a document through the Action
 * List search box; the `…/actions/<actionId>` shape is live-verified knowledge
 * recorded by the 2026-07-23 probe and re-verified read-only 2026-08-04.
 */
import type { ElementHandle, Locator, Page, Response } from "playwright";
import { z } from "zod";
import type { Clock } from "../../../domain/clock.js";
import { EidSchema, IsoInstantSchema } from "../../../domain/ids.js";
import type { ElementId, ObservationId } from "../../../domain/ids.js";
import { assertMintedMutationCapability } from "../../../base/mutation-capability.js";
import type { MutationCapability, UiActionProof } from "../../../domain/ui/driver.js";
import { UiActionProofSchema } from "../../../domain/ui/driver.js";
import {
  KUALI_RRSS_DISPLAYED_EID,
  KUALI_RRSS_DISPLAYED_TIMEKEEPER,
  KUALI_RRSS_DOCUMENT_READY,
  KUALI_RRSS_EID_FIELD,
  KUALI_RRSS_SAVE_BUTTON,
  KUALI_RRSS_TIMEKEEPER_FIELD,
  KUALI_RRSS_TIMEKEEPER_FORM_KEY,
  KUALI_RRSS_TIMEKEEPER_STAGED,
  KualiActionIdSchema,
  KualiDocumentNumberSchema,
  KualiDocumentViewSchema,
  KualiRrssDocumentDriverSchema,
  KualiSavedTimekeeperProofSchema,
  KualiTimekeeperNameSchema,
  KualiTimekeeperReadBackSchema,
  KualiTimekeeperStagingSchema,
} from "../../../domain/ui/kuali-rrss-document.js";
import type {
  KualiDocumentView,
  KualiRrssDocumentDriver,
  KualiTimekeeperReadBack,
  KualiTimekeeperStaging,
} from "../../../domain/ui/kuali-rrss-document.js";
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
} from "../../../domain/ui/kuali-separation-document.js";
import type {
  KualiDateField,
  KualiFinalPayChoice,
  KualiOptionField,
  KualiSeparationDocumentRead,
  KualiTextField,
  KualiTransactionNumberField,
} from "../../../domain/ui/kuali-separation-document.js";
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
} from "../../../domain/ui/kuali-separation-finalization.js";
import type {
  KualiFinalizationFields,
  KualiFinalizationReadBack,
  KualiFinalizationStaging,
  KualiFinalizationTarget,
  KualiObservedFinalizationFields,
} from "../../../domain/ui/kuali-separation-finalization.js";
import { KUALI_RRSS_SPACE_ID, KUALI_UI_REGISTRY } from "./ui-registry.js";

const KUALI_HOST = "ucsd.kualibuild.com";
const NAVIGATION_TIMEOUT_MS = 60_000;
const STATE_TIMEOUT_MS = 30_000;
const FIELD_TIMEOUT_MS = 10_000;

/**
 * Kuali Build's single GraphQL endpoint and the one mutation a `Save` issues.
 * Measured live 2026-08-04 on docs 4489/4490: clicking `Save` sends exactly one
 * `submitDocumentV2` with
 * `variables = { documentId, data, actionId, status:"saved", timeZone }`, where
 * `data` is the WHOLE document model keyed by `formKey`.
 */
const KUALI_GRAPHQL_PATH = "/app/api/v0/graphql";
const KUALI_SUBMIT_OPERATION = "submitDocumentV2";

/**
 * How long the model-commit barrier and the save-payload observation may wait.
 * Both are bounded waits for a SPECIFIC fact, and both throw when the fact does
 * not arrive — neither ever proceeds on a timeout.
 */
const MODEL_COMMIT_TIMEOUT_MS = 20_000;
const SUBMIT_OBSERVE_TIMEOUT_MS = 30_000;

/** The private marker the model-commit barrier stamps on the staged control. */
const STAGED_PROPS_MARKER = "__hrautoStagedProps";

/**
 * DRIVER-INTERNAL controls: live-verified 2026-08-12, and deliberately NOT
 * registry elements.
 *
 * Every one of these is a real control on the live separation form that legacy
 * has **no selector key for** — `separationForm` stops at six fields and never
 * grew Division, Employee Type, Student Title Code, the optional comments box,
 * or three of the four Final Pay radios. Publishing them in the UI registry
 * would mean inventing a `provenance` row that names a legacy key, blob and
 * line that do not exist, and a fabricated port row is worse than an
 * unpublished one. `new-kronos` set this rule for `#combo_inptxt` and the
 * timecard grid; this follows it.
 *
 * They are listed together rather than inline so a future porter finds the
 * whole set in one place, and each is resolved through `exactlyOneInternal`,
 * which re-asserts the exactly-one count on every read — the same discipline
 * the registry elements get.
 *
 * All names are the EXACT live accessible names, counted at one node each on
 * documents 4510 / 4502 / 4495.
 */
const INTERNAL_DIVISION_FIELD = "Division*";
const INTERNAL_EMPLOYEE_TYPE_FIELD = "Employee Type*";
const INTERNAL_STUDENT_TITLE_CODE_FIELD = "Student Title Code*";
const INTERNAL_ADDITIONAL_COMMENTS_FIELD = "Additional Separation Comments (Optional)";
const INTERNAL_FINAL_PAY_SUBMITTED = "Submitted Final Pay Request";
const INTERNAL_FINAL_PAY_TRANSFER = "Does not need Final Pay (transfer employee)";
const INTERNAL_FINAL_PAY_OTHER = "Other";

/**
 * The Final Pay group's COMPLETE option list, in DOM order (§3.2). It is a
 * constant rather than a live read because a radio group has no option list to
 * enumerate — the four labels ARE the four controls, each of which is resolved
 * and read on every visit, so a fifth option would surface as a run that reads
 * four radios on a form that renders five.
 */
const FINAL_PAY_OPTION_LABELS: readonly string[] = Object.freeze([
  INTERNAL_FINAL_PAY_SUBMITTED,
  "Does not need Final Pay (student employee)",
  INTERNAL_FINAL_PAY_TRANSFER,
  INTERNAL_FINAL_PAY_OTHER,
]);

function elementRecipe(id: ElementId) {
  const element = KUALI_UI_REGISTRY.elements.find((candidate) => candidate.id === id);
  if (element === undefined) throw new Error(`Kuali UI registry has no element ${id}`);
  return element.locator;
}

/**
 * Resolve a registry element to exactly one live node. Zero matches and two+
 * matches are both loud failures: on this page, "pick the first" is how a
 * `Save` fallback would reach `Send Back`.
 */
async function exactlyOne(page: Page, id: ElementId): Promise<Locator> {
  const recipe = elementRecipe(id);
  const locator = page.getByRole(recipe.role, { name: recipe.name, exact: recipe.exact });
  try {
    await locator.first().waitFor({ state: "visible", timeout: FIELD_TIMEOUT_MS });
  } catch (error) {
    // Not a swallow: an element that never renders is a page we cannot act on,
    // and the count check below would report "0" without saying why.
    throw new Error(
      `Kuali ${id} never became visible for role="${recipe.role}" name="${recipe.name}" within `
      + `${String(FIELD_TIMEOUT_MS)}ms; refusing to act on a page that does not show it`,
      { cause: error },
    );
  }
  const count = await locator.count();
  if (count !== 1) {
    throw new Error(
      `Kuali ${id} resolved ${String(count)} nodes for role="${recipe.role}" name="${recipe.name}"; `
      + "exactly one is required and there is no fallback — refusing to act on an ambiguous page",
    );
  }
  return locator;
}

function documentUrl(actionId: string): string {
  return `https://${KUALI_HOST}/build/space/${KUALI_RRSS_SPACE_ID}/actions/${actionId}`;
}

/**
 * Prove the browser is on the expected document. Kuali redirects
 * `…/actions/<id>` to `…/actions/<id>/view`, and a stale action id silently
 * lands on the Action List instead of a form — verified live 2026-08-04, when
 * doc 4453's 2026-07-23 action id did exactly that. So the URL check accepts
 * the redirect and the heading check proves the document number independently.
 */
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

/**
 * A level-1 heading whose accessible name is a bare document number.
 *
 * NOT a widening of "the first h1" — a narrowing, and the reason is live
 * measurement (2026-08-04, doc 4489). Kuali Build is client-rendered and paints
 * this route in three stages:
 *
 * | t (after `domcontentloaded`) | level-1 headings |
 * |---|---|
 * | ~0.4s | none at all |
 * | ~1.5s | `["", "Action", "Action List"]` — the document heading exists and is EMPTY |
 * | ~3.0s | `["4489", "Action", "Action List"]` |
 *
 * So "the first h1" is the right node but reads `""` for a second and a half,
 * and "the first NON-EMPTY h1" is the wrong node ("Action") during that window.
 * Both would have refused a perfectly good document. Matching on the shape of
 * the value itself is the only recipe that is correct at every stage, and it is
 * still an independent READ: the number is read off the page and compared to
 * the run's, so opening a different document refuses with both numbers named.
 */
const DOCUMENT_NUMBER_HEADING_NAME = /^\s*\d{3,8}\s*$/u;

type DocumentNumberProbe =
  | { readonly state: "read"; readonly documentNumber: string }
  | { readonly state: "unavailable"; readonly reason: string };

/**
 * Probe the document-number heading. Every negative is a stated REASON, so both
 * callers can decide what to do with it: `openDocument` throws (its callers are
 * mid-write and must not continue), and the separation read reports
 * `document-unavailable` as data so a failed run records WHY.
 */
async function probeDocumentNumberHeading(page: Page, actionId: string): Promise<DocumentNumberProbe> {
  const heading = page.getByRole("heading", { level: 1, name: DOCUMENT_NUMBER_HEADING_NAME });
  // A BOUNDED WAIT FOR THE SAME FACT, not a fallback: when no document-number
  // heading renders inside the bound, the identical refusal below still fires.
  try {
    await heading.first().waitFor({ state: "attached", timeout: STATE_TIMEOUT_MS });
  } catch {
    // Not a swallow: the timeout IS the observation, and the count check turns
    // it into the loud refusal an immediately-absent heading produced.
  }
  const count = await heading.count();
  if (count === 0) {
    return {
      state: "unavailable",
      reason: `Kuali action ${actionId} did not render a document-number heading within `
        + `${String(STATE_TIMEOUT_MS)}ms; the action id may be stale (a completed step redirects to the `
        + "Action List) — refusing to treat this page as a document",
    };
  }
  if (count !== 1) {
    return {
      state: "unavailable",
      reason: `Kuali action ${actionId} rendered ${String(count)} document-number headings; exactly one is `
        + "required and there is no fallback — refusing to identify an ambiguous page",
    };
  }
  const raw = await heading.textContent({ timeout: STATE_TIMEOUT_MS });
  const trimmed = (raw ?? "").trim();
  const parsed = KualiDocumentNumberSchema.safeParse(trimmed);
  if (!parsed.success) {
    return {
      state: "unavailable",
      reason: `Kuali action ${actionId} heading "${trimmed}" is not a document number`,
    };
  }
  return { state: "read", documentNumber: parsed.data };
}

async function readDocumentNumberHeading(page: Page, actionId: string): Promise<string> {
  const probe = await probeDocumentNumberHeading(page, actionId);
  if (probe.state === "unavailable") throw new Error(probe.reason);
  return probe.documentNumber;
}

/**
 * The `submitDocumentV2` variables, as observed on the wire 2026-08-04. `data`
 * is deliberately typed as unknown-valued: this driver asserts on exactly one
 * key and must never re-interpret the rest of the operator's document.
 */
const SubmitVariablesSchema = z.object({
  actionId: z.string().min(1),
  documentId: z.string().min(1),
  data: z.record(z.string(), z.unknown()),
});

/**
 * The `submitDocumentV2` answer, as observed on the wire 2026-08-04 for a save
 * that DID persist: `{"data":{"submitDocumentV2":{"status":"Ok","validations":null,…}}}`.
 * Only the refusal-bearing fields are named; the rest of Kuali's payload is not
 * this driver's business.
 */
const SubmitResponseSchema = z.object({
  errors: z.array(z.object({ message: z.string() }).loose()).optional(),
  data: z.object({
    submitDocumentV2: z.object({
      status: z.string(),
      validations: z.unknown(),
    }).loose().nullish(),
  }).loose().nullish(),
});

/**
 * What the last successful staging on the page proved, retained so `commit` can
 * check the save's payload against it.
 *
 * It is a UNION because this store now has two write families that both click
 * the same one `Save` button. `commit` receives only an element id and a
 * capability, so without this it would have nothing to compare — and a Save
 * clicked with no staging behind it is exactly the no-op write the 2026-08-04
 * attempt performed.
 */
type StagedExpectation =
  | Readonly<{
    kind: "timekeeper";
    actionId: string;
    documentNumber: string;
    timekeeperName: string;
  }>
  | Readonly<{
    kind: "finalization";
    actionId: string;
    documentNumber: string;
    fields: KualiFinalizationFields;
  }>;

/** Every Kuali input read trims; a padded value is the norm, not an anomaly. */
async function readTrimmedInput(page: Page, id: ElementId): Promise<string> {
  const locator = await exactlyOne(page, id);
  const raw = await locator.inputValue({ timeout: FIELD_TIMEOUT_MS });
  return raw.trim();
}

async function readDisplayedEid(page: Page): Promise<string> {
  const value = await readTrimmedInput(page, KUALI_RRSS_EID_FIELD);
  const parsed = EidSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `Kuali document displays "${value.slice(0, 4)}…" in the EID field, which is not a UCPath EID; `
      + "refusing to bind a subject to an unreadable identifier",
    );
  }
  return parsed.data;
}

/**
 * Wait until Kuali's DOCUMENT MODEL has taken the typed value — the barrier the
 * 2026-08-04 controlled attempt was missing, and the whole reason that attempt
 * saved nothing.
 *
 * A Kuali Build `Textarea` gadget is a controlled React input over LOCAL state.
 * Typing updates the DOM and the gadget's own props immediately, but the value
 * only reaches the document model — the `data` map `submitDocumentV2`
 * serializes — after a debounce. Measured live on doc 4489 (zero-write: every
 * mutation intercepted and aborted, so the payload was read without being
 * sent):
 *
 * | settle after last keystroke | staged value present in `data` |
 * |---|---|
 * | 300 / 400 / 400 / 500 / 500 / 600 / 600 / 600 ms | **0 of 8** |
 * | 700 / 700 / 750 / 750 / 800 / 800 / 900 / 1000 ms | **8 of 8** |
 *
 * Sleeping past that is neither allowed here nor honest, so this waits for the
 * commit ITSELF. A 3s attribute-level sample of the control found exactly one
 * change in the whole window — at **+723ms**, the control's React props OBJECT
 * IDENTITY was replaced (its attributes, classes, DOM value and the section's
 * markup were all byte-identical before and after). That replacement is the
 * parent re-render the model update causes, and it is the only observable this
 * page offers. So: stamp the current props object, then wait for a different
 * one.
 *
 * A page that never renders React internals, or never re-renders, is a page we
 * cannot prove staged — both throw. The barrier is not the proof either: the
 * commit re-checks the value on the wire, so an early or spurious re-render
 * cannot turn into a save that silently drops the field.
 */
async function awaitModelCommit(
  page: Page,
  handle: ElementHandle<SVGElement | HTMLElement>,
  documentNumber: string,
): Promise<void> {
  await stampModelProps(handle, documentNumber, "timekeeper");
  await awaitModelPropsReplaced(page, handle, documentNumber, "timekeeper");
}

/**
 * Half one of the model-commit barrier: remember the control's CURRENT React
 * props object so a later replacement is observable.
 *
 * Splitting the barrier in two is what lets a caller stamp BEFORE it acts. The
 * timekeeper path stamps after typing and is safe there only because the gadget
 * debounces ~723 ms; a control that commits INSTANTLY (a select, a checkbox, a
 * radio) can re-render before a post-hoc stamp runs, and then a wait for "a
 * different props object" would time out on a staging that actually worked.
 * Every finalization control is therefore stamped first and awaited after.
 */
async function stampModelProps(
  handle: ElementHandle<SVGElement | HTMLElement>,
  documentNumber: string,
  what: string,
): Promise<void> {
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
}

/** Half two: wait for the parent re-render that the model update causes. */
async function awaitModelPropsReplaced(
  page: Page,
  handle: ElementHandle<SVGElement | HTMLElement>,
  documentNumber: string,
  what: string,
): Promise<void> {
  try {
    await page.waitForFunction((bound: { node: SVGElement | HTMLElement; marker: string }) => {
      const element = bound.node as unknown as Record<string, unknown>;
      const propsKey = Object.keys(element).find((key) => key.startsWith("__reactProps"));
      if (propsKey === undefined) return false;
      const previous = element[bound.marker];
      return previous !== undefined && element[propsKey] !== previous;
    }, { node: handle, marker: STAGED_PROPS_MARKER }, { timeout: MODEL_COMMIT_TIMEOUT_MS, polling: 50 });
  } catch (error) {
    // Not a swallow: the timeout IS the observation that the model never took
    // the value, and continuing would click Save on a payload without it.
    throw new Error(
      `Kuali document ${documentNumber} did not commit the staged ${what} value into its document model `
      + `within ${String(MODEL_COMMIT_TIMEOUT_MS)}ms (measured commit point: ~723ms after the last `
      + "keystroke); refusing to reach the fence",
      { cause: error },
    );
  }
}

/**
 * The save's WIRE PROOF: the exact `submitDocumentV2` the click issued must
 * carry the staged value under the timekeeper's `formKey`, for this action id.
 *
 * This is what makes the model-commit barrier verified rather than assumed. It
 * is still not landing proof — Kuali answers `200` and renders `Form saved` for
 * a mutation that carried nothing of this field, which is precisely how the
 * 2026-08-04 attempt produced a false positive. Only the reload read-back can
 * say the value persisted.
 */
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

/**
 * The `(formKey, value)` pairs the save's `data` map must carry for THIS
 * staging.
 *
 * ## The finalization asserts FIVE of twelve, and that is stated, not hidden
 *
 * Ten of the twelve `formKey`s are known since chunk 5c's live capture
 * (2026-08-14, §9.12) — the two §4e's 2026-08-14 amendment added have never been
 * observed and are `null` — but a key is not an expectation either.
 * `submitDocumentV2` sends the document MODEL,
 * and only a `Text`/`Textarea` gadget holds the staged string there: a `Date`
 * holds epoch milliseconds, a `Dropdown`/`Radios` holds `{id,label}` and
 * `Checkboxes` holds an array of them — all four observed live on real docs
 * 4510/4495/4502. Deriving those expected values needs a transformation this
 * repository has never seen on the WRITE wire, plus an option-id table Kuali can
 * republish, so asserting them would be a check that can only fail — the same
 * "write the expectation, then pass" hazard D132 bans, pointed the other way.
 * `KUALI_RRSS_FINALIZATION_WIRE_ASSERTED` names the five that are derivable and
 * `kualiFinalizationWireUnasserted()` names the seven it does not check. Every
 * `formKey` is now known (§9.16 captured the last two), so the residue is purely
 * about SHAPE: the controlled commit closes it by OBSERVING the payload.
 *
 * That does **not** weaken the write's landing proof, because this check never
 * was the proof: `submitDocumentV2` answers `{"status":"Ok","validations":null}`
 * for a mutation that dropped a field entirely, so the ONLY thing that can turn
 * a Kuali save into `done` is `readSavedSeparationFinalization`'s reload
 * read-back — and that compares all twelve fields.
 */
function stagedWireValues(expected: StagedExpectation): readonly (readonly [string, unknown])[] {
  if (expected.kind === "timekeeper") {
    return [[KUALI_RRSS_TIMEKEEPER_FORM_KEY, expected.timekeeperName]];
  }
  const pairs: (readonly [string, unknown])[] = [];
  for (const field of KUALI_FINALIZATION_FIELD_NAMES) {
    if (!KUALI_RRSS_FINALIZATION_WIRE_ASSERTED.includes(field)) continue;
    const formKey = KUALI_RRSS_FINALIZATION_FORM_KEYS[field];
    // No field carries `null` today (§9.16 captured the last two), so this is
    // unreachable. It stays because the table's type still admits `null` for a
    // field added before its key is captured, and it throws rather than silently
    // indexing `data[undefined]` — which would turn a landed save into a
    // post-fence park the day somebody asserts such a field.
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

/**
 * A NEGATIVE check on the save's answer, never a positive one.
 *
 * GraphQL answers HTTP 200 for refusals too — the errors ride in the body — so
 * a `200` says nothing at all. This looks only for a stated refusal: a
 * transport failure, a GraphQL `errors` array, a `status` other than `Ok`, or a
 * non-null `validations`. Passing it does NOT mean the value persisted; the
 * mutation that dropped the field entirely also answered
 * `{"status":"Ok","validations":null}`. Landing proof remains the reload
 * read-back, and nothing here may substitute for it.
 */
async function assertSubmitNotRefused(response: Response, documentNumber: string): Promise<void> {
  if (!response.ok()) {
    throw new Error(
      `Kuali answered HTTP ${String(response.status())} to the save on document ${documentNumber}; `
      + "the write was refused at the transport level",
    );
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
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
}

/**
 * Kuali's document route sets `document.title` to `Form - <form name> - Kuali`
 * (live 2026-08-12, docs 4510/4502/4495). It is the ONLY unambiguous read of
 * the form's own name on this page: the same string also renders in the space's
 * app list and in every Action-List row, so a page-wide text match would hit
 * several nodes on a page that is not even showing a document.
 */
const DOCUMENT_TITLE_FORM_NAME = /^Form - (.+) - Kuali$/u;

/**
 * Read the form's name off the document title, bounded.
 *
 * A BOUNDED WAIT FOR THE SAME FACT, never a fallback: the title arrives with
 * the rest of the route (measured 2026-08-12 — no headings at ~7ms, an EMPTY
 * document heading at ~258ms, the real number AND the title AND the form
 * controls together at ~1.77s), so sampling once races the paint. When it never
 * takes the shape, this returns the title verbatim and the caller refuses with
 * it quoted — it never proceeds on an unknown page.
 */
async function readDocumentFormType(page: Page): Promise<
  { readonly state: "read"; readonly formType: string }
  | { readonly state: "unreadable"; readonly observedTitle: string }
> {
  try {
    await page.waitForFunction(
      (pattern: string) => new RegExp(pattern, "u").test(document.title),
      DOCUMENT_TITLE_FORM_NAME.source,
      { timeout: STATE_TIMEOUT_MS, polling: 100 },
    );
  } catch {
    // Not a swallow: the timeout IS the observation, and the check below turns
    // it into a refusal that quotes whatever the page actually titled itself.
  }
  const title = await page.title();
  const matched = DOCUMENT_TITLE_FORM_NAME.exec(title);
  const formType = matched?.[1]?.trim();
  if (formType === undefined || formType.length === 0) {
    return { state: "unreadable", observedTitle: title };
  }
  return { state: "read", formType };
}

async function waitForDocumentReady(page: Page, actionId: string): Promise<string> {
  assertExactKualiDocumentUrl(page.url(), actionId);
  const documentNumber = await readDocumentNumberHeading(page, actionId);
  await exactlyOne(page, KUALI_RRSS_EID_FIELD);
  return documentNumber;
}

export function createKualiRrssDocumentDriver(page: Page, clock: Clock): KualiRrssDocumentDriver {
  // The ONE time source (doc 11): every observation instant this driver stamps
  // comes from the injected clock, never from `new Date()`.
  const now = (): string => IsoInstantSchema.parse(clock.now().toISOString());

  /** See `StagedExpectation` — the staging this page's `Save` may act on, if any. */
  let staged: StagedExpectation | undefined;

  async function openDocument(input: Readonly<{
    actionId: string;
    documentNumber: string;
  }>): Promise<KualiDocumentView> {
    const actionId = KualiActionIdSchema.parse(input.actionId);
    const expectedNumber = KualiDocumentNumberSchema.parse(input.documentNumber);
    // A navigation discards Kuali's in-page form model, so anything staged
    // before it is gone. Dropping the retained expectation here is what stops a
    // reload read-back from leaving a `commit` able to click on stale grounds.
    staged = undefined;
    await page.goto(documentUrl(actionId), {
      waitUntil: "domcontentloaded",
      timeout: NAVIGATION_TIMEOUT_MS,
    });
    const observedNumber = await waitForDocumentReady(page, actionId);
    if (observedNumber !== expectedNumber) {
      throw new Error(
        `Kuali action ${actionId} opened document ${observedNumber}, but the run named ${expectedNumber}; `
        + "action ids are not stable across workflow steps — refusing to act on a different document",
      );
    }
    return KualiDocumentViewSchema.parse({
      pageStateId: KUALI_RRSS_DOCUMENT_READY,
      actionId,
      documentNumber: observedNumber,
      observedEid: await readDisplayedEid(page),
      currentTimekeeperName: await readTrimmedInput(page, KUALI_RRSS_TIMEKEEPER_FIELD),
      observedAt: now(),
    });
  }

  /* ── The separation-document read (2i chunk 2) ─────────────────────────── */

  /** A `<select>`: its selected option text and its COMPLETE option list (§3.2). */
  async function readSelect(id: ElementId): Promise<{
    readonly selected: string;
    readonly options: readonly string[];
  }> {
    const locator = await exactlyOne(page, id);
    const read = await locator.evaluate((node) => {
      const select = node as HTMLSelectElement;
      const options = Array.from(select.options).map((option) => option.text);
      const selected = select.options[select.selectedIndex]?.text;
      return { selected, options };
    });
    if (read.selected === undefined) {
      // Legacy refuses here too (S12) and that refusal is worth keeping: a
      // select whose selectedIndex names no option is a control we cannot read,
      // and guessing "the first one" would file a reason code nobody chose.
      throw new Error(
        `Kuali ${id} has no option text at its selected index; refusing to guess which option is chosen`,
      );
    }
    return { selected: read.selected.trim(), options: read.options.map((option) => option.trim()) };
  }

  async function readCheckbox(id: ElementId): Promise<boolean> {
    const locator = await exactlyOne(page, id);
    return locator.isChecked({ timeout: FIELD_TIMEOUT_MS });
  }

  /**
   * A driver-internal control: one the live form carries and legacy has NO
   * selector key for, so publishing it as a registry element would fabricate
   * provenance (the rule `new-kronos` set for `#combo_inptxt`). Each name below
   * was counted at EXACTLY ONE node on the live 2026-08-12 accessibility tree
   * of documents 4510/4502/4495, and the count is re-asserted here per read.
   */
  async function exactlyOneInternal(
    role: "textbox" | "combobox" | "radio",
    name: string,
  ): Promise<Locator> {
    const locator = page.getByRole(role, { name, exact: true });
    try {
      await locator.first().waitFor({ state: "attached", timeout: FIELD_TIMEOUT_MS });
    } catch (error) {
      throw new Error(
        `Kuali driver-internal control role="${role}" name="${name}" never attached within `
        + `${String(FIELD_TIMEOUT_MS)}ms; refusing to read a document that does not show it`,
        { cause: error },
      );
    }
    const count = await locator.count();
    if (count !== 1) {
      throw new Error(
        `Kuali driver-internal control role="${role}" name="${name}" resolved ${String(count)} nodes; `
        + "exactly one is required and there is no fallback",
      );
    }
    return locator;
  }

  async function readInternalText(name: string): Promise<string> {
    const locator = await exactlyOneInternal("textbox", name);
    return (await locator.inputValue({ timeout: FIELD_TIMEOUT_MS })).trim();
  }

  async function readInternalSelect(name: string): Promise<{
    readonly selected: string;
    readonly options: readonly string[];
  }> {
    const locator = await exactlyOneInternal("combobox", name);
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
    await page.goto(documentUrl(actionId), {
      waitUntil: "domcontentloaded",
      timeout: NAVIGATION_TIMEOUT_MS,
    });
    assertExactKualiDocumentUrl(page.url(), actionId);

    const heading = await probeDocumentNumberHeading(page, actionId);
    if (heading.state === "unavailable") {
      return KualiSeparationDocumentReadSchema.parse({
        state: "document-unavailable",
        actionId,
        observedUrl: page.url(),
        reason: heading.reason,
        observedAt: now(),
      });
    }
    if (heading.documentNumber !== expectedNumber) {
      return KualiSeparationDocumentReadSchema.parse({
        state: "document-number-mismatch",
        actionId,
        expectedNumber,
        observedNumber: heading.documentNumber,
        observedAt: now(),
      });
    }

    // S2, answered BEFORE a single field is read: legacy discovers a
    // non-separation document as a 5s locator timeout on the employee-name
    // field, which is indistinguishable from a slow page.
    const formType = await readDocumentFormType(page);
    if (formType.state === "unreadable") {
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
      return KualiSeparationDocumentReadSchema.parse({
        state: "not-a-separation-document",
        actionId,
        documentNumber: heading.documentNumber,
        observedFormType: formType.formType,
        observedAt: now(),
      });
    }

    const rawEid = await readTrimmedInput(page, KUALI_RRSS_EID_FIELD);
    const parsedEid = rawEid.length === 0 ? undefined : EidSchema.safeParse(rawEid);
    if (parsedEid !== undefined && !parsedEid.success) {
      return KualiSeparationDocumentReadSchema.parse({
        state: "unreadable-eid",
        actionId,
        documentNumber: heading.documentNumber,
        raw: rawEid,
        observedAt: now(),
      });
    }

    const dates: { field: "lastDayWorked" | "separationDate" | "terminationEffectiveDate"; raw: string }[] = [
      { field: "lastDayWorked", raw: await readTrimmedInput(page, KUALI_RRSS_LAST_DAY_WORKED_FIELD) },
      { field: "separationDate", raw: await readTrimmedInput(page, KUALI_RRSS_SEPARATION_DATE_FIELD) },
      {
        field: "terminationEffectiveDate",
        raw: await readTrimmedInput(page, KUALI_RRSS_TERMINATION_EFF_DATE_FIELD),
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

    const terminationType = await readSelect(KUALI_RRSS_TERMINATION_TYPE_FIELD);
    const department = await readSelect(KUALI_RRSS_DEPARTMENT_FIELD);
    const division = await readInternalSelect(INTERNAL_DIVISION_FIELD);
    const employeeType = await readInternalSelect(INTERNAL_EMPLOYEE_TYPE_FIELD);
    const studentTitleCode = await readInternalSelect(INTERNAL_STUDENT_TITLE_CODE_FIELD);

    const rawTransactionNumber = await readTrimmedInput(page, KUALI_RRSS_TRANSACTION_NUMBER_FIELD);
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

    // The final-pay group: ONE registry element (the only radio legacy has a
    // key for) plus its three live siblings, read driver-internally. It is the
    // SAME implementation the finalization read-back uses, so the two families
    // cannot disagree about what the document carries.
    const finalPayChoice = await readFinalPayChoice(heading.documentNumber);

    return KualiSeparationDocumentReadSchema.parse({
      state: "read",
      document: KualiSeparationDocumentSchema.parse({
        pageStateId: KUALI_RRSS_SEPARATION_READY,
        actionId,
        documentNumber: heading.documentNumber,
        formType: { observed: formType.formType, matches: true },
        employee: {
          name: textField(await readTrimmedInput(page, KUALI_RRSS_EMPLOYEE_NAME_FIELD)),
          eid: parsedEid === undefined || !parsedEid.success
            ? { state: "absent", reason: "the EID control is present on the form and holds no value" }
            : { state: "present", value: parsedEid.data },
          employeeType: optionField(employeeType.selected),
          studentTitleCode: optionField(studentTitleCode.selected),
          division: optionField(division.selected),
          location: textField(await readTrimmedInput(page, KUALI_RRSS_LOCATION_FIELD)),
        },
        separation: {
          terminationType: optionField(terminationType.selected),
          lastDayWorked: dateField("lastDayWorked"),
          separationDate: dateField("separationDate"),
          additionalComments: textField(await readInternalText(INTERNAL_ADDITIONAL_COMMENTS_FIELD)),
        },
        timekeeper: {
          requestAcknowledged: await readCheckbox(KUALI_RRSS_REQUEST_ACKNOWLEDGED_CHECKBOX),
          name: textField(await readTrimmedInput(page, KUALI_RRSS_TIMEKEEPER_FIELD)),
          comments: textField(await readTrimmedInput(page, KUALI_RRSS_TIMEKEEPER_COMMENTS_FIELD)),
        },
        finalTransactions: {
          terminationEffectiveDate: dateField("terminationEffectiveDate"),
          department: optionField(department.selected),
          payrollTitleCode: textField(await readTrimmedInput(page, KUALI_RRSS_PAYROLL_TITLE_CODE_FIELD)),
          payrollTitle: textField(await readTrimmedInput(page, KUALI_RRSS_PAYROLL_TITLE_FIELD)),
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
  }

  async function stageTimekeeperName(input: Readonly<{
    actionId: string;
    documentNumber: string;
    timekeeperName: string;
  }>): Promise<KualiTimekeeperStaging> {
    const timekeeperName = KualiTimekeeperNameSchema.parse(input.timekeeperName);
    staged = undefined;
    const view = await openDocument(input);
    const field = await exactlyOne(page, KUALI_RRSS_TIMEKEEPER_FIELD);
    await field.fill(timekeeperName, { timeout: FIELD_TIMEOUT_MS });
    // `fillWithVerify` (legacy navigate.ts:16-39): Kuali controls silently drop
    // a `fill()` often enough that an unverified staging is worthless. One
    // retry through key events, then throw — never "assume it took".
    let displayed = await readTrimmedInput(page, KUALI_RRSS_TIMEKEEPER_FIELD);
    if (displayed !== timekeeperName) {
      await field.clear({ timeout: FIELD_TIMEOUT_MS });
      await field.pressSequentially(timekeeperName, { delay: 30, timeout: FIELD_TIMEOUT_MS });
      displayed = await readTrimmedInput(page, KUALI_RRSS_TIMEKEEPER_FIELD);
    }
    if (displayed !== timekeeperName) {
      throw new Error(
        `Kuali document ${view.documentNumber} did not accept the staged timekeeper value; `
        + "the field reads back differently after two attempts — refusing to reach the fence",
      );
    }
    // The DOM having the value is NOT the same as Kuali having it: the gadget
    // debounces into the document model, and only what is in the model reaches
    // the save mutation. Wait for the commit before anything may fence.
    const handle = await field.elementHandle({ timeout: FIELD_TIMEOUT_MS });
    if (handle === null) {
      throw new Error(
        `Kuali document ${view.documentNumber} lost the timekeeper control between staging and the `
        + "model-commit barrier; refusing to reach the fence",
      );
    }
    try {
      await awaitModelCommit(page, handle, view.documentNumber);
    } finally {
      await handle.dispose();
    }
    // The commit must not have rewritten the control — a model that took a
    // DIFFERENT value than we typed is a staging we cannot stand behind.
    const settled = await readTrimmedInput(page, KUALI_RRSS_TIMEKEEPER_FIELD);
    if (settled !== timekeeperName) {
      throw new Error(
        `Kuali document ${view.documentNumber} shows ${JSON.stringify(settled)} in the timekeeper field `
        + `after its model commit, not the staged ${JSON.stringify(timekeeperName)}; refusing to reach the fence`,
      );
    }
    // The Save button must already resolve uniquely BEFORE the fence: a page
    // that cannot name exactly one Save is a page we must not fence on.
    await exactlyOne(page, KUALI_RRSS_SAVE_BUTTON);
    staged = {
      kind: "timekeeper",
      actionId: view.actionId,
      documentNumber: view.documentNumber,
      timekeeperName,
    };
    return KualiTimekeeperStagingSchema.parse({
      pageStateId: KUALI_RRSS_TIMEKEEPER_STAGED,
      actionId: view.actionId,
      documentNumber: view.documentNumber,
      observedEid: view.observedEid,
      previousTimekeeperName: view.currentTimekeeperName,
      stagedTimekeeperName: settled,
      observedAt: now(),
    });
  }

  async function readSavedTimekeeper(input: Readonly<{
    actionId: string;
    documentNumber: string;
    timekeeperName: string;
  }>): Promise<KualiTimekeeperReadBack> {
    const expected = KualiTimekeeperNameSchema.parse(input.timekeeperName);
    try {
      // The reload IS the proof mechanism. Reading the in-memory field would
      // report the staged value whether or not the save landed.
      await page.reload({ waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
      const view = await openDocument(input);
      if (view.currentTimekeeperName === expected) {
        return KualiTimekeeperReadBackSchema.parse({
          state: "present",
          proof: KualiSavedTimekeeperProofSchema.parse({
            kind: "kuali-saved-timekeeper",
            actionId: view.actionId,
            documentNumber: view.documentNumber,
            timekeeperName: expected,
            observedEid: view.observedEid,
            source: "reload-read-back",
          }),
          observedAt: now(),
        });
      }
      return KualiTimekeeperReadBackSchema.parse({
        state: "absent",
        actionId: view.actionId,
        documentNumber: view.documentNumber,
        observedEid: view.observedEid,
        observedTimekeeperName: view.currentTimekeeperName,
        observedAt: now(),
      });
    } catch (error) {
      // A failed check is NOT "found nothing". Everything that throws becomes
      // `unknown`, which parks — it can never become retry authority.
      return KualiTimekeeperReadBackSchema.parse({
        state: "unknown",
        reason: `Kuali reload read-back failed: ${error instanceof Error ? error.message : "non-Error thrown"}`,
        observedAt: now(),
      });
    }
  }

  /* ── The finalization write (chunk 5) ──────────────────────────────────── */

  /**
   * The one place the Final Pay radio group is read, shared by the separation
   * read and the finalization read-back.
   *
   * Two selections at once is a page we cannot describe, so it throws rather
   * than picking one — and `undefined` (no radio checked) is a REAL state, seen
   * live on documents 4502 and 4495.
   */
  async function readFinalPayChoice(documentNumber: string): Promise<KualiFinalPayChoice | undefined> {
    const checks: readonly (readonly [KualiFinalPayChoice, boolean])[] = [
      ["submitted-final-pay-request",
        await (await exactlyOneInternal("radio", INTERNAL_FINAL_PAY_SUBMITTED)).isChecked({ timeout: FIELD_TIMEOUT_MS })],
      ["does-not-need-final-pay-student", await readCheckbox(KUALI_RRSS_FINAL_PAY_STUDENT_RADIO)],
      ["does-not-need-final-pay-transfer",
        await (await exactlyOneInternal("radio", INTERNAL_FINAL_PAY_TRANSFER)).isChecked({ timeout: FIELD_TIMEOUT_MS })],
      ["other",
        await (await exactlyOneInternal("radio", INTERNAL_FINAL_PAY_OTHER)).isChecked({ timeout: FIELD_TIMEOUT_MS })],
    ];
    const selected = checks.filter(([, checked]) => checked);
    if (selected.length > 1) {
      throw new Error(
        `Kuali document ${documentNumber} reports ${String(selected.length)} Final Pay radios checked at `
        + "once; a radio group with two selections is a page we cannot describe",
      );
    }
    return selected[0]?.[0];
  }

  /**
   * The twelve finalization controls, read exactly as the page holds them, plus
   * the department control's COMPLETE option list (§3.2).
   *
   * Nothing here parses or classifies: an unset select reads `- - -` and an
   * empty control reads `""`, because the comparison against the staged fields
   * is what decides meaning. A read that normalised `- - -` to "absent" would
   * make "the department did not save" and "the department saved as the
   * sentinel" the same fact.
   */
  async function readFinalizationFields(documentNumber: string): Promise<{
    readonly fields: KualiObservedFinalizationFields;
    readonly departmentOptions: readonly string[];
  }> {
    const department = await readSelect(KUALI_RRSS_DEPARTMENT_FIELD);
    const finalPay = await readFinalPayChoice(documentNumber);
    return {
      fields: KualiObservedFinalizationFieldsSchema.parse({
        department: department.selected,
        payrollTitleCode: await readTrimmedInput(page, KUALI_RRSS_PAYROLL_TITLE_CODE_FIELD),
        payrollTitle: await readTrimmedInput(page, KUALI_RRSS_PAYROLL_TITLE_FIELD),
        requestAcknowledged: await readCheckbox(KUALI_RRSS_REQUEST_ACKNOWLEDGED_CHECKBOX),
        timekeeperName: await readTrimmedInput(page, KUALI_RRSS_TIMEKEEPER_FIELD),
        // §4e's 2026-08-14 amendment: the two step-13 date write-backs. Read
        // through the SAME recipes the separation read uses — this surface
        // mints no element — so the read half is already live-verified; what is
        // not is writing them (see `stageSeparationFinalization`).
        lastDayWorked: await readTrimmedInput(page, KUALI_RRSS_LAST_DAY_WORKED_FIELD),
        separationDate: await readTrimmedInput(page, KUALI_RRSS_SEPARATION_DATE_FIELD),
        terminationEffectiveDate: await readTrimmedInput(page, KUALI_RRSS_TERMINATION_EFF_DATE_FIELD),
        submittedTerminationTemplate: await readCheckbox(KUALI_RRSS_SUBMITTED_TEMPLATE_CHECKBOX),
        transactionNumber: await readTrimmedInput(page, KUALI_RRSS_TRANSACTION_NUMBER_FIELD),
        finalPay: finalPay ?? null,
        timekeeperComments: await readTrimmedInput(page, KUALI_RRSS_TIMEKEEPER_COMMENTS_FIELD),
      }),
      departmentOptions: department.options,
    };
  }

  /**
   * Fill one text control, verify it read back, and wait for Kuali's document
   * model to take it.
   *
   * `fillWithVerify` (legacy `navigate.ts:16-39`): Kuali controls silently drop
   * a `fill()` often enough that an unverified staging is worthless, so one
   * retry through key events. The model barrier is stamped BEFORE the fill —
   * see `stampModelProps` — and is skipped when the control did not take the
   * value at all, because there is no model commit to wait for and the
   * field-by-field comparison at the end of staging is what reports it.
   *
   * live-verified 5c, 2026-08-14: this path staged every text control the
   * finalization writes on real doc 4524 through `executeDryRun` and read each
   * one back, in 8.06 s for all ten controls staged then (§4e's amendment has
   * since made it twelve; the two new date controls are `live-verify:
   * next-live-pass`). A hard reload then re-read the
   * document unchanged — so the staging is proved to reach React's state and
   * proved NOT to reach Kuali (§9.12, S61).
   */
  async function stageText(
    id: ElementId,
    value: string,
    what: string,
    documentNumber: string,
  ): Promise<void> {
    const field = await exactlyOne(page, id);
    const handle = await field.elementHandle({ timeout: FIELD_TIMEOUT_MS });
    if (handle === null) {
      throw new Error(
        `Kuali document ${documentNumber} lost the ${what} control while staging; refusing to reach the fence`,
      );
    }
    try {
      await stampModelProps(handle, documentNumber, what);
      await field.fill(value, { timeout: FIELD_TIMEOUT_MS });
      let displayed = (await field.inputValue({ timeout: FIELD_TIMEOUT_MS })).trim();
      if (displayed !== value) {
        await field.clear({ timeout: FIELD_TIMEOUT_MS });
        await field.pressSequentially(value, { delay: 30, timeout: FIELD_TIMEOUT_MS });
        displayed = (await field.inputValue({ timeout: FIELD_TIMEOUT_MS })).trim();
      }
      if (displayed !== value) return;
      await awaitModelPropsReplaced(page, handle, documentNumber, what);
    } finally {
      await handle.dispose();
    }
  }

  /**
   * Set one discrete control (a select, a checkbox, a radio) and wait for the
   * model commit.
   *
   * These do not debounce the way a text gadget does, which is exactly why the
   * props stamp happens before the interaction: a control that re-renders
   * instantly would otherwise be stamped AFTER its own re-render and then waited
   * on forever.
   *
   * live-verified 5c, 2026-08-14: the `Department*` select, both checkboxes and
   * the Final Pay radio all committed inside the bound on real doc 4524. The
   * stamp-first order is what made that observable instead of a timeout.
   */
  async function stageDiscrete(
    locator: Locator,
    act: () => Promise<void>,
    what: string,
    documentNumber: string,
  ): Promise<void> {
    const handle = await locator.elementHandle({ timeout: FIELD_TIMEOUT_MS });
    if (handle === null) {
      throw new Error(
        `Kuali document ${documentNumber} lost the ${what} control while staging; refusing to reach the fence`,
      );
    }
    try {
      await stampModelProps(handle, documentNumber, what);
      await act();
      await awaitModelPropsReplaced(page, handle, documentNumber, what);
    } finally {
      await handle.dispose();
    }
  }

  /** The control that carries each Final Pay choice. Only one has a legacy key. */
  async function finalPayLocator(choice: KualiFinalPayChoice): Promise<Locator> {
    if (choice === "does-not-need-final-pay-student") {
      return exactlyOne(page, KUALI_RRSS_FINAL_PAY_STUDENT_RADIO);
    }
    if (choice === "submitted-final-pay-request") {
      return exactlyOneInternal("radio", INTERNAL_FINAL_PAY_SUBMITTED);
    }
    if (choice === "does-not-need-final-pay-transfer") {
      return exactlyOneInternal("radio", INTERNAL_FINAL_PAY_TRANSFER);
    }
    return exactlyOneInternal("radio", INTERNAL_FINAL_PAY_OTHER);
  }

  async function stageSeparationFinalization(
    input: KualiFinalizationTarget,
  ): Promise<KualiFinalizationStaging> {
    const target = KualiFinalizationTargetSchema.parse(input);
    const fields = kualiFinalizationFields(target.variables);
    staged = undefined;
    const view = await openDocument({
      actionId: target.actionId,
      documentNumber: target.documentNumber,
    });
    const before = await readFinalizationFields(view.documentNumber);

    // **S56, strengthened.** The staged comments text was composed upstream from
    // a read of THIS control; if it has moved since, saving would blank an edit.
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
    const departmentControl = await exactlyOne(page, KUALI_RRSS_DEPARTMENT_FIELD);
    await stageDiscrete(
      departmentControl,
      async () => { await departmentControl.selectOption({ label: fields.department }, { timeout: FIELD_TIMEOUT_MS }); },
      "department",
      view.documentNumber,
    );
    await stageText(KUALI_RRSS_PAYROLL_TITLE_CODE_FIELD, fields.payrollTitleCode, "payroll title code", view.documentNumber);
    await stageText(KUALI_RRSS_PAYROLL_TITLE_FIELD, fields.payrollTitle, "payroll title", view.documentNumber);
    const acknowledged = await exactlyOne(page, KUALI_RRSS_REQUEST_ACKNOWLEDGED_CHECKBOX);
    await stageDiscrete(
      acknowledged,
      async () => { await acknowledged.setChecked(fields.requestAcknowledged, { timeout: FIELD_TIMEOUT_MS }); },
      "request acknowledged",
      view.documentNumber,
    );
    await stageText(KUALI_RRSS_TIMEKEEPER_FIELD, fields.timekeeperName, "timekeeper name", view.documentNumber);
    // live-verify: 6b — §4e's 2026-08-14 amendment, DISCHARGED the same day.
    // Both controls now carry `exactly-one-editable`, observed on two open
    // documents at BOTH live workflow steps (4510 / `Task 1 - Jan` and 4495 /
    // `Task 1 - Kristina & TES`): one node each, visible, editable, enabled,
    // holding the document's own date. D208's caveat — a selector mapped on a
    // read-only record is not a verified selector for the editable page — is
    // answered rather than carried. The `stageText` discipline stands anyway:
    // a control that does not take the value is reported by the field-by-field
    // read-back below, never assumed.
    await stageText(
      KUALI_RRSS_LAST_DAY_WORKED_FIELD,
      fields.lastDayWorked,
      "last day worked",
      view.documentNumber,
    );
    await stageText(
      KUALI_RRSS_SEPARATION_DATE_FIELD,
      fields.separationDate,
      "separation date",
      view.documentNumber,
    );
    await stageText(
      KUALI_RRSS_TERMINATION_EFF_DATE_FIELD,
      fields.terminationEffectiveDate,
      "termination effective date",
      view.documentNumber,
    );
    const template = await exactlyOne(page, KUALI_RRSS_SUBMITTED_TEMPLATE_CHECKBOX);
    await stageDiscrete(
      template,
      async () => { await template.setChecked(fields.submittedTerminationTemplate, { timeout: FIELD_TIMEOUT_MS }); },
      "submitted termination template",
      view.documentNumber,
    );
    await stageText(KUALI_RRSS_TRANSACTION_NUMBER_FIELD, fields.transactionNumber, "transaction number", view.documentNumber);
    const finalPay = await finalPayLocator(fields.finalPay);
    await stageDiscrete(
      finalPay,
      async () => { await finalPay.check({ timeout: FIELD_TIMEOUT_MS }); },
      "final pay radio",
      view.documentNumber,
    );
    await stageText(KUALI_RRSS_TIMEKEEPER_COMMENTS_FIELD, fields.timekeeperComments, "timekeeper comments", view.documentNumber);

    // Every control read back, against the exact staged field set.
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
    await exactlyOne(page, KUALI_RRSS_SAVE_BUTTON);
    staged = {
      kind: "finalization",
      actionId: view.actionId,
      documentNumber: view.documentNumber,
      fields,
    };
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
      await page.reload({ waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
      const view = await openDocument({
        actionId: target.actionId,
        documentNumber: target.documentNumber,
      });
      const observed = await readFinalizationFields(view.documentNumber);
      const mismatches = compareKualiFinalizationFields(expected, observed.fields);
      if (mismatches.length === 0) {
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
      // A failed check is NOT "found nothing". Everything that throws becomes
      // `unknown`, which parks — it can never become retry authority.
      return KualiFinalizationReadBackSchema.parse({
        state: "unknown",
        reason: `Kuali finalization reload read-back failed: ${error instanceof Error ? error.message : "non-Error thrown"}`,
        observedAt: now(),
      });
    }
  }

  async function read(id: ObservationId): Promise<string> {
    if (id === KUALI_RRSS_DISPLAYED_EID) return readDisplayedEid(page);
    if (id === KUALI_RRSS_DISPLAYED_TIMEKEEPER) {
      return readTrimmedInput(page, KUALI_RRSS_TIMEKEEPER_FIELD);
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
    const save = await exactlyOne(page, KUALI_RRSS_SAVE_BUTTON);
    // Arm the observation BEFORE the click: the mutation is issued within a
    // second of it, and a listener attached afterwards would race it.
    const settled = page.waitForResponse(
      (response) => response.url().includes(KUALI_GRAPHQL_PATH)
        && (response.request().postData() ?? "").includes(KUALI_SUBMIT_OPERATION),
      { timeout: SUBMIT_OBSERVE_TIMEOUT_MS },
    );
    await save.click({ timeout: FIELD_TIMEOUT_MS });
    // Legacy `clickSave` settles on `networkidle` here and calls that success.
    // This one waits for the SPECIFIC mutation to be ANSWERED instead, because
    // `networkidle` and Kuali's own `Form saved` are both true of a save that
    // dropped the field (measured 2026-08-04). Waiting for the RESPONSE — not
    // merely the request — is also what makes the verifier's reload meaningful:
    // returning at request time let the read-back reload race a save the server
    // had not applied yet, and that is exactly how a landed write was reported
    // `absent` on 2026-08-04 at 16:56. A timeout throws; a click whose outcome
    // we never saw is not a click we can describe.
    let response: Response;
    try {
      response = await settled;
    } catch (error) {
      throw new Error(
        `Kuali Save on document ${expectation.documentNumber} issued no answered ${KUALI_SUBMIT_OPERATION} `
        + `within ${String(SUBMIT_OBSERVE_TIMEOUT_MS)}ms; the click cannot be described and the outcome is unknown`,
        { cause: error },
      );
    }
    assertSubmitCarriedValue(response.request(), expectation);
    await assertSubmitNotRefused(response, expectation.documentNumber);
    return UiActionProofSchema.parse({ elementId: id, effect: "external-commit", performed: true });
  }

  const driver: KualiRrssDocumentDriver = {
    system: "kuali" as const,
    read,
    openDocument,
    readSeparationDocument,
    stageTimekeeperName,
    readSavedTimekeeper,
    stageSeparationFinalization,
    readSavedSeparationFinalization,
    commit,
  };
  return Object.freeze(z.custom<KualiRrssDocumentDriver>(() => true).parse(
    KualiRrssDocumentDriverSchema.parse(driver),
  ));
}
