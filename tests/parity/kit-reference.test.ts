
import { expect } from "@playwright/test";
import { test } from "./helpers/fixtures.js";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { PARITY_DIST_DIR } from "./helpers/bundle.js";
import { captureParityPair } from "./helpers/capture.js";
import { startFixtureServer,type FixtureServer } from "../support/helpers/dashboard/fixture-bff.js";
import { FIXTURE_APP_VERSION,FIXTURE_DAY,FIXTURE_DESCRIPTOR_HASH } from "./helpers/fixture-identity.js";

const REFERENCES = resolve(import.meta.dirname, "references");

/** The entry's own path — the page is served as itself, never through a route. */
const KIT_ENTRY = "/kit.html";


const KIT_THEME = { attribute: "dark", name: "graphite-warm" } as const;

let server: FixtureServer;

test.beforeAll(async () => {
  server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
});

test.afterAll(async () => {
  await server.close();
});

test("ds-kit specimen page", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`${server.baseUrl.replace(/\/$/u, "")}${KIT_ENTRY}`, { waitUntil: "domcontentloaded" });

  // The specimen resolves no bootstrap; wait for its layout contract after React mounts.
  await expect(page.getByRole("heading", { name: "Rebuild demo — design system", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Foundations", level: 2 })).toBeVisible();

  const stamped = await page.evaluate(() => ({
    html: document.documentElement.getAttribute("data-demo-theme"),
    body: document.body.getAttribute("data-demo-theme"),
  }));
  expect(
    stamped,
    "kit.html stamps its theme statically; a capture of a page whose stamp moved is a capture of "
    + "a palette nobody declared",
  ).toEqual({ html: KIT_THEME.attribute, body: KIT_THEME.attribute });

  // Entrance transitions and web-font swap settle before a 1440-wide column of
  // every primitive is frozen.
  await page.waitForTimeout(400);
  expect(errors, "page errors while rendering the design-system specimen page").toEqual([]);

  await captureParityPair(
    page,
    REFERENCES,
    {
      stateId: "ds-kit",
      viewport: "1280x720",
      theme: KIT_THEME.name,
      // The page serves no fact and calls no endpoint, so there is no adapter
      // behind it. `none` states that rather than borrowing a credible name.
      adapter: "none",
      fixtureId: "ds-kit",
      descriptorHash: FIXTURE_DESCRIPTOR_HASH,
      appVersion: FIXTURE_APP_VERSION,
      capturedAt: FIXTURE_DAY,
      variant: "default",
    },
    { fullPage: true },
  );
});


test("ds-kit Cancelling state is distinct and nonterminal", {
  annotation: [{ type: "required-a11y-evidence", description: "ds-kit-cancelling.a11y.yml" }],
}, async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`${server.baseUrl}${KIT_ENTRY}?status=cancelling`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Run statuses", exact: true })).toBeVisible();
  await expect(page.getByText("Cancelling", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Foundations", level: 2 })).toBeVisible();
  expect(errors).toEqual([]);

  const tree = await page.locator("body").ariaSnapshot();
  expect(tree).toContain("Cancelling");
  expect(tree).toContain("Cancellation requested. The worker has not settled the run yet.");
  test.info().annotations.push({ type: "a11y-attachment-sha256:ds-kit-cancelling.a11y.yml",
    description: createHash("sha256").update(tree).digest("hex") });
  await test.info().attach("ds-kit-cancelling.a11y.yml", { body: tree, contentType: "text/yaml" });
});
