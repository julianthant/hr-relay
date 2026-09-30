/** D292 captures in Logs, including historical Receipt URL compatibility. */
import { expect,test,type Locator,type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { RunDetailWireSchema } from "../../src/domain/dashboard/run-detail.js";
import { gotoAppState } from "./helpers/app-driver.js";
import { ensureParityBundle,PARITY_DIST_DIR } from "./helpers/bundle.js";
import { assertThemeApplied,installTheme } from "./helpers/capture.js";
import { startFixtureServer,type FixtureServer } from "./helpers/fixture-bff.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";
import { FIXTURE_IDS } from "./helpers/fixture-queue.js";
import {
FIXTURE_RUN_CAPTURE_SECTIONS,
RUN_CAPTURE_FIXTURE_IDS,
} from "./helpers/fixture-run-captures.js";

const EXPECTED_FULL_RECEIPT_ID = "00000000-0000-4000-8000-00000000c201";
const EXPECTED_DOWNLOADS: Readonly<Record<string, { readonly bytes: number; readonly sha256: string }>> = {
  [RUN_CAPTURE_FIXTURE_IDS.png]: { bytes: 180, sha256: "2fee9676d26f3e8f25514ae9c8a2f1465f9b6059022086277c0e7459d7a41a91" },
  [RUN_CAPTURE_FIXTURE_IDS.jpeg]: { bytes: 828, sha256: "cec68685b4b0a611e726e7f93eba85d3e8355b6ef672cc3b3e1e599d5e96073e" },
  [RUN_CAPTURE_FIXTURE_IDS.data]: { bytes: 26, sha256: "87a6188a29cd2cb3d26251f1bc25846114d0ca3b454b25605540dfc9334cf28b" },
};

let server: FixtureServer;

test.beforeAll(async () => {
  ensureParityBundle();
  server = await startFixtureServer({
    distDir: PARITY_DIST_DIR,
    bundle: { proof: "working-tree" },
    runCaptureScenario: "evidence",
  });
});

test.afterAll(async () => { await server.close(); });

function captureRegion(page: Page): Locator {
  return page.getByRole("region", { name: "Run captures" });
}

async function openReceipt(page: Page, runId: string): Promise<Locator> {
  await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY, run: runId, section: "receipt" });
  await expect(page.getByRole("tab", { name: "Receipt", exact: true })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Logs", exact: true })).toHaveAttribute("aria-selected", "true");
  const region = captureRegion(page);
  await expect(region).toBeVisible();
  return region;
}

async function openLogs(page: Page, runId: string): Promise<Locator> {
  await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY, run: runId, section: "logs" });
  const region = captureRegion(page);
  await expect(region).toBeVisible();
  return region;
}

function captureFor(runId: string, artifactId: string) {
  const section = FIXTURE_RUN_CAPTURE_SECTIONS[runId];
  if (section?.section !== "captures") throw new Error(`run ${runId} has no fixture capture section`);
  const capture = section.payload.artifacts.find(candidate => candidate.artifact.artifactId === artifactId);
  if (capture === undefined) throw new Error(`run ${runId} has no fixture capture ${artifactId}`);
  return capture;
}

async function expectDownloadedBytes(page: Page, link: Locator, artifactId: string): Promise<void> {
  const expected = EXPECTED_DOWNLOADS[artifactId];
  if (expected === undefined) throw new Error(`fixture bytes are missing for ${artifactId}`);
  const expectedUrl = `${server.baseUrl}/artifacts/v1/${artifactId}`;
  const expectedPathname = new URL(expectedUrl).pathname;
  const before = server.artifactExchanges();
  await expect(link).toHaveAttribute("href", expectedUrl);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    link.click(),
  ]);
  expect(download.url()).toBe(expectedUrl);
  const stream = await download.createReadStream();
  if (stream === null) throw new Error(`capture download ${artifactId} produced no byte stream`);
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) {
    if (!(chunk instanceof Uint8Array)) throw new Error(`capture download ${artifactId} produced a non-byte chunk`);
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  expect(bytes.byteLength).toBe(expected.bytes);
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(expected.sha256);
  expect(server.artifactExchanges().slice(before.length)).toEqual([
    { method: "GET", pathname: expectedPathname, status: 200 },
  ]);
}

