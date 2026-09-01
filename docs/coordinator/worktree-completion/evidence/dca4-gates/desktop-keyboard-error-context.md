# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: archive-evidence.spec.ts >> desktop keyboard opens, closes with Escape, reopens and returns focus from footer Close
- Location: tests/parity/archive-evidence.spec.ts:231:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('dialog').getByText('Verified retained bytes for this frozen archived capture.')
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for getByRole('dialog').getByText('Verified retained bytes for this frozen archived capture.')

```

```yaml
- dialog "screenshot at ucpath-person":
  - banner:
    - heading "screenshot at ucpath-person" [level=2]
    - paragraph: Archived capture 1 of 1 on pl-170002-9999.
    - button "Close"
  - paragraph: This archive keeps the capture's POINTER facts frozen. The separate byte check is only for this exact archived id, digest, size and media type.
  - figure "Archived capture preview":
    - alert: Capture image could not be displayed The retained image bytes were verified, but the browser could not load or decode this image.
  - text: What this capture was
  - term: Kind
  - definition: screenshot
  - term: Media type
  - definition: image/png
  - term: Size
  - definition: 3 KB (3281 bytes)
  - term: Pixel size
  - definition: 1440 × 900
  - term: Step
  - definition: ucpath-person
  - term: System
  - definition: ucpath
  - term: Why it was captured
  - definition: operator-request
  - term: Sensitivity
  - definition: redacted
  - term: Digest
  - definition: f3ede4591dd6034661d8d63aef43ce4734610be67edbc7e30ce68834ebcd3847
  - term: Artifact
  - definition: aa11bb22-000a-4000-8000-aa11bb22000a
  - term: Bundle
  - definition: aa11bb22-000b-4000-8000-aa11bb22000b
  - text: Declared retention Ordinary — declared for purge after Wed, Sep 2. Whether the bytes are still there is not something this record can see.
  - contentinfo:
    - text: Captured 10:00 AM · bundle aa11bb22
    - button "Previous capture" [disabled]
    - button "Next capture" [disabled]
    - link "Download":
      - /url: /artifacts/v1/archive/99999999-0009-4000-8000-999900000009/aa11bb22-000a-4000-8000-aa11bb22000a
    - button "Close"
