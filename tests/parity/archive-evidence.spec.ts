/** DCA4's archived-capture viewer: exact frozen metadata plus verified-byte UI. */
import { expect, test, type Locator, type Page, type Request } from "@playwright/test";
import { resolve } from "node:path";
import { ArchivedCaptureResourceWireSchema } from "../../src/domain/dashboard/archive.js";
import { WireErrorSchema } from "../../src/domain/dashboard/primitives.js";
import { gotoAppState } from "./helpers/app-driver.js";
import { ensureParityBundle, PARITY_DIST_DIR } from "./helpers/bundle.js";
import { assertThemeApplied, captureParityPair, installTheme } from "./helpers/capture.js";
import { FIXTURE_APP_VERSION, FIXTURE_DAY, FIXTURE_DESCRIPTOR_HASH } from "./helpers/fixture-day.js";
import {
  FIXTURE_ARCHIVE_EVIDENCE_BYTES,
  FIXTURE_ARCHIVE_EVIDENCE_CAPTURE,
  FIXTURE_ARCHIVE_EVIDENCE_RUN,
} from "./helpers/fixture-archive-evidence.js";
import { startFixtureServer, type FixtureServer } from "./helpers/fixture-bff.js";

const REFERENCES = resolve(import.meta.dirname, "references");
const RUN_ID = FIXTURE_ARCHIVE_EVIDENCE_RUN.runId;
const CAPTURE = FIXTURE_ARCHIVE_EVIDENCE_CAPTURE;
const RESOURCE_PATH = `/api/v1/archive/${RUN_ID}/captures/${CAPTURE.artifactId}/resource`;
const BYTE_PATH = `/artifacts/v1/archive/${RUN_ID}/${CAPTURE.artifactId}`;
const SUCCESS = "Verified retained bytes for this frozen archived capture.";
let server: FixtureServer;

test.beforeAll(async () => {
  ensureParityBundle();
  server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" }, archiveScenario: "evidence" });
});

test.afterAll(async () => { await server.close(); });

async function openEvidence(page: Page): Promise<Locator> {
  await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY, archive: RUN_ID });
  await page.getByRole("tab", { name: "Evidence" }).click();
  return page.getByRole("button", { name: "What it was" });
}

async function expectFrozenMetadata(dialog: Locator): Promise<void> {
  const facts = dialog.locator("dl");
  await expect(facts).toContainText(CAPTURE.digest);
  await expect(facts).toContainText(CAPTURE.artifactId);
  await expect(facts).toContainText(CAPTURE.bundleId);
  await expect(facts).toContainText(`${String(CAPTURE.byteLength)} bytes`);
  await expect(facts).toContainText("image/png");
  await expect(facts).toContainText("1440 × 900");
  await expect(dialog.getByText("Declared retention", { exact: true })).toBeVisible();
  await expect(dialog).not.toContainText(/purged/iu);
}

async function settledDialog(dialog: Locator): Promise<void> {
  await expect(dialog).toHaveCSS("opacity", "1");
  await expect.poll(() => dialog.evaluate((node) => new DOMMatrixReadOnly(getComputedStyle(node).transform).a)).toBe(1);
}

