# P1 — the deliberate parity re-freeze, attributed

**Date:** 2026-08-26 · **Unit:** P1 (Track F exit) · **Branch:** `feature/parity-refreeze`

`npm run test:parity:update` was run **exactly once**, over the whole corpus, after every reviewed
UI unit had merged. This document is the deliverable. A green lane after a re-freeze proves only
that the lane agrees with itself — the claim worth making is that **every reference that moved,
moved for a named reason**, and that is what the table below states one reference at a time.

| | |
| --- | --- |
| references changed | **145** |
| references minted | **23** |
| **total** | **168** |
| **attributed** | **168** |
| **UNATTRIBUTED** | **0** |

A reference is one capture name — its `.a11y.yml`, its `.meta.json` and its `.png` together, which
the lane refreshes as a unit and can never refresh independently.

Assert-mode proof, verbatim:

```
218 passed (2.9m)
```

## The seven cross-cutting changes

Most references carry more than one change, and seven of them recur across whole families. They are
named once here and cited as `X1`…`X7` in the table rather than repeated 145 times.

| id | what changed | attributed to |
| --- | --- | --- |
| **X1** | the `descriptorHash` provenance stamp moved once and globally, `ff645d02…` → `09a0111b…`, in every `.meta.json`, every `.a11y.yml` header, and the shell's own `wf ` stamp | merged units edited `src/domain/**` inside the person-lookup descriptor's import closure. `npm run build:manifest` regenerates **clean**, so the new value is a live derivation over this tree, not a stale record. The Explorer's `impl` fingerprints moved for the same reason — `taskFingerprint` reads the same generated manifest. |
| **X2** | the shell footer: `1 worker need attention` → `1 workers need attention`, and `app 0.1.0` → `app 0.1` | shell-footer plural + two-part app version (`20e17d68`) |
| **X3** | the queue toolbar gained the `Workflow explorer` and `UI catalog` doors | catalog unit (`0fd7e596`), after the glyphs left the top bar (`8f55a168`) |
| **X4** | queue rows: the gate age reaches the row's accessible name (`— review · 16m 0s`), and each member line split into a row button plus its own `Mark … checked by you` toggle | gate age, ledger 1 B31 (`6203013e`) · queue local triage and the 44px member toggle, units **F2/F2c** (`7cca0fce`, `500dc7cb`) |
| **X5** | every `Run shape` bar became a named `role="img"` — a bare `<span>` with `aria-label` names nothing | **D273 items 2–4** (`b82374b0`), unit **F6b** (`03e268a7`) |
| **X6** | the run log became a named `list "Run log lines"` whose items name their level, time and text | observed log ledger (`7d851f05`) |
| **X7** | the stream-liveness word (`idle` / `live`) appears beside the log | **D273 item 4** liveness (`b82374b0`, `03e268a7`) |

## What this unit itself changed

Three of the 168 rows are attributed to **unit P1** rather than to a unit that merged before it,
because this unit did the work the re-freeze was booked to carry:

1. **`ds/Checkbox` names its own control** (`70f986fc`). A `<label for>` names an `<input>` and does
   not name the `<button role="checkbox">` Radix renders, so every checkbox in the bundle shipped
   with an EMPTY accessible name. The primitive now points `aria-labelledby` at its own label span,
   and intake's duplicate surface-level `aria-label` is deleted rather than kept as a second
   expression that can drift. The 2026-08-26 lesson booked this fix for the re-freeze precisely
   because naming them all rewrites a11y references. **`ds-kit` is the only reference in the corpus
   that proves it** — every other checkbox in the bundle is on a surface no reference opens.
2. **The fixture finally serves `timeline.steps`** (`0e5bc102`). D225's categorical strip had never
   been photographed at all: `fixture-day` served no steps, so `Timeline` took its per-event arm for
   every reference ever captured. `run-group` — the composed separations sweep, which is the case
   D225 was written for — now carries five categories including a `×2` re-execution, a `replayed`
   one (D259) and a `pending` one. This closes the gap **F6** flagged.
3. **Four subjects the corpus had never looked at** were added as scenes: the Settings takeover, the
   version-bump authoring dialog, the DS specimen page, and the twelve intake-manifest /
   intake-rerun references whose scenarios existed with nothing behind them (the gap **PFIX**
   exposed).

## One thing the re-freeze found that is NOT a reference

`tests/parity/diagnostic-bundle-dialog.spec.ts` — five behavioural tests, all timing out at the full
120 s deadline. **D273 item 8** (`823b266b`) put the failure record's whole diagnostic subtree behind
a `Show the diagnostic record` disclosure and these specs were never updated, so they had been
addressing a subtree that is not mounted. Repaired in `18b5e9d4` with one helper that asserts the
trigger exists before pressing it. No reference was involved, so nothing in the corpus moved for it —
but the lane had been red on merge and only the deliberate re-freeze looked.

## One finding left open

`PanelHeader` renders its title as a styled `<span>`, so **no Settings pane carries a heading at
all** — `getByRole("heading", { name: "System hosts" })` matches nothing. The new `settings`
references photograph the surface as it ships. This belongs in a fidelity unit, not in a re-freeze,
and the note is recorded at the locator in `dashboard-reference.spec.ts` where the next reader will
look.

## Every reference, one row each

