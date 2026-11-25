/** Explorer surface stories: the page's read, every kind of block a step shows, a decision that continues and one that stops, the run
 * options and what they hide, and the field-source drawer. The real page runs on an in-page server that answers the Explorer read.
 * The page's "refused with a held spec" state needs a second read to fail after a first one landed; nothing re-reads once it has
 * loaded, so no person can reach it. */
import type { Page } from "@playwright/test";
import type { ExplorerWiringState } from "../../../../../../src/dashboard/state/explorer-wiring-adapter.js";
import { WorkflowExplorer } from "../../../../../../src/dashboard/surfaces/explorer/explorer.js";
import type { SpecBlock } from "../../../../../../src/dashboard/surfaces/explorer/explorer-spec.js";
import { DashboardClientProvider } from "../../../../../../src/dashboard/state/client-context.js";
import { EXPLORER_STORY_CATALOG, explorerStoryClient, type ExplorerStoryServerOptions } from "../../../../fixtures/dashboard/explorer-story-fixtures.js";
import { withKnownBreaks } from "../known-breaks.js";
import { defineSurface, type Story } from "../story-catalogue.js";
import { StoryFrame } from "./story-frame.js";

type CardMode = Extract<SpecBlock, { kind: "card" }>["mode"];
type DecisionResult = "continues" | "stops";
type SourceView = "with-reads" | "single-read" | "jumped";

interface Scene {
  readonly server?: ExplorerStoryServerOptions;
  /** Mount with no workflows registered. */
  readonly empty?: true;
  /** Mount with no client: the dashboard is not connected. */
  readonly offline?: true;
  readonly play?: (page: Page) => Promise<void>;
  readonly story?: Partial<Story>;
}

function ExplorerStoryPage({ scene }: { scene: Scene }) {
  const client = scene.offline === true ? undefined : explorerStoryClient(scene.server);
  const page = <main className="min-h-0 flex-1 overflow-y-auto px-8 py-6"><WorkflowExplorer catalog={scene.empty === true ? [] : EXPLORER_STORY_CATALOG} {...(client === undefined ? {} : { client })} /></main>;
  return <StoryFrame>{client === undefined ? page : <DashboardClientProvider client={client}>{page}</DashboardClientProvider>}</StoryFrame>;
}

const READY = 'h2:has-text("Run options")';
function scene(title: string, input: Scene = {}): Story {
  return { title, render: () => <ExplorerStoryPage scene={input} />, ready: READY, ...(input.play === undefined ? {} : { play: input.play }), ...input.story };
}

const choose = (label: string, option: string) => async (page: Page): Promise<void> => {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
};
const reveal = (text: string) => async (page: Page): Promise<void> => { await page.getByText(text, { exact: true }).first().scrollIntoViewIfNeeded(); };
const openSource = (label: string) => async (page: Page): Promise<void> => { await page.getByRole("button", { name: `Show source for ${label}` }).first().click(); };
const then = (...steps: readonly ((page: Page) => Promise<void>)[]) => async (page: Page): Promise<void> => { for (const step of steps) await step(page); };
const DRAWER = '[role="dialog"][aria-label$="source"]';
const PICK = "Saved onboarding roster rows";

const LOAD = {
  idle: scene("No workflow registered to inspect", { empty: true, story: { ready: 'text="Workflow unavailable"' } }),
  loading: scene("Workflow definition being read", { server: { read: "never" }, story: { ready: 'text="Browse workflows, their steps and field sources."', slowFetch: { region: '[aria-label="Loading workflow definition"]' } } }),
  ready: scene("The workflow's options and steps"),
  unavailable: scene("The dashboard is not connected", { offline: true, story: { ready: 'text="Registered workflow data is unavailable because the dashboard client is not connected."' } }),
  refused: scene("The workflow definition could not be read", { server: { read: "fail" },
    story: { ready: 'button:has-text("Retry")', expects: [{ pattern: /500|Failed to load resource|DASHBOARD_READ_FAILED/i, reason: "The read answers 500 on purpose." }] } }),
} satisfies Record<ExplorerWiringState["state"], Story>;

