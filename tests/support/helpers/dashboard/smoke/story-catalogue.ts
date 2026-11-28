/** The state gallery's story shape. A surface keys one story table per state type it renders, each typed
 * `satisfies Record<StateType, Story>`, so a new state member without a story fails typecheck. */
import type { Page } from "@playwright/test";
import type { ReactNode } from "react";
import type { StateRuleName } from "./state-rule-limits.js";

export interface Story {
  /** What the operator is looking at, in a few words. */
  readonly title: string;
  readonly render: () => ReactNode;
  /** Brings the mounted story to the state it is for: types, presses, runs the page clock on. It runs before the ready point is awaited. */
  readonly play?: (page: Page) => Promise<void>;
  /** Set on a story that waits on timers: the loop installs the page clock before the story mounts, so `play` can run it on. */
  readonly clock?: true;
  /** A selector that is visible once the story shows the state it is for. Without one, the theme root is the ready point. */
  readonly ready?: string;
  /** A selector that is visible once requests the story starts after its ready point have answered. */
  readonly settled?: string;
  /** Set on a story that shows a slow fetch: the only place a skeleton may appear, and only inside this region. */
  readonly slowFetch?: { readonly region: string };
  /** Console errors, page errors, failed requests and HTTP errors this state produces on purpose. */
  readonly expects?: readonly { readonly pattern: RegExp; readonly reason: string }[];
  /** Rules today's dashboard breaks in this state, each with its dashboard-audit-fixes ticket id. */
  readonly knownFailures?: Readonly<Partial<Record<StateRuleName, string>>>;
  /** A recorded break that shows only at these viewport widths (text metrics differ by platform); without an entry it applies at every width. */
  readonly knownFailureWidths?: Readonly<Partial<Record<StateRuleName, readonly number[]>>>;
}

/** The gallery's reference dialogs: the design system's own dialog at each size, plain and banded, mounted as
 * `reference/dialog/<variant>`. The large dialog is always banded. */
export const DIALOG_REFERENCE_SURFACE = "reference";
export const DIALOG_REFERENCE_VARIANTS: readonly string[] = Object.freeze(["sm", "sm-band", "md", "md-band", "lg-band"]);

export type StoryTable = Readonly<Record<string, Story>>;

export interface CatalogueEntry {
  /** `<surface>/<state type>/<member>`: what `mount()` takes and what a frame is named after. */
  readonly id: string;
  readonly surface: string;
  readonly story: Story;
}

/** Flattens one surface's story tables into catalogue entries. */
export function defineSurface(surface: string, tables: Readonly<Record<string, StoryTable>>): readonly CatalogueEntry[] {
  return Object.entries(tables).flatMap(([stateType, table]) =>
    Object.entries(table).map(([member, story]) => ({ id: `${surface}/${stateType}/${member}`, surface, story })));
}

export function storyOf(catalogue: readonly CatalogueEntry[], id: string): Story {
  const entry = catalogue.find(candidate => candidate.id === id);
  if (entry === undefined) throw new Error(`The gallery has no story "${id}".`);
  return entry.story;
}

/** A frame's file name under the smoke output folder, relative to the frames root. */
export function framePath(id: string, width: number): string {
  return `${id.replaceAll("/", "--")}-${String(width)}.png`;
}
