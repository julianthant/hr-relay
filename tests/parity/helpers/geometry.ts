/**
 * The THIRD representation of a surface (D195).
 *
 * The parity lane already holds two: the pixel half, which permits zero moved
 * pixels (D145), and the a11y half. Twice now they have agreed with each other
 * and both been wrong about what the operator could see.
 *
 * (This file names neither allowance literally, on purpose — D145's guard scans
 * the whole lane for a per-call override and cannot tell a comment from a
 * setting. Being strict about that is worth more than the convenience.)
 *
 * - **D187.** `LogPanel`'s root was a flex child with no width, so it sized to
 *   content and its own grid resolved to `2px 376px`. The run-detail panel —
 *   where the failure record and the evidence receipt live — was a two-pixel
 *   sliver at every viewport since 1i-spine. The a11y tree reported every word
 *   of it, so the semantic half was green; the pixels were stable, so the pixel
 *   half was green too.
 * - **D195.** The panel region was two `flex-1` children, and `flex-1` only
 *   distributes space among children that EXIST. With no run open, ~950px of a
 *   1440px viewport was unclaimed black. Both halves green again.
 *
 * Neither half can catch this, and the reason is structural rather than an
 * oversight: a screenshot compares against a reference that has the SAME defect
 * frozen into it, and an accessibility tree has no concept of area at all. What
 * is missing is a statement about LAYOUT — that the region's children actually
 * cover the region.
 *
 * The measurement is deliberately geometric and label-blind. It does not know
 * what a queue is, it does not assert any panel's width against a token, and it
 * will not need editing when a panel is added or a breakpoint moves. It asks
 * one question: **is there a run of horizontal space inside the panel region
 * that nothing is drawn in?**
 */

const GAP_TOLERANCE_PX = 32;

/** One direct child of the panel region, as measured in the page. */
export interface PanelBox {
  /** the accessible name when it has one, for a legible failure message */
  readonly label: string;
  readonly left: number;
  readonly right: number;
  readonly width: number;
  readonly height: number;
}

/** The panel region and the boxes that are supposed to tile it. */
export interface ShellGeometry {
  readonly regionLeft: number;
  readonly regionRight: number;
  /** the region's own horizontal padding, which is legitimately uncovered */
  readonly padding: number;
  readonly panels: readonly PanelBox[];
}

export interface UnclaimedSpan {
  readonly from: number;
  readonly to: number;
  readonly width: number;
}

/**
 * Every run of horizontal space inside the region that no panel covers, wider
 * than one grid gap plus slack.
 *
 * Pure on purpose: the page half only gathers rectangles, so the judgement can
 * be executed against a synthetic violating geometry the way every mechanical
 * ratchet in this tree is. A check that has never been seen to fail is not a
 * check.
 */
export function unclaimedSpans(geometry: ShellGeometry): readonly UnclaimedSpan[] {
  const start = geometry.regionLeft + geometry.padding;
  const end = geometry.regionRight - geometry.padding;
  // Sorting by `left` is what lets a single sweep be correct: a panel that
  // starts before the current frontier can only extend it, never reopen a span
  // behind it. Overlapping panels (a floating window over the queue) therefore
  // COVER rather than double-count, which is the honest reading — an operator
  // looking at an overlapped pixel is looking at something.
  const ordered = [...geometry.panels]
    .filter((panel) => panel.width > 0 && panel.height > 0)
    .sort((a, b) => a.left - b.left);

  const spans: UnclaimedSpan[] = [];
  let frontier = start;
  for (const panel of ordered) {
    if (panel.left > frontier) {
      const width = Math.min(panel.left, end) - frontier;
      if (width > GAP_TOLERANCE_PX) spans.push({ from: frontier, to: frontier + width, width });
    }
    frontier = Math.max(frontier, panel.right);
    if (frontier >= end) break;
  }
  if (end - frontier > GAP_TOLERANCE_PX) {
    spans.push({ from: frontier, to: end, width: end - frontier });
  }
  return spans;
}

/**
 * Read the panel region out of a live page.
 *
 * The region is located through the queue panel's PARENT rather than by a class
 * or a test id: the queue's accessible name is a product fact this lane already
 * depends on everywhere else, and its parent is by construction the element
 * whose tracks are supposed to tile. Returns `undefined` on a takeover, which
 * replaces the whole region with one workspace and so has nothing to tile.
 */
export async function readShellGeometry(page: {
  evaluate: <T>(fn: () => T) => Promise<T>;
}): Promise<ShellGeometry | undefined> {
  return page.evaluate((): ShellGeometry | undefined => {
    const queue = document.querySelector('[aria-label="Queue"]');
    const region = queue?.parentElement;
    if (region === null || region === undefined) return undefined;
    const box = region.getBoundingClientRect();
    const style = window.getComputedStyle(region);
    const panels: PanelBox[] = [];
    for (const child of Array.from(region.children)) {
      const rect = child.getBoundingClientRect();
      panels.push({
        label: child.getAttribute("aria-label") ?? child.tagName.toLowerCase(),
        left: rect.left,
        right: rect.right,
        width: rect.width,
        height: rect.height,
      });
    }
    return {
      regionLeft: box.left,
      regionRight: box.right,
      padding: Number.parseFloat(style.paddingLeft) || 0,
      panels,
    };
  });
}

/**
 * Refuse a capture whose panel region has a hole in it.
 *
 * Called BEFORE the screenshot, for the same reason `assertThemeApplied` is: a
 * reference minted from a broken layout is not a record of the product, it is a
 * record of the bug, and it will then pass forever.
 */
export async function assertShellGeometry(
  page: { evaluate: <T>(fn: () => T) => Promise<T> },
  stateId: string,
): Promise<void> {
  const geometry = await readShellGeometry(page);
  if (geometry === undefined) return;
  const spans = unclaimedSpans(geometry);
  if (spans.length === 0) return;
  const width = geometry.regionRight - geometry.regionLeft;
  const drawn = geometry.panels
    .map((panel) => `${panel.label}=${Math.round(panel.width)}x${Math.round(panel.height)}`)
    .join(", ");
  throw new Error(
    `${stateId}: the panel region is ${Math.round(width)}px wide and `
    + `${spans.map((span) => `${Math.round(span.width)}px`).join(" + ")} of it is covered by nothing `
    + `(gaps at ${spans.map((span) => `${Math.round(span.from)}→${Math.round(span.to)}`).join(", ")}). `
    + `Panels drawn: ${drawn || "none"}. `
    + "A track that holds no panel is empty space on the operator's screen; the pixel and a11y "
    + "halves cannot see it, which is how D187 and D195 both survived a frozen corpus.",
  );
}
