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
import { cn } from "../../lib/utils.js";
import { ShadcnCard, ShadcnCardContent, ShadcnCardFooter, ShadcnCardHeader } from "./shadcn-card.js";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./shadcn-collapsible.js";
import { ShadcnTabs, ShadcnTabsContent, ShadcnTabsList, ShadcnTabsTrigger } from "./shadcn-tabs.js";
import { useTabIndicator } from "./tab-indicator-model.js";
import { dsBorder, dsElev, dsFocus, dsIcon, dsMotion, dsRadius, dsSize, dsSurface, dsText } from "../theme/tokens.js";

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
  actionAlignment = "title",
  as: Heading = "h1",
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  actionAlignment?: "content" | "title";
  as?: "h1" | "h2";
  className?: string;
}) {
  return (
    <header className={cn("ds-page-heading", actionAlignment === "title" && "ds-page-heading--title-actions", className)}>
      <div className="ds-page-heading-copy min-w-0">
        <Heading className={cn("ds-page-heading-title", dsText.pageTitle, "text-[color:var(--ds-fg)]")}>
          {title}
        </Heading>
        {description && (
          <p className={cn("ds-page-heading-description", dsText.meta)}>{description}</p>
        )}
      </div>
      {actions && <div className="ds-page-heading-actions flex shrink-0 items-center gap-[var(--ds-space-snug)]">{actions}</div>}
    </header>
  );
}

/** Shared search, optional filters/count and framed table for data libraries. */
export function TableList({ search, controls, summary, summaryPosition, children }: {
  search: ReactNode; controls?: ReactNode; summary?: ReactNode; summaryPosition?: "end" | "near-search"; children: ReactNode;
}) {
  return <div className="ds-table-list">
    <TableToolbar search={search} controls={controls} summary={summary} summaryPosition={summaryPosition} />
    <div className="ds-table-list-frame">{children}</div>
  </div>;
}

export function TableToolbar({ search, controls, summary, summaryPosition = "end" }: {
  search: ReactNode; controls?: ReactNode; summary?: ReactNode; summaryPosition?: "end" | "near-search";
}) {
  const count = summary && <span className={cn("ds-table-toolbar-summary", summaryPosition === "near-search" && "ds-table-toolbar-summary--near-search")}>{summary}</span>;
  return <div className="ds-table-toolbar">
    <div className="ds-table-toolbar-search">{search}</div>
    {summaryPosition === "near-search" && count}
    {controls && <div className="ds-table-toolbar-controls">{controls}</div>}
    {summaryPosition === "end" && count}
  </div>;
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
  description,
  as: Heading = "h2",
  className,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  as?: "h2" | "h3";
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("ds-body-section", className)}>
      <Heading className="ds-body-section-heading">{title}</Heading>
      {description && <p className="ds-body-section-description">{description}</p>}
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


/** Panel — the primary region container (queue, log, settings, inbox…) */

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
        // draws, read off the shared tokens rather than re-answered here.
        "border-[color:var(--ds-border-subtle)] bg-[var(--ds-recess-bg)]",
        className,
      )}
    >
      <footer>{children}</footer>
    </ShadcnCardFooter>
  );
}

/** Card — a single object inside a Panel (a run, a session, a receipt) */

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

export function CardBase({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("mt-auto flex min-w-0 flex-col", className)}>{children}</div>;
}

/** CompareGrid / CompareCard — cards that are read ACROSS, not down */

/** A row of cards the operator compares STRAIGHT ACROSS, sharing one set of row
 * tracks so the nth line of every card sits on the nth baseline. */
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
      // Equal padding preserves alignment across shared row tracks.
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

/** Persistent surface messages announce severity and provide a recovery action. */
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



/** Focus the named frame uniformly; non-tab targets need no UA ring, and CSS handles reduced motion. */
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
    // Refs attach before mount effects; null here is a type guard, not an absent takeover state.
    if (node === null) return;
    // Preserve descendant focus established in the same commit; parent effects must not steal it.
    if (node.contains(document.activeElement)) return;
    // Prevent focus from scrolling the shell during the enter transform.
    node.focus({ preventScroll: true });
  }, []);
  return (
    <section
      ref={frame}
      tabIndex={-1}
      {...enter}
      aria-label={label}
      className={cn(
        // Clip overflow at the frame boundary; suppress UA outlines only on this non-tab focus target.
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



/** Drop absent metadata segments without leaving dangling separators. */
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



/** Shared grid tracks keep peer facts aligned across wrapping rows. */
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



/** Refusals retain their code and unchanged outcome; distinguish declined work from product failures. */
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



/** Use real list semantics; literal text bullets would be spoken as content. */
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



/** Empty states explain what is missing, why, and the available next action. */
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



/** Keep tab navigation and selection aligned with the rendered tab’s accessible state. */
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
  const list = useRef<HTMLDivElement>(null);
  const indicator = useRef<HTMLSpanElement>(null);
  useTabIndicator(list, indicator);
  return (
    <ShadcnTabsList
      ref={list}
      aria-label={label}
      onKeyDownCapture={() => { if (list.current) list.current.dataset.indicatorMotion = "instant"; }}
      onPointerDownCapture={() => { if (list.current) delete list.current.dataset.indicatorMotion; }}
      className={cn(
        "ds-tab-list relative flex shrink-0 items-center gap-[var(--ds-space-tight)] border-b",
        "border-[color:var(--ds-border)]",
        className,
      )}
    >
      {children}
      <span ref={indicator} aria-hidden="true" className="ds-tab-indicator" />
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
        "data-[state=active]:font-semibold data-[state=active]:text-[color:var(--ds-fg)]",
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



/** Only scrolling wells draw a boundary; it signals clipped content rather than decoration. */
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



/** Mount transitions remain interruptible; CSS tokens handle reduced motion. */
export function useDsEnterTransition(): { "data-demo-enter": "from" | "to" } {
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    // Two frames commit the initial styles before starting the transition.
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

/** Forward refs and props so positioning primitives can adopt the shared floating surface. */
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