| reference | | what changed | attributed to |
| --- | --- | --- | --- |
| `activity-report--graphite-warm--1280x720` | changed | From/To wrapped in a named `Report span` group | **D276 item 4** (`b855a0ed`) · X1 · X2 |
| `activity-report--graphite-warm--1440x900` | changed | From/To wrapped in a named `Report span` group | **D276 item 4** (`b855a0ed`) · X1 · X2 |
| `activity-report--graphite-warm--narrow-1024x768` | changed | From/To wrapped in a named `Report span` group | **D276 item 4** (`b855a0ed`) · X1 · X2 |
| `activity-report--paper-ink--1280x720` | changed | From/To wrapped in a named `Report span` group | **D276 item 4** (`b855a0ed`) · X1 · X2 |
| `activity-report--paper-ink--1440x900` | changed | From/To wrapped in a named `Report span` group | **D276 item 4** (`b855a0ed`) · X1 · X2 |
| `activity-report--paper-ink--narrow-1024x768` | changed | From/To wrapped in a named `Report span` group | **D276 item 4** (`b855a0ed`) · X1 · X2 |
| `archive-ledger--graphite-warm--1280x720` | changed | status option `done`→`Done`; table renamed `Archived runs`; the sweep row carries the bump KIND (`major`) and the short workflow code (`pl`) | **D274/D275/D276 bump-kind** (`b2cea881`, `18e7daeb`) · unit **F10c/F10d** · X1 · X2 |
| `archive-ledger--graphite-warm--1440x900` | changed | status option `done`→`Done`; table renamed `Archived runs`; the sweep row carries the bump KIND (`major`) and the short workflow code (`pl`) | **D274/D275/D276 bump-kind** (`b2cea881`, `18e7daeb`) · unit **F10c/F10d** · X1 · X2 |
| `archive-ledger--graphite-warm--narrow-1024x768` | changed | status option `done`→`Done`; table renamed `Archived runs`; the sweep row carries the bump KIND (`major`) and the short workflow code (`pl`) | **D274/D275/D276 bump-kind** (`b2cea881`, `18e7daeb`) · unit **F10c/F10d** · X1 · X2 |
| `archive-ledger--paper-ink--1280x720` | changed | status option `done`→`Done`; table renamed `Archived runs`; the sweep row carries the bump KIND (`major`) and the short workflow code (`pl`) | **D274/D275/D276 bump-kind** (`b2cea881`, `18e7daeb`) · unit **F10c/F10d** · X1 · X2 |
| `archive-ledger--paper-ink--1440x900` | changed | status option `done`→`Done`; table renamed `Archived runs`; the sweep row carries the bump KIND (`major`) and the short workflow code (`pl`) | **D274/D275/D276 bump-kind** (`b2cea881`, `18e7daeb`) · unit **F10c/F10d** · X1 · X2 |
| `archive-ledger--paper-ink--narrow-1024x768` | changed | status option `done`→`Done`; table renamed `Archived runs`; the sweep row carries the bump KIND (`major`) and the short workflow code (`pl`) | **D274/D275/D276 bump-kind** (`b2cea881`, `18e7daeb`) · unit **F10c/F10d** · X1 · X2 |
| `archive-run--graphite-warm--1280x720` | changed | all of `archive-ledger`, plus `Back to the ledger`→`Back to the dashboard`, the detail's priority/label/code facts, `Major — the run's shape changed`, and the attempts line re-homed | **D274/D275/D276** (`b2cea881`, `18e7daeb`), Settings takeover (`f57cc9a3`), units **F10c/F10d/F10e** (`670cd4d5`, `6bdf0607`, `123da4e5`, `201f4637`, `350f2b0c`) · X1 · X2 |
| `archive-run--graphite-warm--1440x900` | changed | all of `archive-ledger`, plus `Back to the ledger`→`Back to the dashboard`, the detail's priority/label/code facts, `Major — the run's shape changed`, and the attempts line re-homed | **D274/D275/D276** (`b2cea881`, `18e7daeb`), Settings takeover (`f57cc9a3`), units **F10c/F10d/F10e** (`670cd4d5`, `6bdf0607`, `123da4e5`, `201f4637`, `350f2b0c`) · X1 · X2 |
| `archive-run--graphite-warm--narrow-1024x768` | changed | all of `archive-ledger`, plus `Back to the ledger`→`Back to the dashboard`, the detail's priority/label/code facts, `Major — the run's shape changed`, and the attempts line re-homed | **D274/D275/D276** (`b2cea881`, `18e7daeb`), Settings takeover (`f57cc9a3`), units **F10c/F10d/F10e** (`670cd4d5`, `6bdf0607`, `123da4e5`, `201f4637`, `350f2b0c`) · X1 · X2 |
| `archive-run--paper-ink--1280x720` | changed | all of `archive-ledger`, plus `Back to the ledger`→`Back to the dashboard`, the detail's priority/label/code facts, `Major — the run's shape changed`, and the attempts line re-homed | **D274/D275/D276** (`b2cea881`, `18e7daeb`), Settings takeover (`f57cc9a3`), units **F10c/F10d/F10e** (`670cd4d5`, `6bdf0607`, `123da4e5`, `201f4637`, `350f2b0c`) · X1 · X2 |
| `archive-run--paper-ink--1440x900` | changed | all of `archive-ledger`, plus `Back to the ledger`→`Back to the dashboard`, the detail's priority/label/code facts, `Major — the run's shape changed`, and the attempts line re-homed | **D274/D275/D276** (`b2cea881`, `18e7daeb`), Settings takeover (`f57cc9a3`), units **F10c/F10d/F10e** (`670cd4d5`, `6bdf0607`, `123da4e5`, `201f4637`, `350f2b0c`) · X1 · X2 |
| `archive-run--paper-ink--narrow-1024x768` | changed | all of `archive-ledger`, plus `Back to the ledger`→`Back to the dashboard`, the detail's priority/label/code facts, `Major — the run's shape changed`, and the attempts line re-homed | **D274/D275/D276** (`b2cea881`, `18e7daeb`), Settings takeover (`f57cc9a3`), units **F10c/F10d/F10e** (`670cd4d5`, `6bdf0607`, `123da4e5`, `201f4637`, `350f2b0c`) · X1 · X2 |
| `archive-version-bump--graphite-warm--1440x900` | new | **NEW** — the version registry and the change-record dialog an operator authors before a MAJOR bump, never photographed | **unit P1** (this unit) over **D179** / charter §25 |
| `archive-version-bump--paper-ink--1440x900` | new | **NEW** — the version registry and the change-record dialog an operator authors before a MAJOR bump, never photographed | **unit P1** (this unit) over **D179** / charter §25 |
| `capture-empty--paper-ink--phone-390x844` | changed | provenance stamp only | X1 |
| `capture-failed--paper-ink--phone-390x844` | changed | provenance stamp only | X1 |
| `capture-photos--paper-ink--phone-390x844` | changed | provenance stamp only | X1 |
| `capture-reorder--paper-ink--phone-390x844` | changed | provenance stamp only | X1 |
| `capture-sent--paper-ink--phone-390x844` | changed | provenance stamp only | X1 |
| `catalog-search--graphite-warm--1280x720` | changed | the flat filtered list became a `Catalog views` tablist over the served row/panel vocabulary | **catalog unit** (`0fd7e596`) · X1 · X2 |
| `catalog-search--graphite-warm--1440x900` | changed | the flat filtered list became a `Catalog views` tablist over the served row/panel vocabulary | **catalog unit** (`0fd7e596`) · X1 · X2 |
| `catalog-search--graphite-warm--narrow-1024x768` | changed | the flat filtered list became a `Catalog views` tablist over the served row/panel vocabulary | **catalog unit** (`0fd7e596`) · X1 · X2 |
| `catalog-search--paper-ink--1280x720` | changed | the flat filtered list became a `Catalog views` tablist over the served row/panel vocabulary | **catalog unit** (`0fd7e596`) · X1 · X2 |
| `catalog-search--paper-ink--1440x900` | changed | the flat filtered list became a `Catalog views` tablist over the served row/panel vocabulary | **catalog unit** (`0fd7e596`) · X1 · X2 |
| `catalog-search--paper-ink--narrow-1024x768` | changed | the flat filtered list became a `Catalog views` tablist over the served row/panel vocabulary | **catalog unit** (`0fd7e596`) · X1 · X2 |
| `ds-kit--graphite-warm--1440x900` | new | **NEW** — the DS specimen page, full-page; the only reference in the corpus that proves `ds/Checkbox` now names its control | **unit P1** (this unit) over **D274 item 3** / ledger 3 UK146–UK157 |
| `explorer-graph--graphite-warm--1280x720` | changed | `Version registry` door added; the contract card's `impl` fingerprint moved | **explorer registry door** (`4e09fb49`) · X1 (same manifest derivation) · X2 |
| `explorer-graph--graphite-warm--1440x900` | changed | `Version registry` door added; the contract card's `impl` fingerprint moved | **explorer registry door** (`4e09fb49`) · X1 (same manifest derivation) · X2 |
| `explorer-graph--graphite-warm--narrow-1024x768` | changed | `Version registry` door added; the contract card's `impl` fingerprint moved | **explorer registry door** (`4e09fb49`) · X1 (same manifest derivation) · X2 |
| `explorer-graph--paper-ink--1280x720` | changed | `Version registry` door added; the contract card's `impl` fingerprint moved | **explorer registry door** (`4e09fb49`) · X1 (same manifest derivation) · X2 |
| `explorer-graph--paper-ink--1440x900` | changed | `Version registry` door added; the contract card's `impl` fingerprint moved | **explorer registry door** (`4e09fb49`) · X1 (same manifest derivation) · X2 |
| `explorer-graph--paper-ink--narrow-1024x768` | changed | `Version registry` door added; the contract card's `impl` fingerprint moved | **explorer registry door** (`4e09fb49`) · X1 (same manifest derivation) · X2 |
| `explorer-transaction--graphite-warm--1280x720` | changed | `Version registry` door added; the contract card's `impl` fingerprint moved | **explorer registry door** (`4e09fb49`) · X1 (same manifest derivation) · X2 |
| `explorer-transaction--graphite-warm--1440x900` | changed | `Version registry` door added; the contract card's `impl` fingerprint moved | **explorer registry door** (`4e09fb49`) · X1 (same manifest derivation) · X2 |
| `explorer-transaction--graphite-warm--narrow-1024x768` | changed | `Version registry` door added; the contract card's `impl` fingerprint moved | **explorer registry door** (`4e09fb49`) · X1 (same manifest derivation) · X2 |
| `explorer-transaction--paper-ink--1280x720` | changed | `Version registry` door added; the contract card's `impl` fingerprint moved | **explorer registry door** (`4e09fb49`) · X1 (same manifest derivation) · X2 |
| `explorer-transaction--paper-ink--1440x900` | changed | `Version registry` door added; the contract card's `impl` fingerprint moved | **explorer registry door** (`4e09fb49`) · X1 (same manifest derivation) · X2 |
| `explorer-transaction--paper-ink--narrow-1024x768` | changed | `Version registry` door added; the contract card's `impl` fingerprint moved | **explorer registry door** (`4e09fb49`) · X1 (same manifest derivation) · X2 |
| `intake-manifest--graphite-warm--1280x720` | new | **NEW** — the scenario has existed since `1274fe11` with no reference behind it (the gap PFIX exposed) | **unit P1** (this unit) minting **`1274fe11`**'s manifest stage |
| `intake-manifest--graphite-warm--1440x900` | new | **NEW** — the scenario has existed since `1274fe11` with no reference behind it (the gap PFIX exposed) | **unit P1** (this unit) minting **`1274fe11`**'s manifest stage |
| `intake-manifest--graphite-warm--narrow-1024x768` | new | **NEW** — the scenario has existed since `1274fe11` with no reference behind it (the gap PFIX exposed) | **unit P1** (this unit) minting **`1274fe11`**'s manifest stage |
| `intake-manifest--paper-ink--1280x720` | new | **NEW** — the scenario has existed since `1274fe11` with no reference behind it (the gap PFIX exposed) | **unit P1** (this unit) minting **`1274fe11`**'s manifest stage |
| `intake-manifest--paper-ink--1440x900` | new | **NEW** — the scenario has existed since `1274fe11` with no reference behind it (the gap PFIX exposed) | **unit P1** (this unit) minting **`1274fe11`**'s manifest stage |
| `intake-manifest--paper-ink--narrow-1024x768` | new | **NEW** — the scenario has existed since `1274fe11` with no reference behind it (the gap PFIX exposed) | **unit P1** (this unit) minting **`1274fe11`**'s manifest stage |
| `intake-mapping--graphite-warm--1280x720` | changed | header-row options carry `· confidence N`; the bind reason carries its score `(1.00)`; `Manifest`/`Rerun diff` tabs; the layout fingerprint line and its full-value door; `Run`→`Start runs` | **F2a IN8/IN9/IN53/IN82** (`80967ce5`), manifest+rerun stages (`1274fe11`), full identifiers (`ce4ba649`), rejection-review flow (`e3d5b632`) · X1 · X2 |
| `intake-mapping--graphite-warm--1440x900` | changed | header-row options carry `· confidence N`; the bind reason carries its score `(1.00)`; `Manifest`/`Rerun diff` tabs; the layout fingerprint line and its full-value door; `Run`→`Start runs` | **F2a IN8/IN9/IN53/IN82** (`80967ce5`), manifest+rerun stages (`1274fe11`), full identifiers (`ce4ba649`), rejection-review flow (`e3d5b632`) · X1 · X2 |
| `intake-mapping--graphite-warm--narrow-1024x768` | changed | header-row options carry `· confidence N`; the bind reason carries its score `(1.00)`; `Manifest`/`Rerun diff` tabs; the layout fingerprint line and its full-value door; `Run`→`Start runs` | **F2a IN8/IN9/IN53/IN82** (`80967ce5`), manifest+rerun stages (`1274fe11`), full identifiers (`ce4ba649`), rejection-review flow (`e3d5b632`) · X1 · X2 |
| `intake-mapping--paper-ink--1280x720` | changed | header-row options carry `· confidence N`; the bind reason carries its score `(1.00)`; `Manifest`/`Rerun diff` tabs; the layout fingerprint line and its full-value door; `Run`→`Start runs` | **F2a IN8/IN9/IN53/IN82** (`80967ce5`), manifest+rerun stages (`1274fe11`), full identifiers (`ce4ba649`), rejection-review flow (`e3d5b632`) · X1 · X2 |
| `intake-mapping--paper-ink--1440x900` | changed | header-row options carry `· confidence N`; the bind reason carries its score `(1.00)`; `Manifest`/`Rerun diff` tabs; the layout fingerprint line and its full-value door; `Run`→`Start runs` | **F2a IN8/IN9/IN53/IN82** (`80967ce5`), manifest+rerun stages (`1274fe11`), full identifiers (`ce4ba649`), rejection-review flow (`e3d5b632`) · X1 · X2 |
| `intake-mapping--paper-ink--narrow-1024x768` | changed | header-row options carry `· confidence N`; the bind reason carries its score `(1.00)`; `Manifest`/`Rerun diff` tabs; the layout fingerprint line and its full-value door; `Run`→`Start runs` | **F2a IN8/IN9/IN53/IN82** (`80967ce5`), manifest+rerun stages (`1274fe11`), full identifiers (`ce4ba649`), rejection-review flow (`e3d5b632`) · X1 · X2 |
| `intake-rerun--graphite-warm--1280x720` | new | **NEW** — the scenario has existed since `1274fe11` with no reference behind it (the gap PFIX exposed) | **unit P1** (this unit) minting **`1274fe11`**'s rerun stage |
| `intake-rerun--graphite-warm--1440x900` | new | **NEW** — the scenario has existed since `1274fe11` with no reference behind it (the gap PFIX exposed) | **unit P1** (this unit) minting **`1274fe11`**'s rerun stage |
| `intake-rerun--graphite-warm--narrow-1024x768` | new | **NEW** — the scenario has existed since `1274fe11` with no reference behind it (the gap PFIX exposed) | **unit P1** (this unit) minting **`1274fe11`**'s rerun stage |
| `intake-rerun--paper-ink--1280x720` | new | **NEW** — the scenario has existed since `1274fe11` with no reference behind it (the gap PFIX exposed) | **unit P1** (this unit) minting **`1274fe11`**'s rerun stage |
| `intake-rerun--paper-ink--1440x900` | new | **NEW** — the scenario has existed since `1274fe11` with no reference behind it (the gap PFIX exposed) | **unit P1** (this unit) minting **`1274fe11`**'s rerun stage |
| `intake-rerun--paper-ink--narrow-1024x768` | new | **NEW** — the scenario has existed since `1274fe11` with no reference behind it (the gap PFIX exposed) | **unit P1** (this unit) minting **`1274fe11`**'s rerun stage |
| `intake-review--graphite-warm--1280x720` | changed | all of `intake-mapping`, plus the rejection review rebuilt from per-row regions into ONE Row/Kind/Field/Why/Resolve table with the `I have read all 4 rejected rows` acknowledgement | **rejection-review flow** (`e3d5b632`); the checkbox's accessible NAME is **unit P1**'s own primitive fix (`70f986fc`) · X1 · X2 |
| `intake-review--graphite-warm--1440x900` | changed | all of `intake-mapping`, plus the rejection review rebuilt from per-row regions into ONE Row/Kind/Field/Why/Resolve table with the `I have read all 4 rejected rows` acknowledgement | **rejection-review flow** (`e3d5b632`); the checkbox's accessible NAME is **unit P1**'s own primitive fix (`70f986fc`) · X1 · X2 |
| `intake-review--graphite-warm--narrow-1024x768` | changed | all of `intake-mapping`, plus the rejection review rebuilt from per-row regions into ONE Row/Kind/Field/Why/Resolve table with the `I have read all 4 rejected rows` acknowledgement | **rejection-review flow** (`e3d5b632`); the checkbox's accessible NAME is **unit P1**'s own primitive fix (`70f986fc`) · X1 · X2 |
| `intake-review--paper-ink--1280x720` | changed | all of `intake-mapping`, plus the rejection review rebuilt from per-row regions into ONE Row/Kind/Field/Why/Resolve table with the `I have read all 4 rejected rows` acknowledgement | **rejection-review flow** (`e3d5b632`); the checkbox's accessible NAME is **unit P1**'s own primitive fix (`70f986fc`) · X1 · X2 |
| `intake-review--paper-ink--1440x900` | changed | all of `intake-mapping`, plus the rejection review rebuilt from per-row regions into ONE Row/Kind/Field/Why/Resolve table with the `I have read all 4 rejected rows` acknowledgement | **rejection-review flow** (`e3d5b632`); the checkbox's accessible NAME is **unit P1**'s own primitive fix (`70f986fc`) · X1 · X2 |
| `intake-review--paper-ink--narrow-1024x768` | changed | all of `intake-mapping`, plus the rejection review rebuilt from per-row regions into ONE Row/Kind/Field/Why/Resolve table with the `I have read all 4 rejected rows` acknowledgement | **rejection-review flow** (`e3d5b632`); the checkbox's accessible NAME is **unit P1**'s own primitive fix (`70f986fc`) · X1 · X2 |
| `intake-upload--graphite-warm--1280x720` | changed | the desktop `Capture session` region appears — state, per-page readback failures, and the received-pages list | **D274 item 7** desktop capture surface (`70a29561`) · X1 · X2 |
| `intake-upload--graphite-warm--1440x900` | changed | the desktop `Capture session` region appears — state, per-page readback failures, and the received-pages list | **D274 item 7** desktop capture surface (`70a29561`) · X1 · X2 |
| `intake-upload--graphite-warm--narrow-1024x768` | changed | the desktop `Capture session` region appears — state, per-page readback failures, and the received-pages list | **D274 item 7** desktop capture surface (`70a29561`) · X1 · X2 |
| `intake-upload--paper-ink--1280x720` | changed | the desktop `Capture session` region appears — state, per-page readback failures, and the received-pages list | **D274 item 7** desktop capture surface (`70a29561`) · X1 · X2 |
| `intake-upload--paper-ink--1440x900` | changed | the desktop `Capture session` region appears — state, per-page readback failures, and the received-pages list | **D274 item 7** desktop capture surface (`70a29561`) · X1 · X2 |
| `intake-upload--paper-ink--narrow-1024x768` | changed | the desktop `Capture session` region appears — state, per-page readback failures, and the received-pages list | **D274 item 7** desktop capture surface (`70a29561`) · X1 · X2 |
| `queue-day--graphite-warm--1280x720` | changed | toolbar doors; gate age in the row's accessible name; the member line split into a row button plus its own `Mark … checked by you` toggle | X1 · X2 · X3 · X4 |
| `queue-day--graphite-warm--1440x900` | changed | toolbar doors; gate age in the row's accessible name; the member line split into a row button plus its own `Mark … checked by you` toggle | X1 · X2 · X3 · X4 |
| `queue-day--graphite-warm--1440x900--panel-dismissed` | changed | toolbar doors; gate age in the row's accessible name; the member line split into a row button plus its own `Mark … checked by you` toggle | X1 · X2 · X3 · X4 |
| `queue-day--graphite-warm--narrow-1024x768` | changed | toolbar doors; gate age in the row's accessible name; the member line split into a row button plus its own `Mark … checked by you` toggle | X1 · X2 · X3 · X4 |
| `queue-day--paper-ink--1280x720` | changed | toolbar doors; gate age in the row's accessible name; the member line split into a row button plus its own `Mark … checked by you` toggle | X1 · X2 · X3 · X4 |
| `queue-day--paper-ink--1440x900` | changed | toolbar doors; gate age in the row's accessible name; the member line split into a row button plus its own `Mark … checked by you` toggle | X1 · X2 · X3 · X4 |
| `queue-day--paper-ink--1440x900--keyboard` | changed | toolbar doors; gate age in the row's accessible name; the member line split into a row button plus its own `Mark … checked by you` toggle | X1 · X2 · X3 · X4 |
| `queue-day--paper-ink--1440x900--panel-dismissed` | changed | toolbar doors; gate age in the row's accessible name; the member line split into a row button plus its own `Mark … checked by you` toggle | X1 · X2 · X3 · X4 |
| `queue-day--paper-ink--1440x900--reduced-motion` | changed | toolbar doors; gate age in the row's accessible name; the member line split into a row button plus its own `Mark … checked by you` toggle | X1 · X2 · X3 · X4 |
| `queue-day--paper-ink--narrow-1024x768` | changed | toolbar doors; gate age in the row's accessible name; the member line split into a row button plus its own `Mark … checked by you` toggle | X1 · X2 · X3 · X4 |
| `run-done--graphite-warm--1280x720` | changed | queue changes, plus every `Run shape` bar became a named `role="img"` and the log became a named list | X1 · X2 · X3 · X4 · X5 · X6 · X7 |
| `run-done--graphite-warm--1440x900` | changed | queue changes, plus every `Run shape` bar became a named `role="img"` and the log became a named list | X1 · X2 · X3 · X4 · X5 · X6 · X7 |
| `run-done--graphite-warm--narrow-1024x768` | changed | queue changes, plus every `Run shape` bar became a named `role="img"` and the log became a named list | X1 · X2 · X3 · X4 · X5 · X6 · X7 |
| `run-done--paper-ink--1280x720` | changed | queue changes, plus every `Run shape` bar became a named `role="img"` and the log became a named list | X1 · X2 · X3 · X4 · X5 · X6 · X7 |
| `run-done--paper-ink--1440x900` | changed | queue changes, plus every `Run shape` bar became a named `role="img"` and the log became a named list | X1 · X2 · X3 · X4 · X5 · X6 · X7 |
| `run-done--paper-ink--narrow-1024x768` | changed | queue changes, plus every `Run shape` bar became a named `role="img"` and the log became a named list | X1 · X2 · X3 · X4 · X5 · X6 · X7 |
| `run-failed--graphite-warm--1280x720` | changed | queue changes, named timeline bars and log list, plus the failure record reframed: `Cause chain`→`Failure record — …`, `What to do`→`What is safe to retry`, a new `What this run left behind`, and the `Show the diagnostic record` disclosure | X1 · X2 · X3 · X4 · X5 · X6 · X7 · **D273 item 8** (`823b266b`), **F8c** (`781d1a8d`) |
| `run-failed--graphite-warm--1440x900` | changed | queue changes, named timeline bars and log list, plus the failure record reframed: `Cause chain`→`Failure record — …`, `What to do`→`What is safe to retry`, a new `What this run left behind`, and the `Show the diagnostic record` disclosure | X1 · X2 · X3 · X4 · X5 · X6 · X7 · **D273 item 8** (`823b266b`), **F8c** (`781d1a8d`) |
| `run-failed--graphite-warm--narrow-1024x768` | changed | queue changes, named timeline bars and log list, plus the failure record reframed: `Cause chain`→`Failure record — …`, `What to do`→`What is safe to retry`, a new `What this run left behind`, and the `Show the diagnostic record` disclosure | X1 · X2 · X3 · X4 · X5 · X6 · X7 · **D273 item 8** (`823b266b`), **F8c** (`781d1a8d`) |
| `run-failed--paper-ink--1280x720` | changed | queue changes, named timeline bars and log list, plus the failure record reframed: `Cause chain`→`Failure record — …`, `What to do`→`What is safe to retry`, a new `What this run left behind`, and the `Show the diagnostic record` disclosure | X1 · X2 · X3 · X4 · X5 · X6 · X7 · **D273 item 8** (`823b266b`), **F8c** (`781d1a8d`) |
| `run-failed--paper-ink--1440x900` | changed | queue changes, named timeline bars and log list, plus the failure record reframed: `Cause chain`→`Failure record — …`, `What to do`→`What is safe to retry`, a new `What this run left behind`, and the `Show the diagnostic record` disclosure | X1 · X2 · X3 · X4 · X5 · X6 · X7 · **D273 item 8** (`823b266b`), **F8c** (`781d1a8d`) |
| `run-failed--paper-ink--narrow-1024x768` | changed | queue changes, named timeline bars and log list, plus the failure record reframed: `Cause chain`→`Failure record — …`, `What to do`→`What is safe to retry`, a new `What this run left behind`, and the `Show the diagnostic record` disclosure | X1 · X2 · X3 · X4 · X5 · X6 · X7 · **D273 item 8** (`823b266b`), **F8c** (`781d1a8d`) |
| `run-group--graphite-warm--1280x720` | changed | queue changes and the named log list, plus **D225's CATEGORICAL strip photographed for the first time** — five segments, `×2` executions, a `replayed` category and a `pending` one | X1 · X2 · X3 · X4 · X6 · X7 · **D225/D259** strip (`ef706b29`, `e9ca7722`); the fixture that finally serves `timeline.steps` is **unit P1** (this unit, F6's flagged gap) |
| `run-group--graphite-warm--1440x900` | changed | queue changes and the named log list, plus **D225's CATEGORICAL strip photographed for the first time** — five segments, `×2` executions, a `replayed` category and a `pending` one | X1 · X2 · X3 · X4 · X6 · X7 · **D225/D259** strip (`ef706b29`, `e9ca7722`); the fixture that finally serves `timeline.steps` is **unit P1** (this unit, F6's flagged gap) |
| `run-group--graphite-warm--narrow-1024x768` | changed | queue changes and the named log list, plus **D225's CATEGORICAL strip photographed for the first time** — five segments, `×2` executions, a `replayed` category and a `pending` one | X1 · X2 · X3 · X4 · X6 · X7 · **D225/D259** strip (`ef706b29`, `e9ca7722`); the fixture that finally serves `timeline.steps` is **unit P1** (this unit, F6's flagged gap) |
| `run-group--paper-ink--1280x720` | changed | queue changes and the named log list, plus **D225's CATEGORICAL strip photographed for the first time** — five segments, `×2` executions, a `replayed` category and a `pending` one | X1 · X2 · X3 · X4 · X6 · X7 · **D225/D259** strip (`ef706b29`, `e9ca7722`); the fixture that finally serves `timeline.steps` is **unit P1** (this unit, F6's flagged gap) |
| `run-group--paper-ink--1440x900` | changed | queue changes and the named log list, plus **D225's CATEGORICAL strip photographed for the first time** — five segments, `×2` executions, a `replayed` category and a `pending` one | X1 · X2 · X3 · X4 · X6 · X7 · **D225/D259** strip (`ef706b29`, `e9ca7722`); the fixture that finally serves `timeline.steps` is **unit P1** (this unit, F6's flagged gap) |
| `run-group--paper-ink--narrow-1024x768` | changed | queue changes and the named log list, plus **D225's CATEGORICAL strip photographed for the first time** — five segments, `×2` executions, a `replayed` category and a `pending` one | X1 · X2 · X3 · X4 · X6 · X7 · **D225/D259** strip (`ef706b29`, `e9ca7722`); the fixture that finally serves `timeline.steps` is **unit P1** (this unit, F6's flagged gap) |
| `run-member--graphite-warm--1280x720` | changed | queue changes, the named timeline bars, and the skipped step's own arm and closed reason | X1 · X2 · X3 · X4 · X5 · X6 · X7 · skipped-step arm (`74ea8f67`) |
| `run-member--graphite-warm--1440x900` | changed | queue changes, the named timeline bars, and the skipped step's own arm and closed reason | X1 · X2 · X3 · X4 · X5 · X6 · X7 · skipped-step arm (`74ea8f67`) |
| `run-member--graphite-warm--narrow-1024x768` | changed | queue changes, the named timeline bars, and the skipped step's own arm and closed reason | X1 · X2 · X3 · X4 · X5 · X6 · X7 · skipped-step arm (`74ea8f67`) |
| `run-member--paper-ink--1280x720` | changed | queue changes, the named timeline bars, and the skipped step's own arm and closed reason | X1 · X2 · X3 · X4 · X5 · X6 · X7 · skipped-step arm (`74ea8f67`) |
| `run-member--paper-ink--1440x900` | changed | queue changes, the named timeline bars, and the skipped step's own arm and closed reason | X1 · X2 · X3 · X4 · X5 · X6 · X7 · skipped-step arm (`74ea8f67`) |
| `run-member--paper-ink--narrow-1024x768` | changed | queue changes, the named timeline bars, and the skipped step's own arm and closed reason | X1 · X2 · X3 · X4 · X5 · X6 · X7 · skipped-step arm (`74ea8f67`) |
| `run-member-gate--graphite-warm--1440x900--gate-type-eid` | changed | provenance stamp only | X1 |
| `run-open-gate--graphite-warm--1280x720` | changed | queue changes, named timeline bars and log list, plus the gate's own age line `identity-review open 16m 0s · since 9:49 AM` | X1 · X2 · X3 · X4 · X5 · X6 · X7 · gate age (`6203013e`, `57728e02`) |
| `run-open-gate--graphite-warm--1440x900` | changed | queue changes, named timeline bars and log list, plus the gate's own age line `identity-review open 16m 0s · since 9:49 AM` | X1 · X2 · X3 · X4 · X5 · X6 · X7 · gate age (`6203013e`, `57728e02`) |
| `run-open-gate--graphite-warm--1440x900--gate-choose` | changed | queue changes, named timeline bars and log list, plus the gate's own age line `identity-review open 16m 0s · since 9:49 AM` | X1 · X2 · X3 · X4 · X5 · X6 · X7 · gate age (`6203013e`, `57728e02`) |
| `run-open-gate--graphite-warm--1440x900--gate-refused` | changed | queue changes, named timeline bars and log list, plus the gate's own age line `identity-review open 16m 0s · since 9:49 AM` | X1 · X2 · X3 · X4 · X5 · X6 · X7 · gate age (`6203013e`, `57728e02`) |
| `run-open-gate--graphite-warm--1440x900--gate-reject` | changed | queue changes, named timeline bars and log list, plus the gate's own age line `identity-review open 16m 0s · since 9:49 AM` | X1 · X2 · X3 · X4 · X5 · X6 · X7 · gate age (`6203013e`, `57728e02`) |
| `run-open-gate--graphite-warm--narrow-1024x768` | changed | queue changes, named timeline bars and log list, plus the gate's own age line `identity-review open 16m 0s · since 9:49 AM` | X1 · X2 · X3 · X4 · X5 · X6 · X7 · gate age (`6203013e`, `57728e02`) |
| `run-open-gate--paper-ink--1280x720` | changed | queue changes, named timeline bars and log list, plus the gate's own age line `identity-review open 16m 0s · since 9:49 AM` | X1 · X2 · X3 · X4 · X5 · X6 · X7 · gate age (`6203013e`, `57728e02`) |
| `run-open-gate--paper-ink--1440x900` | changed | queue changes, named timeline bars and log list, plus the gate's own age line `identity-review open 16m 0s · since 9:49 AM` | X1 · X2 · X3 · X4 · X5 · X6 · X7 · gate age (`6203013e`, `57728e02`) |
| `run-open-gate--paper-ink--narrow-1024x768` | changed | queue changes, named timeline bars and log list, plus the gate's own age line `identity-review open 16m 0s · since 9:49 AM` | X1 · X2 · X3 · X4 · X5 · X6 · X7 · gate age (`6203013e`, `57728e02`) |
| `run-parked-write--graphite-warm--1280x720` | changed | queue changes, named timeline bars and log list; the two `resolve-*` dialog variants lose their footer meta line (`{runId} · rev · generation`) | X1 · X2 · X3 · X4 · X5 · X6 · X7 · **D273 item 9 / F22** (`5551a638`) |
| `run-parked-write--graphite-warm--1440x900` | changed | queue changes, named timeline bars and log list; the two `resolve-*` dialog variants lose their footer meta line (`{runId} · rev · generation`) | X1 · X2 · X3 · X4 · X5 · X6 · X7 · **D273 item 9 / F22** (`5551a638`) |
| `run-parked-write--graphite-warm--1440x900--resolve-absent` | changed | queue changes, named timeline bars and log list; the two `resolve-*` dialog variants lose their footer meta line (`{runId} · rev · generation`) | X1 · X2 · X3 · X4 · X5 · X6 · X7 · **D273 item 9 / F22** (`5551a638`) |
| `run-parked-write--graphite-warm--1440x900--resolve-present` | changed | queue changes, named timeline bars and log list; the two `resolve-*` dialog variants lose their footer meta line (`{runId} · rev · generation`) | X1 · X2 · X3 · X4 · X5 · X6 · X7 · **D273 item 9 / F22** (`5551a638`) |
| `run-parked-write--graphite-warm--narrow-1024x768` | changed | queue changes, named timeline bars and log list; the two `resolve-*` dialog variants lose their footer meta line (`{runId} · rev · generation`) | X1 · X2 · X3 · X4 · X5 · X6 · X7 · **D273 item 9 / F22** (`5551a638`) |
| `run-parked-write--paper-ink--1280x720` | changed | queue changes, named timeline bars and log list; the two `resolve-*` dialog variants lose their footer meta line (`{runId} · rev · generation`) | X1 · X2 · X3 · X4 · X5 · X6 · X7 · **D273 item 9 / F22** (`5551a638`) |
| `run-parked-write--paper-ink--1440x900` | changed | queue changes, named timeline bars and log list; the two `resolve-*` dialog variants lose their footer meta line (`{runId} · rev · generation`) | X1 · X2 · X3 · X4 · X5 · X6 · X7 · **D273 item 9 / F22** (`5551a638`) |
| `run-parked-write--paper-ink--narrow-1024x768` | changed | queue changes, named timeline bars and log list; the two `resolve-*` dialog variants lose their footer meta line (`{runId} · rev · generation`) | X1 · X2 · X3 · X4 · X5 · X6 · X7 · **D273 item 9 / F22** (`5551a638`) |
| `run-queued--graphite-warm--1280x720` | changed | queue changes, plus the named timeline bars, the named log list and the stream-liveness word | X1 · X2 · X3 · X4 · X5 · X6 · X7 |
| `run-queued--graphite-warm--1440x900` | changed | queue changes, plus the named timeline bars, the named log list and the stream-liveness word | X1 · X2 · X3 · X4 · X5 · X6 · X7 |
| `run-queued--graphite-warm--narrow-1024x768` | changed | queue changes, plus the named timeline bars, the named log list and the stream-liveness word | X1 · X2 · X3 · X4 · X5 · X6 · X7 |
| `run-queued--paper-ink--1280x720` | changed | queue changes, plus the named timeline bars, the named log list and the stream-liveness word | X1 · X2 · X3 · X4 · X5 · X6 · X7 |
| `run-queued--paper-ink--1440x900` | changed | queue changes, plus the named timeline bars, the named log list and the stream-liveness word | X1 · X2 · X3 · X4 · X5 · X6 · X7 |
| `run-queued--paper-ink--narrow-1024x768` | changed | queue changes, plus the named timeline bars, the named log list and the stream-liveness word | X1 · X2 · X3 · X4 · X5 · X6 · X7 |
| `run-receipt--graphite-warm--1280x720` | changed | queue changes, plus the named timeline bars, and the receipt's confidence chip / identity line / input-hash footer | X1 · X2 · X3 · X4 · X5 · **D273 item 7** (`9d2ffabb`), **F8d** (`31dcfa85`), input-hash footer (`0f4021d3`) |
| `run-receipt--graphite-warm--1440x900` | changed | queue changes, plus the named timeline bars, and the receipt's confidence chip / identity line / input-hash footer | X1 · X2 · X3 · X4 · X5 · **D273 item 7** (`9d2ffabb`), **F8d** (`31dcfa85`), input-hash footer (`0f4021d3`) |
| `run-receipt--graphite-warm--narrow-1024x768` | changed | queue changes, plus the named timeline bars, and the receipt's confidence chip / identity line / input-hash footer | X1 · X2 · X3 · X4 · X5 · **D273 item 7** (`9d2ffabb`), **F8d** (`31dcfa85`), input-hash footer (`0f4021d3`) |
| `run-receipt--paper-ink--1280x720` | changed | queue changes, plus the named timeline bars, and the receipt's confidence chip / identity line / input-hash footer | X1 · X2 · X3 · X4 · X5 · **D273 item 7** (`9d2ffabb`), **F8d** (`31dcfa85`), input-hash footer (`0f4021d3`) |
| `run-receipt--paper-ink--1440x900` | changed | queue changes, plus the named timeline bars, and the receipt's confidence chip / identity line / input-hash footer | X1 · X2 · X3 · X4 · X5 · **D273 item 7** (`9d2ffabb`), **F8d** (`31dcfa85`), input-hash footer (`0f4021d3`) |
| `run-receipt--paper-ink--narrow-1024x768` | changed | queue changes, plus the named timeline bars, and the receipt's confidence chip / identity line / input-hash footer | X1 · X2 · X3 · X4 · X5 · **D273 item 7** (`9d2ffabb`), **F8d** (`31dcfa85`), input-hash footer (`0f4021d3`) |
| `run-receipt-populated--graphite-warm--1440x900` | changed | all of `run-receipt` on the seeded adapter, plus `derived · from N entries` and the restructured Done/Input/Output blocks | X3 · X4 · X5 · **D273 item 7** (`9d2ffabb`), **F8d** (`31dcfa85`), input-hash footer (`0f4021d3`) |
| `run-receipt-populated--paper-ink--1440x900` | changed | all of `run-receipt` on the seeded adapter, plus `derived · from N entries` and the restructured Done/Input/Output blocks | X3 · X4 · X5 · **D273 item 7** (`9d2ffabb`), **F8d** (`31dcfa85`), input-hash footer (`0f4021d3`) |
| `run-running--graphite-warm--1280x720` | changed | queue changes, named timeline bars and log list, and the stream-liveness word `live` | X1 · X2 · X3 · X4 · X5 · X6 · X7 |
| `run-running--graphite-warm--1440x900` | changed | queue changes, named timeline bars and log list, and the stream-liveness word `live` | X1 · X2 · X3 · X4 · X5 · X6 · X7 |
| `run-running--graphite-warm--1440x900--panel-dismissed` | changed | queue changes, named timeline bars and log list, and the stream-liveness word `live` | X1 · X2 · X3 · X4 · X5 · X6 · X7 |
| `run-running--graphite-warm--narrow-1024x768` | changed | queue changes, named timeline bars and log list, and the stream-liveness word `live` | X1 · X2 · X3 · X4 · X5 · X6 · X7 |
| `run-running--paper-ink--1280x720` | changed | queue changes, named timeline bars and log list, and the stream-liveness word `live` | X1 · X2 · X3 · X4 · X5 · X6 · X7 |
| `run-running--paper-ink--1440x900` | changed | queue changes, named timeline bars and log list, and the stream-liveness word `live` | X1 · X2 · X3 · X4 · X5 · X6 · X7 |
| `run-running--paper-ink--1440x900--panel-dismissed` | changed | queue changes, named timeline bars and log list, and the stream-liveness word `live` | X1 · X2 · X3 · X4 · X5 · X6 · X7 |
| `run-running--paper-ink--narrow-1024x768` | changed | queue changes, named timeline bars and log list, and the stream-liveness word `live` | X1 · X2 · X3 · X4 · X5 · X6 · X7 |
| `settings--graphite-warm--1280x720` | new | **NEW** — the Settings takeover on Storage at every viewport/theme, plus the System hosts and Workflow capabilities panes | **unit P1** (this unit) over **D274 item 6** / ledger 3 SE40–SE42, SE45 (`b855a0ed`, `f57cc9a3`) |
| `settings--graphite-warm--1440x900` | new | **NEW** — the Settings takeover on Storage at every viewport/theme, plus the System hosts and Workflow capabilities panes | **unit P1** (this unit) over **D274 item 6** / ledger 3 SE40–SE42, SE45 (`b855a0ed`, `f57cc9a3`) |
| `settings--graphite-warm--1440x900--capabilities` | new | **NEW** — the Settings takeover on Storage at every viewport/theme, plus the System hosts and Workflow capabilities panes | **unit P1** (this unit) over **D274 item 6** / ledger 3 SE40–SE42, SE45 (`b855a0ed`, `f57cc9a3`) |
| `settings--graphite-warm--1440x900--system-hosts` | new | **NEW** — the Settings takeover on Storage at every viewport/theme, plus the System hosts and Workflow capabilities panes | **unit P1** (this unit) over **D274 item 6** / ledger 3 SE40–SE42, SE45 (`b855a0ed`, `f57cc9a3`) |
| `settings--graphite-warm--narrow-1024x768` | new | **NEW** — the Settings takeover on Storage at every viewport/theme, plus the System hosts and Workflow capabilities panes | **unit P1** (this unit) over **D274 item 6** / ledger 3 SE40–SE42, SE45 (`b855a0ed`, `f57cc9a3`) |
| `settings--paper-ink--1280x720` | new | **NEW** — the Settings takeover on Storage at every viewport/theme, plus the System hosts and Workflow capabilities panes | **unit P1** (this unit) over **D274 item 6** / ledger 3 SE40–SE42, SE45 (`b855a0ed`, `f57cc9a3`) |
| `settings--paper-ink--1440x900` | new | **NEW** — the Settings takeover on Storage at every viewport/theme, plus the System hosts and Workflow capabilities panes | **unit P1** (this unit) over **D274 item 6** / ledger 3 SE40–SE42, SE45 (`b855a0ed`, `f57cc9a3`) |
| `settings--paper-ink--narrow-1024x768` | new | **NEW** — the Settings takeover on Storage at every viewport/theme, plus the System hosts and Workflow capabilities panes | **unit P1** (this unit) over **D274 item 6** / ledger 3 SE40–SE42, SE45 (`b855a0ed`, `f57cc9a3`) |
| `start-run--graphite-warm--1280x720` | changed | `Safety & mode` and its disabled dry-run checkbox removed; each shaped fact gets `fixed by this workflow's input surface`; the active-run policy gets `declared by this workflow`; the title carries the version (`Person Lookup v7`) | **typed start-run flow** (`038db3b0`, D250/D264) · X1 |
| `start-run--graphite-warm--1440x900` | changed | `Safety & mode` and its disabled dry-run checkbox removed; each shaped fact gets `fixed by this workflow's input surface`; the active-run policy gets `declared by this workflow`; the title carries the version (`Person Lookup v7`) | **typed start-run flow** (`038db3b0`, D250/D264) · X1 |
| `start-run--graphite-warm--narrow-1024x768` | changed | `Safety & mode` and its disabled dry-run checkbox removed; each shaped fact gets `fixed by this workflow's input surface`; the active-run policy gets `declared by this workflow`; the title carries the version (`Person Lookup v7`) | **typed start-run flow** (`038db3b0`, D250/D264) · X1 |
| `start-run--paper-ink--1280x720` | changed | `Safety & mode` and its disabled dry-run checkbox removed; each shaped fact gets `fixed by this workflow's input surface`; the active-run policy gets `declared by this workflow`; the title carries the version (`Person Lookup v7`) | **typed start-run flow** (`038db3b0`, D250/D264) · X1 |
| `start-run--paper-ink--1440x900` | changed | `Safety & mode` and its disabled dry-run checkbox removed; each shaped fact gets `fixed by this workflow's input surface`; the active-run policy gets `declared by this workflow`; the title carries the version (`Person Lookup v7`) | **typed start-run flow** (`038db3b0`, D250/D264) · X1 |
| `start-run--paper-ink--narrow-1024x768` | changed | `Safety & mode` and its disabled dry-run checkbox removed; each shaped fact gets `fixed by this workflow's input surface`; the active-run policy gets `declared by this workflow`; the title carries the version (`Person Lookup v7`) | **typed start-run flow** (`038db3b0`, D250/D264) · X1 |
| `start-run-separations--graphite-warm--1280x720` | changed | same as `start-run`, with `Person Lookup v1` from the picker profile | **typed start-run flow** (`038db3b0`, D250/D264) · X1 |
| `start-run-separations--graphite-warm--1440x900` | changed | same as `start-run`, with `Person Lookup v1` from the picker profile | **typed start-run flow** (`038db3b0`, D250/D264) · X1 |
| `start-run-separations--graphite-warm--narrow-1024x768` | changed | same as `start-run`, with `Person Lookup v1` from the picker profile | **typed start-run flow** (`038db3b0`, D250/D264) · X1 |
| `start-run-separations--paper-ink--1280x720` | changed | same as `start-run`, with `Person Lookup v1` from the picker profile | **typed start-run flow** (`038db3b0`, D250/D264) · X1 |
| `start-run-separations--paper-ink--1440x900` | changed | same as `start-run`, with `Person Lookup v1` from the picker profile | **typed start-run flow** (`038db3b0`, D250/D264) · X1 |
| `start-run-separations--paper-ink--narrow-1024x768` | changed | same as `start-run`, with `Person Lookup v1` from the picker profile | **typed start-run flow** (`038db3b0`, D250/D264) · X1 |

## UNATTRIBUTED

**None.** Every one of the 168 references above names either a ratified decision, a merged reviewed
unit, or this unit's own work, and every attribution names the commit that carries it.
