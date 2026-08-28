# UI-1 — the deliberate parity re-freezes, attributed

**Date:** 2026-08-27 · **Run:** UI-1 (demo-fidelity `fix-now` rows) · **Base:** `feature/ui-fidelity`

Same rule as `2026-08-26-p1-refreeze-attribution.md`: a green lane after a re-freeze proves only that
the lane agrees with itself. The claim worth making is that **every reference that moved, moved for a
named reason**, and each unit's section below states that one reference family at a time.

A reference is one capture name — its `.a11y.yml` and its `.png` together, which the lane refreshes
as a unit and can never refresh independently.

---

## U2 — the deliberate parity re-freeze, attributed

**Date:** 2026-08-27 · **Unit:** run UI-1, U2 (the takeover geometry conversion) · **Branch:** `feature/ui-u2`

An addendum to `docs/plans/2026-08-26-p1-refreeze-attribution.md`, in the same shape and under the
same rule: `npm run test:parity:update` was run **exactly once**, over the whole corpus, after the
one commit this unit lands. A green lane after a re-freeze proves only that the lane agrees with
itself — the claim worth making is that **every reference that moved, moved for a named reason**,
and that is what the table below states one reference at a time.

| | |
| --- | --- |
| references changed | **40** |
| references minted | **0** |
| **total** | **40** |
| **attributed** | **40** |
| **UNATTRIBUTED** | **0** |

A reference is one capture name — its `.a11y.yml`, its `.meta.json` and its `.png` together, which
the lane refreshes as a unit and can never refresh independently.

**What did NOT move is half the claim.** Not one `.meta.json` and not one `.a11y.yml` in the corpus
changed — `git status --short tests/parity/references` lists 40 paths and every one of them ends in
`.png`. The accessibility tree of all four takeovers is byte-identical across this change: each
surface's root was already a `section` carrying its own `aria-label`, `TakeoverFrame` keeps both, and
the wrapper that was deleted was a bare `div` that never appeared in the tree. Only pixels moved.

Assert-mode proof, verbatim (`npm run test:parity` after the update):

```
218 passed (2.8m)
```

Update-mode run, verbatim:

```
218 passed (3.0m)
```

Assert-mode BEFORE the update, for the record — the 40 that this document attributes are exactly the
40 that failed:

```
40 failed
178 passed (3.9m)
```

### The one change behind all 40

| id | what changed | attributed to |
| --- | --- | --- |
| **G1** | the takeover's container geometry: the surface's root moved from `x=12, w=viewport−24`, `border 1px`, `radius --ds-radius-lg`, `bg --ds-surface-1`, sitting under a `pb-[--ds-space-base]` bottom gutter, to **`x=0, w=viewport, border 0, radius 0`, flush under the top bar at `y=44` and flush to the sessions bar**. Every pixel in every one of the 40 references is displaced by that: content shifts left 12px, the card's hairline and its four rounded corners are gone, and the surface gains 24px of width and 12px of height. | commit `ab67408f` — `feat(dashboard): the four takeovers replace the window, full-bleed`. Audit rows **UF-SET-1**, **UF-SET-4**, **UF-SET-5**, **UF-AR-3**, **UF-EX-2**, **UF-AC-2** in `docs/plans/2026-08-27-ui-fidelity-audit.md` §2a/§3/§4/§5 and its Summary A. Ratified by **D272 item 1** + **D274 item 5** (Settings is the demo's full-page takeover) and constrained by **D275 item 2** (one shared takeover wrapper, kept as an accessibility/motion convention — `TakeoverFrame` now owns it). Ported from legacy `1ec1d870`, `src/dashboard/components/dev/rebuild-demo/RebuildDemo.tsx:656-678` and `DemoSettings.tsx:1071-1075`. |

