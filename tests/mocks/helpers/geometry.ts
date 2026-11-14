

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


export function unclaimedSpans(geometry: ShellGeometry): readonly UnclaimedSpan[] {
  const start = geometry.regionLeft + geometry.padding;
  const end = geometry.regionRight - geometry.padding;
  // Sorted intervals only extend the frontier; overlap cannot reopen a gap behind it.
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
    + "halves cannot see it, which a frozen corpus alone cannot detect.",
  );
}
