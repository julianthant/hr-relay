/** Shell surface stories: the startup loader, the notices over the dashboard, the queue column when it has no queue, the
 * workflow rail, search, and the Pause-all and Log out dialogs. The real components run on fixtures and a client that never answers. */
import { useEffect, useState, type ComponentProps } from "react";
import { DashboardClientProvider } from "../../../../../../src/dashboard/state/client-context.js";
import { EmptyState, FailureNotice, Notice, Panel, PanelBody, Switch } from "../../../../../../src/dashboard/ds/ui.js";
import { QueueSkeleton } from "../../../../../../src/dashboard/surfaces/shared/loading/loading.js";
import { QueueHeader } from "../../../../../../src/dashboard/surfaces/queue/queue-header.js";
import { QuitDialog } from "../../../../../../src/dashboard/surfaces/queue/queue-toolbar.js";
import { HubShell } from "../../../../../../src/dashboard/surfaces/shell/hub-shell.js";
import { StartupLoading } from "../../../../../../src/dashboard/surfaces/shell/startup-loading.js";
import { WorkflowRail } from "../../../../../../src/dashboard/surfaces/shell/workflow-rail.js";
import { RailSearch } from "../../../../../../src/dashboard/surfaces/shell/search/navbar-view.js";
import { PALETTE_FILTERS, type PaletteFilter } from "../../../../../../src/dashboard/surfaces/shell/search/search-palette-model.js";
import { SLOW_STARTUP_MS } from "../../../../../../src/dashboard/app/startup/first-screen.js";
import {
  SEARCH_STORY_DATA, SEARCH_STORY_WORKFLOWS, SHELL_STORY_COUNTS_IDLE, SHELL_STORY_COUNTS_RUNNING, SHELL_STORY_WORKFLOWS, inertDashboardClient,
} from "../../../../fixtures/dashboard/shell-story-fixtures.js";
import { defineSurface, type Story } from "../story-catalogue.js";
import { StoryFrame } from "./story-frame.js";

const noop = () => undefined;
/** The search palette's input draws no focus ring, and its filter chips and result list are not keyboard stops. */
const PALETTE_FOCUS_BREAK = { "named-and-focusable": "#532" } as const;

/** The app raises a notice after its data answers, never on first paint; the toast host only hears notices raised once it has mounted. */
function LateNotice(props: ComponentProps<typeof Notice>) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? <Notice {...props} /> : null;
}
const CLIENT = inertDashboardClient();

type StartupState = "starting" | "slow";
const STARTUP = {
  starting: { title: "Relay starting, nothing slow yet", render: () => <StoryFrame><DashboardClientProvider client={CLIENT}><StartupLoading /></DashboardClientProvider></StoryFrame>,
    ready: "[data-startup-loading]" },
  slow: { title: "Relay starting, taking longer than usual", render: () => <StoryFrame><DashboardClientProvider client={CLIENT}><StartupLoading /></DashboardClientProvider></StoryFrame>,
    ready: 'text="Taking longer than usual"', clock: true, play: page => page.clock.runFor(SLOW_STARTUP_MS) },
} satisfies Record<StartupState, Story>;

/** Notices that sit over the dashboard until what raised them is gone. */
type Banner = "unreachable" | "quitting" | "no-worker";
const BANNER = {
  unreachable: { title: "Relay cannot be reached, reconnecting", ready: 'text=/Can.t reach Relay/',
    render: () => <StoryFrame><LateNotice sticky tone="warning" title="Can't reach Relay" description="Reconnecting…" /></StoryFrame> },
  quitting: { title: "Relay will quit once runs pause", ready: 'text=/Relay quits after runs pause/',
    render: () => <StoryFrame><LateNotice sticky tone="info" title="Relay quits after runs pause" /></StoryFrame> },
  "no-worker": { title: "Queued runs and no worker to take them", ready: 'text=/Person Lookup has no worker/',
    render: () => <StoryFrame><LateNotice sticky tone="warning" title="Person Lookup has no worker. Open Sessions." /></StoryFrame> },
} satisfies Record<Banner, Story>;