There is no second cause. No copy changed, no vocabulary changed, no served fact changed, no
`descriptorHash` moved (this unit edits nothing inside a descriptor's import closure), and no scene
outside the four converted surfaces failed the assert lane — the 178 that passed before the update
are the proof of that half.

### The 40 references, one row each

Every row is `G1`. Viewports are the lane's three (`1280x720`, `1440x900`, `narrow-1024x768`) and
themes its two (`graphite-warm`, `paper-ink`); the two Settings panes and the two version-bump
captures are `1440x900` only, which is how the corpus already held them.

#### Settings — 8 references (UF-SET-1 / UF-SET-4 / UF-SET-5)

The nav moves from `x=13 w=220 h=809` to **`x=0 w=220 h=819`**, which is UF-SET-4's demo measurement
to the pixel; the section pane gains the 12px the right gutter held.

| reference | row id | reason | commit |
| --- | --- | --- | --- |
| `settings--graphite-warm--1280x720.png` | UF-SET-1 | G1 | `ab67408f` |
| `settings--graphite-warm--1440x900.png` | UF-SET-1 | G1 | `ab67408f` |
| `settings--graphite-warm--narrow-1024x768.png` | UF-SET-1 | G1 | `ab67408f` |
| `settings--paper-ink--1280x720.png` | UF-SET-1 | G1 | `ab67408f` |
| `settings--paper-ink--1440x900.png` | UF-SET-1 | G1 | `ab67408f` |
| `settings--paper-ink--narrow-1024x768.png` | UF-SET-1 | G1 | `ab67408f` |
| `settings--graphite-warm--1440x900--system-hosts.png` | UF-SET-1 | G1 — the pane's own content is untouched (its copy is U3's seam, not this one); it moves because the page under it did | `ab67408f` |
| `settings--graphite-warm--1440x900--capabilities.png` | UF-SET-1 | G1 — same: the pane rides the container | `ab67408f` |

#### Archive — 14 references (UF-AR-3)

| reference | row id | reason | commit |
| --- | --- | --- | --- |
| `archive-ledger--graphite-warm--1280x720.png` | UF-AR-3 | G1 | `ab67408f` |
| `archive-ledger--graphite-warm--1440x900.png` | UF-AR-3 | G1 | `ab67408f` |
| `archive-ledger--graphite-warm--narrow-1024x768.png` | UF-AR-3 | G1 | `ab67408f` |
| `archive-ledger--paper-ink--1280x720.png` | UF-AR-3 | G1 | `ab67408f` |
| `archive-ledger--paper-ink--1440x900.png` | UF-AR-3 | G1 | `ab67408f` |
| `archive-ledger--paper-ink--narrow-1024x768.png` | UF-AR-3 | G1 | `ab67408f` |
| `archive-run--graphite-warm--1280x720.png` | UF-AR-3 | G1 | `ab67408f` |
| `archive-run--graphite-warm--1440x900.png` | UF-AR-3 | G1 | `ab67408f` |
| `archive-run--graphite-warm--narrow-1024x768.png` | UF-AR-3 | G1 | `ab67408f` |
| `archive-run--paper-ink--1280x720.png` | UF-AR-3 | G1 | `ab67408f` |
| `archive-run--paper-ink--1440x900.png` | UF-AR-3 | G1 | `ab67408f` |
| `archive-run--paper-ink--narrow-1024x768.png` | UF-AR-3 | G1 | `ab67408f` |
| `archive-version-bump--graphite-warm--1440x900.png` | UF-AR-3 | G1 — the bump dialog itself is unchanged; the Archive page BEHIND it is the takeover that moved | `ab67408f` |
| `archive-version-bump--paper-ink--1440x900.png` | UF-AR-3 | G1 — same | `ab67408f` |

#### Explorer — 12 references (UF-EX-2)

| reference | row id | reason | commit |
| --- | --- | --- | --- |
| `explorer-graph--graphite-warm--1280x720.png` | UF-EX-2 | G1 | `ab67408f` |
| `explorer-graph--graphite-warm--1440x900.png` | UF-EX-2 | G1 | `ab67408f` |
| `explorer-graph--graphite-warm--narrow-1024x768.png` | UF-EX-2 | G1 | `ab67408f` |
| `explorer-graph--paper-ink--1280x720.png` | UF-EX-2 | G1 | `ab67408f` |
| `explorer-graph--paper-ink--1440x900.png` | UF-EX-2 | G1 | `ab67408f` |
| `explorer-graph--paper-ink--narrow-1024x768.png` | UF-EX-2 | G1 | `ab67408f` |
| `explorer-transaction--graphite-warm--1280x720.png` | UF-EX-2 | G1 | `ab67408f` |
| `explorer-transaction--graphite-warm--1440x900.png` | UF-EX-2 | G1 | `ab67408f` |
| `explorer-transaction--graphite-warm--narrow-1024x768.png` | UF-EX-2 | G1 | `ab67408f` |
| `explorer-transaction--paper-ink--1280x720.png` | UF-EX-2 | G1 | `ab67408f` |
| `explorer-transaction--paper-ink--1440x900.png` | UF-EX-2 | G1 | `ab67408f` |
| `explorer-transaction--paper-ink--narrow-1024x768.png` | UF-EX-2 | G1 | `ab67408f` |

