/**
 * The UI catalog's folds and vocabulary (ref dashboard-surfaces §9.5.3, D177).
 *
 * `ui-catalog.tsx` draws the catalog as a RAIL beside a RECORD — the Explorer's
 * shape at system scope — and this module owns everything about that shape
 * that is not a component: the rail's tree (system → screen → the ids on that
 * screen), which rows a search term keeps, and which entry is the record.
 *
 * The rail nests every non-screen entry under the screen it names. That is a
 * fact off the entry (`entry.screen`), not a guess: an element, page state or
 * observation without a served screen is a generator defect and throws by id,
 * because a rail that quietly filed it under a made-up heading would be
 * showing a hierarchy the registry does not have.
 */
import type { UiCatalogEntry } from "../../domain/ui/contracts.js";
import { matchesUiCatalogQuery } from "../../domain/dashboard/explorer.js";

/**
 * How each entry kind is drawn.
 *
 * `observation` is the only tinted one: an observation is what a subject
 * binding and a write's completion proof are checked against (ref operator-trust §1.1), so
 * it is the kind whose staleness has consequences beyond a failed read. `mark`
 * is the rail's one-letter kind glyph; the record column prints `word`.
 */
export const ENTRY_KIND = {
  screen: { word: "Screen", mark: "S", tone: "neutral" },
  element: { word: "Element", mark: "E", tone: "neutral" },
  "page-state": { word: "Page state", mark: "P", tone: "neutral" },
  observation: { word: "Observation", mark: "O", tone: "info" },
} as const satisfies Record<UiCatalogEntry["kind"], { word: string; mark: string; tone: "neutral" | "info" }>;

export interface CatalogRailScreen {
  readonly screen: UiCatalogEntry;
  /** The screen row itself matched the query (else it is drawn only as its children's heading). */
  readonly matched: boolean;
  /** The screen's own entries that match the query, in catalog order. */
  readonly children: readonly UiCatalogEntry[];
}

export interface CatalogRailSystem {
  readonly system: string;
  /** Matched entries under this system — screens that matched plus matched children. */
  readonly matchedCount: number;
  readonly screens: readonly CatalogRailScreen[];
}

export interface CatalogRail {
  readonly systems: readonly CatalogRailSystem[];
  /** Every row the rail draws, top to bottom — the keyboard's order. */
  readonly rows: readonly UiCatalogEntry[];
  /** The rows that matched the query, in rail order — the first is the default record. */
  readonly matches: readonly UiCatalogEntry[];
  /** How many entries matched the query (a screen drawn only as a heading is not counted). */
  readonly matchedCount: number;
}

/**
 * Fold the served entries into the rail: systems in name order, each screen in
 * catalog order with its matched entries beneath it. A screen that does not
 * match is still drawn when one of its entries does, so a hit never floats
 * free of the page it lives on — but it is not counted as a hit.
 */
export function foldCatalogRail(entries: readonly UiCatalogEntry[], query: string): CatalogRail {
  const screensById = new Map<string, UiCatalogEntry>();
  for (const entry of entries) {
    if (entry.kind === "screen") screensById.set(String(entry.id), entry);
  }

  type Draft = { screen: UiCatalogEntry; matched: boolean; children: UiCatalogEntry[] };
  const bySystem = new Map<string, Map<string, Draft>>();
  const draftFor = (screen: UiCatalogEntry): Draft => {
    const screens = bySystem.get(screen.system) ?? new Map<string, Draft>();
    bySystem.set(screen.system, screens);
    const existing = screens.get(String(screen.id));
    if (existing !== undefined) return existing;
    const draft: Draft = { screen, matched: false, children: [] };
    screens.set(String(screen.id), draft);
    return draft;
  };

  for (const entry of entries) {
    if (entry.kind === "screen") {
      // Register in catalog order so a screen drawn only for its children still
      // sits where the registry put it, not where its first child appeared.
      draftFor(entry);
      continue;
    }
    const screen = screensById.get(String(entry.screen));
    if (screen === undefined) {
      throw new Error(
        `UI catalog entry ${String(entry.id)} names screen ${String(entry.screen)}, which the catalog does not serve`,
      );
    }
    // Same order rule for the child: the draft exists from the screen's own pass.
    draftFor(screen);
  }

  for (const entry of entries) {
    if (!matchesUiCatalogQuery(entry, query)) continue;
    if (entry.kind === "screen") {
      draftFor(entry).matched = true;
      continue;
    }
    const screen = screensById.get(String(entry.screen));
    // Proved present by the first pass; the second lookup is for the type only.
    if (screen === undefined) throw new Error(`UI catalog entry ${String(entry.id)} lost its screen between passes`);
    draftFor(screen).children.push(entry);
  }

  const rows: UiCatalogEntry[] = [];
  const matches: UiCatalogEntry[] = [];
  let matchedCount = 0;
  const systems: CatalogRailSystem[] = [...bySystem.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([system, screens]) => {
      const kept: CatalogRailScreen[] = [];
      let systemMatched = 0;
      for (const draft of screens.values()) {
        if (!draft.matched && draft.children.length === 0) continue;
        kept.push({ screen: draft.screen, matched: draft.matched, children: draft.children });
        rows.push(draft.screen, ...draft.children);
        if (draft.matched) matches.push(draft.screen);
        matches.push(...draft.children);
        systemMatched += (draft.matched ? 1 : 0) + draft.children.length;
      }
      matchedCount += systemMatched;
      return { system, matchedCount: systemMatched, screens: kept };
    })
    .filter((system) => system.screens.length > 0);

  return { systems, rows, matches, matchedCount };
}

