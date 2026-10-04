/**
 * Ported from legacy hr-automation@793abe1f8265f3213ffe8a80d6cfd9860a32a1dc,
 * src/dashboard/components/dev/rebuild-demo/ds/primitives-layout.tsx
 *
 * TWO EXCEPTIONS port from the later legacy commit `1ec1d870`. `TakeoverFrame`
 * has no counterpart in that file. It is the single shared takeover root D275
 * item 2 asks for, and its geometry is ported from the demo's own takeover
 * CONTAINERS at that commit —
 * `src/dashboard/components/dev/rebuild-demo/RebuildDemo.tsx:656-678` (the
 * `shellView` switch) and `.../DemoSettings.tsx:1071-1075` (Settings' own root,
 * the one that lays its children out in a row). Its own JSDoc carries both
 * pointers. `Banner`'s `band` shape ports the storage band's border-bottom-only,
 * radius-free shell from `.../DemoSettings.tsx:1204-1237`; D281 item 7 confines
 * that shape to the app-wide storage hazard while the default card stays the
 * original primitive everywhere else.
 */
import { Alert as HeroAlert, Card as HeroCard, EmptyState as HeroEmptyState, Surface as HeroSurface } from "@heroui/react";
import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { CircleAlert, Info, ShieldAlert, TriangleAlert, CheckCircle2, ChevronRight } from "lucide-react";
import { cn } from "../lib/utils.js";
import { ShadcnCard, ShadcnCardContent, ShadcnCardFooter, ShadcnCardHeader } from "./shadcn-card.js";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./shadcn-collapsible.js";
import { ShadcnTabs, ShadcnTabsContent, ShadcnTabsList, ShadcnTabsTrigger } from "./shadcn-tabs.js";
import { dsBorder, dsElev, dsFocus, dsIcon, dsMotion, dsRadius, dsSize, dsSurface, dsText } from "./tokens.js";

/** Shared frame for dashboard and full-page action bars, including optional bands. */
export function ActionBar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex shrink-0 flex-col overflow-hidden border", dsRadius.lg, dsBorder.base, dsSurface.card, className)}>{children}</div>;
}

export function ActionBarRow({ children, label, className }: { children: ReactNode; label?: string; className?: string }) {
  return <div role={label ? "group" : undefined} aria-label={label} className={cn("flex min-w-0 items-center", dsSize.hBar, "gap-[var(--ds-space-snug)] px-[var(--ds-space-cozy)]", className)}>{children}</div>;
}

