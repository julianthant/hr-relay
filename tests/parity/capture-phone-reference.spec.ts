/**
 * The phone capture surface's reference set (doc 13 §7.1, 2i-F).
 *
 * It is its OWN describe block at its own viewport rather than a fourth entry
 * in `PARITY_VIEWPORTS`, and that is a deliberate scoping decision: the phone
 * viewport is meaningless for the operator's thirteen states, and adding it to
 * the shared matrix would have minted twenty-six references of a console
 * squeezed into 390px that nobody will ever look at. One surface, one viewport,
 * one theme.
 *
 * ONE THEME, and it is the light one. `capture.html` stamps Paper Ink and
 * carries no `dark` class, because the phone is read at arm's length in
 * daylight beside a filing cabinet while the console is read at a desk. The
 * theme is not a preference here, so there is nothing to photograph twice.
 *
 * Beyond the stills, three BEHAVIOURS are asserted here rather than only
 * frozen: a refusal shows the server's own sentence, a failed handoff offers
 * Retry and Discard, and a control in flight disables ITSELF and nothing else.
 * This repo has no DOM test environment — the `.tsx` surfaces are excluded from
 * coverage precisely because the rendered half is proven in a real browser — so
 * this is where those facts live.
 */
import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
import { startFixtureServer, type FixtureServer } from "./helpers/fixture-bff.js";
import { PARITY_DIST_DIR, ensureParityBundle } from "./helpers/bundle.js";
import { FIXTURE_APP_VERSION, FIXTURE_DAY, FIXTURE_DESCRIPTOR_HASH } from "./helpers/fixture-day.js";
import { captureParityPair } from "./helpers/capture.js";
import { gotoCaptureState } from "./helpers/app-driver.js";
import {
  CAPTURE_UNKNOWN_SESSION_MESSAGE,
  CAPTURE_TOKEN_HEADER,
} from "../../src/domain/capture-surface.js";
import {
  FIXTURE_CAPTURE_FAILED,
  FIXTURE_CAPTURE_PHOTO_IDS,
  FIXTURE_CAPTURE_TOKENS,
} from "./helpers/fixture-capture.js";

const REFERENCES = resolve(import.meta.dirname, "references");

/**
 * A 390 × 844 CSS viewport — an iPhone 14 / 15 in portrait, which is the median
 * device an HR staffer is holding. Not in `PARITY_VIEWPORTS`: see the header.
 */
const PHONE = { name: "phone-390x844", width: 390, height: 844 } as const;

/** The phone ships one theme, so its references carry that one theme's name. */
const PHONE_THEME = "paper-ink";

let server: FixtureServer;

test.beforeAll(async () => {
  ensureParityBundle();
  server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
});

test.afterAll(async () => {
  await server.close();
});

