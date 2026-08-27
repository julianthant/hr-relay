# UI-1 — the deliberate parity re-freezes, attributed

**Date:** 2026-08-27 · **Run:** UI-1 (demo-fidelity `fix-now` rows) · **Base:** `feature/ui-fidelity`

Same rule as `2026-08-26-p1-refreeze-attribution.md`: a green lane after a re-freeze proves only that
the lane agrees with itself. The claim worth making is that **every reference that moved, moved for a
named reason**, and each unit's section below states that one reference family at a time.

A reference is one capture name — its `.a11y.yml` and its `.png` together, which the lane refreshes
as a unit and can never refresh independently.

---

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
