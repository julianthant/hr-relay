# Dashboard frontend

The browser application starts at `app/main.tsx` and mounts `DashboardApp` from
`app/dashboard-app.tsx`. The separate `kit.html` entry mounts `kit/main.tsx`.

## Folder map

| Folder | Responsibility |
| --- | --- |
| `app/` | Application composition, workflow source policy, and takeovers |
| `app/navigation/` | URL parsing, history, typed view state, keyboard shortcuts, and focus restoration |
| `app/commands/` | Command composition, settlement, bulk dispatch, and worker controls |
| `surfaces/shell/` | Workspace rail, workflow navigation, date controls, toolbar, and run search |
| `surfaces/queue/` | Queue rows, focus mode, filters, sorting, grouping, selection, and local preview mutations |
| `surfaces/run-detail/` | Logs, timeline, decisions, image workspace, run headers, and identity models |
| `surfaces/run-start/` | Launcher, plan, options, steps, rerun, and recovery |
| `surfaces/workflows/` | Shared workflow catalog; `mocks/` contains preview runs, definitions, documents, and Records |
| `surfaces/sessions/` | Worker strip, cards, local command port, idle refresh, and samples |
| `surfaces/notifications/` | Bell, inbox, destination models, and local preview producer |
| `surfaces/settings/` | Settings composition and local styles |
| `surfaces/settings/editor/` | Served fields, drafts, autosave, protected authority, and command attempts |
| `surfaces/settings/general/` | General, appearance, ChatGPT account port, performance, path picker, and relocation |
| `surfaces/settings/navigation/` | Settings search and keyboard preferences |
| `surfaces/settings/preflight/`, `routes/`, `storage/`, `providers/` | Readiness, route display, doctor reports, and protected-value controls |
| `surfaces/settings/catalog/` | Retained row vocabulary model, without a catalog page |
| `surfaces/activity/` | Analytics view, range, timing, population, drilldown, and local producer |
| `surfaces/explorer/` | Workflow timeline, source views, choices, and local definitions |
| `surfaces/spreadsheets/` | CSV/XLSX worker import/export, library, typed mappings, editor, and undo history |
| `surfaces/intake/` | Served intake session, mapping, validation, and enqueue workspace |
| `app/navigation/archive-route-model.ts` | Removal-notice URL state |
| `surfaces/shared/` | Shared actions, recovery, loading, evidence styles, status, and formatting |
| `client/` | Typed transport, query/command facades, errors, and subscription |
| `state/` | Client context, resources, bootstrap/day reads, and served clock |
| `ds/` | `ui.tsx` public barrel, `primitives/`, and `theme/` tokens |
| `lib/` | Framework-free helpers |
| `assets/ocr/` | Local document images and manifest for OCR previews |
| `kit/` | Design-system specimen page |

## Change owners

Keep components, styles, and models beside their feature. Component `.tsx` files under `app/`
and `surfaces/` export components only. Put hooks, calculations, constants, and vocabulary in
sibling `.ts` models. `ds/ui.tsx` is the design-system barrel. Use `surfaces/shared/` only for
behavior several features use.

`client/index.ts` is the transport seam. `queries.ts` and `commands.ts` assemble implementations
from their subfolders. Canonical wire contracts live under `src/models/dashboard/`; command rules
live under `src/rules/commands/`. Browser imports never reach backend composition or task registries.

`app/workflow-sources.ts` reads `config/dashboard-workflow-sources.json`. Each workflow is explicitly
`mock` or `served`. Person Lookup and Separations select `served`; every other configured workflow selects `mock`. An undeclared ID throws
`WORKFLOW_SOURCE_UNDECLARED`. A served failure never falls back to a mock.

Bootstrap, Settings, Preflight, storage, and the served intake workspace use the typed client.
Current Logs, worker cards, Analytics, Explorer, notifications, and workflow runs have local
producers. Retained client methods do not prove those consumers are wired. The
[current frontend mock wiring checklist](../../docs/rebuild/reference/frontend-backend-integration.md#current-frontend-mock-wiring-checklist)
names each replacement seam and its acceptance contract.

## Navigation

`app/navigation/url-state.ts` owns public coordinates. `ViewRouteSchema` bounds filters, selected
workflows/runs, tabs, stages, and disclosures. Search typing replaces history; navigation pushes
history. Breadcrumbs and native Back/Forward use the same owner. Private values, PDF bytes, OCR
edits, credentials, pending commands, and workbook history never enter URLs.

Drafts survive navigation within the mounted session. Reload cannot recreate private drafts or a
locally created run. Archive and UI catalog routes show removal notices. The dashboard has no
Archive page, version-bump controls, row context menus, or mobile Capture Mode.

## Commands and references

`npm run dashboard` starts the BFF and Vite. `npm run web` starts Vite on port 5174 and needs a
running BFF for dashboard data. `npm run web:build` builds dashboard and specimen assets.
`http://localhost:5174/kit.html` shows the primitives.

Read [AGENTS.md](AGENTS.md) before edits, [DESIGN.md](DESIGN.md) for tokens and layout,
[PARITY.md](PARITY.md) for visual verification, and [dashboard surfaces](../../docs/rebuild/reference/dashboard-surfaces.md)
for mounted behavior. `tests/perf/frontend/` contains the isolated Queue/Logs performance fixture.
