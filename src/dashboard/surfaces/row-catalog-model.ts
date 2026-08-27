/**
 * The ROW-AND-PANEL vocabulary, as this build actually serves it (D274 item 4).
 *
 * ## What this is, and what it deliberately is not
 *
 * The rebuild-demo carries a "Row & panel catalog" (legacy
 * `src/dashboard/components/dev/rebuild-demo/DemoCatalogView.tsx` +
 * `demo-catalog.ts`, legacy commit `1bffbd6`) — a five-section reference page
 * naming 8 row VARIANTS over 3 row types, 3 containment kinds, a status rollup
 * precedence chain, 4 Log-Panel kinds and a per-workflow map. D184 retired the
 * demo SHELL as a port target and said nothing about the vocabulary; D274 item
 * 4 answers it: **build only the vocabulary this system serves, and NAME what
 * the demo has that it does not.** The rejected arms were claiming the demo's
 * unsupported semantics (B) and giving the vocabulary no home at all (C).
 *
 * So every kind on this page is READ OFF a schema — `QueueSurfaceWire`'s own
 * discriminant, `ContainmentSchema.options`, `PanelKindSchema.options`, and
 * `sectionsForPanelKind` — never authored beside it. A `Record` keyed by the
 * schema's own union is what makes that structural: a fifth arm on any of them
 * is a TYPECHECK failure here, not a page that silently documents four of five.
 * What IS authored is the prose, and each sentence is lifted from the schema's
 * own doc comment at the site that defines the arm, so there is one place to
 * correct it.
 *
 * ## The named absences
 *
 * `UNSERVED_VOCABULARY` is the other half of D274 item 4 and is rendered, not
 * commented: a reference page that quietly omits what the demo names is
 * indistinguishable from one that has not been finished. Each entry says what
 * the demo has, and why nothing in this tree can print it.
 */
import { ContainmentSchema, type QueueSurfaceWireSchema } from "../../domain/dashboard/projection.js";
import { PanelKindSchema, type RunDetailSectionSchema } from "../../domain/dashboard/primitives.js";
import { sectionsForPanelKind } from "../../domain/dashboard/run-detail.js";
import type { z } from "zod";
import { PANEL_TAB_LABEL, TAB_ORDER, type PanelTab } from "./log-panel-model.js";

type QueueSurfaceWire = z.infer<typeof QueueSurfaceWireSchema>;

/**
 * Which panel the catalog takeover shows. Route-owned (`?catalogView=`), like
 * the Archive's `archiveView`, so a link can name the exact view.
 */
export type CatalogView = "vocabulary" | "selectors";

/** The view a link with no `catalogView` lands on — the surface this key has always opened. */
export const DEFAULT_CATALOG_VIEW: CatalogView = "selectors";

/**
 * A query value this build does not render is DROPPED rather than trusted: the
 * omitted arm is a real destination, and landing the operator on a blank panel
 * because a link carried a typo is worse than landing them on the default.
 */
export function parseCatalogView(raw: string | null): CatalogView | undefined {
  if (raw === "vocabulary" || raw === "selectors") return raw;
  return undefined;
}

/** The row shapes the queue projection can produce, straight off the wire union. */
export type RowSurfaceKind = QueueSurfaceWire["surfaceKind"];
export type ContainmentKind = z.infer<typeof ContainmentSchema>;
export type PanelKind = z.infer<typeof PanelKindSchema>;
type RunDetailSection = z.infer<typeof RunDetailSectionSchema>;

export interface RowSurfaceSpec {
  /** The wire value itself — the identifier IS the interface (ref dashboard-surfaces §9.5.3). */
  readonly key: RowSurfaceKind;
  readonly name: string;
  /** What this shape IS, in one sentence. */
  readonly subject: string;
  /** What the projector must be looking at to emit it. */
  readonly producedWhen: string;
  /** The facts this shape carries that no other shape does. */
  readonly carries: readonly string[];
}

/**
 * A `Record` rather than an array, so the compiler — not a reviewer — is what
 * notices a new `surfaceKind`. `surfaceKindOf` in
 * `src/server/dashboard/projectors/run-queue-projection.ts` folds the run's own
 * `shape` into exactly these four.
 */
