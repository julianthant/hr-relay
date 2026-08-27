/**
 * THE DESIGN-SYSTEM SPECIMEN PAGE (D274 item 3, ledger 3 UK146–UK157).
 *
 * `kit.html` is a third Vite entry whose closure is `ds/**` plus `lib/**` and
 * nothing else — no client, no served fact, no surface. It is the visual proof
 * that the system renders and the catalogue `DESIGN.md` points a builder at,
 * and it was built, shipped and never once photographed: the whole reference
 * corpus is of SURFACES, so a primitive that regressed in a state no surface
 * currently uses (a disabled Select, an indeterminate Checkbox, the loading
 * Button, the refusal Banner) changed nothing the lane could see.
 *
 * FULL PAGE, deliberately, and it is the only reference in the corpus that is.
 * Every operator surface is a fixed shell that must FIT its viewport, so a
 * full-page shot of one would photograph a scroll height rather than a layout.
 * The specimen page is the opposite: one scrolling column whose subject is the
 * whole column, and whose top 900px is a masthead and an anchor nav.
 *
 * ONE THEME, and the page itself is why. `kit.html` stamps `data-demo-theme`
 * statically on `<html>` and `<body>` and ships no toggle and no stored
 * preference — the theme is a fact about the page, not a state of it — so
 * `installTheme`, which seeds the operator app's `localStorage` key, has
 * nothing to seed here. Photographing Paper Ink would mean the HARNESS
 * rewriting the product's attributes, which is precisely the move D187 caught:
 * the lane would be photographing a theme the page never selected. The
 * capture therefore asserts the page's OWN stamped theme and records it.
 */
import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
import { PARITY_DIST_DIR, ensureParityBundle } from "./helpers/bundle.js";
import { startFixtureServer, type FixtureServer } from "./helpers/fixture-bff.js";
import { captureParityPair } from "./helpers/capture.js";
import { FIXTURE_APP_VERSION, FIXTURE_DAY, FIXTURE_DESCRIPTOR_HASH } from "./helpers/fixture-day.js";

const REFERENCES = resolve(import.meta.dirname, "references");

/** The entry's own path — the page is served as itself, never through a route. */
const KIT_ENTRY = "/kit.html";

/**
 * What `kit.html` stamps on `<html>` and `<body>`, and the corpus theme name it
 * corresponds to. Named here so the assertion below compares the page against a
 * stated expectation rather than against whatever it happens to say.
 */
const KIT_THEME = { attribute: "dark", name: "graphite-warm" } as const;

let server: FixtureServer;

test.beforeAll(async () => {
  ensureParityBundle();
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

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${server.baseUrl.replace(/\/$/u, "")}${KIT_ENTRY}`, { waitUntil: "domcontentloaded" });

  /*
    The page has no `data-parity-ready` flag because it resolves nothing: there
    is no bootstrap and no day to wait for, only React mounting. So readiness is
    the LAST section's own heading — waiting on the bottom of the column proves
    the whole specimen mounted, which is exactly the claim a full-page capture
    of it makes. `main.tsx` throws on a missing container, so a page that
    painted nothing fails loud in `errors` rather than photographing a blank.
  */
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
      viewport: "1440x900",
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
