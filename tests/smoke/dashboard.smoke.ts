import { expect, test } from "../support/helpers/dashboard/smoke/smoke-fixtures.js";

test("every Settings section opens from its navigation link", async ({ dashboard, page }) => {
  await dashboard.open();

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const sections = page.getByRole("navigation", { name: "Settings sections" });
  const links = sections.getByRole("link");
  await expect(links.first()).toBeVisible();
  const routes = await links.evaluateAll(anchors => anchors.map(anchor => ({ href: anchor.getAttribute("href"), label: anchor.textContent?.trim() })));
  expect(routes.length).toBeGreaterThan(0);

  for (const { href: route, label } of routes) {
    if (!route?.startsWith("?settings=") || !label) throw new Error("Settings section is missing its route or label");
    await sections.getByRole("link", { name: label, exact: true }).click();
    await expect(page).toHaveURL(url => url.searchParams.get("settings") === new URLSearchParams(route).get("settings"));
    const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    await expect(dashboard.pageHeading(new RegExp(`^${escapedLabel}`, "i"))).toBeVisible();
  }
});
