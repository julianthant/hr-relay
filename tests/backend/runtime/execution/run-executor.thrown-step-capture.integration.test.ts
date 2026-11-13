import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { createDiagnosticCaptureService } from "../../../../src/backend/logs/diagnostics/diagnostic-capture.js";
import { createRunBrowserScreenshotCapture } from "../../../../src/backend/logs/diagnostics/run-diagnostic-capture.js";
import { executeClaimedRun } from "../../../../src/backend/runtime/execution/run-executor.js";
import { createContentAddressedArtifactWriter } from "../../../../src/backend/storage/artifacts/content-addressed-artifact-writer.js";
import { createNoteTimelineWriter } from "../../../../src/backend/storage/events/note-timeline-writer.js";
import { ucpathDriver } from "../../../../src/backend/systems/ucpath/driver-declaration.js";
import { SearchPersonOrg } from "../../../../src/models/systems/ucpath/search-person-org.js";
import { defineTask } from "../../../../src/workflow-kit/task.js";
import type { BrowserScreenshotEvidence } from "../../../../src/workflow-kit/session.js";
import { sequentialIdFactory } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { createRunExecutorTestWorld, registryWithUcpathSearch } from "../../../support/helpers/backend/run-executor-world.js";
import { happySessionHarness, personLookupQueuedRun, type SessionFactoryHarness } from "../../../support/helpers/phase1f-executor-harness.js";

const { executorHarness, enqueueAndClaim, SIGNAL, cleanup } = createRunExecutorTestWorld();
afterEach(cleanup);

const thrownTask = defineTask(ucpathDriver, SearchPersonOrg, {
  sessions: [{ system: "ucpath", access: "read", session: "reuse-worker" }],
  async run({ input, ctx }) {
    await ctx.driver.searchPersonOrg(input);
    throw Object.assign(new Error("Timeout 30000ms exceeded."), { name: "TimeoutError" });
  },
});

type Page = BrowserScreenshotEvidence["state"] | "throws";

function sessionsShowing(page: Page): SessionFactoryHarness {
  const base = happySessionHarness();
  return { ...base, factory: { ...base.factory, async open(input) {
    const resource = await base.factory.open(input);
    return { ...resource, async screenshot(): Promise<BrowserScreenshotEvidence> {
      if (page === "throws") throw new Error("synthetic screenshot refusal");
      const evidence = { pageVersion: 1, sessionId: resource.sessionId, observedAt: "2026-08-29T08:00:00.000Z" } as const;
      return page === "available"
        ? { ...evidence, state: "available", bytes: new Uint8Array([137, 80, 78, 71]), width: 1280, height: 720 }
        : { ...evidence, state: "unavailable", reason: "page-closed" };
    } };
  } } };
}

async function runThrownStep(page: Page, notes: "saved" | "screenshot-refused" = "saved") {
  const services: ReturnType<typeof createDiagnosticCaptureService>[] = [];
  const h = await executorHarness({ sessions: sessionsShowing(page), stores: registryWithUcpathSearch(thrownTask),
    screenshotCapture: { capture: context => {
      const service = services[0];
      assert.ok(service, "the diagnostic capture service is wired before the run starts");
      return createRunBrowserScreenshotCapture({ service }).capture(context);
    } } });
  const { database, clock, profile } = h.authority;
  const artifacts = createContentAddressedArtifactWriter({ admission: profile.admission });
  await artifacts.ready;
  services.push(createDiagnosticCaptureService({ artifacts, authority: database.authority, clock, ids: sequentialIdFactory("d") }));
  const claimed = enqueueAndClaim(database, personLookupQueuedRun(), clock.now().toISOString());
  const writer = createNoteTimelineWriter({ repository: database.authority.timelineEvents, clock, pid: 4242 });
  const outcome = await executeClaimedRun({ ...h.deps, taskNotes: notes === "saved" ? writer : { ...writer, emitRunAction(input, run) {
    if (input.action.kind === "screenshot") throw new Error("synthetic Screenshot action persistence failure");
    return writer.emitRunAction(input, run);
  } } }, { ...claimed, signal: SIGNAL });
  const failure = database.authority.failures.listByRun(claimed.run.envelope.runId)[0];
  const stepCaptures = database.authority.timelineEvents.page({}).flatMap(event => event.payload.kind === "note"
    && event.payload.note.action?.kind === "screenshot" && event.payload.note.action.targetId === "ucpath.task-capture"
    ? [{ spanPath: event.payload.note.spanPath, value: event.payload.note.action.value }] : []);
  return { outcome, failure, stepCaptures, database, attempt: claimed.run.envelope.attempt };
}

describe("a task that throws", () => {
  it("records the page its step stopped on as that step's screenshot, beside the task's own failure", async () => {
    const { outcome, failure, stepCaptures, database, attempt } = await runThrownStep("available");
    assert.equal(outcome.state, "failed");
    assert.ok(failure);
    assert.equal(failure.code, "TASK_UNHANDLED_FAILURE");
    assert.match(failure.summary, /Timeout 30000ms exceeded/u);
    assert.deepEqual(failure.causeChain.map(({ code }) => code), ["TASK_UNHANDLED_FAILURE"]);
    assert.equal(stepCaptures.length, 1);
    const [capture] = stepCaptures;
    assert.match(capture?.spanPath ?? "", /\/searching#1/u);
    const [bundleId, artifactId] = typeof capture?.value === "string" ? capture.value.split(":") : [];
    const bundle = database.authority.diagnosticBundles.get(bundleId ?? "");
    assert.ok(bundle);
    assert.ok(bundle.attachments.some(attachment => attachment.artifactId === artifactId && attachment.kind === "screenshot"));
    const field = (key: string) => {
      const recorded = bundle.redaction.fields.find(candidate => candidate.key === key);
      return recorded?.transform === "allow" ? recorded.value : undefined;
    };
    assert.deepEqual([field("captureStage"), field("nodeId"), field("runAttempt")], ["task-point", "searching", attempt]);
  });

  it.each([
    { page: "unavailable" as const, reason: "page-closed" },
    { page: "throws" as const, reason: "Error" },
  ])("names why no screenshot was taken when the capture is refused ($reason)", async ({ page, reason }) => {
    const { outcome, failure, stepCaptures } = await runThrownStep(page);
    assert.equal(outcome.state, "failed");
    assert.ok(failure);
    assert.equal(failure.code, "TASK_UNHANDLED_FAILURE", "a refused capture never replaces the task's own failure");
    assert.ok(failure.debug?.causes.some(text => /^TimeoutError: .*Timeout 30000ms exceeded/u.test(text)), "the task's own error stays in the failure evidence");
    assert.deepEqual(failure.causeChain.slice(1), [{ code: "BROWSER_SCREENSHOT_CAPTURE_FAILED",
      summary: `Failure screenshot not taken: ${reason}`, role: "secondary", transient: false }]);
    assert.deepEqual(stepCaptures, []);
  });

  it("keeps the task's own failure when the run log refuses the failure screenshot", async () => {
    const { outcome, failure, stepCaptures } = await runThrownStep("available", "screenshot-refused");
    assert.equal(outcome.state, "failed");
    assert.ok(failure);
    assert.equal(failure.code, "TASK_UNHANDLED_FAILURE");
    assert.match(failure.summary, /Timeout 30000ms exceeded/u);
    assert.deepEqual(failure.causeChain.slice(1).map(({ code, summary }) => [code, summary]),
      [["BROWSER_SCREENSHOT_CAPTURE_FAILED", "Failure screenshot not saved to the run log"]]);
    assert.deepEqual(stepCaptures, []);
  });
});
