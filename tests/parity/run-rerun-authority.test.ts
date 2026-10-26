import { AuthoritySourceClosureUnprovedError } from '../../src/backend/storage/source-closure.js';

import { test, expect, type Page } from "@playwright/test";
import { startRunRerunServer, type RunRerunServer } from "./helpers/run-rerun-server.js";
import { gotoAppState } from "./helpers/app-driver.js";
import { absentProbeEvidence } from "../support/fixtures/write-sequencer-fixtures.js";
import { EidSchema } from "../../src/rules/identity/ids.js";
import { deriveIdempotencyKeyDigest } from "../../src/rules/write-safety/write-safety.js";

const retainedParityFixtureFailures = new Set<object>();


async function reviewRerun(page: Page, server: RunRerunServer) {
  await gotoAppState(page, server.baseUrl, { day: server.day });
  await page.getByRole("button", { name: "Rerun", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Rerun", exact: true });
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(dialog.getByRole("textbox", { name: "Employee ID", exact: true })).toHaveValue("10812345");
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await dialog.getByRole("checkbox", { name: "Dry run", exact: true }).check();
  await dialog.getByRole("button", { name: "Preview plan", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Start dry run", exact: true })).toBeVisible();
  await expect(dialog.locator("summary").filter({ hasText: /View .* accepted/u })).toHaveCount(0);
  await expect(dialog).not.toContainText("planned by"); return dialog;
}

void 0;

test("ordinary batch dry run enqueues one reviewed vector and no work before final submit", async ({ page }) => {
  const server = await startRunRerunServer();
  let parityBodyFailure: { error: unknown } | undefined;
    try {
    await gotoAppState(page, server.baseUrl, { day: server.day, start: true });
    const dialog = page.getByRole("dialog", { name: "Start a run", exact: true });
    await dialog.getByPlaceholder("Employee ID").fill("10812346\n10812347");
    await dialog.getByRole("button", { name: "Continue", exact: true }).click();
    await dialog.getByRole("checkbox", { name: "Dry run", exact: true }).check();
    await dialog.getByRole("button", { name: "Preview plan", exact: true }).click();
    const submit = dialog.getByRole("button", { name: "Start dry run", exact: true }); await expect(submit).toBeVisible();
    await expect(dialog.locator("summary").filter({ hasText: /View .* accepted/u })).toHaveCount(0);
    expect(server.h.queueRoots).toHaveLength(1); await submit.click();
    await expect(page.getByRole("status", { name: "2 runs started", exact: true })).toBeVisible();
    await expect(dialog).toHaveCount(0);
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
  } catch (error) { parityBodyFailure = { error }; }
    if (parityBodyFailure?.error instanceof AuthoritySourceClosureUnprovedError) {
      retainedParityFixtureFailures.add({ owners: [page, server], primary: parityBodyFailure.error });
      throw parityBodyFailure.error;
    }
    let parityCleanupFailure: { error: unknown } | undefined;
    try { await page.close(); await server.close(); } catch (error) { parityCleanupFailure = { error }; }
    if (parityCleanupFailure !== undefined) {
      retainedParityFixtureFailures.add({ owners: [page, server], primary: parityBodyFailure?.error, cleanup: parityCleanupFailure.error });
      if (parityBodyFailure !== undefined) throw new AggregateError([parityBodyFailure.error, parityCleanupFailure.error], 'parity-body-and-cleanup-failed', { cause: parityBodyFailure.error });
      throw parityCleanupFailure.error;
    }
    if (parityBodyFailure !== undefined) throw parityBodyFailure.error;
});

test("settings save invalidates unconsumed review; new work selects saved settings and accepted replay stays exact", async ({ page }) => {
  const server = await startRunRerunServer();
  let parityBodyFailure: { error: unknown } | undefined;
    try {
    const dialog = await reviewRerun(page, server); const original = JSON.stringify(server.h.fresh(server.source));
    expect(server.saveSettings({ "timeouts.taskMs": { set: 90_000 } }).state).toBe("applied");
    await dialog.getByRole("button", { name: "Start dry run", exact: true }).click();
    await expect(dialog.getByText(/replan-required/u)).toBeVisible(); expect(server.h.queueRoots).toHaveLength(1);
    await dialog.getByText("Dismiss", { exact: true }).click();
    await dialog.getByRole("button", { name: "Continue", exact: true }).click();
    await dialog.getByRole("button", { name: "Preview plan", exact: true }).click();
    server.loseResponse(); await dialog.getByRole("button", { name: "Start dry run", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "Replay exact submission" })).toBeVisible();
    const root = server.h.queueRoots.at(-1); if (root === undefined) throw new Error("new run missing");
    const run = server.h.database.authority.runs.get(root.runId); if (run === undefined) throw new Error("run missing");
    expect(run.envelope.configSnapshotId).toBe(server.h.database.authority.runtimeConfig.get()?.configSnapshotId);
    expect(server.saveSettings({ "timeouts.taskMs": { set: 120_000 } }).state).toBe("applied");
    await page.reload(); await expect(page.locator('[data-parity-ready="true"]')).toBeVisible();
    await expect(dialog).toBeVisible(); await dialog.getByRole("button", { name: "Replay exact submission" }).click();
    await expect(page.getByRole("status", { name: "Run submission confirmed", exact: true })).toBeVisible();
    expect(server.h.queueRoots).toHaveLength(2); expect(server.h.database.authority.runs.get(root.runId)).toEqual(run);
    expect(JSON.stringify(server.h.fresh(server.source))).toBe(original);
  } catch (error) { parityBodyFailure = { error }; }
    if (parityBodyFailure?.error instanceof AuthoritySourceClosureUnprovedError) {
      retainedParityFixtureFailures.add({ owners: [page, server], primary: parityBodyFailure.error });
      throw parityBodyFailure.error;
    }
    let parityCleanupFailure: { error: unknown } | undefined;
    try { await page.close(); await server.close(); } catch (error) { parityCleanupFailure = { error }; }
    if (parityCleanupFailure !== undefined) {
      retainedParityFixtureFailures.add({ owners: [page, server], primary: parityBodyFailure?.error, cleanup: parityCleanupFailure.error });
      if (parityBodyFailure !== undefined) throw new AggregateError([parityBodyFailure.error, parityCleanupFailure.error], 'parity-body-and-cleanup-failed', { cause: parityBodyFailure.error });
      throw parityCleanupFailure.error;
    }
    if (parityBodyFailure !== undefined) throw parityBodyFailure.error;
});