/** A selection the operator made, bound to the search term it was made under. */
export interface CatalogSelectionRequest {
  readonly id: string;
  readonly query: string;
}

/**
 * Which entry is the record.
 *
 * The requested id wins while the rail still draws it. It also wins while the
 * search term is the one it was chosen under, even if the rail does not draw
 * it — that is how a chip on the record's "on the same screen" strip can open
 * an entry the current term does not match. A NEW term retires a request the
 * rail cannot draw: the record then opens on the term's first hit, never on a
 * screen that is drawn only as its children's heading, and never on a stale
 * record from the previous search. `undefined` only when the rail is empty.
 */
export function resolveCatalogSelection(
  entries: readonly UiCatalogEntry[],
  rail: CatalogRail,
  request: CatalogSelectionRequest | undefined,
  query: string,
): UiCatalogEntry | undefined {
  if (request !== undefined) {
    const drawn = rail.rows.find((row) => String(row.id) === request.id);
    if (drawn !== undefined) return drawn;
    if (request.query === query) {
      const served = entries.find((entry) => String(entry.id) === request.id);
      if (served !== undefined) return served;
    }
  }
  return rail.matches[0] ?? rail.rows[0];
}

/**
 * How a nested rail row prints its id: without the screen's own prefix when
 * the id carries one, since the screen row sits directly above it. A DISPLAY
 * transform only — the row's title and the record print the id whole — and an
 * id that does not start with its screen's (a page state named for a sibling
 * screen, say) prints whole in the rail too rather than being cut on a guess.
 */
export function railDisplayId(entry: UiCatalogEntry): string {
  if (entry.kind === "screen") return String(entry.id);
  const prefix = `${String(entry.screen)}.`;
  const id = String(entry.id);
  return id.startsWith(prefix) ? id.slice(prefix.length) : id;
}

/** The row an arrow key lands on, clamped at the rail's ends. */
export function stepCatalogSelection(
  rows: readonly UiCatalogEntry[],
  current: string | undefined,
  key: "ArrowDown" | "ArrowUp" | "Home" | "End",
): UiCatalogEntry | undefined {
  if (rows.length === 0) return undefined;
  if (key === "Home") return rows[0];
  if (key === "End") return rows[rows.length - 1];
  const index = current === undefined ? -1 : rows.findIndex((row) => String(row.id) === current);
  if (index === -1) return rows[0];
  const next = key === "ArrowDown" ? Math.min(index + 1, rows.length - 1) : Math.max(index - 1, 0);
  return rows[next];
}

/** The other entries on the selected entry's screen — the record's "on the same screen" strip. */
export function siblingsOnScreen(entries: readonly UiCatalogEntry[], selected: UiCatalogEntry): readonly UiCatalogEntry[] {
  const screenId = selected.kind === "screen" ? String(selected.id) : String(selected.screen);
  return entries.filter(
    (entry) => entry.kind !== "screen" && String(entry.screen) === screenId && String(entry.id) !== String(selected.id),
  );
}

/** A DOM id for a rail row, so the keyboard can move focus to the row it selected. */
export function catalogRowDomId(baseId: string, entryId: string): string {
  return `${baseId}-row-${entryId.replace(/[^A-Za-z0-9_-]/gu, "_")}`;
}