/** What the queue column shows when it has no queue to draw. */
type QueueSlot = "failed" | "loading" | "invalid-date" | "no-workflows" | "workflow-unavailable";
const slot = (title: string, body: () => React.ReactNode, extra: Partial<Story> = {}): Story => ({ title,
  render: () => <StoryFrame><main className="flex min-h-0 flex-1 flex-col"><div className="dashboard-panel-columns"><div className="dashboard-queue-column">
    <h1 className="sr-only">Person Lookup queue</h1>{body()}</div><div className="dashboard-log-column" /></div></main></StoryFrame>, ...extra });
const emptyPanel = (title: string, description: string) => <Panel className="min-h-0"><PanelBody className="grid place-items-center p-[var(--ds-space-page)]"><EmptyState title={title} description={description} /></PanelBody></Panel>;
const QUEUE_SLOT = {
  failed: slot("The queue could not be loaded", () => <Panel className="min-h-0"><PanelBody className="grid place-items-center p-[var(--ds-space-page)]">
    <FailureNotice sentence="Couldn't load the queue." action={{ label: "Retry", onClick: noop }} /></PanelBody></Panel>, { ready: 'text="Couldn\'t load the queue."' }),
  loading: slot("The queue loading", () => <QueueSkeleton />, { slowFetch: { region: '[aria-label="Queue"]' } }),
  "invalid-date": slot("A date that is not a date", () => emptyPanel("Choose a valid date", "Enter a date as month, day and year.")),
  "no-workflows": slot("A server with no workflows", () => emptyPanel("No workflows available", "This server serves no workflows. Check Settings for availability.")),
  "workflow-unavailable": slot("A workflow this build does not serve", () => emptyPanel("Workflow unavailable", "Workflow person-lookup is not served by this build.")),
} satisfies Record<QueueSlot, Story>;

type RailState = "expanded" | "collapsed" | "running" | "collapsed-running" | "start-hover" | "start-focus";
const rail = (title: string, counts: typeof SHELL_STORY_COUNTS_IDLE, collapsed: boolean, play?: Story["play"]): Story => ({ title, ready: '[aria-label="Workflows"]', ...(play === undefined ? {} : { play }),
  render: () => <StoryFrame><aside aria-label="Workspace" className="workspace-rail ui-theme-scope" {...(collapsed ? { "data-collapsed": true } : {})}><div className="workspace-rail-body">
    <WorkflowRail workflows={SHELL_STORY_WORKFLOWS} counts={counts} active="person-lookup" onSelect={noop} collapsed={collapsed} onStart={noop} canStart={() => true} /></div></aside></StoryFrame> });
const RAIL = {
  expanded: rail("The sidebar open, no run going", SHELL_STORY_COUNTS_IDLE, false),
  collapsed: rail("The sidebar minimized, no run going", SHELL_STORY_COUNTS_IDLE, true),
  running: rail("The sidebar open, runs going", SHELL_STORY_COUNTS_RUNNING, false),
  "collapsed-running": rail("The sidebar minimized, runs going", SHELL_STORY_COUNTS_RUNNING, true),
  "start-hover": rail("The sidebar with the pointer on a workflow, its Start run + showing", SHELL_STORY_COUNTS_IDLE, false, page => page.locator(".workflow-rail-item").first().hover()),
  "start-focus": rail("The sidebar with keyboard focus on a workflow's Start run +", SHELL_STORY_COUNTS_IDLE, false, page => page.locator(".workflow-rail-start").first().focus()),
} satisfies Record<RailState, Story>;

type HeaderState = "closed" | "options-open" | "options-changed";
const header = (title: string, changed: boolean, play?: Story["play"]): Story => ({ title, ready: '[aria-label="Queue header"]', ...(play === undefined ? {} : { play }),
  render: () => <StoryFrame><QueueHeader title="Person Lookup" ask={null} startId="story-start-run" onStartRun={noop} day={changed ? "2026-10-29" : "2026-10-30"} today="2026-10-30" onDay={noop}
    sort={changed ? "oldest" : "attention"} onSort={noop} active={changed ? ["failed"] : ["all"]} counts={[]} onFilter={noop} /></StoryFrame> });
const openOptions: Story["play"] = page => page.getByRole("button", { name: /^Options/ }).click();
const HEADER = {
  closed: header("The queue header with Options closed", false),
  "options-open": header("The Options menu open: Date, Sort by, Status, Attention first", false, openOptions),
  "options-changed": header("The queue header with options changed from their defaults", true),
} satisfies Record<HeaderState, Story>;

