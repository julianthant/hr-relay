/** Page object for the served dashboard: the shell, queue, run panel and Run dialog as an operator reaches them. */
import { expect, type Locator, type Page, type Request } from "@playwright/test";
import type { SeededServer } from "../served-fixtures/seeded-bff.js";
import { CommandResultSchema, type CommandResult } from "../../../../../src/rules/commands/commands.js";
import { noBannedText, type StateRuleContext } from "./state-rules.js";

export const WORKFLOW_LABELS = ["Person Lookup", "Separations", "I-9 Check", "Onboarding", "Work-Study", "Emergency Contact"] as const;
const QUIET_MS = 300;
export const DATA_PAGE_LABELS = ["Spreadsheets", "Explorer", "Analytics"] as const;
/** The supported minimum canvas and the default one. */
export const DESKTOP_VIEWPORTS = [{ width: 1280, height: 720 }, { width: 1024, height: 720 }] as const;

export class DashboardPage {
  readonly sidebar: Locator;
  readonly workflows: Locator;
  readonly queue: Locator;
  readonly runPanel: Locator;
  readonly startRunButton: Locator;
  readonly dialog: Locator;
  readonly toasts: Locator;

  constructor(readonly page: Page, private readonly server: SeededServer) {
    this.sidebar = page.getByRole("complementary", { name: "Workspace" });
    this.workflows = page.getByRole("navigation", { name: "Workflows" });
    this.queue = page.getByRole("region", { name: "Queue" });
    this.runPanel = page.getByRole("region", { name: "Selected run logs" });
    // An empty queue offers a second Start run in its body; the toolbar's is always present.
    this.startRunButton = page.getByRole("group", { name: "Action panel controls" }).getByRole("button", { name: "Start run", exact: true });
    this.dialog = page.getByRole("dialog", { name: "Start run", exact: true });
    this.toasts = page.locator('[data-slot="toast"]');
    // A running run arms the leave-page prompt; a test that reloads or navigates away means to leave.
    page.on("dialog", dialog => { if (dialog.type() === "beforeunload") void dialog.accept(); });
    page.on("request", request => { if (new URL(request.url()).pathname.startsWith("/api/")) { this.reads.add(request); this.lastReadAt = Date.now(); } });
    page.on("requestfinished", request => { this.reads.delete(request); this.lastReadAt = Date.now(); });
    page.on("requestfailed", request => { this.reads.delete(request); this.lastReadAt = Date.now(); });
  }

  private readonly reads = new Set<Request>();
  private lastReadAt = 0;

  /** Leaving a page aborts its open reads and the browser reports each abort; a test that navigates waits until no read has been open or finished for QUIET_MS, so a chained read cannot slip through. */
  async settleReads(): Promise<void> {
    await expect
      .poll(() => this.reads.size === 0 && Date.now() - this.lastReadAt >= QUIET_MS, { message: "API reads never went quiet" })
      .toBe(true);
  }

  async open(): Promise<void> {
    const url = new URL("/", this.server.baseUrl);
    url.searchParams.set("day", this.server.day);
    await this.page.goto(url.toString());
    await expect(this.sidebar).toBeVisible();
  }

  pageHeading(name: string | RegExp): Locator {
    return this.page.getByRole("heading", { level: 1, name, exact: true });
  }

  async openWorkflow(label: string): Promise<void> {
    await this.workflows.getByRole("button", { name: label, exact: true }).click();
    await expect(this.pageHeading(`${label} queue`)).toBeVisible();
  }

  /** Data pages are Settings sections; the Settings button is reachable from every page, the section list only while Settings is open. */
  async openDataPage(label: string): Promise<void> {
    const sections = this.page.getByRole("navigation", { name: "Settings sections" });
    if (!(await sections.isVisible())) await this.page.getByRole("button", { name: "Settings", exact: true }).click();
    await sections.getByRole("link", { name: label, exact: true }).click();
    await expect(this.pageHeading(label)).toBeVisible();
  }

  runId(key: string): string {
    const runId = this.server.runIds[key];
    if (runId === undefined) throw new Error(`Missing seeded run: ${key}`);
    return runId;
  }

