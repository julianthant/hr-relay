import { expect, test } from "@playwright/test";
import { startRunRerunServer } from "./helpers/run-rerun-server.js";
import { absentProbeEvidence } from "../support/fixtures/write-sequencer-fixtures.js";
import { mkdir, writeFile } from "node:fs/promises";

const out = process.env.SWEEP_FIXTURES_OUT ?? "tests/mocks/.output/sweep-fixtures";
test.beforeAll(async () => { await mkdir(out, { recursive: true }); });

test("launch fixture serves its executed source through real run detail and Logs", async ({ request }) => {
  const server = await startRunRerunServer();
  try {
    const runId = server.source.envelope.runId;
    const detail = await request.get(`${server.baseUrl}/api/v1/runs/${runId}`);
    expect(detail.status()).toBe(200);
    expect(await detail.json()).toMatchObject({ runId, header: { workflowId: "launch-proof", status: "done" } });
    const logs = await request.get(`${server.baseUrl}/api/v1/runs/${runId}/logs`);
    expect(logs.status()).toBe(200);
    expect(await logs.json()).toMatchObject({ section: "logs" });
  } finally { await server.close(); }
});

for (const width of [1280, 1024]) test(`finished dry run serves its recorded plan content at ${width}`, async ({ request, page }) => {
  const server = await startRunRerunServer("dry-run");
  try {
    const logs = await request.get(`${server.baseUrl}/api/v1/runs/${server.source.envelope.runId}/logs`);
    expect(logs.status()).toBe(200);
    expect(await logs.json()).toMatchObject({ section: "logs", payload: { dryRunPreview: {
      state: "available", coverage: "full", stages: expect.arrayContaining([expect.objectContaining({ submitNotClicked: true })]),
    } } });
    await page.setViewportSize({ width, height: 720 });
    await page.goto(`${server.baseUrl}/?day=${server.day}&run=${server.source.envelope.runId}`);
    await expect(page.getByRole("region", { name: "Selected run logs", exact: true })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Run timeline", exact: true })).toBeVisible();
    await page.screenshot({ path: `${out}/dry-run-plan-${width}.png` });
    await writeFile(`${out}/dry-run-plan-${width}.yaml`, await page.locator("body").ariaSnapshot());
  } finally { await page.goto("about:blank"); await server.close(); }
});

for (const width of [1280, 1024]) test(`Logs timeline updates from the executor over SSE at ${width}`, async ({ page, request }) => {
  const server = await startRunRerunServer("queued");
  let release!: () => void, reached!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { reached = resolve; });
  server.h.world.prepareSteps = async () => { reached(); await held; };
  server.h.world.probeResults.push(absentProbeEvidence(server.h.clock.now().toISOString()));
  let executing: ReturnType<typeof server.h.execute> | undefined;
  try {
    await page.setViewportSize({ width, height: 720 });
    const url = `${server.baseUrl}/?day=${server.day}&run=${server.source.envelope.runId}`;
    await page.goto(url);
    const logs = page.getByRole("region", { name: "Selected run logs", exact: true });
    await expect(logs).toBeVisible();
    await expect(logs).not.toContainText("Loading");
    const before = await logs.ariaSnapshot();
    await page.screenshot({ path: `${out}/timeline-before-${width}.png` });
    executing = server.h.execute(server.source);
    await Promise.race([started, executing.then(() => { throw new Error("fixture ended before its controlled preparation"); })]);
    server.publish();
    const detail = await request.get(`${server.baseUrl}/api/v1/runs/${server.source.envelope.runId}`);
    expect(await detail.json()).toMatchObject({ header: { status: "running" }, timeline: { events: expect.arrayContaining([expect.objectContaining({ state: "active" })]) } });
    await expect.poll(() => logs.ariaSnapshot()).not.toBe(before);
    await page.screenshot({ path: `${out}/timeline-live-${width}.png` });
    await writeFile(`${out}/timeline-live-${width}.yaml`, await logs.ariaSnapshot());
    release();
    expect(await executing).toMatchObject({ state: "done" });
    server.publish();
  } finally { release(); await executing; await page.goto("about:blank"); await server.close(); }
});

// Known product bug owned by dry-run-preview-01: a dry run with no confirmed actions never renders its preview region.
for (const width of [1280, 1024]) test(`finished dry run shows its full preview region at ${width}`, async ({ page }) => {
  test.fail();
  const server = await startRunRerunServer("dry-run");
  try {
    await page.setViewportSize({ width, height: 720 });
    await page.goto(`${server.baseUrl}/?day=${server.day}&run=${server.source.envelope.runId}`);
    await expect(page.getByRole("region", { name: "Selected run logs", exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Full dry-run preview", exact: true })).toBeVisible();
  } finally { await page.goto("about:blank"); await server.close(); }
});