type ToggleState = "off" | "on" | "disabled-off" | "disabled-on";
const toggle = (title: string, checked: boolean, disabled: boolean): Story => ({ title, ready: '[role="switch"]',
  render: () => <StoryFrame><Panel><PanelBody><Switch label="Dry run" checked={checked} disabled={disabled} onCheckedChange={noop} /></PanelBody></Panel></StoryFrame> });
const TOGGLE = {
  off: toggle("A toggle that is off", false, false), on: toggle("A toggle that is on: blue track, white knob", true, false),
  "disabled-off": toggle("A toggle that is off and unavailable", false, true), "disabled-on": toggle("A toggle that is on and unavailable", true, true),
} satisfies Record<ToggleState, Story>;

/** Search open on the given filter, or on the given answer from the served search. */
function searchStory(title: string, data: keyof typeof SEARCH_STORY_DATA, play: Story["play"], ready = 'input[aria-label="Search Relay"]'): Story {
  return { title, ready, play, knownFailures: PALETTE_FOCUS_BREAK, render: () => <StoryFrame><aside className="workspace-rail"><div className="workspace-rail-header"><div className="workspace-rail-actions"><RailSearch data={SEARCH_STORY_DATA[data]} workflows={SEARCH_STORY_WORKFLOWS} startKey="N" onAction={noop} onWorkflow={noop} onResult={noop} /></div></div></aside></StoryFrame> };
}
const opening: Story["play"] = page => page.getByRole("button", { name: "Search", exact: true }).click();
const FILTER_LABEL = Object.fromEntries(PALETTE_FILTERS.map(({ id, label }) => [id, label])) as Record<PaletteFilter, string>;
const filterStory = (filter: PaletteFilter): Story => searchStory(`Search narrowed to ${FILTER_LABEL[filter]}`, "results", async page => {
  await opening(page);
  await page.getByRole("button", { name: FILTER_LABEL[filter], exact: true }).click();
});
const SEARCH_FILTER = {
  all: filterStory("all"), actions: filterStory("actions"), runs: filterStory("runs"), workflows: filterStory("workflows"), spreadsheets: filterStory("spreadsheets"),
} satisfies Record<PaletteFilter, Story>;

type SearchAnswer = keyof typeof SEARCH_STORY_DATA | "no-match";
const SEARCH_ANSWER = {
  results: searchStory("Search with runs, workflows and spreadsheets", "results", opening),
  loading: { ...searchStory("Search waiting for the served runs", "loading", opening, '[aria-label="Loading runs"]'), slowFetch: { region: '[aria-label="Loading runs"]' } },
  unavailable: searchStory("Search that could not be reached", "unavailable", opening, 'text="Search is unavailable. Try again shortly."'),
  "sheets-unavailable": searchStory("Search with spreadsheets unavailable", "sheets-unavailable", opening, 'text="Spreadsheets are unavailable."'),
  "no-match": searchStory("Search that matches nothing", "results", async page => { await opening(page); await page.getByRole("combobox", { name: "Search Relay" }).fill("zzzz"); }, 'text="No matches"'),
} satisfies Record<SearchAnswer, Story>;

type ShellDialog = "quit" | "logout";
const DIALOG = {
  quit: { title: "Asked to pause everything and quit", ready: '[role="dialog"]',
    render: () => <StoryFrame><QuitDialog requested canQuit onDismiss={noop} onQuit={noop} /></StoryFrame> },
  logout: { title: "Asked to log out", slowFetch: { region: "#hub-shell-assistant" }, ready: '[role="dialog"]', render: () => <StoryFrame><DashboardClientProvider client={CLIENT}>
    <HubShell settingsOpen={false} logoutOpen onLogoutOpenChange={noop} onLogout={noop} /></DashboardClientProvider></StoryFrame> },
} satisfies Record<ShellDialog, Story>;

export const SHELL_STORIES = defineSurface("shell", { startup: STARTUP, banner: BANNER, queue: QUEUE_SLOT, rail: RAIL, header: HEADER, toggle: TOGGLE, filter: SEARCH_FILTER, search: SEARCH_ANSWER, dialog: DIALOG });