async function expectKeyboardFocus(target: Locator, scope?: Locator): Promise<void> {
  await expect(target).toBeFocused();
  if (scope !== undefined) expect(await scope.evaluate(node => node.contains(document.activeElement))).toBe(true);
  const ring = await target.evaluate(node => {
    const style = getComputedStyle(node);
    const width = Number.parseFloat(style.outlineWidth);
    const offset = Number.parseFloat(style.outlineOffset);
    const rect = node.getBoundingClientRect();
    const outside = width + offset;
    return { visible: node.matches(":focus-visible"), style: style.outlineStyle, color: style.outlineColor,
      width, offset, inside: rect.left - outside >= 0 && rect.right + outside <= innerWidth
        && rect.top - outside >= 0 && rect.bottom + outside <= innerHeight };
  });
  expect(ring.visible).toBe(true);
  expect(ring.style).toBe("solid");
  expect(ring.width).toBeGreaterThanOrEqual(2);
  expect(ring.offset).toBeGreaterThanOrEqual(1);
  expect(ring.color).not.toMatch(/^(?:transparent|rgba\(.+,\s*0\))$/u);
  expect(ring.inside).toBe(true);
}

/** Ordinary test-output evidence only: no golden name, reference write or URL normalization. */
function requiredA11yEvidence(...names: readonly string[]) {
  return {
    annotation: names.map((description) => ({
      type: "required-a11y-evidence",
      description,
    })),
  };
}

/** Ordinary test-output evidence only: no golden name, reference write or URL normalization. */
async function attachRenderedEvidence(page: Page, name: string, expectedAccessibleRoot: string): Promise<void> {
  const pngPath = test.info().outputPath(`${name}.png`);
  await page.screenshot({ path: pngPath, fullPage: false, animations: "disabled" });
  await test.info().attach(`${name}.png`, { path: pngPath, contentType: "image/png" });
  const snapshot = await page.locator("body").ariaSnapshot();
  expect(snapshot.length).toBeGreaterThan(0);
  expect(snapshot.split("\n").some(line => line.trim() === `- ${expectedAccessibleRoot}`)).toBe(true);
  const a11yName = `${name}.a11y.yml`;
  const a11yDigest = createHash("sha256").update(snapshot).digest("hex");
  test.info().annotations.push({
    type: `a11y-attachment-sha256:${a11yName}`,
    description: a11yDigest,
  });
  await test.info().attach(a11yName, { body: snapshot, contentType: "text/yaml" });
}

