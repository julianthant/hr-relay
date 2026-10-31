import type { ReactNode } from "react";
import { DsBodyScope, PageHeading, SearchInput, TakeoverFrame, TooltipProvider, dsFocus, useDemoTheme } from "../../../../../src/dashboard/ds/ui.js";
import { WorkspaceRail } from "../../../../../src/dashboard/surfaces/shell/workspace-rail.js";
import { MOCK_WORKFLOW_CATALOG } from "../../../../../src/dashboard/surfaces/workflows/mocks/workflow-mock-catalog.js";
import type { LogStep } from "../../../../../src/dashboard/surfaces/run-detail/logs/log-feed-model.js";
import type { LogTimelineStage } from "../../../../../src/dashboard/surfaces/run-detail/logs/log-timeline-model.js";
import { Pause } from "lucide-react";
import { Badge, Panel } from "../../../../../src/dashboard/ds/ui.js";
import { LogPanel } from "../../../../../src/dashboard/surfaces/run-detail/log-panel.js";

export function SettingsSurface({ section, children }: { section: "General" | "Paths"; children: ReactNode }) {
  const { theme } = useDemoTheme();
  return <div data-app-root data-demo-theme={theme} className="dashboard-shell min-w-[1024px] h-screen"><TooltipProvider><TakeoverFrame label="Settings" direction="row" className="settings-takeover h-full">
    <nav className="settings-panel-nav" aria-label="Settings"><div className="settings-nav-header"><h2>Settings</h2></div><SearchInput aria-label="Search settings" placeholder="Search" className="settings-nav-search" />{[["Personal", "General", "Credentials"], ["Advanced", "Paths", "Routes"], ["Data", "Spreadsheets", "Explorer", "Analytics"], ["Status", "Storage", "Preflight"]].map(([heading, ...items]) => <div key={heading} className="settings-nav-group"><span>{heading}</span>{items.map(label => <a className={dsFocus} key={label} href={`?fixture=${label === "General" ? "delete-account" : "fixed-backup"}`} aria-current={label === section ? "page" : undefined}>{label}</a>)}</div>)}</nav>
    <main className="settings-content flex-1 overflow-y-auto px-[var(--ds-space-section)] py-[var(--ds-space-page)]"><DsBodyScope className="settings-tab-body"><div className="settings-compact-page"><PageHeading title={section} description={section === "General" ? "ChatGPT account, appearance, and account controls for Alex Morgan." : "Where Relay saves files on this Mac."} />{children}</div></DsBodyScope></main>
  </TakeoverFrame></TooltipProvider></div>;
}

export function LogsSurface({ title = "EID 10777012", status, toolbar, queueControls, children, steps, timeline = [], queueLabel = "NEEDS YOU · 1" }: { title?: string; status: ReactNode; toolbar?: ReactNode; queueControls?: ReactNode; queueLabel?: string; children?: ReactNode; steps: readonly LogStep[]; timeline?: readonly LogTimelineStage[] }) {
  const { theme } = useDemoTheme();
  const active = queueLabel.startsWith("ACTIVE");
  const workflows = MOCK_WORKFLOW_CATALOG.workflows.filter(flow => ["person-lookup", "i9-lookup", "separations", "i9-check"].includes(flow.id)).map(flow => ({ id: flow.id, label: flow.label, categoryId: flow.category, role: { kind: "standalone" as const }, source: "preview" as const, launch: { state: "preview" as const } }));
  return <div data-app-root data-demo-theme={theme} className="dashboard-shell ui-theme-scope flex h-screen min-w-[1024px] flex-col bg-ui-canvas font-ui text-body text-ui-primary"><TooltipProvider><div className="dashboard-workspace relative flex min-h-0 flex-1 flex-col">
    <WorkspaceRail workflows={workflows} active={active ? "person-lookup" : "separations"} preview={null} onSelect={() => {}} onPreview={() => {}} settingsOpen={false} notifications={{ state: "ready", items: [], pinned: [] }} searchData={{ today: "2026-10-30", counts: {}, results: [] }} onSearch={() => {}} onOpenNotification={() => {}} />
    <main className="flex min-h-0 flex-1 flex-col"><div className="dashboard-panel-columns">
      <div className="dashboard-queue-column"><Panel aria-label="Queue" className="min-h-0 overflow-hidden"><div className="flex items-center justify-between gap-2 px-3 py-3"><span className="text-caption font-semibold tracking-wide text-ui-muted">{queueLabel}</span>{queueControls}</div><div className="mx-3 overflow-hidden rounded-lg border border-ui-stroke-control bg-ui-table"><div className="flex items-center justify-between gap-2 px-3 pt-3"><strong className="text-body">{title}</strong>{status}</div><p className="px-3 pb-3 pt-1 text-caption text-ui-muted">{active ? "Verifying employee" : queueLabel.startsWith("DONE") ? "Submit termination" : "Did the submit reach UCPath?"}</p><div className="flex gap-3 border-t border-ui-stroke px-3 py-2 font-data text-caption text-ui-muted"><span>9:31 AM</span><span>#1</span><span>{active ? "PL04236388" : "SP99300911"}</span></div></div>{active && <div className="mx-3 mt-3 overflow-hidden rounded-lg border border-ui-stroke bg-ui-table"><div className="flex items-center justify-between gap-2 px-3 pt-3"><strong className="text-body">EID 10777012</strong><Badge tone="neutral" className="border-ui-stroke-control bg-transparent"><Pause aria-hidden className="size-3" />Paused</Badge></div><p className="px-3 pb-3 pt-1 text-caption text-ui-muted">Paused after Submit termination</p><div className="flex gap-3 border-t border-ui-stroke px-3 py-2 font-data text-caption text-ui-muted"><span>9:20 AM</span><span>#1</span><span>SP99300911</span></div></div>}</Panel></div>
      <div className="dashboard-log-column log-controls"><LogPanel title={title} steps={steps} timeline={timeline} status={active ? status : undefined} toolbar={active ? toolbar : status} afterStep={children ? id => id === steps.at(-1)?.id ? <div className="log-control-content">{children}</div> : null : undefined} /></div>
    </div></main>
  </div></TooltipProvider></div>;
}
