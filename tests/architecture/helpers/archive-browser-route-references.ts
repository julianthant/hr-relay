/**
 * DCA4 consumption proof: production parent → Evidence → capture → native href/src.
 * This observes DOM declarations, not image bytes, decode, layout, or shell reachability.
 */
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  ArchivedCaptureResourceWireSchema,
  type ArchivedCaptureResourceWire,
  type ArchivedRunDetailWire,
} from "../../../src/domain/dashboard/archive.js";
import { createDashboardQueries } from "../../../src/dashboard/client/queries.js";
import { createDashboardTransport } from "../../../src/dashboard/client/transport.js";
import { ArchivedRunDetail } from "../../../src/dashboard/surfaces/archive.js";
import { ToastProvider } from "../../../src/dashboard/ds/ui.js";
import type { ClientRouteReference } from "./wire-connectivity.js";

export interface ArchiveBrowserProbe {
  readonly detail: ArchivedRunDetailWire;
  /** An external response; the real query parser and hook must accept it. */
  readonly response: unknown;
  /** Test-only native-sink controls. Restore the exact nodes/attributes before React cleanup. */
  readonly beforeObservation?: (dialog: HTMLElement) => () => void;
}

function onlyButton(scope: ParentNode, name: string): HTMLButtonElement {
  const matches = [...scope.querySelectorAll("button")].filter((button) => button.textContent?.trim() === name);
  assert.equal(matches.length, 1, `Archive browser observation needs exactly one ${name} button`);
  const button = matches[0];
  assert.ok(button instanceof HTMLButtonElement, `Archive browser observation lost ${name}`);
  return button;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "a non-Error value was thrown";
}

export async function archiveBrowserRouteReferences(input: ArchiveBrowserProbe): Promise<readonly ClientRouteReference[]> {
  assert.equal(input.detail.sections.state, "present", "Archive browser probe requires frozen sections");
  if (input.detail.sections.state !== "present" || input.detail.sections.value.captures.state !== "present") {
    throw new Error("Archive browser probe requires a frozen capture");
  }
  const captures = input.detail.sections.value.captures.value;
  assert.equal(captures.length, 1, "Archive browser probe must name exactly one frozen capture");
  const capture = captures[0];
  assert.ok(capture, "Archive browser probe lost its frozen capture");
  const runId = input.detail.runId;
  const artifactId = capture.artifactId;
  const requested: { runId: string; artifactId: string; signal: AbortSignal | undefined }[] = [];
  const httpPaths: string[] = [];
  let returned: ArchivedCaptureResourceWire | undefined;
  let readError: unknown;
  const queries = createDashboardQueries(createDashboardTransport({
    baseUrl: "http://archive-wire.test",
    fetchImpl: async (url) => {
      httpPaths.push(url);
      return Response.json(input.response);
    },
  }));
  const read = async (requestedRun: string, requestedArtifact: string, signal?: AbortSignal) => {
    requested.push({ runId: requestedRun, artifactId: requestedArtifact, signal });
    try {
      const value = await queries.archivedCaptureResource(requestedRun, requestedArtifact, signal);
      returned = value;
      return value;
    } catch (error) {
      readError = error;
      throw error;
    }
  };

  const priorAct = Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  const priorChildren = [...document.body.childNodes];
  const host = document.createElement("div");
  let root: Root | undefined;
  let restoreControl: (() => void) | undefined;
  let references: readonly ClientRouteReference[] | undefined;
  const failures: unknown[] = [];
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  try {
    document.body.append(host);
    const mounted = createRoot(host);
    root = mounted;
    await act(async () => {
      mounted.render(createElement(ToastProvider, {
        children: createElement(ArchivedRunDetail, {
          detail: input.detail, sweep: undefined, codes: new Map<string, string>(),
          busy: false, relaunched: false, refusal: undefined,
          onRelaunch: () => { throw new Error("Archive browser probe must not relaunch"); },
          onDelete: () => { throw new Error("Archive browser probe must not delete"); },
          onDismiss: () => { throw new Error("Archive browser probe must not dismiss the parent"); },
          onReadCapture: read,
        }),
      }));
    });
    const tabs = [...host.querySelectorAll("button[role=tab]")].filter((tab) => tab.textContent?.startsWith("Evidence"));
    assert.equal(tabs.length, 1, "Archive browser observation cannot reach the Evidence tab");
    const evidenceTab = tabs[0];
    assert.ok(evidenceTab instanceof HTMLButtonElement, "Archive browser observation lost the Evidence tab");
    await act(async () => {
      evidenceTab.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
      evidenceTab.click();
    });
    await act(async () => { onlyButton(host, "What it was").click(); });

    assert.deepEqual(requested.map(({ runId: run, artifactId: artifact }) => ({ runId: run, artifactId: artifact })),
      [{ runId, artifactId }], "Archive parent requested a different capture identity");
    assert.deepEqual(httpPaths, [`http://archive-wire.test/api/v1/archive/${runId}/captures/${artifactId}/resource`],
      "Archive query did not request the exact resource path");
    const dialogs = document.querySelectorAll('[role="dialog"]');
    assert.equal(dialogs.length, 1, "Archive browser observation did not open exactly one capture dialog");
    const dialog = dialogs[0];
    assert.ok(dialog instanceof HTMLElement, "Archive browser observation lost the capture dialog");
    if (returned === undefined) {
      throw new Error(`Archive browser resource parse failed: ${dialog.textContent}`, { cause: readError });
    }
    assert.equal(returned.runId, runId, "Archive browser resource returned a foreign runId");
    assert.equal(returned.artifactId, artifactId, "Archive browser resource returned a foreign artifactId");
    assert.equal(returned.resource.state, "available", `Archive browser resource was refused: ${dialog.textContent}`);
    if (returned.resource.state !== "available") throw new Error("Archive browser resource is not available");
    const retainedUrl = returned.resource.downloadUrl;

    restoreControl = input.beforeObservation?.(dialog);
    const links = dialog.querySelectorAll("a[download][href]");
    const images = dialog.querySelectorAll("img[src]");
    assert.equal(links.length, 1, "Archive browser observation missing native download href sink");
    assert.equal(images.length, 1, "Archive browser observation missing native image src sink");
    const href = links[0]?.getAttribute("href");
    const src = images[0]?.getAttribute("src");
    assert.equal(typeof href, "string", "Archive native href is absent");
    assert.equal(typeof src, "string", "Archive native src is absent");
    // The strict same-pair schema validates each OBSERVED attribute, never a manufactured path.
    references = [href, src].map((path) => {
      ArchivedCaptureResourceWireSchema.parse({ runId, artifactId, resource: { state: "available", downloadUrl: path } });
      assert.equal(path, retainedUrl, "Archive native sink differs from the returned retained URL");
      assert.ok(typeof path === "string");
      return { file: "src/dashboard/surfaces/archive.tsx", path };
    });
  } catch (error) {
    failures.push(error);
  } finally {
    try { restoreControl?.(); } catch (error) { failures.push(error); }
    try { if (root !== undefined) await act(async () => { root?.unmount(); }); } catch (error) { failures.push(error); }
    host.remove();
    try {
      for (const request of requested) assert.equal(request.signal?.aborted, true, "Archive probe did not cancel its resource request on unmount");
      assert.deepEqual([...document.body.childNodes], priorChildren, "Archive probe leaked mounted DOM or a portal");
    } catch (error) { failures.push(error); }
    if (priorAct === undefined) Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    else Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", priorAct);
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, `Archive browser observation failed: ${failures.map(errorMessage).join("; ")}`);
  }
  assert.ok(references !== undefined, "Archive browser observation produced no result");
  return references;
}

