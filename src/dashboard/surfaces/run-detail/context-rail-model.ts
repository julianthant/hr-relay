/**
 * The rail's persisted open state and read-only context data folds.
 *
 * It lives beside `context-rail.tsx` rather than inside it because a module that
 * exports a component may export nothing else if React Fast Refresh is to treat
 * it as a refresh boundary: one non-component export makes every edit to the
 * surface invalidate upward into `dashboard-app.tsx` and remount the app
 * instead of hot-swapping the component.
 */
import { useCallback, useState } from "react";
import { readEnumPreference, writePreference } from "../../lib/preference-storage.js";
import type { z } from "zod";
import type {
  ContextSummaryWireSchema,
  RunDetailSectionResponseSchema,
} from "../../../domain/dashboard/run-detail.js";

type RunDetailSectionResponse = z.infer<typeof RunDetailSectionResponseSchema>;

export type ContextSummary = z.infer<typeof ContextSummaryWireSchema>;

/** The three context sections this rail renders, exactly as the wire names them. */
export type ContextSectionKind = "context-data" | "context-evidence" | "context-attempts";

export type ContextSectionPayload = Extract<
  RunDetailSectionResponse,
  { section: ContextSectionKind }
>["payload"];

/** The Data section's own payload. */
export type ContextDataPayload = Extract<
  RunDetailSectionResponse,
  { section: "context-data" }
>["payload"];

export type ContextDataEntry = ContextDataPayload["entries"][number];

/** What the rail is handed: whichever context sections the run advertised. */
export type ContextSections = Partial<Record<ContextSectionKind, ContextSectionPayload>>;

const RAIL_STORAGE_KEY = "hrauto-rebuild.context-rail";

/** The documented default for a rail nobody has expressed a preference about. */
const RAIL_DEFAULT: RailPreference = "open";

type RailPreference = "open" | "closed";

const RAIL_PREFERENCES: readonly RailPreference[] = ["open", "closed"];

function readStoredRailOpen(): boolean {
  // `readEnumPreference` keeps "nothing stored", "storage refused" and "stored
  // something we do not recognise" apart internally and lands all three on the
  // named default above — rather than a catch block inventing `true`.
  return readEnumPreference(RAIL_STORAGE_KEY, RAIL_PREFERENCES, RAIL_DEFAULT) === "open";
}

export interface ContextRailState {
  open: boolean;
  collapsed: boolean;
  setOpen: (open: boolean) => void;
}

/**
 * `threeColumn` is the REGION's own answer, handed down by the layout owner —
 * it was a `matchMedia("(min-width: 1280px)")` here, and that was the window.
 *
 * Collapsing is a three-column affordance: below the threshold the region is a
 * scrolling stack, and a spine there would hide the data behind a control that
 * gives back 34px of a column that no longer exists — so the stored preference
 * is simply not applied. The threshold that decides it has to be the same one
 * the columns switch on, and that one is now the COLUMN's width (ref dashboard-surfaces
 * §Shell), which only the element that owns the box can measure. Asking the
 * window from here reintroduced the exact disagreement: with the workflow
 * panel docked at a 1280px window this hook said "three columns" while the
 * region had 668px and was drawing a stack.
 */
export function useContextRail(threeColumn: boolean): ContextRailState {
  const [open, setOpenState] = useState(readStoredRailOpen);
  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);
    // The write's outcome is returned, not thrown away: an unwritable store
    // loses the preference for next time, which is not a reason to refuse the
    // operator this one — but it is a distinguishable outcome, not a silence.
    void writePreference(RAIL_STORAGE_KEY, next ? "open" : "closed");
  }, []);
  return { open, collapsed: !open && threeColumn, setOpen };
}

/* The ledger's two levels and the reuse bound. */

/**
 * One LEVEL-1 group of the ledger: the step that recorded the values under it.
 *
 * The demo's ledger is two levels — a sub-step heading with its fields beneath
 * — and it is the heading that makes an eight-row ledger read as "three things
 * this run did" rather than eight unrelated lines. The grouping is by the
 * SERVED `origin.nodeId`, never by the label, because two steps may record a
 * field of the same name and merging them would attribute one step's read to
 * another.
 *
 * Order is the order the entries arrived in, which is the descriptor's own
 * detail order — a sort here would be a second opinion about what matters.
 * Entries the build cannot attribute (no field identity, so no step) collect
 * into ONE trailing group with no heading: they are real recorded values and
 * inventing a step name for them is the fabrication this rail refuses.
 */
export interface ContextDataGroup {
  /** `undefined` for the unattributed trailing group. */
  readonly origin: NonNullable<ContextDataEntry["origin"]> | undefined;
  readonly rows: readonly Readonly<{ entry: ContextDataEntry; index: number }>[];
}

export function groupEntriesByStep(
  entries: readonly ContextDataEntry[],
): readonly ContextDataGroup[] {
  const groups: { origin: ContextDataEntry["origin"]; rows: { entry: ContextDataEntry; index: number }[] }[] = [];
  const byNode = new Map<string, { origin: ContextDataEntry["origin"]; rows: { entry: ContextDataEntry; index: number }[] }>();
  let unattributed: { origin: undefined; rows: { entry: ContextDataEntry; index: number }[] } | undefined;
  entries.forEach((entry, index) => {
    if (entry.origin === undefined) {
      if (unattributed === undefined) {
        unattributed = { origin: undefined, rows: [] };
        groups.push(unattributed);
      }
      unattributed.rows.push({ entry, index });
      return;
    }
    const existing = byNode.get(entry.origin.nodeId);
    if (existing !== undefined) {
      existing.rows.push({ entry, index });
      return;
    }
    const created = { origin: entry.origin, rows: [{ entry, index }] };
    byNode.set(entry.origin.nodeId, created);
    groups.push(created);
  });
  return groups;
}

/**
 * The reuse bound, said as a sentence — or `undefined` when this build cannot
 * honestly say one.
 *
 * The rule is the executor's, not a presentation choice: `auditCheckpointFreshness`
 * skips a checkpoint whose facts reach NO scheduled commit, so a bound with an
 * empty `feeds` set can never refuse anything and printing an age limit beside
 * it would state a constraint that does not exist. An `unbounded` limit is the
 * same absence from the other side — there is no age at which this value stops
 * being reusable.
 */
export function freshnessNoteOf(entry: ContextDataEntry): string | undefined {
  const { freshness } = entry;
  if (freshness === undefined) return undefined;
  if (freshness.maxAge === "unbounded" || freshness.feeds.length === 0) return undefined;
  const minutes = Math.floor(freshness.maxAge / 60_000);
  const age = minutes >= 1
    ? `${String(minutes)} min`
    : `${String(Math.floor(freshness.maxAge / 1000))} s`;
  const writes = freshness.feeds.map((sink) => sink.label).join(", ");
  const stale = freshness.override === "audited"
    ? "Reusing an older reading takes a recorded reason."
    : "An older reading must be re-read — no override can authorize it.";
  return `Reusable for ${age} before ${writes}. ${stale}`;
}