async function expectTargetGeometry(page: Page, scope: Locator): Promise<void> {
  expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(false);
  const proof = await scope.locator("button:visible, a:visible").evaluateAll(nodes => {
    const controls = nodes.filter((node): node is HTMLElement => node instanceof HTMLElement);
    const rectangles = controls.map(control => control.getBoundingClientRect());
    // A foreign control is a hazard only if the pointer can reach it. A non-zero
    // rect and `visibility: visible` do not say that: a queue row scrolled out
    // of its list's `overflow-hidden` box keeps both while painting nothing,
    // and one such row's ⓘ was counted against `Download` the moment a
    // one-line change to row height slid it under the link (2026-09-01) —
    // with `ownsTarget` already proving no point of the box resolved to it. So
    // a candidate must WIN the hit-test somewhere on itself: its centre or an
    // edge midpoint, which keeps a half-clipped control and drops a clipped or
    // fully covered one. The rectangle test below is unchanged — a painted
    // neighbour inside this box is still a fault even when this control owns
    // every point, because the neighbour's own target overlaps this one.
    const allInteractive = [...document.querySelectorAll("button, a[href]")].flatMap(control => {
      if (!(control instanceof HTMLElement)) return [];
      const rect = control.getBoundingClientRect();
      const style = getComputedStyle(control);
      if (!(rect.width > 0 && rect.height > 0) || style.visibility === "hidden") return [];
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const paintable = ([[cx, cy], [rect.left + 1, cy], [rect.right - 1, cy], [cx, rect.top + 1], [cx, rect.bottom - 1]] as const)
        .some(([x, y]) => {
          const hit = document.elementFromPoint(x, y);
          return hit === control || (hit !== null && control.contains(hit));
        });
      return paintable ? [{ control, rect }] : [];
    });
    const effective = rectangles.map(rect => ({ left: rect.left, right: rect.right,
      top: rect.top, bottom: rect.bottom }));
    return controls.map((control, index) => {
      const rect = rectangles[index];
      const target = effective[index];
      if (rect === undefined || target === undefined) throw new Error("a capture control disappeared during geometry collection");
      const owns = (x: number, y: number) => {
        const hit = document.elementFromPoint(x, y);
        return hit === control || (hit !== null && control.contains(hit));
      };
      const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      const targetPoints: Array<readonly [number, number]> = [[center.x, center.y]];
      // Probe the actual desktop control, inside its rounded corners. The retired
      // phone test probed a fixed 44px square beyond compact desktop controls.
      const inset = Math.max(1, Number.parseFloat(getComputedStyle(control).borderTopLeftRadius) + 1);
      for (let x = rect.left + inset; x < rect.right - inset; x += 2) {
        for (let y = rect.top + inset; y < rect.bottom - inset; y += 2) targetPoints.push([x, y]);
      }
      const pseudoInactive = ["::before", "::after"].every(pseudo => {
        const style = getComputedStyle(control, pseudo);
        return style.content === "none" || style.content === "normal" || style.pointerEvents === "none";
      });
      return {
        name: control.getAttribute("aria-label") ?? control.textContent?.trim(),
        width: rect.width,
        height: rect.height,
        inside: target.left >= 0 && target.right <= innerWidth && target.top >= 0 && target.bottom <= innerHeight,
        ownsEdges: [
          owns(rect.left + 1, rect.top + rect.height / 2),
          owns(rect.right - 1, rect.top + rect.height / 2),
          owns(rect.left + rect.width / 2, rect.top + 1),
          owns(rect.left + rect.width / 2, rect.bottom - 1),
        ].every(Boolean),
        ownsTarget: targetPoints.every(point => owns(point[0], point[1])),
        pseudoInactive,
        overlaps: effective.filter((other, otherIndex) => otherIndex !== index
          && target.left < other.right && target.right > other.left
          && target.top < other.bottom && target.bottom > other.top).length,
        foreignOverlaps: allInteractive.filter(other => other.control !== control
          && target.left < other.rect.right && target.right > other.rect.left
          && target.top < other.rect.bottom && target.bottom > other.rect.top).length,
      };
    });
  });
  expect(proof.length).toBeGreaterThan(0);
  for (const control of proof) {
    expect(control.inside, control.name).toBe(true);
    expect(control.ownsEdges, control.name).toBe(true);
    expect(control.overlaps, control.name).toBe(0);
    expect(control.width, control.name).toBeGreaterThan(0);
    expect(control.height, control.name).toBeGreaterThan(0);
    expect(control.ownsTarget, control.name).toBe(true);
    expect(control.pseudoInactive, control.name).toBe(true);
    expect(control.foreignOverlaps, control.name).toBe(0);
  }
}