/** Combinations a person meets on the read: the workflow left out of the served list. */
type LoadCombo = "workflow-missing";
const LOAD_COMBO = {
  "workflow-missing": scene("The served list no longer holds the workflow", { server: { read: "empty" }, story: { ready: 'text="Workflow unavailable"' } }),
} satisfies Record<LoadCombo, Story>;

const BLOCK = {
  card: scene("A card of fill rows", { play: reveal("Smart HR person search"), story: { ready: 'button[aria-label="Show source for First name"]' } }),
  click: scene("A click line", { play: reveal("Clicks Search"), story: { ready: 'text="Clicks Search"' } }),
  starts: scene("A step that starts another workflow", { play: reveal("Search I-9 profiles"), story: { ready: 'button:has-text("I-9 Lookup")' } }),
  pick: scene("A pick table with a typed row", { play: reveal(PICK), story: { ready: `text="${PICK}"` } }),
  decision: scene("A decision with its outcome", { play: reveal("Read and validate hire data"), story: { ready: '[aria-label="Choose roster row"]' } }),
} satisfies Record<SpecBlock["kind"], Story>;

const CARD = {
  fill: scene("Fill rows, each with its source arrow", { play: reveal("Smart HR person search"), story: { ready: 'button[aria-label="Show source for First name"]' } }),
  read: scene("Read rows, no source arrow", { play: reveal("CRM onboarding record"), story: { ready: 'text="CRM onboarding record"' } }),
} satisfies Record<CardMode, Story>;

const DECISION = {
  continues: scene("A decision that lets the run go on", { play: reveal("Read and validate hire data"), story: { ready: 'text="Waits for you to resolve it in Logs, then continues."' } }),
  stops: scene("A decision that ends the run", { play: choose("Choose roster row", "Cancel run"), story: { ready: 'text="Cancels this run before the next step."' } }),
} satisfies Record<DecisionResult, Story>;

/** Combinations a person meets: a changed option that rewrites later decisions, and one that adds a branch. */
type OptionCombo = "rehire" | "dry-run-on";
const OPTION = {
  rehire: scene("A rehire: the UCPath identity decision changes", { play: choose("Hire mode", "Rehire"), story: { ready: '[role="combobox"][aria-labelledby="option-mode"]:has-text("Rehire")' } }),
  "dry-run-on": scene("A dry run: submissions read as dry runs", { play: choose("Dry run", "On"), story: { ready: '[role="combobox"][aria-labelledby="option-dry-run"]:has-text("On")' } }),
} satisfies Record<OptionCombo, Story>;

const SOURCE = {
  "with-reads": scene("The source of a value built from four reads", { play: then(reveal("Smart HR person search"), openSource("First name")), story: { ready: `${DRAWER} >> text="Also uses"` } }),
  "single-read": scene("The source of a value from one read", { play: then(reveal("Smart HR person search"), openSource("Date of birth")), story: { ready: `${DRAWER} >> text="Read from"` } }),
  jumped: scene("The page after Go to source step", { play: then(reveal("Smart HR person search"), openSource("First name"), async page => { await page.getByRole("link", { name: "Go to source step" }).first().click(); }), story: { ready: READY } }),
} satisfies Record<SourceView, Story>;

const AUDIT_FIXES = "#532";
/** The Onboarding steps show raw workflow codes (UC_FULL_HIRE, UC_CONC_HIRE). */
const PAGE = ["no-banned-text"] as const;
const KNOWN_BREAKS = {
  "load/ready": PAGE, "block/card": PAGE, "block/click": PAGE, "block/starts": PAGE, "block/pick": PAGE, "block/decision": PAGE,
  "card/fill": PAGE, "card/read": PAGE, "decision/continues": PAGE,
  "option/rehire": PAGE, "option/dry-run-on": PAGE,
  "source/with-reads": PAGE, "source/single-read": PAGE, "source/jumped": PAGE,
} as const;

export const EXPLORER_STORIES = withKnownBreaks(
  defineSurface("explorer", { load: LOAD, "load-combo": LOAD_COMBO, block: BLOCK, card: CARD, decision: DECISION, option: OPTION, source: SOURCE }),
  "explorer", AUDIT_FIXES, KNOWN_BREAKS);
