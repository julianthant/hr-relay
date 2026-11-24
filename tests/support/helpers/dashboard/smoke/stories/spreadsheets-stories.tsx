/** Spreadsheets surface stories: the library's read, its three tables, every row action and what comes of it, a spreadsheet opened and its
 * column mapping saved, and the import dialog. The real page runs on an in-page library server that answers the reads and applies the
 * library actions. Cell editing and Undo do not exist in the page, and versions is a dialog, so neither has a story. */
import type { Page } from "@playwright/test";
import { sheetsStoryServer, type SheetsStoryServerOptions } from "../../../../fixtures/dashboard/spreadsheets-story-fixtures.js";
import { withKnownBreaks } from "../known-breaks.js";
import { defineSurface, type Story } from "../story-catalogue.js";
import { SpreadsheetsHost } from "./spreadsheets-story-host.js";

interface Scene {
  readonly server?: SheetsStoryServerOptions;
  readonly play?: (page: Page) => Promise<void>;
  readonly story?: Partial<Story>;
}

function scene(title: string, input: Scene = {}): Story {
  return { title, render: () => <SpreadsheetsHost server={sheetsStoryServer(input.server)} />, ready: 'ul[aria-label="Spreadsheets"]',
    ...(input.play === undefined ? {} : { play: input.play }), ...input.story };
}

const SHEET = "Onboarding list.xlsx";
const click = (name: string | RegExp, role: "button" | "menuitem" | "radio" | "link" = "button") => async (page: Page): Promise<void> => {
  await page.getByRole(role, { name, exact: typeof name === "string" }).first().click();
};
const then = (...steps: readonly ((page: Page) => Promise<void>)[]) => async (page: Page): Promise<void> => { for (const step of steps) await step(page); };
const fill = (label: string, value: string) => async (page: Page): Promise<void> => { await page.getByLabel(label, { exact: true }).fill(value); };
const openRow = (name: string) => async (page: Page): Promise<void> => { await page.locator(`li[aria-label="${name}"]`).click(); };
const choose = (label: string) => async (page: Page): Promise<void> => { await page.locator("label", { hasText: label }).first().click(); };
const backToLibrary = async (page: Page): Promise<void> => { await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("button").first().click(); };
/** The button just pressed is still under the pointer, which fills it in its hover color; move the pointer off it and let the fill settle,
 * so the story is measured at the button's resting accent. */
const still = async (page: Page): Promise<void> => {
  await page.mouse.move(1, 1);
  await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => undefined))));
};
const loaded = async (page: Page): Promise<void> => { await page.locator('ul[aria-label="Spreadsheets"]').waitFor(); };
/** Opens a row's actions menu and chooses one. */
const menu = (item: string, sheet = SHEET) => then(loaded, click(`Actions for ${sheet}`), click(item, "menuitem"));
const act = (item: string, ready: string, server: SheetsStoryServerOptions = {}, ...more: readonly ((page: Page) => Promise<void>)[]): Story =>
  scene(`${item} chosen from a row's menu`, { server, play: then(menu(item), ...more), story: { ready } });

type Catalog = "loaded" | "loading" | "error" | "empty" | "no-match";
const CATALOG = {
  loaded: scene("The library with spreadsheets"),
  loading: scene("The library being read", { server: { catalog: "never" }, story: { ready: 'text="Spreadsheets"', slowFetch: { region: '[aria-label="Loading spreadsheets"]' } } }),
  error: scene("The library could not be read", { server: { catalog: "fail" }, story: { ready: 'text="Couldn\'t load spreadsheets."' } }),
  empty: scene("A library with nothing in it", { server: { seed: "none" }, story: { ready: 'text="No spreadsheets yet"' } }),
  "no-match": scene("A search that matches nothing", { play: then(loaded, fill("Search spreadsheets", "zzz")), story: { ready: 'text="No spreadsheets match."' } }),
} satisfies Record<Catalog, Story>;

type Table = "Pinned" | "SharePoint" | "Spreadsheets";
const TABLE = {
  Pinned: scene("Pinned spreadsheets", { story: { ready: 'ul[aria-label="Pinned"]' } }),
  SharePoint: scene("Spreadsheets linked to SharePoint", { story: { ready: 'ul[aria-label="SharePoint"]' } }),
  Spreadsheets: scene("Spreadsheets added here", { story: { ready: 'ul[aria-label="Spreadsheets"]' } }),
} satisfies Record<Table, Story>;

