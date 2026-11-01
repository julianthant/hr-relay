
import type { FrameLocator, Locator, Page } from "playwright";
import { recordBrowserAction } from "../../browser-shared/action-notes.js";
import type { Clock } from "../../../../rules/time/clock.js";
import { IsoInstantSchema } from "../../../../rules/identity/ids.js";
import {
  foldSeparationTimecard,
  formatRangeBound,
  parseAppliedRangeLabel,
  parseTimecardDate,
  rangesAreSameDays,
  resolveTimecardColumns,
} from "../../../../rules/kronos/separation-timecard.js";
import { readVirtualizedGrid } from "./grid-scroll.js";
import type { RawTimecardGridRow } from "./grid-scroll.js";
import { judgeSearchRender, parseSlatIdentity, slatRenderComplete } from "./search-render.js";
import type { SlatRenderFact } from "./search-render.js";
import type { TimecardGridRow } from "../../../../rules/kronos/separation-timecard.js";
import type { TimecardDateRange } from "../../../../rules/time/timecard-period.js";
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
} from "../../../../models/ui/new-kronos-timecard.js";
import type {
  NewKronosSearchCandidate,
  NewKronosSearchRead,
  NewKronosTimecardDriver,
  NewKronosTimecardRead,
} from "../../../../models/ui/new-kronos-timecard.js";
import type { ElementId } from "../../../../rules/identity/ids.js";
import { directIdentifierDisplay } from "../../../../rules/redaction/redaction.js";
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
// Require consecutive sentinel-only polls because search hydration briefly overlaps results and no-results.
const NO_RESULTS_STABLE_POLLS = 15;

const PANEL_SEARCH_TIMEOUT_MS = 20_000;
// Read identity from each interpolated slat card; the aria-label can be gated off.
const NEW_KRONOS_SLAT_TABULAR_DATA_SELECTOR = "krn-slats-tabular-data";


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

// Wait for exactly one node; WFD chrome renders after route settlement.
async function exactlyOne(assertCurrent: () => void, clock: Clock, root: PanelRoot, id: ElementId): Promise<Locator> {
  const candidates = resolveRecipe(root, id);
  assertCurrent();
  const settled = await pollUntil(clock, CONTROL_TIMEOUT_MS, async () => {
    assertCurrent();
    const count = await candidates.count();
    assertCurrent();
    return count === 0 ? null : count;
  });
  if (settled.value === 1) {
    assertCurrent();
    return candidates;
  }
  const observed = settled.value === null ? 0 : settled.value;
  throw new NewKronosDriverError(
    `semantic element ${id} resolved to ${String(observed)} nodes after ${String(settled.waitedMs)}ms, `
    + "expected exactly 1 — refusing to guess which one",
  );
}


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

