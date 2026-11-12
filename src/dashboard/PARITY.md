# Dashboard parity suite

`npm run test:parity` runs Playwright with `playwright.parity.config.ts`; its exit code is the result. The suite checks
keyboard, focus, loading, geometry and interaction behavior in a real browser with mock values, and renders `/ui-mock`
scenes. It stores no screenshot or accessibility references. It does not prove live workflow or service readiness.

## Run and filter

```sh
npm run test:parity
npm run test:parity -- frontend-controls.test.ts
npm run test:parity -- --grep "keyboard-only"
```

Use the matching surface spec for a focused check. Shared shell, tokens, primitives, and models
need the full suite at the assigned gate. Filters are forwarded to Playwright.

## Configuration and isolation

The default lane is headless Chromium, 1280×720, device scale factor 1, no touch, and no mobile
emulation. Default scenes use the `graphite-warm` theme with `data-demo-theme="dark"`.
It uses up to four workers locally, bounded by available CPUs, and two per CI shard, `fullyParallel: true`, no
retries, and a 120-second test timeout. Fixture processes and browsers use `America/Los_Angeles`.
Individual desktop interaction specs cover resize, zoom-related canvas behavior,
keyboard access, and reduced motion. `workflow-batches.test.ts` explicitly tests light and dark
outside the default theme. Do not add phone or coarse-pointer variants.

`tests/parity/helpers/global-setup.ts` builds or verifies the bundle once before workers start.
`helpers/bundle.ts` owns `dist/parity-dashboard` and its input stamp. Parity inputs include the
UI control fixtures under `tests/support/helpers/dashboard/controls/`; changing a fixture invalidates
the bundle. Per-spec
`ensureParityBundle()` checks the same proof. Fixture/seeded BFF servers use ephemeral ports and
owned temporary state rather than dashboard runtime ports or live HR state.
`helpers/workflow-composition.ts` selects the test composition explicitly.

## Read failures

Playwright writes test artifacts and `results.json` under `tests/parity/.output/`. CI uploads the
output directory, including failure screenshots and error contexts alongside the JSON report.

## Current presentation choices

These choices distinguish the dashboard from the original specimen/demo or retained backend
presentation.

- Search uses first Escape to clear a nonempty query and a second Escape to close.
- Intake dismisses through the header’s Close control; closing preserves the durable session.
- An unknown Explorer workflow offers Open Separations as its recovery destination.
- The desktop canvas stays side by side at 1024×720 and scrolls below the minimum.
- Queue uses mixed workflow rows, focus mode, one-line footers, `#attempt`, and plain trace text.
- Review is a blue decision pill; Done with warnings keeps short Done text plus a warning count.
- Logs uses ordered step/action blocks, an equal-width timeline, decision shortcuts, and an image workspace.
- The run header stays compact and omits a separate Data rail and Receipt tab.
- OCR Records is the document review body, with its floating control outside the document text.
- Standalone OCR has no downstream approval; delegated OCR holds downstream outcomes until approval.
- The launcher shares Input/Values, Options, Steps, and Confirm layouts without adding empty stages.
- Run and Rerun Options use card rows; Dry run starts off, browser mode is Headed, and Screenshots is locked Always on.
- Required reference types add spreadsheet and named-version rows. Confirm frames Plan, Input and declared Output groups; each stage starts at the top, and body scrolling keeps the header and footer in place.
- Reading steps allow typed manual values while form actions and required sign-in steps remain included.
- Settings uses a stationary rail/Navbar and body-scoped content, search, guarded exit, and child breadcrumbs.
- Settings places General/Account under Personal and Paths/Routes under Advanced; Performance remains reachable through Settings search.
- General shows the ChatGPT account port; provider budget/model, API-key, viewport, and version-bump controls are absent.
- Save feedback requires matching acknowledgment/readback and uses a value-free toast with retained inline recovery state.
- Sessions remains a strip with worker cards and controls behind its add-workers entry.
- Idle session cards show a white five-minute refresh ring only while idle and ready.
- Notifications has interactive local destinations and separate read state.
- Analytics uses duration coverage and exact-population drilldown rather than a labor-saving estimate.
- Explorer renders complete local workflow timelines and source disclosures with stable IDs.
- Spreadsheets uses the approved HUB library, inline spreadsheet types,
  separate reference-data and workflow-output tables, search and type filtering, named versions in a drawer,
  typed fields, selected header/column import, real XLSX workers and bounded editor history.
  The former Library/Types tabs and Date added column are absent.
- The HUB Assistant mounts in the shell. Product conversations use the served assistant controller with per-chat cancellation and account authority.
  Canonical selected-run actions require explicit Confirm and show their exact public plan. Confirmed starts and cancellations resolve in the thread; unknown outcomes retain the disabled card. Other proposals without issued action authority keep confirmation unavailable. Explicit parity composition retains the approved conversation and workflow
  samples; workbook registration and exact-version reads use the served library.
- Archive and UI catalog URLs show removal notices; their pages and Queue context menus are absent.
- Loading skeletons preserve the geometry of the surface they replace.

Julian approved the HUB-R4 composer over HUB-R3 on October 19, 2026 at 2:41 PM PT
(`relay-plan/briefs/HUB-WIRE-1.md`). The approved combined presentation inventory is 107 TSX files,
22 stylesheets and two theme modules (131 paths). The inventory test and exact path fixture own
that freeze. Legacy parity drivers follow the current visible controls; removed presentation
contracts are replaced with inclusion/exclusion, geometry, keyboard and interaction assertions.

## Verification rules

- Use deterministic synthetic image bytes for image fixtures.
- Build once before parallel workers; each server owns its port and state root.
- Assert a test's selector preconditions, not whatever element happens to be index zero.
- Measure geometry and hit boxes in the browser; a token or class list alone cannot establish the rendered size.
- Use desktop target/spacing checks and preserve keyboard access without restoring touch-only variants.
- Assert both inclusion and exclusion for a schema-bound tab, disclosure, unavailable state, or conditional mark.
- Count repeated facts and reasons when the requirement is one occurrence; presence alone cannot detect duplication.
- Prove an important reason without relying on `title`, and prove full text without a clipping container.
- Exercise the mounted control when correctness depends on wiring, dispatch identity, focus, or refresh/remount behavior.
- Focus a jsdom press target explicitly when testing focus; programmatic `click()` does not move focus there.
- Compare DOM identities as booleans instead of asking assertion formatting to inspect an entire live DOM tree.
- Keep fake transport tests at the subscription seam and real stream-ending classification tests at the transport seam.
- Preserve separate replay rules: patches at or below the held cursor are stale; same-cursor snapshots are valid replacements.
- Pin generation reset, superseded-stream settlement, and exact-cursor resume separately from row patch folds.
- Test request identity against late settlements as well as already-settled result invalidation.
- Keep a regression scoped to its row kind; unrelated note/fence pixels and accessible names remain unchanged.
- Verify every consumer of a shared record head and both reassuring and cautionary outcome arms.
- Pin schema-unrepresentable omissions with an assertion rather than inventing unreachable UI fixtures.
- Verify token definitions and runtime writers; CSS silently accepts undefined custom properties.
- Keep spacer arithmetic bound to actual row heights; render all rows before viewport measurement, clamp elastic overscroll, and reject non-finite measurements.
- Verify output counts, search, copy, selection, and cleanup when optimizing offscreen rendering; layout deferral does not bound memory.

See [DESIGN.md](DESIGN.md) for composition rules and
[the wiring contract](../../docs/reference/frontend-backend-integration.md) for producer acceptance.
