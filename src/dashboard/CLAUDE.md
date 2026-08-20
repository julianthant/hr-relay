# `src/dashboard/` — the operator dashboard (browser bundle)

Everything under this directory is reachable from a browser entry (`index.html`, `capture.html`),
so it may import only pure contracts from `src/domain/**` — never a Node built-in, never a server
module (`dashboard-wire-boundary` walks the closure and fails loud). `DESIGN.md` is binding for
anything visual: read it before building a surface.

## Layout

| Path         | Contents                                                                                                                     |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `app/`       | the app shell: `main.tsx` mounts `dashboard-app.tsx`; URL/nav state, global keys, command dispatch, panel-section hooks, `index.css` |
| `surfaces/`  | every operator surface — see the pairing rule below                                                                          |
| `ds/`        | the design system: tokens (`tokens.css`/`tokens.ts`), primitives (`primitives-*.tsx`), theme, and the ONE barrel `ui.tsx`     |
| `client/`    | the BFF client: transport, queries, commands, day-state subscription, typed errors                                            |
| `state/`     | React-side resource hooks over the client (`use-bootstrap`, `use-dashboard-day`, `use-run-detail`, `client-context`)          |
| `lib/`       | framework-free helpers (`utils.ts` for `cn`, `preference-storage.ts`)                                                        |
| `phone/`     | the token-scoped phone capture page — its own entry, its own closure (`capture.html`); may not reach `surfaces/`, `client/`, `app/` |

## The surface / model pairing rule (React Fast Refresh)

A module under `surfaces/` or `app/` with a `.tsx` extension **exports components only**. Its
hooks, pure folds, vocabularies (`Record`/array constants) and wire-derived types live in a sibling
`<surface>-model.ts` — e.g. `queue.tsx` / `queue-model.ts`, `shell.tsx` / `shell-model.ts`. Shared
pure modules that serve several surfaces stay as plain `.ts` beside them (`format.ts`,
`layout-metrics.ts`, `workflow-category.ts`).

**Why:** `@vitejs/plugin-react` treats a module as a Fast Refresh boundary only when every export is
a component or is reference-equal across re-evaluation. One exported helper, hook or object constant
makes the module refuse the update, and the invalidation climbs to `dashboard-app.tsx` — the whole
app remounts and loses its state on every save. `dashboard-refresh-boundary.test.ts` (doc 13 §8.14)
enforces the rule; `ds/ui.tsx` is out of its scope on purpose (one barrel for the whole system is
worth the occasional full remount when a primitive changes).

Type-only exports are erased and are legal anywhere. A module-private helper or constant inside a
`.tsx` file is fine; only **exports** decide the boundary.

## Commands

```bash
npm run dashboard   # BOTH in one terminal: the BFF (3938, /api/v1/* + the SSE day stream) and vite (5174); Ctrl+C stops both
npm run cli -- dashboard   # the BFF alone
npm run web         # the vite dev server alone (proxies /api to 3938 — ECONNREFUSED there just means no BFF is up)
npm run web:build   # production bundle into dist/dashboard (the parity lane builds this itself)
npm run test:parity # doc 13 §7 visual/a11y parity lane
```