async function expectDangerFrame(scope: Locator): Promise<void> {
  const proof = await scope.evaluate(node => {
    if (!(node instanceof HTMLElement)) throw new Error("the failure frame is not an HTML element");
    const style = getComputedStyle(node);
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d", { colorSpace: "srgb" });
    if (context === null) throw new Error("failure-frame color proof needs a canvas context");
    const sample = (color: string) => {
      if (!CSS.supports("color", color)) throw new Error(`failure-frame proof received unresolved color ${color}`);
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data];
    };
    const luminance = (rgba: number[]) => {
      const linear = rgba.slice(0, 3).map(channel => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return (linear[0] ?? 0) * 0.2126 + (linear[1] ?? 0) * 0.7152 + (linear[2] ?? 0) * 0.0722;
    };
    const composite = (foreground: number[], backdrop: number[]) => {
      const frontAlpha = (foreground[3] ?? 0) / 255;
      const backAlpha = (backdrop[3] ?? 0) / 255;
      const alpha = frontAlpha + backAlpha * (1 - frontAlpha);
      if (alpha <= 0) return [0, 0, 0, 0];
      const channel = (index: number) => Math.round((((foreground[index] ?? 0) * frontAlpha)
        + ((backdrop[index] ?? 0) * backAlpha * (1 - frontAlpha))) / alpha);
      return [channel(0), channel(1), channel(2), Math.round(alpha * 255)];
    };
    const border = sample(style.borderTopColor);
    const declaredDanger = sample(style.getPropertyValue("--ds-danger").trim());
    const declaredOrdinary = sample(style.getPropertyValue("--ds-border").trim());
    const backgroundLayers: number[][] = [];
    for (let current: HTMLElement | null = node; current !== null; current = current.parentElement) {
      backgroundLayers.push(sample(getComputedStyle(current).backgroundColor));
    }
    let background = [0, 0, 0, 0];
    for (const layer of backgroundLayers.reverse()) background = composite(layer, background);
    if (background[3] !== 255) throw new Error("failure-frame proof could not resolve an opaque painted backdrop");
    const paintedBorder = composite(border, background);
    const borderLight = luminance(paintedBorder);
    const backgroundLight = luminance(background);
    return { border, declaredDanger, declaredOrdinary, paintedBorder, background,
      contrast: (Math.max(borderLight, backgroundLight) + 0.05) / (Math.min(borderLight, backgroundLight) + 0.05) };
  });
  expect(proof.border).toEqual(proof.declaredDanger);
  expect(proof.border).not.toEqual(proof.declaredOrdinary);
  expect(proof.contrast).toBeGreaterThanOrEqual(3);
}

test("Logs keeps the compact capture block reachable with the receipt controls", async ({ page }) => {
  await installTheme(page, { name: "graphite-warm", attribute: "dark" });
  const region = await openLogs(page, FIXTURE_IDS.doneRun);
  const jpeg = captureFor(FIXTURE_IDS.doneRun, RUN_CAPTURE_FIXTURE_IDS.jpeg);
  const tile = region.locator("article").filter({ hasText: jpeg.artifact.artifactId });
  await expect(tile).toBeVisible();
  const opener = tile.getByRole("button", { name: `Open capture ${jpeg.artifact.artifactId}` });
  const download = tile.getByRole("link", { name: "Download" });
  await opener.focus();
  await expectKeyboardFocus(opener, region);
  await expect(download).toHaveAttribute("href", `${server.baseUrl}/artifacts/v1/${jpeg.artifact.artifactId}`);
  await page.screenshot({ path: test.info().outputPath("run-captures-logs-graphite-desktop.png"), fullPage: false, animations: "disabled" });
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Run capture" })).toBeVisible();
});

