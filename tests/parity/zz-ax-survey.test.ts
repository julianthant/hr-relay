import { test } from "./helpers/fixtures.js";
import { PARITY_DIST_DIR } from "./helpers/bundle.js";
import { startFixtureServer, type FixtureServer } from "../support/helpers/dashboard/fixture-bff.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";
let server: FixtureServer;
test.beforeAll(async () => { server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } }); });
test.afterAll(async () => { await server.close(); });
for (const width of [1280, 1024]) for (const q of ["assistantOpen=0", "assistantOpen=0&sessions=1", "assistantOpen=1&assistantMock=01-chat-basics"]) test(`survey ${width} ${q}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 720 });
  const view = encodeURIComponent(JSON.stringify({ preview: "separations", mockRun: "mock:separations:sample", sessions: q.includes("sessions=1") }));
  await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}&view=${view}&${q.replace("&sessions=1", "")}&statusMock=general-a`);
  await page.waitForTimeout(1200);
  const out = await page.evaluate(() => {
    const box = (sel: string) => { const e = document.querySelector(sel); if (!e) return sel + " missing"; const r = e.getBoundingClientRect(); return `${sel}: x ${Math.round(r.left)}-${Math.round(r.right)} y ${Math.round(r.top)}-${Math.round(r.bottom)}`; };
    return [box(".session-pill"), box("[data-assistant-launcher]"), box(".session-float"), box(".dashboard-log-column > section:last-of-type"), box(".log-footer"), box(".workspace-rail"), box("#hub-shell-assistant"), box(".dashboard-queue-column")].join("\n");
  });
  console.log(`== ${width} ${q}\n${out}`);
});