/** A page that logged an uncaught error did not render the state under test. */
function failOnPageErrors(page: import("@playwright/test").Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

async function capture(
  page: import("@playwright/test").Page,
  stateId: string,
): Promise<void> {
  await captureParityPair(page, REFERENCES, {
    stateId,
    viewport: PHONE.name,
    theme: PHONE_THEME,
    adapter: "fixture",
    fixtureId: stateId,
    descriptorHash: FIXTURE_DESCRIPTOR_HASH,
    appVersion: FIXTURE_APP_VERSION,
    capturedAt: FIXTURE_DAY,
    variant: "default",
  });
}

test.describe("capture phone @ phone-390x844", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: PHONE.width, height: PHONE.height });
  });

  test("capture-empty", async ({ page }) => {
    const errors = failOnPageErrors(page);
    await gotoCaptureState(page, server.baseUrl, FIXTURE_CAPTURE_TOKENS.empty);
    // The camera is the ONE verb on an empty capture, and it is a real file
    // input inside a label — the only construction that opens a phone camera.
    await expect(page.getByText("Take the first page")).toBeVisible();
    await expect(page.locator('input[type="file"][capture="environment"]')).toHaveCount(1);
    expect(errors).toEqual([]);
    await capture(page, "capture-empty");
  });

  test("capture-photos", async ({ page }) => {
    const errors = failOnPageErrors(page);
    await gotoCaptureState(page, server.baseUrl, FIXTURE_CAPTURE_TOKENS.photos);
    await expect(page.getByRole("listitem")).toHaveCount(3);
    // At rest there are no move controls — reordering is a mode you enter.
    await expect(page.getByRole("button", { name: /^Move / })).toHaveCount(0);
    // The camera keeps the primary slot on the RIGHT while capturing, and
    // Review sits left of it. That ordering is a safety property, not a
    // preference: Review and Send are both "primary, on the right", so a
    // Review under the thumb would put Send exactly where a second tap lands.
    const reviewBox = await page.getByRole("button", { name: "Review" }).boundingBox();
    const cameraBox = await page.getByText("Add a page").boundingBox();
    expect(reviewBox).not.toBeNull();
    expect(cameraBox).not.toBeNull();
    expect(reviewBox?.x ?? 0).toBeLessThan(cameraBox?.x ?? 0);
    expect(errors).toEqual([]);
    await capture(page, "capture-photos");
  });

  test("capture-reorder", async ({ page }) => {
    const errors = failOnPageErrors(page);
    await gotoCaptureState(page, server.baseUrl, FIXTURE_CAPTURE_TOKENS.photos);
    await page.getByRole("button", { name: "Review" }).click();
    // Park the pointer off-canvas. Playwright leaves the mouse where it
    // clicked, and Chromium reports `hover: hover`, so the bar's next control
    // would be photographed in a hover state that no phone can produce.
    await page.mouse.move(0, 0);

    // Six move controls and three removes, all reachable by name.
    await expect(page.getByRole("button", { name: /^Move / })).toHaveCount(6);
    await expect(page.getByRole("button", { name: "Remove" })).toHaveCount(3);
    // The ends are disabled rather than wrapping — a press there does nothing,
    // and looking like it might is how a page silently moves.
    await expect(page.getByRole("button", { name: "Move Page 1 of 3 earlier" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Move Page 3 of 3 later" })).toBeDisabled();
    expect(errors).toEqual([]);
    await capture(page, "capture-reorder");
  });

  test("capture-sent", async ({ page }) => {
    const errors = failOnPageErrors(page);
    await gotoCaptureState(page, server.baseUrl, FIXTURE_CAPTURE_TOKENS.sent);
    await expect(page.getByText("3 pages sent")).toBeVisible();
    // The handoff identities are the join between this bundle and the work it
    // became; a "Sent" that named nothing could not be followed up.
    await expect(page.getByText("2f3a4b5c-6d7e-4f8a-9b0c-1d2e3f4a5b6c")).toBeVisible();
    await expect(page.getByText("3a4b5c6d-7e8f-4a9b-8c1d-2e3f4a5b6c7d")).toBeVisible();
    expect(errors).toEqual([]);
    await capture(page, "capture-sent");
  });

  test("capture-failed", async ({ page }) => {
    const errors = failOnPageErrors(page);
    await gotoCaptureState(page, server.baseUrl, FIXTURE_CAPTURE_TOKENS.failed);
    if (FIXTURE_CAPTURE_FAILED.handoff.state !== "failed") {
      throw new Error("the failed capture fixture stopped carrying a failed handoff");
    }
    // The projector's OWN recorded reason, verbatim — not a re-wording.
    const alert = page.getByRole("alert").filter({ hasText: FIXTURE_CAPTURE_FAILED.handoff.message });
    await expect(alert).toBeVisible();
    // Both ways out are present, and the destructive one is not the primary.
    await expect(page.getByRole("button", { name: "Try again" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Discard" })).toBeEnabled();
    expect(errors).toEqual([]);
    await capture(page, "capture-failed");
  });
});

/**
 * The two behaviours a still cannot hold. Neither writes a reference: they are
 * about what the page DOES, and photographing a spinner would only pin a frame
 * of it.
 */
test.describe("capture phone behaviour", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: PHONE.width, height: PHONE.height });
  });

  /**
   * Fail-closed enumeration. An unknown, expired, discarded or foreign token
   * must produce ONE sentence — a phone on a public origin that could tell
   * "no such session" from "not yours" is an existence oracle.
   */
  test("an unresolvable token shows the server's one fail-closed sentence", async ({ page }) => {
    const errors = failOnPageErrors(page);
    await gotoCaptureState(page, server.baseUrl, "Zz0Zz0Zz0Zz0Zz0Zz0Zz0Zz0Zz0Zz0Zz0Zz0Zz0Zz0z");
    const alert = page.getByRole("alert");
    await expect(alert).toContainText(CAPTURE_UNKNOWN_SESSION_MESSAGE);
    // Nothing on the page hints at WHICH kind of failure it was.
    await expect(alert).not.toContainText(/expired|discarded|unknown session|not found/i);
    // The refusal IS a 404, so the browser logs one failed resource — and that
    // is the only thing it may log. An uncaught exception here would mean the
    // page died on the refusal path instead of rendering it.
    expect(errors.filter((message) => !/status of 404/.test(message))).toEqual([]);
  });

  /**
   * A control in flight disables ITSELF and nothing else. The whole-surface
   * lock is the version that reads as "the page is stuck"; this is the one that
   * reads as "the thing I pressed is working".
   */
  test("a request in flight disables only the control that made it", async ({ page }) => {
    const errors = failOnPageErrors(page);
    await gotoCaptureState(page, server.baseUrl, FIXTURE_CAPTURE_TOKENS.photos);
    await page.getByRole("button", { name: "Review" }).click();
    // Park the pointer off-canvas. Playwright leaves the mouse where it
    // clicked, and Chromium reports `hover: hover`, so the bar's next control
    // would be photographed in a hover state that no phone can produce.
    await page.mouse.move(0, 0);

    // Hold the reorder response open so the in-flight state is observable.
    let release = (): void => {};
    const held = new Promise<void>((resolvePromise) => {
      release = resolvePromise;
    });
    await page.route("**/api/v1/capture/phone/order", async (route) => {
      await held;
      await route.continue();
    });

    const moveDownPageOne = page.getByRole("button", { name: "Move Page 1 of 3 later" });
    await moveDownPageOne.click();

    // The pressed pair is out; its siblings and the bar are not.
    await expect(moveDownPageOne).toBeDisabled();
    await expect(page.getByRole("button", { name: "Move Page 2 of 3 later" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Send 3 pages" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Remove" }).first()).toBeEnabled();

    release();
    // And the move really lands: page 1's bytes are now page 2's tile.
    await expect(moveDownPageOne).toBeEnabled();
    await expect(page.getByRole("listitem").nth(1))
      .toHaveAttribute("data-phone-photo-id", FIXTURE_CAPTURE_PHOTO_IDS[0]);
    expect(errors).toEqual([]);
  });

  /** The credential never leaves the fragment and the header (doc 11, D174). */
  test("sends the token only in its header, never in a url", async ({ page }) => {
    const requests: { url: string; token: string | undefined }[] = [];
    page.on("request", (request) => {
      if (!request.url().includes("/api/v1/capture/")) return;
      requests.push({ url: request.url(), token: request.headers()[CAPTURE_TOKEN_HEADER] });
    });
    await gotoCaptureState(page, server.baseUrl, FIXTURE_CAPTURE_TOKENS.photos);

    expect(requests.length).toBeGreaterThan(0);
    for (const request of requests) {
      expect(request.token, request.url).toBe(FIXTURE_CAPTURE_TOKENS.photos);
      expect(request.url).not.toContain(FIXTURE_CAPTURE_TOKENS.photos);
    }
    // Nor in the document's own title, which history and screen readers keep.
    expect(await page.title()).not.toContain(FIXTURE_CAPTURE_TOKENS.photos);
  });
});
