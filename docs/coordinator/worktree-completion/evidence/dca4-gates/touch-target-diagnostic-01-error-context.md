# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: archive-evidence.spec.ts >> paper-ink @ phone-390x844 >> verified archived capture evidence paper-ink @ phone-390x844
- Location: tests/parity/archive-evidence.spec.ts:175:5

# Error details

```
Error: Close

expect(received).toBeGreaterThanOrEqual(expected)

Expected: >= 44
Received:    41.84375
```

# Test source

```ts
  60  | 
  61  | async function assertControlGeometry(page: Page, coarse: boolean, observe = false): Promise<void> {
  62  |   const dialog = page.getByRole("dialog");
  63  |   await settledDialog(dialog);
  64  |   expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(coarse);
  65  |   const proof = await dialog.evaluate((node, observe) => {
  66  |     const frame = node.getBoundingClientRect();
  67  |     const footer = node.querySelector("footer");
  68  |     const body = node.querySelector(".overflow-y-auto");
  69  |     if (!(footer instanceof HTMLElement) || !(body instanceof HTMLElement)) throw new Error("the capture dialog lost its body or footer");
  70  |     const controls = [...node.querySelectorAll("header button, footer button, footer a")];
  71  |     const rectangles = controls.map((control) => control.getBoundingClientRect());
  72  |     // [DEBUG-dca4-touch] Temporary observation only; removed after the one allocated phone case.
  73  |     const observedNodes = new Set<Element>();
  74  |     if (observe) {
  75  |       for (const control of controls) {
  76  |         let ancestor: Element | null = control;
  77  |         while (ancestor !== null && observedNodes.size < 24) {
  78  |           observedNodes.add(ancestor);
  79  |           ancestor = ancestor.parentElement;
  80  |         }
  81  |       }
  82  |     }
  83  |     const describe = (element: Element) => ({
  84  |       tag: element.tagName.toLowerCase(),
  85  |       region: element.closest("header") !== null ? "header" : element.closest("footer") !== null ? "footer" : "outside-controls",
  86  |       name: element.getAttribute("aria-label") ?? (controls.includes(element) ? element.textContent?.trim() : null),
  87  |       className: element.getAttribute("class"),
  88  |     });
  89  |     const diagnostic = observe ? {
  90  |       viewport: { width: innerWidth, height: innerHeight, coarse: matchMedia("(pointer: coarse)").matches,
  91  |         visualScale: visualViewport?.scale, devicePixelRatio },
  92  |       root: { fontSize: getComputedStyle(document.documentElement).fontSize,
  93  |         spacing: getComputedStyle(document.documentElement).getPropertyValue("--spacing") },
  94  |       nodes: [...observedNodes].map((element) => {
  95  |         const style = getComputedStyle(element);
  96  |         const rect = element.getBoundingClientRect();
  97  |         const pseudo = (name: string) => {
  98  |           const value = getComputedStyle(element, name);
  99  |           return { content: value.content, width: value.width, height: value.height,
  100 |             position: value.position, pointerEvents: value.pointerEvents, inset: value.inset };
  101 |         };
  102 |         return {
  103 |           identity: describe(element), parent: element.parentElement === null ? null : describe(element.parentElement),
  104 |           rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
  105 |           layout: element instanceof HTMLElement ? { offsetWidth: element.offsetWidth, offsetHeight: element.offsetHeight,
  106 |             clientWidth: element.clientWidth, scrollWidth: element.scrollWidth } : null,
  107 |           computed: { width: style.width, minWidth: style.minWidth, maxWidth: style.maxWidth,
  108 |             height: style.height, minHeight: style.minHeight, boxSizing: style.boxSizing,
  109 |             padding: style.padding, borderWidth: style.borderWidth, display: style.display,
  110 |             flexBasis: style.flexBasis, flexGrow: style.flexGrow, flexShrink: style.flexShrink,
  111 |             flexWrap: style.flexWrap, gap: style.gap, fontSize: style.fontSize,
  112 |             transform: style.transform, scale: style.scale, translate: style.translate, zoom: style.zoom,
  113 |             transitionDuration: style.transitionDuration, transitionProperty: style.transitionProperty },
  114 |           animations: element.getAnimations().map((animation) => ({
  115 |             playState: animation.playState, currentTime: animation.currentTime,
  116 |             timing: animation.effect?.getComputedTiming(),
  117 |           })),
  118 |           before: pseudo("::before"), after: pseudo("::after"),
  119 |         };
  120 |       }),
  121 |     } : undefined;
  122 |     return {
  123 |       diagnostic,
  124 |       overflow: node.scrollWidth > node.clientWidth || footer.scrollWidth > footer.clientWidth,
  125 |       insideViewport: frame.left >= 0 && frame.right <= innerWidth && frame.top >= 0 && frame.bottom <= innerHeight,
  126 |       bodyClearOfFooter: body.getBoundingClientRect().bottom <= footer.getBoundingClientRect().top,
  127 |       controls: controls.map((control, index) => {
  128 |         const rect = rectangles[index];
  129 |         if (rect === undefined) throw new Error("the measured capture control disappeared");
  130 |         const ownsPoint = (x: number, y: number) => {
  131 |           const hit = document.elementFromPoint(x, y);
  132 |           return hit === control || (hit !== null && control.contains(hit));
  133 |         };
  134 |         return {
  135 |           identity: observe ? describe(control) : undefined,
  136 |           name: control.getAttribute("aria-label") ?? control.textContent?.trim(),
  137 |           width: rect.width,
  138 |           height: rect.height,
  139 |           disabled: control.getAttribute("aria-disabled") === "true",
  140 |           inside: rect.left >= frame.left && rect.right <= frame.right && rect.top >= frame.top && rect.bottom <= frame.bottom,
  141 |           ownsEdges: [
  142 |             ownsPoint(rect.left + 1, rect.top + rect.height / 2), ownsPoint(rect.right - 1, rect.top + rect.height / 2),
  143 |             ownsPoint(rect.left + rect.width / 2, rect.top + 1), ownsPoint(rect.left + rect.width / 2, rect.bottom - 1),
  144 |           ].every(Boolean),
  145 |           overlaps: rectangles.filter((other, otherIndex) => otherIndex !== index
  146 |             && rect.left < other.right && rect.right > other.left && rect.top < other.bottom && rect.bottom > other.top).length,
  147 |         };
  148 |       }),
  149 |     };
  150 |   }, observe);
  151 |   if (observe) console.log("[DEBUG-dca4-touch] " + JSON.stringify(proof));
  152 |   expect(proof.overflow).toBe(false);
  153 |   expect(proof.insideViewport).toBe(true);
  154 |   expect(proof.bodyClearOfFooter).toBe(true);
  155 |   expect(proof.controls.map((control) => control.name)).toEqual(["Close", "Previous capture", "Next capture", "Download", "Close"]);
  156 |   for (const control of proof.controls) {
  157 |     expect(control.inside, control.name).toBe(true);
  158 |     expect(control.overlaps, control.name).toBe(0);
  159 |     if (coarse) {
> 160 |       expect(control.width, control.name).toBeGreaterThanOrEqual(44);
      |                                           ^ Error: Close
  161 |       expect(control.height, control.name).toBeGreaterThanOrEqual(44);
  162 |     }
  163 |     // End-of-walk controls are deliberately pointer-inert but retain their keyboard stop.
  164 |     if (!control.disabled) expect(control.ownsEdges, control.name).toBe(true);
  165 |   }
  166 | }
  167 | 
  168 | for (const view of [
  169 |   { viewport: { name: "1280x720", width: 1280, height: 720 }, theme: { name: "graphite-warm", attribute: "dark" } },
  170 |   { viewport: { name: "phone-390x844", width: 390, height: 844 }, theme: { name: "paper-ink", attribute: "light" } },
  171 | ] as const) {
  172 |   test.describe(`${view.theme.name} @ ${view.viewport.name}`, () => {
  173 |     const phone = view.viewport.name === "phone-390x844";
  174 |     test.use({ viewport: { width: view.viewport.width, height: view.viewport.height }, hasTouch: phone, isMobile: phone });
  175 |     test(`verified archived capture evidence ${view.theme.name} @ ${view.viewport.name}`, async ({ page }) => {
  176 |       await installTheme(page, view.theme);
  177 |       const trigger = await openEvidence(page);
  178 |       await assertThemeApplied(page, view.theme);
  179 |       await trigger.click();
  180 |       await expect(page.getByRole("dialog")).toBeVisible();
  181 |       const image = page.getByRole("img", { name: /^Archived screenshot captured /u });
  182 |       await expect(image).toBeVisible();
  183 |       const dimensions = await image.evaluate(async (node) => {
  184 |         if (!(node instanceof HTMLImageElement)) throw new Error("the archived capture preview was not an image");
  185 |         await node.decode();
  186 |         return { height: node.naturalHeight, width: node.naturalWidth };
  187 |       });
  188 |       expect(dimensions).toEqual({ height: 900, width: 1440 });
  189 |       const downloadLink = page.getByRole("link", { name: "Download" });
  190 |       await expect(downloadLink).toHaveAttribute("download", /archive-/u);
  191 |       await expect(downloadLink).toHaveAttribute(
  192 |         "href",
  193 |         BYTE_PATH,
  194 |       );
  195 |       const [download] = await Promise.all([
  196 |         page.waitForEvent("download"),
  197 |         downloadLink.click(),
  198 |       ]);
  199 |       const stream = await download.createReadStream();
  200 |       if (stream === null) throw new Error("the archive-evidence download produced no bytes");
  201 |       const chunks: Uint8Array[] = [];
  202 |       for await (const chunk of stream) {
  203 |         if (!(chunk instanceof Uint8Array)) throw new Error("the archive-evidence download produced a non-byte chunk");
  204 |         chunks.push(chunk);
  205 |       }
  206 |       expect(Buffer.concat(chunks)).toEqual(Buffer.from(FIXTURE_ARCHIVE_EVIDENCE_BYTES));
  207 |       await expect(page.getByText(SUCCESS)).toBeVisible();
  208 |       await expectFrozenMetadata(page.getByRole("dialog"));
  209 |       await assertControlGeometry(page, phone, phone);
  210 | 
  211 |       await captureParityPair(page, REFERENCES, {
  212 |         stateId: "archive-evidence",
  213 |         viewport: view.viewport.name,
  214 |         theme: view.theme.name,
  215 |         adapter: "fixture",
  216 |         fixtureId: "archive-evidence-verified",
  217 |         descriptorHash: FIXTURE_DESCRIPTOR_HASH,
  218 |         appVersion: FIXTURE_APP_VERSION,
  219 |         capturedAt: FIXTURE_DAY,
  220 |         variant: "default",
  221 |       });
  222 |     });
  223 | 
  224 |     test("keeps frozen metadata stationary across resource, HTTP and decode readiness", async ({ page }) => {
  225 |       const resource = barrier();
  226 |       const bytes = barrier();
  227 |       await page.route(`**${RESOURCE_PATH}`, async (route) => {
  228 |         const response = await route.fetch();
  229 |         await resource.promise;
  230 |         await route.fulfill({ response });
  231 |       });
  232 |       await page.route(`**${BYTE_PATH}`, async (route) => {
  233 |         const response = await route.fetch();
  234 |         await bytes.promise;
  235 |         await route.fulfill({ response });
  236 |       });
  237 |       try {
  238 |         await (await openEvidence(page)).click();
  239 |         const dialog = page.getByRole("dialog");
  240 |         await settledDialog(dialog);
  241 |         await page.evaluate(() => document.fonts.ready.then(() => undefined));
  242 |         const preview = dialog.getByRole("figure", { name: "Archived capture preview" });
  243 |         const geometry = async () => ({
  244 |           preview: await preview.boundingBox(),
  245 |           metadata: await dialog.getByText("What this capture was", { exact: true }).boundingBox(),
  246 |         });
  247 |         const checking = await geometry();
  248 |         expect(checking.preview).not.toBeNull();
  249 |         expect(checking.metadata).not.toBeNull();
  250 |         await expect(preview).toHaveAttribute("aria-busy", "true");
  251 |         resource.release();
  252 |         await expect(dialog.getByRole("link", { name: "Download" })).toBeVisible();
  253 |         await expect(preview.locator("img")).toHaveAttribute("aria-hidden", "true");
  254 |         expect(await geometry()).toEqual(checking);
  255 |         await preview.locator("img").evaluate((node) => {
  256 |           if (!(node instanceof HTMLImageElement)) throw new Error("the preview is not an image");
  257 |           const nativeDecode = node.decode.bind(node);
  258 |           const released = new Promise<void>((resolve) => {
  259 |             document.addEventListener("dca4-release-decode", () => { resolve(); }, { once: true });
  260 |           });
```
