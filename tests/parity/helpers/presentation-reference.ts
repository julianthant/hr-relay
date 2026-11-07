import type { Page, TestInfo } from "@playwright/test";
import { resolve, basename } from "node:path";
import { captureParityPair } from "./capture.js";
import { FIXTURE_APP_VERSION, FIXTURE_DAY, FIXTURE_DESCRIPTOR_HASH } from "./fixture-identity.js";

/** Freezes an existing mock-state screenshot with its semantic tree and fixture provenance. */
export async function capturePresentationReference(page: Page, info: TestInfo, name: string, descriptorHash = FIXTURE_DESCRIPTOR_HASH): Promise<void> {
  const viewport = page.viewportSize();
  if (viewport === null) throw new Error("presentation-reference-viewport-missing");
  const attribute = await page.locator("[data-app-root]").getAttribute("data-demo-theme");
  if (attribute !== "dark" && attribute !== "light") throw new Error("presentation-reference-theme-missing");
  const captureId = basename(info.file, ".test.ts");
  const stateId = `${captureId}-${name.replace(/\.png$/u, "")}`.replace(/[^a-zA-Z0-9_.-]+/gu, "-");
  await page.evaluate(() => document.fonts.ready);
  // Frozen reference provenance keeps its existing fixture identifier.
  await captureParityPair(page, resolve("tests/parity/references"), {
    stateId, viewport: `${String(viewport.width)}x${String(viewport.height)}`,
    theme: attribute === "dark" ? "graphite-warm" : "paper-ink",
    adapter: "fixture", fixtureId: `${captureId}.spec.ts:${info.title}`,
    descriptorHash, appVersion: FIXTURE_APP_VERSION, capturedAt: FIXTURE_DAY, variant: "default",
  });
}

export async function attachPresentationReference(page: Page, info: TestInfo, name: string, descriptorHash = FIXTURE_DESCRIPTOR_HASH): Promise<void> {
  await capturePresentationReference(page, info, name, descriptorHash);
  const path = info.outputPath(name);
  await page.screenshot({ path, animations: "disabled" });
  await info.attach(name, { path, contentType: "image/png" });
}
