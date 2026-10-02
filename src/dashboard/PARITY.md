# Dashboard parity rulings

Read before changing a listed deviation or judging reference parity. These are operator-ratified
exceptions, moved from the instruction pair on 2026-09-04; relocation does not revoke them.
The current owning contracts supersede dated claims. `DESIGN.md` remains the visual authority.

## Approved mixed queue presentation (2026-10-01)

The operator-approved queue and navbar presentation is owned by the
[dashboard presentation amendment](../../docs/rebuild/reference/dashboard-surfaces.md#frontend-only-dashboard-presentation-amendment--2026-10-01).
It supersedes the demo's leading row/info icons, inline attempt chip, grouped workflow-batch UI and
tiny header progress marks. Preserve the gray provenance footer, current fonts and status bands;
place bulk selection outside the card, attempts in the footer dropdown, pipeline labels below the
segmented bar, and operation members in Name/Status columns with a boxed finished/total count.
Review messages are blue; Write parked remains yellow. Existing reference screenshots have not been
refrozen. Focused presentation and interaction specs verify this approved change in both themes.

## Approved log blocks and image workspace (2026-10-02)

The [dashboard presentation amendment](../../docs/rebuild/reference/dashboard-surfaces.md#frontend-only-dashboard-presentation-amendment--2026-10-01)
owns the 33 local examples, neutral frames, required-only continuation forms, ordinary follow-up logs,
fitted indented notices and timestamps in the surrounding log. Keep the established typography and
shared DateInput calendar. The viewer has bounded previews, a thumbnail sidebar, fit/zoom/rotate,
comparison, outside dismissal, explicit load/mismatch errors and Retry. Preserve the complete pipeline:
earlier completed stages retain their state and durations, future stages are gray without visible
“Upcoming” text, and only the affected
stage/substep changes color. Focused dark/light 1024/1440 interaction and accessibility checks cover
these approved changes. Reference screenshots have not been refrozen; backend wiring remains deferred.

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


D334 / 1.6.4 retires the checkpoint-save action and its in-flight `Saving…` deviation.
The Context rail retains read-only data; source-bound Rerun values belong to 3.1.11-2.

## Desktop canvas (D340, 2026-09-06)

The operator replaced the 1180px shell stacking switch with a 1024×720 CSS-pixel minimum
canvas. Queue and detail remain side by side; smaller browser windows scroll. The affected
1024×768 references deliberately change, while larger desktop references retain their geometry.
Ref frontend-backend-integration §10 and ref dashboard-surfaces §9.9 own this amendment.