```

# Test source

```ts
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
  208 |           node.decode = async () => {
  209 |             node.setAttribute("data-dca4-decode-started", "true");
  210 |             await released;
  211 |             await nativeDecode();
  212 |           };
  213 |         });
  214 |         bytes.release();
  215 |         await expect(preview.locator("img")).toHaveAttribute("data-dca4-decode-started", "true");
  216 |         await expect(dialog.getByText(SUCCESS)).toHaveCount(0);
  217 |         expect(await geometry()).toEqual(checking);
  218 |         await page.evaluate(() => { document.dispatchEvent(new Event("dca4-release-decode")); });
  219 |         await expect(dialog.getByText(SUCCESS)).toBeVisible();
  220 |         await expect(preview).toHaveAttribute("aria-busy", "false");
  221 |         expect(await geometry()).toEqual(checking);
  222 |         await expectFrozenMetadata(dialog);
  223 |       } finally {
  224 |         resource.release();
  225 |         bytes.release();
  226 |       }
  227 |     });
  228 |   });
  229 | }
  230 | 
  231 | test("desktop keyboard opens, closes with Escape, reopens and returns focus from footer Close", async ({ page }) => {
  232 |   await page.setViewportSize({ width: 1280, height: 720 });
  233 |   expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(false);
  234 |   const trigger = await openEvidence(page);
  235 |   await trigger.focus();
  236 |   await page.keyboard.press("Enter");
  237 |   const dialog = page.getByRole("dialog");
> 238 |   await expect(dialog.getByText(SUCCESS)).toBeVisible();
      |                                           ^ Error: expect(locator).toBeVisible() failed
  239 |   await expect.poll(() => dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  240 |   await page.keyboard.press("Escape");
  241 |   await expect(dialog).toHaveCount(0);
  242 |   await expect(trigger).toBeFocused();
  243 |   await page.keyboard.press("Enter");
  244 |   await expect(dialog.getByText(SUCCESS)).toBeVisible();
  245 |   await dialog.getByRole("button", { name: "Previous capture" }).focus();
  246 |   await page.keyboard.press("Tab");
  247 |   await expect(dialog.getByRole("button", { name: "Next capture" })).toBeFocused();
  248 |   await page.keyboard.press("Tab");
  249 |   await expect(dialog.getByRole("link", { name: "Download" })).toBeFocused();
  250 |   await page.keyboard.press("Tab");
  251 |   await expect(dialog.locator("footer").getByRole("button", { name: "Close", exact: true })).toBeFocused();
  252 |   await page.keyboard.press("Enter");
  253 |   await expect(dialog).toHaveCount(0);
  254 |   await expect(trigger).toBeFocused();
  255 | });
  256 | 
  257 | test("narrow viewport keeps the footer and preview inside the dialog", async ({ page }) => {
  258 |   await page.setViewportSize({ width: 1024, height: 768 });
  259 |   await (await openEvidence(page)).click();
  260 |   await expect(page.getByText(SUCCESS)).toBeVisible();
  261 |   await assertControlGeometry(page, false);
  262 | });
  263 | 
  264 | for (const refusal of ["missing", "corrupt", "request", "image-http", "decode"] as const) {
  265 |   test(`keeps frozen facts accessible for a visible ${refusal} refusal`, async ({ page }) => {
  266 |     const bytes = barrier();
  267 |     if (refusal === "missing" || refusal === "corrupt") {
  268 |       const response = ArchivedCaptureResourceWireSchema.parse({
  269 |         runId: RUN_ID,
  270 |         artifactId: CAPTURE.artifactId,
  271 |         resource: refusal === "missing"
  272 |           ? { state: "missing", reason: "The fixture store no longer holds these exact bytes." }
  273 |           : { state: "error", message: "The fixture bytes did not match this archived digest." },
  274 |       });
  275 |       await page.route(`**${RESOURCE_PATH}`, (route) => route.fulfill({ json: response }));
  276 |     } else if (refusal === "request") {
  277 |       await page.route(`**${RESOURCE_PATH}`, (route) => route.fulfill({ status: 503, json: WireErrorSchema.parse({
  278 |         state: "error", code: "ARCHIVE_FIXTURE_UNAVAILABLE", message: "The fixture archive service is unavailable.", retryable: true,
  279 |       }) }));
  280 |     } else if (refusal === "image-http") {
  281 |       await page.route(`**${BYTE_PATH}`, (route) => route.abort("failed"));
  282 |     } else {
  283 |       await page.route(`**${BYTE_PATH}`, async (route) => {
  284 |         const response = await route.fetch();
  285 |         await bytes.promise;
  286 |         await route.fulfill({ response });
  287 |       });
  288 |     }
  289 |     try {
  290 |       await (await openEvidence(page)).click();
  291 |       const dialog = page.getByRole("dialog");
  292 |       if (refusal === "decode") {
  293 |         await dialog.locator("img").evaluate((node) => {
  294 |           if (!(node instanceof HTMLImageElement)) throw new Error("the preview is not an image");
  295 |           node.decode = async () => { throw new Error("Fixture browser decoder refused this verified image."); };
  296 |         });
  297 |         bytes.release();
  298 |       }
  299 |       const title = {
  300 |         missing: "Capture bytes are missing", corrupt: "Capture bytes could not be verified",
  301 |         request: "Capture resource could not be read", "image-http": "Capture image could not be displayed",
  302 |         decode: "Capture image could not be displayed",
  303 |       }[refusal];
  304 |       await expect(dialog.getByText(title, { exact: true })).toBeVisible();
  305 |       await expect(dialog.getByText(SUCCESS)).toHaveCount(0);
  306 |       await expectFrozenMetadata(dialog);
  307 |       if (refusal === "image-http" || refusal === "decode") {
  308 |         await expect(dialog.getByRole("link", { name: "Download" })).toHaveAttribute("href", BYTE_PATH);
  309 |         await expect(dialog.locator("img")).toHaveAttribute("aria-hidden", "true");
  310 |       } else {
  311 |         await expect(dialog.getByRole("link", { name: "Download" })).toHaveCount(0);
  312 |       }
  313 |     } finally {
  314 |       bytes.release();
  315 |     }
  316 |   });
  317 | }
  318 | 
```