/**
 * DCR4's Top Bar search: strict search transport through the browser, exact
 * keyboard entry into its result list, and the visual/a11y references for the
 * persistent shell surface.
 */
import { expect,test } from "@playwright/test";
import { resolve } from "node:path";
import { CrossDateSearchPageSchema } from "../../src/domain/dashboard/search.js";
import { gotoAppState } from "./helpers/app-driver.js";
import { PARITY_DIST_DIR,ensureParityBundle } from "./helpers/bundle.js";
import {
PARITY_THEMES,
PARITY_VIEWPORTS,
assertThemeApplied,
captureParityPair,
installTheme,
type ParityTheme,
} from "./helpers/capture.js";
import { startFixtureServer,type FixtureServer } from "./helpers/fixture-bff.js";
import { FIXTURE_APP_VERSION,FIXTURE_DAY,FIXTURE_DESCRIPTOR_HASH } from "./helpers/fixture-identity.js";
import { assertShellGeometry } from "./helpers/geometry.js";

const REFERENCES = resolve(import.meta.dirname, "references");
const SEARCH_PAGE = CrossDateSearchPageSchema.parse({
  wireVersion: 1,
  generatedAt: "2026-08-28T16:00:00.000Z",
  snapshot: {
    authorityGeneration: 19,
    order: "match-strength/enqueued-desc/run-id-asc:v2",
    token: "dcr4-test-snapshot-token",
  },
  totalMatches: 1,
  coverage:{matched:1,subjectUnavailable:0,actorUnavailable:1,candidateLimit:10000},
  results: [{
    runId: "3b8f0a1e-2c4d-4e6f-8a9b-0c1d2e3f4a5b",
    traceId: "sp-160000-3b8f",
    workflowId: "separations",
    registration: {
      state: "registered",
      label: "Separations",
      code: "sp",
      categoryId: "separation",
    },
    partitionDay: FIXTURE_DAY,
    state: "parked-gate",
    shape: "single",
    dryRun: true,
    priority: "interactive",
    systems: ["kuali", "new-kronos", "ucpath"],
    runNumber: { state: "present", value: 42 },
    retryOf: { state: "absent", reason: "this run is not a retry" },
    enqueuedAt: "2026-08-28T16:00:00.000Z",
    endedAt: { state: "absent", reason: "this run is parked at a gate" },
    metadata:{subject:{state:"available",value:"Synthetic subject"},actor:{state:"unavailable",reason:"not-recorded"},version:1,failureCode:null,evidence:{receipt:false,failure:false,diagnostic:false}},
    match: { field: "workflow", strength: "exact" },
  }],
  nextCursor: { state: "absent", reason: "the snapshot has no later matching run" },
});

let server: FixtureServer;

test.beforeAll(async () => {
  ensureParityBundle();
  server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
});

test.afterAll(async () => {
  await server.close();
});

for (const viewport of PARITY_VIEWPORTS) {
  for (const theme of PARITY_THEMES) {
    test(`cross-date search ${theme.name} @ ${viewport.name}`, async ({ page }) => {
      await page.route("**/api/v1/search?**", async (route) => {
        const request = new URL(route.request().url());
        expect(["separations",""]).toContain(request.searchParams.get("q"));
        expect(request.searchParams.get("scope")).toBe("all");
        expect(request.searchParams.get("workflow")).toBeNull();
        expect(request.searchParams.get("shape")).toBeNull();
        expect(request.searchParams.get("dryRun")).toBeNull();
        expect(request.searchParams.get("limit")).toBe("20");
        await route.fulfill({ json: SEARCH_PAGE });
      });
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await installTheme(page, theme satisfies ParityTheme);
      await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY });
      await assertThemeApplied(page, theme satisfies ParityTheme);

      await page.getByRole("button", { name: "Search runs across dates" }).click();
      const input = page.getByRole("searchbox", { name: "Search run history" });
      await input.fill("separations");
      const result = page.getByRole("button", { name: "Open Separations Run 42 from 2026-08-03" });
      await expect(result).toBeVisible();
      await input.press("ArrowDown");
      await expect(result).toBeFocused();
      await assertShellGeometry(page, `cross-date search @ ${viewport.name} ${theme.name}`);

      await captureParityPair(page, REFERENCES, {
        stateId: "cross-date-search",
        viewport: viewport.name,
        theme: theme.name,
        adapter: "fixture",
        fixtureId: "cross-date-search",
        descriptorHash: FIXTURE_DESCRIPTOR_HASH,
        appVersion: FIXTURE_APP_VERSION,
        capturedAt: FIXTURE_DAY,
        variant: "default",
      });

      await page.keyboard.press("Escape");
      await expect(input).toHaveValue("");
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Search runs across dates" })).toBeFocused();
    });
  }
}
