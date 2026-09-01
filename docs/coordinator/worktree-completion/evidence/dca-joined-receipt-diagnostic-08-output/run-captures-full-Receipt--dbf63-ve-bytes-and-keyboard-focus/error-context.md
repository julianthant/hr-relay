# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: run-captures.spec.ts >> full Receipt keeps exact JPEG/data captures, native bytes and keyboard focus
- Location: tests/parity/run-captures.spec.ts:321:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false
```

# Test source

```ts
  31  |   });
  32  | });
  33  | 
  34  | test.afterAll(async () => { await server.close(); });
  35  | 
  36  | function captureRegion(page: Page): Locator {
  37  |   return page.getByRole("region", { name: "Run captures" });
  38  | }
  39  | 
  40  | async function openReceipt(page: Page, runId: string): Promise<Locator> {
  41  |   await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY, run: runId, section: "receipt" });
  42  |   const region = captureRegion(page);
  43  |   await expect(region).toBeVisible();
  44  |   return region;
  45  | }
  46  | 
  47  | function captureFor(runId: string, artifactId: string) {
  48  |   const section = FIXTURE_RUN_CAPTURE_SECTIONS[runId];
  49  |   if (section?.section !== "captures") throw new Error(`run ${runId} has no fixture capture section`);
  50  |   const capture = section.payload.artifacts.find(candidate => candidate.artifact.artifactId === artifactId);
  51  |   if (capture === undefined) throw new Error(`run ${runId} has no fixture capture ${artifactId}`);
  52  |   return capture;
  53  | }
  54  | 
  55  | async function expectDownloadedBytes(page: Page, link: Locator, artifactId: string): Promise<void> {
  56  |   const expected = EXPECTED_DOWNLOADS[artifactId];
  57  |   if (expected === undefined) throw new Error(`fixture bytes are missing for ${artifactId}`);
  58  |   const expectedUrl = `${server.baseUrl}/artifacts/v1/${artifactId}`;
  59  |   const expectedPathname = new URL(expectedUrl).pathname;
  60  |   const pageEvents: Array<Record<string, string | number | null>> = [];
  61  |   const onRequest = (request: import("@playwright/test").Request) => {
  62  |     if (request.url() === expectedUrl) pageEvents.push({ kind: "request", method: request.method(), url: request.url() });
  63  |   };
  64  |   const onResponse = (response: import("@playwright/test").Response) => {
  65  |     if (response.url() === expectedUrl) pageEvents.push({ kind: "response", method: response.request().method(),
  66  |       status: response.status(), url: response.url() });
  67  |   };
  68  |   const onRequestFinished = (request: import("@playwright/test").Request) => {
  69  |     if (request.url() === expectedUrl) pageEvents.push({ kind: "requestfinished", method: request.method(), url: request.url() });
  70  |   };
  71  |   const onRequestFailed = (request: import("@playwright/test").Request) => {
  72  |     if (request.url() === expectedUrl) pageEvents.push({ kind: "requestfailed", errorText: request.failure()?.errorText ?? null,
  73  |       method: request.method(), url: request.url() });
  74  |   };
  75  |   page.on("request", onRequest);
  76  |   page.on("response", onResponse);
  77  |   page.on("requestfinished", onRequestFinished);
  78  |   page.on("requestfailed", onRequestFailed);
  79  |   const exchangesBefore = server.exchanges();
  80  |   let downloadUrl: string | null = null;
  81  |   let byteCount: number | null = null;
  82  |   let sha256: string | null = null;
  83  |   await expect(link).toHaveAttribute("href", expectedUrl);
  84  |   try {
  85  |     const [download] = await Promise.all([
  86  |       page.waitForEvent("download"),
  87  |       link.click(),
  88  |     ]);
  89  |     downloadUrl = download.url();
  90  |     expect(downloadUrl).toBe(expectedUrl);
  91  |     const stream = await download.createReadStream();
  92  |     if (stream === null) throw new Error(`capture download ${artifactId} produced no byte stream`);
  93  |     const chunks: Uint8Array[] = [];
  94  |     for await (const chunk of stream) {
  95  |       if (!(chunk instanceof Uint8Array)) throw new Error(`capture download ${artifactId} produced a non-byte chunk`);
  96  |       chunks.push(chunk);
  97  |     }
  98  |     const bytes = Buffer.concat(chunks);
  99  |     byteCount = bytes.byteLength;
  100 |     sha256 = createHash("sha256").update(bytes).digest("hex");
  101 |     expect(byteCount).toBe(expected.bytes);
  102 |     expect(sha256).toBe(expected.sha256);
  103 |     const clickExchanges = server.exchanges().slice(exchangesBefore.length)
  104 |       .filter(exchange => exchange.pathname === expectedPathname);
  105 |     expect(clickExchanges).toEqual([{ method: "GET", pathname: expectedPathname, status: 200 }]);
  106 |   } finally {
  107 |     page.off("request", onRequest);
  108 |     page.off("response", onResponse);
  109 |     page.off("requestfinished", onRequestFinished);
  110 |     page.off("requestfailed", onRequestFailed);
  111 |     const diagnosticPath = test.info().outputPath(`download-observer-${artifactId}.json`);
  112 |     await writeFile(diagnosticPath, `${JSON.stringify({ artifactId, byteCount, downloadUrl, expectedUrl,
  113 |       exchangesAfter: server.exchanges(), exchangesBefore, pageEvents, sha256 }, null, 2)}\n`, "utf8");
  114 |     await test.info().attach(`download-observer-${artifactId}.json`, { path: diagnosticPath, contentType: "application/json" });
  115 |   }
  116 | }
  117 | 
  118 | async function expectKeyboardFocus(target: Locator, scope?: Locator): Promise<void> {
  119 |   await expect(target).toBeFocused();
  120 |   if (scope !== undefined) expect(await scope.evaluate(node => node.contains(document.activeElement))).toBe(true);
  121 |   const ring = await target.evaluate(node => {
  122 |     const style = getComputedStyle(node);
  123 |     const width = Number.parseFloat(style.outlineWidth);
  124 |     const offset = Number.parseFloat(style.outlineOffset);
  125 |     const rect = node.getBoundingClientRect();
  126 |     const outside = width + offset;
  127 |     return { visible: node.matches(":focus-visible"), style: style.outlineStyle, color: style.outlineColor,
  128 |       width, offset, inside: rect.left - outside >= 0 && rect.right + outside <= innerWidth
  129 |         && rect.top - outside >= 0 && rect.bottom + outside <= innerHeight };
  130 |   });
> 131 |   expect(ring.visible).toBe(true);
      |                        ^ Error: expect(received).toBe(expected) // Object.is equality
  132 |   expect(ring.style).toBe("solid");
  133 |   expect(ring.width).toBeGreaterThanOrEqual(2);
  134 |   expect(ring.offset).toBeGreaterThanOrEqual(1);
  135 |   expect(ring.color).not.toMatch(/^(?:transparent|rgba\(.+,\s*0\))$/u);
  136 |   expect(ring.inside).toBe(true);
  137 | }
  138 | 
  139 | /** Ordinary test-output evidence only: no golden name, reference write or URL normalization. */
  140 | async function attachRenderedEvidence(page: Page, name: string, expectedAccessibleRoot: string): Promise<void> {
  141 |   const pngPath = test.info().outputPath(`${name}.png`);
  142 |   await page.screenshot({ path: pngPath, fullPage: false, animations: "disabled" });
  143 |   await test.info().attach(`${name}.png`, { path: pngPath, contentType: "image/png" });
  144 |   const a11yPath = test.info().outputPath(`${name}.a11y.yml`);
  145 |   const snapshot = await page.locator("body").ariaSnapshot();
  146 |   expect(snapshot.length).toBeGreaterThan(0);
  147 |   expect(snapshot.split("\n").some(line => line.trim() === `- ${expectedAccessibleRoot}`)).toBe(true);
  148 |   await writeFile(a11yPath, snapshot, "utf8");
  149 |   await test.info().attach(`${name}.a11y.yml`, { path: a11yPath, contentType: "text/yaml" });
  150 | }
  151 | 
  152 | async function expectTargetGeometry(page: Page, scope: Locator, coarse: boolean): Promise<void> {
  153 |   expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(coarse);
  154 |   const proof = await scope.locator("button:visible, a:visible").evaluateAll(nodes => {
  155 |     const controls = nodes.filter((node): node is HTMLElement => node instanceof HTMLElement);
  156 |     const rectangles = controls.map(control => control.getBoundingClientRect());
  157 |     const allInteractive = [...document.querySelectorAll("button, a[href]")].flatMap(control => {
  158 |       if (!(control instanceof HTMLElement)) return [];
  159 |       const rect = control.getBoundingClientRect();
  160 |       const style = getComputedStyle(control);
  161 |       return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" ? [{ control, rect }] : [];
  162 |     });
  163 |     const effective = rectangles.map(rect => ({ left: rect.left + rect.width / 2 - 22,
  164 |       right: rect.left + rect.width / 2 + 22, top: rect.top + rect.height / 2 - 22,
  165 |       bottom: rect.top + rect.height / 2 + 22 }));
  166 |     return controls.map((control, index) => {
  167 |       const rect = rectangles[index];
  168 |       const target = effective[index];
  169 |       if (rect === undefined || target === undefined) throw new Error("a capture control disappeared during geometry collection");
  170 |       const owns = (x: number, y: number) => {
  171 |         const hit = document.elementFromPoint(x, y);
  172 |         return hit === control || (hit !== null && control.contains(hit));
  173 |       };
  174 |       const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  175 |       const targetPoints: Array<readonly [number, number]> = [];
  176 |       for (let x = center.x - 21; x <= center.x + 21; x += 2) {
  177 |         for (let y = center.y - 21; y <= center.y + 21; y += 2) targetPoints.push([x, y]);
  178 |       }
  179 |       const pseudoInactive = ["::before", "::after"].every(pseudo => {
  180 |         const style = getComputedStyle(control, pseudo);
  181 |         return style.content === "none" || style.content === "normal" || style.pointerEvents === "none";
  182 |       });
  183 |       return {
  184 |         name: control.getAttribute("aria-label") ?? control.textContent?.trim(),
  185 |         width: rect.width,
  186 |         height: rect.height,
  187 |         inside: target.left >= 0 && target.right <= innerWidth && target.top >= 0 && target.bottom <= innerHeight,
  188 |         ownsEdges: [
  189 |           owns(rect.left + 1, rect.top + rect.height / 2),
  190 |           owns(rect.right - 1, rect.top + rect.height / 2),
  191 |           owns(rect.left + rect.width / 2, rect.top + 1),
  192 |           owns(rect.left + rect.width / 2, rect.bottom - 1),
  193 |         ].every(Boolean),
  194 |         ownsTarget: targetPoints.every(point => owns(point[0], point[1])),
  195 |         pseudoInactive,
  196 |         overlaps: effective.filter((other, otherIndex) => otherIndex !== index
  197 |           && target.left < other.right && target.right > other.left
  198 |           && target.top < other.bottom && target.bottom > other.top).length,
  199 |         foreignOverlaps: allInteractive.filter(other => other.control !== control
  200 |           && target.left < other.rect.right && target.right > other.rect.left
  201 |           && target.top < other.rect.bottom && target.bottom > other.rect.top).length,
  202 |       };
  203 |     });
  204 |   });
  205 |   expect(proof.length).toBeGreaterThan(0);
  206 |   for (const control of proof) {
  207 |     expect(control.inside, control.name).toBe(true);
  208 |     expect(control.ownsEdges, control.name).toBe(true);
  209 |     expect(control.overlaps, control.name).toBe(0);
  210 |     expect(control.width, control.name).toBeGreaterThan(0);
  211 |     expect(control.height, control.name).toBeGreaterThan(0);
  212 |     if (coarse) {
  213 |       expect(control.width, control.name).toBeGreaterThanOrEqual(44);
  214 |       expect(control.height, control.name).toBeGreaterThanOrEqual(44);
  215 |       expect(control.ownsTarget, control.name).toBe(true);
  216 |       expect(control.pseudoInactive, control.name).toBe(true);
  217 |       expect(control.foreignOverlaps, control.name).toBe(0);
  218 |     }
  219 |   }
  220 | }
  221 | 
  222 | async function recordPhoneGeometry(page: Page, tile: Locator, name: string): Promise<void> {
  223 |   const workflowPanelCount = await page.getByRole("dialog", { name: "Workflow Panel", exact: true }).count();
  224 |   const geometry = await tile.evaluate(async node => {
  225 |     if (!(node instanceof HTMLElement)) throw new Error("phone geometry observer lost its capture tile");
  226 |     const rectShape = (rect: DOMRect) => ({ bottom: rect.bottom, height: rect.height, left: rect.left,
  227 |       right: rect.right, top: rect.top, width: rect.width });
  228 |     const controls = [...node.querySelectorAll("button, a[href]")].flatMap(control => {
  229 |       if (!(control instanceof HTMLElement)) return [];
  230 |       const rect = control.getBoundingClientRect();
  231 |       const target = { bottom: rect.top + rect.height / 2 + 22, left: rect.left + rect.width / 2 - 22,
```