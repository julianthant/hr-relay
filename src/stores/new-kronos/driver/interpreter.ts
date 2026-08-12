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
import type { TimecardGridRow } from "../../../domain/kronos/separation-timecard.js";
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

/** Resolve to EXACTLY one node, or refuse naming the element and the count. */
async function exactlyOne(root: PanelRoot, id: ElementId): Promise<Locator> {
  const candidates = resolveRecipe(root, id);
  const count = await candidates.count();
  if (count === 1) return candidates;
  throw new NewKronosDriverError(
    `semantic element ${id} resolved to ${String(count)} nodes, expected exactly 1 — refusing to guess which one`,
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
   * Which context currently hosts the Employee Search panel.
   *
   * Live 2026-08-12: a fresh home load renders it inside
   * `iframe[name^="portal-frame-"]` (the suffix is session-scoped), and after a
   * timecard navigation it renders top-level with NO named frames on the page
   * at all. Probing the panel's own query field is what decides; there is no
   * default, and failing to find it in either context is a loud refusal.
   */
  const resolvePanelRoot = async (): Promise<{ root: PanelRoot; context: PanelContext }> => {
    const probe = await pollUntil(clock, PANEL_CONTEXT_TIMEOUT_MS, async () => {
      const frame = page.frameLocator(NEW_KRONOS_PORTAL_FRAME_SELECTOR);
      if (await resolveRecipe(frame, NEW_KRONOS_SEARCH_QUERY_FIELD).count() > 0) {
        return { root: frame as PanelRoot, context: "portal-frame" as PanelContext };
      }
      if (await resolveRecipe(page, NEW_KRONOS_SEARCH_QUERY_FIELD).count() > 0) {
        return { root: page as PanelRoot, context: "top-level" as PanelContext };
      }
      return null;
    });
    if (probe.value === null) {
      throw new NewKronosDriverError(
        `the Employee Search query field rendered in neither the ${NEW_KRONOS_PORTAL_FRAME_SELECTOR} context `
        + `nor top-level within ${String(PANEL_CONTEXT_TIMEOUT_MS)}ms — the search panel did not open`,
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
   * Every rendered candidate, off each slat's OWN accessible name.
   *
   * Live 2026-08-12 the row carries `aria-label="Name <name> ID <eid>"` — so the
   * row IS the identity and no separate EID text match is needed (legacy's
   * `getByText(eid)` could hit the search box's own echo of the query).
   */
  const readCandidates = async (root: PanelRoot): Promise<NewKronosSearchCandidate[]> => {
    const labels = await resolveRecipe(root, NEW_KRONOS_SEARCH_RESULT_SLAT)
      .evaluateAll((rows) => rows.map((row) => {
        const aria = row.getAttribute("aria-label");
        if (typeof aria === "string" && aria.length > 0) return aria;
        const text = row.textContent;
        return typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "";
      }));
    const candidates: NewKronosSearchCandidate[] = [];
    for (const label of labels) {
      const match = /^Name\s+(.+?)\s+ID\s+(\d{6,10})$/u.exec(label.replace(/\s+/gu, " ").trim());
      if (match === null) {
        throw new NewKronosDriverError(
          `an Employee Search result row does not carry the "Name <name> ID <eid>" identity `
          + `WFD renders — observed ${JSON.stringify(label)}; refusing to read a row whose subject is unknown`,
        );
      }
      const [, displayName = "", employeeId = ""] = match;
      candidates.push({ displayName, employeeId });
    }
    return candidates;
  };

  const searchEmployee = async (
    input: Readonly<{ employeeId: string; searchTimeoutMs: number }>,
  ): Promise<NewKronosSearchRead> => {
    // Closing a panel that may not be open is genuinely optional and nothing
    // downstream reads its result: the panel state is re-established below and
    // proved by `resolvePanelRoot`. This is the one swallow in this file.
    await closeSearchPanel();

    const openButton = await exactlyOne(page, NEW_KRONOS_SEARCH_OPEN_BUTTON);
    await openButton.click({ timeout: CONTROL_TIMEOUT_MS });

    const { root, context } = await resolvePanelRoot();
    const queryField = await exactlyOne(root, NEW_KRONOS_SEARCH_QUERY_FIELD);
    await queryField.fill(input.employeeId, { timeout: CONTROL_TIMEOUT_MS });
    const submit = await exactlyOne(root, NEW_KRONOS_SEARCH_SUBMIT_BUTTON);
    await submit.click({ timeout: CONTROL_TIMEOUT_MS });

    // legacy navigate.ts:142-178 — poll BOTH contexts and let a found signal
    // beat the sentinel: WFD renders both briefly while the grid loads (legacy
    // live 2026-07-06, and the reason a Promise.race mis-resolved a real hit).
    const roots: PanelRoot[] = [page.frameLocator(NEW_KRONOS_PORTAL_FRAME_SELECTOR), page];
    const outcome = await pollUntil(clock, input.searchTimeoutMs, async () => {
      for (const candidateRoot of roots) {
        if (await resolveRecipe(candidateRoot, NEW_KRONOS_SEARCH_RESULT_SLAT).count() > 0) {
          return { kind: "results" as const, root: candidateRoot };
        }
      }
      for (const candidateRoot of roots) {
        if (await resolveRecipe(candidateRoot, NEW_KRONOS_SEARCH_NO_RESULTS_TEXT).count() > 0) {
          return { kind: "sentinel" as const, root: candidateRoot };
        }
      }
      return null;
    });

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
    const candidates = await readCandidates(resultRoot);
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

  /** Set one range field by REAL keystrokes and poll it back, or refuse. */
  const setRangeField = async (id: ElementId, value: string, label: string): Promise<void> => {
    const field = await exactlyOne(page, id);
    await field.click({ timeout: CONTROL_TIMEOUT_MS });
    await field.press("ControlOrMeta+a", { timeout: CONTROL_TIMEOUT_MS });
    // `fill()` is silently reverted by WFD's Angular digest in text mode
    // (measured 2026-08-12: 6 samples over 2.4s all read the pre-fill value).
    // Real key events stick, which is why the calendar path is not ported.
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
        `could not set the timecard ${label} date to ${value} — the field last read `
        + `${JSON.stringify(lastObserved.length === 0 ? "<empty>" : lastObserved)} after `
        + `${String(RANGE_FIELD_SETTLE_TIMEOUT_MS)}ms; refusing to apply a wrong timecard window`,
      );
    }
  };

  const readPeriodLabel = async (): Promise<string> => {
    const label = await exactlyOne(page, NEW_KRONOS_TIMECARD_PERIOD_LABEL);
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
   * Read the whole virtualized grid: scroll the pinned viewport in steps and
   * accumulate every distinct (day, cells) row, binding columns BY HEADER NAME.
   *
   * The scroll loop lives inside one `page.evaluate` because a Playwright-side
   * loop would need a sleep between steps; in-page it waits on a CONDITION (the
   * first rendered date row changing) with its own bound. The returned rows are
   * raw strings — every derivation happens in the domain fold.
   */
  const readGrid = async (): Promise<{
    rows: TimecardGridRow[];
    headers: string[];
    scrollSteps: number;
  }> => {
    const harvest = await page.evaluate(async (pollMs: number) => {
      const viewports = [...document.querySelectorAll(".ui-grid-viewport")];
      const dateViewport = viewports[0];
      const dataViewport = viewports[viewports.length - 1];
      if (dateViewport === undefined || dataViewport === undefined || viewports.length < 2) {
        return { rows: [], headers: [], scrollSteps: 0, viewportCount: viewports.length };
      }
      const headers = [...document.querySelectorAll(".ui-grid-header-cell")]
        .map((cell) => (cell.textContent ?? "").replace(/\s+/g, " ").trim())
        .filter((text) => text.length > 0 && text !== ".");
      const seen = new Map<string, { month: number; day: number; rawDateCell: string; cells: string[] }>();
      const collect = (): string => {
        const dateRows = [...dateViewport.querySelectorAll("[role=row]")];
        const dataRows = [...dataViewport.querySelectorAll("[role=row]")];
        let carried: { month: number; day: number; rawDateCell: string } | null = null;
        for (let index = 0; index < Math.max(dateRows.length, dataRows.length); index++) {
          const dateRow = dateRows[index];
          const raw = dateRow === undefined ? "" : (dateRow.textContent ?? "").replace(/\s+/g, " ").trim();
          const match = /([A-Za-z]{3})\s+(\d{1,2})\/(\d{1,2})/.exec(raw);
          if (match !== null) {
            carried = { month: Number(match[2]), day: Number(match[3]), rawDateCell: raw };
          }
          if (carried === null) continue;
          const dataRow = dataRows[index];
          const cells = dataRow === undefined
            ? []
            : [...dataRow.querySelectorAll("[role=gridcell]")]
              .map((cell) => (cell.textContent ?? "").replace(/\s+/g, " ").trim());
          seen.set(`${String(carried.month)}/${String(carried.day)}|${cells.join(" ")}`, {
            month: carried.month,
            day: carried.day,
            rawDateCell: match === null ? "" : carried.rawDateCell,
            cells,
          });
        }
        const first = dateRows[0];
        return first === undefined ? "" : (first.textContent ?? "").trim();
      };

      dateViewport.scrollTop = 0;
      // Wait for the reset to render before the first harvest: the CONDITION is
      // the top row settling, not a fixed delay.
      for (let attempt = 0; attempt < 20 && dateViewport.scrollTop !== 0; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, pollMs));
      }
      let anchor = collect();
      let scrollSteps = 0;
      for (let step = 0; step < 200; step++) {
        const before = dateViewport.scrollTop;
        dateViewport.scrollTop = before + Math.max(1, Math.floor(dateViewport.clientHeight * 0.8));
        if (dateViewport.scrollTop === before) break;
        scrollSteps++;
        for (let attempt = 0; attempt < 20; attempt++) {
          const observed = collect();
          if (observed !== anchor) { anchor = observed; break; }
          await new Promise((resolve) => setTimeout(resolve, pollMs));
        }
      }
      collect();
      return {
        rows: [...seen.values()],
        headers,
        scrollSteps,
        viewportCount: viewports.length,
      };
    }, POLL_INTERVAL_MS);

    if (harvest.viewportCount < 2) {
      throw new NewKronosDriverError(
        `the timecard grid rendered ${String(harvest.viewportCount)} viewports, expected the pinned date column `
        + "plus the data column — the timecard did not load",
      );
    }
    const columns = resolveTimecardColumns(harvest.headers);
    const cellAt = (cells: readonly string[], column: keyof typeof columns): string =>
      cells[columns[column]] ?? "";
    const rows: TimecardGridRow[] = harvest.rows.map((row) => ({
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
    return { rows, headers: harvest.headers, scrollSteps: harvest.scrollSteps };
  };

  const readSeparationTimecard = async (
    input: Readonly<{ employeeId: string; rangeStart: string; rangeEnd: string }>,
  ): Promise<NewKronosTimecardRead> => {
    const { root } = await resolvePanelRoot();

    // legacy navigate.ts:445-470 — Go To must be visible AND ENABLED. A failure
    // here is MECHANICAL and must throw; it is never "this person has no card"
    // (S36).
    const goTo = await exactlyOne(root, NEW_KRONOS_SEARCH_GO_TO_BUTTON);
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
    const option = await exactlyOne(root, NEW_KRONOS_SEARCH_GO_TO_TIMECARD_OPTION);
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

    const idNode = await exactlyOne(page, NEW_KRONOS_TIMECARD_EMPLOYEE_ID);
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
    const trigger = await exactlyOne(page, NEW_KRONOS_TIMECARD_PERIOD_TRIGGER);
    await trigger.click({ timeout: CONTROL_TIMEOUT_MS });
    const selectRange = await exactlyOne(page, NEW_KRONOS_TIMECARD_SELECT_RANGE_BUTTON);
    await selectRange.click({ timeout: CONTROL_TIMEOUT_MS });
    await setRangeField(NEW_KRONOS_TIMECARD_RANGE_START_FIELD, input.rangeStart, "start");
    await setRangeField(NEW_KRONOS_TIMECARD_RANGE_END_FIELD, input.rangeEnd, "end");
    // Setting the end can nudge the start (the widget auto-advances between the
    // two tabs), so the start is re-proved before Apply.
    await setRangeField(NEW_KRONOS_TIMECARD_RANGE_START_FIELD, input.rangeStart, "start (re-proof)");
    const apply = await exactlyOne(page, NEW_KRONOS_TIMECARD_RANGE_APPLY_BUTTON);
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

    const { rows, headers, scrollSteps } = await readGrid();
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
 * The injected `Clock` is the ONE time source (doc 11): every `observedAt` here
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
