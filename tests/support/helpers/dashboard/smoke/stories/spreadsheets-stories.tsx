/** Spreadsheets surface stories: the library's read, its two tables, every row action and what comes of it, a spreadsheet opened with its
 * Columns panel, worksheet list and Use for all, and import as a menu, a draft page and a SharePoint link. The real page runs on an in-page library server that answers the reads and applies the
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
const TAGLESS = "Imported contacts.xlsx";
const click = (name: string | RegExp, role: "button" | "menuitem" | "radio" | "link" = "button") => async (page: Page): Promise<void> => {
  await page.getByRole(role, { name, exact: typeof name === "string" }).first().click();
};
const then = (...steps: readonly ((page: Page) => Promise<void>)[]) => async (page: Page): Promise<void> => { for (const step of steps) await step(page); };
const fill = (label: string, value: string) => async (page: Page): Promise<void> => { await page.getByLabel(label, { exact: true }).fill(value); };
const openRow = (name: string) => async (page: Page): Promise<void> => { await page.locator(`li[aria-label="${name}"]`).getByText(name, { exact: true }).first().click(); };
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

type Catalog = "loaded" | "loading" | "error" | "empty" | "no-match" | "tag-filter";
const CATALOG = {
  loaded: scene("The library with spreadsheets"),
  loading: scene("The library being read", { server: { catalog: "never" }, story: { ready: 'text="Spreadsheets"', slowFetch: { region: '[aria-label="Loading spreadsheets"]' } } }),
  error: scene("The library could not be read", { server: { catalog: "fail" }, story: { ready: 'text="Couldn\'t load spreadsheets."' } }),
  empty: scene("A library with nothing in it", { server: { seed: "none" }, story: { ready: 'text="No spreadsheets yet"' } }),
  "no-match": scene("A search that matches nothing", { play: then(loaded, fill("Search spreadsheets", "zzz")), story: { ready: 'text="No spreadsheets match."' } }),
  "tag-filter": scene("The All tags filter open with its search", { play: then(loaded, click("Filter by tag")), story: { ready: 'input[aria-label="Find a tag"]' } }),
} satisfies Record<Catalog, Story>;

type Table = "Pinned" | "Spreadsheets";
const TABLE = {
  Pinned: scene("Pinned spreadsheets", { story: { ready: 'ul[aria-label="Pinned"]' } }),
  Spreadsheets: scene("Spreadsheets added here", { story: { ready: 'ul[aria-label="Spreadsheets"]' } }),
} satisfies Record<Table, Story>;

const pin = (sheet = SHEET) => then(loaded, click(`Pin ${sheet}`));
const tagMenu = (sheet = SHEET) => then(loaded, click(`Add a tag to ${sheet}`));
type Row = "pin" | "sync" | "link" | "clone" | "rename" | "tags" | "delete" | "download" | "versions" | "version-new" | "version-rename" | "version-delete";
const ROW = {
  pin: scene("A spreadsheet pinned with its row pin", { play: pin(), story: { ready: 'ul[aria-label="Pinned"] >> text="Onboarding list.xlsx"' } }),
  sync: scene("Sync now chosen from a row's menu", { play: menu("Sync now", "Department roster.xlsx"), story: { ready: 'text="Synced Department roster.xlsx"' } }),
  link: act("Link to SharePoint…", 'role=dialog'),
  clone: act("Clone", 'role=dialog'),
  rename: act("Rename", 'role=dialog'),
  tags: scene("A row's tag menu", { play: tagMenu(), story: { ready: 'role=menu' } }),
  delete: act("Delete", 'role=dialog'),
  download: scene("A spreadsheet downloaded", { play: menu("Download"), story: { ready: `ul[aria-label="Spreadsheets"]` } }),
  versions: scene("A spreadsheet's versions", { play: then(loaded, click(/^Versions of Department roster/)), story: { ready: 'role=dialog' } }),
  "version-new": scene("A new version's name and source", { play: then(loaded, click(/^Versions of Department roster/), click("New version")), story: { ready: 'role=dialog' } }),
  "version-rename": scene("A version's new name", { play: then(loaded, click(/^Versions of Department roster/), click("Rename Original")), story: { ready: 'role=dialog' } }),
  "version-delete": scene("A version delete confirm", { play: then(loaded, click(/^Versions of Department roster/), click("Delete Original")), story: { ready: 'role=dialog' } }),
} satisfies Record<Row, Story>;

type Outcome = "cloned" | "clone-refused" | "renamed" | "tagged" | "linked" | "deleted" | "version-used" | "refused" | "pending" | "sync-failed" | "synced";
const done = (...steps: readonly ((page: Page) => Promise<void>)[]) => then(...steps);
const OUTCOME = {
  cloned: scene("A clone added", { play: done(menu("Clone"), click("Clone", "button")), story: { ready: 'text=/Cloned/' } }),
  "clone-refused": scene("A clone the library refused", { server: { add: "refused" }, play: done(menu("Clone"), click("Clone", "button"), still), story: { ready: 'text="That spreadsheet is no longer in the library."' } }),
  renamed: scene("A spreadsheet renamed", { play: done(menu("Rename"), fill("Name", "Onboarding 2026.xlsx"), click("Rename")), story: { ready: 'text="Onboarding 2026.xlsx"' } }),
  tagged: scene("A tag created from a row's tag menu", { play: done(tagMenu(TAGLESS), fill("Find or create a tag", "Priority"), async page => { await page.getByLabel("Find or create a tag", { exact: true }).press("Enter"); }),
    story: { ready: `li[aria-label="${TAGLESS}"] >> text="Priority" >> visible=true` } }),
  linked: scene("A SharePoint link added", { play: done(menu("Link to SharePoint…"), async page => { await page.getByPlaceholder("https://…sharepoint.com/…").fill("https://tenant.sharepoint.com/sites/people/Roster.xlsx"); }, click("Link")), story: { ready: 'text=/Linked/' } }),
  deleted: scene("A spreadsheet deleted", { play: done(menu("Delete"), click("Delete spreadsheet")), story: { ready: 'ul[aria-label="Spreadsheets"]' } }),
  "version-used": scene("A version put in use", { play: done(loaded, click(/^Versions of Department roster/), click(/Version 2|v2/, "radio"), click("Use version"), click("Use version")), story: { ready: 'ul[aria-label="Pinned"]' } }),
  refused: scene("A change the library refused", { server: { action: "refused" }, play: done(pin()), story: { ready: 'text=/Couldn\'t save the change/' } }),
  pending: scene("A change whose result is not yet known", { server: { action: "lost" }, play: done(pin()), story: { ready: 'text=/The library change is not yet confirmed/' } }),
  "sync-failed": scene("A sync the library could not finish", { server: { sync: "fail" }, play: done(menu("Retry sync", "Hiring tracker.xlsx")), story: { ready: "text=/Couldn't sync Hiring tracker.xlsx/" } }),
  synced: scene("A linked spreadsheet synced", { play: done(menu("Retry sync", "Hiring tracker.xlsx")), story: { ready: 'text="Synced Hiring tracker.xlsx"' } }),
} satisfies Record<Outcome, Story>;

const OPEN = (play = then(loaded, openRow(SHEET))): Pick<Scene, "play"> => ({ play });
type Detail = "grid" | "opening" | "open-failed" | "mapping-menu" | "mapping-saved" | "mapping-failed" | "worksheets" | "copied" | "back";
const pickColumn = async (page: Page): Promise<void> => {
  await page.getByRole("button", { name: /column, not mapped/ }).first().click();
  await page.getByRole("menuitemradio").first().click();
};
const mapped = '[aria-label="Columns"] >> text="1 of 1"';
const DETAIL = {
  grid: scene("A spreadsheet opened", { ...OPEN(), story: { ready: '[aria-label="Preview"]' } }),
  opening: scene("A spreadsheet being opened", { server: { open: "never" }, ...OPEN(), story: { ready: '[aria-label="Opening Onboarding list.xlsx"]', slowFetch: { region: '[aria-label="Opening Onboarding list.xlsx"]' } } }),
  "open-failed": scene("A spreadsheet that could not be opened", { server: { open: "fail" }, ...OPEN(), story: { ready: `text="This spreadsheet couldn't be opened."` } }),
  "mapping-menu": scene("A field's column list open beside the grid", { ...OPEN(then(loaded, openRow("Imported contacts.xlsx"), click(/column, not mapped/))), story: { ready: 'role=menu' } }),
  "mapping-saved": scene("A column mapping saved", { ...OPEN(then(loaded, openRow("Imported contacts.xlsx"), pickColumn)), story: { ready: mapped } }),
  "mapping-failed": scene("A column mapping that did not save", { server: { save: "refused" }, ...OPEN(then(loaded, openRow("Imported contacts.xlsx"), pickColumn)), story: { ready: "text=/Couldn't save the columns/" } }),
  worksheets: scene("The worksheet list with matched counts", { ...OPEN(then(loaded, openRow(SHEET), click("Worksheet"))), story: { ready: 'ul[aria-label="Worksheets"]' } }),
  copied: scene("One worksheet's columns used for all", { ...OPEN(then(loaded, openRow(SHEET), click("Use for all 3 worksheets"))), story: { ready: 'text="Columns copied"' } }),
  back: scene("Back to the library", { ...OPEN(then(loaded, openRow(SHEET), backToLibrary)), story: { ready: 'ul[aria-label="Spreadsheets"]' } }),
} satisfies Record<Detail, Story>;

type Import = "menu" | "draft" | "draft-tags" | "added" | "sharepoint" | "sharepoint-refused";
const CSV = "Employee ID,Name\n10000001,\"Sample, Person 1\"\n10000002,\"Sample, Person 2\"\n";
const pickFile = then(loaded, async page => {
  await page.locator('input[type="file"]').first().setInputFiles({ name: "New hires.csv", mimeType: "text/csv", buffer: Buffer.from(CSV) });
});
const importSharePoint = (link: string) => then(loaded, click("Import"), click(/SharePoint link/, "menuitem"), fill("Workbook link", link), fill("Name", "Roster.xlsx"), click("Add"));
const LINK = "https://tenant.sharepoint.com/sites/people/Roster.xlsx";
const IMPORT = {
  menu: scene("The Import menu", { play: then(loaded, click("Import")), story: { ready: 'role=menu' } }),
  draft: scene("A picked file as a draft page", { play: pickFile, story: { ready: '[aria-label="Preview"]' } }),
  "draft-tags": scene("A draft's tag menu", { play: then(pickFile, click("Add a tag to New hires")), story: { ready: 'role=menu' } }),
  added: scene("A draft added to the library", { play: then(pickFile, async page => { await page.locator('[aria-label="Preview"]').waitFor(); }, click("Add to library")), story: { ready: 'text="Added New hires"' } }),
  sharepoint: scene("A SharePoint workbook added", { play: importSharePoint(LINK), story: { ready: 'text="Added Roster.xlsx"' } }),
  "sharepoint-refused": scene("A SharePoint workbook the library refused", { server: { add: "refused" }, play: then(importSharePoint(LINK), still), story: { ready: "text=/Couldn't add the spreadsheet/" } }),
} satisfies Record<Import, Story>;

const AUDIT_FIXES = "#532";
const KNOWN_BREAKS = {
   "catalog/loaded": ["named-and-focusable"],
   "catalog/tag-filter": ["named-and-focusable"],
   "detail/back": ["named-and-focusable"],
   "detail/mapping-menu": ["named-and-focusable"],
   "import/added": ["named-and-focusable"],
   "import/menu": ["named-and-focusable"],
   "import/sharepoint": ["named-and-focusable"],
    "outcome/cloned": ["named-and-focusable"],
   "outcome/deleted": ["named-and-focusable"],
   "outcome/linked": ["named-and-focusable"],
   "outcome/pending": ["named-and-focusable", "word-limits"],
   "outcome/refused": ["named-and-focusable"],
   "outcome/renamed": ["named-and-focusable"],
   "outcome/version-used": ["named-and-focusable"],
   "outcome/sync-failed": ["named-and-focusable"],
   "outcome/tagged": ["named-and-focusable"],
     "row/download": ["named-and-focusable"],
    "row/pin": ["named-and-focusable"],
     "row/sync": ["named-and-focusable"],
     "row/tags": ["named-and-focusable"],
    "table/Pinned": ["named-and-focusable"],
   "table/Spreadsheets": ["named-and-focusable"],
 } as const;

export const SPREADSHEETS_STORIES = withKnownBreaks(
  defineSurface("spreadsheets", { catalog: CATALOG, table: TABLE, row: ROW, outcome: OUTCOME, detail: DETAIL, import: IMPORT }),
  "spreadsheets", AUDIT_FIXES, KNOWN_BREAKS);