import { SavedArchiveReport } from "../../../src/dashboard/surfaces/archive-report.js";
import { SavedArchiveFileWireSchema } from "../../../src/domain/dashboard/archive.js";
import { DashboardClientProvider } from "../../../src/dashboard/state/client-context.js";
import { createDashboardClient } from "../../../src/dashboard/client/index.js";
import { FIXTURE_SAVED_REPORT } from "../../parity/helpers/fixture-archive.js";

/** Generic saved files must reach a real native link, independently of historical capture viewers. */
export async function savedArchiveBrowserRouteReferences(beforeObservation?: (host: HTMLElement) => () => void): Promise<readonly ClientRouteReference[]> {
  const report = FIXTURE_SAVED_REPORT, digest = report.files[0].digest;
  const resource = { runId: report.runId, digest, resource: { state: "available", downloadUrl: `/artifacts/v1/archive/${report.runId}/files/${digest}` } };
  const paths: string[] = [];
  const client = createDashboardClient({ baseUrl: "http://saved-wire.test", fetchImpl: async url => { paths.push(url); return Response.json(resource); } });
  const host = document.createElement("div"); const previous = [...document.body.childNodes];
  const priorAct = Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  document.body.append(host); const root = createRoot(host); let restore: (() => void) | undefined;
  try {
    await act(async () => root.render(createElement(DashboardClientProvider, { client, children: createElement(SavedArchiveReport, { report }) })));
    assert.deepEqual(paths, [`http://saved-wire.test/api/v1/archive/reports/${report.runId}/files/${digest}`]);
    restore = beforeObservation?.(host);
    const links = host.querySelectorAll('section[aria-label="Retained attachments"] a[download][href]');
    assert.equal(links.length, 1, "saved report has no exact native download sink");
    const path = links[0].getAttribute("href");
    SavedArchiveFileWireSchema.parse({ runId: report.runId, digest, resource: { state: "available", downloadUrl: path } });
    assert.equal(path, resource.resource.downloadUrl);
    assert.equal(typeof path, "string");
    return [{ file: "src/dashboard/surfaces/archive-report.tsx", path: String(path) }];
  } finally {
    restore?.(); await act(async () => root.unmount()); host.remove();
    assert.deepEqual([...document.body.childNodes], previous);
    if (priorAct === undefined) Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    else Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", priorAct);
  }
}
