# Mock scene runner

`npm run mocks` runs Playwright with `playwright.mocks.config.ts` to render `/ui-mock` scenes from the
mock dashboard build. It is not a test gate and CI never runs it. Dashboard behaviour is proven by
Vitest unit/integration tests, the `tests/smoke/` browser suite and `/verify` browser checks.

## Scenes

One row per scene file in `tests/mocks/`. Run one file alone: `npm run mocks -- --workers=1 <file>`. A frame folder is the
file's output variable, or `.work/mocks-output/<folder>` in the repo when the variable is unset.

| Surface | File | Scenes | Output variable |
| --- | --- | --- | --- |
| Log in, sign-up, Duo step, ready, Duo setup window | `onboarding-mock.test.ts` | `onboarding frames @ <theme> <width>`: 13 states (`ONBOARDING_SCENES` in `helpers/onboarding-scenes.tsx`) | `ONBOARDING_MOCK_OUT` |
| Spreadsheets detail with cell fills | `spreadsheets-fills-mock.test.ts` | `spreadsheet detail with cell fills @ <theme> <width>` | `SPREADSHEET_MOCK_OUT` |
| Spreadsheets library, sync states | `sweep-fixtures-workbooks.test.ts` | `served workbook library, General workbook and sync states` | `SWEEP_FIXTURES_OUT` |
| Analytics (done, failed, waiting runs) | `zz-status-mock.test.ts` | `analytics states @ <theme>` | `STATUS_MOCK_OUT` |
| Analytics read failure, account lost | `sweep-fixtures-account-analytics.test.ts` | `served Analytics read failure`, `account lost while a served Assistant proposal waits` | `SWEEP_FIXTURES_OUT` |
| Queue, run input, run dialog, Settings pages, Logs, toasts, kit | `zz-status-mock.test.ts` | `status mock`, `run input every workflow`, `settings pages`, `logs footer states`, `logs cards`, `sidebar collapse widens logs`, `command result toasts`, `command unknown toast`, `kit …`, `run dialog …`, `customize steps every workflow` | `STATUS_MOCK_OUT` |
| Needs Duo | `needs-duo-mock.test.ts` | `needs duo frames`, `served needs duo before/after` | `NEEDS_DUO_MOCK_OUT` |
| Failure notice | `failure-notice-mock.test.ts` | `failure notice frames` | `FAILURE_NOTICE_MOCK_OUT` |
| Notification centre, search palette | `notifications-mock.test.ts` | `notification centre`, `search palette`, `served notifications priority` | `NOTIFICATIONS_MOCK_OUT` |
| Run detail Logs, timeline strip, failure card | `notifications-sweep.test.ts` | `sweep` | `NOTIFICATIONS_MOCK_OUT` |
| Decision card | `notifications-sweep-decisions.test.ts` | `decision card ucpath-found` | `NOTIFICATIONS_MOCK_OUT` |
| Settings General, ChatGPT | `settings-general-chatgpt-mock.test.ts` | `general top frames` | `SETTINGS_GENERAL_CHATGPT_MOCK_OUT` |
| Check Fix destinations | `check-fix-destinations.test.ts` | `every Fix lands on its focused row…` | `CHECK_FIX_OUT` |
| Run dialog reference gate | `run-dialog-reference-gate.test.ts` | `Emergency Contact holds Continue until the roster is added` | `REFERENCE_GATE_OUT` |
| OCR review, member retry | `sweep-fixtures-ocr.test.ts` | `served OCR review`, `served OCR member-retry`, `served OCR parent Records opens the review` | `SWEEP_FIXTURES_OUT` |
| Run detail, dry-run preview, Logs over SSE | `sweep-fixtures-run-detail.test.ts` | four scenes plus `finished dry run shows its full preview region` (expected to fail until dry-run-preview-01 lands) | `SWEEP_FIXTURES_OUT` |
| Work Study queue, run input sentences, Sessions Needs Duo | `sweep-fixtures-shell.test.ts` | `served empty Work Study queue and page`, `served <workflow> input sentences`, `served Sessions Needs Duo` | `SWEEP_FIXTURES_OUT` |
| Assistant, Explorer | `zz-assistant-explorer-mock.test.ts` | `assistant explorer mock`, `assistant panel header, History and composer`, `assistant full access and Ask mark`, `Ask mark states video` | `AX_MOCK_OUT` |
| Entry harness, sessions bar, switches | `app-entry.test.ts`, `sessions-bar-hover.test.ts`, `switch-pointer-click.test.ts` | assertions only, no frames | none |

## Run

```sh
npm run mocks -- zz-status-mock.test.ts -g "<title>"
```

Each scene spec writes PNGs to the folder its environment variable names (for example
`STATUS_MOCK_OUT`). Run one scene at a time, serially, with one worker.

## Configuration and isolation

Headless Chromium, 1280×720, device scale factor 1, no touch, and no mobile emulation. Default scenes
use the `graphite-warm` theme with `data-demo-theme="dark"`. Fixture processes and browsers use
`America/Los_Angeles`.

`tests/mocks/helpers/global-setup.ts` builds or verifies the bundle once before workers start.
`helpers/bundle.ts` owns `dist/mock-dashboard` and its input stamp. Fixture/seeded BFF servers use
ephemeral ports and owned temporary state rather than dashboard runtime ports or live HR state.
`helpers/workflow-composition.ts` selects the test composition explicitly. `tests/mocks/app-entry.tsx`
sets the harness flag that `mockParam` in `src/dashboard/app/mock-surfaces.ts` reads, and
`helpers/workflow-composition.ts` hands the app its sample Analytics, Sessions, notifications, search and status frames through `WorkflowComposition.harness`, so a served
dashboard never shows a mock.

Playwright writes failure artifacts under `tests/mocks/.output/`.

## Current presentation choices

These choices distinguish the dashboard from the original specimen/demo or retained backend
presentation.

- Search uses first Escape to clear a nonempty query and a second Escape to close.
- Intake dismisses through the header’s Close control; closing preserves the durable session.
- An unknown Explorer workflow offers the first served workflow as its recovery destination.
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
  Canonical selected-run actions require explicit Confirm and show their exact public plan. Confirmed starts and cancellations resolve in the thread; unknown outcomes retain the disabled card. Other proposals without issued action authority keep confirmation unavailable. Workbook registration and exact-version reads use the served library; there is no mock conversation.
- Archive and UI catalog URLs show removal notices; their pages and Queue context menus are absent.
- Loading skeletons preserve the geometry of the surface they replace.

Julian approved the HUB-R4 composer over HUB-R3 on October 19, 2026 at 2:41 PM PT
(`relay-plan/briefs/HUB-WIRE-1.md`). The approved combined presentation inventory is 107 TSX files,
22 stylesheets and two theme modules (131 paths). The inventory test and exact path fixture own
that freeze. Legacy mock drivers follow the current visible controls; removed presentation
contracts are replaced with inclusion/exclusion, geometry, keyboard and interaction assertions.

See [DESIGN.md](DESIGN.md) for composition rules and
[the wiring contract](../../docs/reference/frontend-backend-integration.md) for producer acceptance.