const ROW_SURFACE: Record<RowSurfaceKind, RowSurfaceSpec> = {
  single: {
    key: "single",
    name: "Single run",
    subject: "One run with no members and no parent — the ordinary row.",
    producedWhen: "The run's own shape is single.",
    carries: [
      "containment: root — it is counted in the day's totals",
      "memberRunIds and memberRollup are absent: this shape has no members to roll up",
    ],
  },
  preview: {
    key: "preview",
    name: "Preview run",
    subject: "A run whose shape is a preview of work rather than the work.",
    producedWhen: "The run's own shape is preview.",
    carries: [
      "The same field set as single — the shapes differ in what the run IS, not in what the row draws",
      "containment: root",
    ],
  },
  operation: {
    key: "operation",
    name: "Operation group",
    subject: "A fan-out: one row standing for the members it delegated to.",
    producedWhen: "The run's own shape is operation.",
    carries: [
      "memberRunIds[] — the exact member rows, never a count on its own",
      "memberRollup — total / terminal / failed, refused by the schema unless total equals the member ids",
      "memberPreview — the first few members BY NAME, derived from the member rows' own served titles, or an absent reason",
    ],
  },
  member: {
    key: "member",
    name: "Member run",
    subject: "One delegated child of a group, counted inside it instead of at top level.",
    producedWhen: "The run's own shape is operation-member.",
    carries: [
      "containment: member — the schema refuses a member surface that says anything else",
      "lineage: child — a member surface with no parent is refused outright",
    ],
  },
};

/**
 * Display order. The `Record` above owns MEMBERSHIP and this owns SEQUENCE;
 * `row-catalog-model.test.ts` pins that the two agree, because an order list is the
 * one place a fifth arm can be dropped without the compiler noticing.
 */
export const ROW_SURFACE_ORDER: readonly RowSurfaceKind[] = ["single", "preview", "operation", "member"];

export function rowSurfaceSpecs(): readonly RowSurfaceSpec[] {
  return ROW_SURFACE_ORDER.map((key) => {
    const spec = ROW_SURFACE[key];
    // Fail loud rather than skip: an order entry with no spec would silently
    // shorten the page, which is exactly the drift this catalog exists against.
    if (spec === undefined) throw new Error(`row surface order names ${key}, which has no spec`);
    return spec;
  });
}

export interface ContainmentSpec {
  readonly key: ContainmentKind;
  readonly name: string;
  readonly rule: string;
  readonly lives: string;
  readonly counts: string;
}

/**
 * The three arms of ContainmentSchema, in its own words
 * (src/domain/dashboard/projection.ts). The demo names a FOURTH — see
 * UNSERVED_VOCABULARY.
 */
const CONTAINMENT: Record<ContainmentKind, ContainmentSpec> = {
  root: {
    key: "root",
    name: "Root",
    rule: "No parent. The ordinary row.",
    lives: "At the top level of the queue.",
    counts: "In the day's own totals.",
  },
  member: {
    key: "member",
    name: "Member",
    rule: "Created by a parent fanning out.",
    lives: "Nested inside the group, never at top level.",
    counts: "In its parent's rollup, instead of the day's totals.",
  },
  linked: {
    key: "linked",
    name: "Linked",
    rule: "An independently meaningful sub-run the parent waits on.",
    lives: "In its OWN row in its own panel; the parent shows a chip.",
    counts: "In the day's totals, in its own right.",
  },
};

export function containmentSpecs(): readonly ContainmentSpec[] {
  return ContainmentSchema.options.map((key) => CONTAINMENT[key]);
}

export interface PanelKindSpec {
  readonly key: PanelKind;
  readonly name: string;
  readonly forRows: string;
  /** Derived from sectionsForPanelKind, never authored (D274 item 4). */
  readonly tabs: readonly { readonly key: PanelTab; readonly label: string }[];
  /** Every section this kind may advertise, tabbed or not. */
  readonly sections: readonly RunDetailSection[];
}

