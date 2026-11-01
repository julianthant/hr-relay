import { expect } from "@playwright/test";
import { test } from "./helpers/fixtures.js";
import { PARITY_DIST_DIR } from "./helpers/bundle.js";
import { startFixtureServer } from "../support/helpers/dashboard/fixture-bff.js";
import { installTheme, PARITY_THEMES } from "./helpers/capture.js";
import { attachPresentationReference } from "./helpers/presentation-reference.js";
import { attachShellA11y } from "./helpers/shell-proof.js";

for (const theme of PARITY_THEMES) for (const width of [1280]) {
  const evidenceName = `archive-retirement-${theme.name}-${String(width)}.a11y.yml`;
  test(`legacy Archive URL shows removal notice and returns to dashboard ${theme.name} ${String(width)}`, {
    annotation: [{ type: "required-a11y-evidence", description: evidenceName }],
  }, async ({ page }, info) => {
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
    try {
      await page.setViewportSize({ width, height: 720 });
      await installTheme(page, theme);
      await page.goto(`${server.baseUrl}/?archive=old-run&archiveView=versions`);
      await expect(page.getByText("Archive page removed", { exact: true })).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Settings sections", exact: true }).getByRole("link", { name: "Archive", exact: true })).toHaveCount(0);
      await attachPresentationReference(page, info, "archive-removal-notice.png");
      await attachShellA11y(page, info, evidenceName);
      await page.getByRole("button", { name: "Return to dashboard", exact: true }).click();
      await expect(page.getByRole("navigation", { name: "Workflows", exact: true })).toBeVisible();
      expect(new URL(page.url()).searchParams.has("archive")).toBe(false);
    } finally { await server.close(); }
  });
}
