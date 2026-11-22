/** Page object for the served dashboard: the shell, queue, run panel and Run dialog as an operator reaches them. */
import { expect, type Locator, type Page } from "@playwright/test";
import type { SeededServer } from "../served-fixtures/seeded-bff.js";

export const WORKFLOW_LABELS = ["Person Lookup", "Separations", "I-9 Check", "Onboarding", "Work-Study", "Emergency Contact"] as const;
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

  constructor(readonly page: Page, private readonly server: SeededServer) {
    this.sidebar = page.getByRole("complementary", { name: "Workspace" });
    this.workflows = page.getByRole("navigation", { name: "Workflows" });
    this.queue = page.getByRole("region", { name: "Queue" });
    this.runPanel = page.getByRole("region", { name: "Selected run logs" });
    // An empty queue offers a second Start run in its body; the toolbar's is always present.
    this.startRunButton = page.getByRole("group", { name: "Action panel controls" }).getByRole("button", { name: "Start run", exact: true });
    this.dialog = page.getByRole("dialog", { name: "Start run", exact: true });
    // A running run arms the leave-page prompt; a test that reloads or navigates away means to leave.
    page.on("dialog", dialog => { if (dialog.type() === "beforeunload") void dialog.accept(); });
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

  /** The document must not scroll sideways at a supported desktop size. */
  async expectNoSidewaysScroll(): Promise<void> {
    await expect.poll(() => this.page.evaluate(() => {
      const root = document.scrollingElement ?? document.documentElement;
      return root.scrollWidth - root.clientWidth;
    }), { message: "horizontal page overflow in CSS pixels" }).toBeLessThanOrEqual(0);
  }
}
