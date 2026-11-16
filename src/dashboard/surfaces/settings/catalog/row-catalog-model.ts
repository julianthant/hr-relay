/** The ROW-AND-PANEL vocabulary, as this build actually serves it.
 * The rebuild-demo carries a "Row & panel catalog" (legacy */
import type { QueueSurfaceWireSchema } from "../../../../models/dashboard/projection.js";
import { ChildVisibilitySchema, type ChildVisibility } from "../../../../models/workflow/delegation-policy.js";
import { PanelKindSchema, type RunDetailSectionSchema } from "../../../../models/dashboard/primitives.js";
import { sectionsForPanelKind } from "../../../../models/dashboard/run-detail.js";
import type { z } from "zod";
import { PANEL_TAB_LABEL, TAB_ORDER, type PanelTab } from "../../run-detail/log-panel-model.js";

type QueueSurfaceWire = z.infer<typeof QueueSurfaceWireSchema>;

/** Which panel the catalog takeover shows. Route-owned (`?catalogView=`), like
 * the Archive's `archiveView`, so a link can name the exact view. */
export type CatalogView = "vocabulary" | "selectors";

/** The view a link with no `catalogView` lands on — the surface this key has always opened. */
export const DEFAULT_CATALOG_VIEW: CatalogView = "selectors";

/** A query value this build does not render is DROPPED rather than trusted: the
 * omitted arm is a real destination, and landing the operator on a blank panel */
export function parseCatalogView(raw: string | null): CatalogView | undefined {
  if (raw === "vocabulary" || raw === "selectors") return raw;
  return undefined;
}

/** The row shapes the queue projection can produce, straight off the wire union. */
export type RowSurfaceKind = QueueSurfaceWire["surfaceKind"];
export type ContainmentKind = "root" | ChildVisibility;
export type PanelKind = z.infer<typeof PanelKindSchema>;
type RunDetailSection = z.infer<typeof RunDetailSectionSchema>;

export interface RowSurfaceSpec {
  /** The wire value itself — the identifier IS the interface (ref dashboard-surfaces ). */
  readonly key: RowSurfaceKind;
  readonly name: string;
  /** What this shape IS, in one sentence. */
  readonly subject: string;
  /** What the projector must be looking at to emit */
  readonly producedWhen: string;
  /** The facts this shape carries that no other shape does. */
  readonly carries: readonly string[];
}

/** A `Record` rather than an array, so the compiler — not a reviewer —
 * is what notices a new `surfaceKind`. */
const ROW_SURFACE: Record<RowSurfaceKind, RowSurfaceSpec> = {
  single: {
    key: "single",
    name: "Single run",
    subject: "One run without a visible member list.",
    producedWhen: "The run presents a single row; its parent fact determines where it appears.",
    carries: [
      "parent: null for a root, or one authenticated parent and visibility",
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
      "The parent fact determines whether it is a top-level row or a member",
    ],
  },
  operation: {
    key: "operation",
    name: "Operation group",
    subject: "A fan-out: one row standing for the members it delegated to.",
    producedWhen: "The native run is an operation, or it has visible inline children.",
    carries: [
      "memberRunIds[] — the exact member rows, never a count on its own",
      "memberRollup — total / terminal / failed, refused by the schema unless total equals the member ids",
      "memberPreview — the first few members BY NAME, derived from the member rows' own served titles, or an absent reason",
    ],
  },
};

/** Display order. */
export const ROW_SURFACE_ORDER: readonly RowSurfaceKind[] = ["single", "preview", "operation"];

export function rowSurfaceSpecs(): readonly RowSurfaceSpec[] {
  return ROW_SURFACE_ORDER.map((key) => {
    const spec = ROW_SURFACE[key];
    // Fail loud rather than skip
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


const CONTAINMENT: Record<ContainmentKind, ContainmentSpec> = {
  root: {
    key: "root",
    name: "Root",
    rule: "No parent. The ordinary row.",
    lives: "At the top level of the queue.",
    counts: "In the day's own totals.",
  },
  inline: {
    key: "inline",
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
  "hidden-unless-failed": {
    key: "hidden-unless-failed",
    name: "Hidden unless failed",
    rule: "A child contributes a member line when it fails.",
    lives: "Within its parent's operation group.",
    counts: "In its parent's rollup when visible.",
  },
};

export function containmentSpecs(): readonly ContainmentSpec[] {
  return [CONTAINMENT.root, ...ChildVisibilitySchema.options.map(key => CONTAINMENT[key])];
}

export interface PanelKindSpec {
  readonly key: PanelKind;
  readonly name: string;
  readonly forRows: string;
  /** Derived from sectionsForPanelKind, never authored. */
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

/** Catalog tabs use advertised schema sections; possible tabs do not claim every run serves them. */
function tabsForPanelKind(panelKind: PanelKind): readonly { key: PanelTab; label: string }[] {
  const advertisable = new Set<RunDetailSection>(sectionsForPanelKind(panelKind));
  const tabs: { key: PanelTab; label: string }[] = [];
  // Reuse the product tab order so the catalog cannot document a stale parallel list.
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

/** Member counts are not a status-precedence rollup; document only the derivation actually produced. */
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


export const UNSERVED_VOCABULARY: readonly UnservedVocabulary[] = [
  {
    demo: "Eight named row VARIANTS — Person Run Row, Document Run Row, Review Run Row, Catalog Run Row, Packet Group Row, Roster Group Row, Person Member Row, Rejected Member Row.",
    why: "No wire field carries a variant. A row's identity here is its workflowId and its surfaceKind, and a ninth variant invented on this page would be a vocabulary the queue cannot honour.",
  },
  {
    demo: "A row for a refused submission.",
    why: "A refused submission creates no run. Fan-out admission commits the complete declared set atomically.",
  },
  {
    demo: "A status ROLLUP PRECEDENCE chain, resolved first-match-wins over member statuses.",
    why: "Run status comes from lifecycle and authenticated delegation waits. memberRollup supplies counts.",
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
