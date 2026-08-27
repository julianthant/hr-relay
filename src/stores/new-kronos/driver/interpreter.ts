/**
 * The New Kronos (UKG Dimensions / WFD) driver — the only module in this store
 * that touches a raw Playwright `Page`.
 *
 * Every locator is resolved from `NEW_KRONOS_UI_REGISTRY` by semantic id
 * through {@link resolveRecipe}; there are no inline selectors and no `.or()`
 * fallbacks. Five rules run through the whole file, and each exists because of
 * something measured live on **2026-08-12** or recorded in
 * `docs/migrations/separations-legacy-behavior.md`:
 *
 *  1. **Exactly one match, or throw.** Every recipe here was counted live at
 *     one. A second match means the DOM moved and we no longer know what we
 *     would be reading, so we refuse rather than take `.first()` — which is
 *     precisely what hid the pay-period trigger's real ambiguity in legacy.
 *  2. **A timeout is never a negative (S35 / pattern D5).** WFD's genuine
 *     no-results sentinel rendered in 548 ms. Silence therefore produces the
 *     explicit `no-signal` state with the reason, never `found: false`.
 *  3. **The Go To button proves the SELECTION, not the click (S36).** It is
 *     `ng-disabled` until a slat is selected; enabled is the only evidence
 *     Angular registered the pick, and a Go To that never enables throws.
 *  4. **The grid is VIRTUALIZED, so one DOM read is not the timecard.** The
 *     read scrolls the pinned viewport and accumulates; the domain fold then
 *     refuses a day set that does not cover the applied window.
 *  5. **The applied window is proved by VALUE (S40).** After Apply, WFD renders
 *     the window back into the period label; the driver parses it and compares
 *     calendar days, instead of legacy's "the label is different now".
 *
 * There is no `commit`, no `fill` of anything that persists, and no
 * `external-commit` element in the registry: this store cannot mutate UKG.
 *
 * Ported with provenance from legacy
 * hr-automation@793abe1f8265f3213ffe8a80d6cfd9860a32a1dc
 * `src/systems/new-kronos/selectors.ts` (the sixteen recipes, via the registry)
 * and @1bffbd658db34ce84a08e69484db3a40b3658d6e
 * `src/systems/new-kronos/navigate.ts` — `resolveSearchRoot` :70-84 (the
 * dual-context probe), `waitForEmployeeSearchOutcome` :142-178 (found beats the
 * sentinel), `resolveEnabledGoToButton` :304-321, `clickGoToTimecard` :445-533,
 * `verifyTimecardEmployee` :554-576, `setDateRange` :1266-1345, and the
 * `getSeparationTimecardData` grid parse :852-894.
 *
 * NOT ported: `pickRangeDateViaCalendar` and the entire moment-picker
 * navigation (`calendarMonthHeader`/`calendarPrevMonth`/`calendarNextMonth`/
 * `calendarDayCell`). Legacy needs it because `fill()` on the text-mode range
 * field is reverted by the Angular digest — measured again here, 6 samples over
 * 2.4 s all reading the pre-fill value. But REAL KEYSTROKES stick
 * (`pressSequentially`, 5 samples over 2 s), which deletes ~200 lines of
 * calendar stepping and its four extra selectors. Also not ported: the
 * `loadingOverlay` CSS union (legacy marks it `NEEDS LIVE RE-VERIFY` and it
 * never matched anything on the live build), and `search.resultEmployeeId()`'s
 * bare `getByText(eid)`.
 */
import type { FrameLocator, Locator, Page } from "playwright";
import type { Clock } from "../../../domain/clock.js";
import { IsoInstantSchema } from "../../../domain/ids.js";
import {
  foldSeparationTimecard,
  formatRangeBound,
  parseAppliedRangeLabel,
  parseTimecardDate,
  rangesAreSameDays,
  resolveTimecardColumns,
} from "../../../domain/kronos/separation-timecard.js";
import { readVirtualizedGrid } from "./grid-scroll.js";
import type { RawTimecardGridRow } from "./grid-scroll.js";
import { judgeSearchRender, parseSlatIdentity, slatRenderComplete } from "./search-render.js";
import type { SlatRenderFact } from "./search-render.js";
import type { TimecardGridRow } from "../../../domain/kronos/separation-timecard.js";
import type { TimecardDateRange } from "../../../domain/timecard-period.js";
import {
  NEW_KRONOS_SEARCH_CLOSE_BUTTON,
  NEW_KRONOS_SEARCH_GO_TO_BUTTON,
  NEW_KRONOS_SEARCH_GO_TO_TIMECARD_OPTION,
  NEW_KRONOS_NO_RESULTS_SENTINEL,
  NEW_KRONOS_SEARCH_NO_RESULTS_TEXT,
  NEW_KRONOS_SEARCH_OPEN_BUTTON,
  NEW_KRONOS_SEARCH_QUERY_FIELD,
  NEW_KRONOS_SEARCH_RESULT_SLAT,
  NEW_KRONOS_SEARCH_SUBMIT_BUTTON,
  NEW_KRONOS_TIMECARD_DISPLAYED_EID,
  NEW_KRONOS_TIMECARD_EMPLOYEE_ID,
  NEW_KRONOS_TIMECARD_PERIOD_LABEL,
  NEW_KRONOS_TIMECARD_PERIOD_TRIGGER,
  NEW_KRONOS_TIMECARD_RANGE_APPLY_BUTTON,
  NEW_KRONOS_TIMECARD_RANGE_END_FIELD,
  NEW_KRONOS_TIMECARD_RANGE_START_FIELD,
  NEW_KRONOS_TIMECARD_SELECT_RANGE_BUTTON,
  NewKronosSearchReadSchema,
  NewKronosTimecardDriverSchema,
  NewKronosTimecardReadSchema,
} from "../../../domain/ui/new-kronos-timecard.js";
import type {
  NewKronosSearchCandidate,
  NewKronosSearchRead,
  NewKronosTimecardDriver,
  NewKronosTimecardRead,
} from "../../../domain/ui/new-kronos-timecard.js";
import type { ElementId } from "../../../domain/ids.js";
import {
  NEW_KRONOS_PORTAL_FRAME_SELECTOR,
  NEW_KRONOS_TIMECARD_ROUTE,
  NEW_KRONOS_UI_REGISTRY,
} from "./ui-registry.js";