async function assertOpenerGeometry(trigger: Locator): Promise<void> {
  expect(await trigger.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(false);
  const proof = await trigger.evaluate((node) => {
    if (!(node instanceof HTMLButtonElement)) throw new Error("the archived capture opener is not a button");
    const rect = node.getBoundingClientRect();
    const ownsPoint = (x: number, y: number) => {
      const hit = document.elementFromPoint(x, y);
      return hit === node || (hit !== null && node.contains(hit));
    };
    const siblings = node.parentElement === null
      ? []
      : [...node.parentElement.querySelectorAll("button, a")].filter((candidate) => candidate !== node);
    return {
      width: rect.width,
      height: rect.height,
      insideViewport: rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight,
      ownsEdges: [
        ownsPoint(rect.left + 1, rect.top + rect.height / 2),
        ownsPoint(rect.right - 1, rect.top + rect.height / 2),
        ownsPoint(rect.left + rect.width / 2, rect.top + 1),
        ownsPoint(rect.left + rect.width / 2, rect.bottom - 1),
      ].every(Boolean),
      overlaps: siblings.filter((candidate) => {
        const other = candidate.getBoundingClientRect();
        return rect.left < other.right && rect.right > other.left && rect.top < other.bottom && rect.bottom > other.top;
      }).length,
    };
  });
  expect(proof.insideViewport).toBe(true);
  expect(proof.ownsEdges).toBe(true);
  expect(proof.overlaps).toBe(0);

}

function barrier() {
  let release: () => void = () => { throw new Error("fixture barrier has no release"); };
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

async function assertControlGeometry(page: Page): Promise<void> {
  const dialog = page.getByRole("dialog");
  await settledDialog(dialog);
  expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(false);
  const proof = await dialog.evaluate((node) => {
    const frame = node.getBoundingClientRect();
    const footer = node.querySelector("footer");
    const body = node.querySelector(".overflow-y-auto");
    if (!(footer instanceof HTMLElement) || !(body instanceof HTMLElement)) throw new Error("the capture dialog lost its body or footer");
    const controls = [...node.querySelectorAll("header button, footer button, footer a")];
    const rectangles = controls.map((control) => control.getBoundingClientRect());
    return {
      overflow: node.scrollWidth > node.clientWidth || footer.scrollWidth > footer.clientWidth,
      insideViewport: frame.left >= 0 && frame.right <= innerWidth && frame.top >= 0 && frame.bottom <= innerHeight,
      bodyClearOfFooter: body.getBoundingClientRect().bottom <= footer.getBoundingClientRect().top,
      controls: controls.map((control, index) => {
        const rect = rectangles[index];
        if (rect === undefined) throw new Error("the measured capture control disappeared");
        const ownsPoint = (x: number, y: number) => {
          const hit = document.elementFromPoint(x, y);
          return hit === control || (hit !== null && control.contains(hit));
        };
        return {
          name: control.getAttribute("aria-label") ?? control.textContent?.trim(),
          width: rect.width,
          height: rect.height,
          disabled: control.getAttribute("aria-disabled") === "true",
          inside: rect.left >= frame.left && rect.right <= frame.right && rect.top >= frame.top && rect.bottom <= frame.bottom,
          ownsEdges: [
            ownsPoint(rect.left + 1, rect.top + rect.height / 2), ownsPoint(rect.right - 1, rect.top + rect.height / 2),
            ownsPoint(rect.left + rect.width / 2, rect.top + 1), ownsPoint(rect.left + rect.width / 2, rect.bottom - 1),
          ].every(Boolean),
          overlaps: rectangles.filter((other, otherIndex) => otherIndex !== index
            && rect.left < other.right && rect.right > other.left && rect.top < other.bottom && rect.bottom > other.top).length,
        };
      }),
    };
  });
  expect(proof.overflow).toBe(false);
  expect(proof.insideViewport).toBe(true);
  expect(proof.bodyClearOfFooter).toBe(true);
  expect(proof.controls.map((control) => control.name)).toEqual(["Close", "Previous capture", "Next capture", "Download", "Close"]);
  for (const control of proof.controls) {
    expect(control.inside, control.name).toBe(true);
    expect(control.overlaps, control.name).toBe(0);

    // End-of-walk controls are deliberately pointer-inert but retain their keyboard stop.
    if (!control.disabled) expect(control.ownsEdges, control.name).toBe(true);
  }
}

/** Actual CSS geometry/color proof; DOM class assertions cannot certify these facts. */
async function assertCaptionGeometry(dialog: Locator): Promise<void> {
  const preview = dialog.getByRole("figure", { name: "Archived capture preview" });
  await expect(preview.locator("figcaption")).toHaveText(SUCCESS);
  const proof = await preview.evaluate((frame) => {
    const image = frame.querySelector("img");
    const caption = frame.querySelector("figcaption");
    if (!(frame instanceof HTMLElement) || !(image instanceof HTMLImageElement) || !(caption instanceof HTMLElement)
      || !(image.parentElement instanceof HTMLElement)) throw new Error("the capture preview lost its image viewport or caption");
    const viewport = image.parentElement;
    const outer = frame.getBoundingClientRect();
    const frameStyle = getComputedStyle(frame);
    const interior = { left: outer.left + Number.parseFloat(frameStyle.borderLeftWidth),
      top: outer.top + Number.parseFloat(frameStyle.borderTopWidth),
      right: outer.right - Number.parseFloat(frameStyle.borderRightWidth),
      bottom: outer.bottom - Number.parseFloat(frameStyle.borderBottomWidth) };
    const imageBox = image.getBoundingClientRect();
    const viewportBox = viewport.getBoundingClientRect();
    const captionBox = caption.getBoundingClientRect();
    const inside = (inner: { left: number; top: number; right: number; bottom: number },
      boundary: { left: number; top: number; right: number; bottom: number }) => inner.left >= boundary.left
        && inner.right <= boundary.right && inner.top >= boundary.top && inner.bottom <= boundary.bottom;
    const imageStyle = getComputedStyle(image);
    const captionStyle = getComputedStyle(caption);
    if (image.naturalWidth <= 0 || image.naturalHeight <= 0) throw new Error("caption proof requires a decoded positive-dimension image");
    // A fully contained, unobstructed element with object-fit:contain shows the entire decoded image.
    const range = document.createRange();
    range.selectNodeContents(caption);
    const textLines = [...range.getClientRects()];
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d", { colorSpace: "srgb" });
    if (context === null) throw new Error("caption contrast proof needs a canvas color conversion context");
    const sample = (color: string) => {
      if (!CSS.supports("color", color)) throw new Error(`caption proof received an unresolved color: ${color}`);
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data];
    };
    const foreground = sample(captionStyle.color);
    const background = sample(captionStyle.backgroundColor);
    const declaredBackground = sample(captionStyle.getPropertyValue("--ds-surface-2").trim());
    const luminance = (rgba: number[]) => {
      const linear = rgba.slice(0, 3).map((channel) => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
    };
    const light = luminance(foreground);
    const dark = luminance(background);
    return {
      imageFit: imageStyle.objectFit, imagePosition: imageStyle.objectPosition,
      imagePadding: imageStyle.padding, imageBorder: imageStyle.borderWidth,
      viewportSeparate: viewport !== frame && viewport.nextElementSibling === caption,
      imageViewportInsideFrame: inside(viewportBox, interior), captionInsideFrame: inside(captionBox, interior),
      imageInsideViewport: inside(imageBox, viewportBox), imageHasArea: imageBox.width > 0 && imageBox.height > 0,
      viewportBeforeCaption: viewportBox.bottom <= captionBox.top,
      imageBeforeCaption: imageBox.bottom <= captionBox.top,
      captionUnclipped: caption.scrollWidth <= caption.clientWidth && caption.scrollHeight <= caption.clientHeight,
      textLineCount: textLines.length, textInsideCaption: textLines.every((line) => inside(line, captionBox)),
      textHitVisible: textLines.every((line) => {
        const hit = document.elementFromPoint(line.left + line.width / 2, line.top + line.height / 2);
        return hit === caption || (hit !== null && caption.contains(hit));
      }),
      foreground, background, declaredBackground,
      contrast: (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05),
      captionOpacity: captionStyle.opacity,
    };
  });
  expect(proof.imageFit).toBe("contain");
  expect(proof.imagePosition).toBe("50% 50%");
  expect(proof.imagePadding).toBe("0px");
  expect(proof.imageBorder).toBe("0px");
  expect(proof.viewportSeparate).toBe(true);
  expect(proof.imageViewportInsideFrame).toBe(true);
  expect(proof.captionInsideFrame).toBe(true);
  expect(proof.imageInsideViewport).toBe(true);
  expect(proof.imageHasArea).toBe(true);
  expect(proof.viewportBeforeCaption).toBe(true);
  expect(proof.imageBeforeCaption).toBe(true);
  expect(proof.captionUnclipped).toBe(true);
  expect(proof.textLineCount).toBeGreaterThan(0);
  expect(proof.textInsideCaption).toBe(true);
  expect(proof.textHitVisible).toBe(true);
  expect(proof.background).toEqual(proof.declaredBackground);
  expect(proof.background[3]).toBe(255);
  expect(proof.foreground[3]).toBe(255);
  expect(proof.captionOpacity).toBe("1");
  expect(proof.contrast).toBeGreaterThanOrEqual(4.5);
}

for (const view of [
  { viewport: { name: "1280x720", width: 1280, height: 720 }, theme: { name: "graphite-warm", attribute: "dark" } },
  { viewport: { name: "narrow-1024x768", width: 1024, height: 768 }, theme: { name: "paper-ink", attribute: "light" } },
] as const) {
  test.describe(`${view.theme.name} @ ${view.viewport.name}`, () => {
    test.use({ viewport: { width: view.viewport.width, height: view.viewport.height } });
    test(`verified archived capture evidence ${view.theme.name} @ ${view.viewport.name}`, async ({ page }) => {
      await installTheme(page, view.theme);
      const trigger = await openEvidence(page);
      await assertThemeApplied(page, view.theme);
      await assertOpenerGeometry(trigger);
      await trigger.click();
      await expect(page.getByRole("dialog")).toBeVisible();
      const image = page.getByRole("img", { name: /^Archived screenshot captured /u });
      await expect(image).toBeVisible();
      const dimensions = await image.evaluate(async (node) => {
        if (!(node instanceof HTMLImageElement)) throw new Error("the archived capture preview was not an image");
        await node.decode();
        return { height: node.naturalHeight, width: node.naturalWidth };
      });
      expect(dimensions).toEqual({ height: 900, width: 1440 });
      const downloadLink = page.getByRole("link", { name: "Download" });
      await expect(downloadLink).toHaveAttribute("download", /archive-/u);
      await expect(downloadLink).toHaveAttribute(
        "href",
        BYTE_PATH,
      );
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        downloadLink.click(),
      ]);
      const stream = await download.createReadStream();
      if (stream === null) throw new Error("the archive-evidence download produced no bytes");
      const chunks: Uint8Array[] = [];
      for await (const chunk of stream) {
        if (!(chunk instanceof Uint8Array)) throw new Error("the archive-evidence download produced a non-byte chunk");
        chunks.push(chunk);
      }
      expect(Buffer.concat(chunks)).toEqual(Buffer.from(FIXTURE_ARCHIVE_EVIDENCE_BYTES));
      await expect(page.getByText(SUCCESS)).toBeVisible();
      await expectFrozenMetadata(page.getByRole("dialog"));
      await assertControlGeometry(page);
      await assertCaptionGeometry(page.getByRole("dialog"));

      await captureParityPair(page, REFERENCES, {
        stateId: "archive-evidence",
        viewport: view.viewport.name,
        theme: view.theme.name,
        adapter: "fixture",
        fixtureId: "archive-evidence-verified",
        descriptorHash: FIXTURE_DESCRIPTOR_HASH,
        appVersion: FIXTURE_APP_VERSION,
        capturedAt: FIXTURE_DAY,
        variant: "default",
      });
    });

    test("keeps frozen metadata stationary across resource, HTTP and decode readiness", async ({ page }) => {
      const resource = barrier();
      const bytes = barrier();
      await page.route(`**${RESOURCE_PATH}`, async (route) => {
        const response = await route.fetch();
        await resource.promise;
        await route.fulfill({ response });
      });
      await page.route(`**${BYTE_PATH}`, async (route) => {
        const response = await route.fetch();
        await bytes.promise;
        await route.fulfill({ response });
      });
      try {
        await (await openEvidence(page)).click();
        const dialog = page.getByRole("dialog");
        await settledDialog(dialog);
        await page.evaluate(() => document.fonts.ready.then(() => undefined));
        const preview = dialog.getByRole("figure", { name: "Archived capture preview" });
        const geometry = async () => ({
          preview: await preview.boundingBox(),
          metadata: await dialog.getByText("What this capture was", { exact: true }).boundingBox(),
        });
        const checking = await geometry();
        expect(checking.preview).not.toBeNull();
        expect(checking.metadata).not.toBeNull();
        await expect(preview).toHaveAttribute("aria-busy", "true");
        resource.release();
        await expect(dialog.getByRole("link", { name: "Download" })).toBeVisible();
        await expect(preview.locator("img")).toHaveAttribute("aria-hidden", "true");
        expect(await geometry()).toEqual(checking);
        await preview.locator("img").evaluate((node) => {
          if (!(node instanceof HTMLImageElement)) throw new Error("the preview is not an image");
          const nativeDecode = node.decode.bind(node);
          const released = new Promise<void>((resolve) => {
            document.addEventListener("dca4-release-decode", () => { resolve(); }, { once: true });
          });
          node.decode = async () => {
            node.setAttribute("data-dca4-decode-started", "true");
            await released;
            await nativeDecode();
          };
        });
        bytes.release();
        await expect(preview.locator("img")).toHaveAttribute("data-dca4-decode-started", "true");
        await expect(dialog.getByText(SUCCESS)).toHaveCount(0);
        expect(await geometry()).toEqual(checking);
        await page.evaluate(() => { document.dispatchEvent(new Event("dca4-release-decode")); });
        await expect(dialog.getByText(SUCCESS)).toBeVisible();
        await expect(preview).toHaveAttribute("aria-busy", "false");
        expect(await geometry()).toEqual(checking);
        await expectFrozenMetadata(dialog);
      } finally {
        resource.release();
        bytes.release();
      }
    });
  });
}

