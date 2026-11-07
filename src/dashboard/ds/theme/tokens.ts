import "./tokens.css";

/** The token layer's TypeScript face. `tokens.css` owns the values;
 * this file owns the *names builders type*. Every */

/** TYPE — the seven-step scale. `ds-text-*` are real CSS classes (see
 * tokens.css) so a stray `text-[11.5px]` cannot silently win over them. */
export const dsText = {
  /** 10px — count badges, kbd, tile captions */
  micro: "ds-text-micro",
  /** 11px — timestamps, trace ids, chips, footers */
  meta: "ds-text-meta",
  /** 12px — the dense default: table cells, log lines, descriptions */
  body: "ds-text-body",
  /** 13px — control labels, row titles, nav entries */
  ui: "ds-text-ui",
  /** 14px — panel and card titles */
  title: "ds-text-title",
  /** 16px — dialog titles, page section heads */
  section: "ds-text-section",
  /** 20px — the single big number on a summary surface */
  display: "ds-text-display",
  /** 27px — page title within a scoped product body */
  pageTitle: "ds-text-page-title",
  /** 10px uppercase 600 — group headers, column heads. Never for sentences. */
  caps: "ds-text-caps",
  /** tabular monospace */
  nums: "ds-nums",
  /** Collapse the line box to the em. Compose AFTER a size class on a
 * single-line label beside an icon / taller control — see tokens.css. */
  flush: "ds-leading-flush",
} as const;

/** COLOR */
export const dsSurface = {
  page: "bg-[var(--ds-surface-page)]",
  /** content-body canvas; apply to the full main area around the 828px body scope */
  bodyPage: "bg-[var(--ds-body-surface-page)]",
  /** the default plane: panels, cards, bars */
  card: "bg-[var(--ds-surface-1)]",
  /** THE RECESSED PLANE — "this sits back from the card". Wells, chips, footers, table headers. */
  recess: "bg-[var(--ds-recess-bg)]",
  /** hover / pressed / selected fill */
  raised: "bg-[var(--ds-surface-3)]",
  overlay: "bg-[var(--ds-surface-overlay)]",
  scrim: "bg-[var(--ds-surface-scrim)]",
  selected: "bg-[var(--ds-surface-selected)]",
} as const;

/** THE ONE TRUNCATION VOCABULARY.
 * A single-line token — a chip, a badge, a pill, a status — has to answer two */
export const dsClip = {
  /** the shell of a single-line token */
  token: "max-w-full overflow-hidden whitespace-nowrap",
  /** the child inside it that may be too long */
  text: "min-w-0 truncate",
} as const;

export const dsFg = {
  base: "text-[color:var(--ds-fg)]",
  secondary: "text-[color:var(--ds-fg-secondary)]",
  muted: "text-[color:var(--ds-fg-muted)]",
  faint: "text-[color:var(--ds-fg-faint)]",
  inverse: "text-[color:var(--ds-fg-inverse)]",
  link: "text-[color:var(--ds-fg-link)]",
  danger: "text-[color:var(--ds-danger)]",
} as const;

export const dsBorder = {
  subtle: "border-[color:var(--ds-border-subtle)]",
  base: "border-[color:var(--ds-border)]",
  strong: "border-[color:var(--ds-border-strong)]",
  loud: "border-[color:var(--ds-border-loud)]",
} as const;

/** SHAPE + DEPTH */
export const dsRadius = {
  xs: "rounded-[var(--ds-radius-xs)]",
  sm: "rounded-[var(--ds-radius-sm)]",
  md: "rounded-[var(--ds-radius-md)]",
  lg: "rounded-[var(--ds-radius-lg)]",
  xl: "rounded-[var(--ds-radius-xl)]",
  pill: "rounded-[var(--ds-radius-pill)]",
} as const;

/** Elevation 0 is the default. Only things that float get 1–3. */
export const dsElev = {
  /** resting cards that need separation from a busy background */
  low: "ds-elev-1",
  /** menus, popovers, tooltips */
  mid: "ds-elev-2",
  /** dialogs and drawers */
  high: "ds-elev-3",
} as const;

