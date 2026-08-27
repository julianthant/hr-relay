# UI-1 U2 — the deliberate parity re-freeze, attributed

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

## The one change behind all 40

| id | what changed | attributed to |
| --- | --- | --- |
| **G1** | the takeover's container geometry: the surface's root moved from `x=12, w=viewport−24`, `border 1px`, `radius --ds-radius-lg`, `bg --ds-surface-1`, sitting under a `pb-[--ds-space-base]` bottom gutter, to **`x=0, w=viewport, border 0, radius 0`, flush under the top bar at `y=44` and flush to the sessions bar**. Every pixel in every one of the 40 references is displaced by that: content shifts left 12px, the card's hairline and its four rounded corners are gone, and the surface gains 24px of width and 12px of height. | commit `ab67408f` — `feat(dashboard): the four takeovers replace the window, full-bleed`. Audit rows **UF-SET-1**, **UF-SET-4**, **UF-SET-5**, **UF-AR-3**, **UF-EX-2**, **UF-AC-2** in `docs/plans/2026-08-27-ui-fidelity-audit.md` §2a/§3/§4/§5 and its Summary A. Ratified by **D272 item 1** + **D274 item 5** (Settings is the demo's full-page takeover) and constrained by **D275 item 2** (one shared takeover wrapper, kept as an accessibility/motion convention — `TakeoverFrame` now owns it). Ported from legacy `1ec1d870`, `src/dashboard/components/dev/rebuild-demo/RebuildDemo.tsx:656-678` and `DemoSettings.tsx:1071-1075`. |

There is no second cause. No copy changed, no vocabulary changed, no served fact changed, no
`descriptorHash` moved (this unit edits nothing inside a descriptor's import closure), and no scene
outside the four converted surfaces failed the assert lane — the 178 that passed before the update
are the proof of that half.

## The 40 references, one row each

Every row is `G1`. Viewports are the lane's three (`1280x720`, `1440x900`, `narrow-1024x768`) and
themes its two (`graphite-warm`, `paper-ink`); the two Settings panes and the two version-bump
captures are `1440x900` only, which is how the corpus already held them.

### Settings — 8 references (UF-SET-1 / UF-SET-4 / UF-SET-5)

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

### Archive — 14 references (UF-AR-3)

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

### Explorer — 12 references (UF-EX-2)

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

### Activity report — 6 references (UF-AC-2)

| reference | row id | reason | commit |
| --- | --- | --- | --- |
| `activity-report--graphite-warm--1280x720.png` | UF-AC-2 | G1 | `ab67408f` |
| `activity-report--graphite-warm--1440x900.png` | UF-AC-2 | G1 | `ab67408f` |
| `activity-report--graphite-warm--narrow-1024x768.png` | UF-AC-2 | G1 | `ab67408f` |
| `activity-report--paper-ink--1280x720.png` | UF-AC-2 | G1 | `ab67408f` |
| `activity-report--paper-ink--1440x900.png` | UF-AC-2 | G1 | `ab67408f` |
| `activity-report--paper-ink--narrow-1024x768.png` | UF-AC-2 | G1 | `ab67408f` |

## Live measurement behind the re-freeze

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
