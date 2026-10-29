import { expect, test } from "@playwright/test";
import { attachShellA11y } from "./helpers/shell-proof.js";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { build, preview, type PreviewServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { PARITY_THEMES } from "./helpers/capture.js";


const cases = [
  { state: "loading" }, { state: "signed-out" }, { state: "expired" }, { state: "unavailable" },
  { state: "ocr-loading" }, { state: "ocr-completed" }, { state: "ocr-failed" }, { state: "ocr-refused" }, { state: "ocr-uncertain" },
  { state: "enabled" }, { state: "disabled" }, { state: "limit-reached" },
  { state: "enabled", action: "pending", control: "Test OCR" },
  { state: "expired", action: "pending", control: "Disconnect" },
  { state: "signed-out", action: "pending", control: "Connect ChatGPT" },
  { state: "enabled", action: "pending", control: "Disconnect" },
  { state: "signed-out", action: "failed", control: "Connect ChatGPT" },
  { state: "enabled", action: "failed", control: "Disconnect" },
] as const;
let server: PreviewServer;
let output: string;
let baseUrl: string;
test.describe.configure({ mode: "default" });
test.beforeAll(async () => {
  output = await mkdtemp(join(tmpdir(), "hrauto-account-component-"));
  const root = resolve("tests/parity/fixtures/account");
  await build({ configFile: false, root, plugins: [react(), tailwindcss()], logLevel: "warn", build: { outDir: output, emptyOutDir: true } });
  server = await preview({ configFile: false, root, logLevel: "warn", build: { outDir: output }, preview: { host: "127.0.0.1", port: 0, strictPort: true } });
  const address = server.httpServer.address();
  if (address === null || typeof address === "string") throw new Error("account-component-server-address-invalid");
  baseUrl = `http://127.0.0.1:${String(address.port)}`;
});
test.afterAll(async () => {
  if (server !== undefined) await new Promise<void>((done, reject) => server.httpServer.close(error => error ? reject(error) : done()));
  if (output !== undefined) await rm(output, { recursive: true, force: true });
});

for (const theme of PARITY_THEMES) for (const width of [1024, 1440]) {
  const evidenceName = `account-component-${theme.name}-${String(width)}.a11y.yml`;
  test(`account component fixture states ${theme.name} ${String(width)}`, { annotation: [{ type: "required-a11y-evidence", description: evidenceName }] }, async ({ page }, info) => {
    const errors: string[] = [], network: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { if (new URL(request.url()).origin !== baseUrl) network.push(request.url()); });
    await page.setViewportSize({ width, height: width === 1024 ? 720 : 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const entry of cases) {
      const action = "action" in entry ? entry.action : "success";
      await page.goto(`${baseUrl}/?${new URLSearchParams({ theme: theme.attribute, state: entry.state, action })}`);
      const account = page.getByRole("group", { name: "ChatGPT account", exact: true });
      await expect(account).toBeVisible();
      if (entry.state === "loading") await expect(page.getByRole("status", { name: "Loading ChatGPT account", exact: true })).toBeVisible();
      else if (entry.state === "unavailable") { await expect(page.getByText("ChatGPT account unavailable", { exact: true })).toBeVisible(); await expect(account.getByRole("button", { name: "Connect ChatGPT", exact: true })).toBeEnabled(); }
      else if (entry.state === "expired") await expect(account).toContainText("Your ChatGPT session expired.");
      else if (entry.state === "disabled") await expect(account).toContainText("ChatGPT plan access not enabled");
      else if (entry.state === "limit-reached") await expect(account).toContainText("Usage limit reached");
      if (entry.state.startsWith("ocr-")) {
        const titles: Record<string, string> = { "ocr-loading": "Testing OCR", "ocr-completed": "OCR test completed", "ocr-failed": "OCR test failed", "ocr-refused": "OCR test refused", "ocr-uncertain": "OCR test outcome uncertain" };
        await expect(page.getByText(titles[entry.state], { exact: true })).toBeVisible();
        if (entry.state === "ocr-loading" || entry.state === "ocr-uncertain") await expect(account.getByRole("button", { name: "Test OCR", exact: true })).toBeDisabled();
      }
      if ("control" in entry) {
        await account.getByRole("button", { name: entry.control, exact: true }).click();
        await expect(page.locator("body")).toHaveAttribute("data-action-calls", "1");
        if (entry.action === "pending") {
          await expect(account.getByRole("button", { name: entry.control, exact: true })).toBeDisabled();
          await page.keyboard.press("Enter");
          await expect(page.locator("body")).toHaveAttribute("data-action-calls", "1");
        } else {
          await expect(page.getByText("ChatGPT connection failed", { exact: true })).toBeVisible();
          await expect(account.getByRole("button", { name: entry.control, exact: true })).toBeEnabled();
          await expect(account).toContainText(entry.state === "enabled" ? "jordan.lee@example.com" : "Use your ChatGPT plan");
        }
      }
      await page.evaluate(() => document.fonts.ready);

    }
    await attachShellA11y(page, info, evidenceName);
    expect(errors).toEqual([]); expect(network).toEqual([]);
  });
}