test("desktop keyboard opens, closes with Escape, reopens and returns focus from footer Close", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(false);
  const trigger = await openEvidence(page);
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(SUCCESS)).toBeVisible();
  await expect.poll(() => dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog.getByText(SUCCESS)).toBeVisible();
  await dialog.getByRole("button", { name: "Previous capture" }).focus();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Next capture" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("link", { name: "Download" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.locator("footer").getByRole("button", { name: "Close", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("narrow viewport keeps the footer and preview inside the dialog", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await (await openEvidence(page)).click();
  await expect(page.getByText(SUCCESS)).toBeVisible();
  await assertControlGeometry(page);
});

for (const refusal of ["missing", "corrupt", "request", "image-http", "decode"] as const) {
  test(`keeps frozen facts accessible for a visible ${refusal} refusal`, async ({ page }) => {
    const bytes = barrier();
    let interceptedImageRequest: Request | undefined;
    let failedImageRequest: Request | undefined;
    let abortCompleted = false;
    const recordImageFailure = (request: Request) => {
      if (request === interceptedImageRequest) failedImageRequest = request;
    };
    if (refusal === "missing" || refusal === "corrupt") {
      const response = ArchivedCaptureResourceWireSchema.parse({
        runId: RUN_ID,
        artifactId: CAPTURE.artifactId,
        resource: refusal === "missing"
          ? { state: "missing", reason: "The fixture store no longer holds these exact bytes." }
          : { state: "error", message: "The fixture bytes did not match this archived digest." },
      });
      await page.route(`**${RESOURCE_PATH}`, (route) => route.fulfill({ json: response }));
    } else if (refusal === "request") {
      await page.route(`**${RESOURCE_PATH}`, (route) => route.fulfill({ status: 503, json: WireErrorSchema.parse({
        state: "error", code: "ARCHIVE_FIXTURE_UNAVAILABLE", message: "The fixture archive service is unavailable.", retryable: true,
      }) }));
    } else if (refusal === "image-http") {
      page.on("requestfailed", recordImageFailure);
      await page.route(`${server.baseUrl}${BYTE_PATH}`, async (route) => {
        interceptedImageRequest = route.request();
        await route.abort("failed");
        abortCompleted = true;
      });
    } else {
      await page.route(`**${BYTE_PATH}`, async (route) => {
        const response = await route.fetch();
        await bytes.promise;
        await route.fulfill({ response });
      });
    }
    try {
      await (await openEvidence(page)).click();
      const dialog = page.getByRole("dialog");
      if (refusal === "decode") {
        await dialog.locator("img").evaluate((node) => {
          if (!(node instanceof HTMLImageElement)) throw new Error("the preview is not an image");
          node.decode = async () => {
            node.setAttribute("data-dca4-refusal-decode-called", "true");
            node.setAttribute("data-dca4-refusal-decode-width", String(node.naturalWidth));
            node.setAttribute("data-dca4-refusal-decode-height", String(node.naturalHeight));
            throw new Error("Fixture browser decoder refused this verified image.");
          };
        });
        bytes.release();
        await expect(dialog.locator("img")).toHaveAttribute("data-dca4-refusal-decode-called", "true");
        await expect(dialog.locator("img")).toHaveAttribute("data-dca4-refusal-decode-width", "1440");
        await expect(dialog.locator("img")).toHaveAttribute("data-dca4-refusal-decode-height", "900");
      } else if (refusal === "image-http") {
        await expect.poll(() => ({
          url: interceptedImageRequest?.url(),
          method: interceptedImageRequest?.method(),
          resourceType: interceptedImageRequest?.resourceType(),
          abortCompleted,
          sameRequest: failedImageRequest !== undefined && failedImageRequest === interceptedImageRequest,
          failure: failedImageRequest?.failure()?.errorText,
        })).toEqual({
          url: `${server.baseUrl}${BYTE_PATH}`,
          method: "GET",
          resourceType: "image",
          abortCompleted: true,
          sameRequest: true,
          failure: "net::ERR_FAILED",
        });
      }
      const title = {
        missing: "Capture bytes are missing", corrupt: "Capture bytes could not be verified",
        request: "Capture resource could not be read", "image-http": "Capture image could not be displayed",
        decode: "Capture image could not be displayed",
      }[refusal];
      await expect(dialog.getByText(title, { exact: true })).toBeVisible();
      await expect(dialog.getByText(SUCCESS)).toHaveCount(0);
      await expectFrozenMetadata(dialog);
      if (refusal === "image-http" || refusal === "decode") {
        await expect(dialog.getByRole("link", { name: "Download" })).toHaveAttribute("href", BYTE_PATH);
        await expect(dialog.locator("img")).toHaveAttribute("aria-hidden", "true");
      } else {
        await expect(dialog.getByRole("link", { name: "Download" })).toHaveCount(0);
      }
    } finally {
      page.off("requestfailed", recordImageFailure);
      bytes.release();
    }
  });
}
