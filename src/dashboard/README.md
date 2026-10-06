# Dashboard frontend

This is the browser application. Start at `app/main.tsx`, then the shell in
`app/dashboard-app.tsx`. Feature components, their pure models, local styles and mock
producers live together under `surfaces/`.

| Folder | Responsibility |
| --- | --- |
| `app/navigation/` | The single URL/history owner and typed navigation coordinates |
| `app/commands/` | Dispatch, command outcomes and bulk/worker orchestration |
| `surfaces/shell/` | Workspace rail, workflow navigation, toolbar, calendar and run search |
| `surfaces/queue/` | Queue rows, filters, sorting, actions and grouping |
| `surfaces/run-detail/` | Detail sections, logs, timeline, identity review, write resolution and failure evidence |
| `surfaces/run-start/` | Shared launcher layouts, input/options/confirmation and rerun service |
| `surfaces/workflows/` | One frontend workflow catalog; `mocks/` holds preview contracts and producers |
| `surfaces/notifications/`, `surfaces/sessions/` | Each feature’s view, model and mock producer |
| `surfaces/settings/` | Settings shell plus `general/`, `editor/`, `providers/`, `routes/`, `storage/`, `preflight/`, `navigation/`, `catalog/` |
| `surfaces/activity/`, `surfaces/explorer/` | Analytics and Explorer page components, models, local fixtures and styles; Analytics retains the existing Activity module and route identifiers |
| `surfaces/archive/` | Retained, unmounted historical report readers and transport models; Archive is retired from product navigation |
| `surfaces/spreadsheets/`, `surfaces/intake/` | Workbook editing/import and intake workspace |
| `surfaces/shared/` | Reused actions, status formatting, loading geometry and run evidence |
| `client/` | Stable `index.ts`, `queries.ts`, `commands.ts` facades; implementations in `queries/`, `commands/`, `subscriptions/` |
| `state/` | Shared resource lifecycle, client context, bootstrap/day and served clock |
| `ds/` | Public `ui.tsx` barrel; implementation in `primitives/`, tokens/themes in `theme/` |
| `lib/` | Framework-free browser helpers |
| `kit/`, `logs-preview/` | Separate specimen/presentation entry points |

## Where a change belongs

Keep a component with its feature. Extract calculation, parsing, hooks and shared constants
to a sibling `.ts` model. Move something into `shared/` only when independent features
actually use it. Import the exact model needed; do not add feature barrels or registry
imports to browser code. Component `.tsx` files under `app/` and `surfaces/` export components
only. The design-system barrel is the deliberate exception.

## Backend wiring

`client/index.ts` is the typed transport seam. Its query and command facades infer contracts
from `src/domain/**`; no frontend wire mirrors or server/workflow composition imports.
`surfaces/workflows/workflow-catalog-model.ts` supplies the rail, launcher, workers and
other workflow consumers. Availability, preview capability and executable registration
are distinct fields; a displayed mock is not proof of a backend implementation.

General’s ChatGPT account card consumes `ChatGptAccountPort` through `ChatGptAccountContext`.
The default producer is a memory-only preview. Replace the context port using the existing typed
client/domain seam for verified session, consent, sign-in and sign-out results; credentials and
tokens belong to the backend. Provider budget/model and API-key controls are retired from the
frontend; their existing backend contracts remain pending integration.

Feature mocks own fictional state transitions. Replace a producer behind its existing
view model when wiring a feature. Keep explicit loading, empty, refusal, unknown outcome
and failed states; do not substitute fixture success when transport fails.

The [current wiring checklist](../../docs/rebuild/reference/frontend-backend-integration.md#current-frontend-mock-wiring-checklist--2026-10-05)
distinguishes mounted producers from retained transport implementations. Use it before replacing a
mock. In particular, current Logs, Analytics, notifications and Sessions still contain local
producers; the older runtime matrix is not proof that those consumers are mounted today.

Archive is no longer mounted or offered in Settings, shell search, queue menus or notifications.
Legacy Archive URLs show an explicit removal notice and a guarded return to the dashboard. Stored
history and backend archival contracts remain intact. A unified cross-day, cross-version run query
and upgrade compatibility/migration policy still require backend integration; page retirement does
not make historical reports available in the current day queue.

`tests/perf/frontend/` builds an isolated production fixture using the real Queue and Log components.
It measures rendering, interaction and heap cleanup independently of HR services. Preserve complete
search, copy, selection and focus when changing rendering. Offscreen layout deferral reduces layout
work; it does not bound loaded data or DOM memory.

## Navigation

`app/navigation/url-state.ts` owns public page coordinates. The bounded `view` query
parameter uses `ViewRouteSchema`; it contains workflow/run selections, filters, tabs,
modal/wizard steps and disclosure coordinates. The provider delegates every write to the
same history owner. Same-event updates are combined into one history entry. Typing search
terms replaces the current entry; changing a page, selection or stage pushes an entry.

Use `PageBreadcrumbs` from `ds/ui.tsx` for page hierarchy. Place child-page trails before the
heading; pass the existing route callback for each available parent. The last item is passive
current-page text. Settings keeps its rail heading and a separate guarded back-arrow button; child pages
retain breadcrumbs. Keep wizard Back controls for steps and modal dismissal for closing layers;
do not add a second return control for the same destination.

Private form values, PDF bytes, OCR edits, credentials, pending commands and read receipts
are not serialized into URLs. Mock drafts survive history within the running page;
reloading does not manufacture a private draft or a created run. Transient menus, hover,
focus, field errors and unsaved mutation state remain with their feature.

See [DESIGN.md](DESIGN.md), [PARITY.md](PARITY.md) and the nearest instructions before edits.