#### Activity report — 6 references (UF-AC-2)

| reference | row id | reason | commit |
| --- | --- | --- | --- |
| `activity-report--graphite-warm--1280x720.png` | UF-AC-2 | G1 | `ab67408f` |
| `activity-report--graphite-warm--1440x900.png` | UF-AC-2 | G1 | `ab67408f` |
| `activity-report--graphite-warm--narrow-1024x768.png` | UF-AC-2 | G1 | `ab67408f` |
| `activity-report--paper-ink--1280x720.png` | UF-AC-2 | G1 | `ab67408f` |
| `activity-report--paper-ink--1440x900.png` | UF-AC-2 | G1 | `ab67408f` |
| `activity-report--paper-ink--narrow-1024x768.png` | UF-AC-2 | G1 | `ab67408f` |

### Live measurement behind the re-freeze

Taken against this worktree's own vite (`npm run web -- --port 5175`, proxying `/api` to the running
BFF on 3938, view only) with `playwright-cli -s=u2`, headless, via `getBoundingClientRect()` on each
takeover's root `section[aria-label]`. Screenshots in `docs/plans/ui-fidelity-u2/`.

| takeover | 1440×900 | 2000×900 | border | radius |
| --- | --- | --- | --- | --- |
| Settings | `x=0 y=44 w=1440 h=819` | `x=0 y=44 w=2000 h=819` | `0px` | `0px` |
| Settings' 220px nav | `x=0 y=44 w=220 h=819` | — | — | — |
| Archive | `x=0 y=44 w=1440 h=819` | `x=0 y=44 w=2000` | `0px` | `0px` |
| Workflow explorer | `x=0 y=44 w=1440 h=819` | `x=0 y=44 w=2000` | `0px` | `0px` |
| Activity report | `x=0 y=44 w=1440 h=819` | `x=0 y=44 w=2000` | `0px` | `0px` |

