import type { ReactNode } from "react";
import { Field, ResultRow, SectionLabel, Skeleton, Table, TBody, TD, TH, THead, TR, dsBorder, dsRadius, dsSurface, dsText, useSkeletonWait } from "../../../ds/ui.js";
import { cn } from "../../../lib/utils.js";

/** A placeholder region: mounted at once with the settled size, invisible until the read has been slow. */
export function LoadingRegion({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  const waiting = useSkeletonWait();
  return <div role="status" aria-label={label} aria-busy="true" data-loading-layout className={cn(className, waiting && "invisible")}>{children}</div>;
}

export function SkeletonText({ className }: { className?: string }) {
  return <span aria-hidden className={cn("flex h-[1lh] max-w-full items-center", className)}><Skeleton className="h-[.7em] w-full rounded-sm" /></span>;
}

export function SettingsRowsSkeleton({ rows = 3, wide = false, presentation = "field", copy, singleLine = [] }: { rows?: number; singleLine?: readonly number[]; wide?: boolean; presentation?: "field" | "result" | "disclosure"; copy?: readonly { label: string; description?: string }[] }) {
  return <>{Array.from({ length: rows }, (_, index) => {
    if (singleLine.includes(index)) return <div key={index} className="settings-compact-row"><ResultRow controlWidth={wide ? "wide" : "standard"} label={<SkeletonText className={index % 2 ? "w-36" : "w-44"} />} value={<SkeletonText className="w-20" />} /></div>;
    const label = copy?.[index]?.label ?? <SkeletonText className={index % 2 ? "w-36" : "w-44"} />;
    const description = copy?.[index]?.description ?? <SkeletonText className="w-60" />;
    if (presentation === "result") return <ResultRow key={index} controlWidth={wide ? "wide" : "standard"} label={label} description={description} value={<SkeletonText className="w-20" />} />;
    if (presentation === "disclosure") return <div key={index} className="ds-disclosure-body"><div className="ds-disclosure-trigger flex items-center justify-between gap-3"><div className="ds-disclosure-body-copy"><div className="ds-disclosure-body-title">{label}</div><div className="ds-disclosure-body-description">{description}</div></div><Skeleton className="size-3 shrink-0" /></div></div>;
    return <div key={index}><Field orientation="horizontal" controlWidth={wide ? "wide" : "standard"} label={label} description={description}>
      <Skeleton className="h-[var(--ds-h-body-control)] w-full rounded-[var(--ds-radius-body-control)]" />
    </Field></div>;
  })}</>;
}

/** One queue band label, drawn exactly as the loaded queue draws it: caps word, count pill, rule. */
function QueueBandSkeleton({ label }: { label: string }) {
  return <div className={cn(dsText.caps, "mx-[var(--ds-space-cozy)] mt-[var(--ds-space-loose)] mb-[var(--ds-space-snug)] flex items-center gap-[var(--ds-space-base)] text-[color:var(--ds-fg-muted)]")}>
    {label}<Skeleton className="h-[var(--ds-h-xs)] w-6 rounded-full" /><span aria-hidden className="h-px flex-1 bg-[var(--ds-border-subtle)]" />
  </div>;
}

/** One queue card with the loaded card's padding, title row, optional subline and footer. */
function QueueCardSkeleton({ subline }: { subline: boolean }) {
  return <div className="flex items-start gap-[var(--ds-space-base)] px-[var(--ds-space-cozy)] pt-[var(--ds-space-snug)] first:pt-[var(--ds-space-cozy)]">
    <div className={cn("flex min-w-0 flex-1 flex-col overflow-hidden border", dsRadius.lg, dsBorder.base, dsSurface.card)}>
      <div className="flex min-w-0 flex-col gap-[var(--ds-space-base)] px-[var(--ds-space-cozy)] pb-[var(--ds-space-cozy)] pt-[var(--ds-space-queue-top)]">
        <div className="flex min-w-0 items-center gap-x-[var(--ds-space-base)]"><SkeletonText className={cn(dsText.title, "w-1/2 flex-none")} /><Skeleton className="ml-auto h-[var(--ds-h-xs)] w-16" /></div>
        {subline && <SkeletonText className={cn(dsText.meta, "w-3/4")} />}
      </div>
      <div className="flex items-center gap-[var(--ds-space-base)] border-t border-[color:var(--ds-border-subtle)] bg-[var(--ds-recess-bg)] px-[var(--ds-space-cozy)] py-[var(--ds-space-tight)]">
        <div className="flex min-h-[var(--ds-h-sm)] min-w-0 flex-1 items-center gap-[var(--ds-space-base)]"><SkeletonText className={cn(dsText.meta, "w-12 flex-none")} /><SkeletonText className={cn(dsText.meta, "w-20 flex-none")} /><SkeletonText className={cn(dsText.meta, "w-24 flex-none")} /></div>
        <Skeleton className="size-4" />
      </div>
    </div>
  </div>;
}

/** The queue while it loads: the loaded queue's bands and cards, no heading of its own. */
export function QueueSkeleton() {
  return <section aria-label="Queue" className={cn("flex min-h-0 flex-col overflow-hidden border", dsRadius.lg, dsBorder.base, dsSurface.card)}>
    <LoadingRegion label="Loading queue" className="min-h-0 flex-1 overflow-hidden pb-3">
      <QueueBandSkeleton label="Needs you" /><QueueCardSkeleton subline /><QueueCardSkeleton subline={false} />
      <QueueBandSkeleton label="Active" /><QueueCardSkeleton subline /><QueueCardSkeleton subline={false} />
    </LoadingRegion>
  </section>;
}

/** The loaded feed's padding, for log rows drawn outside the feed. */
export function LogFeedPadding({ children }: { children: ReactNode }) {
  return <div className="min-w-0 flex-1 px-4 pb-6 pt-5">{children}</div>;
}

export function LogSkeleton() {
  return <LoadingRegion label="Loading logs" className="min-w-0">
    {Array.from({ length: 3 }, (_, index) => <div key={index} className="grid min-w-0 grid-cols-[var(--spacing-log-time)_minmax(0,1fr)] gap-x-4 border-b border-ui-stroke py-5 first:pt-0 last:border-b-0">
      <SkeletonText className="w-full text-caption" /><div className="min-w-0"><div className="mb-4"><SkeletonText className="w-2/5 text-heading" /></div>
        <div className="flex flex-col gap-3"><div className="flex items-center gap-3"><Skeleton className="size-3.5 shrink-0" /><SkeletonText className="w-4/5 text-body" /></div>
          {index === 1 && <div className="overflow-hidden rounded-lg border border-ui-stroke bg-ui-table"><div className="border-b border-ui-stroke px-3 py-3"><SkeletonText className="w-1/3 text-control" /></div>{[0, 1, 2].map(row => <div key={row} className="flex items-center gap-3 border-b border-ui-stroke px-3 py-2.5 last:border-b-0"><SkeletonText className="w-log-time text-caption" /><SkeletonText className="w-1/3 text-body" /><SkeletonText className="ml-auto w-1/4 text-body" /></div>)}</div>}
        </div>
      </div>
    </div>)}
  </LoadingRegion>;
}

/** The pipeline stage strip while a run's logs load: four stage labels over their bars, as the loaded strip draws them. */
export function LogTimelineSkeleton() {
  return <nav aria-hidden className="shrink-0 border-b border-ui-stroke bg-ui-panel px-4 py-2">
    <ol className="m-0 flex list-none gap-1 p-0">{Array.from({ length: 4 }, (_, index) => <li key={index} className="min-w-0 flex-1"><span className="flex w-full flex-col gap-1 px-0.5 py-1">
      <span className="flex items-center gap-1.5 text-caption"><Skeleton className="size-1.5 rounded-full" /><SkeletonText className="w-16 text-caption" /></span><Skeleton className="h-2.5 w-full" />
    </span></li>)}</ol>
  </nav>;
}

/** The run panel while the queue loads: the loaded panel's header, stage strip and padded feed. */
export function RunPanelSkeleton() {
  return <section aria-label="Selected run logs" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-ui-stroke bg-ui-panel">
    <header className="shrink-0 border-b border-ui-stroke bg-ui-table px-4 py-3"><div className="flex min-h-6 min-w-0 items-center"><SkeletonText className="w-60 text-heading" /></div></header>
    <LogTimelineSkeleton /><div className="min-h-0 flex-1 overflow-hidden"><LogFeedPadding><LogSkeleton /></LogFeedPadding></div>
  </section>;
}

export function IntakeSkeleton() {
  return <LoadingRegion label="Loading intake session" className="flex min-h-0 flex-1 flex-col gap-[var(--ds-space-loose)]">
    <section className="flex flex-col gap-[var(--ds-space-base)]"><SectionLabel>Source file</SectionLabel>
      <div className="flex items-center gap-[var(--ds-space-base)]"><Skeleton className="size-5 shrink-0" /><div className="flex flex-1 flex-col"><SkeletonText className="w-1/3 text-control" /><SkeletonText className="w-2/3 text-caption" /></div><Skeleton className="h-6 w-20" /></div>
      <Field label="Header row" description={<SkeletonText className="w-60" />} className="w-[var(--ds-w-side-panel)] max-w-full"><Skeleton className="h-9" /></Field>
    </section>
    <div className="flex min-h-11 items-center gap-6 border-b border-ui-stroke">{["Mapping", "Review", "Manifest", "Rerun diff"].map(label => <span key={label} className="text-control">{label}</span>)}</div>
    <div aria-hidden className="overflow-x-auto"><Table label="Column mapping loading"><THead><TR><TH>Target field</TH><TH>Bound column</TH><TH>Suggestion</TH></TR></THead>
      <TBody>{Array.from({ length: 5 }, (_, row) => <TR key={row}><TD className="align-top"><SkeletonText className="w-36 text-body" /><SkeletonText className="mt-1 w-48 text-caption" /></TD><TD className="align-top"><Skeleton className="h-9 w-full" /></TD><TD className="align-top"><SkeletonText className="w-40 text-body" /><SkeletonText className="mt-1 w-48 text-caption" /></TD></TR>)}</TBody>
    </Table></div>
  </LoadingRegion>;
}

export function IntakeOutcomeSkeleton() {
  return <LoadingRegion label="Loading intake actions" className="sticky bottom-0 flex flex-wrap items-center gap-[var(--ds-space-base)] border-t border-[color:var(--ds-border)] bg-[var(--ds-surface-1)] px-[var(--ds-space-loose)] py-[var(--ds-space-base)]">
    <div className="flex min-w-0 flex-1 flex-col gap-[var(--ds-space-hair)]"><SkeletonText className={cn(dsText.body, "w-96 max-w-full")} /><SkeletonText className={cn(dsText.meta, "w-80 max-w-full")} /><SkeletonText className={cn(dsText.meta, "w-60 max-w-full")} /></div>
    <Skeleton className="h-[var(--ds-h-md)] w-20" /><Skeleton className="h-[var(--ds-h-md)] w-24" /><Skeleton className="h-[var(--ds-h-md)] w-16" />
  </LoadingRegion>;
}
