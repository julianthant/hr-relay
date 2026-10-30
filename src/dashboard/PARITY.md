# Dashboard parity suite

`npm run test:parity` runs `scripts/verify-parity-json.ts assert`, which launches Playwright with
`playwright.parity.config.ts` and validates the resulting JSON evidence. The suite checks the
presentation contract with mock values, plus keyboard, focus, loading, and interaction behavior.
It does not prove live workflow or service readiness.

## Run and filter

```sh
npm run test:parity
npm run test:parity -- frontend-controls.test.ts
npm run test:parity -- --grep "keyboard-only"
```

Use the matching surface spec for a focused check. Shared shell, tokens, primitives, and models
need the full suite at the assigned gate. Filters are forwarded to Playwright. Keep the configured
JSON reporter: the wrapper refuses `--reporter` overrides and JSON-output environment overrides.

`npm run test:parity:update` is the deliberate reference-update command. Use it only for an
operator-approved UI change, or a workflow's served-data switch after operator screen sign-off,
in a separate commit. Never refresh references to make wiring pass.

## Configuration and isolation

The default lane is headless Chromium, 1280×720, device scale factor 1, no touch, and no mobile
emulation. Default reference captures use the `graphite-warm` theme with `data-demo-theme="dark"`.
It uses two workers, `fullyParallel: true`, no retries, and a 120-second test timeout.
Individual desktop interaction specs cover resize, zoom-related canvas behavior,
keyboard access, and reduced motion. `workflow-batches.test.ts` explicitly tests light and dark
outside the default reference axis. Do not add phone or coarse-pointer variants.

`tests/parity/helpers/global-setup.ts` builds or verifies the bundle once before workers start.
`helpers/bundle.ts` owns `dist/parity-dashboard` and its input stamp. Per-spec
`ensureParityBundle()` checks the same proof. Fixture/seeded BFF servers use ephemeral ports and
owned temporary state rather than dashboard runtime ports or live HR state.
`helpers/workflow-composition.ts` selects the test composition explicitly.

## Reference files

`tests/parity/references/` contains a PNG, `.a11y.yml`, and `.meta.json` for each captured state.
Names use `stateId--theme--viewport` with an optional variant suffix. Metadata records the adapter,
fixture, descriptor hash, app version, viewport, theme, variant, and capture time.

Playwright compares screenshots with `maxDiffPixels: 0` and per-pixel `threshold: 0.2`.
The allowed count of changed pixels is zero. The threshold is a color-comparison tolerance;
a subtle uniform color change can remain below it, so token and semantic tests still matter.
`helpers/reference-store.ts` compares accessibility and metadata text byte for byte. Missing
references fail in assert mode. One update switch refreshes all halves together.

`helpers/reference-scenes.ts` and the surface scene modules name key captures.
`dashboard-reference.test.ts` covers shell scenes and access variants. `kit-reference.test.ts`
captures the real specimen full-page. Interaction specs assert transient behavior that a resting
screenshot cannot establish.

## Read failures

Playwright writes test artifacts and `results.json` under `tests/parity/.output/`. A pixel mismatch
includes the expected, actual, and diff images. Accessibility/metadata drift names the fixture,
theme, viewport, variant, reference path, and differing lines. Inspect both visual and semantic
halves before changing source.

The wrapper rejects stale or malformed JSON, unsafe report paths, missing required accessibility
attachments, duplicate evidence names, wrong digests, and non-passing required evidence producers.
The process exit and current report are both evidence; an old successful report cannot certify a
new run. Missing static `required-a11y-evidence` declarations or body-backed attachments fail.

## Current presentation choices

The checked-in references are the current expectation. These choices distinguish the dashboard
from the original specimen/demo or retained backend presentation; none permits a diff against the
current corpus.

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
- Fixed and editable Run Options share a field grid; Dry run starts off, browser mode is Headed, and workflow captures are required.
- Reading steps allow typed manual values while form actions and required sign-in steps remain included.
- Settings uses a stationary rail/Navbar and body-scoped content, search, guarded exit, and child breadcrumbs.
- Settings places General/Credentials under Personal and Paths/Routes under Advanced; Performance remains reachable through Settings search.
- General shows the ChatGPT account port; provider budget/model, API-key, viewport, and version-bump controls are absent.
- Save feedback requires matching acknowledgment/readback and uses a value-free toast with retained inline recovery state.
- Sessions remains a strip with worker cards and controls behind its add-workers entry.
- Idle session cards show a white five-minute refresh ring only while idle and ready.
- Notifications has interactive local destinations and separate read state.
- Analytics uses duration coverage and exact-population drilldown rather than a labor-saving estimate.
- Explorer renders complete local workflow timelines and source disclosures with stable IDs.
- Spreadsheets uses the approved HUB library, inline spreadsheet types and Kronos report controls,
  versioned files, typed fields, selected header/column import, real XLSX workers and bounded editor history.
  The former Library/Types tabs, library search and Date added column are absent.
- The HUB Assistant mounts in the shell with a retained composer in Chat files. Product conversations use the served assistant controller with per-chat cancellation and account authority.
  Confirmation stays unavailable. Explicit parity composition retains the approved conversation and workflow
  samples; workbook registration and exact-version reads use the served library.
- Archive and UI catalog URLs show removal notices; their pages and Queue context menus are absent.
- Loading skeletons preserve the geometry of the surface they replace.

Julian approved the HUB-R4 composer over HUB-R3 on October 19, 2026 at 2:41 PM PT
(`relay-plan/briefs/HUB-WIRE-1.md`). The approved combined presentation inventory is 107 TSX files,
22 stylesheets and two theme modules (131 paths). The inventory test and exact path fixture own
that freeze. Legacy parity drivers follow the current visible controls; removed presentation
contracts are replaced with inclusion/exclusion, geometry, keyboard and interaction assertions.

## Verification rules

- Keep reference outputs separate from fixture inputs; use deterministic synthetic image bytes instead of reading mutable PNG references.
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
[the wiring contract](../../docs/rebuild/reference/frontend-backend-integration.md) for producer acceptance.
