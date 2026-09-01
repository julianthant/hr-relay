# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: archive-evidence.spec.ts >> paper-ink @ phone-390x844 >> verified archived capture evidence paper-ink @ phone-390x844
- Location: tests/parity/archive-evidence.spec.ts:122:5

# Error details

```
Error: Close

expect(received).toBeGreaterThanOrEqual(expected)

Expected: >= 44
Received:    41.84375
```

# Test source

```ts
  7   | import { ensureParityBundle, PARITY_DIST_DIR } from "./helpers/bundle.js";
  8   | import { assertThemeApplied, captureParityPair, installTheme } from "./helpers/capture.js";
  9   | import { FIXTURE_APP_VERSION, FIXTURE_DAY, FIXTURE_DESCRIPTOR_HASH } from "./helpers/fixture-day.js";
  10  | import {
  11  |   FIXTURE_ARCHIVE_EVIDENCE_BYTES,
  12  |   FIXTURE_ARCHIVE_EVIDENCE_CAPTURE,
  13  |   FIXTURE_ARCHIVE_EVIDENCE_RUN,
  14  | } from "./helpers/fixture-archive-evidence.js";
  15  | import { startFixtureServer, type FixtureServer } from "./helpers/fixture-bff.js";
  16  | 
  17  | const REFERENCES = resolve(import.meta.dirname, "references");
  18  | const RUN_ID = FIXTURE_ARCHIVE_EVIDENCE_RUN.runId;
  19  | const CAPTURE = FIXTURE_ARCHIVE_EVIDENCE_CAPTURE;
  20  | const RESOURCE_PATH = `/api/v1/archive/${RUN_ID}/captures/${CAPTURE.artifactId}/resource`;
  21  | const BYTE_PATH = `/artifacts/v1/archive/${RUN_ID}/${CAPTURE.artifactId}`;
  22  | const SUCCESS = "Verified retained bytes for this frozen archived capture.";
  23  | let server: FixtureServer;
  24  | 
  25  | test.beforeAll(async () => {
  26  |   ensureParityBundle();
  27  |   server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" }, archiveScenario: "evidence" });
  28  | });
  29  | 
  30  | test.afterAll(async () => { await server.close(); });
  31  | 
  32  | async function openEvidence(page: Page): Promise<Locator> {
  33  |   await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY, archive: RUN_ID });
  34  |   await page.getByRole("tab", { name: "Evidence" }).click();
  35  |   return page.getByRole("button", { name: "What it was" });
  36  | }
  37  | 
  38  | async function expectFrozenMetadata(dialog: Locator): Promise<void> {
  39  |   const facts = dialog.locator("dl");
  40  |   await expect(facts).toContainText(CAPTURE.digest);
  41  |   await expect(facts).toContainText(CAPTURE.artifactId);
  42  |   await expect(facts).toContainText(CAPTURE.bundleId);
  43  |   await expect(facts).toContainText(`${String(CAPTURE.byteLength)} bytes`);
  44  |   await expect(facts).toContainText("image/png");
  45  |   await expect(facts).toContainText("1440 × 900");
  46  |   await expect(dialog.getByText("Declared retention", { exact: true })).toBeVisible();
  47  |   await expect(dialog).not.toContainText(/purged/iu);
  48  | }
  49  | 
  50  | async function settledDialog(dialog: Locator): Promise<void> {
  51  |   await expect(dialog).toHaveCSS("opacity", "1");
  52  |   await expect.poll(() => dialog.evaluate((node) => new DOMMatrixReadOnly(getComputedStyle(node).transform).a)).toBe(1);
  53  | }
  54  | 
  55  | function barrier() {
  56  |   let release: () => void = () => { throw new Error("fixture barrier has no release"); };
  57  |   const promise = new Promise<void>((resolve) => { release = resolve; });
  58  |   return { promise, release };
  59  | }
  60  | 
  61  | async function assertControlGeometry(page: Page, coarse: boolean): Promise<void> {
  62  |   const dialog = page.getByRole("dialog");
  63  |   await settledDialog(dialog);
  64  |   expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(coarse);
  65  |   const proof = await dialog.evaluate((node) => {
  66  |     const frame = node.getBoundingClientRect();
  67  |     const footer = node.querySelector("footer");
  68  |     const body = node.querySelector(".overflow-y-auto");
  69  |     if (!(footer instanceof HTMLElement) || !(body instanceof HTMLElement)) throw new Error("the capture dialog lost its body or footer");
  70  |     const controls = [...node.querySelectorAll("header button, footer button, footer a")];
  71  |     const rectangles = controls.map((control) => control.getBoundingClientRect());
  72  |     return {
  73  |       overflow: node.scrollWidth > node.clientWidth || footer.scrollWidth > footer.clientWidth,
  74  |       insideViewport: frame.left >= 0 && frame.right <= innerWidth && frame.top >= 0 && frame.bottom <= innerHeight,
  75  |       bodyClearOfFooter: body.getBoundingClientRect().bottom <= footer.getBoundingClientRect().top,
  76  |       controls: controls.map((control, index) => {
  77  |         const rect = rectangles[index];
  78  |         if (rect === undefined) throw new Error("the measured capture control disappeared");
  79  |         const ownsPoint = (x: number, y: number) => {
  80  |           const hit = document.elementFromPoint(x, y);
  81  |           return hit === control || (hit !== null && control.contains(hit));
  82  |         };
  83  |         return {
  84  |           name: control.getAttribute("aria-label") ?? control.textContent?.trim(),
  85  |           width: rect.width,
  86  |           height: rect.height,
  87  |           disabled: control.getAttribute("aria-disabled") === "true",
  88  |           inside: rect.left >= frame.left && rect.right <= frame.right && rect.top >= frame.top && rect.bottom <= frame.bottom,
  89  |           ownsEdges: [
  90  |             ownsPoint(rect.left + 1, rect.top + rect.height / 2), ownsPoint(rect.right - 1, rect.top + rect.height / 2),
  91  |             ownsPoint(rect.left + rect.width / 2, rect.top + 1), ownsPoint(rect.left + rect.width / 2, rect.bottom - 1),
  92  |           ].every(Boolean),
  93  |           overlaps: rectangles.filter((other, otherIndex) => otherIndex !== index
  94  |             && rect.left < other.right && rect.right > other.left && rect.top < other.bottom && rect.bottom > other.top).length,
  95  |         };
  96  |       }),
  97  |     };
  98  |   });
  99  |   expect(proof.overflow).toBe(false);
  100 |   expect(proof.insideViewport).toBe(true);
  101 |   expect(proof.bodyClearOfFooter).toBe(true);
  102 |   expect(proof.controls.map((control) => control.name)).toEqual(["Close", "Previous capture", "Next capture", "Download", "Close"]);
  103 |   for (const control of proof.controls) {
  104 |     expect(control.inside, control.name).toBe(true);
  105 |     expect(control.overlaps, control.name).toBe(0);
  106 |     if (coarse) {
> 107 |       expect(control.width, control.name).toBeGreaterThanOrEqual(44);
      |                                           ^ Error: Close
  108 |       expect(control.height, control.name).toBeGreaterThanOrEqual(44);
  109 |     }
  110 |     // End-of-walk controls are deliberately pointer-inert but retain their keyboard stop.
  111 |     if (!control.disabled) expect(control.ownsEdges, control.name).toBe(true);
  112 |   }
  113 | }
  114 | 
  115 | for (const view of [
  116 |   { viewport: { name: "1280x720", width: 1280, height: 720 }, theme: { name: "graphite-warm", attribute: "dark" } },
  117 |   { viewport: { name: "phone-390x844", width: 390, height: 844 }, theme: { name: "paper-ink", attribute: "light" } },
  118 | ] as const) {
  119 |   test.describe(`${view.theme.name} @ ${view.viewport.name}`, () => {
  120 |     const phone = view.viewport.name === "phone-390x844";
  121 |     test.use({ viewport: { width: view.viewport.width, height: view.viewport.height }, hasTouch: phone, isMobile: phone });
  122 |     test(`verified archived capture evidence ${view.theme.name} @ ${view.viewport.name}`, async ({ page }) => {
  123 |       await installTheme(page, view.theme);
  124 |       const trigger = await openEvidence(page);
  125 |       await assertThemeApplied(page, view.theme);
  126 |       await trigger.click();
  127 |       await expect(page.getByRole("dialog")).toBeVisible();
  128 |       const image = page.getByRole("img", { name: /^Archived screenshot captured /u });
  129 |       await expect(image).toBeVisible();
  130 |       const dimensions = await image.evaluate(async (node) => {
  131 |         if (!(node instanceof HTMLImageElement)) throw new Error("the archived capture preview was not an image");
  132 |         await node.decode();
  133 |         return { height: node.naturalHeight, width: node.naturalWidth };
  134 |       });
  135 |       expect(dimensions).toEqual({ height: 900, width: 1440 });
  136 |       const downloadLink = page.getByRole("link", { name: "Download" });
  137 |       await expect(downloadLink).toHaveAttribute("download", /archive-/u);
  138 |       await expect(downloadLink).toHaveAttribute(
  139 |         "href",
  140 |         BYTE_PATH,
  141 |       );
  142 |       const [download] = await Promise.all([
  143 |         page.waitForEvent("download"),
  144 |         downloadLink.click(),
  145 |       ]);
  146 |       const stream = await download.createReadStream();
  147 |       if (stream === null) throw new Error("the archive-evidence download produced no bytes");
  148 |       const chunks: Uint8Array[] = [];
  149 |       for await (const chunk of stream) {
  150 |         if (!(chunk instanceof Uint8Array)) throw new Error("the archive-evidence download produced a non-byte chunk");
  151 |         chunks.push(chunk);
  152 |       }
  153 |       expect(Buffer.concat(chunks)).toEqual(Buffer.from(FIXTURE_ARCHIVE_EVIDENCE_BYTES));
  154 |       await expect(page.getByText(SUCCESS)).toBeVisible();
  155 |       await expectFrozenMetadata(page.getByRole("dialog"));
  156 |       await assertControlGeometry(page, phone);
  157 | 
  158 |       await captureParityPair(page, REFERENCES, {
  159 |         stateId: "archive-evidence",
  160 |         viewport: view.viewport.name,
  161 |         theme: view.theme.name,
  162 |         adapter: "fixture",
  163 |         fixtureId: "archive-evidence-verified",
  164 |         descriptorHash: FIXTURE_DESCRIPTOR_HASH,
  165 |         appVersion: FIXTURE_APP_VERSION,
  166 |         capturedAt: FIXTURE_DAY,
  167 |         variant: "default",
  168 |       });
  169 |     });
  170 | 
  171 |     test("keeps frozen metadata stationary across resource, HTTP and decode readiness", async ({ page }) => {
  172 |       const resource = barrier();
  173 |       const bytes = barrier();
  174 |       await page.route(`**${RESOURCE_PATH}`, async (route) => {
  175 |         const response = await route.fetch();
  176 |         await resource.promise;
  177 |         await route.fulfill({ response });
  178 |       });
  179 |       await page.route(`**${BYTE_PATH}`, async (route) => {
  180 |         const response = await route.fetch();
  181 |         await bytes.promise;
  182 |         await route.fulfill({ response });
  183 |       });
  184 |       try {
  185 |         await (await openEvidence(page)).click();
  186 |         const dialog = page.getByRole("dialog");
  187 |         await settledDialog(dialog);
  188 |         await page.evaluate(() => document.fonts.ready.then(() => undefined));
  189 |         const preview = dialog.getByRole("figure", { name: "Archived capture preview" });
  190 |         const geometry = async () => ({
  191 |           preview: await preview.boundingBox(),
  192 |           metadata: await dialog.getByText("What this capture was", { exact: true }).boundingBox(),
  193 |         });
  194 |         const checking = await geometry();
  195 |         expect(checking.preview).not.toBeNull();
  196 |         expect(checking.metadata).not.toBeNull();
  197 |         await expect(preview).toHaveAttribute("aria-busy", "true");
  198 |         resource.release();
  199 |         await expect(dialog.getByRole("link", { name: "Download" })).toBeVisible();
  200 |         await expect(preview.locator("img")).toHaveAttribute("aria-hidden", "true");
  201 |         expect(await geometry()).toEqual(checking);
  202 |         await preview.locator("img").evaluate((node) => {
  203 |           if (!(node instanceof HTMLImageElement)) throw new Error("the preview is not an image");
  204 |           const nativeDecode = node.decode.bind(node);
  205 |           const released = new Promise<void>((resolve) => {
  206 |             document.addEventListener("dca4-release-decode", () => { resolve(); }, { once: true });
  207 |           });
```