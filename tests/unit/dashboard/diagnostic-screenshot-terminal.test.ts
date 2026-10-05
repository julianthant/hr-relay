// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { it, vi } from "vitest";
import { DiagnosticScreenshotGallery } from "../../../src/dashboard/surfaces/shared/run-evidence/diagnostic-screenshot.js";
import type { DiagnosticBundleWire } from "../../../src/domain/dashboard/diagnostic-bundle.js";
import { FIXTURE_DIAGNOSTIC_BUNDLE } from "../../parity/helpers/fixture-day.js";

it("retains the browser-only terminal warning, not a loading status, after closing during verification", async () => {
  // jsdom cannot measure intersection. Keep the thumbnail deferred and open
  // its lightbox explicitly; this test makes no geometry or decode claim.
  vi.stubGlobal("IntersectionObserver", class {
    observe(): void {}
    disconnect(): void {}
  });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const release = Promise.withResolvers<DiagnosticBundleWire>();
  let reads = 0;
  try {
    await act(async () => {
      root.render(createElement(DiagnosticScreenshotGallery, {
        bundle: FIXTURE_DIAGNOSTIC_BUNDLE,
        attachmentUrl: (id) => `http://fixture.test/attachments/${id}`,
        readBundle: (id) => {
          assert.equal(id, FIXTURE_DIAGNOSTIC_BUNDLE.bundleId);
          reads += 1;
          return release.promise;
        },
      }));
    });
    const trigger = host.querySelector<HTMLButtonElement>('button[aria-label="Open Diagnostic screenshot 1 of 1"]');
    assert.ok(trigger);
    await act(async () => { trigger.click(); });
    const image = document.querySelector('[role="dialog"] img');
    assert.ok(image);
    await act(async () => { image.dispatchEvent(new Event("error")); });
    assert.equal(reads, 1);
    assert.equal(document.querySelector('[role="dialog"] [role="status"]')?.textContent, "Verifying the stored screenshot attachment…");
    assert.equal(document.querySelectorAll('[role="dialog"] a[download]').length, 0);
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    assert.equal(document.querySelectorAll('[role="dialog"]').length, 0);
    await act(async () => { release.resolve(FIXTURE_DIAGNOSTIC_BUNDLE); });
    assert.equal(document.querySelectorAll('[role="dialog"]').length, 0);
    assert.match(trigger.textContent ?? "", /Screenshot preview could not be loaded/u);
    assert.notEqual(trigger.getAttribute("aria-busy"), "true");
    await act(async () => { trigger.click(); });

    const lightbox = document.querySelector('[role="dialog"]');
    assert.ok(lightbox);
    assert.equal(lightbox.querySelectorAll('[role="status"]').length, 1);
    const warning = lightbox.querySelector('[role="status"]');
    assert.ok(warning);
    assert.equal(warning.textContent, "Screenshot preview could not be loadedThe stored attachment verified, but this browser could not load or decode the image.");
    assert.doesNotMatch(lightbox.textContent ?? "", /Loading screenshot…|Verifying the stored screenshot attachment…/u);
    const download = lightbox.querySelector<HTMLAnchorElement>('a[download="diagnostic-screenshot-1.png"]');
    assert.ok(download);
    assert.equal(download.textContent, "Download screenshot");
    const screenshot = FIXTURE_DIAGNOSTIC_BUNDLE.contents.find((content) => content.kind === "screenshot");
    assert.ok(screenshot);
    assert.equal(download.href, `http://fixture.test/attachments/${screenshot.artifactId}`);
    assert.equal(reads, 1, "reopening must retain the terminal readback rather than request again");
  } finally {
    await act(async () => { root.unmount(); });
    host.remove();
    vi.unstubAllGlobals();
  }
});
