/** D292/D305: actual DashboardApp → native Logs/Preview → real query/parser → href/src.
 * DOM connectivity only; this does not prove HTTP byte serving, decode or geometry. */
import assert from "node:assert/strict";
import { ArtifactIdSchema, RunIdSchema } from "../../../../src/domain/ids.js";
import { RunDetailSectionResponseSchema, RunDetailWireSchema } from "../../../../src/domain/dashboard/run-detail.js";
import {
  CAPTURE_BASE_URL, captureButton, captureDialog, mountCaptureApp, pressCaptureControl,
} from "../../dashboard/fixtures/run-captures-app-fixture.js";
import type { ClientRouteReference } from "./wire-connectivity.js";

export interface RunCaptureBrowserProbe {
  readonly requestedRunId: string;
  readonly artifactId: string;
  readonly detail: unknown;
  readonly response: unknown;
  /** Restore exact native nodes/attributes before React cleanup. */
  readonly beforeObservation?: (dialog: HTMLElement) => () => void;
  /** A failure control in the mounted root's real effect cleanup. */
  readonly onUnmount?: () => void;
  readonly onMount?: () => void;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "non-Error failure";
}

export async function runCaptureBrowserRouteReferences(input: RunCaptureBrowserProbe): Promise<readonly ClientRouteReference[]> {
  const runId = RunIdSchema.parse(input.requestedRunId);
  const artifactId = ArtifactIdSchema.parse(input.artifactId);
  let app: Awaited<ReturnType<typeof mountCaptureApp>> | undefined;
  let restoreControl: (() => void) | undefined;
  let references: readonly ClientRouteReference[] | undefined;
  const failures: unknown[] = [];
  try {
    app = await mountCaptureApp({ runId, ...(input.onUnmount === undefined ? {} : { onUnmount: input.onUnmount }),
      ...(input.onMount === undefined ? {} : { onMount: input.onMount }),
      runs: new Map([[runId, { detail: () => input.detail, captures: () => Promise.resolve(Response.json(input.response)) }]]),
    });
    assert.deepEqual(app.requests.filter(request => request.url === `${CAPTURE_BASE_URL}/api/v1/runs/${runId}`).map(request => request.url),
      [`${CAPTURE_BASE_URL}/api/v1/runs/${runId}`], "Run capture app did not request its exact initial detail");
    assert.equal(RunDetailWireSchema.parse(input.detail).runId, runId, "Run capture initial detail returned a foreign runId");
    assert.deepEqual(app.requests.filter(request => request.url.endsWith("/captures")).map(request => request.url),
      [`${CAPTURE_BASE_URL}/api/v1/runs/${runId}/captures`],
      "Run capture app did not read captures on its active Logs section");
    const region = app.host.querySelector('[aria-label="Run captures"]');
    assert.ok(region instanceof HTMLElement, "Run capture app did not mount its Logs capture section");
    assert.deepEqual(app.requests.filter(request => request.url.endsWith("/captures")).map(request => request.url),
      [`${CAPTURE_BASE_URL}/api/v1/runs/${runId}/captures`], "Run capture app requested a different run or section");
    if (region.querySelector("a[download]") === null) {
      throw new Error(`Run capture app read refused: ${region.textContent}`);
    }
    // The real client already parsed this external response on the observed
    // request. Bind its served identities independently before crediting sinks.
    const returned = RunDetailSectionResponseSchema.parse(input.response);
    assert.equal(returned.section, "captures", "Run capture response named a different section");
    if (returned.section !== "captures") throw new Error("Run capture section mismatch");
    assert.equal(returned.payload.runId, runId, "Run capture response returned a foreign runId");
    assert.equal(returned.payload.artifacts.length, 1, "Run capture probe requires one exact artifact");
    assert.equal(returned.payload.artifacts[0]?.artifact.artifactId, artifactId, "Run capture response returned a foreign artifactId");
    await pressCaptureControl(captureButton(`Open capture ${artifactId}`, region));
    const dialog = captureDialog();
    restoreControl = input.beforeObservation?.(dialog);
    const links = dialog.querySelectorAll("a[download][href]");
    const images = dialog.querySelectorAll("img[src]");
    assert.equal(links.length, 1, "Run capture browser observation missing native download href sink");
    assert.equal(images.length, 1, "Run capture browser observation missing native image src sink");
    references = [links[0]?.getAttribute("href"), images[0]?.getAttribute("src")].map(raw => {
      assert.equal(raw, `${CAPTURE_BASE_URL}/artifacts/v1/${artifactId}`,
        "Run capture native sink must name its exact canonical generic artifact URL");
      assert.ok(typeof raw === "string");
      return { file: "src/dashboard/surfaces/run-captures.tsx", path: new URL(raw).pathname };
    });
  } catch (error) { failures.push(error); }
  finally {
    try { restoreControl?.(); } catch (error) { failures.push(error); }
    try { await app?.unmount(); } catch (error) { failures.push(error); }
    try {
      for (const request of app?.requests.filter(request => request.url.endsWith("/captures")) ?? []) {
        assert.equal(request.signal?.aborted, true, "Run capture app did not abort its owned read on unmount");
      }
    } catch (error) { failures.push(error); }
  }
  if (failures.length > 0) throw new AggregateError(failures, `Run capture browser observation failed: ${failures.map(message).join("; ")}`);
  assert.ok(references !== undefined, "Run capture browser observation produced no result");
  return references;
}