const PANEL_KIND_NAME: Record<PanelKind, { readonly name: string; readonly forRows: string }> = {
  run: { name: "Run panel", forRows: "Single run · Preview run" },
  member: { name: "Member panel", forRows: "Member run" },
  review: { name: "Review panel", forRows: "Any row whose descriptor produced review records" },
  group: { name: "Group panel", forRows: "Operation group" },
};

/**
 * The tab strip a kind can draw, read off the SAME derivation the panel calls.
 *
 * tabsFor filters a run's ADVERTISED sections through TAB_ORDER; here the
 * advertisable set comes from sectionsForPanelKind, so the catalog can never
 * document a tab the schema would refuse on that kind. What it does not claim
 * is that every real run has all of them — availableSections is per run, and
 * the surface says so.
 */
function tabsForPanelKind(panelKind: PanelKind): readonly { key: PanelTab; label: string }[] {
  const advertisable = new Set<RunDetailSection>(sectionsForPanelKind(panelKind));
  const tabs: { key: PanelTab; label: string }[] = [];
  // TAB_ORDER, not a second copy of it: a hand-kept list beside the one the
  // panel actually filters is a specimen page that documents an order the
  // product stopped drawing, which is the exact drift this surface exists to
  // prevent.
  for (const tab of TAB_ORDER) {
    if (advertisable.has(tab)) tabs.push({ key: tab, label: PANEL_TAB_LABEL[tab] });
  }
  return tabs;
}

export function panelKindSpecs(): readonly PanelKindSpec[] {
  return PanelKindSchema.options.map((key) => ({
    key,
    name: PANEL_KIND_NAME[key].name,
    forRows: PANEL_KIND_NAME[key].forRows,
    tabs: tabsForPanelKind(key),
    sections: sectionsForPanelKind(key),
  }));
}

/**
 * What a group's status is rolled up FROM, and what this build does not roll.
 *
 * The demo authors a status PRECEDENCE chain (ROLLUP_STEPS, first match
 * wins). Nothing in src/ derives a group status that way: memberRollup is
 * three counts, refused by the schema unless they are internally consistent
 * and total matches the member ids exactly.
 */
export const ROLLUP_COUNTS: readonly { readonly key: string; readonly meaning: string }[] = [
  { key: "total", meaning: "Every member id this group served — the schema refuses a total that disagrees with the list." },
  { key: "terminal", meaning: "Members that have settled. Never greater than total." },
  { key: "failed", meaning: "Settled members that failed. Never greater than terminal." },
];

export interface UnservedVocabulary {
  /** What the demo names. */
  readonly demo: string;
  /** Why nothing in this tree can print it — a producer, not an opinion. */
  readonly why: string;
}

/**
 * D274 item 4's second half, RENDERED. Each row is a fact about a producer.
 */
export const UNSERVED_VOCABULARY: readonly UnservedVocabulary[] = [
  {
    demo: "Eight named row VARIANTS — Person Run Row, Document Run Row, Review Run Row, Catalog Run Row, Packet Group Row, Roster Group Row, Person Member Row, Rejected Member Row.",
    why: "No wire field carries a variant. A row's identity here is its workflowId and its surfaceKind, and a ninth variant invented on this page would be a vocabulary the queue cannot honour.",
  },
  {
    demo: "A fourth containment kind, rejected.",
    why: "A submission the parent could not turn into work never becomes a run — fanOutQueuedRuns refuses the whole fan-out inside the caller's transaction — so no queue row could carry it. ContainmentSchema names three arms for that reason and gains the fourth with its first producer.",
  },
  {
    demo: "A status ROLLUP PRECEDENCE chain, resolved first-match-wins over member statuses.",
    why: "No module derives a group status from its members' statuses. memberRollup serves three counts, and a precedence chain drawn over them would be describing a fold this build does not run.",
  },
  {
    demo: "A per-workflow map — every workflow beside the row variants it puts in the queue.",
    why: "It reads the variant vocabulary above, which is unserved. The workflows themselves ARE served; what has no producer is the claim about which shapes each one emits.",
  },
  {
    demo: "A live example jump — See <a real row> on every specimen.",
    why: "The demo links into its own fixture day. A jump from here would have to name a run id, and this page is about the vocabulary rather than about any day's rows.",
  },
];
