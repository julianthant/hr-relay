# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: archive-evidence.spec.ts >> graphite-warm @ 1280x720 >> verified archived capture evidence graphite-warm @ 1280x720
- Location: tests/parity/archive-evidence.spec.ts:216:5

# Error details

```
Error: expect(page).toHaveScreenshot(expected) failed

  39041 pixels (ratio 0.05 of all image pixels) are different.

  Snapshot: archive-evidence--graphite-warm--1280x720.png

Call log:
  - Expect "toHaveScreenshot(archive-evidence--graphite-warm--1280x720.png)" with timeout 5000ms
    - verifying given screenshot expectation
  - taking page screenshot
    - disabled all CSS animations
  - waiting for fonts to load...
  - fonts loaded
  - 39041 pixels (ratio 0.05 of all image pixels) are different.
  - waiting 100ms before taking screenshot
  - taking page screenshot
    - disabled all CSS animations
  - waiting for fonts to load...
  - fonts loaded
  - captured a stable screenshot
  - 39041 pixels (ratio 0.05 of all image pixels) are different.

```

# Test source

```ts
  61  | /**
  62  |  * Select the theme through the product's own contract, BEFORE navigation.
  63  |  *
  64  |  * ## The defect this replaces (2j, D187)
  65  |  *
  66  |  * `applyTheme` used to stamp `data-demo-theme` on `<html>` and `<body>` with a
  67  |  * post-navigation `page.evaluate`. That reached the portalled overlays and
  68  |  * nothing else, because `LoadedApp` renders its own `data-demo-theme={theme}`
  69  |  * on the app root and `tokens.css` scopes the whole palette off the bare
  70  |  * `[data-demo-theme=…]` selector — so the app root re-themed its entire
  71  |  * subtree from INSIDE, out of React state the harness never touched. Every
  72  |  * `paper-ink` reference in the corpus was photographed DARK, and the semantic
  73  |  * half agreed with the pixels: the toggle's accessible name read
  74  |  * "Switch to Paper Ink", which is what a DARK app says. The harness set a
  75  |  * theme, the product ignored it, and nothing compared the two — a check that
  76  |  * could not fail.
  77  |  *
  78  |  * Seeding `localStorage` before the first navigation makes `readStoredTheme()`
  79  |  * seed React state itself, so the app root, `<html>`, `<body>` and the toggle
  80  |  * label all agree because they all come from one value. It also removes the
  81  |  * fight with the shipped shell's hardcoded `class="dark"`, which the product
  82  |  * never has to win either.
  83  |  */
  84  | export async function installTheme(page: Page, theme: ParityTheme): Promise<void> {
  85  |   await page.addInitScript(
  86  |     ([key, attribute]) => {
  87  |       window.localStorage.setItem(String(key), String(attribute));
  88  |     },
  89  |     [DEMO_THEME_STORAGE_KEY, theme.attribute] as const,
  90  |   );
  91  | }
  92  | 
  93  | /**
  94  |  * Prove the product actually adopted the theme, on all three writers.
  95  |  *
  96  |  * This is the half whose absence hid the defect for the whole corpus. A
  97  |  * harness that selects a theme and does not verify it has only expressed a
  98  |  * preference. The app root is checked explicitly because it is the one that
  99  |  * wins the cascade.
  100 |  */
  101 | export async function assertThemeApplied(page: Page, theme: ParityTheme): Promise<void> {
  102 |   const observed = await page.evaluate(() => ({
  103 |     html: document.documentElement.getAttribute("data-demo-theme"),
  104 |     body: document.body.getAttribute("data-demo-theme"),
  105 |     // `[data-app-root]`, not `[data-parity-ready]`: D272 item 2 moved the theme
  106 |     // root ABOVE both providers so the toast viewport inherits its custom
  107 |     // properties, and the readiness flag stayed on the element below it.
  108 |     root: document.querySelector("[data-app-root]")?.getAttribute("data-demo-theme") ?? null,
  109 |   }));
  110 |   const disagreeing = Object.entries(observed)
  111 |     .filter(([, value]) => value !== theme.attribute)
  112 |     .map(([where, value]) => `${where}=${value ?? "absent"}`);
  113 |   if (disagreeing.length > 0) {
  114 |     throw new Error(
  115 |       `theme ${theme.name} (${theme.attribute}) was requested but ${disagreeing.join(", ")}; `
  116 |       + "the app root's own data-demo-theme scopes the whole palette, so a disagreement here "
  117 |       + "means the capture is photographing a theme nobody selected",
  118 |     );
  119 |   }
  120 | }
  121 | 
  122 | /**
  123 |  * The semantic half of a capture: read the accessibility tree and hold it to
  124 |  * its stored reference (or refresh it under an explicit PARITY_UPDATE=1).
  125 |  * Returns the reference name so the caller can address the pixel half.
  126 |  */
  127 | export async function captureA11yReference(
  128 |   page: A11ySnapshotSource,
  129 |   referencesDir: string,
  130 |   metadata: CaptureMetadata,
  131 | ): Promise<string> {
  132 |   const name = captureName(metadata);
  133 |   const tree = await page.locator("body").ariaSnapshot();
  134 |   if (tree.trim().length === 0) {
  135 |     throw new Error(`a11y snapshot for ${name} is empty; refusing to compare a screenshot without its semantic pair`);
  136 |   }
  137 |   assertOrUpdateParityReference({ referencesDir, tree, metadata });
  138 |   return name;
  139 | }
  140 | 
  141 | /**
  142 |  * One capture = one screenshot + one a11y snapshot + one metadata record.
  143 |  * The a11y snapshot is asserted FIRST: if the accessibility tree cannot be read
  144 |  * or no longer matches its reference the pair is incomplete, and no pixel
  145 |  * comparison result should stand in for a semantic one.
  146 |  */
  147 | export async function captureParityPair(
  148 |   page: Page,
  149 |   referencesDir: string,
  150 |   metadata: CaptureMetadata,
  151 |   /**
  152 |    * `fullPage` is for a page whose SUBJECT is taller than a viewport — the DS
  153 |    * specimen page, which is one scrolling column of every primitive in every
  154 |    * state and whose top 900px is a masthead. Every operator surface stays
  155 |    * `false`: the dashboard is a fixed shell that must fit, and a full-page shot
  156 |    * of one would photograph a scroll height instead of a layout.
  157 |    */
  158 |   options: Readonly<{ fullPage?: boolean }> = {},
  159 | ): Promise<void> {
  160 |   const name = await captureA11yReference(page, referencesDir, metadata);
> 161 |   await expect(page).toHaveScreenshot(`${name}.png`, {
      |                      ^ Error: expect(page).toHaveScreenshot(expected) failed
  162 |     fullPage: options.fullPage ?? false,
  163 |     animations: "disabled",
  164 |   });
  165 | }
  166 | 
  167 | /**
  168 |  * Reads the a11y tree without storing it — the dual-adapter comparison
  169 |  * (ref frontend-backend-integration §7.2) needs both adapters' trees in memory to assert they agree.
  170 |  */
  171 | export async function readA11yTree(page: A11ySnapshotSource): Promise<string> {
  172 |   return page.locator("body").ariaSnapshot();
  173 | }
  174 | 
```