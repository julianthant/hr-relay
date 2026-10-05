import type { ReactNode } from "react";
import { BodySection, DsBodyScope, Field, FormGroup, Panel, PanelBody, PanelHeader, ResultRow, SectionLabel, Skeleton, Table, TBody, TD, TH, THead, TR, dsText } from "../ds/ui.js";
import { cn } from "../lib/utils.js";

export function LoadingRegion({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return <div role="status" aria-label={label} aria-busy="true" data-loading-layout className={className}>{children}</div>;
}

export function SkeletonText({ className }: { className?: string }) {
  return <span aria-hidden className={cn("flex h-[1lh] max-w-full items-center", className)}><Skeleton className="h-[.7em] w-full rounded-sm" /></span>;
}

export function SettingsRowsSkeleton({ rows = 3, wide = false, presentation = "field", copy }: { rows?: number; wide?: boolean; presentation?: "field" | "result" | "disclosure"; copy?: readonly { label: string; description?: string }[] }) {
  return <>{Array.from({ length: rows }, (_, index) => {
    const label = copy?.[index]?.label ?? <SkeletonText className={index % 2 ? "w-36" : "w-44"} />;
    const description = copy?.[index]?.description ?? <SkeletonText className="w-60" />;
    if (presentation === "result") return <ResultRow key={index} controlWidth={wide ? "wide" : "standard"} label={label} description={description} value={<SkeletonText className="w-20" />} />;
    if (presentation === "disclosure") return <div key={index} className="ds-disclosure-body"><div className="ds-disclosure-trigger flex items-center justify-between gap-3"><div className="ds-disclosure-body-copy"><div className="ds-disclosure-body-title">{label}</div><div className="ds-disclosure-body-description">{description}</div></div><Skeleton className="size-3 shrink-0" /></div></div>;
    return <div key={index}><Field orientation="horizontal" controlWidth={wide ? "wide" : "standard"} label={label} description={description}>
      <Skeleton className="h-[var(--ds-h-body-control)] w-full rounded-[var(--ds-radius-body-control)]" />
    </Field></div>;
  })}</>;
}

export function CatalogSkeleton() {
  return <LoadingRegion label="Loading the UI catalog"><FormGroup label="UI catalog loading" className="settings-reference-catalog-browser">
    <div className="settings-reference-catalog-rail-frame"><div className="settings-reference-catalog-rail">
      {Array.from({ length: 5 }, (_, index) => <div key={index} className="flex flex-col gap-2 p-2"><SkeletonText className="w-3/4 text-body" /><SkeletonText className="w-1/2 text-caption" /></div>)}
    </div></div>
    <div className="settings-reference-catalog-detail"><div className="settings-reference-catalog-record">
      <div className="settings-reference-record-heading"><div className="settings-reference-catalog-kind"><SkeletonText className="w-24" /></div><div className="settings-reference-catalog-title"><SkeletonText className="w-3/4" /></div><div className="settings-reference-record-id"><SkeletonText className="w-1/2" /></div></div>
      {[{ title: "Properties", rows: 4 }, { title: "Verification & evidence", rows: 5 }].map(group => <BodySection key={group.title} as="h3" title={group.title}><FormGroup label={`${group.title} loading`}>{Array.from({ length: group.rows }, (_, index) => <ResultRow key={index} className="[&_.ds-result-row-value]:w-full" label={<SkeletonText className="w-3/4" />} value={<SkeletonText className="w-4/5" />} />)}</FormGroup></BodySection>)}
      <BodySection as="h3" title="On the same screen"><div aria-hidden className="flex flex-wrap gap-[var(--ds-space-tight)]">{[0, 1, 2, 3, 4].map(index => <Skeleton key={index} className={cn("h-6 max-w-full", index === 0 ? "w-60" : index < 3 ? "w-72" : "w-48")} />)}</div></BodySection>
    </div></div>
  </FormGroup></LoadingRegion>;
}

export function QueueSkeleton({ label }: { label?: string }) {
  return <Panel className="min-h-0"><PanelHeader title={label ?? <SkeletonText className="w-32" />} />
    <PanelBody className="overflow-hidden p-3"><LoadingRegion label="Loading queue" className="flex flex-col gap-4">
      <div className="flex items-center gap-2"><SkeletonText className="w-24 text-caption" /><Skeleton className="size-5 rounded-full" /><div className="h-px flex-1 bg-ui-stroke" /></div>
      {Array.from({ length: 3 }, (_, index) => <div key={index} className="overflow-hidden rounded-lg border border-ui-stroke bg-ui-panel">
        <div className="flex flex-col gap-3 p-3"><div className="flex items-center justify-between gap-3"><SkeletonText className="w-3/5 text-heading" /><Skeleton className="h-6 w-16" /></div><SkeletonText className="w-4/5 text-body" /></div>
        <div className="flex items-center gap-2 border-t border-ui-stroke bg-ui-table px-3 py-2"><SkeletonText className="w-12 text-caption" /><SkeletonText className="w-20 text-caption" /><SkeletonText className="ml-auto w-12 text-caption" /><Skeleton className="size-4" /></div>
      </div>)}
    </LoadingRegion></PanelBody>
  </Panel>;
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

export function RunPanelSkeleton() {
  return <Panel className="min-h-0"><PanelHeader title={<SkeletonText className="w-60" />} /><PanelBody className="overflow-hidden px-4 pb-6 pt-5"><LogSkeleton /></PanelBody></Panel>;
}

export function DashboardSkeleton({ settings = false, settingsContent }: { settings?: boolean; settingsContent?: ReactNode }) {
  return <LoadingRegion label="Starting dashboard" className="dashboard-shell ui-theme-scope flex h-full min-h-0 flex-1 flex-col bg-ui-canvas" >
    <div aria-hidden className="flex min-h-0 flex-1">
      <div className="flex w-[var(--shell-rail-width)] shrink-0 flex-col gap-5 border-r border-ui-stroke bg-ui-panel p-4">
        <SkeletonText className="w-3/5 text-page" /><Skeleton className="h-8" />
        {Array.from({ length: 8 }, (_, index) => <div key={index} className="flex items-center gap-3"><Skeleton className="size-4 shrink-0" /><SkeletonText className="w-3/4 text-body" /></div>)}
      </div>
      <div className="min-h-0 min-w-0 flex-1">{settings ? <div className="settings-takeover h-full overflow-y-auto"><div className="settings-content"><DsBodyScope className="settings-tab-body">{settingsContent ?? <><SkeletonText className="w-60 text-page" /><div className="mb-8 mt-2"><SkeletonText className="w-80 text-body" /></div><FormGroup label="Settings loading"><SettingsRowsSkeleton /></FormGroup></>}</DsBodyScope></div></div>
        : <div className="dashboard-panel-columns"><div className="dashboard-queue-column"><QueueSkeleton /></div><div className="dashboard-log-column"><div className="dashboard-action-panel gap-2 px-3"><Skeleton className="h-8 w-28" /><Skeleton className="h-8 w-24" /><Skeleton className="ml-auto h-8 w-36" /></div><RunPanelSkeleton /></div></div>}
      </div>
    </div><div className="flex h-11 shrink-0 items-center gap-3 border-t border-ui-stroke bg-ui-panel px-4"><SkeletonText className="w-20 text-caption" /><SkeletonText className="w-14 text-caption" /></div>
  </LoadingRegion>;
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
