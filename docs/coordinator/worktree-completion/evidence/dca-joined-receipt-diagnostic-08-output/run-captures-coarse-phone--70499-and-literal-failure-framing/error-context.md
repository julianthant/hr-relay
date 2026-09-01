# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: run-captures.spec.ts >> coarse phone Receipt >> short Receipt preserves all origins and literal failure framing
- Location: tests/parity/run-captures.spec.ts:379:3

# Error details

```
Error: Open capture 00000000-0000-4000-8000-00000000c101

expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false
```

# Test source

```ts
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
  131 |   expect(ring.visible).toBe(true);
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
> 207 |     expect(control.inside, control.name).toBe(true);
      |                                          ^ Error: Open capture 00000000-0000-4000-8000-00000000c101
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
  232 |         right: rect.left + rect.width / 2 + 22, top: rect.top + rect.height / 2 - 22 };
  233 |       return [{ actual: rectShape(rect), effective44: target,
  234 |         failedEdges: [target.left < 0 ? "left" : null, target.right > innerWidth ? "right" : null,
  235 |           target.top < 0 ? "top" : null, target.bottom > innerHeight ? "bottom" : null].filter(Boolean),
  236 |         name: control.getAttribute("aria-label") ?? control.textContent?.trim() ?? "unnamed" }];
  237 |     });
  238 |     const ancestors: Array<Record<string, unknown>> = [];
  239 |     for (let current: HTMLElement | null = node; current !== null; current = current.parentElement) {
  240 |       const style = getComputedStyle(current);
  241 |       ancestors.push({ className: current.className, clientHeight: current.clientHeight, clientWidth: current.clientWidth,
  242 |         id: current.id, overflowX: style.overflowX, overflowY: style.overflowY, rect: rectShape(current.getBoundingClientRect()),
  243 |         role: current.getAttribute("role"), scrollHeight: current.scrollHeight, scrollLeft: current.scrollLeft,
  244 |         scrollTop: current.scrollTop, scrollWidth: current.scrollWidth, tagName: current.tagName, transform: style.transform });
  245 |     }
  246 |     const intersection = await new Promise<Readonly<{ boundingClientRect: ReturnType<typeof rectShape>;
  247 |       intersectionRatio: number; intersectionRect: ReturnType<typeof rectShape>; isIntersecting: boolean }>>(resolve => {
  248 |       const observer = new IntersectionObserver(entries => {
  249 |         const entry = entries[0];
  250 |         observer.disconnect();
  251 |         if (entry === undefined) throw new Error("phone geometry observer received no intersection entry");
  252 |         resolve({ boundingClientRect: rectShape(entry.boundingClientRect), intersectionRatio: entry.intersectionRatio,
  253 |           intersectionRect: rectShape(entry.intersectionRect), isIntersecting: entry.isIntersecting });
  254 |       });
  255 |       observer.observe(node);
  256 |     });
  257 |     return { ancestors, controls, devicePixelRatio, documentScroll: { x: scrollX, y: scrollY }, intersection,
  258 |       tile: rectShape(node.getBoundingClientRect()), viewport: { height: innerHeight, width: innerWidth } };
  259 |   });
  260 |   const jsonPath = test.info().outputPath(`${name}.json`);
  261 |   await writeFile(jsonPath, `${JSON.stringify({ ...geometry, workflowPanelCount }, null, 2)}\n`, "utf8");
  262 |   await test.info().attach(`${name}.json`, { path: jsonPath, contentType: "application/json" });
  263 |   const pngPath = test.info().outputPath(`${name}.png`);
  264 |   await page.screenshot({ path: pngPath, fullPage: false, animations: "disabled" });
  265 |   await test.info().attach(`${name}.png`, { path: pngPath, contentType: "image/png" });
  266 | }
  267 | 
  268 | async function expectDangerFrame(scope: Locator): Promise<void> {
  269 |   const proof = await scope.evaluate(node => {
  270 |     if (!(node instanceof HTMLElement)) throw new Error("the failure frame is not an HTML element");
  271 |     const style = getComputedStyle(node);
  272 |     const canvas = document.createElement("canvas");
  273 |     canvas.width = 1;
  274 |     canvas.height = 1;
  275 |     const context = canvas.getContext("2d", { colorSpace: "srgb" });
  276 |     if (context === null) throw new Error("failure-frame color proof needs a canvas context");
  277 |     const sample = (color: string) => {
  278 |       if (!CSS.supports("color", color)) throw new Error(`failure-frame proof received unresolved color ${color}`);
  279 |       context.clearRect(0, 0, 1, 1);
  280 |       context.fillStyle = color;
  281 |       context.fillRect(0, 0, 1, 1);
  282 |       return [...context.getImageData(0, 0, 1, 1).data];
  283 |     };
  284 |     const luminance = (rgba: number[]) => {
  285 |       const linear = rgba.slice(0, 3).map(channel => {
  286 |         const value = channel / 255;
  287 |         return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  288 |       });
  289 |       return (linear[0] ?? 0) * 0.2126 + (linear[1] ?? 0) * 0.7152 + (linear[2] ?? 0) * 0.0722;
  290 |     };
  291 |     const composite = (foreground: number[], backdrop: number[]) => {
  292 |       const frontAlpha = (foreground[3] ?? 0) / 255;
  293 |       const backAlpha = (backdrop[3] ?? 0) / 255;
  294 |       const alpha = frontAlpha + backAlpha * (1 - frontAlpha);
  295 |       if (alpha <= 0) return [0, 0, 0, 0];
  296 |       const channel = (index: number) => Math.round((((foreground[index] ?? 0) * frontAlpha)
  297 |         + ((backdrop[index] ?? 0) * backAlpha * (1 - frontAlpha))) / alpha);
  298 |       return [channel(0), channel(1), channel(2), Math.round(alpha * 255)];
  299 |     };
  300 |     const border = sample(style.borderTopColor);
  301 |     const declaredDanger = sample(style.getPropertyValue("--ds-danger").trim());
  302 |     const declaredOrdinary = sample(style.getPropertyValue("--ds-border").trim());
  303 |     const backgroundLayers: number[][] = [];
  304 |     for (let current: HTMLElement | null = node; current !== null; current = current.parentElement) {
  305 |       backgroundLayers.push(sample(getComputedStyle(current).backgroundColor));
  306 |     }
  307 |     let background = [0, 0, 0, 0];
```