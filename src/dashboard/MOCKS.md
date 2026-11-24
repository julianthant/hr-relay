# Gallery guide

The state gallery is the one place every dashboard state is drawn. It replaced the Playwright mock scenes
(`npm run mocks`, `tests/mocks/`), which CI never ran and which had drifted from the UI.

## Where a state lives

- `tests/support/helpers/dashboard/smoke/stories/` holds one file per surface. Each keys its stories by the state
  type it renders, typed `satisfies Record<StateType, Story>`, so a state without a story fails typecheck.
- `tests/smoke/dashboard-states.gallery.ts` runs every state rule on every story at both desktop sizes and saves a
  frame of each under `tests/smoke/.output/states/`. Run one surface with `--grep @<surface>` and `--project=gallery`.
- `tests/smoke/gallery/` is the page that renders a story; the rules live in
  `tests/support/helpers/dashboard/smoke/state-rules.ts`.
- Add a new state as a story in its surface's file. Add behaviour (keyboard flow, live updates, focus) as a
  `tests/smoke/*.smoke.ts` test or a Vitest test, never as a frame.

## Shared fixtures

The data the scenes used lives in `tests/support/`:

- `tests/support/helpers/dashboard/mock-world/` holds the fixture BFF routes, the seeded services, the sample
  workflow composition and the mock bundle proof (`bundle.ts`, `dist/mock-dashboard`). `app-entry.tsx` is the
  mock build entry named by `vite.mocks.config.ts`; it sets the harness flag that `mockParam` in
  `src/dashboard/app/mock-surfaces.ts` reads, so a served dashboard never shows a mock.
- `tests/support/fixtures/dashboard/workflow-mocks/` holds the mock workflow runs, queue, review and Records
  models. Nothing under `src/` imports either folder.

## Retired scenes

Each former scene file, what replaced it, and why. "Story" names the gallery file under
`tests/support/helpers/dashboard/smoke/stories/`.

| Scene file (deleted) | Disposition |
| --- | --- |
| `onboarding-mock` | Story: `sign-in-stories.tsx` (login, signup, duo, ready and the session states). |
| `settings-general-chatgpt-mock` | Story: `settings-stories.tsx` (General, ChatGPT connect states, plan usage). |
| `spreadsheets-fills-mock`, `spreadsheets-library-mock`, `sweep-fixtures-workbooks` | Story: `spreadsheets-stories.tsx` (library, empty, versions, row menu, sync, import dialog, grid). |
| `needs-duo-mock`, `sweep-fixtures-shell` (Sessions Needs Duo) | Story: `sessions-stories.tsx` (`needs-duo` browser card, bar states). |
| `sweep-fixtures-shell` (Work Study queue, run input sentences) | Story: `shell-stories.tsx` and `run-dialog-stories.tsx`; input wording is held by `run-start.wording.integration.test.ts`. |
| `failure-notice-mock` | Story: `run-panel-stories.tsx` (failed, retryable and after-write failure cards). |
| `notifications-mock`, `notifications-sweep-decisions` | Story: `notifications-stories.tsx` and `shell-stories.tsx` (search palette); decision cards are `run-panel-stories.tsx` decision stories. |
| `notifications-sweep` | Deleted. Its `notificationsPreview=centre` address no longer exists, so it never reached the run it asserted on; the Logs, failure card and timeline it framed are `run-panel-stories.tsx` stories, and its exact 53px/49px header/footer heights asserted an older Logs layout. No product fault. |
| `sweep-fixtures-run-detail` | Live Logs over the event stream: `dashboard-live-updates.smoke.ts` already proves the run view re-reads on each event and stream envelopes. Run detail states are `run-panel-stories.tsx`. The dry-run preview region test was a known product fault; it is held on the finding for dry-run-preview-01 and was never a passing check. |
| `sweep-fixtures-ocr` | Story: `run-panel-stories.tsx` review stories (ready, unconfirmed, needs-review, approved, empty). |
| `sweep-fixtures-account-analytics` | Story: `analytics-stories.tsx` (`unavailable`) and `assistant-stories.tsx` (account states). |
| `zz-assistant-explorer-mock` | Story: `assistant-stories.tsx`, `explorer-stories.tsx`, `settings-stories.tsx`. The Ask-mark video was an animation recording and asserted nothing. |
| `zz-status-mock` (queue, kit, settings pages, Logs footer and cards, toasts, run input) | Story: `queue-row-stories.tsx`, `shell-stories.tsx`, `settings-stories.tsx`, `run-panel-stories.tsx`, `run-dialog-stories.tsx`. Kit specimens stay at `/kit.html`. Run dialog keys (Enter to continue, Shift+Enter): `run-start.test.ts`. |
| `zz-status-mock` (`analytics states`) | Story: `analytics-stories.tsx` (`loaded`, `range-30d`, `one-workflow`, `workflow-details`). Unexplained timeout: a 240-second chain of about twenty steps that hovers bars by day label against a sample clock. It was not reproduced here and no product fault was seen; the states it passed through are individual stories. |
| `command-readback-mock`, `toasts-text-only-mock` | Story: `settings-stories.tsx` (`unconfirmed`, `applied`) and `sessions-stories.tsx` (`pending`, `confirmed`, `refused`); the text-only toast rule is `toast-text-only` in the state rules. |
| `check-fix-destinations` | Fix then Escape moved to `dashboard-app.integration.test.ts` (Escape from Settings opened by Fix returns to the dialog, beside the Close settings case); Fix destinations are held by `run-start.checks.integration.test.ts`; the focused row is the `opened-for-check` story. |
| `run-dialog-reference-gate` | Story: `run-dialog-stories.tsx` reference stories. Unexplained timeout: after choosing the roster it clicks the text "Do not file", which no longer exists anywhere in the dashboard, so the click waited out the 120-second test timeout. A stale selector, not a product fault. |
| `sessions-bar-hover`, `switch-pointer-click`, `app-entry` | Deleted. They asserted a hover tint, a switch click and a harness entry that `sessions-stories.tsx`, the run dialog stories and the smoke suite now cover. |

The 25 failures of 2026-11-19 came mostly from stale assertions (a 256px sidebar now 208, a removed Permissions
heading, one Start run button where an empty queue shows two). The scenes were deleted rather than repaired, so
those failures were not each re-run; the dry-run preview region failure stays a product finding.

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
- The launcher shares Input/Values, Options, and Checks layouts without adding empty stages.
- Run and Rerun Options use card rows; Dry run starts off, browser mode is Headed, and Screenshots is locked Always on.
- Required reference types add spreadsheet and named-version rows. Checks frame Plan, Input and declared Output groups; each stage starts at the top, and body scrolling keeps the header and footer in place.
- Reading steps allow typed manual values while form actions and required sign-in steps remain included.
- Settings uses a stationary rail/Navbar and body-scoped content, search, guarded exit, and child breadcrumbs.
- Settings places General/Account under Personal, Spreadsheets/Explorer/Analytics under Data and Keyboard under Help; Paths, Routes and Performance are groups inside General.
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
that freeze. Removed presentation contracts are replaced with inclusion/exclusion, geometry, keyboard and interaction assertions.

See [DESIGN.md](DESIGN.md) for composition rules and
[the wiring contract](../../docs/reference/frontend-backend-integration.md) for producer acceptance.