test(
  "full Receipt keeps exact JPEG/data captures, native bytes and keyboard focus",
  requiredA11yEvidence(
    "run-captures-full-graphite-desktop.a11y.yml",
    "run-capture-jpeg-graphite-desktop.a11y.yml",
  ),
  async ({ page }) => {
  await installTheme(page, { name: "graphite-warm", attribute: "dark" });
  const region = await openReceipt(page, FIXTURE_IDS.doneRun);
  await assertThemeApplied(page, { name: "graphite-warm", attribute: "dark" });
  await expect(page.getByLabel("Run detail", { exact: true })).toContainText("verified-done");
  await expect(page.getByText(EXPECTED_FULL_RECEIPT_ID, { exact: false })).toHaveCount(0);
  await expect(region.locator("article")).toHaveCount(2);
  await attachRenderedEvidence(page, "run-captures-full-graphite-desktop", 'region "Run captures":');

  const data = captureFor(FIXTURE_IDS.doneRun, RUN_CAPTURE_FIXTURE_IDS.data);
  const dataTile = region.locator("article").filter({ hasText: data.artifact.artifactId });
  await expect(dataTile).toContainText("restricted");
  await expect(dataTile).toContainText("restricted-access");
  await expect(dataTile.getByRole("button", { name: /Open capture/u })).toHaveCount(0);
  const dataDownload = dataTile.getByRole("link", { name: "Download" });
  await expect(dataDownload).toHaveAttribute("href", `${server.baseUrl}/artifacts/v1/${data.artifact.artifactId}`);
  await expectDownloadedBytes(page, dataDownload, data.artifact.artifactId);
  await expect(dataDownload).toBeFocused();

  const jpeg = captureFor(FIXTURE_IDS.doneRun, RUN_CAPTURE_FIXTURE_IDS.jpeg);
  const jpegTile = region.locator("article").filter({ hasText: jpeg.artifact.artifactId });
  await expect(jpegTile.getByRole("list", { name: "Capture origins" }).getByRole("listitem"))
    .toHaveText([`operator-request · ${jpeg.origins[0]?.bundleId}`]);
  const opener = jpegTile.getByRole("button", { name: `Open capture ${jpeg.artifact.artifactId}` });
  const jpegDownload = jpegTile.getByRole("link", { name: "Download" });
  await page.keyboard.press("Shift+Tab");
  await expect(jpegDownload).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expectKeyboardFocus(opener);
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Run capture" });
  await expect(dialog).toBeVisible();
  const image = dialog.getByRole("img", { name: `Capture ${jpeg.artifact.artifactId}` });
  await expect(image).toBeVisible();
  const dimensions = await image.evaluate(async node => {
    if (!(node instanceof HTMLImageElement)) throw new Error("the JPEG preview is not an image");
    await node.decode();
    return { width: node.naturalWidth, height: node.naturalHeight };
  });
  expect(dimensions).toEqual({ width: jpeg.artifact.mediaKind === "image" ? jpeg.artifact.width : 0,
    height: jpeg.artifact.mediaKind === "image" ? jpeg.artifact.height : 0 });
  await expect(dialog.getByText("Image decoded", { exact: true })).toBeVisible();
  const dialogDownload = dialog.getByRole("link", { name: "Download" });
  await expectDownloadedBytes(page, dialogDownload, jpeg.artifact.artifactId);
  await attachRenderedEvidence(page, "run-capture-jpeg-graphite-desktop", 'dialog "Run capture":');
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expectKeyboardFocus(opener);
  },
);

test(
  "full Receipt renders in Paper Ink at the desktop viewport",
  requiredA11yEvidence("run-captures-full-paper-desktop.a11y.yml"),
  async ({ page }) => {
  await installTheme(page, { name: "paper-ink", attribute: "light" });
  const region = await openReceipt(page, FIXTURE_IDS.doneRun);
  await assertThemeApplied(page, { name: "paper-ink", attribute: "light" });
  await expect(region.locator("article")).toHaveCount(2);
  await expect(region.getByText("Restricted capture", { exact: true })).toBeVisible();
  await attachRenderedEvidence(page, "run-captures-full-paper-desktop", 'region "Run captures":');
  },
);

