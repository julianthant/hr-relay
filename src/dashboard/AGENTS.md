# `src/dashboard/` — the operator dashboard (browser bundle)

Everything under this directory is reachable from a browser entry — `index.html` and `kit.html`,
the two inputs `vite.dashboard.config.ts` declares — so it may import only pure contracts from `src/domain/**` — never a Node built-in,
never a server module (`dashboard-wire-boundary` walks the closure and fails loud). `DESIGN.md` is
binding for anything visual: read it before building a surface — and open the specimen page it
points at (`npm run web` → http://localhost:5174/kit.html) before choosing a primitive.

Keep `AGENTS.md` and `CLAUDE.md` byte-identical in the same commit. Preserve both sides'
valid guidance when resolving a merge, reconcile contradictions against the owning contract,
and explain the resolution. Update instructions when their rules change; keep lesson history
in the linked ledger.

## Layout

| Path         | Contents                                                                                                                     |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `app/`       | the app shell: `main.tsx` mounts `dashboard-app.tsx`; URL/nav state, global keys, command dispatch, panel-section hooks, `index.css` |
| `surfaces/`  | every operator surface — see the pairing rule below                                                                          |
| `ds/`        | the design system: tokens (`tokens.css`/`tokens.ts`), primitives (`primitives-*.tsx`), theme, and the ONE barrel `ui.tsx`     |
| `client/`    | the BFF client: transport, queries, commands, day-state subscription, typed errors                                            |
| `state/`     | React-side resource hooks over the client (`use-bootstrap`, `use-dashboard-day`, `use-run-detail`, `client-context`)          |
| `lib/`       | framework-free helpers (`utils.ts` for `cn`, `preference-storage.ts`)                                                        |
| `kit/`       | the DS specimen page — its own entry, its own closure (`kit.html`); `ds/**` + `lib/**` only, may not reach `surfaces/`, `client/`, `state/`, `app/` |

There is no `phone/` directory and no `capture.html` entry: **D294 (2026-08-31) retired mobile/phone
document Capture Mode**, and nothing here may reintroduce its page, entry, transport or routes.
Diagnostic screenshots, run Capture tiles, receipts, Archive evidence and spreadsheet intake are
separate, live surfaces and are NOT retired.

## The surface / model pairing rule (React Fast Refresh)

A module under `surfaces/` or `app/` with a `.tsx` extension **exports components only**. Its
hooks, pure folds, vocabularies (`Record`/array constants) and wire-derived types live in a sibling
`<surface>-model.ts` — e.g. `queue.tsx` / `queue-model.ts`, `shell.tsx` / `shell-model.ts`. Shared
pure modules that serve several surfaces stay as plain `.ts` beside them (`format.ts`,
`layout-metrics.ts`, `workflow-category.ts`).

**Why:** `@vitejs/plugin-react` treats a module as a Fast Refresh boundary only when every export is
a component or is reference-equal across re-evaluation. One exported helper, hook or object constant
makes the module refuse the update, and the invalidation climbs to `dashboard-app.tsx` — the whole
app remounts and loses its state on every save. `dashboard-refresh-boundary.test.ts` (ref frontend-backend-integration §8.14)
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
npm run test:parity # ref frontend-backend-integration §7 visual/a11y parity lane (~1 min, 5 workers)
npm run test:parity -- dashboard-reference --grep "queue"   # one file / one describe — the mid-unit run
```

**When the parity lane runs.** It is outside the per-commit gate on purpose (D191), and it is not a
per-fix check. The cadence is:

- **A change scoped to one surface** → the filtered run for that surface's spec (above), as often
  as you like; it takes seconds.
- **A change to something shared** — the shell, `tokens.css`, a primitive under `ui/`, the top bar,
  the queue row, a `*-model.ts` many surfaces import — → the full lane.
- **Before the LAST commit of a dashboard unit** → the full lane, always. A `.tsx` change is
  gated by nothing else on screen, so the unit does not close without it.
- **Never** re-freeze to make it pass; `test:parity:update` is a deliberate act with a reviewed diff.

## Ruled deviations from the rebuild-demo

One shell affordance has no demo counterpart and STAYS, ruled by **D272 item 3**
(`ref dashboard-surfaces` §10; operator context is `docs/decisions/dashboard.md` §D272
item 3, answered A on 2026-08-26). It is recorded here so a later fidelity pass reads it as a
decision rather than as drift, and the site carries the same citation in code.

| Deviation | Where | Why it stays | Rejected |
|---|---|---|---|
| **Escape-clear in day search** — a first `Escape` clears a non-empty query; a second closes the dialog (ledger 1 A16) | `surfaces/day-search.tsx` | Clearing is the cheaper correction and the second press still reaches the dialog, so nothing the demo's Escape does is unavailable here | B — remove both for exactness |
| ~~**`Import spreadsheet` in the toolbar's left group** (ledger 1 A174 / B141)~~ | ~~`app/dashboard-app.tsx`~~ | **DISCHARGED by D296 (2026-09-01), not overruled.** It stayed because "the demo reaches intake from inside the Run Modal and `RunStartSurfaces` serves no such handoff" — and the row named its own expiry. The modal grew the handoff, so the button is deleted and the Input stage's `Import a spreadsheet` method is the intake's one door — and since D298 that method IS the intake's dropzone, so the one door opens on the zone itself | B — remove both for exactness · **C — build the Run-Modal handoff first (LANDED)** |

Three more are ruled by **D273 items 5–6** (`ref dashboard-surfaces` §"D273 — run detail"; the
sheet is ledger 2, `docs/plans/2026-08-21-03a-fidelity-2-run-detail.md` §R-C). Same rule: each site
carries the citation in code.

| Deviation | Where | Why it stays | Rejected |
|---|---|---|---|
| **`Saving…` on the commit arm while a save is in flight** (ledger 2 C71) | `surfaces/context-rail.tsx` | The demo's save is a synchronous mock and this one is a real `run/edit-checkpoint` round trip. A control that looks identical mid-flight invites the second press D272's own after-dispatch lesson is about; the label IS the pending state, so the fact reaches a screen reader on the control's accessible name rather than through decoration | B — suppress the async state for exactness |
| **The Data section's `aria-label` is its VISIBLE label** (ledger 2 C16) | `surfaces/context-rail.tsx` | The demo's region says `Data` under a visible `Extracted fields` — a mismatch it inherited when its own visible label changed and its region name did not. Porting it would put two names on one region and undo the one-expression rule this bundle ratified for WCAG 2.5.3 (`intake.tsx`'s review checkbox). `DATA_SECTION_LABEL` feeds both halves so they cannot drift | A — port `aria-label="Data"` verbatim |
| **The unattributed ledger group takes no `Well` and no band** (ledger 2 C51/C54) | `surfaces/context-rail.tsx` | The demo has no counterpart because it always knows the step. The chrome ENCODES the step, so a group that has none has nothing to encode and an empty band would be D252's made-up heading in a quieter form. Its rows keep the dividers, which separate values rather than name a producer | B — give it a band with an invented or blank heading |

Seven more are ruled by **D275 items 2 and 8** and **D276 items 1–3** (unit V1, the Track F
vocabulary sweep; ledger 3 rows IN7, EX26, EX55, EX172, VB34/VB36, VB50). Same rule: each site
carries the citation in code.

| Deviation | Where | Why it stays | Rejected |
|---|---|---|---|
| **The intake workspace dismisses from its HEADER, and the word is `Close`** (ledger 3 IN7) | `surfaces/intake.tsx` | The demo's `Cancel` is a DIALOG footer button and D173 reshaped this surface into a workspace, which has no dialog footer. `Cancel` would also misname it: by the time the header is on screen the upload has created a durable session with an artifact behind it, so the control closes the workspace and cancels nothing. D298 removed the `Another file` reset beside it: it reset to the upload page, and there is no upload page | A — port `Cancel` into a footer this surface does not have |
| **The workflow list `Panel` takes an `aria-label`** (ledger 3 EX26) | `surfaces/explorer.tsx` | Two `Panel` landmarks sit side by side here, and a landmark with no name is one an assistive reader cannot tell from the other. The demo's list is a bare `div`, so it never had two landmarks to distinguish | B — drop the name for exactness |
| **The connector prints `no edge between them`** (ledger 3 EX55) | `surfaces/explorer.tsx` | `dependsOn` is a real declaration a descriptor may omit, so the demo's unconditional `always` would tell the operator that the next node WAITS for this one when nothing says it does — on the surface whose whole subject is what waits for what | B — print `always` on both arms |
| **The unknown-workflow empty state offers a door** (ledger 3 EX172) | `surfaces/explorer.tsx` | The arm is reached by a deep link naming a workflow the registry no longer serves; without it the operator's only exit from a stale bookmark is the URL bar. It names the workflow it opens, and is suppressed when the registry is empty | B — remove it; C — offer a generic "open a workflow" |
| **The bump record's fields are capped and counted** (ledger 3 VB34/VB36) | `surfaces/archive.tsx` | The caps ARE `VersionBumpChangeRecordSchema`'s own (`.max(200)` / `.max(1000)`), so the durable store will refuse a longer record. Meeting a limit as a refusal after the press is what this dialog's "there is no force arm" argument is against | B — uncap for exactness and refuse after the press |
| **The bump refusal enters through the shared transition** (ledger 3 VB50) | `surfaces/archive.tsx` | D275 item 2's own convention. The demo's refusal is fixture-authored and never arrives from a dispatch, so it has no counterpart; this one is the answer to a click and reads as a page change without it | B — render it with no transition |

The import button is gone (D296), which is what "neither is permanent" meant. The Escape-clear
is deliberately NOT a `shortcuts-model.ts` entry — the legend's own *When they fire* rules say an
open dialog owns the keyboard including Escape, and listing a per-dialog refinement as a global
binding would contradict them.

## Lessons learned

Before changing this module, search [LESSONS.md](LESSONS.md) for the affected seam or decision
and read the matching entries. The former inline lesson bodies are preserved there verbatim.
When asked to record a lesson, write it to that ledger, including when an older helper names
this section as its destination. Keep current rules here and keep the instruction pair concise.
