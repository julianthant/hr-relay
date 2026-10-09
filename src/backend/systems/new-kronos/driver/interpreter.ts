
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

  // Choose search context by the state's anchor; unloaded and populated search panels expose different controls.
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


  const selectEmployeeInPanel = async (
    employeeId: string,
  ): Promise<{ root: PanelRoot; context: PanelContext }> => {
    const read = await searchEmployee({ employeeId, searchTimeoutMs: PANEL_SEARCH_TIMEOUT_MS });
    if (read.state !== "resolved") {
      throw new NewKronosDriverError(
        `could not select EID ${directIdentifierDisplay(employeeId)} in the Employee Search panel before opening the timecard: `
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

    await closeSearchPanel();

    const openButton = await exactlyOne(clock, page, NEW_KRONOS_SEARCH_OPEN_BUTTON);
    await openButton.click({ timeout: CONTROL_TIMEOUT_MS });
    recordBrowserAction("clicked", NEW_KRONOS_SEARCH_OPEN_BUTTON);

    const { root, context } = await resolvePanelRoot(NEW_KRONOS_SEARCH_QUERY_FIELD);
    const queryField = await exactlyOne(clock, root, NEW_KRONOS_SEARCH_QUERY_FIELD);
    await queryField.fill(input.employeeId, { timeout: CONTROL_TIMEOUT_MS });
    recordBrowserAction("typed", NEW_KRONOS_SEARCH_QUERY_FIELD, input.employeeId);
    const submit = await exactlyOne(clock, root, NEW_KRONOS_SEARCH_SUBMIT_BUTTON);
    await submit.click({ timeout: CONTROL_TIMEOUT_MS });
    recordBrowserAction("clicked", NEW_KRONOS_SEARCH_SUBMIT_BUTTON);

    // Poll both search contexts; a real result wins over a briefly overlapping no-results sentinel.
    const roots: PanelRoot[] = [page.frameLocator(NEW_KRONOS_PORTAL_FRAME_SELECTOR), page];
    // WFD briefly renders results with its sentinel; require consecutive sentinel-only polls for absence.
    let sentinelStreak = 0;
    let hydratingAtLastPoll: readonly SlatRenderFact[] | null = null;
    const outcome = await pollUntil(clock, input.searchTimeoutMs, async () => {
      hydratingAtLastPoll = null;
      for (const candidateRoot of roots) {
        // Count frames before reading; timecard navigation can remove the portal iframe.
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

    // The Select Item checkbox registers Angular slat selection; a highlighted row alone does not.
    const checkbox = resolveRecipe(resultRoot, NEW_KRONOS_SEARCH_RESULT_SLAT)
      .nth(candidates.indexOf(matched))
      .getByRole("checkbox", { name: "Select Item", exact: true });
    await checkbox.check({ timeout: CONTROL_TIMEOUT_MS });
    recordBrowserAction("checked", NEW_KRONOS_SEARCH_RESULT_SLAT);

    const enabled = await pollUntil(clock, SELECTION_TIMEOUT_MS, async () => {
      const goTo = resolveRecipe(resultRoot, NEW_KRONOS_SEARCH_GO_TO_BUTTON);
      if (await goTo.count() !== 1) return null;
      return await goTo.isEnabled() ? true : null;
    });
    if (enabled.value === null) {
      throw new NewKronosDriverError(
        `Employee Search selected ${directIdentifierDisplay(input.employeeId)} but the Go To control never became enabled within `
        + `${String(SELECTION_TIMEOUT_MS)}ms — no slat is registered, so the timecard cannot be opened`,
      );
    }
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
    for (const root of [page.frameLocator(NEW_KRONOS_PORTAL_FRAME_SELECTOR), page] as PanelRoot[]) {
      const close = resolveRecipe(root, NEW_KRONOS_SEARCH_CLOSE_BUTTON);
      if (await close.count() !== 1) continue;
      await close.click({ timeout: CONTROL_TIMEOUT_MS });
      recordBrowserAction("clicked", NEW_KRONOS_SEARCH_CLOSE_BUTTON);
      return;
    }
  };

  // WFD masked date controls revert fill calls; use the verified typing path.
  const setRangeField = async (id: ElementId, value: string, label: string): Promise<void> => {
    const field = await exactlyOne(clock, page, id);
    await field.click({ timeout: CONTROL_TIMEOUT_MS });
    recordBrowserAction("clicked", id);
    const priorValue = await field.inputValue();
    await field.press("ControlOrMeta+a", { timeout: CONTROL_TIMEOUT_MS });
    recordBrowserAction("selected", id);
    await field.pressSequentially(value, { delay: 60, timeout: CONTROL_TIMEOUT_MS });
    recordBrowserAction("typed", id, value);
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
      // WFD date padding varies between fields; compare calendar days rather than strings.
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

    // Scroll each grid viewport, but read the data body; pinned regions can share the scroll control.
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
    // Headers and cells must have equal counts before using resolved column indices.
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

    const { root } = await selectEmployeeInPanel(input.employeeId);


    const goTo = await exactlyOne(clock, root, NEW_KRONOS_SEARCH_GO_TO_BUTTON);
    if (!(await goTo.isEnabled())) {
      throw new NewKronosDriverError(
        `the Go To control is disabled for EID ${directIdentifierDisplay(input.employeeId)} — no employee is selected in the search `
        + "panel, so the timecard cannot be opened; this is a navigation failure, not an empty timecard",
      );
    }
    await goTo.click({ timeout: CONTROL_TIMEOUT_MS });
    recordBrowserAction("clicked", NEW_KRONOS_SEARCH_GO_TO_BUTTON);

    const optionReady = await pollUntil(clock, CONTROL_TIMEOUT_MS, async () =>
      await resolveRecipe(root, NEW_KRONOS_SEARCH_GO_TO_TIMECARD_OPTION).count() === 1 ? true : null);
    if (optionReady.value === null) {
      throw new NewKronosDriverError(
        `the Go To menu never rendered exactly one "Timecard" option within ${String(CONTROL_TIMEOUT_MS)}ms `
        + `for EID ${directIdentifierDisplay(input.employeeId)} — the timecard could not be opened`,
      );
    }
    const option = await exactlyOne(clock, root, NEW_KRONOS_SEARCH_GO_TO_TIMECARD_OPTION);
    await option.click({ timeout: CONTROL_TIMEOUT_MS });
    recordBrowserAction("clicked", NEW_KRONOS_SEARCH_GO_TO_TIMECARD_OPTION);

    const landed = await pollUntil(clock, TIMECARD_NAVIGATION_TIMEOUT_MS, async () => {
      if (!page.url().includes(NEW_KRONOS_TIMECARD_ROUTE)) return null;
      return await resolveRecipe(page, NEW_KRONOS_TIMECARD_EMPLOYEE_ID).count() === 1 ? true : null;
    });
    if (landed.value === null) {
      throw new NewKronosDriverError(
        `Go To -> Timecard did not reach ${NEW_KRONOS_TIMECARD_ROUTE} with an identifiable employee header `
        + `within ${String(TIMECARD_NAVIGATION_TIMEOUT_MS)}ms for EID ${directIdentifierDisplay(input.employeeId)} `
        + `(observed URL ${page.url()}) — refusing to read a page that is not a loaded timecard`,
      );
    }

    // Close search before proving the timecard subject; its input echo can masquerade as identity.
    await closeSearchPanel();

    const idNode = await exactlyOne(clock, page, NEW_KRONOS_TIMECARD_EMPLOYEE_ID);
    const idText = await idNode.textContent();
    const observedEmployeeId = idText === null ? "" : idText.trim();

    if (observedEmployeeId.length === 0) {
      throw new NewKronosDriverError(
        `the timecard's ${NEW_KRONOS_TIMECARD_DISPLAYED_EID} observation is empty for expected EID `
        + `${directIdentifierDisplay(input.employeeId)} — the header did not render, so the subject cannot be proved`,
      );
    }

    const nameNode = page.locator("#combo_inptxt");
    const nameTitle = await nameNode.count() === 1 ? await nameNode.getAttribute("title") : null;
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
    const trigger = await exactlyOne(clock, page, NEW_KRONOS_TIMECARD_PERIOD_TRIGGER);
    await trigger.click({ timeout: CONTROL_TIMEOUT_MS });
    recordBrowserAction("clicked", NEW_KRONOS_TIMECARD_PERIOD_TRIGGER);
    const selectRange = await exactlyOne(clock, page, NEW_KRONOS_TIMECARD_SELECT_RANGE_BUTTON);
    await selectRange.click({ timeout: CONTROL_TIMEOUT_MS });
    recordBrowserAction("clicked", NEW_KRONOS_TIMECARD_SELECT_RANGE_BUTTON);
    await setRangeField(NEW_KRONOS_TIMECARD_RANGE_START_FIELD, input.rangeStart, "start");
    await setRangeField(NEW_KRONOS_TIMECARD_RANGE_END_FIELD, input.rangeEnd, "end");
    // Setting the end can nudge the start (the widget auto-advances between the
    // two tabs), so the start is re-proved before Apply.
    await setRangeField(NEW_KRONOS_TIMECARD_RANGE_START_FIELD, input.rangeStart, "start (re-proof)");
    const apply = await exactlyOne(clock, page, NEW_KRONOS_TIMECARD_RANGE_APPLY_BUTTON);
    await apply.click({ timeout: CONTROL_TIMEOUT_MS });
    recordBrowserAction("clicked", NEW_KRONOS_TIMECARD_RANGE_APPLY_BUTTON);

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


export function createNewKronosTimecardDriver(page: Page, clock: Clock): NewKronosTimecardDriver {
  const internals = createDriverInternals(page, clock);
  return NewKronosTimecardDriverSchema.parse({
    system: "new-kronos",
    searchEmployee: internals.searchEmployee,
    readSeparationTimecard: internals.readSeparationTimecard,
  });
}