test.describe("narrow desktop Receipt", () => {
  test.use({ viewport: { width: 1024, height: 768 } });

  test(
    "short Receipt preserves all origins and literal failure framing",
    requiredA11yEvidence("run-capture-png-paper-narrow-desktop.a11y.yml"),
    async ({ page }) => {
    test.slow();
    await installTheme(page, { name: "paper-ink", attribute: "light" });
    const region = await openReceipt(page, FIXTURE_IDS.failedRun);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Workflow Panel", exact: true })).toHaveCount(0);
    await assertThemeApplied(page, { name: "paper-ink", attribute: "light" });
    await expect(page.getByText("No receipt", { exact: true })).toHaveCount(0);
    const capture = captureFor(FIXTURE_IDS.failedRun, RUN_CAPTURE_FIXTURE_IDS.png);
    const tile = region.locator("article").filter({ hasText: capture.artifact.artifactId });
    await expect(tile).toHaveClass(/border-\[color:var\(--ds-danger\)\]/u);
    await expectDangerFrame(tile);
    await expect(tile.getByRole("list", { name: "Capture origins" }).getByRole("listitem"))
      .toHaveText(capture.origins.map(origin => `${origin.originKind} · ${origin.bundleId}`));
    await tile.scrollIntoViewIfNeeded();
    await expect(tile).toBeInViewport();
    const opener = tile.getByRole("button", { name: `Open capture ${capture.artifact.artifactId}` });
    const tileDownload = tile.getByRole("link", { name: "Download" });
    await opener.scrollIntoViewIfNeeded();
    await expect(opener).toBeInViewport({ ratio: 1 });
    await expect(tileDownload).toBeInViewport({ ratio: 1 });
    await expectTargetGeometry(page, tile);

    await opener.focus();
    await expectKeyboardFocus(opener);
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Run capture" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("figure", { name: "Run capture preview" }))
      .toHaveClass(/border-\[color:var\(--ds-danger\)\]/u);
    await expectDangerFrame(dialog.getByRole("figure", { name: "Run capture preview" }));
    await expect(dialog.getByRole("list", { name: "Capture origins" }).getByRole("listitem"))
      .toHaveText(capture.origins.map(origin => `${origin.originKind} · ${origin.bundleId}`));
    await expectTargetGeometry(page, dialog.locator("footer"));
    const image = dialog.getByRole("img", { name: `Capture ${capture.artifact.artifactId}` });
    const dimensions = await image.evaluate(async node => {
      if (!(node instanceof HTMLImageElement)) throw new Error("the PNG preview is not an image");
      await node.decode();
      return { width: node.naturalWidth, height: node.naturalHeight };
    });
    expect(dimensions).toEqual({ width: capture.artifact.mediaKind === "image" ? capture.artifact.width : 0,
      height: capture.artifact.mediaKind === "image" ? capture.artifact.height : 0 });
    await expectDownloadedBytes(page, dialog.getByRole("link", { name: "Download" }), capture.artifact.artifactId);
    await attachRenderedEvidence(page, "run-capture-png-paper-narrow-desktop", 'dialog "Run capture":');
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expectKeyboardFocus(opener);
    },
  );

  test(
    "short Receipt renders in Graphite Warm at the narrow desktop viewport",
    requiredA11yEvidence("run-captures-short-graphite-narrow-desktop.a11y.yml"),
    async ({ page }) => {
    await installTheme(page, { name: "graphite-warm", attribute: "dark" });
    const region = await openReceipt(page, FIXTURE_IDS.failedRun);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Workflow Panel", exact: true })).toHaveCount(0);
    await assertThemeApplied(page, { name: "graphite-warm", attribute: "dark" });
    const capture = captureFor(FIXTURE_IDS.failedRun, RUN_CAPTURE_FIXTURE_IDS.png);
    const tile = region.locator("article").filter({ hasText: capture.artifact.artifactId });
    await expectDangerFrame(tile);
    await tile.scrollIntoViewIfNeeded();
    await expect(tile).toBeInViewport();
    const opener = tile.getByRole("button", { name: `Open capture ${capture.artifact.artifactId}` });
    const tileDownload = tile.getByRole("link", { name: "Download" });
    await opener.scrollIntoViewIfNeeded();
    await expect(opener).toBeInViewport({ ratio: 1 });
    await expect(tileDownload).toBeInViewport({ ratio: 1 });
    await expectTargetGeometry(page, tile);
    await attachRenderedEvidence(page, "run-captures-short-graphite-narrow-desktop", 'region "Run captures":');
    },
  );
});

