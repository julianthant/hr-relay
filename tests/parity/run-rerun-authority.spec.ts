import { createHash } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { startRunRerunServer, type RunRerunServer } from "./helpers/run-rerun-server.js";
import { gotoAppState } from "./helpers/app-driver.js";
import { absentProbeEvidence } from "./helpers/write-sequencer-fixtures.js";
import { EidSchema } from "../../src/domain/ids.js";
import { deriveIdempotencyKeyDigest } from "../../src/domain/write-safety.js";
import { StartCommandRequestSchema } from "../../src/domain/commands.js";

async function reviewRerun(page: Page, server: RunRerunServer) {
  await gotoAppState(page, server.baseUrl, { day: server.day });
  await page.getByRole("button", { name: "Rerun", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Rerun", exact: true });
  await dialog.getByRole("button", { name: "Next", exact: true }).click();
  await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
  await dialog.getByRole("button", { name: "Copy Employee ID", exact: true }).click();
  await dialog.getByRole("button", { name: "Next", exact: true }).click();
  await dialog.getByRole("checkbox", { name: "Dry run", exact: true }).check();
  await dialog.getByRole("button", { name: "Next", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Start dry run", exact: true })).toBeVisible(); return dialog;
}

test("real BFF Rerun survives response loss, reload and delayed worker claim", { annotation: [{ type: "required-a11y-evidence", description: "run-rerun-authority.a11y.yml" }] }, async ({ page }) => {
  const server = await startRunRerunServer();
  try {
    const { h, source } = server; const original = JSON.stringify(h.fresh(source));
    const dialog = await reviewRerun(page, server);
    const tree = await page.locator("body").ariaSnapshot();
    test.info().annotations.push({ type: "a11y-attachment-sha256:run-rerun-authority.a11y.yml", description: createHash("sha256").update(tree).digest("hex") });
    await test.info().attach("run-rerun-authority.a11y.yml", { body: tree, contentType: "text/yaml" });
    const priorRoots = h.queueRoots;
    server.loseResponse(); await dialog.getByRole("button", { name: "Start dry run", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "Replay exact submission" })).toBeVisible();
    await expect.poll(() => h.queueRoots.length).toBe(priorRoots.length + 1);
    const queued = h.queueRoots.at(-1); expect(queued).toBeDefined(); if (queued === undefined) throw new Error("missing queue root");
    const run = h.database.authority.runs.get(queued.runId); if (run === undefined) throw new Error("missing run");
    expect(run.lifecycle.state).toBe("queued"); expect(run.envelope.dryRun).toBe(true); expect(run.claimGeneration).toBe(0);
    expect(run.envelope.configFingerprint).toBe(h.database.authority.runtimeConfig.get()?.configFingerprint);
    await page.reload(); await expect(page.locator('[data-parity-ready="true"]')).toBeVisible();
    await page.getByRole("button", { name: "Start a run", exact: true }).click();
    await page.getByRole("button", { name: "Replay exact submission" }).click();
    await expect(page.getByText("Already applied", { exact: true })).toBeVisible();
    expect(h.queueRoots.length).toBe(priorRoots.length + 1);
    expect(server.commands).toHaveLength(2); expect(server.commands[1]).toEqual(server.commands[0]);
    const command = StartCommandRequestSchema.parse(server.commands[0]);
    const retained = await page.evaluate(() => Object.values(sessionStorage).join(""));
    expect(retained).toContain(command.commandId); expect(retained).not.toContain("10812345");
    const commits = h.world.events.filter((event) => event === "commit").length;
    h.world.probeResults.push(absentProbeEvidence(h.clock.now().toISOString()));
    expect((await h.execute(run)).state).toBe("done"); server.publish();
    expect(h.world.events.filter((event) => event === "commit").length).toBe(commits);
    expect(JSON.stringify(h.fresh(source))).toBe(original);
    await page.getByText("Close", { exact: true }).click(); await page.keyboard.press("Escape"); await page.reload();
    await expect(page.locator('[data-parity-ready="true"]')).toBeVisible();
    expect(server.snapshot().queueSurfaces.some((row) => row.runId === run.envelope.runId && row.status === "done")).toBe(true);
  } finally { await page.close(); await server.close(); }
});

test("ordinary batch dry run enqueues one reviewed vector and no work before final submit", async ({ page }) => {
  const server = await startRunRerunServer();
  try {
    await gotoAppState(page, server.baseUrl, { day: server.day, start: true });
    const dialog = page.getByRole("dialog", { name: "Start a run", exact: true });
    await dialog.getByPlaceholder("Employee ID").fill("10812346\n10812347");
    await dialog.getByRole("button", { name: "Next", exact: true }).click();
    await dialog.getByRole("checkbox", { name: "Dry run", exact: true }).check();
    await dialog.getByRole("button", { name: "Next", exact: true }).click();
    const submit = dialog.getByRole("button", { name: "Start dry run", exact: true }); await expect(submit).toBeVisible();
    expect(server.h.queueRoots).toHaveLength(1); await submit.click();
    await expect(page.getByText("Start applied", { exact: true })).toBeVisible();
    await expect.poll(() => new URL(page.url()).searchParams.has("day")).toBe(false);
    expect(server.h.queueRoots).toHaveLength(3); expect(server.commands).toHaveLength(1);
    for (const entry of server.h.queueRoots.slice(1)) {
      const run = server.h.database.authority.runs.get(entry.runId); if (run === undefined) throw new Error("missing batch child");
      expect(run.lifecycle.state).toBe("queued"); expect(run.envelope.dryRun).toBe(true);
      const absence = absentProbeEvidence(server.h.clock.now().toISOString());
      const input = run.input.parsed.value; if (input === null || typeof input !== "object") throw new Error("fixture input must be an object");
      const eid = EidSchema.parse(Reflect.get(input, "eid")); server.h.world.subjectEid = eid;
      server.h.world.probeResults.push({ ...absence, evidence: { ...absence.evidence,
        idempotencyKeyDigest: deriveIdempotencyKeyDigest("ucpath", `${eid}|fixture-termination`) } });
      const executed = await server.h.execute(run);
      expect(executed.state, JSON.stringify(executed.state === "failed" ? server.h.database.authority.failures.get(executed.failureId) : executed)).toBe("done");
    }
  } finally { await page.close(); await server.close(); }
});

test("settings save invalidates unconsumed review; new work selects saved settings and accepted replay stays exact", async ({ page }) => {
  const server = await startRunRerunServer();
  try {
    const dialog = await reviewRerun(page, server); const original = JSON.stringify(server.h.fresh(server.source));
    expect(server.saveSettings({ "timeouts.taskMs": { set: 90_000 } }).state).toBe("applied");
    await dialog.getByRole("button", { name: "Start dry run", exact: true }).click();
    await expect(dialog.getByText(/replan-required/u)).toBeVisible(); expect(server.h.queueRoots).toHaveLength(1);
    await dialog.getByText("Dismiss", { exact: true }).click();
    await dialog.getByRole("button", { name: "Next", exact: true }).click();
    await dialog.getByRole("button", { name: "Next", exact: true }).click();
    await dialog.getByRole("button", { name: "Start dry run", exact: true }).click();
    await expect(dialog.getByText("Start applied", { exact: true })).toBeVisible();
    const root = server.h.queueRoots.at(-1); if (root === undefined) throw new Error("new run missing");
    const run = server.h.database.authority.runs.get(root.runId); if (run === undefined) throw new Error("run missing");
    expect(run.envelope.configSnapshotId).toBe(server.h.database.authority.runtimeConfig.get()?.configSnapshotId);
    expect(server.saveSettings({ "timeouts.taskMs": { set: 120_000 } }).state).toBe("applied");
    await page.reload(); await expect(page.locator('[data-parity-ready="true"]')).toBeVisible();
    await page.getByRole("button", { name: "Start a run", exact: true }).click(); await page.getByRole("button", { name: "Replay exact submission" }).click();
    await expect(page.getByText("Already applied", { exact: true })).toBeVisible();
    expect(server.h.queueRoots).toHaveLength(2); expect(server.h.database.authority.runs.get(root.runId)).toEqual(run);
    expect(JSON.stringify(server.h.fresh(server.source))).toBe(original);
  } finally { await page.close(); await server.close(); }
});