/** Every wait below is a bound on ONE named fact; elapsing one is always a refusal. */
const PANEL_CONTEXT_TIMEOUT_MS = 15_000;
const CONTROL_TIMEOUT_MS = 15_000;
/** Go To -> Timecard measured 6.2s live on a warm session. */
const TIMECARD_NAVIGATION_TIMEOUT_MS = 45_000;
/** Apply -> grid repaint measured 6.1s live. */
const RANGE_APPLY_TIMEOUT_MS = 45_000;
/** The date field settles within ~1s of the last keystroke; 8s is generous. */
const RANGE_FIELD_SETTLE_TIMEOUT_MS = 8_000;
/** Angular enables Go To within a frame of the checkbox commit. */
const SELECTION_TIMEOUT_MS = 10_000;
const POLL_INTERVAL_MS = 200;
/**
 * How many CONSECUTIVE polls must show WFD's no-results sentinel, with no
 * result row anywhere, before the absence is reported as a real negative.
 * 15 x 200ms = 3s of stillness — comfortably above the 548ms in which a genuine
 * negative rendered live, and above the window in which a real hit was still
 * resolving behind the same sentinel.
 */
const NO_RESULTS_STABLE_POLLS = 15;
/**
 * The search bound the TIMECARD visit uses for its own navigation prelude. The
 * task-facing search contract carries the operator's bound; this one is the
 * driver's internal reach-the-page step and is not a caller's choice.
 */
const PANEL_SEARCH_TIMEOUT_MS = 20_000;
/**
 * The element that CARRIES a result row's identity: WFD transcludes a
 * `krn-slats-tabular-data` card (its `li.card__data` rows are the `Name` /
 * `ID` label-value pairs the identity regex reads) into the slat's
 * `.slat-col__data` zone one Angular digest AFTER the `slat-container` host —
 * the `[role='menuitemradio']` row — has landed. Driver-internal like
 * `p.totals-counter`: legacy has no key for it, so it is not a registry
 * element. Verified live 2026-08-27 (§9.28): present in every hydrated row,
 * absent for the 9–34 ms in which the row exists with empty text.
 */
const NEW_KRONOS_SLAT_TABULAR_DATA_SELECTOR = "krn-slats-tabular-data";
/** The virtualized grid's own scroll bounds live with its loop in `grid-scroll.ts` (D205). */

type PanelRoot = FrameLocator | Page;
type PanelContext = "portal-frame" | "top-level";

class NewKronosDriverError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(`[new-kronos] ${message}`, options);
    this.name = "NewKronosDriverError";
  }
}

const ELEMENTS = new Map(NEW_KRONOS_UI_REGISTRY.elements.map((element) => [element.id, element]));

function elementDefinition(id: ElementId) {
  const element = ELEMENTS.get(id);
  if (element === undefined) {
    throw new NewKronosDriverError(`semantic element ${id} is not published in the New Kronos UI registry`);
  }
  return element;
}

/**
 * Resolve a registry recipe against a root. The recipe's `context` decides
 * WHICH root a caller may pass, so a search-panel control can never be silently
 * resolved top-level when the panel is in the iframe (or vice versa).
 */
function resolveRecipe(root: PanelRoot, id: ElementId): Locator {
  const { locator } = elementDefinition(id);
  switch (locator.kind) {
    case "role-exact-name":
      return root.getByRole(locator.role, { name: locator.name, exact: locator.exact });
    case "dom-id":
      return root.locator(`#${locator.domId}`);
    case "css":
      return root.locator(locator.selector);
    case "exact-text":
      return root.getByText(locator.text, { exact: true });
  }
}

/**
 * Resolve to EXACTLY one node, or refuse naming the element and the count.
 *
 * This is a BOUNDED WAIT for the count to be one, not a single sample. WFD is a
 * client-rendered SPA and its chrome paints after the route settles — measured
 * live 2026-08-12 on run `sk-123704-7551`, where the navbar's `Employee Search`
 * button resolved to ZERO nodes on an authenticated `…/wfd/home` immediately
 * after landing. A sampled-once count is an observation of the render, not of
 * the page; the same defect took two live runs to surface in Kuali.
 *
 * A count of TWO short-circuits immediately: ambiguity does not resolve itself
 * by waiting, and returning `.first()` is exactly what this refusal exists to
 * prevent.
 */
async function exactlyOne(clock: Clock, root: PanelRoot, id: ElementId): Promise<Locator> {
  const candidates = resolveRecipe(root, id);
  const settled = await pollUntil(clock, CONTROL_TIMEOUT_MS, async () => {
    const count = await candidates.count();
    return count === 0 ? null : count;
  });
  if (settled.value === 1) return candidates;
  const observed = settled.value === null ? 0 : settled.value;
  throw new NewKronosDriverError(
    `semantic element ${id} resolved to ${String(observed)} nodes after ${String(settled.waitedMs)}ms, `
    + "expected exactly 1 — refusing to guess which one",
  );
}

/**
 * The poll interval, as a plain timer. `page.waitForTimeout` is banned under
 * `src/stores` and this is not a substitute for it: nothing here waits a fixed
 * time for an OUTCOME — every caller below polls a SPECIFIC fact against its
 * own bound, and elapsing that bound is always a refusal, never a value.
 */
async function tick(ms: number): Promise<void> {
  await new Promise<void>((resolve) => { setTimeout(resolve, ms); });
}

/** Poll `check` until it answers, bounded. Elapsing the bound is never a value. */
async function pollUntil<T>(
  clock: Clock,
  timeoutMs: number,
  check: () => Promise<T | null>,
): Promise<{ readonly value: T; readonly waitedMs: number } | { readonly value: null; readonly waitedMs: number }> {
  const startedAt = clock.monotonicMs();
  for (;;) {
    const value = await check();
    const waitedMs = clock.monotonicMs() - startedAt;
    if (value !== null) return { value, waitedMs };
    if (waitedMs >= timeoutMs) return { value: null, waitedMs };
    await tick(POLL_INTERVAL_MS);
  }
}