/** A compact disclosure composed from shadcn's Radix Collapsible parts. */
export function Disclosure({
  summary,
  description,
  meta,
  children,
  defaultOpen,
  open,
  onOpenChange,
  variant = "default",
  className,
  summaryClassName,
  contentClassName,
  title,
}: {
  summary: ReactNode;
  /** A quiet second line, shown by the compact body disclosure variant. */
  description?: ReactNode;
  /** Optional right-aligned value, such as a count, in the body variant. */
  meta?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  /** Controlled open state; omit both `open` and `onOpenChange` for default behavior. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  variant?: "default" | "body";
  className?: string;
  summaryClassName?: string;
  contentClassName?: string;
  title?: string;
}) {
  const bodyVariant = variant === "body";
  return <Collapsible
    defaultOpen={defaultOpen}
    open={open}
    onOpenChange={onOpenChange}
    className={cn("group", bodyVariant && "ds-disclosure-body", className)}
    title={title}
  >
    <CollapsibleTrigger className={cn("ds-disclosure-trigger flex w-full cursor-pointer items-center gap-[var(--ds-space-tight)] text-left", dsFocus, summaryClassName)}>
      <ChevronRight aria-hidden className={cn(dsIcon.sm, "shrink-0 text-[color:var(--ds-fg-muted)] transition-transform group-data-[state=open]:rotate-90")} />
      {bodyVariant ? (
        <span className="ds-disclosure-body-copy min-w-0 flex-1">
          <span className="ds-disclosure-body-title">{summary}</span>
          {description && <span className="ds-disclosure-body-description">{description}</span>}
        </span>
      ) : (
        <span className="min-w-0 flex-1">{summary}</span>
      )}
      {bodyVariant && meta && <span className="ds-disclosure-body-meta">{meta}</span>}
    </CollapsibleTrigger>
    <CollapsibleContent className={contentClassName}>{children}</CollapsibleContent>
  </Collapsible>;
}

/** Scope the shared content-body density while leaving the product shell untouched. */
export function DsBodyScope({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <div className={cn("ds-body-scope", className)} {...props}>
      {children}
    </div>
  );
}

/** A content-page heading sized for the shared body scope. */
export function PageHeading({
  title,
  description,
  actions,
  as: Heading = "h1",
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  as?: "h1" | "h2";
  className?: string;
}) {
  return (
    <header className={cn("ds-page-heading", className)}>
      <div className="min-w-0">
        <Heading className={cn("ds-page-heading-title", dsText.pageTitle, "text-[color:var(--ds-fg)]")}>
          {title}
        </Heading>
        {description && (
          <p className={cn("ds-page-heading-description", dsText.meta)}>{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-[var(--ds-space-snug)]">{actions}</div>}
    </header>
  );
}

/** A labeled, rounded group of related body fields. */
export function FormGroup({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div role="group" aria-label={label} className={cn("ds-form-group", className)}>
      {children}
    </div>
  );
}

/** A titled section for shared body pages, with consistent heading and group rhythm. */
export function BodySection({
  title,
  as: Heading = "h2",
  className,
  children,
}: {
  title: ReactNode;
  as?: "h2" | "h3";
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("ds-body-section", className)}>
      <Heading className="ds-body-section-heading">{title}</Heading>
      {children}
    </section>
  );
}

/** A shared result row for checks, storage summaries and evidence. */
export function ResultRow({
  label,
  description,
  value,
  evidence,
  controlWidth = "standard",
  className,
}: {
  label: ReactNode;
  description?: ReactNode;
  value: ReactNode;
  evidence?: ReactNode;
  /** Preferred value column for body rows; ignored outside DsBodyScope. */
  controlWidth?: "standard" | "wide";
  className?: string;
}) {
  return (
    <div data-control-width={controlWidth} className={cn("ds-body-row ds-result-row", className)}>
      <div className="ds-result-row-copy min-w-0">
        <div className="ds-field-label">{label}</div>
        {description && <p className="ds-field-description">{description}</p>}
      </div>
      <div className="ds-result-row-side">
        <div className="ds-result-row-value">{value}</div>
        {evidence && <div className="ds-result-row-evidence">{evidence}</div>}
      </div>
    </div>
  );
}

/**
 * Containers, structure and navigation.
 *
 * The layout rule of this product: DEPTH COMES FROM SURFACE + HAIRLINE, not
 * from shadow. A Panel sits on the page; a Card sits in a Panel; a well sits
 * in a Card. Anything with a shadow is FLOATING (menu, dialog, drawer, toast)
 * — if it is not floating and it has a shadow, that is a bug.
 */

/* =========================================================================
 * Panel — the primary region container (queue, log, settings, inbox…)
 * ====================================================================== */

type PanelHeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

const PANEL_HEADING_TAG: Readonly<Record<PanelHeadingLevel, "h1" | "h2" | "h3" | "h4" | "h5" | "h6">> = {
  1: "h1",
  2: "h2",
  3: "h3",
  4: "h4",
  5: "h5",
  6: "h6",
};

export function Panel({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLElement> & { children: ReactNode }) {
  return (
    <ShadcnCard asChild
      className={cn(
        "flex min-h-0 min-w-0 flex-col overflow-hidden border",
        "border-[color:var(--ds-border)] bg-[var(--ds-surface-1)]",
        dsRadius.lg,
        className,
      )}
      {...props}
    >
      <section>{children}</section>
    </ShadcnCard>
  );
}

/**
 * A panel's header. `title` is the only required part; `meta` is the quiet
 * right-hand slot for counts and timestamps, `actions` for controls. Product
 * panels declare `headingLevel` so their label is exposed as a real heading;
 * unlevelled titles remain available for design-system specimens.
 */
export function PanelHeader({
  title,
  headingLevel,
  subtitle,
  icon,
  meta,
  actions,
  className,
}: {
  title: ReactNode;
  /** Semantic level for a product panel title; omitted only by non-product specimens. */
  headingLevel?: PanelHeadingLevel;
  subtitle?: ReactNode;
  icon?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  const Title = headingLevel === undefined ? "span" : PANEL_HEADING_TAG[headingLevel];

  return (
    <ShadcnCardHeader asChild
      className={cn(
        "flex shrink-0 items-center gap-[var(--ds-space-base)] border-b px-[var(--ds-space-cozy)]",
        "min-h-[var(--ds-h-bar)] border-[color:var(--ds-border)]",
        subtitle && "py-[var(--ds-space-base)]",
        className,
      )}
    >
      <header>
      {icon && <span className="shrink-0 text-[color:var(--ds-fg-muted)]">{icon}</span>}
      <span className={cn("flex min-w-0 flex-col", subtitle && "gap-[var(--ds-space-hair)]")}>
        <Title className={cn(subtitle ? dsText.section : dsText.title, dsText.flush, "truncate font-semibold text-[color:var(--ds-fg)]")}>
          {title}
        </Title>
        {subtitle && (
          <span className={cn(dsText.meta, "truncate text-[color:var(--ds-fg-muted)]")}>
            {subtitle}
          </span>
        )}
      </span>
      {meta && (
        <span className={cn(dsText.meta, "ml-auto shrink-0 text-[color:var(--ds-fg-muted)]")}>
          {meta}
        </span>
      )}
      {actions && (
        <span className={cn("flex shrink-0 items-center gap-[var(--ds-space-tight)]", !meta && "ml-auto")}>
          {actions}
        </span>
      )}
      </header>
    </ShadcnCardHeader>
  );
}

/** A secondary bar under a PanelHeader: filters, search, view switches. */
export function PanelToolbar({
  label,
  variant = "default",
  className,
  children,
}: {
  /** accessible name — a toolbar without one is a mystery to a screen reader */
  label: string;
  variant?: "default" | "body";
  className?: string;
  children: ReactNode;
}) {
  return (
    <ShadcnCardContent asChild
      role="group"
      aria-label={label}
      className={cn(
        variant === "body"
          ? "ds-body-toolbar flex min-w-0 items-center gap-[var(--ds-space-snug)] overflow-x-auto rounded-[var(--ds-radius-md)] border border-[color:var(--ds-border)] bg-[var(--ds-surface-1)]"
          : "flex shrink-0 items-center gap-[var(--ds-space-tight)] overflow-x-auto border-b px-[var(--ds-space-base)] min-h-[var(--ds-h-bar)] border-[color:var(--ds-border-subtle)]",
        className,
      )}
    >
      <div>{children}</div>
    </ShadcnCardContent>
  );
}

/** The scrolling region of a Panel. Exactly one per Panel. */
export function PanelBody({ className, children }: { className?: string; children: ReactNode }) {
  return <ShadcnCardContent className={cn("min-h-0 flex-1 overflow-y-auto", className)}>{children}</ShadcnCardContent>;
}

export function PanelFooter({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <ShadcnCardFooter asChild
      className={cn(
        "flex shrink-0 items-center gap-[var(--ds-space-base)] border-t px-[var(--ds-space-cozy)] py-[var(--ds-space-base)]",
        // The recessed plane, the same solid band the queue row's own footer
        // draws. It was `surface-2` + a full-strength border — a second answer
        // to "this sits back from the panel" living in a primitive, which is
        // the worst place for one to live: every consumer inherits it.
        "border-[color:var(--ds-border-subtle)] bg-[var(--ds-recess-bg)]",
        className,
      )}
    >
      <footer>{children}</footer>
    </ShadcnCardFooter>
  );
}

/* =========================================================================
 * Card — a single object inside a Panel (a run, a session, a receipt)
 * ====================================================================== */

export function Card({
  interactive,
  selected,
  tone = "default",
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  /** hover/press affordance — only when the whole card is clickable */
  interactive?: boolean;
  selected?: boolean;
  /** `attention` draws the left rail in amber; use it for gated rows only */
  tone?: "default" | "attention" | "danger";
}) {
  return (
    <HeroCard
      className={cn(
        "relative flex min-w-0 flex-col gap-0 border bg-[var(--ds-surface-1)] p-0 shadow-none",
        dsRadius.lg,
        dsMotion.base,
        "border-[color:var(--ds-border)]",
        tone === "attention" &&
          "border-l-[length:var(--ds-border-w-rail)] border-l-[color:var(--ds-status-waiting-mark)]",
        tone === "danger" &&
          "border-l-[length:var(--ds-border-w-rail)] border-l-[color:var(--ds-status-failed-fg)]",
        interactive && cn("cursor-pointer hover:border-[color:var(--ds-border-strong)] hover:bg-[var(--ds-surface-2)]"),
        selected && "border-[color:var(--ds-border-loud)] bg-[var(--ds-surface-selected)]",
        className,
      )}
      {...props}
    >
      {children}
    </HeroCard>
  );
}

export function CardHeader({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <HeroCard.Header className={cn("flex flex-row items-center gap-[var(--ds-space-base)] px-[var(--ds-space-cozy)] pt-[var(--ds-space-base)]", className)}>
      {children}
    </HeroCard.Header>
  );
}

/**
 * A card's content.
 *
 * `grow` is what makes a card in a GRID behave. Sibling cards in a grid row all
 * stretch to the tallest one, but a body that does not claim the slack leaves
 * it below itself — so the card's border sits at the row's height while its
 * content stops wherever it happened to end, and `CardFooter` / `CardBase`
 * cannot pin to the bottom because there is nothing pushing them there.
 *
 * It sets `flex-grow`, never `flex-1`: the body absorbs the extra space without
 * having its basis reset, so nothing inside is squeezed to make it fit.
 *
 * Pass it whenever the card is one of several in a row. It costs nothing on a
 * card that stands alone.
 */
export function CardBody({
  grow,
  className,
  children,
}: {
  /** claim the card's leftover height — required for anything to sit on the bottom edge */
  grow?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <HeroCard.Content className={cn("block min-w-0 flex-none gap-0 px-[var(--ds-space-cozy)] py-[var(--ds-space-base)]", grow && "grow", className)}>
      {children}
    </HeroCard.Content>
  );
}

/**
 * The card's BASE — whatever must sit on the bottom edge of the row rather than
 * at the end of this card's own content.
 *
 * The defect it exists to kill: a card is a flex column that stretches to its
 * grid row's height, its trailing element is separated by a fixed `mt-*`, and
 * so a card whose description wraps to two lines pushes its button a line lower
 * than the sibling beside it. Every such card was fixing it locally, or not at
 * all — `DemoShell`'s Session Cards got it right inline and nothing else could
 * reuse that.
 *
 * ```tsx
 * <Card>
 *   <CardBody grow className="flex flex-col gap-[var(--ds-space-snug)]">
 *     <p>…description of any length…</p>
 *     <CardBase><Button>See this candidate</Button></CardBase>
 *   </CardBody>
 * </Card>
 * ```
 *
 * **It must sit inside a flex column** (a `CardBody`/card that is
 * `flex flex-col`) — `mt-auto` is a flexbox mechanism and does nothing in a
 * block container. The slack lands ABOVE it, and is left empty on purpose: a
 * card with less to say genuinely has less to say, and padding it out dresses
 * it up as fuller than it is.
 */
export function CardBase({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("mt-auto flex min-w-0 flex-col", className)}>{children}</div>;
}

/* =========================================================================
 * CompareGrid / CompareCard — cards that are read ACROSS, not down
 * ====================================================================== */

/**
 * A row of cards the operator compares STRAIGHT ACROSS, sharing one set of row
 * tracks so the nth line of every card sits on the nth baseline.
 *
 * WHY `CardBase` IS NOT ENOUGH, and this is the distinction worth keeping.
 * `CardBase` pins the BOTTOM edge: a card with more to say is taller inside and
 * its trailing control still lands level with its neighbour's. That is right
 * for a grid of cards each describing its own thing. It is NOT enough for cards
 * that are two readings of the SAME thing — two identity candidates, say —
 * because there the operator reads horizontally: name against name, EID against
 * EID, reason against reason. Pin only the bottom and the left card's two-line
 * reason pushes its name, its EID and its reason all one line up from the right
 * card's, so nothing lines up except the button.
 *
 * The mechanism is `grid-template-rows: subgrid`. The PARENT owns the tracks;
 * each card spans `rows` of them and adopts them, so a track is as tall as the
 * tallest cell in it ACROSS every card in the band. A card with nothing to put
 * in a track leaves it empty — which is the point: the empty cell holds the
 * space its neighbour needs, so the rows after it stay level.
 *
 * ```tsx
 * <CompareGrid rows={5} min="16rem">
 *   {people.map((p) => (
 *     <CompareCard key={p.id} rows={5}>
 *       …exactly five children, one per track, in the same order every time…
 *     </CompareCard>
 *   ))}
 * </CompareGrid>
 * ```
 *
 * **N is not two.** The columns are `auto-fit` over a minimum, so three
 * candidates wrap into a second BAND and that band gets its own five tracks —
 * which is correct, because you compare across a row, not down a page.
 *
 * **Every card must render the same number of children in the same order**, one
 * per track; use an empty `<span />` for a fact this card does not have. That
 * is the contract subgrid alignment rests on.
 */
export function CompareGrid({
  rows,
  min = "15rem",
  className,
  children,
}: {
  /** how many tracks each card spans — the number of aligned lines */
  rows: number;
  /** the narrowest a card may be before the row wraps into a second band */
  min?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn("grid gap-[var(--ds-space-snug)]", className)}
      style={{
        gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${min}), 1fr))`,
        gridAutoRows: "auto",
        // The tracks the cards subgrid onto. `auto` everywhere: a track is as
        // tall as the tallest cell across the band, which is the whole point.
        gridTemplateRows: `repeat(${rows}, auto)`,
      }}
    >
      {children}
    </div>
  );
}

/** One card in a `CompareGrid`. `rows` must match the grid's. */
export function CompareCard({
  rows,
  className,
  children,
}: {
  rows: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "grid min-w-0 border p-[var(--ds-space-base)]",
        "gap-y-[var(--ds-space-hair)]",
        dsRadius.md,
        "border-[color:var(--ds-border)] bg-[var(--ds-surface-1)]",
        className,
      )}
      // `subgrid` on the ROW axis only — the card keeps its own single column.
      // Every card carries identical padding, so the inset each one takes out of
      // its first and last track is identical and the alignment survives it.
      style={{ gridRow: `span ${rows}`, gridTemplateRows: "subgrid" }}
    >
      {children}
    </div>
  );
}

export function CardFooter({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <HeroCard.Footer
      className={cn(
        "flex items-center gap-[var(--ds-space-tight)] border-t px-[var(--ds-space-cozy)] py-[var(--ds-space-snug)]",
        "border-[color:var(--ds-border-subtle)]",
        className,
      )}
    >
      {children}
    </HeroCard.Footer>
  );
}

/** An uppercase micro heading above a group of things. Not a `<h*>` substitute. */
export function SectionLabel({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn(dsText.caps, "text-[color:var(--ds-fg-muted)]", className)}>{children}</div>
  );
}

/* =========================================================================
 * Banner / Callout
 * ====================================================================== */

const BANNER_TONE = {
  info: {
    shell: "border-[color:var(--ds-info-border)] bg-[var(--ds-info-bg)]",
    icon: "text-[color:var(--ds-info-fg)]",
    Icon: Info,
    live: "status" as const,
  },
  success: {
    shell: "border-[color:var(--ds-success-border)] bg-[var(--ds-success-bg)]",
    icon: "text-[color:var(--ds-success-fg)]",
    Icon: CheckCircle2,
    live: "status" as const,
  },
  warning: {
    shell:
      "border-[color:var(--ds-status-waiting-border)] bg-[var(--ds-status-waiting-bg)]",
    icon: "text-[color:var(--ds-status-waiting-fg)]",
    Icon: CircleAlert,
    live: "status" as const,
  },
  danger: {
    shell: "border-[color:var(--ds-danger-border)] bg-[var(--ds-danger-quiet)]",
    icon: "text-[color:var(--ds-danger)]",
    Icon: TriangleAlert,
    live: "alert" as const,
  },
};

export type DsBannerTone = keyof typeof BANNER_TONE;
export type DsBannerShape = "card" | "band";

/**
 * An in-page message attached to a surface (not a toast — this one stays).
 * `danger` announces as an alert; the rest as status. Keep the title to one
 * line and put the recovery action in `action` — a message with no next step
 * is a message the operator cannot act on.
 */
export function Banner({
  tone = "info",
  shape = "card",
  title,
  children,
  icon,
  action,
  className,
}: {
  tone?: DsBannerTone;
  /** `band` is the full-width shell band: bottom edge only, with no radius. */
  shape?: DsBannerShape;
  title: ReactNode;
  children?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const spec = BANNER_TONE[tone];
  const Icon = spec.Icon;
  return (
    <HeroAlert.Root
      role={spec.live}
      className={cn(
        "flex w-auto items-start gap-[var(--ds-space-base)] p-[var(--ds-space-cozy)] shadow-none",
        shape === "card" ? cn("border", dsRadius.md) : "rounded-none border-b",
        spec.shell,
        className,
      )}
    >
      <HeroAlert.Indicator className={cn("mt-px shrink-0 p-0", spec.icon)}>
        {icon ?? <Icon aria-hidden className={dsIcon.lg} />}
      </HeroAlert.Indicator>
      <HeroAlert.Content className="flex min-w-0 flex-1 flex-col items-stretch gap-[var(--ds-space-tight)]">
        <div className={cn(dsText.ui, "font-semibold text-[color:var(--ds-fg)]")}>{title}</div>
        {children && (
          <div className={cn(dsText.body, "text-[color:var(--ds-fg-secondary)]")}>{children}</div>
        )}
      </HeroAlert.Content>
      {action && <div className="shrink-0">{action}</div>}
    </HeroAlert.Root>
  );
}

/* =========================================================================
 * PageHeader — the bar at the top of a full-page takeover
 * ====================================================================== */

/**
 * The header a full-page view wears when it replaces the dashboard: a way back,
 * what you are looking at, and its actions.
 *
 * The three takeovers (Archive, Explorer, Activity report) each hand-rolled
 * this, and drifted — two put the back button before the title and one after,
 * the icons were `size-4` in two places and `dsIcon.lg` in the third, and only
 * two of the three marked themselves read-only. Leaving the dashboard should
 * look the same every time you do it. Its inset card frame matches the
 * dashboard queue toolbar.
 */
export function PageHeader({
  title,
  icon,
  badge,
  back,
  actions,
  className,
}: {
  title: ReactNode;
  icon?: ReactNode;
  /** e.g. a read-only marker — sits with the title, not with the actions */
  badge?: ReactNode;
  /** the way back to the dashboard, always leftmost */
  back?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "mx-[var(--ds-shell-inset)] mt-[var(--ds-shell-inset)] flex min-h-[calc(var(--ds-h-bar)+var(--ds-space-hair))] shrink-0 flex-wrap items-center gap-[var(--ds-space-base)]",
        "rounded-[var(--ds-radius-lg)] border border-[color:var(--ds-border)] bg-[var(--ds-surface-1)]",
        "px-[var(--ds-space-cozy)] py-[var(--ds-space-hair)]",
        className,
      )}
    >
      {back}
      <span className="flex min-w-0 items-center gap-[var(--ds-space-snug)]">
        {icon && <span className="shrink-0 text-[color:var(--ds-fg-muted)]">{icon}</span>}
        <span className={cn(dsText.ui, dsText.flush, "truncate font-semibold text-[color:var(--ds-fg)]")}>{title}</span>
        {badge}
      </span>
      {actions && <span className="ml-auto flex shrink-0 items-center gap-[var(--ds-space-tight)]">{actions}</span>}
    </header>
  );
}

/* =========================================================================
 * TakeoverFrame — the root a full-page takeover wears
 * ====================================================================== */

/**
 * The ONE container every window-replacing surface mounts in (D275 item 2).
 *
 * A takeover REPLACES the window under the top bar, so it is full-bleed: x=0,
 * the viewport's whole width, no card frame, no radius and no gutter. That is
 * the demo's own container, copied:
 * // ported from legacy 1ec1d870 src/dashboard/components/dev/rebuild-demo/RebuildDemo.tsx:656-678
 * // ported from legacy 1ec1d870 src/dashboard/components/dev/rebuild-demo/DemoSettings.tsx:1071-1075
 * where `DemoSettingsPage`, `DemoArchivePage`, `DemoExplorerPage` and
 * `DemoActivityReportPage` each root in a bare `flex min-h-0 flex-1` div under
 * the bar. Settings alone lays its children out in a ROW (the 220px nav beside
 * the section), which is the only reason `direction` exists.
 *
 * The four surfaces each hand-rolled `Panel` + `useDsEnterTransition` + the two
 * `data-[demo-enter=from]:` classes, which is how the card frame got there in
 * the first place: `Panel` is the REGION container (border + radius +
 * `--ds-surface-1`), and a region inside a page is not the page. Taking the
 * frame away one surface at a time would have left four copies of the arrival
 * behind to drift; this owns BOTH, so the geometry and the motion contract are
 * one decision made once. D275 item 2 is exactly that — keep the shared
 * takeover wrapper as an accessibility/motion convention: every takeover
 * arrives the same way, from the same edge, over the same distance, and
 * `ds-motion-enter` + `--ds-travel-*` honour reduced motion with no branch here.
 *
 * `label` is required and lands on a `section`, so each takeover stays a named
 * landmark rather than an anonymous full-window div.
 *
 * ENTERING one MOVES FOCUS INTO IT, which is the other half of a pair
 * `dashboard-app.tsx` already held one end of. The Radix `Dialog` these pages
 * replaced took focus on open and gave it back on close for free; D272 item 1 /
 * D274 item 5 took the dialog away, the close arm was re-implemented by hand
 * (unit F4b finding 1) and the OPEN arm was not. Without it the operator opens
 * a page that replaces the window while their focus stays on a door that is no
 * longer on screen, and the next Tab walks the top bar instead of the page they
 * just asked for — a keyboard operator never reaches the takeover's own
 * controls without re-Tabbing the whole shell.
 *
 * It focuses ITSELF (`tabIndex={-1}`), not a control inside it, and that is the
 * choice D275 item 2 forces. The Activity report deliberately has NO `Back to
 * the dashboard` button (the demo's own rule, ported), so an `initialFocus` ref
 * the surfaces point at their Back button could never be the convention — three
 * takeovers would have one and the fourth would silently have nothing, which is
 * exactly the four-copies-drift this component exists to end. Focusing the
 * frame is uniform, and it is also the better announcement: the `section`
 * carries `label` as its accessible name, so a screen reader says the page the
 * operator just opened rather than one button on it. From here the first Tab
 * reaches whatever that takeover's first control happens to be.
 *
 * `outline-none` IS REQUIRED, and the parity lane is what proved it. The first
 * cut of this reasoned that nothing could paint: the frame carries no `dsFocus`
 * class, the product's ring is opt-in `.ds-focus:focus-visible` (`tokens.css`),
 * and the base layer's `* { outline-color }` sets a colour with no width or
 * style. All true, and all beside the point — the ring that appeared is
 * Chromium's own UA `:focus-visible { outline: auto }`, wearing that `*` rule's
 * colour. A programmatic focus with no preceding pointer interaction matches
 * `:focus-visible`, so opening any takeover drew a 2px ring around the ENTIRE
 * page. 38 references moved on it (2548px each, the frame's own perimeter).
 * Suppressing it is correct rather than a cover-up: `tabIndex={-1}` means the
 * operator can never keyboard-navigate TO this element, so a focus indicator on
 * it points at nothing they can act on, and what carries the arrival for a
 * screen reader is the region's accessible NAME, not an outline. With it, the
 * takeover corpus is byte-identical across this change.
 */
export function TakeoverFrame({
  label,
  direction = "column",
  animateFrame = true,
  className,
  children,
}: {
  /** the accessible name of the region — "Settings", "Archive", … */
  label: string;
  /** `row` only for Settings' nav-beside-section layout */
  direction?: "column" | "row";
  /** Settings animates its content while its permanent rail stays in place. */
  animateFrame?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const enter = useDsEnterTransition();
  const frame = useRef<HTMLElement>(null);
  useEffect(() => {
    const node = frame.current;
    // React sets a ref before it runs the effects of the commit that mounted
    // it, so this is the type's null and never a state — there is no takeover
    // whose frame is missing at this point.
    if (node === null) return;
    // A descendant that took focus in the SAME commit keeps it. Child effects
    // run before the parent's, so a control the surface deliberately focused
    // on arrival is already `document.activeElement` here, and stealing it
    // back would silently undo that surface's own decision.
    if (node.contains(document.activeElement)) return;
    // `preventScroll` because the frame is mid-transition: `ds-motion-enter` is
    // still moving it from `-var(--ds-travel-sm)`, and scrolling an element the
    // browser reads at a transformed position jogs the whole shell.
    node.focus({ preventScroll: true });
  }, []);
  return (
    <section
      ref={frame}
      tabIndex={-1}
      {...enter}
      aria-label={label}
      className={cn(
        // `flex min-h-0 flex-1` IS the demo root, byte for byte. `overflow-hidden`
        // is the one addition, and it is a NET, not a mechanism.
        // verified 2026-08-27: the root must clip because it is the last box
        // between a takeover's content and the sessions bar. Measured live at
        // 1440x900 on all four takeovers, with an over-wide (3000px) and an
        // over-tall (2000px) child forced in: the frame's own box is IDENTICAL
        // with and without it (x=0 y=44 w=1440 h=819), the page never scrolls in
        // either axis either way (the shell root, `flex h-screen min-w-0
        // flex-col overflow-hidden`, already owns the viewport clip), and the
        // ONLY difference is whether an overflowing child PAINTS across the
        // frame's bottom edge at y=863 — where the sessions bar is. The demo's
        // root can go without because each of its pages gives its own regions an
        // `overflow-y-auto`; so does every surface here, which is exactly why
        // this is a net and why keeping it costs no pixel.
        // `min-w-0` was dropped: the frame is a COLUMN-flex item under `main`,
        // so `min-width: auto` is never the constraint being fought, and all
        // three configurations measured identically.
        // `outline-none`: see the JSDoc — it suppresses Chromium's UA focus ring
        // on a target the operator can never tab to. Not a `dsFocus` opt-out;
        // this element was never opted in.
        "flex min-h-0 flex-1 overflow-hidden outline-none",
        direction === "row" ? "flex-row" : "flex-col",
        animateFrame && "data-[demo-enter=from]:translate-y-[calc(-1*var(--ds-travel-sm))] data-[demo-enter=from]:opacity-0 ds-motion-enter",
        className,
      )}
    >
      {children}
    </section>
  );
}

/* =========================================================================
 * MetaLine — the provenance line
 * ====================================================================== */

/**
 * "Where this came from", in one line: ids, codes, clocks, actors, hashes.
 *
 * Every surface in this product ends up printing one — `code X · query "Y" · no
 * corpus was scanned`, `receipt R · generated 2:20 PM · attempt 2`, `header row
 * 4 · fingerprint 503172dd`. They were hand-rolled seven different ways, four of
 * them reaching for a raw `font-mono` (which drops the tabular figures that stop
 * a clock from jittering) instead of `dsText.nums`. One component, one treatment.
 *
 * Segments are joined with the product's ` · ` separator so no call site has to
 * remember it, and `undefined`/`null`/`false` segments drop out — a conditional
 * fact never leaves a dangling dot behind.
 */
export function MetaLine({
  items,
  tone = "muted",
  className,
}: {
  items: ReactNode[];
  /** `faint` for a footer's standing note; `muted` for a fact about this run */
  tone?: "muted" | "faint";
  className?: string;
}) {
  const shown = items.filter((item) => item !== null && item !== undefined && item !== false);
  if (shown.length === 0) return null;
  return (
    <span
      className={cn(
        dsText.meta,
        dsText.nums,
        tone === "faint" ? "text-[color:var(--ds-fg-faint)]" : "text-[color:var(--ds-fg-muted)]",
        className,
      )}
    >
      {shown.map((item, index) => (
        <span key={index}>
          {index > 0 && <span aria-hidden> · </span>}
          {item}
        </span>
      ))}
    </span>
  );
}

/* =========================================================================
 * ChipRow — a wrapping row of facts that ends on ONE edge
 * ====================================================================== */

/**
 * A row of chips that WRAPS without going ragged.
 *
 * `flex-wrap` on a set of chips of unequal width leaves each line ending
 * wherever its last chip happened to stop, and the commonest result is one
 * orphan on line two: `wage $18.50/hr` `effective 07/01` `dept 000482` above a
 * lone `txn TXN-0891245`. Four facts then read as three-plus-one instead of as
 * one block of four.
 *
 * A GRID track fixes it at the root: every chip occupies one cell of the same
 * width, so every line ends on the same edge and the wrap is a second row of a
 * table rather than an overflow. `auto-fit` means the track count is whatever
 * the container can hold, so the same row is two columns in a 400px queue and
 * four in a full-width panel with no breakpoint anywhere.
 *
 * Use it for a set of PEER facts. A row that mixes a chip with a sentence or a
 * button is not this — it is a flex row, and the chip is one item in it.
 */
export function ChipRow({
  children,
  /** the widest a single cell may be — defaults to `--ds-w-chip-cell` */
  cell,
  className,
}: {
  children: ReactNode;
  cell?: string;
  className?: string;
}) {
  return (
    <div
      className={cn("grid min-w-0 items-center gap-[var(--ds-space-tight)]", className)}
      style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${cell ?? "var(--ds-w-chip-cell)"}, 1fr))` }}
    >
      {children}
    </div>
  );
}

/* =========================================================================
 * Refusal — the server said no
 * ====================================================================== */

/**
 * A REFUSAL, which is not the same thing as a failure.
 *
 * A failure is the product breaking; a refusal is the product declining, on
 * purpose, with a rule behind it — a stale contract, an unresolved parked write,
 * a fence that has not cleared. This surface exists in seven places (enqueue
 * rejected, an intake block, a park-resolve fence miss, a search lookup that
 * could not run, a setting the environment owns, a bump that would bury a live
 * run, a notification backfill gap) and was drawn seven different ways.
 *
 * Two things it always does, because they are the whole point:
 *
 *  - **It carries the CODE**, in the standard `MetaLine` position. A refusal the
 *    operator cannot quote is a refusal they cannot get help with.
 *  - **It says what was NOT done.** Pass `outcome` — "nothing was recorded",
 *    "nothing is enqueued". `role="alert"` comes from `Banner`'s danger tone.
 *
 * `ShieldAlert` is deliberately not `TriangleAlert`: the triangle means
 * something broke, the shield means something was refused. Two different
 * questions, two different icons.
 */
export function Refusal({
  title,
  code,
  outcome,
  meta = [],
  action,
  className,
  children,
}: {
  title: ReactNode;
  /** the machine-readable refusal code — required; a refusal without one is a shrug */
  code: string;
  /** what was NOT done, in the product's own words */
  outcome?: ReactNode;
  /** extra provenance segments beside the code */
  meta?: ReactNode[];
  action?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <Banner
      tone="danger"
      title={title}
      icon={<ShieldAlert aria-hidden className={dsIcon.lg} />}
      action={action}
      className={className}
    >
      <span className="flex flex-col gap-[var(--ds-space-tight)]">
        {children && <span>{children}</span>}
        <MetaLine items={[`code ${code}`, ...meta, outcome]} />
      </span>
    </Banner>
  );
}

/* =========================================================================
 * BulletList
 * ====================================================================== */

/**
 * A short list of facts. Five surfaces were rendering these as a column of
 * `<p>· {item}</p>` — a literal middle-dot character, which a screen reader
 * reads aloud and which gives the reader no list semantics at all. Same look,
 * real `<ul>`, the marker drawn rather than spoken.
 */
export function BulletList({
  items,
  tone = "secondary",
  className,
}: {
  items: ReactNode[];
  tone?: "secondary" | "muted";
  className?: string;
}) {
  if (items.length === 0) return null;
  return (
    <ul className={cn("flex min-w-0 flex-col gap-[var(--ds-space-hair)]", className)}>
      {items.map((item, index) => (
        <li
          key={index}
          className={cn(
            dsText.body,
            "flex min-w-0 gap-[var(--ds-space-snug)]",
            tone === "muted"
              ? "text-[color:var(--ds-fg-muted)]"
              : "text-[color:var(--ds-fg-secondary)]",
          )}
        >
          <span aria-hidden className="select-none text-[color:var(--ds-fg-faint)]">
            ·
          </span>
          <span className="min-w-0 flex-1">{item}</span>
        </li>
      ))}
    </ul>
  );
}

/* =========================================================================
 * EmptyState
 * ====================================================================== */

/**
 * Empty is a STATE, not a blank. Say what would be here, why it is not, and
 * what to do — in that order. No illustrations, no jokes.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <HeroEmptyState
      className={cn(
        "flex flex-col items-center justify-center gap-[var(--ds-space-base)] p-[var(--ds-space-section)] text-center",
        className,
      )}
    >
      {icon && <span className="text-[color:var(--ds-fg-faint)]">{icon}</span>}
      <span className={cn(dsText.ui, "font-medium text-[color:var(--ds-fg-secondary)]")}>{title}</span>
      {description && (
        <span className={cn(dsText.body, "max-w-[46ch] text-[color:var(--ds-fg-muted)]")}>
          {description}
        </span>
      )}
      {action && <span className="mt-[var(--ds-space-tight)]">{action}</span>}
    </HeroEmptyState>
  );
}

/* =========================================================================
 * Tabs — roving tabindex, arrow keys, Home/End, correct ARIA wiring
 * ====================================================================== */

/**
 * ```tsx
 * <Tabs value={tab} onValueChange={setTab}>
 *   <TabList label="Run detail">
 *     <Tab value="log">Log</Tab>
 *     <Tab value="data" count={12}>Data</Tab>
 *   </TabList>
 *   <TabPanel value="log">…</TabPanel>
 * </Tabs>
 * ```
 * Arrow keys move between tabs, Home/End jump to the ends, and only the
 * active tab is in the tab order — the WAI-ARIA "manual activation" pattern
 * with automatic selection on arrow, which is what a keyboard-first operator
 * expects.
 */
export function Tabs({
  value,
  onValueChange,
  className,
  children,
}: {
  value: string;
  onValueChange: (v: string) => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <ShadcnTabs
      value={value}
      onValueChange={onValueChange}
      className={cn("flex min-h-0 min-w-0 flex-col", className)}
    >
      {children}
    </ShadcnTabs>
  );
}

export function TabList({
  label,
  className,
  children,
}: {
  /** accessible name for the tab set */
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <ShadcnTabsList
      aria-label={label}
      className={cn(
        "flex shrink-0 items-center gap-[var(--ds-space-tight)] border-b",
        "border-[color:var(--ds-border)] px-[var(--ds-space-base)]",
        className,
      )}
    >
      {children}
    </ShadcnTabsList>
  );
}

export function Tab({
  value,
  count,
  icon,
  disabled,
  className,
  children,
}: {
  value: string;
  /** a count beside the label — omit rather than render 0 */
  count?: number;
  icon?: ReactNode;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <ShadcnTabsTrigger
      value={value}
      disabled={disabled}
      className={cn(
        "relative inline-flex w-auto flex-none cursor-pointer items-center gap-[var(--ds-space-snug)]",
        "h-[var(--ds-h-bar)] px-[var(--ds-space-base)]",
        dsText.ui,
        dsText.flush,
        dsFocus,
        dsMotion.fast,
        "active:translate-y-px",
        "border-b-2 border-transparent -mb-px",
        "text-[color:var(--ds-fg-muted)] hover:text-[color:var(--ds-fg)]",
        "data-[state=active]:border-b-[color:var(--ds-accent)] data-[state=active]:font-semibold data-[state=active]:text-[color:var(--ds-fg)]",
        "disabled:cursor-not-allowed disabled:opacity-45",
        className,
      )}
    >
      {icon}
      {children}
      {typeof count === "number" && count > 0 && (
        <span className={cn(dsText.nums, dsText.micro, "text-[color:var(--ds-fg-muted)]")}>{count}</span>
      )}
    </ShadcnTabsTrigger>
  );
}

export function TabPanel({
  value,
  className,
  children,
}: {
  value: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <ShadcnTabsContent
      value={value}
      className={cn("min-h-0 flex-1 overflow-y-auto", dsFocus, className)}
    >
      {children}
    </ShadcnTabsContent>
  );
}

/* =========================================================================
 * Well — an inset region inside a Card (raw output, a preview, a diff)
 * ====================================================================== */

/**
 * An inset region inside a Card. It reads the one recessed plane
 * (`--ds-recess-*`), the same fill a row footer and a chip read — a fill and
 * no line, so a card holding a well, a footer and four chips is a set of tones
 * rather than four nested boxes.
 *
 * A well that SCROLLS is the one consumer allowed to draw the edge, by setting
 * `--ds-recess-border` on itself: there the border is not decoration, it is
 * what tells the eye the content is cut rather than finished.
 */
export function Well({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <HeroSurface variant="transparent"
      className={cn(
        "min-w-0 border bg-[var(--ds-recess-bg)] p-[var(--ds-space-base)]",
        "border-[color:var(--ds-recess-border)]",
        dsRadius.md,
        dsText.body,
        className,
      )}
    >
      {children}
    </HeroSurface>
  );
}

/* =========================================================================
 * ARRIVING — the enter transition for surfaces Radix does not own
 * ====================================================================== */

/**
 * Spread onto an element that has just MOUNTED to make it arrive rather than
 * appear. Returns `data-demo-enter="from"` for the first committed frame and
 * `"to"` from the next, so the element's own `data-[demo-enter=from]:` classes
 * describe where it comes from and the transition carries it in.
 *
 * WHY A HOOK AND NOT A KEY-FRAME. A key-frame restarts from zero when it is
 * interrupted; a transition re-targets from wherever it currently is. Every
 * moving thing in this product is a transition for that reason (see the
 * `dsMotion` note), and a mount is the one case a transition cannot express on
 * its own — there is no previous value to move away from. This manufactures
 * one, and everything after the first frame behaves like every other
 * transition in the system, including being interruptible.
 *
 * Reduced motion needs NO branch here: the `from` state is written in
 * `--ds-travel-*` and the clock in `--ds-dur-enter`, and the media query at the
 * foot of `tokens.css` zeroes both — so the element simply is where it belongs
 * on the first frame.
 *
 * Radix surfaces (Dialog, Drawer, Popover, ContextMenu) do NOT use this: they
 * publish `data-state="open|closed"` themselves, which is the same mechanism
 * with an exit the platform can hold the unmount open for.
 */
export function useDsEnterTransition(): { "data-demo-enter": "from" | "to" } {
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    // TWO frames. One `requestAnimationFrame` can be dispatched in the same
    // frame the element first paints in, and a property that changes inside
    // its own first paint has no previous value to transition from — the
    // element lands with no motion at all. The second frame guarantees the
    // `from` styles were committed and can be moved away from.
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setEntered(true));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, []);
  return { "data-demo-enter": entered ? "to" : "from" };
}

/**
 * A floating surface: menus and popovers built outside the Dialog primitive.
 *
 * It forwards its ref and spreads the rest of its props so a positioning
 * primitive (Radix `Popover.Content`, a menu, an anchored panel) can adopt it
 * with `asChild` instead of re-drawing the same four tokens locally.
 */
export const FloatingSurface = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function FloatingSurface({ className, children, ...rest }, ref) {
    return (
      <HeroSurface variant="transparent"
        ref={ref}
        {...rest}
        className={cn(
          "border bg-[var(--ds-surface-overlay)]",
          "border-[color:var(--ds-border-strong)]",
          dsRadius.md,
          dsElev.mid,
          className,
        )}
      >
        {children}
      </HeroSurface>
    );
  },
);
