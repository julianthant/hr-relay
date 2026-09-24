import { attachShellA11y } from "./helpers/shell-proof.js";
import { expect, test } from "@playwright/test";
import { sessionRuntime } from "./helpers/session-runtime.js";
import { DashboardDayWireSchema } from "../../src/domain/dashboard/projection.js";
import { CommandResultSchema, WorkerBrowserCommandRequestSchema } from "../../src/domain/commands.js";

// One registered runtime per theme; all viewports consume the same exact authority.
for (const theme of ["light", "dark"] as const) {
  const evidenceName = `sessions-${theme}.a11y.yml`;
  test(`real session controls, authority readback and desktop focus — ${theme}`, { annotation: [{ type: "required-a11y-evidence", description: evidenceName }] }, async ({ page }, info) => {
    const runtime = await sessionRuntime();
    try {
      await page.emulateMedia({ colorScheme: theme });
      await page.addInitScript((value) => localStorage.setItem("rebuild-demo.theme", value), theme);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(runtime.baseUrl);
      await expect(page.locator('[data-parity-ready="true"]')).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("data-demo-theme", theme);
      await page.getByRole("button", { name: /^Sessions/ }).click();
      const strip = page.locator("[data-session-strip]"); await expect(strip).toBeVisible();
      await page.getByTitle(`Worker ${runtime.workerId}`, { exact: true }).screenshot({ path: info.outputPath(`sessions-rest-${theme}.png`) });
      await expect(page.getByRole("button", { name: "Refresh UCPATH", exact: true })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Reopen UCPATH", exact: true })).toBeEnabled();
      const original = runtime.db.authority.workerControls.browsers(runtime.workerId).find((b) => b.system === "ucpath" && b.health !== "closed"); expect(original).toBeDefined();
      async function press(name: string) {
        const response = page.waitForResponse((response) => response.url().endsWith("/api/v1/commands") && response.request().method() === "POST");
        await page.getByRole("button", { name, exact: true }).click();
        const received = await response; const request = WorkerBrowserCommandRequestSchema.parse(received.request().postDataJSON());
        const result = CommandResultSchema.parse(await received.json()); expect(result.state).toBe("applied");
        expect(runtime.db.authority.commandAudits.findByCommand(request.commandId)?.result.state).toBe("applied");
        await expect.poll(() => runtime.db.authority.workerControls.get(request.commandId)?.auditedAt).toBeDefined();
        return request;
      }
      await press("Pause");
      await expect.poll(() => runtime.db.authority.workerLeases.get(runtime.workerId)?.lifecycle.state).toBe("paused");
      await expect(page.getByRole("button", { name: "Resume", exact: true })).toBeEnabled();
      await page.getByRole("button", { name: "Show UCPATH browser details and controls" }).click();
      const refresh = page.getByRole("button", { name: "Refresh UCPATH", exact: true });
      await expect(refresh).toBeEnabled();
      const refreshed = await press("Refresh UCPATH");
      expect("browserSessionId" in refreshed.target && refreshed.target.browserSessionId).toBe(original?.sessionId);
      await expect(refresh).toBeEnabled();
      await page.getByRole("dialog", { name: "UCPATH browser session" }).getByRole("button", { name: "Close" }).click();
      await press("Reopen UCPATH");
      const replacement = runtime.db.authority.workerControls.browsers(runtime.workerId).find((b) => b.system === "ucpath" && b.health === "authenticated");
      expect(replacement?.sessionId).not.toBe(original?.sessionId); expect(replacement?.profileDirectory).toBe(original?.profileDirectory);
      await expect(page.getByRole("button", { name: "Reopen UCPATH" })).toBeFocused();
      await expect.poll(async () => {
        const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
        const wire = DashboardDayWireSchema.parse(await (await page.request.get(`${runtime.baseUrl}/api/v1/dashboard?day=${day}`)).json());
        return wire.workerCards.find((card) => card.workerId === runtime.workerId)?.browsers.find((b) => b.system === "ucpath")?.sessionId;
      }).toBe(replacement?.sessionId);
      for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }, { width: 1024, height: 720 }]) {
        await page.setViewportSize(viewport); await expect(page.getByRole("button", { name: "Reopen UCPATH" })).toBeInViewport();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await page.screenshot({ path: info.outputPath(`sessions-${theme}-${String(viewport.width)}.png`), fullPage: true });
      }
      await page.reload(); await expect(page.locator('[data-parity-ready="true"]')).toBeVisible();
      await page.getByRole("button", { name: /^Sessions/ }).click();
      await expect(page.getByRole("button", { name: "Resume", exact: true })).toBeEnabled();
      await press("Resume"); await expect.poll(() => runtime.db.authority.workerLeases.get(runtime.workerId)?.lifecycle.state).toBe("idle");
      await press("Stop");
      await expect.poll(() => runtime.db.authority.workerLeases.get(runtime.workerId)?.lifecycle.state).toBe("stopped");
      await expect(page.getByTitle(`Worker ${runtime.workerId}`, { exact: true })).toBeFocused();
      await attachShellA11y(page, info, evidenceName);
      await info.attach("authority-correlation", { contentType: "application/json", body: JSON.stringify({ runId: runtime.runId, worker: runtime.db.authority.workerLeases.get(runtime.workerId),
        original, replacement, controls: runtime.db.authority.workerControls.list() }) });
    } finally { await runtime.close(); }
  });
}