The audit's demo numbers for the same measurement (UF-SET-1, UF-SET-4, UF-SET-5): `y=44 h=819 x=0
w=1440`, `w=2000` at 2000px, nav `x=0 w=220 h=819`. Equal on every axis.

The motion contract was read back on the live page after the conversion:
`section[aria-label="Activity report"]` carries `data-demo-enter="to"` and `ds-motion-enter`, so
D275 item 2's shared arrival survives inside `TakeoverFrame` rather than in four copies.

## U3 — the four `fix-now` seams (UF-SET-2 · 9 · 22 · 25 · 26 · 31)

**Branch:** `feature/ui-u3` · `npm run test:parity:update` run **once**, from the U3 worktree, after
all four seams had landed and their unit tests were green.

| | |
| --- | --- |
| references changed | **44** |
| references minted | **0** |
| **total** | **44** |
| **attributed** | **44** |
| **UNATTRIBUTED** | **0** |

Assert-mode proof, before the update (the 44 that moved):

```
44 failed
174 passed (3.6m)
```

Assert-mode proof, after the update:

```
218 passed (3.1m)
```

### The two changes, named once

| id | what changed in the reference | attributed to |
| --- | --- | --- |
| **U3-A** | `- button "Dashboard" [pressed]` → `- button "Dashboard"` in the top bar, on every capture taken with a takeover the switcher does not name (Settings, intake, the catalog) | **UF-SET-2** — `shellViewOf` (`src/dashboard/app/url-state.ts`) replaces the `"queue"` fallback. The switcher and the gear were both claiming "you are here"; the demo has never done that (legacy `1ec1d870` `DemoShell.tsx:560-573`). Commit `e1c978f4` |
| **U3-B** | the Settings nav entry `link "Storage"` → `link "Storage health"` | **UF-SET-9** — the label is SERVED (`src/server/dashboard/queries/bootstrap.ts`), and `tests/parity/helpers/fixture-day.ts` mirrors the server by its own stated rule. Commit `7975e209` |

`U3-A` is the whole of the change on 36 of the 44; the six plain `settings--*` captures carry
`U3-A + U3-B`; the two Settings PANES carry those plus their own row below.

### Every reference, attributed

| reference | verdict | what moved | attributed to |
| --- | --- | --- | --- |
| `catalog-search--{graphite-warm,paper-ink}--{1280x720,1440x900,narrow-1024x768}` (6) | changed | the switcher stopped pressing `Dashboard` behind the catalog takeover | U3-A |
| `intake-upload--…` (6) | changed | the switcher stopped pressing `Dashboard` behind the intake takeover | U3-A |
| `intake-mapping--…` (6) | changed | as above | U3-A |
| `intake-review--…` (6) | changed | as above | U3-A |
| `intake-manifest--…` (6) | changed | as above | U3-A |
| `intake-rerun--…` (6) | changed | as above | U3-A |
| `settings--{graphite-warm,paper-ink}--{1280x720,1440x900,narrow-1024x768}` (6) | changed | the switcher stopped pressing `Dashboard`; the nav entry is now `Storage health` | U3-A · U3-B |
| `settings--graphite-warm--1440x900--system-hosts` | changed | U3-A · U3-B, plus: the section subtitle became the demo's *"Which machine each system resolves to. Choosing between them is a per-run question, asked in the run modal."*, and every table row's SYSTEM cell became the system's name over its one explanatory sentence (`cell "ucpath"` → `cell "UCPath A UCPath write on the test host files nothing real and reads a stale copy of the roster."`) | U3-A · U3-B · **UF-SET-22** · **UF-SET-25** · **UF-SET-26**, commit `6db7e75f` |
| `settings--graphite-warm--1440x900--capabilities` | changed | U3-A · U3-B, plus the section subtitle became the demo's *"What each workflow can do — and, where it cannot, whether that is a decision or a gap."* | U3-A · U3-B · **UF-SET-31**, commit `6db7e75f` |

### What did NOT move, and why that is the proof

`queue-day`, every `run-*`, `archive-*`, `explorer-*`, `ds-kit`, `capture-*` and the `start-run-*`
family are **untouched**. That is the assertion U3-A is making: the `queue`, `archive`, `explorer`
and `activity` segments press exactly as they did, and only the three takeovers the switcher does
not name changed. A diff that had reached the queue captures would have meant the fold broke the
arms it was not supposed to touch.

No `.meta.json` moved: nothing under a descriptor's import closure was edited, so no
`descriptorHash` changed. `npm run build:manifest` was therefore not run and not needed.

## U4b — closing the U3 review findings (UF-SET-26 revisited)

**One reference moved: `settings--graphite-warm--1440x900--system-hosts` (both halves — the a11y
YAML and the PNG).** Re-frozen with `PARITY_UPDATE=1 npx playwright test --config
playwright.parity.config.ts -g "settings system-hosts"` — scoped to the one spec on purpose, so the
update could not quietly absorb a second drift.

| id | what moved | attributed to |
| --- | --- | --- |
| **U4b-A** | the OnBase row's note → *"No test host is provisioned — a test run here is refused at enqueue rather than silently sent to production."*, and the I-9 row's → *"No test host is provisioned. The doctor's I-9 test-instance check reports the same thing."* | **UF-SET-26**, corrected. U3 re-authored these two on a rule it invented ("a note describes the SYSTEM, never this deployment's config"); the operator ruled that the demo is the design authority for everything it covers, so both are the demo's sentences byte for byte (legacy `1ec1d870` `demo-runstart-wire.ts:114-118` and `:119-123`). Commit `a656c75c` |
| **U4b-B** | PNG only — the two URL cells clip at `max-w-[260px] truncate` instead of wrapping a deep PeopleSoft route across three lines mid-token. The demo's own treatment (`DemoSettings.tsx:845-850`); a `title` attribute is ours, and does not appear in either reference | the U3 ui-review finding on URL fragmentation at 1440. Commit `a01c6bf0` |

The a11y YAML carries U4b-A alone — a `title` attribute is not in the accessibility tree at this
capture depth, and truncation is visual. The PNG carries both.

### What did NOT move

No other reference changed: the two ported sentences and the URL clipping live only in the System
hosts pane, and the plain `settings--*` captures open on Storage. `DESIGN.md`, `src/dashboard/CLAUDE.md`
and the three unit tests U4b touched are not rendered surfaces. No `.meta.json` moved — nothing under
a descriptor's import closure was edited, so `npm run build:manifest` was again not needed.

## Merge — feature/ui-u3 into feature/ui-fidelity (after feature/ui-u2)

Eight `settings--*.png` references were re-frozen by BOTH units — U2 for the full-bleed takeover
geometry (UF-SET-1/4/5) and U3/U4b for the unpressed `Dashboard` segment, the `Storage health` label
and the ported notes (UF-SET-2/9/22/25/26/31) — so neither side's PNG was the composite. The merge
took neither: after the text merge the eight were re-generated once from the merged tree
(`PARITY_UPDATE=1 … -g settings`, 8 passed) and are attributed here. No `.a11y.yml` moved in the
merge — the trees auto-merged and the scoped run re-wrote none of them, which is the proof the two
sides' a11y deltas were disjoint.

| reference | row ids | reason | commit |
|---|---|---|---|
| `settings--graphite-warm--1280x720.png` | UF-SET-1/4/5 + UF-SET-2/9 | composite of both sides | the merge commit |
| `settings--graphite-warm--1440x900.png` | UF-SET-1/4/5 + UF-SET-2/9 | composite of both sides | the merge commit |
| `settings--graphite-warm--narrow-1024x768.png` | UF-SET-1/4/5 + UF-SET-2/9 | composite of both sides | the merge commit |
| `settings--paper-ink--1280x720.png` | UF-SET-1/4/5 + UF-SET-2/9 | composite of both sides | the merge commit |
| `settings--paper-ink--1440x900.png` | UF-SET-1/4/5 + UF-SET-2/9 | composite of both sides | the merge commit |
| `settings--paper-ink--narrow-1024x768.png` | UF-SET-1/4/5 + UF-SET-2/9 | composite of both sides | the merge commit |
| `settings--graphite-warm--1440x900--system-hosts.png` | UF-SET-1/4/5 + UF-SET-2/9/22/25/26 | composite of both sides | the merge commit |
| `settings--graphite-warm--1440x900--capabilities.png` | UF-SET-1/4/5 + UF-SET-2/9/31 | composite of both sides | the merge commit |

## UI-2

### U7 — intake and the UI catalog adopt `TakeoverFrame` (UF-FU-1)

**Date:** 2026-08-27 · **Unit:** run UI-2, U7 · **Branch:** `feature/ui-u7` · **Implementation:**
`1a881443`

The assert lane was run before the update. Its failures were exactly the five intake scenes and the
catalog scene, in both themes and all three viewports:

```
36 failed
182 passed (3.8m)
```

The deliberate update was then scoped to those names:

```
HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation \
  npm run test:parity:update -- --grep 'intake-|catalog-search'