test("image refusal keeps the preview frame and metadata stationary", async ({ page }) => {
  const capture = captureFor(FIXTURE_IDS.doneRun, RUN_CAPTURE_FIXTURE_IDS.jpeg);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/artifacts/v1/${capture.artifact.artifactId}`, async route => {
    await held;
    await route.fulfill({ status: 500, contentType: "text/plain", body: "fixture image refusal" });
  });
  const region = await openReceipt(page, FIXTURE_IDS.doneRun);
  const opener = region.getByRole("button", { name: `Open capture ${capture.artifact.artifactId}` });
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "Run capture" });
  const figure = dialog.getByRole("figure", { name: "Run capture preview" });
  await expect(figure).toHaveAttribute("aria-busy", "true");
  const before = await dialog.evaluate(node => {
    const figureNode = node.querySelector("figure");
    const facts = node.querySelector("dl");
    if (!(figureNode instanceof HTMLElement) || !(facts instanceof HTMLElement)) throw new Error("capture dialog lost its frame or facts");
    const rect = figureNode.getBoundingClientRect();
    const factsRect = facts.getBoundingClientRect();
    return { figure: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
      width: rect.width, height: rect.height }, facts: { left: factsRect.left, top: factsRect.top,
      right: factsRect.right, bottom: factsRect.bottom, width: factsRect.width, height: factsRect.height } };
  });
  release();
  await expect(dialog.getByText("Capture image could not be displayed", { exact: true })).toBeVisible();
  await expect(dialog).toContainText(capture.artifact.sha256);
  await expect(dialog).toContainText(`${String(capture.artifact.byteLength)} bytes`);
  const after = await dialog.evaluate(node => {
    const figureNode = node.querySelector("figure");
    const facts = node.querySelector("dl");
    if (!(figureNode instanceof HTMLElement) || !(facts instanceof HTMLElement)) throw new Error("capture dialog lost its frame or facts");
    const rect = figureNode.getBoundingClientRect();
    const factsRect = facts.getBoundingClientRect();
    return { figure: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
      width: rect.width, height: rect.height }, facts: { left: factsRect.left, top: factsRect.top,
      right: factsRect.right, bottom: factsRect.bottom, width: factsRect.width, height: factsRect.height } };
  });
  expect(after).toEqual(before);
  await expect(dialog.getByRole("link", { name: "Download" }))
    .toHaveAttribute("href", `${server.baseUrl}/artifacts/v1/${capture.artifact.artifactId}`);
});

test("closing during image load invalidates the dialog and restores its opener", async ({ page }) => {
  const capture = captureFor(FIXTURE_IDS.doneRun, RUN_CAPTURE_FIXTURE_IDS.jpeg);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/artifacts/v1/${capture.artifact.artifactId}`, async route => {
    const response = await route.fetch();
    await held;
    await route.fulfill({ response });
  });
  const region = await openReceipt(page, FIXTURE_IDS.doneRun);
  const opener = region.getByRole("button", { name: `Open capture ${capture.artifact.artifactId}` });
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "Run capture" });
  await expect(dialog.getByRole("status")).toHaveText("Loading capture image…");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expectKeyboardFocus(opener);
  release();
  await expect(dialog).toHaveCount(0);
});

test("served absence makes no speculative capture request", async ({ page }) => {
  let captureRequests = 0;
  await page.route(`**/api/v1/runs/${FIXTURE_IDS.doneRun}/captures`, async route => {
    captureRequests += 1;
    await route.abort("failed");
  });
  await page.route(`**/api/v1/runs/${FIXTURE_IDS.doneRun}`, async route => {
    const response = await route.fetch();
    const raw: unknown = await response.json();
    const detail = RunDetailWireSchema.parse(raw);
    await route.fulfill({ json: {
      ...detail,
      captures: { state: "absent", reason: "No indexed diagnostic artifacts for this run" },
      availableSections: detail.availableSections.filter((section: string) => section !== "captures"),
    } });
  });
  const region = await openReceipt(page, FIXTURE_IDS.doneRun);
  await expect(region.getByText("No captures", { exact: true })).toBeVisible();
  await expect(region).toContainText("No indexed diagnostic artifacts for this run");
  await page.evaluate(() => new Promise<void>(resolve => {
    requestAnimationFrame(() => { requestAnimationFrame(() => { queueMicrotask(resolve); }); });
  }));
  expect(captureRequests).toBe(0);
});