export function createNewKronosTimecardDriver(assertCurrent: () => void, page: Page, clock: Clock): NewKronosTimecardDriver {
  const nowIso = (): string => IsoInstantSchema.parse(clock.now().toISOString());

  // Choose search context by the state's anchor; unloaded and populated search panels expose different controls.
  const resolvePanelRoot = async (
    anchor: ElementId,
  ): Promise<{ root: PanelRoot; context: PanelContext }> => {
    assertCurrent();
    const probe = await pollUntil<{ root: PanelRoot; context: PanelContext }>(clock, PANEL_CONTEXT_TIMEOUT_MS, async () => {
      const frame = page.frameLocator(NEW_KRONOS_PORTAL_FRAME_SELECTOR);
      assertCurrent();
      if (await resolveRecipe(frame, anchor).count() > 0) {
        assertCurrent();
        return { root: frame, context: "portal-frame" };
      }
      assertCurrent();
      if (await resolveRecipe(page, anchor).count() > 0) {
        assertCurrent();
        return { root: page, context: "top-level" };
      }
      assertCurrent();
      return null;
    });
    if (probe.value === null) {
      throw new NewKronosDriverError(
        `the Employee Search panel's ${anchor} rendered in neither the `
        + `${NEW_KRONOS_PORTAL_FRAME_SELECTOR} context nor top-level within `
        + `${String(PANEL_CONTEXT_TIMEOUT_MS)}ms — the panel is not in the state this step needs`,
      );
    }
    assertCurrent();
    return probe.value;
  };

  /** Read WFD's own `Total [N]` / `Selected [N]` counters. */
  const readCounters = async (root: PanelRoot): Promise<{ total: number | null; selected: number | null }> => {
    assertCurrent();
    const texts = await root.locator("p.totals-counter").allTextContents();
    const parse = (label: string): number | null => {
      const row = texts.find((text) => text.replace(/\s+/gu, " ").trim().startsWith(label));
      if (row === undefined) return null;
      const match = /\[(\d+)\]/u.exec(row);
      return match?.[1] === undefined ? null : Number(match[1]);
    };
    assertCurrent();
    return { total: parse("Total"), selected: parse("Selected") };
  };


  const readSlatFacts = async (root: PanelRoot): Promise<SlatRenderFact[]> => {
    assertCurrent();
    const result = await resolveRecipe(root, NEW_KRONOS_SEARCH_RESULT_SLAT)
    .evaluateAll((rows, tabularDataSelector) => rows.map((row) => {
      const aria = row.getAttribute("aria-label");
      const text = row.textContent;
      const label = typeof aria === "string" && aria.length > 0
        ? aria
        : (typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "");
      return { label, cardRendered: row.querySelector(tabularDataSelector) !== null };
    }), NEW_KRONOS_SLAT_TABULAR_DATA_SELECTOR);
    assertCurrent();
    return result;
  };

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


  const selectEmployeeInPanel = async (
    employeeId: string,
  ): Promise<{ root: PanelRoot; context: PanelContext }> => {
    assertCurrent();
    const read = await searchEmployee({ employeeId, searchTimeoutMs: PANEL_SEARCH_TIMEOUT_MS });
    if (read.state !== "resolved") {
      throw new NewKronosDriverError(
        `could not select EID ${directIdentifierDisplay(employeeId)} in the Employee Search panel before opening the timecard: `
        + `the search answered ${read.state} — this is a navigation failure, not an empty timecard`,
      );
    }
    // After a search the panel's query field collapses into `Show Search`, so
    // the Go To button is what proves the context from here on.
    const result = await resolvePanelRoot(NEW_KRONOS_SEARCH_GO_TO_BUTTON);
    assertCurrent();
    return result;
  };

  const searchEmployee = async (
    input: Readonly<{ employeeId: string; searchTimeoutMs: number }>,
  ): Promise<NewKronosSearchRead> => {

    assertCurrent();
    await closeSearchPanel();

    assertCurrent();
    const openButton = await exactlyOne(assertCurrent, clock, page, NEW_KRONOS_SEARCH_OPEN_BUTTON);
    assertCurrent();
    await openButton.click({ timeout: CONTROL_TIMEOUT_MS });
    assertCurrent();
    recordBrowserAction("clicked", NEW_KRONOS_SEARCH_OPEN_BUTTON);

    assertCurrent();
    const { root, context } = await resolvePanelRoot(NEW_KRONOS_SEARCH_QUERY_FIELD);
    assertCurrent();
    const queryField = await exactlyOne(assertCurrent, clock, root, NEW_KRONOS_SEARCH_QUERY_FIELD);
    assertCurrent();
    await queryField.fill(input.employeeId, { timeout: CONTROL_TIMEOUT_MS });
    assertCurrent();
    recordBrowserAction("typed", NEW_KRONOS_SEARCH_QUERY_FIELD, input.employeeId);
    assertCurrent();
    const submit = await exactlyOne(assertCurrent, clock, root, NEW_KRONOS_SEARCH_SUBMIT_BUTTON);
    assertCurrent();
    await submit.click({ timeout: CONTROL_TIMEOUT_MS });
    assertCurrent();
    recordBrowserAction("clicked", NEW_KRONOS_SEARCH_SUBMIT_BUTTON);

    // Poll both search contexts; a real result wins over a briefly overlapping no-results sentinel.
    const roots: PanelRoot[] = [page.frameLocator(NEW_KRONOS_PORTAL_FRAME_SELECTOR), page];
    // WFD briefly renders results with its sentinel; require consecutive sentinel-only polls for absence.
    let sentinelStreak = 0;
    let hydratingAtLastPoll: readonly SlatRenderFact[] | null = null;
    assertCurrent();
    const outcome = await pollUntil(clock, input.searchTimeoutMs, async () => {
      hydratingAtLastPoll = null;
      for (const candidateRoot of roots) {
        // Count frames before reading; timecard navigation can remove the portal iframe.
        assertCurrent();
        if (await resolveRecipe(candidateRoot, NEW_KRONOS_SEARCH_RESULT_SLAT).count() === 0) continue;
        assertCurrent();
        const slats = await readSlatFacts(candidateRoot);
        const verdict = judgeSearchRender(slats);
        if (verdict === "results") {
          assertCurrent();
          return { kind: "results" as const, root: candidateRoot, slats };
        }
        if (verdict === "hydrating") {
          // Rows exist, so whatever the sentinel says it is the loading state.
          sentinelStreak = 0;
          hydratingAtLastPoll = slats;
          assertCurrent();
          return null;
        }
      }
      for (const candidateRoot of roots) {
        assertCurrent();
        if (await resolveRecipe(candidateRoot, NEW_KRONOS_SEARCH_NO_RESULTS_TEXT).count() > 0) {
          sentinelStreak++;
          assertCurrent();
          return sentinelStreak >= NO_RESULTS_STABLE_POLLS
            ? { kind: "sentinel" as const, root: candidateRoot }
            : null;
        }
      }

      sentinelStreak = 0;
      assertCurrent();
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

      assertCurrent();
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
      assertCurrent();
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
    assertCurrent();
    const counters = await readCounters(resultRoot);
    if (counters.total === null) {
      throw new NewKronosDriverError(
        `the Employee Search panel rendered ${String(candidates.length)} result row(s) but no "Total [N]" `
        + "counter — refusing to substitute the rendered count for WFD's own, because a virtualized or "
        + "paged result set would make them disagree",
      );
    }
    const totalCount = counters.total;
    if (candidates.length !== totalCount) {
      throw new NewKronosDriverError(
        `the Employee Search panel rendered ${String(candidates.length)} candidate(s) against Total [${String(totalCount)}] — `
        + "the result set is incomplete, so neither a match nor employee absence can be established",
      );
    }
    const matched = candidates.find(({ employeeId }) => employeeId === input.employeeId);
    if (matched === undefined) {
      assertCurrent();
      return NewKronosSearchReadSchema.parse({
        state: "no-match",
        query: input.employeeId,
        totalCount,
        candidates,
        panelContext: context,
        observedAt: nowIso(),
      });
    }

    // The Select Item checkbox registers Angular slat selection; a highlighted row alone does not.
    const checkbox = resolveRecipe(resultRoot, NEW_KRONOS_SEARCH_RESULT_SLAT)
      .nth(candidates.indexOf(matched))
      .getByRole("checkbox", { name: "Select Item", exact: true });
    assertCurrent();
    await checkbox.check({ timeout: CONTROL_TIMEOUT_MS });
    assertCurrent();
    recordBrowserAction("checked", NEW_KRONOS_SEARCH_RESULT_SLAT);

    assertCurrent();
    const enabled = await pollUntil(clock, SELECTION_TIMEOUT_MS, async () => {
      const goTo = resolveRecipe(resultRoot, NEW_KRONOS_SEARCH_GO_TO_BUTTON);
      assertCurrent();
      if (await goTo.count() !== 1) {
        assertCurrent();
        return null;
      }
      assertCurrent();
      const result = await goTo.isEnabled() ? true : null;
      assertCurrent();
      return result;
    });
    if (enabled.value === null) {
      throw new NewKronosDriverError(
        `Employee Search selected ${directIdentifierDisplay(input.employeeId)} but the Go To control never became enabled within `
        + `${String(SELECTION_TIMEOUT_MS)}ms — no slat is registered, so the timecard cannot be opened`,
      );
    }
    assertCurrent();
    const afterSelect = await readCounters(resultRoot);
    if (afterSelect.selected === null) {
      throw new NewKronosDriverError(
        `the Employee Search panel rendered no "Selected [N]" counter after checking ${directIdentifierDisplay(input.employeeId)} — `
        + "the selection cannot be proved, and Go To being enabled alone is not the count",
      );
    }
    const selectedCount = afterSelect.selected;
    if (selectedCount < 1) {
      throw new NewKronosDriverError(
        `Employee Search reports Selected [${String(selectedCount)}] after checking ${directIdentifierDisplay(input.employeeId)} — `
        + "the selection did not register",
      );
    }

    assertCurrent();
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


  const closeSearchPanel = async (): Promise<void> => {
    for (const root of [page.frameLocator(NEW_KRONOS_PORTAL_FRAME_SELECTOR), page]) {
      const close = resolveRecipe(root, NEW_KRONOS_SEARCH_CLOSE_BUTTON);
      assertCurrent();
      if (await close.count() !== 1) continue;
      assertCurrent();
      await close.click({ timeout: CONTROL_TIMEOUT_MS });
      assertCurrent();
      recordBrowserAction("clicked", NEW_KRONOS_SEARCH_CLOSE_BUTTON);
      return;
    }
    assertCurrent();
  };

  // WFD masked date controls revert fill calls; use the verified typing path.
  const setRangeField = async (id: ElementId, value: string, label: string): Promise<void> => {
    assertCurrent();
    const field = await exactlyOne(assertCurrent, clock, page, id);
    assertCurrent();
    await field.click({ timeout: CONTROL_TIMEOUT_MS });
    assertCurrent();
    recordBrowserAction("clicked", id);
    assertCurrent();
    const priorValue = await field.inputValue();
    assertCurrent();
    await field.press("ControlOrMeta+a", { timeout: CONTROL_TIMEOUT_MS });
    assertCurrent();
    recordBrowserAction("selected", id);
    assertCurrent();
    await field.pressSequentially(value, { delay: 60, timeout: CONTROL_TIMEOUT_MS });
    assertCurrent();
    recordBrowserAction("typed", id, value);
    const wanted = parseTimecardDate(value, `${label} date`);
    // The last value the poll actually SAW, so the refusal below reports the
    // observation instead of re-reading a field that may already have moved.
    let lastObserved = "";
    assertCurrent();
    const settled = await pollUntil(clock, RANGE_FIELD_SETTLE_TIMEOUT_MS, async () => {
      assertCurrent();
      const raw = await field.inputValue();
      lastObserved = raw;
      const parsed = /^\d{1,2}\/\d{1,2}\/\d{4}$/u.test(raw.trim())
        ? parseTimecardDate(raw.trim(), `${label} readback`)
        : null;
      // WFD date padding varies between fields; compare calendar days rather than strings.
      assertCurrent();
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
    assertCurrent();
  };

  const readPeriodLabel = async (): Promise<string> => {
    assertCurrent();
    const label = await exactlyOne(assertCurrent, clock, page, NEW_KRONOS_TIMECARD_PERIOD_LABEL);
    assertCurrent();
    const text = await label.textContent();
    if (text === null) {
      throw new NewKronosDriverError(
        "the timecard period label node carries no text — the active window cannot be read, "
        + "and an unreadable window is never an applied one",
      );
    }
    assertCurrent();
    return text.replace(/\s+/gu, " ").trim();
  };

  // Scroll the body, bind columns by header name, and prove every applied day before returning rows.
  const readGrid = async (applied: TimecardDateRange): Promise<{
    rows: TimecardGridRow[];
    headers: string[];
    scrollSteps: number;
  }> => {
    // Keep page callbacks anonymous and small; tsx helper bindings are unavailable inside page evaluation.
    const harvestOnce = async (): Promise<{
      rows: readonly { month: number; day: number; rawDateCell: string; cells: readonly string[] }[];
      headers: readonly string[];
      dateRowCount: number;
      dataRowCount: number;
      viewportCount: number;
      topRow: string;
      scrollTop: number;
      scrollHeight: number;
      clientHeight: number;
    }> => {
      assertCurrent();
      const result = await page.evaluate(() => {
      const viewports = [...document.querySelectorAll(".ui-grid-viewport")];
      const dateViewport = viewports[0];
      const dataViewport = viewports[viewports.length - 1];
      if (dateViewport === undefined || dataViewport === undefined || viewports.length < 2) {
        return {
          rows: [], headers: [], viewportCount: viewports.length, dateRowCount: 0, dataRowCount: 0,
          topRow: "", scrollTop: 0, scrollHeight: 0, clientHeight: 0,
        };
      }
      // Read headers only from the data container; pinned headers would duplicate column names.
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
      return {
        rows,
        headers,
        dateRowCount: dateRows.length,
        dataRowCount: dataRows.length,
        viewportCount: viewports.length,
        topRow: first === undefined ? "" : (first.textContent ?? "").trim(),
        scrollTop: dataViewport.scrollTop,
        scrollHeight: dataViewport.scrollHeight,
        clientHeight: dataViewport.clientHeight,
      };
    });
      assertCurrent();
      return result;
    };

    // Scroll each grid viewport, but read the data body; pinned regions can share the scroll control.
    const scrollGridTo = async (top: number): Promise<{
      scrollTop: number;
      scrollHeight: number;
      clientHeight: number;
    }> => {
      assertCurrent();
      const result = await page.evaluate((position: number) => {
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
      assertCurrent();
      return result;
    };

    assertCurrent();
    const opening = await harvestOnce();
    const headers = opening.headers;
    if (opening.viewportCount < 2) {
      throw new NewKronosDriverError(
        `the timecard grid rendered ${String(opening.viewportCount)} viewports, expected the pinned date `
        + "column plus the data column — the timecard did not load",
      );
    }
    const validateHarvest = (harvest: Awaited<ReturnType<typeof harvestOnce>>): void => {
      if (harvest.viewportCount < 2 || harvest.dateRowCount !== harvest.dataRowCount
        || harvest.rows.length !== harvest.dateRowCount) {
        throw new NewKronosDriverError(
          `the timecard grid has unaligned date/data row counts ${String(harvest.dateRowCount)}/${String(harvest.dataRowCount)} `
          + `and ${String(harvest.rows.length)} dated row(s) — refusing an incomplete row window`,
        );
      }
      if (harvest.headers.length !== headers.length
        || harvest.headers.some((header, index) => header !== headers[index])) {
        throw new NewKronosDriverError("the timecard grid headers changed during repaint — refusing a changed column mapping");
      }
      for (const row of harvest.rows) {
        if (row.cells.length !== headers.length) {
          throw new NewKronosDriverError(
            `the timecard grid row ${String(row.month)}/${String(row.day)} renders ${String(row.cells.length)} cell(s) against `
            + `${String(headers.length)} data header(s) — refusing a missing or truncated data row`,
          );
        }
      }
    };
    validateHarvest(opening);
    const columns = resolveTimecardColumns(headers);
    const cellAt = (cells: readonly string[], column: keyof typeof columns): string =>
      cells[columns[column]] ?? "";
    assertCurrent();
    const read = await readVirtualizedGrid(
      {
        harvest: async () => {
          assertCurrent();
          const harvest = await harvestOnce();
          validateHarvest(harvest);
          assertCurrent();
          return harvest;
        },
        scrollTo: scrollGridTo,
        settle: async () => {
          assertCurrent();
          await tick(POLL_INTERVAL_MS);
          assertCurrent();
        },
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
    assertCurrent();
    return { rows, headers: [...headers], scrollSteps: read.scrollSteps };
  };

  const readSeparationTimecard = async (
    input: Readonly<{ employeeId: string; rangeStart: string; rangeEnd: string }>,
  ): Promise<NewKronosTimecardRead> => {

    assertCurrent();
    const { root } = await selectEmployeeInPanel(input.employeeId);


    assertCurrent();
    const goTo = await exactlyOne(assertCurrent, clock, root, NEW_KRONOS_SEARCH_GO_TO_BUTTON);
    assertCurrent();
    if (!(await goTo.isEnabled())) {
      throw new NewKronosDriverError(
        `the Go To control is disabled for EID ${directIdentifierDisplay(input.employeeId)} — no employee is selected in the search `
        + "panel, so the timecard cannot be opened; this is a navigation failure, not an empty timecard",
      );
    }
    assertCurrent();
    await goTo.click({ timeout: CONTROL_TIMEOUT_MS });
    assertCurrent();
    recordBrowserAction("clicked", NEW_KRONOS_SEARCH_GO_TO_BUTTON);

    assertCurrent();
    const optionReady = await pollUntil(clock, CONTROL_TIMEOUT_MS, async () => {
      assertCurrent();
      const result = await resolveRecipe(root, NEW_KRONOS_SEARCH_GO_TO_TIMECARD_OPTION).count() === 1 ? true : null;
      assertCurrent();
      return result;
    });
    if (optionReady.value === null) {
      throw new NewKronosDriverError(
        `the Go To menu never rendered exactly one "Timecard" option within ${String(CONTROL_TIMEOUT_MS)}ms `
        + `for EID ${directIdentifierDisplay(input.employeeId)} — the timecard could not be opened`,
      );
    }
    assertCurrent();
    const option = await exactlyOne(assertCurrent, clock, root, NEW_KRONOS_SEARCH_GO_TO_TIMECARD_OPTION);
    assertCurrent();
    await option.click({ timeout: CONTROL_TIMEOUT_MS });
    assertCurrent();
    recordBrowserAction("clicked", NEW_KRONOS_SEARCH_GO_TO_TIMECARD_OPTION);

    assertCurrent();
    const landed = await pollUntil(clock, TIMECARD_NAVIGATION_TIMEOUT_MS, async () => {
      assertCurrent();
      if (!page.url().includes(NEW_KRONOS_TIMECARD_ROUTE)) {
        assertCurrent();
        return null;
      }
      assertCurrent();
      const result = await resolveRecipe(page, NEW_KRONOS_TIMECARD_EMPLOYEE_ID).count() === 1 ? true : null;
      assertCurrent();
      return result;
    });
    if (landed.value === null) {
      assertCurrent();
      throw new NewKronosDriverError(
        `Go To -> Timecard did not reach ${NEW_KRONOS_TIMECARD_ROUTE} with an identifiable employee header `
        + `within ${String(TIMECARD_NAVIGATION_TIMEOUT_MS)}ms for EID ${directIdentifierDisplay(input.employeeId)} `
        + `(observed URL ${page.url()}) — refusing to read a page that is not a loaded timecard`,
      );
    }

    // Close search before proving the timecard subject; its input echo can masquerade as identity.
    assertCurrent();
    await closeSearchPanel();

    assertCurrent();
    const idNode = await exactlyOne(assertCurrent, clock, page, NEW_KRONOS_TIMECARD_EMPLOYEE_ID);
    assertCurrent();
    const idText = await idNode.textContent();
    const observedEmployeeId = idText === null ? "" : idText.trim();

    if (observedEmployeeId.length === 0) {
      throw new NewKronosDriverError(
        `the timecard's ${NEW_KRONOS_TIMECARD_DISPLAYED_EID} observation is empty for expected EID `
        + `${directIdentifierDisplay(input.employeeId)} — the header did not render, so the subject cannot be proved`,
      );
    }

    const nameNode = page.locator("#combo_inptxt");
    assertCurrent();
    const nameCount = await nameNode.count();
    assertCurrent();
    const nameTitle = nameCount === 1 ? await nameNode.getAttribute("title") : null;
    const observedDisplayName = nameTitle === null ? "" : nameTitle.trim();
    if (observedDisplayName.length === 0) {
      throw new NewKronosDriverError(
        `the timecard does not display an employee name beside EID ${directIdentifierDisplay(observedEmployeeId)} — `
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
    assertCurrent();
    const trigger = await exactlyOne(assertCurrent, clock, page, NEW_KRONOS_TIMECARD_PERIOD_TRIGGER);
    assertCurrent();
    await trigger.click({ timeout: CONTROL_TIMEOUT_MS });
    assertCurrent();
    recordBrowserAction("clicked", NEW_KRONOS_TIMECARD_PERIOD_TRIGGER);
    assertCurrent();
    const selectRange = await exactlyOne(assertCurrent, clock, page, NEW_KRONOS_TIMECARD_SELECT_RANGE_BUTTON);
    assertCurrent();
    await selectRange.click({ timeout: CONTROL_TIMEOUT_MS });
    assertCurrent();
    recordBrowserAction("clicked", NEW_KRONOS_TIMECARD_SELECT_RANGE_BUTTON);
    assertCurrent();
    await setRangeField(NEW_KRONOS_TIMECARD_RANGE_START_FIELD, input.rangeStart, "start");
    assertCurrent();
    await setRangeField(NEW_KRONOS_TIMECARD_RANGE_END_FIELD, input.rangeEnd, "end");
    // Setting the end can nudge the start (the widget auto-advances between the
    // two tabs), so the start is re-proved before Apply.
    assertCurrent();
    await setRangeField(NEW_KRONOS_TIMECARD_RANGE_START_FIELD, input.rangeStart, "start (re-proof)");
    assertCurrent();
    const apply = await exactlyOne(assertCurrent, clock, page, NEW_KRONOS_TIMECARD_RANGE_APPLY_BUTTON);
    assertCurrent();
    await apply.click({ timeout: CONTROL_TIMEOUT_MS });
    assertCurrent();
    recordBrowserAction("clicked", NEW_KRONOS_TIMECARD_RANGE_APPLY_BUTTON);

    const requested = {
      start: parseTimecardDate(input.rangeStart, "requested range start"),
      end: parseTimecardDate(input.rangeEnd, "requested range end"),
    };
    assertCurrent();
    const applied = await pollUntil(clock, RANGE_APPLY_TIMEOUT_MS, async () => {
      assertCurrent();
      const label = await readPeriodLabel();
      const parsed = parseAppliedRangeLabel(label);
      assertCurrent();
      return parsed !== null && rangesAreSameDays(parsed, requested) ? { label, parsed } : null;
    });
    if (applied.value === null) {
      assertCurrent();
      const label = await readPeriodLabel();
      throw new NewKronosDriverError(
        `the timecard period label reads ${JSON.stringify(label)} after applying `
        + `${input.rangeStart} - ${input.rangeEnd} — the requested window is not the one displayed, `
        + "so the grid would be read on the wrong period",
      );
    }

    assertCurrent();
    const { rows, headers, scrollSteps } = await readGrid(applied.value.parsed);
    const fold = foldSeparationTimecard(rows, applied.value.parsed);
    const daysCovered = new Set(rows.map((row) => `${String(row.month)}/${String(row.day)}`)).size;
    const populatedRows = rows.filter((row) =>
      row.punchIn !== "" || row.punchOut !== "" || row.payCode !== ""
      || row.amount !== "" || row.daily !== "" || row.absence !== "").length;

    assertCurrent();
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

  return NewKronosTimecardDriverSchema.parse({
    system: "new-kronos",
    searchEmployee,
    readSeparationTimecard,
  });
}
