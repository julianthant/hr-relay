// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act } from "react";
import { afterEach, describe, it, vi } from "vitest";
import { RunEvidenceReceiptSchema } from "../../../src/domain/trust/evidence.js";
import { RUN_DETAIL_FOLLOW_SETTLE_MS } from "../../../src/dashboard/state/use-run-detail.js";
import {
  CAPTURE_RUN_A, CAPTURE_RUN_B, CAPTURE_ARTIFACT_A, CAPTURE_ARTIFACT_B, CAPTURE_BUNDLE_A, CAPTURE_BUNDLE_B,
  captureButton, captureData, captureDayRevision, captureDetail, captureDialog, captureImage, deferredResponse, mountCaptureApp, pressCaptureControl, signalImageLoad,
} from "./fixtures/run-captures-app-fixture.js";

let app: Awaited<ReturnType<typeof mountCaptureApp>> | undefined;
afterEach(async () => { await app?.unmount(); app = undefined; vi.useRealTimers(); });

describe("actual DashboardApp run captures", () => {
  it("shows verified capture controls in the Logs body before the Receipt is opened", async () => {
    app = await mountCaptureApp({ runId: CAPTURE_RUN_A, section: "logs", runs: new Map([[CAPTURE_RUN_A, {
      detail: () => captureDetail(), captures: () => Promise.resolve(Response.json({ section: "captures", payload: {
        runId: CAPTURE_RUN_A, artifacts: [captureImage()],
      } })),
    }]]) });
    const region = document.querySelector('[aria-label="Run captures"]');
    assert.ok(region, "Logs must mount the app-owned capture section");
    assert.ok(captureButton(`Open capture ${CAPTURE_ARTIFACT_A}`, region));
    assert.ok(region.querySelector(`a[download="capture-${CAPTURE_ARTIFACT_A}"]`));
    assert.equal(app.requests.filter(request => request.url.endsWith("/captures")).length, 1);
  });

  it("keeps a capture read refusal visible and keyboard-reachable in Logs", async () => {
    app = await mountCaptureApp({ runId: CAPTURE_RUN_A, section: "logs", runs: new Map([[CAPTURE_RUN_A, {
      detail: () => captureDetail(), captures: () => Promise.reject(new Error("Capture transport refused this read")),
    }]]) });
    const region = document.querySelector('[aria-label="Run captures"]');
    assert.match(region?.textContent ?? "", /Capture transport refused this read/u);
    assert.equal(region?.textContent?.includes("No captures"), false);
    const search = document.querySelector('input[aria-label="Search logs"]');
    assert.ok(search instanceof HTMLInputElement);
    search.focus();
    assert.equal(document.activeElement, search);
  });

  it("keeps current request failure local without manufacturing empty captures", async () => {
    app = await mountCaptureApp({ runId: CAPTURE_RUN_A, section: "receipt", runs: new Map([[CAPTURE_RUN_A, {
      detail: () => captureDetail(), captures: () => Promise.reject(new Error("Capture transport refused this read")),
    }]]) });
    const region = document.querySelector('[aria-label="Run captures"]');
    assert.match(region?.textContent ?? "", /Capture transport refused this read/u);
    assert.equal(region?.textContent?.includes("No captures"), false);
    assert.equal(region?.querySelector("a[download]"), null);
    assert.ok(captureButton("Logs"));
  });

  it("keeps PDF bytes download-only with their full declared page count", async () => {
    app = await mountCaptureApp({ runId: CAPTURE_RUN_A, section: "receipt", runs: new Map([[CAPTURE_RUN_A, {
      detail: () => captureDetail(), captures: () => Promise.resolve(Response.json({ section: "captures", payload: {
        runId: CAPTURE_RUN_A, artifacts: [{ ...captureData(), artifact: { ...captureData().artifact,
          mediaKind: "pdf", mediaType: "application/pdf", pageCount: 3 } }],
      } })),
    }]]) });
    const region = document.querySelector('[aria-label="Run captures"]');
    assert.ok(region);
    assert.match(region.textContent ?? "", /application\/pdf/u);
    assert.match(region.textContent ?? "", /Pages3/u);
    assert.equal(region.querySelector("img"), null);
    assert.equal(region.querySelector("button"), null);
    assert.equal(region.querySelector("a[download]")?.getAttribute("href"), `http://capture-app.test/artifacts/v1/${CAPTURE_ARTIFACT_A}`);
  });

  it("mounts JPEG Preview, JPEG Download, then data Download in receipt order", async () => {
    app = await mountCaptureApp({ runId: CAPTURE_RUN_A, section: "receipt", runs: new Map([[CAPTURE_RUN_A, {
      detail: () => captureDetail(CAPTURE_RUN_A, { captures: { state: "available", artifactCount: 2 } }),
      captures: () => Promise.resolve(Response.json({ section: "captures", payload: {
        runId: CAPTURE_RUN_A, artifacts: [captureImage(), { ...captureData(CAPTURE_ARTIFACT_B),
          origins: [{ bundleId: CAPTURE_BUNDLE_B, originKind: "operator-request" }] }],
      } })),
    }]]) });
    const region = document.querySelector('[aria-label="Run captures"]');
    assert.ok(region);
    assert.deepEqual([...region.querySelectorAll("button, a[download]")].map(control => ({
      href: control.getAttribute("href"),
      name: control.getAttribute("aria-label") ?? control.textContent?.trim(),
      tag: control.tagName,
    })), [
      { href: null, name: `Open capture ${CAPTURE_ARTIFACT_A}`, tag: "BUTTON" },
      { href: `http://capture-app.test/artifacts/v1/${CAPTURE_ARTIFACT_A}`, name: "Download", tag: "A" },
      { href: `http://capture-app.test/artifacts/v1/${CAPTURE_ARTIFACT_B}`, name: "Download", tag: "A" },
    ]);
  });

  it.each(["run", "revision"])("closes selection when its %s is replaced and does not reopen it", async replacement => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let revision = 1;
    app = await mountCaptureApp({ runId: CAPTURE_RUN_A, section: "receipt", runs: new Map([[CAPTURE_RUN_A, {
      detail: () => captureDetail(CAPTURE_RUN_A, { rowRevision: revision }),
      captures: () => Promise.resolve(Response.json({ section: "captures", payload: { runId: CAPTURE_RUN_A, artifacts: [captureImage()] } })),
    }]]) });
    await pressCaptureControl(captureButton(`Open capture ${CAPTURE_ARTIFACT_A}`));
    assert.ok(captureDialog());
    if (replacement === "revision") {
      revision = 2;
      await app.publishDay(captureDayRevision(CAPTURE_RUN_A, revision));
      await act(async () => { await vi.advanceTimersByTimeAsync(RUN_DETAIL_FOLLOW_SETTLE_MS); });
    } else {
      await app.navigate(undefined);
      assert.equal([...document.querySelectorAll('[role="dialog"]')].some(node => node.querySelector('h2')?.textContent === 'Run capture'), false, 'The exact capture dialog must close');
      await app.navigate(CAPTURE_RUN_A);
    }
    assert.equal([...document.querySelectorAll('[role="dialog"]')].some(node => node.querySelector('h2')?.textContent === 'Run capture'), false, 'The exact capture dialog must close');
    assert.ok(captureButton(`Open capture ${CAPTURE_ARTIFACT_A}`));
    assert.equal(app.requests.filter(request => request.url.endsWith("/captures")).length, 2);
  });

  it.each(["resolve", "reject"])("keeps current revision success when its preceding read later %ss", async late => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const old = deferredResponse();
    let revision = 1;
    let reads = 0;
    app = await mountCaptureApp({ runId: CAPTURE_RUN_A, section: "receipt", runs: new Map([[CAPTURE_RUN_A, {
      detail: () => captureDetail(CAPTURE_RUN_A, { rowRevision: revision }), captures: () => {
        reads += 1;
        return reads === 1 ? old.promise : Promise.resolve(Response.json({ section: "captures", payload: {
          runId: CAPTURE_RUN_A, artifacts: [captureData(CAPTURE_ARTIFACT_B)],
        } }));
      },
    }]]) });
    const oldSignal = app.requests.find(request => request.url.endsWith("/captures"))?.signal;
    revision = 2;
    await app.publishDay(captureDayRevision(CAPTURE_RUN_A, revision));
    await act(async () => { await vi.advanceTimersByTimeAsync(RUN_DETAIL_FOLLOW_SETTLE_MS); });
    assert.equal(oldSignal?.aborted, true);
    const before = document.querySelector('[aria-label="Run captures"]')?.textContent;
    assert.ok(before?.includes(CAPTURE_ARTIFACT_B));
    await act(async () => {
      if (late === "resolve") old.resolve(Response.json({ section: "captures", payload: { runId: CAPTURE_RUN_A, artifacts: [captureData()] } }));
      else old.reject(new Error("Old revision rejected after current success"));
    });
    assert.equal(reads, 2);
    assert.equal(document.querySelector('[aria-label="Run captures"]')?.textContent, before);
  });

  it.each(["resolve", "reject"])("keeps a reopened image ready when the detached decoder later %ss", async late => {
    app = await mountCaptureApp({ runId: CAPTURE_RUN_A, section: "receipt", runs: new Map([[CAPTURE_RUN_A, {
      detail: () => captureDetail(), captures: () => Promise.resolve(Response.json({ section: "captures",
        payload: { runId: CAPTURE_RUN_A, artifacts: [captureImage()] } })),
    }]]) });
    const opener = captureButton(`Open capture ${CAPTURE_ARTIFACT_A}`);
    await pressCaptureControl(opener);
    const oldImage = captureDialog().querySelector("img");
    assert.ok(oldImage instanceof HTMLImageElement);
    let resolveOld!: () => void;
    let rejectOld!: (error: Error) => void;
    const oldDecode = new Promise<void>((resolve, reject) => { resolveOld = resolve; rejectOld = reject; });
    await signalImageLoad(oldImage, () => oldDecode);
    await pressCaptureControl(captureButton("Close", captureDialog()));
    // Radix schedules focus restoration after its unmount auto-focus event.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    assert.equal(document.activeElement === opener, true, "Close returns focus to the exact opener");
    await pressCaptureControl(opener);
    const dialog = captureDialog();
    const currentImage = dialog.querySelector("img");
    assert.ok(currentImage instanceof HTMLImageElement);
    assert.equal(currentImage === oldImage, false);
    assert.equal(dialog.textContent?.includes("Image decoded"), false);
    await signalImageLoad(currentImage, () => Promise.resolve());
    assert.equal(dialog.textContent?.includes("Image decoded"), true);
    await act(async () => {
      if (late === "resolve") resolveOld();
      else rejectOld(new Error("Detached decoder refused"));
    });
    assert.equal(dialog.textContent?.includes("Image decoded"), true);
    assert.equal(dialog.textContent?.includes("Capture image could not be displayed"), false);
    await act(async () => { currentImage.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    assert.equal(document.activeElement === opener, true, "Escape returns focus to the exact opener");
    assert.equal([...document.querySelectorAll('[role="dialog"]')].some(node => node.querySelector('h2')?.textContent === 'Run capture'), false, 'The exact capture dialog must close');
  });

  it("closes the selected capture on run replacement even when the artifact id is shared", async () => {
    app = await mountCaptureApp({ runId: CAPTURE_RUN_A, section: "receipt", runs: new Map(
      [CAPTURE_RUN_A, CAPTURE_RUN_B].map(runId => [runId, {
        detail: () => captureDetail(runId), captures: () => Promise.resolve(Response.json({ section: "captures",
          payload: { runId, artifacts: [captureImage()] } })),
      }]),
    ) });
    await pressCaptureControl(captureButton(`Open capture ${CAPTURE_ARTIFACT_A}`));
    assert.ok(captureDialog());
    await app.navigate(CAPTURE_RUN_B);
    assert.equal([...document.querySelectorAll('[role="dialog"]')].some(node => node.querySelector('h2')?.textContent === 'Run capture'), false, 'The exact capture dialog must close');
    assert.equal(app.requests.filter(request => request.url.endsWith(`/${CAPTURE_RUN_B}/captures`)).length, 1,
      "previous detail must not launch a speculative second request for the new route");
  });
  it("opens legacy Receipt selection as Logs without reading the full receipt or creating a Screenshots tab", async () => {
    const value = RunEvidenceReceiptSchema.parse({
      receiptId: "00000000-0000-4000-8000-000000000730", runId: CAPTURE_RUN_A,
      traceId: "fw-100001-0000", workflowId: "fixture-workflow", attempt: 1,
      generatedAt: "2026-08-30T18:00:00.000Z", descriptorFingerprint: "a".repeat(64), configFingerprint: "b".repeat(64),
      retryOf: { state: "absent" }, failure: { state: "absent" }, input: [], observations: [], decisions: [],
      actions: [], verification: [], output: [], reuse: [], warnings: [], confidence: "partial", result: "partial",
    });
    app = await mountCaptureApp({ runId: CAPTURE_RUN_A, section: "receipt", runs: new Map([[CAPTURE_RUN_A, {
      detail: () => captureDetail(CAPTURE_RUN_A, { header: { ...captureDetail().header, status: "partial" }, outcome: { state: "terminal", result: "partial", completedAt: "2026-08-30T18:00:00.000Z" } }),
      receipt: () => ({ state: "available", value }),
      captures: () => Promise.resolve(Response.json({ section: "captures", payload: { runId: CAPTURE_RUN_A, artifacts: [captureData()] } })),
    }]]) });
    assert.match(document.body.textContent ?? "", /partial/iu);
    assert.ok(!document.body.textContent?.includes(String(value.receiptId)));
    assert.equal(app.requests.filter(request => request.url.endsWith("/receipt")).length, 0);
    assert.ok(document.querySelector('[aria-label="Run captures"] a[download]'));
    assert.deepEqual([...document.querySelectorAll('[role="tab"]')].map(node => node.textContent?.trim()), ["Logs"]);
  });

  it.each(["unexpected-state", "subject-mismatch", "recovery-park", "operator-request"])(
    "does not frame %s as failure even when the run failed", async originKind => {
      const detail = captureDetail();
      app = await mountCaptureApp({ runId: CAPTURE_RUN_A, section: "receipt", runs: new Map([[CAPTURE_RUN_A, {
        detail: () => captureDetail(CAPTURE_RUN_A, { header: { ...detail.header, status: "failed" },
          outcome: { state: "terminal", result: "failed", completedAt: "2026-08-30T18:00:00.000Z" } }),
        captures: () => Promise.resolve(Response.json({ section: "captures", payload: { runId: CAPTURE_RUN_A,
          artifacts: [{ ...captureImage(), origins: [{ bundleId: CAPTURE_BUNDLE_A, originKind }] }] } })),
      }]]) });
      const tile = document.querySelector('[aria-label="Run captures"] article');
      assert.ok(tile instanceof HTMLElement);
      await pressCaptureControl(captureButton(`Open capture ${CAPTURE_ARTIFACT_A}`));
      const dialog = captureDialog();
      const frame = dialog.querySelector("figure");
      assert.ok(frame instanceof HTMLElement);
      for (const element of [tile, frame]) {
        assert.equal(element.classList.contains("border-[color:var(--ds-danger)]"), false);
        assert.equal(element.classList.contains("border-[color:var(--ds-border)]"), true);
      }
      assert.ok(dialog.textContent?.includes(originKind));
    },
  );

  it.each(["load error", "decode rejection", "synchronous decoder refusal", "zero dimensions"])("retains metadata and download through %s", async failure => {
    app = await mountCaptureApp({ runId: CAPTURE_RUN_A, section: "receipt", runs: new Map([[CAPTURE_RUN_A, {
      detail: () => captureDetail(), captures: () => Promise.resolve(Response.json({ section: "captures",
        payload: { runId: CAPTURE_RUN_A, artifacts: [captureImage()] } })),
    }]]) });
    await pressCaptureControl(captureButton(`Open capture ${CAPTURE_ARTIFACT_A}`));
    const dialog = captureDialog();
    const image = dialog.querySelector("img");
    assert.ok(image instanceof HTMLImageElement);
    const initialStructure = dialog.querySelector("figure")?.getAttribute("style");
    if (failure === "load error") await act(async () => { image.dispatchEvent(new Event("error")); });
    else if (failure === "decode rejection") await signalImageLoad(image, () => Promise.reject(new Error("synthetic decoder refusal")));
    else if (failure === "synchronous decoder refusal") await signalImageLoad(image, () => { throw new Error("synthetic synchronous decoder refusal"); });
    else await signalImageLoad(image, () => Promise.resolve(), 0, 0);
    assert.match(dialog.textContent ?? "", /Capture image could not be displayed/u);
    assert.equal(dialog.textContent?.includes("Image decoded"), false);
    assert.match(dialog.textContent ?? "", /320 × 240/u);
    assert.ok(dialog.textContent?.includes("c".repeat(64)));
    assert.ok(dialog.querySelector("a[download]"));
    assert.equal(dialog.querySelector("figure")?.getAttribute("style"), initialStructure, "DOM frame declarations stay stationary; browser geometry is separate proof");
  });

  it("keeps a same-image load error authoritative after its pending decoder resolves", async () => {
    app = await mountCaptureApp({ runId: CAPTURE_RUN_A, section: "receipt", runs: new Map([[CAPTURE_RUN_A, {
      detail: () => captureDetail(), captures: () => Promise.resolve(Response.json({ section: "captures",
        payload: { runId: CAPTURE_RUN_A, artifacts: [captureImage()] } })),
    }]]) });
    await pressCaptureControl(captureButton(`Open capture ${CAPTURE_ARTIFACT_A}`));
    const dialog = captureDialog();
    const image = dialog.querySelector("img");
    assert.ok(image instanceof HTMLImageElement);
    let complete!: () => void;
    const pendingDecode = new Promise<void>(resolve => { complete = resolve; });
    let decoderInvoked = false;
    await signalImageLoad(image, () => { decoderInvoked = true; return pendingDecode; });
    assert.equal(decoderInvoked, true, "the same mounted image must own a pending decoder before its load error");

    await act(async () => { image.dispatchEvent(new Event("error")); });
    assert.match(dialog.textContent ?? "", /Capture image could not be displayed/u);
    assert.equal(dialog.textContent?.includes("Image decoded"), false);
    assert.equal(dialog.querySelector("img"), image, "the error oracle must retain the same mounted image");

    await act(async () => { complete(); await pendingDecode; });
    assert.match(dialog.textContent ?? "", /Capture image could not be displayed/u);
    assert.equal(dialog.textContent?.includes("Image decoded"), false,
      "an earlier decoder completion must not override the same image's later load error");
    assert.equal(image.src, `http://capture-app.test/artifacts/v1/${CAPTURE_ARTIFACT_A}`);
    assert.match(dialog.textContent ?? "", /320 × 240/u);
    assert.ok(dialog.textContent?.includes("c".repeat(64)));
    assert.equal(dialog.querySelector("a[download]")?.getAttribute("href"),
      `http://capture-app.test/artifacts/v1/${CAPTURE_ARTIFACT_A}`);
  });

  it.each(["wrong section", "foreign run", "empty list", "missing origins"])("renders a local refusal for %s through the actual parser", async fault => {
    const valid = { section: "captures", payload: { runId: CAPTURE_RUN_A, artifacts: [captureData()] } };
    const responses: Record<string, unknown> = {
      "wrong section": { section: "context-attempts", payload: { runId: CAPTURE_RUN_A, entries: [] } },
      "foreign run": { ...valid, payload: { ...valid.payload, runId: CAPTURE_RUN_B } },
      "empty list": { ...valid, payload: { ...valid.payload, artifacts: [] } },
      "missing origins": { ...valid, payload: { ...valid.payload, artifacts: [{ artifact: captureData().artifact }] } },
    };
    app = await mountCaptureApp({ runId: CAPTURE_RUN_A, section: "receipt", runs: new Map([[CAPTURE_RUN_A, {
      detail: () => captureDetail(), captures: () => Promise.resolve(Response.json(responses[fault])),
    }]]) });
    const region = document.querySelector('[aria-label="Run captures"]');
    assert.ok(region);
    assert.match(region.textContent ?? "", /Captures could not be read/u);
    assert.equal(region.querySelector("a[download]"), null);
    assert.equal(region.textContent?.includes("No captures"), false);
    assert.ok(captureButton("Logs"));
  });

  it.each(["resolve", "reject"])("keeps current run success when a replaced run later %ss", async late => {
    const old = deferredResponse();
    app = await mountCaptureApp({ runId: CAPTURE_RUN_A, section: "receipt", runs: new Map([
      [CAPTURE_RUN_A, { detail: () => captureDetail(), captures: () => old.promise }],
      [CAPTURE_RUN_B, { detail: () => captureDetail(CAPTURE_RUN_B), captures: () => Promise.resolve(Response.json({
        section: "captures", payload: { runId: CAPTURE_RUN_B, artifacts: [captureData(CAPTURE_ARTIFACT_B)] },
      })) }],
    ]) });
    const oldSignal = app.requests.find(request => request.url.endsWith(`/${CAPTURE_RUN_A}/captures`))?.signal;
    assert.ok(oldSignal);
    await app.navigate(CAPTURE_RUN_B);
    assert.equal(oldSignal.aborted, true);
    const before = document.querySelector('[aria-label="Run captures"]')?.textContent;
    assert.ok(before?.includes(CAPTURE_ARTIFACT_B));
    await act(async () => {
      if (late === "resolve") old.resolve(Response.json({ section: "captures", payload: { runId: CAPTURE_RUN_A, artifacts: [captureData()] } }));
      else old.reject(new Error("Old request rejected after current success"));
    });
    assert.equal(document.querySelector('[aria-label="Run captures"]')?.textContent, before);
    assert.equal(document.querySelector('[aria-label="Run captures"] a')?.getAttribute("href"), `http://capture-app.test/artifacts/v1/${CAPTURE_ARTIFACT_B}`);
  });

  it.each(["resolve", "reject"])("keeps one app-owned read when a legacy Receipt selection opens Logs and later %ss", async late => {
    const old = deferredResponse();
    let visits = 0;
    app = await mountCaptureApp({ runId: CAPTURE_RUN_A, section: "receipt", runs: new Map([[CAPTURE_RUN_A, {
      detail: () => captureDetail(), captures: () => {
        visits += 1;
        return visits === 1 ? old.promise : Promise.resolve(Response.json({ section: "captures", payload: {
          runId: CAPTURE_RUN_A, artifacts: [captureData(CAPTURE_ARTIFACT_B)],
        } }));
      },
    }]]) });
    const oldSignal = app.requests.find(request => request.url.endsWith("/captures"))?.signal;
    await pressCaptureControl(captureButton("Logs"));
    assert.equal(oldSignal?.aborted, false);
    assert.ok(document.querySelector('[aria-label="Run captures"]'));
    await act(async () => {
      if (late === "resolve") old.resolve(Response.json({ section: "captures", payload: { runId: CAPTURE_RUN_A, artifacts: [captureData()] } }));
      else old.reject(new Error("Current capture request rejected"));
    });
    const before = document.querySelector('[aria-label="Run captures"]')?.textContent;
    assert.ok(before?.includes(late === "resolve" ? CAPTURE_ARTIFACT_A : "Current capture request rejected"));
    await pressCaptureControl(captureButton("Logs"));
    assert.equal(visits, 1);
    assert.equal(document.querySelector('[aria-label="Run captures"]')?.textContent, before);
  });

  it("aborts its pending read on whole-app unmount", async () => {
    const pending = deferredResponse();
    app = await mountCaptureApp({ runId: CAPTURE_RUN_A, section: "receipt", runs: new Map([[CAPTURE_RUN_A, {
      detail: () => captureDetail(), captures: () => pending.promise,
    }]]) });
    const signal = app.requests.find(request => request.url.endsWith("/captures"))?.signal;
    assert.ok(signal);
    await app.unmount(); app = undefined;
    assert.equal(signal.aborted, true);
    pending.reject(new Error("Settled after unmount"));
    await Promise.resolve();
  });
  it("refuses decoded dimensions that disagree with the exact served image metadata", async () => {
    app = await mountCaptureApp({ runId: CAPTURE_RUN_A, section: "receipt", runs: new Map([[CAPTURE_RUN_A, {
      detail: () => captureDetail(), captures: () => Promise.resolve(Response.json({ section: "captures",
        payload: { runId: CAPTURE_RUN_A, artifacts: [captureImage()] } })),
    }]]) });
    await pressCaptureControl(captureButton(`Open capture ${CAPTURE_ARTIFACT_A}`));
    const dialog = captureDialog();
    const image = dialog.querySelector("img");
    assert.ok(image instanceof HTMLImageElement);
    await signalImageLoad(image, () => Promise.resolve(), 319, 240);
    assert.match(dialog.textContent ?? "", /Capture image could not be displayed/u);
    assert.equal(dialog.textContent?.includes("Image decoded"), false);
    assert.match(dialog.textContent ?? "", /320 × 240/u);
    assert.ok(dialog.querySelector("a[download]"));
  });
  it.each(["tile", "preview"])("frames %s with the exact solid danger token only for literal failure while preserving all mixed origins", async target => {
    const origins = [
      { bundleId: CAPTURE_BUNDLE_A, originKind: "operator-request" },
      { bundleId: CAPTURE_BUNDLE_B, originKind: "failure" },
      { bundleId: "00000000-0000-4000-8000-000000000723", originKind: "unexpected-state" },
      { bundleId: "00000000-0000-4000-8000-000000000724", originKind: "subject-mismatch" },
      { bundleId: "00000000-0000-4000-8000-000000000725", originKind: "recovery-park" },
    ];
    const expectedOriginRows = [
      `operator-request · ${CAPTURE_BUNDLE_A}`,
      `failure · ${CAPTURE_BUNDLE_B}`,
      "unexpected-state · 00000000-0000-4000-8000-000000000723",
      "subject-mismatch · 00000000-0000-4000-8000-000000000724",
      "recovery-park · 00000000-0000-4000-8000-000000000725",
    ];
    app = await mountCaptureApp({ runId: CAPTURE_RUN_A, section: "receipt", runs: new Map([[CAPTURE_RUN_A, {
      detail: () => captureDetail(),
      captures: () => Promise.resolve(Response.json({ section: "captures", payload: { runId: CAPTURE_RUN_A,
        artifacts: [{ ...captureImage(), origins }] } })),
    }]]) });
    const tile = document.querySelector('[aria-label="Run captures"] article');
    assert.ok(tile instanceof HTMLElement);
    await pressCaptureControl(captureButton(`Open capture ${CAPTURE_ARTIFACT_A}`));
    const dialog = captureDialog();
    const frame = dialog.querySelector("figure");
    assert.ok(frame instanceof HTMLElement);
    assert.ok((target === "tile" ? tile : frame).classList.contains("border-[color:var(--ds-danger)]"),
      `literal failure must frame the ${target} with the exact solid danger token`);
    const scope = target === "tile" ? tile : dialog;
    assert.deepEqual(
      [...scope.querySelectorAll('ul[aria-label="Capture origins"] > li')].map(row => row.textContent?.trim()),
      expectedOriginRows,
      `the ${target} must bind every origin kind to its exact supporting bundle`,
    );
  });
  it("opens the exact native image and waits for its decoder before exposing readiness", async () => {
    app = await mountCaptureApp({ runId: CAPTURE_RUN_A, section: "receipt", runs: new Map([[CAPTURE_RUN_A, {
      detail: () => captureDetail(),
      captures: () => Promise.resolve(Response.json({ section: "captures", payload: { runId: CAPTURE_RUN_A, artifacts: [captureImage()] } })),
    }]]) });
    await pressCaptureControl(captureButton(`Open capture ${CAPTURE_ARTIFACT_A}`));
    const dialog = [...document.querySelectorAll('[role="dialog"]')].find(node => node.querySelector("h2")?.textContent === "Run capture");
    assert.ok(dialog, `Expected named Run capture dialog; mounted dialog headings: ${[...document.querySelectorAll('[role="dialog"] h2')].map(node => node.textContent).join(", ")}`);
    const image = dialog.querySelector("img");
    assert.ok(image instanceof HTMLImageElement);
    assert.equal(image.src, `http://capture-app.test/artifacts/v1/${CAPTURE_ARTIFACT_A}`);
    assert.equal(image.getAttribute("width"), "320");
    assert.equal(image.getAttribute("height"), "240");
    assert.equal(image.getAttribute("loading"), "eager");
    assert.ok(image.classList.contains("object-contain"));
    assert.equal(dialog.querySelector('[role="status"]')?.textContent, "Loading capture image…");
    assert.equal(dialog.textContent?.includes("Image decoded"), false);
    let complete!: () => void;
    const decode = new Promise<void>(resolve => { complete = resolve; });
    let invoked = false;
    await signalImageLoad(image, () => { invoked = true; return decode; });
    assert.equal(invoked, true);
    assert.equal(dialog.textContent?.includes("Image decoded"), false, "load is not decode completion");
    await act(async () => { complete(); });
    assert.equal(dialog.textContent?.includes("Image decoded"), true);
    assert.equal(image.getAttribute("aria-hidden"), null);
    assert.ok(dialog.querySelector('a[download]') instanceof HTMLAnchorElement);
  });
  it("refuses available captures without their advertised lazy section", async () => {
    app = await mountCaptureApp({ runId: CAPTURE_RUN_A, section: "receipt", runs: new Map([[CAPTURE_RUN_A, {
      detail: () => captureDetail(CAPTURE_RUN_A, { availableSections: ["logs", "receipt"] }),
      captures: () => Promise.resolve(Response.json({ section: "captures", payload: { runId: CAPTURE_RUN_A, artifacts: [captureData()] } })),
    }]]) });
    assert.equal(app.requests.filter(request => request.url.endsWith("/captures")).length, 0,
      "an unadvertised section must not be fetched");
    assert.match(document.querySelector('[aria-label="Run captures"]')?.textContent ?? "", /Capture availability and section advertisement disagree/u);
  });
  it("refuses a list whose count differs from the requested detail availability", async () => {
    app = await mountCaptureApp({ runId: CAPTURE_RUN_A, section: "receipt", runs: new Map([[CAPTURE_RUN_A, {
      detail: () => captureDetail(CAPTURE_RUN_A, { captures: { state: "available", artifactCount: 2 } }),
      captures: () => Promise.resolve(Response.json({ section: "captures", payload: {
        runId: CAPTURE_RUN_A, artifacts: [captureData()],
      } })),
    }]]) });
    const region = document.querySelector('[aria-label="Run captures"]');
    assert.ok(region);
    assert.match(region.textContent ?? "", /Capture count does not match/u);
    assert.equal(region.querySelector("a[download]"), null);
  });
  it("keeps an authority availability error local and visible without fetching", async () => {
    app = await mountCaptureApp({ runId: CAPTURE_RUN_A, section: "receipt", runs: new Map([[CAPTURE_RUN_A, {
      detail: () => captureDetail(CAPTURE_RUN_A, { captures: { state: "error", code: "DIAGNOSTIC_BUNDLE_CORRUPT",
        message: "Capture index verification refused", retryable: false }, availableSections: ["logs", "receipt"] }),
      captures: () => { throw new Error("availability error must not fetch"); },
    }]]) });
    const region = document.querySelector('[aria-label="Run captures"]');
    assert.ok(region);
    assert.match(region.textContent ?? "", /DIAGNOSTIC_BUNDLE_CORRUPT.*Capture index verification refused/u);
    assert.equal(app.requests.filter(request => request.url.endsWith("/captures")).length, 0);
    assert.ok(captureButton("Logs"));
  });
  it("refuses missing live availability instead of treating archived compatibility as an empty list", async () => {
    const { captures: _legacyOmission, ...legacyDetail } = captureDetail();
    app = await mountCaptureApp({ runId: CAPTURE_RUN_A, section: "receipt", runs: new Map([[CAPTURE_RUN_A, {
      detail: () => legacyDetail,
      captures: () => { throw new Error("missing availability must not fetch"); },
    }]]) });
    const region = document.querySelector('[aria-label="Run captures"]');
    assert.ok(region);
    assert.match(region.textContent ?? "", /Live capture availability is missing/u);
    assert.ok(region.textContent?.includes(CAPTURE_RUN_A));
    assert.equal(app.requests.filter(request => request.url.endsWith("/captures")).length, 0);
  });
  it("downloads the exact non-image capture in Logs and retains every origin and byte fact", async () => {
    app = await mountCaptureApp({ runId: CAPTURE_RUN_A, runs: new Map([[CAPTURE_RUN_A, {
      detail: () => captureDetail(),
      captures: () => Promise.resolve(Response.json({ section: "captures", payload: {
        runId: CAPTURE_RUN_A, artifacts: [captureData()],
      } })),
    }]]) });
    assert.equal(app.requests.filter(request => request.url.endsWith("/captures")).length, 1);
    await pressCaptureControl(captureButton("Logs"));
    const region = document.querySelector('[aria-label="Run captures"]');
    assert.ok(region);
    const link = region.querySelector("a[download]");
    assert.ok(link instanceof HTMLAnchorElement, "Logs must consume the native artifact URL");
    assert.equal(link.href, `http://capture-app.test/artifacts/v1/${CAPTURE_ARTIFACT_A}`);
    assert.equal(link.download, `capture-${CAPTURE_ARTIFACT_A}`);
    for (const value of [CAPTURE_ARTIFACT_A, CAPTURE_BUNDLE_A, CAPTURE_BUNDLE_B,
      "unexpected-state", "operator-request", "application/json", "2 bytes", "b".repeat(64),
      "restricted", "restricted-access"]) assert.ok(region.textContent?.includes(value), `missing served fact: ${value}`);
    assert.match(region.textContent ?? "", /Restricted capture/u);
    assert.equal(region.querySelector("img"), null, "non-image bytes are download-only");
    assert.equal(app.requests.filter(request => request.url.endsWith("/captures")).length, 1);
    assert.equal(app.requests.filter(request => request.url.endsWith("/receipt")).length, 0);
  });
  it("shows the served absence in Logs without speculative capture or retired Receipt reads", async () => {
    app = await mountCaptureApp({ runId: CAPTURE_RUN_A, runs: new Map([[CAPTURE_RUN_A, {
      detail: () => captureDetail(CAPTURE_RUN_A, {
        captures: { state: "absent", reason: "No indexed diagnostic artifacts for this run" },
        availableSections: ["logs", "receipt"],
      }),
      captures: () => { throw new Error("absent captures must not be fetched"); },
    }]]) });
    const region = document.querySelector('[aria-label="Run captures"]');
    assert.ok(region, "Logs must mount the app-owned captures surface");
    assert.match(region.textContent ?? "", /No indexed diagnostic artifacts for this run/u);
    const search = document.querySelector('input[aria-label="Search logs"]');
    assert.ok(search instanceof HTMLInputElement);
    search.focus();
    assert.equal(document.activeElement, search);
    assert.equal(app.requests.filter(request => request.url.endsWith("/captures")).length, 0);
    await pressCaptureControl(captureButton("Logs"));
    const receiptRegion = document.querySelector('[aria-label="Run captures"]');
    assert.ok(receiptRegion, "Logs must retain its canonical captures surface");
    assert.match(receiptRegion.textContent ?? "", /No indexed diagnostic artifacts for this run/u);
    assert.equal(app.requests.filter(request => request.url.endsWith("/captures")).length, 0);
    assert.equal(app.requests.filter(request => request.url.endsWith("/receipt")).length, 0);
  });
});