type Row = "pin" | "sync" | "link" | "clone" | "rename" | "tags" | "delete" | "download" | "rollback";
const ROW = {
  pin: act("Pin", 'ul[aria-label="Pinned"] >> text="Onboarding list.xlsx"'),
  sync: scene("Sync now chosen from a row's menu", { play: menu("Sync now", "Department roster.xlsx"), story: { ready: 'text="Synced Department roster.xlsx"' } }),
  link: act("Link to SharePoint…", 'role=dialog'),
  clone: act("Clone", 'role=dialog'),
  rename: act("Rename", 'role=dialog'),
  tags: act("Edit tags", 'role=dialog'),
  delete: act("Delete", 'role=dialog'),
  download: scene("A spreadsheet downloaded", { play: then(loaded, async page => {
    const icon = page.getByRole("button", { name: `Download ${SHEET}`, exact: true });
    if (await icon.isVisible()) await icon.click(); else await menu("Download")(page);
  }), story: { ready: `ul[aria-label="Spreadsheets"]` } }),
  rollback: scene("A spreadsheet's versions", { play: then(loaded, click(/^Versions of Department roster/)), story: { ready: 'role=dialog' } }),
} satisfies Record<Row, Story>;

type Outcome = "cloned" | "clone-refused" | "renamed" | "tagged" | "linked" | "deleted" | "rolled-back" | "refused" | "pending" | "sync-failed" | "synced";
const done = (...steps: readonly ((page: Page) => Promise<void>)[]) => then(...steps);
const OUTCOME = {
  cloned: scene("A clone added", { play: done(menu("Clone"), click("Clone", "button")), story: { ready: 'text=/Cloned/' } }),
  "clone-refused": scene("A clone the library refused", { server: { add: "refused" }, play: done(menu("Clone"), click("Clone", "button"), still), story: { ready: 'text="That spreadsheet is no longer in the library."' } }),
  renamed: scene("A spreadsheet renamed", { play: done(menu("Rename"), fill("Name", "Onboarding 2026.xlsx"), click("Rename")), story: { ready: 'text="Onboarding 2026.xlsx"' } }),
  tagged: scene("Tags saved", { play: done(menu("Edit tags"), fill("New tag", "Priority"), async page => { await page.getByLabel("New tag", { exact: true }).press("Enter"); }, click("Save"), async page => { await page.getByRole("dialog").waitFor({ state: "hidden" }); }), story: { ready: 'li[aria-label="Onboarding list.xlsx"]' } }),
  linked: scene("A SharePoint link added", { play: done(menu("Link to SharePoint…"), async page => { await page.getByPlaceholder("https://…sharepoint.com/…").fill("https://tenant.sharepoint.com/sites/people/Roster.xlsx"); }, click("Link")), story: { ready: 'text=/Linked/' } }),
  deleted: scene("A spreadsheet deleted", { play: done(menu("Delete"), click("Delete spreadsheet")), story: { ready: 'ul[aria-label="Spreadsheets"]' } }),
  "rolled-back": scene("A version rolled back", { play: done(loaded, click(/^Versions of Department roster/), click(/Version 2|v2/, "radio"), click("Roll back"), click("Roll back")), story: { ready: 'ul[aria-label="Pinned"]' } }),
  refused: scene("A change the library refused", { server: { action: "refused" }, play: done(menu("Pin")), story: { ready: 'text=/Couldn\'t save the change/' } }),
  pending: scene("A change whose result is not yet known", { server: { action: "lost" }, play: done(menu("Pin")), story: { ready: 'text=/The library change is not yet confirmed/' } }),
  "sync-failed": scene("A sync the library could not finish", { server: { sync: "fail" }, play: done(menu("Retry sync", "Hiring tracker.xlsx")), story: { ready: "text=/Couldn't sync Hiring tracker.xlsx/" } }),
  synced: scene("A linked spreadsheet synced", { play: done(menu("Retry sync", "Hiring tracker.xlsx")), story: { ready: 'text="Synced Hiring tracker.xlsx"' } }),
} satisfies Record<Outcome, Story>;

