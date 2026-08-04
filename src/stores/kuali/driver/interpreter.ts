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
 *  3. **A save is never proof.** `commit` returns only that the click happened.
 *     Landing proof comes exclusively from `readSavedTimekeeper`, which
 *     RELOADS first (doc 09 §13 OQ1 (a)).
 *
 * Ported with provenance from legacy hr-automation@793abe1f8265f3213ffe8a80d6cfd9860a32a1dc:
 * `src/systems/kuali/selectors.ts` (the three recipes, via the registry),
 * `src/systems/kuali/navigate.ts:16-39` (`fillWithVerify`'s read-back-or-throw
 * discipline) and `:626-652` (`clickSave`). The deep-link open is NOT a port —
 * legacy has no URL builder and only ever reached a document through the Action
 * List search box; the `…/actions/<actionId>` shape is live-verified knowledge
 * recorded by the 2026-07-23 probe and re-verified read-only 2026-08-04.
 */
import type { Locator, Page } from "playwright";
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

async function readDocumentNumberHeading(page: Page, actionId: string): Promise<string> {
  const heading = page.getByRole("heading", { level: 1 });
  const count = await heading.count();
  if (count === 0) {
    throw new Error(
      `Kuali action ${actionId} did not render a document heading; the action id may be stale `
      + "(a completed step redirects to the Action List) — refusing to treat this page as a document",
    );
  }
  const raw = await heading.first().textContent({ timeout: STATE_TIMEOUT_MS });
  const trimmed = (raw ?? "").trim();
  const parsed = KualiDocumentNumberSchema.safeParse(trimmed);
  if (!parsed.success) {
    throw new Error(`Kuali action ${actionId} heading "${trimmed}" is not a document number`);
  }
  return parsed.data;
}

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

  async function openDocument(input: Readonly<{
    actionId: string;
    documentNumber: string;
  }>): Promise<KualiDocumentView> {
    const actionId = KualiActionIdSchema.parse(input.actionId);
    const expectedNumber = KualiDocumentNumberSchema.parse(input.documentNumber);
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
    const view = await openDocument(input);
    const field = await exactlyOne(page, KUALI_RRSS_TIMEKEEPER_FIELD);
    await field.fill(timekeeperName, { timeout: FIELD_TIMEOUT_MS });
    // `fillWithVerify` (legacy navigate.ts:16-39): Kuali controls silently drop
    // a `fill()` often enough that an unverified staging is worthless. One
    // retry through key events, then throw — never "assume it took".
    let staged = await readTrimmedInput(page, KUALI_RRSS_TIMEKEEPER_FIELD);
    if (staged !== timekeeperName) {
      await field.clear({ timeout: FIELD_TIMEOUT_MS });
      await field.pressSequentially(timekeeperName, { delay: 30, timeout: FIELD_TIMEOUT_MS });
      staged = await readTrimmedInput(page, KUALI_RRSS_TIMEKEEPER_FIELD);
    }
    if (staged !== timekeeperName) {
      throw new Error(
        `Kuali document ${view.documentNumber} did not accept the staged timekeeper value; `
        + "the field reads back differently after two attempts — refusing to reach the fence",
      );
    }
    // The Save button must already resolve uniquely BEFORE the fence: a page
    // that cannot name exactly one Save is a page we must not fence on.
    await exactlyOne(page, KUALI_RRSS_SAVE_BUTTON);
    return KualiTimekeeperStagingSchema.parse({
      pageStateId: KUALI_RRSS_TIMEKEEPER_STAGED,
      actionId: view.actionId,
      documentNumber: view.documentNumber,
      observedEid: view.observedEid,
      previousTimekeeperName: view.currentTimekeeperName,
      stagedTimekeeperName: staged,
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
    const save = await exactlyOne(page, KUALI_RRSS_SAVE_BUTTON);
    await save.click({ timeout: FIELD_TIMEOUT_MS });
    // Legacy `clickSave` settles on `networkidle` here and calls that success.
    // This one does neither. There is deliberately no settle: the ONLY barrier
    // that means anything is `readSavedTimekeeper`'s reload, and a settle whose
    // failure we would have to swallow buys nothing but a false sense of it.
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