  async openRun(runId: string): Promise<void> {
    const row = this.queue.locator(`[data-demo-row-id="${runId}"]`);
    await row.getByRole("button").and(row.locator("[data-queue-open]")).press("Enter");
    await this.expectRunOpen(runId);
  }

  async expectRunOpen(runId: string): Promise<void> {
    await expect(this.page).toHaveURL(url => url.searchParams.get("run") === runId);
    await expect(this.runPanel).toBeVisible();
  }

  async openStartDialog(): Promise<void> {
    await this.startRunButton.click();
    await expect(this.dialog.getByRole("heading", { name: "Start run" })).toBeVisible();
  }

  /** Fills the Work-Study Start run dialog for one employee ID and stops on the Checks stage, ready to press Start. */
  async fillStartDialog(eid: string): Promise<void> {
    await this.dialog.locator("textarea").fill(eid);
    await this.dialog.getByRole("button", { name: "Choose effective date" }).click();
    await this.page.getByRole("dialog").last().getByRole("gridcell", { name: /16/ }).first().click();
    await this.dialog.getByRole("button", { name: "Continue" }).click();
    await expect(this.dialog.getByRole("region", { name: "Run", exact: true })).toBeVisible();
    await this.dialog.getByRole("button", { name: "Continue" }).click();
    await expect(this.dialog.getByText("Ready to start")).toBeVisible();
  }

  async clearToasts(): Promise<void> {
    for (const close of await this.page.getByRole("button", { name: "Close toast" }).all()) await close.click();
    await expect(this.toasts).toHaveCount(0);
  }

  /** The press raised exactly one toast; `standing` names a state toast the page shows regardless of the press (a workflow with no worker). Nothing on the page reads as internal text. */
  async expectOneToast(text: string | RegExp, standing?: string): Promise<void> {
    await expect(this.toasts.filter({ hasText: text })).toHaveCount(1);
    if (standing !== undefined) await expect(this.toasts.filter({ hasText: standing })).toHaveCount(1);
    await expect(this.toasts, "no other toast").toHaveCount(standing === undefined ? 1 : 2);
    expect(await noBannedText({ page: this.page } as StateRuleContext), "text an operator must never read").toEqual([]);
  }

  /** The press raised no toast, and nothing on the page reads as internal text. */
  async expectNoToast(): Promise<void> {
    await expect(this.toasts).toHaveCount(0);
    expect(await noBannedText({ page: this.page } as StateRuleContext), "text an operator must never read").toEqual([]);
  }

  /** A second press on a control already pressed: Enter, then a click on the button if it is still there. */
  async pressAgain(button: Locator): Promise<void> {
    await this.page.keyboard.press("Enter");
    await button.dispatchEvent("click", undefined, { timeout: 500 }).catch(() => undefined);
  }

  /** Holds every command of `type` in flight until `release`, counting how many were sent. */
  async holdCommands(type: string): Promise<{ readonly sent: () => number; readonly release: () => void; readonly result: () => Promise<CommandResult> }> {
    let sent = 0;
    let answer: (result: CommandResult) => void = () => undefined;
    const answered = new Promise<CommandResult>(resolve => { answer = resolve; });
    let release = (): void => undefined;
    const released = new Promise<void>(resolve => { release = resolve; });
    await this.page.route("**/api/v1/commands", async route => {
      if ((route.request().postDataJSON() as { type?: string }).type !== type) return route.continue();
      sent += 1;
      await released;
      const response = await route.fetch();
      answer(CommandResultSchema.parse(await response.json()));
      return route.fulfill({ response });
    });
    return { sent: () => sent, release, result: () => answered };
  }

  /** The document must not scroll sideways at a supported desktop size. */
  async expectNoSidewaysScroll(): Promise<void> {
    await expect.poll(() => this.page.evaluate(() => {
      const root = document.scrollingElement ?? document.documentElement;
      return root.scrollWidth - root.clientWidth;
    }), { message: "horizontal page overflow in CSS pixels" }).toBeLessThanOrEqual(0);
  }
}