const OPEN = (play = then(loaded, openRow(SHEET))): Pick<Scene, "play"> => ({ play });
type Detail = "grid" | "opening" | "open-failed" | "mapping-saved" | "mapping-failed" | "back";
const pickColumn = async (page: Page): Promise<void> => {
  await page.getByRole("button", { name: /^Columns/ }).first().click();
  await page.getByRole("button", { name: /column, not mapped/ }).first().click();
  await page.getByRole("menuitemradio").first().click();
};
const DETAIL = {
  grid: scene("A spreadsheet opened", { ...OPEN(), story: { ready: '[aria-label="Preview"]' } }),
  opening: scene("A spreadsheet being opened", { server: { open: "never" }, ...OPEN(), story: { ready: '[aria-label="Opening Onboarding list.xlsx"]', slowFetch: { region: '[aria-label="Opening Onboarding list.xlsx"]' } } }),
  "open-failed": scene("A spreadsheet that could not be opened", { server: { open: "fail" }, ...OPEN(), story: { ready: `text="This spreadsheet couldn't be opened."` } }),
  "mapping-saved": scene("A column mapping saved", { ...OPEN(then(loaded, openRow("Imported contacts.xlsx"), pickColumn)), story: { ready: '[aria-label="Preview"]' } }),
  "mapping-failed": scene("A column mapping that did not save", { server: { save: "refused" }, ...OPEN(then(loaded, openRow("Imported contacts.xlsx"), pickColumn)), story: { ready: "text=/Couldn't save the columns/" } }),
  back: scene("Back to the library", { ...OPEN(then(loaded, openRow(SHEET), backToLibrary)), story: { ready: 'ul[aria-label="Spreadsheets"]' } }),
} satisfies Record<Detail, Story>;

type Import = "dialog" | "sharepoint" | "sharepoint-refused";
const importSharePoint = (link: string) => then(loaded, click("Import"), choose("SharePoint"), async page => {
  await page.getByLabel("SharePoint workbook link").fill(link); await page.getByLabel("Name", { exact: true }).fill("Roster.xlsx"); }, click("Next"));
const LINK = "https://tenant.sharepoint.com/sites/people/Roster.xlsx";
const IMPORT = {
  dialog: scene("The import dialog", { play: then(loaded, click("Import")), story: { ready: 'role=dialog' } }),
  sharepoint: scene("A SharePoint workbook added", { play: importSharePoint(LINK), story: { ready: 'text="Added Roster.xlsx"' } }),
  "sharepoint-refused": scene("A SharePoint workbook the library refused", { server: { add: "refused" }, play: then(importSharePoint(LINK), still), story: { ready: "text=/Couldn't add the spreadsheet/" } }),
} satisfies Record<Import, Story>;

const AUDIT_FIXES = "#532";
const KNOWN_BREAKS = {
   "catalog/loaded": ["named-and-focusable"],
   "catalog/no-match": ["named-and-focusable"],
   "detail/back": ["named-and-focusable"],
   "detail/mapping-saved": ["named-and-focusable", "primary-button-accent"],
   "detail/mapping-failed": ["named-and-focusable", "primary-button-accent"],
  "import/dialog": ["named-and-focusable"],
   "import/sharepoint": ["named-and-focusable"],
   "import/sharepoint-refused": ["named-and-focusable", "word-limits", "toast-text-only"],
    "outcome/cloned": ["named-and-focusable"],
   "outcome/deleted": ["named-and-focusable"],
   "outcome/linked": ["named-and-focusable"],
   "outcome/pending": ["named-and-focusable", "word-limits"],
   "outcome/refused": ["named-and-focusable"],
   "outcome/renamed": ["named-and-focusable"],
   "outcome/rolled-back": ["named-and-focusable"],
   "outcome/sync-failed": ["named-and-focusable", "toast-text-only"],
   "outcome/synced": ["named-and-focusable"],
   "outcome/tagged": ["named-and-focusable"],
     "row/download": ["named-and-focusable"],
    "row/pin": ["named-and-focusable"],
     "row/sync": ["named-and-focusable"],
    "table/Pinned": ["named-and-focusable"],
   "table/SharePoint": ["named-and-focusable"],
   "table/Spreadsheets": ["named-and-focusable"],
 } as const;

export const SPREADSHEETS_STORIES = withKnownBreaks(
  defineSurface("spreadsheets", { catalog: CATALOG, table: TABLE, row: ROW, outcome: OUTCOME, detail: DETAIL, import: IMPORT }),
  "spreadsheets", AUDIT_FIXES, KNOWN_BREAKS);
