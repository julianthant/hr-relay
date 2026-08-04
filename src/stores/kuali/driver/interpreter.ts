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

async function readDocumentNumberHeading(page: Page, actionId: string): Promise<string> {
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
    throw new Error(
      `Kuali action ${actionId} did not render a document-number heading within ${String(STATE_TIMEOUT_MS)}ms; `
      + "the action id may be stale (a completed step redirects to the Action List) — refusing to "
      + "treat this page as a document",
    );
  }
  if (count !== 1) {
    throw new Error(
      `Kuali action ${actionId} rendered ${String(count)} document-number headings; exactly one is `
      + "required and there is no fallback — refusing to identify an ambiguous page",
    );
  }
  const raw = await heading.textContent({ timeout: STATE_TIMEOUT_MS });
  const trimmed = (raw ?? "").trim();
  const parsed = KualiDocumentNumberSchema.safeParse(trimmed);
  if (!parsed.success) {
    throw new Error(`Kuali action ${actionId} heading "${trimmed}" is not a document number`);
  }
  return parsed.data;
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
  const stamped = await handle.evaluate((node, marker) => {
    const element = node as unknown as Record<string, unknown>;
    const propsKey = Object.keys(element).find((key) => key.startsWith("__reactProps"));
    if (propsKey === undefined) return false;
    element[marker] = element[propsKey];
    return true;
  }, STAGED_PROPS_MARKER);
  if (!stamped) {
    throw new Error(
      `Kuali document ${documentNumber} exposes no React props on the timekeeper control, so the `
      + "point at which it commits the typed value into the document model cannot be observed; "
      + "refusing to reach the fence on an unprovable staging",
    );
  }
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
      `Kuali document ${documentNumber} did not commit the staged timekeeper value into its document `
      + `model within ${String(MODEL_COMMIT_TIMEOUT_MS)}ms (measured commit point: ~723ms after the `
      + "last keystroke); refusing to reach the fence",
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
  expected: Readonly<{ actionId: string; documentNumber: string; timekeeperName: string }>,
): void {
  const raw = request.postData();
  if (raw === null) {
    throw new Error(
      `Kuali document ${expected.documentNumber} issued a ${KUALI_SUBMIT_OPERATION} with no request body; `
      + "the save cannot be proved to carry the staged timekeeper value",
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
  const sent = variables.data.data[KUALI_RRSS_TIMEKEEPER_FORM_KEY];
  if (sent !== expected.timekeeperName) {
    throw new Error(
      `Kuali save on document ${expected.documentNumber} did NOT carry the staged timekeeper value: `
      + `${KUALI_SUBMIT_OPERATION} sent ${JSON.stringify(sent ?? null)} at formKey `
      + `${KUALI_RRSS_TIMEKEEPER_FORM_KEY} instead of ${JSON.stringify(expected.timekeeperName)}. `
      + "Kuali accepts and reports success for such a save while persisting nothing of this field, so "
      + "this is reported as a failed write, not a completed one",
    );
  }
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
    throw new Error(
      `Kuali refused the save on document ${documentNumber}: `
      + parsed.data.errors.map((entry) => entry.message).join("; "),
    );
  }
  const result = parsed.data.data?.submitDocumentV2 ?? undefined;
  if (result === undefined || result === null) {
    throw new Error(
      `Kuali's answer to the save on document ${documentNumber} carried no ${KUALI_SUBMIT_OPERATION} result`,
    );
  }
  if (result.status !== "Ok") {
    throw new Error(`Kuali reported save status ${JSON.stringify(result.status)} on document ${documentNumber}`);
  }
  if (result.validations !== null && result.validations !== undefined) {
    throw new Error(
      `Kuali returned validations for the save on document ${documentNumber}: `
      + `${JSON.stringify(result.validations).slice(0, 400)}`,
    );
  }
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

  /**
   * What the last successful staging on THIS page proved, retained so `commit`
   * can check the save's payload against it. `commit` receives only an element
   * id and a capability, so without this it would have nothing to compare — and
   * a Save clicked with no staging behind it is exactly the no-op write the
   * 2026-08-04 attempt performed.
   */
  let staged: Readonly<{ actionId: string; documentNumber: string; timekeeperName: string }> | undefined;

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
    staged = { actionId: view.actionId, documentNumber: view.documentNumber, timekeeperName };
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
    stageTimekeeperName,
    readSavedTimekeeper,
    commit,
  };
  return Object.freeze(z.custom<KualiRrssDocumentDriver>(() => true).parse(
    KualiRrssDocumentDriverSchema.parse(driver),
  ));
}