40 passed (55.2s)
```

The command's 40 are the 36 reference captures plus 4 matching intake accessibility specifications;
only the 36 named captures own reference files.

Assert-mode proof after the update:

```
218 passed (3.3m)
```

| | |
| --- | --- |
| references changed | **36** |
| references minted | **0** |
| **total** | **36** |
| **attributed** | **36** |
| **UNATTRIBUTED** | **0** |
| changed files | **66** = 36 `.png` + 30 `.a11y.yml` + 0 `.meta.json` |

| reference family | count | visual attribution | accessibility attribution |
| --- | ---: | --- | --- |
| `catalog-search--{graphite-warm,paper-ink}--{1280x720,1440x900,narrow-1024x768}` | 6 | **U7-A** | byte-identical: the old `Panel` and new frame both name the region `UI catalog` |
| `intake-upload--…` | 6 | **U7-A** | **U7-B** |
| `intake-mapping--…` | 6 | **U7-A** | **U7-B** |
| `intake-review--…` | 6 | **U7-A** | **U7-B** |
| `intake-manifest--…` | 6 | **U7-A** | **U7-B** |
| `intake-rerun--…` | 6 | **U7-A** | **U7-B** |

| id | what changed | attributed to |
| --- | --- | --- |
| **U7-A** | Each surface moved from the shell's `x=12`, `w=viewport−24`, bottom-gutter wrapper and its own bordered, rounded `Panel` to the shared full-bleed frame at `x=0`, `w=viewport`, flush between the top bar and Sessions bar. The card border/radius disappeared; no body, copy, control or intake-column composition changed. | **UF-FU-1**, the standing UI-2 receive under D281, constrained by **D275 item 2**. Commit `1a881443`. |
| **U7-B** | Intake gained one named `region "Spreadsheet intake"` around the exact prior subtree. This is the accessible page name the frame focuses on enter. In the upload state its first Tab remains `Close`; in the loaded-session states it remains `Another file`. The catalog's first Tab remains `Close the UI catalog`. | **UF-FU-1** focus-on-enter acceptance and `tests/unit/dashboard/takeover-frame-focus.test.ts`. Commit `1a881443`. |

The PNGs were inspected at `1440x900` before and after in both families: the only visual delta is
U7-A's frame geometry. The intake a11y diff is one level of nesting under U7-B's named region; every
descendant name and order is unchanged. Catalog a11y is byte-identical, and no `.meta.json` moved —
no descriptor source closure, fixture identity or viewport metadata changed. D278's intake-column
layout is untouched by construction.