function createDriverInternals(page: Page, clock: Clock) {
  const nowIso = (): string => IsoInstantSchema.parse(clock.now().toISOString());

  /**
   * Which context currently hosts the Employee Search panel, probed through an
   * ANCHOR the caller names.
   *
   * The anchor is a parameter because the panel has two states and they do not
   * share a control: before a search it renders the query field; AFTER one it
   * collapses to `Show Search` and the query field is GONE, while the Go To
   * button is present. Legacy records this exact trap
   * (`navigate.ts:323-340` — "`resolveSearchRoot` (which probes the input) can
   * mis-detect the context here"), and the first live run of this workflow
   * (`sk-123940-ab25`, 2026-08-12) reproduced it: the search node succeeded and
   * the timecard node then refused because it probed for a field the successful
   * search had just collapsed.
   *
   * Live 2026-08-12: a fresh home load renders it inside
   * `iframe[name^="portal-frame-"]` (the suffix is session-scoped), and after a
   * timecard navigation it renders top-level with NO named frames on the page
   * at all. Probing the panel's own query field is what decides; there is no
   * default, and failing to find it in either context is a loud refusal.
   */
  const resolvePanelRoot = async (
    anchor: ElementId,
  ): Promise<{ root: PanelRoot; context: PanelContext }> => {
    const probe = await pollUntil(clock, PANEL_CONTEXT_TIMEOUT_MS, async () => {
      const frame = page.frameLocator(NEW_KRONOS_PORTAL_FRAME_SELECTOR);
      if (await resolveRecipe(frame, anchor).count() > 0) {
        return { root: frame as PanelRoot, context: "portal-frame" as PanelContext };
      }
      if (await resolveRecipe(page, anchor).count() > 0) {
        return { root: page as PanelRoot, context: "top-level" as PanelContext };
      }
      return null;
    });
    if (probe.value === null) {
      throw new NewKronosDriverError(
        `the Employee Search panel's ${anchor} rendered in neither the `
        + `${NEW_KRONOS_PORTAL_FRAME_SELECTOR} context nor top-level within `
        + `${String(PANEL_CONTEXT_TIMEOUT_MS)}ms — the panel is not in the state this step needs`,
      );
    }
    return probe.value;
  };

  /** Read WFD's own `Total [N]` / `Selected [N]` counters. */
  const readCounters = async (root: PanelRoot): Promise<{ total: number | null; selected: number | null }> => {
    const texts = await root.locator("p.totals-counter").allTextContents();
    const parse = (label: string): number | null => {
      const row = texts.find((text) => text.replace(/\s+/gu, " ").trim().startsWith(label));
      if (row === undefined) return null;
      const match = /\[(\d+)\]/u.exec(row);
      return match?.[1] === undefined ? null : Number(match[1]);
    };
    return { total: parse("Total"), selected: parse("Selected") };
  };

  /**
   * Every rendered row: its identity label and whether its tabular-data card
   * has rendered yet (§9.28).
   *
   * The label is the row's own accessible name when it has one, else the row's
   * text. Live 2026-08-12 the row carried `aria-label="Name <name> ID <eid>"`;
   * live 2026-08-27 that attribute is a feature-toggle-gated binding
   * (`ng-attr-aria-label="{{isSwapA11yImprovementsEnabled && enableSlatA11y …}}"`)
   * and was ABSENT on every row, so the identity came from the text of the
   * `krn-slats-tabular-data` card — the same `Name <name> ID <eid>` string.
   * Either way the row IS the identity; no separate EID text match is needed
   * (legacy's `getByText(eid)` could hit the search box's own echo of the query).
   */
  const readSlatFacts = async (root: PanelRoot): Promise<SlatRenderFact[]> => resolveRecipe(root, NEW_KRONOS_SEARCH_RESULT_SLAT)
    .evaluateAll((rows, tabularDataSelector) => rows.map((row) => {
      const aria = row.getAttribute("aria-label");
      const text = row.textContent;
      const label = typeof aria === "string" && aria.length > 0
        ? aria
        : (typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "");
      return { label, cardRendered: row.querySelector(tabularDataSelector) !== null };
    }), NEW_KRONOS_SLAT_TABULAR_DATA_SELECTOR);

  /** Every rendered candidate off its row's identity, or a refusal naming the row that has none. */
  const candidatesFrom = (slats: readonly SlatRenderFact[]): NewKronosSearchCandidate[] => slats.map((slat) => {
    const identity = parseSlatIdentity(slat.label);
    if (identity === null) {
      throw new NewKronosDriverError(
        `an Employee Search result row does not carry the "Name <name> ID <eid>" identity `
        + `WFD renders — observed ${JSON.stringify(slat.label)}; refusing to read a row whose subject is unknown`,
      );
    }
    return { displayName: identity.displayName, employeeId: identity.employeeId };
  });

  /**
   * Open the panel, search for `employeeId`, and select the matching row.
   * Returns the panel root and context, or throws naming what went wrong.
   * Shared by both operations so neither depends on the other having run.
   */
  const selectEmployeeInPanel = async (
    employeeId: string,
  ): Promise<{ root: PanelRoot; context: PanelContext }> => {
    const read = await searchEmployee({ employeeId, searchTimeoutMs: PANEL_SEARCH_TIMEOUT_MS });
    if (read.state !== "resolved") {
      throw new NewKronosDriverError(
        `could not select EID ${employeeId} in the Employee Search panel before opening the timecard: `
        + `the search answered ${read.state} — this is a navigation failure, not an empty timecard`,
      );
    }
    // After a search the panel's query field collapses into `Show Search`, so
    // the Go To button is what proves the context from here on.
    return resolvePanelRoot(NEW_KRONOS_SEARCH_GO_TO_BUTTON);
  };

  const searchEmployee = async (
    input: Readonly<{ employeeId: string; searchTimeoutMs: number }>,
  ): Promise<NewKronosSearchRead> => {
    // Closing a panel that may not be open is genuinely optional and nothing
    // downstream reads its result: the panel state is re-established below and
    // proved by `resolvePanelRoot`. This is the one swallow in this file.
    await closeSearchPanel();

    const openButton = await exactlyOne(clock, page, NEW_KRONOS_SEARCH_OPEN_BUTTON);
    await openButton.click({ timeout: CONTROL_TIMEOUT_MS });

    const { root, context } = await resolvePanelRoot(NEW_KRONOS_SEARCH_QUERY_FIELD);
    const queryField = await exactlyOne(clock, root, NEW_KRONOS_SEARCH_QUERY_FIELD);
    await queryField.fill(input.employeeId, { timeout: CONTROL_TIMEOUT_MS });
    const submit = await exactlyOne(clock, root, NEW_KRONOS_SEARCH_SUBMIT_BUTTON);
    await submit.click({ timeout: CONTROL_TIMEOUT_MS });

    // legacy navigate.ts:142-178 — poll BOTH contexts and let a found signal
    // beat the sentinel: WFD renders both briefly while the grid loads (legacy
    // live 2026-07-06, and the reason a Promise.race mis-resolved a real hit).
    const roots: PanelRoot[] = [page.frameLocator(NEW_KRONOS_PORTAL_FRAME_SELECTOR), page];
    // A POSITIVE result is accepted on sight; the SENTINEL must hold across
    // consecutive polls before it counts.
    //
    // WFD renders its empty-grid sentinel while the search is still resolving,
    // so a sentinel sampled once is not "no such employee" — it is "not yet".
    // Live run `sk-124821-5956` (2026-08-12) proved the cost: EID 10776990,
    // which had resolved minutes earlier in the same session AND in run
    // `ab258c43`, came back `employee-not-found` on a first-sight sentinel. §4b
    // makes that failure terminal, so a false negative fails a real separation.
    // Stabilizing a negative observation is the same discipline ref write-safety applies
    // post-fence: a `present` reading is evidence immediately, an `absent` one
    // has to hold still.
    //
    // A row on SIGHT is not a result either (§9.28, 2026-08-27): WFD lands the
    // `[role='menuitemradio']` host digests before it transcludes the
    // `krn-slats-tabular-data` card and then interpolates the card's `{{ … }}`
    // bindings into the row's identity text (`search-render.ts` has the four
    // stages and the measurements). The 2026-08-19 cold-profile refusal
    // (`observed ""`) was this poll reading inside that gap, and so was its
    // reproduction under 20x CPU throttle on 2026-08-27. A `hydrating` render
    // is neither a result nor a negative: keep polling within the SAME bound,
    // and if the bound elapses with incomplete rows still on screen, refuse by
    // name below — never report them as `no-signal`, because the search DID
    // answer.
    let sentinelStreak = 0;
    let hydratingAtLastPoll: readonly SlatRenderFact[] | null = null;
    const outcome = await pollUntil(clock, input.searchTimeoutMs, async () => {
      hydratingAtLastPoll = null;
      for (const candidateRoot of roots) {
        // COUNT before reading. `roots` always tries the `portal-frame-` locator
        // first, and after a timecard navigation the page has NO named frames at
        // all (live 2026-08-12) — the second `searchEmployee` of a session runs
        // top-level. Playwright 1.61.1 treats a missing frame differently on the
        // two APIs, measured on this repo's pinned version: `count()` answers 0,
        // but `evaluateAll` resolves the frame chain in the main world and THROWS
        // `Failed to find frame for selector "…"`. Reading `readSlatFacts` first
        // therefore aborted the poll on a raw Playwright error in exactly the
        // context that must fall through to `page`, before the sentinel logic was
        // ever consulted. Zero rows here is the same `absent` the verdict below
        // would return, so this skips nothing a read would have found — and it
        // catches NOTHING: a frame that exists still lets every `evaluateAll`
        // error out.
        if (await resolveRecipe(candidateRoot, NEW_KRONOS_SEARCH_RESULT_SLAT).count() === 0) continue;
        const slats = await readSlatFacts(candidateRoot);
        const verdict = judgeSearchRender(slats);
        if (verdict === "results") {
          return { kind: "results" as const, root: candidateRoot, slats };
        }
        if (verdict === "hydrating") {
          // Rows exist, so whatever the sentinel says it is the loading state.
          sentinelStreak = 0;
          hydratingAtLastPoll = slats;
          return null;
        }
      }
      for (const candidateRoot of roots) {
        if (await resolveRecipe(candidateRoot, NEW_KRONOS_SEARCH_NO_RESULTS_TEXT).count() > 0) {
          sentinelStreak++;
          return sentinelStreak >= NO_RESULTS_STABLE_POLLS
            ? { kind: "sentinel" as const, root: candidateRoot }
            : null;
        }
      }
      // The sentinel disappearing resets the streak: it was the loading state.
      sentinelStreak = 0;
      return null;
    });

    if (outcome.value === null && hydratingAtLastPoll !== null) {
      const stuck: readonly SlatRenderFact[] = hydratingAtLastPoll;
      const incomplete = stuck.filter((slat) => !slatRenderComplete(slat));
      throw new NewKronosDriverError(
        `the Employee Search rendered ${String(stuck.length)} result row(s) but ${String(incomplete.length)} of them `
        + `never completed the identity render (the ${NEW_KRONOS_SLAT_TABULAR_DATA_SELECTOR} card and its interpolated `
        + `text) within ${String(outcome.waitedMs)}ms — last observed ${JSON.stringify(incomplete.map((slat) => slat.label))}; `
        + "refusing to read rows whose subjects are unknown",
      );
    }

    if (outcome.value === null) {
      // S35 / pattern D5: "the check could not run" is its own value.
      return NewKronosSearchReadSchema.parse({
        state: "no-signal",
        query: input.employeeId,
        reason: "neither an Employee Search result row nor WFD's own "
          + `"${NEW_KRONOS_NO_RESULTS_SENTINEL}" sentinel surfaced in either render context `
          + "— the search did not answer",
        waitedMs: outcome.waitedMs,
        observedAt: nowIso(),
      });
    }

    if (outcome.value.kind === "sentinel") {
      return NewKronosSearchReadSchema.parse({
        state: "no-results",
        query: input.employeeId,
        sentinel: NEW_KRONOS_NO_RESULTS_SENTINEL,
        panelContext: context,
        observedAt: nowIso(),
      });
    }

    const resultRoot = outcome.value.root;
    const candidates = candidatesFrom(outcome.value.slats);
    const counters = await readCounters(resultRoot);
    if (counters.total === null) {
      throw new NewKronosDriverError(
        `the Employee Search panel rendered ${String(candidates.length)} result row(s) but no "Total [N]" `
        + "counter — refusing to substitute the rendered count for WFD's own, because a virtualized or "
        + "paged result set would make them disagree",
      );
    }
    const totalCount = counters.total;
    const matched = candidates.find(({ employeeId }) => employeeId === input.employeeId);
    if (matched === undefined) {
      return NewKronosSearchReadSchema.parse({
        state: "no-match",
        query: input.employeeId,
        totalCount,
        candidates,
        panelContext: context,
        observedAt: nowIso(),
      });
    }

    // legacy navigate.ts:304-321 / :323-386 — checking the "Select Item" box is
    // what registers the Angular slat selection, and the ONLY proof it landed
    // is the Go To button becoming enabled.
    const checkbox = resolveRecipe(resultRoot, NEW_KRONOS_SEARCH_RESULT_SLAT)
      .nth(candidates.indexOf(matched))
      .getByRole("checkbox", { name: "Select Item", exact: true });
    await checkbox.check({ timeout: CONTROL_TIMEOUT_MS });

    const enabled = await pollUntil(clock, SELECTION_TIMEOUT_MS, async () => {
      const goTo = resolveRecipe(resultRoot, NEW_KRONOS_SEARCH_GO_TO_BUTTON);
      if (await goTo.count() !== 1) return null;
      return await goTo.isEnabled() ? true : null;
    });
    if (enabled.value === null) {
      throw new NewKronosDriverError(
        `Employee Search selected ${input.employeeId} but the Go To control never became enabled within `
        + `${String(SELECTION_TIMEOUT_MS)}ms — no slat is registered, so the timecard cannot be opened`,
      );
    }
    const afterSelect = await readCounters(resultRoot);
    if (afterSelect.selected === null) {
      throw new NewKronosDriverError(
        `the Employee Search panel rendered no "Selected [N]" counter after checking ${input.employeeId} — `
        + "the selection cannot be proved, and Go To being enabled alone is not the count",
      );
    }
    const selectedCount = afterSelect.selected;
    if (selectedCount < 1) {
      throw new NewKronosDriverError(
        `Employee Search reports Selected [${String(selectedCount)}] after checking ${input.employeeId} — `
        + "the selection did not register",
      );
    }

    return NewKronosSearchReadSchema.parse({
      state: "resolved",
      query: input.employeeId,
      totalCount,
      candidates,
      matched,
      selectedCount,
      panelContext: context,
      observedAt: nowIso(),
    });
  };

  /**
   * Close the Employee Search panel if it is open.
   *
   * Not a swallow: the panel's presence is PROBED (`count() === 1`) and only a
   * present control is clicked, so a failure to click a control that is there
   * propagates. A panel that is simply not open is a real state, and the two
   * callers do not read a result from this — one re-opens the panel and proves
   * it with `resolvePanelRoot`, the other has already navigated away.
   */
  const closeSearchPanel = async (): Promise<void> => {
    for (const root of [page.frameLocator(NEW_KRONOS_PORTAL_FRAME_SELECTOR), page] as PanelRoot[]) {
      const close = resolveRecipe(root, NEW_KRONOS_SEARCH_CLOSE_BUTTON);
      if (await close.count() !== 1) continue;
      await close.click({ timeout: CONTROL_TIMEOUT_MS });
      return;
    }
  };

  /**
   * Set one range field through WFD's masked text control. `fill(VALUE)` and
   * `fill("")` are both synchronously reverted: the u29 live probe read the
   * non-empty default at 0/100/200/500/1000ms after the latter (§9.30).
   *
   * The live-proven keyboard path is click -> select-all -> real keystrokes.
   * The widget can retain either a whole-value selection or its current date
   * segment, but its mask advances real digits across the fresh range value.
   * Therefore selection is an input gesture, never the proof. The ONE proof
   * is the final calendar-day read-back below. A silently failed select-all at
   * a mid-year caret remains diagnosable: §9.28 (citation repaired in
   * `3b9588c5`) observed `"11/20/2626"` for requested `6/1/2026`, and the
   * refusal now carries both that final observation and the prior value.
   */
  const setRangeField = async (id: ElementId, value: string, label: string): Promise<void> => {
    const field = await exactlyOne(clock, page, id);
    await field.click({ timeout: CONTROL_TIMEOUT_MS });
    const priorValue = await field.inputValue();
    await field.press("ControlOrMeta+a", { timeout: CONTROL_TIMEOUT_MS });
    await field.pressSequentially(value, { delay: 60, timeout: CONTROL_TIMEOUT_MS });
    const wanted = parseTimecardDate(value, `${label} date`);
    // The last value the poll actually SAW, so the refusal below reports the
    // observation instead of re-reading a field that may already have moved.
    let lastObserved = "";
    const settled = await pollUntil(clock, RANGE_FIELD_SETTLE_TIMEOUT_MS, async () => {
      const raw = await field.inputValue();
      lastObserved = raw;
      const parsed = /^\d{1,2}\/\d{1,2}\/\d{4}$/u.test(raw.trim())
        ? parseTimecardDate(raw.trim(), `${label} readback`)
        : null;
      // WFD pads the two halves inconsistently (live: `08/12/2026` beside
      // `6/01/2026`), so the comparison is on calendar days, never on strings.
      return parsed !== null && parsed.getTime() === wanted.getTime() ? raw : null;
    });
    if (settled.value === null) {
      throw new NewKronosDriverError(
        `could not set the timecard ${label} date to ${value} — prior value `
        + `${JSON.stringify(priorValue.length === 0 ? "<empty>" : priorValue)}; the field last read `
        + `${JSON.stringify(lastObserved.length === 0 ? "<empty>" : lastObserved)} after `
        + `${String(RANGE_FIELD_SETTLE_TIMEOUT_MS)}ms; refusing to apply a wrong timecard window`,
      );
    }
  };

  const readPeriodLabel = async (): Promise<string> => {
    const label = await exactlyOne(clock, page, NEW_KRONOS_TIMECARD_PERIOD_LABEL);
    const text = await label.textContent();
    if (text === null) {
      throw new NewKronosDriverError(
        "the timecard period label node carries no text — the active window cannot be read, "
        + "and an unreadable window is never an applied one",
      );
    }
    return text.replace(/\s+/gu, " ").trim();
  };

  /**
   * Read the whole virtualized grid: scroll the BODY viewport in bounded steps
   * and accumulate every distinct (day, cells) row, binding columns BY HEADER
   * NAME — then prove the applied window is entirely rendered before returning.
   *
   * It takes the APPLIED range because the read cannot know it is finished
   * without one. `assertTimecardCoversRange` already stated the invariant, but
   * it ran in the fold, after the browser was gone: the driver got to declare
   * success on a partial grid and the refusal arrived one layer too late to say
   * anything useful about the scroll. The same `timecardRangeCoverage` is now
   * the loop's termination condition and the loop's refusal.
   *
   * The returned rows are raw strings — every derivation happens in the fold.
   */
  const readGrid = async (applied: TimecardDateRange): Promise<{
    rows: TimecardGridRow[];
    headers: string[];
    scrollSteps: number;
  }> => {
    // NOTE: everything below runs the page-side read as SMALL ANONYMOUS
    // callbacks with no inner named bindings, and keeps the loop on the Node
    // side. `tsx` compiles this file with esbuild's `keepNames`, which wraps a
    // named function or a function assigned to a `const` in a `__name(...)`
    // helper — a helper the BROWSER does not have. Live run `sk-125229-f0c8`
    // (2026-08-12) died with `ReferenceError: __name is not defined` inside
    // `page.evaluate` for exactly that reason, and the shape of the fix is
    // general: an evaluated callback may not declare functions.
    const harvestOnce = async (): Promise<{
      rows: readonly { month: number; day: number; rawDateCell: string; cells: readonly string[] }[];
      headers: readonly string[];
      dataCells: number;
      viewportCount: number;
      topRow: string;
      scrollTop: number;
      scrollHeight: number;
      clientHeight: number;
    }> => page.evaluate(() => {
      const viewports = [...document.querySelectorAll(".ui-grid-viewport")];
      const dateViewport = viewports[0];
      const dataViewport = viewports[viewports.length - 1];
      if (dateViewport === undefined || dataViewport === undefined || viewports.length < 2) {
        return {
          rows: [], headers: [], viewportCount: viewports.length, dataCells: -1,
          topRow: "", scrollTop: 0, scrollHeight: 0, clientHeight: 0,
        };
      }
      // The headers must come from the DATA container ALONE (D205). Reading
      // `.ui-grid-header-cell` document-wide also picks up the PINNED column's
      // header — live, `Date` survives the blank/`.` filter at index 0 — while
      // the cells below come from the body row, which has no date cell. Every
      // resolved index was then one too high: `Pay code` read the Amount column
      // and `In` read `Out`. That is not a crash, it is a plausible-but-wrong
      // last punch on a real separation, and only the first grid read that
      // reached the fold could ever have shown it.
      const container = dataViewport.closest(".ui-grid-render-container");
      const headers = (container === null ? [] : [...container.querySelectorAll(".ui-grid-header-cell")])
        .map((cell) => (cell.textContent ?? "").replace(/\s+/g, " ").trim())
        .filter((text) => text.length > 0 && text !== ".");
      const dateRows = [...dateViewport.querySelectorAll("[role=row]")];
      const dataRows = [...dataViewport.querySelectorAll("[role=row]")];
      const rows: { month: number; day: number; rawDateCell: string; cells: string[] }[] = [];
      let carriedMonth = 0;
      let carriedDay = 0;
      let carriedCell = "";
      for (let index = 0; index < Math.max(dateRows.length, dataRows.length); index++) {
        const dateRow = dateRows[index];
        const raw = dateRow === undefined ? "" : (dateRow.textContent ?? "").replace(/\s+/g, " ").trim();
        const match = /([A-Za-z]{3})\s+(\d{1,2})\/(\d{1,2})/.exec(raw);
        if (match !== null) {
          carriedMonth = Number(match[2]);
          carriedDay = Number(match[3]);
          carriedCell = raw;
        }
        if (carriedMonth === 0) continue;
        const dataRow = dataRows[index];
        const cells = dataRow === undefined
          ? []
          : [...dataRow.querySelectorAll("[role=gridcell]")]
            .map((cell) => (cell.textContent ?? "").replace(/\s+/g, " ").trim());
        rows.push({
          month: carriedMonth,
          day: carriedDay,
          rawDateCell: match === null ? "" : carriedCell,
          cells,
        });
      }
      const first = dateRows[0];
      const firstDataRow = dataRows[0];
      return {
        rows,
        headers,
        // How many cells a body row actually renders — the count the header
        // list has to agree with, checked below rather than assumed.
        dataCells: firstDataRow === undefined
          ? -1
          : firstDataRow.querySelectorAll("[role=gridcell]").length,
        viewportCount: viewports.length,
        topRow: first === undefined ? "" : (first.textContent ?? "").trim(),
        scrollTop: dataViewport.scrollTop,
        scrollHeight: dataViewport.scrollHeight,
        clientHeight: dataViewport.clientHeight,
      };
    });

    /**
     * Drive the grid's scroll position, and report where it actually landed.
     *
     * The position is written to EVERY `.ui-grid-viewport`, and the geometry
     * comes back from the LAST one. That is the whole D205 fix: ui-grid renders
     * a pinned container and a body container as separate viewports, and only
     * the body's scroll drives virtualization — the pinned date column is
     * synced FROM it. Writing `scrollTop` to `viewports[0]` therefore moved the
     * pinned column's pixels (or nothing at all, if it does not overflow) while
     * the row set never re-rendered, which is exactly how attempt 14 read the
     * last 14 days of a 35-day window and reported a scroll it had not done.
     * Writing all of them keeps the two columns aligned for the paired read
     * below rather than relying on ui-grid's own sync landing first.
     */
    const scrollGridTo = async (top: number): Promise<{
      scrollTop: number;
      scrollHeight: number;
      clientHeight: number;
    }> => page.evaluate((position: number) => {
      const viewports = [...document.querySelectorAll(".ui-grid-viewport")];
      for (const viewport of viewports) viewport.scrollTop = Math.max(0, position);
      const driver = viewports[viewports.length - 1];
      return driver === undefined
        ? { scrollTop: -1, scrollHeight: -1, clientHeight: -1 }
        : {
          scrollTop: driver.scrollTop,
          scrollHeight: driver.scrollHeight,
          clientHeight: driver.clientHeight,
        };
    }, top);

    const opening = await harvestOnce();
    const headers = opening.headers;
    if (opening.viewportCount < 2) {
      throw new NewKronosDriverError(
        `the timecard grid rendered ${String(opening.viewportCount)} viewports, expected the pinned date `
        + "column plus the data column — the timecard did not load",
      );
    }
    /*
     * The header row and a body row must describe the SAME columns, or every
     * resolved index is an offset into somebody else's row. Binding by header
     * name was supposed to make that impossible and did not: the names were
     * read from a wider element set than the cells, so the mapping was
     * internally consistent and externally wrong. A count comparison is the
     * cheap invariant that catches it, and it catches the next version of it
     * too — a WFD release that renders a header with no cell, or the reverse.
     */
    if (opening.dataCells >= 0 && opening.dataCells !== headers.length) {
      throw new NewKronosDriverError(
        `the timecard grid's data rows render ${String(opening.dataCells)} cell(s) against `
        + `${String(headers.length)} data header(s) ${JSON.stringify(headers)} — the header row and the `
        + "body rows do not describe the same columns, so every column index would be an offset into "
        + "the wrong cell; refusing to read punches through a mapping that cannot be trusted",
      );
    }
    const columns = resolveTimecardColumns(headers);
    const cellAt = (cells: readonly string[], column: keyof typeof columns): string =>
      cells[columns[column]] ?? "";
    const read = await readVirtualizedGrid(
      {
        harvest: async () => await harvestOnce(),
        scrollTo: scrollGridTo,
        settle: async () => { await tick(POLL_INTERVAL_MS); },
        refuse: (message: string) => new NewKronosDriverError(message),
      },
      applied,
    );
    const rows: TimecardGridRow[] = read.rows.map((row: RawTimecardGridRow) => ({
      month: row.month,
      day: row.day,
      rawDateCell: row.rawDateCell,
      schedule: cellAt(row.cells, "Schedule"),
      punchIn: cellAt(row.cells, "In"),
      punchOut: cellAt(row.cells, "Out"),
      transfer: cellAt(row.cells, "Transfer"),
      payCode: cellAt(row.cells, "Pay code"),
      amount: cellAt(row.cells, "Amount"),
      shift: cellAt(row.cells, "Shift"),
      daily: cellAt(row.cells, "Daily"),
      period: cellAt(row.cells, "Period"),
      absence: cellAt(row.cells, "Absence"),
    }));
    return { rows, headers: [...headers], scrollSteps: read.scrollSteps };
  };

  const readSeparationTimecard = async (
    input: Readonly<{ employeeId: string; rangeStart: string; rangeEnd: string }>,
  ): Promise<NewKronosTimecardRead> => {
    // The timecard visit establishes its OWN precondition.
    //
    // A task may not inherit page state from the task before it: the worker
    // releases and re-verifies a browser session between leases (ref execution-and-sessions §4),
    // which re-navigates to the system's neutral entry route — so the selection
    // the search task left in the panel is gone by the time this one runs.
    // Observed live on run `sk-125031-54c5` (2026-08-12): the search node
    // succeeded and this node then found no Go To control at all.
    //
    // This does NOT collapse the two tasks into one. D194 groups by PAGE VISIT,
    // and the panel navigation is how you REACH the timecard — the same way
    // legacy's `runNewKronosTimecard` reaches it. The search task still exists
    // for the search-results page's own extraction surface (the candidate list
    // and WFD's counters), which a later composition can want on its own.
    const { root } = await selectEmployeeInPanel(input.employeeId);

    // legacy navigate.ts:445-470 — Go To must be visible AND ENABLED. A failure
    // here is MECHANICAL and must throw; it is never "this person has no card"
    // (S36).
    const goTo = await exactlyOne(clock, root, NEW_KRONOS_SEARCH_GO_TO_BUTTON);
    if (!(await goTo.isEnabled())) {
      throw new NewKronosDriverError(
        `the Go To control is disabled for EID ${input.employeeId} — no employee is selected in the search `
        + "panel, so the timecard cannot be opened; this is a navigation failure, not an empty timecard",
      );
    }
    await goTo.click({ timeout: CONTROL_TIMEOUT_MS });

    const optionReady = await pollUntil(clock, CONTROL_TIMEOUT_MS, async () =>
      await resolveRecipe(root, NEW_KRONOS_SEARCH_GO_TO_TIMECARD_OPTION).count() === 1 ? true : null);
    if (optionReady.value === null) {
      throw new NewKronosDriverError(
        `the Go To menu never rendered exactly one "Timecard" option within ${String(CONTROL_TIMEOUT_MS)}ms `
        + `for EID ${input.employeeId} — the timecard could not be opened`,
      );
    }
    const option = await exactlyOne(clock, root, NEW_KRONOS_SEARCH_GO_TO_TIMECARD_OPTION);
    await option.click({ timeout: CONTROL_TIMEOUT_MS });

    const landed = await pollUntil(clock, TIMECARD_NAVIGATION_TIMEOUT_MS, async () => {
      if (!page.url().includes(NEW_KRONOS_TIMECARD_ROUTE)) return null;
      return await resolveRecipe(page, NEW_KRONOS_TIMECARD_EMPLOYEE_ID).count() === 1 ? true : null;
    });
    if (landed.value === null) {
      throw new NewKronosDriverError(
        `Go To -> Timecard did not reach ${NEW_KRONOS_TIMECARD_ROUTE} with an identifiable employee header `
        + `within ${String(TIMECARD_NAVIGATION_TIMEOUT_MS)}ms for EID ${input.employeeId} `
        + `(observed URL ${page.url()}) — refusing to read a page that is not a loaded timecard`,
      );
    }

    // The panel is closed BEFORE the subject read: legacy verified this
    // ordering because the searched EID lingers in the search chrome, and
    // reading page-wide text there is exactly how a wrong-person timecard read
    // as right (S37).
    await closeSearchPanel();

    const idNode = await exactlyOne(clock, page, NEW_KRONOS_TIMECARD_EMPLOYEE_ID);
    const idText = await idNode.textContent();
    const observedEmployeeId = idText === null ? "" : idText.trim();

    if (observedEmployeeId.length === 0) {
      throw new NewKronosDriverError(
        `the timecard's ${NEW_KRONOS_TIMECARD_DISPLAYED_EID} observation is empty for expected EID `
        + `${input.employeeId} — the header did not render, so the subject cannot be proved`,
      );
    }
    // The employee-name combobox is driver-internal: legacy has no selector key
    // for it, so it carries no ported provenance and is deliberately absent
    // from the registry (see the registry header).
    const nameNode = page.locator("#combo_inptxt");
    const nameTitle = await nameNode.count() === 1 ? await nameNode.getAttribute("title") : null;
    const observedDisplayName = nameTitle === null ? "" : nameTitle.trim();
    if (observedDisplayName.length === 0) {
      throw new NewKronosDriverError(
        `the timecard does not display an employee name beside EID ${observedEmployeeId} — `
        + "refusing to report a subject whose name half could not be read",
      );
    }

    const subject = {
      observationId: NEW_KRONOS_TIMECARD_DISPLAYED_EID,
      expectedEid: input.employeeId,
      observedEmployeeId,
      observedDisplayName,
      matches: observedEmployeeId === input.employeeId,
    } as const;

    // Apply the window. Everything below runs on the SAME page visit.
    const trigger = await exactlyOne(clock, page, NEW_KRONOS_TIMECARD_PERIOD_TRIGGER);
    await trigger.click({ timeout: CONTROL_TIMEOUT_MS });
    const selectRange = await exactlyOne(clock, page, NEW_KRONOS_TIMECARD_SELECT_RANGE_BUTTON);
    await selectRange.click({ timeout: CONTROL_TIMEOUT_MS });
    await setRangeField(NEW_KRONOS_TIMECARD_RANGE_START_FIELD, input.rangeStart, "start");
    await setRangeField(NEW_KRONOS_TIMECARD_RANGE_END_FIELD, input.rangeEnd, "end");
    // Setting the end can nudge the start (the widget auto-advances between the
    // two tabs), so the start is re-proved before Apply.
    await setRangeField(NEW_KRONOS_TIMECARD_RANGE_START_FIELD, input.rangeStart, "start (re-proof)");
    const apply = await exactlyOne(clock, page, NEW_KRONOS_TIMECARD_RANGE_APPLY_BUTTON);
    await apply.click({ timeout: CONTROL_TIMEOUT_MS });

    const requested = {
      start: parseTimecardDate(input.rangeStart, "requested range start"),
      end: parseTimecardDate(input.rangeEnd, "requested range end"),
    };
    const applied = await pollUntil(clock, RANGE_APPLY_TIMEOUT_MS, async () => {
      const label = await readPeriodLabel();
      const parsed = parseAppliedRangeLabel(label);
      return parsed !== null && rangesAreSameDays(parsed, requested) ? { label, parsed } : null;
    });
    if (applied.value === null) {
      const label = await readPeriodLabel();
      throw new NewKronosDriverError(
        `the timecard period label reads ${JSON.stringify(label)} after applying `
        + `${input.rangeStart} - ${input.rangeEnd} — the requested window is not the one displayed, `
        + "so the grid would be read on the wrong period",
      );
    }

    const { rows, headers, scrollSteps } = await readGrid(applied.value.parsed);
    const fold = foldSeparationTimecard(rows, applied.value.parsed);
    const daysCovered = new Set(rows.map((row) => `${String(row.month)}/${String(row.day)}`)).size;
    const populatedRows = rows.filter((row) =>
      row.punchIn !== "" || row.punchOut !== "" || row.payCode !== ""
      || row.amount !== "" || row.daily !== "" || row.absence !== "").length;

    return NewKronosTimecardReadSchema.parse({
      subject,
      range: {
        requestedStart: formatRangeBound(requested.start),
        requestedEnd: formatRangeBound(requested.end),
        observedLabel: applied.value.label,
        observedStart: formatRangeBound(applied.value.parsed.start),
        observedEnd: formatRangeBound(applied.value.parsed.end),
        applied: true,
      },
      grid: {
        columnHeaders: headers,
        scrollSteps,
        daysCovered,
        populatedRows,
        lastPunchDate: fold.lastPunchDate,
        punchDates: fold.punchDates,
        sickDates: fold.sickDates,
        holidayDates: fold.holidayDates,
        payCodeDays: fold.payCodeDays,
        unclassifiedPayCodes: fold.unclassifiedPayCodes,
      },
      observedAt: nowIso(),
    });
  };

  return { searchEmployee, readSeparationTimecard };
}

/**
 * The concrete New Kronos driver over a live page.
 *
 * The injected `Clock` is the ONE time source (ref clock-config-secrets): every `observedAt` here
 * is a clock read, never `new Date()`.
 */
export function createNewKronosTimecardDriver(page: Page, clock: Clock): NewKronosTimecardDriver {
  const internals = createDriverInternals(page, clock);
  return NewKronosTimecardDriverSchema.parse({
    system: "new-kronos",
    searchEmployee: internals.searchEmployee,
    readSeparationTimecard: internals.readSeparationTimecard,
  });
}