/** FOCUS + MOTION */
/** Every interactive element gets this. There is no opt-out. */
export const dsFocus = "outline-none ds-focus";
export const dsFocusWithin = "ds-focus-within";

/** THE MOTION LANGUAGE — five classes, and every moving thing in the product
 * uses one of them. There is no sixth, and no surface invents its own timing. */
export const dsMotion = {
  /** colour / fill / edge, in place — hover tints, a status settling. 140ms */
  base: "ds-motion",
  /** press + hover on a COMMAND. 90ms — a press must feel like a press */
  fast: "ds-motion-fast",
  /** something ARRIVING: an overlay, a toast, a record just read. 150ms */
  enter: "ds-motion-enter",
  /** something LEAVING. 90ms on the `in` curve — it goes, it does not drift */
  exit: "ds-motion-exit",
  /** a SPATIAL change: a panel reshaping, a rail collapsing. 220ms */
  move: "ds-motion-move",
} as const;

/** The one travel distance language. Motion here NAMES A DIRECTION; it is never
 * a journey. Use these as translate values, never a hand-picked px. */
export const dsTravel = {
  /** 4px — a popover leaving its trigger */
  sm: "var(--ds-travel-sm)",
  /** 8px — a dialog, a toast, a record arriving */
  md: "var(--ds-travel-md)",
} as const;

/** Named stacking roles; values and focus behavior live in tokens.css. */
export const dsLayer = {
  /** sticky table headers, panel toolbars, the row action bar */
  sticky: "z-10",
  /** dropdowns, popovers, context menus */
  menu: "z-20",
  /** drawers and their scrim */
  drawer: "z-30",
  /** modal dialogs and their scrim */
  modal: "z-40",
  /** toasts — always above everything, including a modal */
  toast: "z-50",
  skipFocus: "ds-layer-skip-focus",
  toastViewport: "ds-layer-toast-viewport",
  toastCard: "ds-layer-toast-card",
} as const;

/** DENSITY — heights and gaps builders reach for by name. */
export const dsSize = {
  hXs: "h-[var(--ds-h-xs)]",
  hSm: "h-[var(--ds-h-sm)]",
  hMd: "h-[var(--ds-h-md)]",
  hLg: "h-[var(--ds-h-lg)]",
  hRow: "h-[var(--ds-h-row)]",
  hBodyControl: "h-[var(--ds-h-body-control)]",
  hBodyRow: "min-h-[var(--ds-h-body-row)]",
  hBar: "h-[var(--ds-h-bar)]",
  hTopbar: "h-[var(--ds-h-topbar)]",
  /** the Session Card's reserved micro-pipeline band — see the token's note */
  hMicroPipeline: "h-[var(--ds-h-micro-pipeline)]",
  wRail: "w-[var(--ds-w-rail)]",
  wBodyContent: "max-w-[var(--ds-w-body-content)]",
} as const;

export const dsGap = {
  /** inside a control: icon → label */
  hair: "gap-[var(--ds-space-hair)]",
  tight: "gap-[var(--ds-space-tight)]",
  snug: "gap-[var(--ds-space-snug)]",
  /** between controls */
  base: "gap-[var(--ds-space-base)]",
  /** between groups inside a panel */
  cozy: "gap-[var(--ds-space-cozy)]",
  loose: "gap-[var(--ds-space-loose)]",
  /** between sections of a page */
  section: "gap-[var(--ds-space-section)]",
} as const;

export const dsPad = {
  /** a dense row or chip interior */
  tight: "px-[var(--ds-space-snug)] py-[var(--ds-space-hair)]",
  /** the default control interior */
  base: "px-[var(--ds-space-base)] py-[var(--ds-space-tight)]",
  /** a card / panel body */
  card: "p-[var(--ds-space-cozy)]",
  /** a dialog body or an empty state */
  roomy: "p-[var(--ds-space-loose)]",
} as const;

/** The one icon size language. Icons never scale independently of the text
 * they sit beside — 12px icon with meta text, 14px with UI text. */
export const dsIcon = {
  /** 12px — beside micro/meta text */
  sm: "size-3",
  /** 14px — beside body/UI text (the default) */
  md: "size-3.5",
  /** 16px — beside title text, empty states, banners */
  lg: "size-4",
} as const;
