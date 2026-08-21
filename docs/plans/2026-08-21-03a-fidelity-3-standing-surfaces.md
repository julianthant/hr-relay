# 03a demo-fidelity audit — group 3: the STANDING SURFACES

**Date:** 2026-08-21 · **Unit:** Phase 3a demo-fidelity audit, group 3 of 3 · **Status:** AUDIT ONLY
— no doc, no code, no token in the tree was changed by this pass.

## What this is

The operator's standing acceptance bar for the rebuild dashboard is that it be a **1:1 detail
replica of the legacy rebuild-demo**, reviewed glyph by glyph. Two "it matches the demo" claims have
already been rejected on sight, so a claim is worth nothing here — only an enumeration is. This
ledger enumerates every visible element of the nine STANDING surfaces and gives each one of four
verdicts, with a named reason for every verdict that is not `exact`.

The prior audit (`docs/plans/2026-08-13-detail-fidelity-audit.md`, regions R1–R8) covered the shell,
the queue, the run detail and the dialogs. **It did not cover any region in this file** — these nine
are audited here for the first time.

## Oracle and binding references

- **Demo source (the spec, read-only):**
  `/Users/julianhein/Projects/hr-automation/src/dashboard/components/dev/rebuild-demo/`
- **Demo live:** `http://localhost:5173/?view=rebuild-demo` (`npm run dev:dashboard` in the legacy
  checkout)
- **Rebuild source:** `src/dashboard/**` in this repository
- **Pixels:** `tests/parity/references/**/*.png` — scenes covering these regions are
  `activity-report`, `archive-ledger`, `archive-run`, `catalog-search`, `explorer-graph`,
  `explorer-transaction`, `intake-upload`, `intake-mapping`, `intake-review`, `capture-empty`,
  `capture-photos`, `capture-reorder`, `capture-sent`, `capture-failed`. **There is no parity scene
  for Settings, for the version-bump dialog, or for a UI-kit page** — see the roll-up.
- **Decisions:** `docs/rebuild/reference/decisions.md`; owning docs under `docs/rebuild/reference/`
- **Declared wire gaps:** `docs/findings/*.md` — the standing rule is that a demo element the served
  wire cannot power is RECORDED there rather than approximated on screen.

## Verdicts and reasons

| Verdict | Meaning |
|---------|---------|
| `exact` | the rebuild renders the demo's element with the demo's copy, tokens, icon, order and ARIA |
| `divergent` | the element exists on both sides but differs — the row says precisely how |
| `missing` | the demo has it; the rebuild does not render it at all |
| `extra` | the rebuild renders it; the demo has no counterpart |

Every non-`exact` row carries **exactly one** reason:

- `ruled: D### / <doc> §x / operator <date>` — a ratified decision covers this divergence.
- `unserved: <field>` — the rebuild cannot render it because nothing serves it; the field is named,
  and where `docs/findings/` already books the gap, the record is cited.
- **`OPEN — operator call`** — a real divergence that no decision covers. These are the rows the
  operator has to rule on, and they are gathered verbatim in the roll-up.

`exact` rows carry `—`.

---

## 1. Archive — `DemoArchive.tsx` + `demo-archive-wire.ts` ↔ `surfaces/archive.tsx`

_(pending — this section is written by the archive pass)_

---

## 2. Activity report — `DemoActivityReport.tsx` + `demo-report-wire.ts` ↔ `surfaces/activity.tsx`

**Demo:** `DemoActivityReport.tsx` (482) · `demo-report-wire.ts` (340) ·
**Rebuild:** `surfaces/activity.tsx` (1224) · `activity-model.ts` (34) ·
`src/domain/dashboard/activity.ts` (the caveats + the wire) · **Parity:** `activity-report` ×3
viewports ×2 themes

The port is the closest of the nine to the demo — the tile row, the still-open-by-state table, the
category-grouped per-workflow table with subtotals, the caveats ⓘ, the write-ledger block and the
provenance footer are all present and mostly glyph-identical. **The structural finding is that the
divergences are almost entirely RULED and almost entirely SUBTRACTIVE or ADDITIVE rather than
cosmetic:** the fifth tile and the ninth column are gone by D239, four whole blocks the demo never
had are present by D180 (durations, By day, By outcome, Failures), and the one remaining true gap is
the person axis, which `docs/findings/activity.md` has held open since 2026-08-14 and re-affirmed on
2026-08-19. What the audit adds that no record held: **the caveats ⓘ prints the WIRE's status word
`blocked` where every pill on the same page reads `Parked`** (`status-model.ts:73` maps
`blocked → parked`), and three spacing/wrapper tokens drift from the demo's.

| # | Element | Demo | Rebuild | Verdict | Reason |
|---|---------|------|---------|---------|--------|
| AC1 | `PageHeader` title `Activity report` | `DemoActivityReport.tsx:96` | `activity.tsx:1111` | exact | — |
| AC2 | header icon `ChartNoAxesColumn`, `aria-hidden`, `dsIcon.lg` | `DemoActivityReport.tsx:97` | `activity.tsx:1112` | exact | — |
| AC3 | NO `back` button (both sides deliberate; the rebuild carries the operator's own quote) | `DemoActivityReport.tsx:80-94` | `activity.tsx:1103-1109` | exact | — |
| AC4 | NO header `badge` | `DemoActivityReport.tsx:95-107` | `activity.tsx:1110-1137` | exact | — |
| AC5 | actions slot is a `role="group"` `aria-label="Report span"` chip group | `DemoActivityReport.tsx:99` | — | missing | ruled: D180 (ref frontend-backend-integration §6.7 — both bounds are named); `docs/findings/activity.md` "The span control is two date bounds" WON'T-FIX |
| AC6 | `Chip` — the selected day (`Sat, Jul 25`), `selected` when active | `DemoActivityReport.tsx:101-103` | — | missing | ruled: D180 · `docs/findings/activity.md` span-control record |
| AC7 | `Chip` — `Every day the tracker holds (3)` | `demo-report-wire.ts:57` | — | missing | ruled: D180 — an unbounded span would need a served `bounds: { earliest, latest }` |
| AC8 | `Field label="From"` + `Input type="date"` with `max={to}` | — | `activity.tsx:1119-1126` | extra | ruled: D180 — the two bounds ARE the ratified control |
| AC9 | `Field label="To"` + `Input type="date"` with `min={from}` | — | `activity.tsx:1127-1134` | extra | ruled: D180 |
| AC10 | the replacement date-field pair carries NO `role="group"` and NO `aria-label` — the demo's chip group named itself to assistive tech, the two bare `Field`s do not | `DemoActivityReport.tsx:99` | `activity.tsx:1118` | divergent | **OPEN — operator call** |
| AC11 | actions-span layout: demo `flex items-center gap-[var(--ds-space-tight)]`; rebuild `flex items-end gap-[var(--ds-space-snug)]` | `DemoActivityReport.tsx:99` | `activity.tsx:1118` | divergent | **OPEN — operator call** |
| AC12 | page root: demo `<div className="flex min-h-0 flex-1 flex-col">`; rebuild wraps the whole surface in a `<Panel>` with `aria-label="Activity report"`, `useDsEnterTransition` and `ds-motion-enter` | `DemoActivityReport.tsx:79` | `activity.tsx:1095-1101` | divergent | **OPEN — operator call** (rebuild-wide takeover convention — see also `archive.tsx:2168`, `explorer.tsx:1475`) |
| AC13 | scroll container `min-h-0 flex-1 overflow-y-auto p-[var(--ds-space-cozy)]` | `DemoActivityReport.tsx:109` | `activity.tsx:1139` | exact | — |
| AC14 | inner `Panel` | `DemoActivityReport.tsx:110` | `activity.tsx:1140` | exact | — |
| AC15 | `PanelHeader` title `Automation activity` | `DemoActivityReport.tsx:112` | `activity.tsx:1142` | exact | — |
| AC16 | `PanelHeader` subtitle = the span's label | `DemoActivityReport.tsx:113` | `activity.tsx:1143` | divergent | ruled: D180 — the demo prints a fixture span name; the rebuild derives `dayLabel(from)` or `dayLabel(from) – dayLabel(to)` (`activity-model.ts:32`) |
| AC17 | `PanelHeader` meta `N runs · M people` | `DemoActivityReport.tsx:114` | `activity.tsx:1144` | divergent | unserved: `people.distinct` on `ActivityReportWire` (`docs/findings/activity.md` "Distinct people touched is not served", OPEN, re-affirmed 2026-08-19) |
| AC18 | meta/actions suppressed entirely until the payload loads | — | `activity.tsx:1144,1146` | extra | ruled: D180 — the range is an explicit refresh of a served payload; the demo renders a fixture |
| AC19 | actions wrapper gap: demo `gap-[var(--ds-space-snug)]`; rebuild `gap-[var(--ds-space-tight)]` | `DemoActivityReport.tsx:116` | `activity.tsx:1147` | divergent | **OPEN — operator call** |
| AC20 | ⓘ trigger `Button size="sm" variant="ghost"` icon `Info` `dsIcon.md`, label `How it is counted` | `DemoActivityReport.tsx:119-121` | `activity.tsx:1150-1152` | exact | — |
| AC21 | `PopoverContent` title `How this report is counted`, `width="lg"`, `align="end"` | `DemoActivityReport.tsx:123` | `activity.tsx:1154` | exact | — |
| AC22 | caveat — "Hours saved is an ESTIMATE — …" | `demo-report-wire.ts:267` | — | missing | ruled: D239 (ref frontend-backend-integration §6.7) — the number it qualifies was dropped |
| AC23 | caveat — the named window (`covers runs that started between … Both bounds were named`) | — | `activity.ts:477-478` | extra | ruled: D180 |
| AC24 | caveat — error rate counts only terminal runs. **Demo says "…waiting on you or parked…"; rebuild says "…waiting on you or blocked…"** while every pill on the page renders `blocked` as **Parked** (`status-model.ts:73`) | `demo-report-wire.ts:268` | `activity.ts:479-481` | divergent | **OPEN — operator call** |
| AC25 | caveat — "N run(s) still outstanding … not represented in hours saved" → rebuild "…represented in no total on this page except its own" | `demo-report-wire.ts:269` | `activity.ts:482` | divergent | ruled: D239 — the clause named a total that no longer exists |
| AC26 | caveat — people counted by EID across members | `demo-report-wire.ts:270` | — | missing | unserved: `people.distinct` (`docs/findings/activity.md`) |
| AC27 | caveat — ledger entries are what was filed, never pruned, never archived | `demo-report-wire.ts:271` | `activity.ts:493-496` | divergent | ruled: D236 — the rebuild's sentence adds the second-authority seam the carve-out requires |
| AC28 | caveat — every total is a rendering of the ONE projection | — | `activity.ts:483-484` | extra | ruled: D81 / D180 |
| AC29 | caveat — a finished run with no receipt is counted UNREAD | — | `activity.ts:485-487` | extra | ruled: D180 rule 4 |
| AC30 | caveat — the Who column samples up to five per state | — | `activity.ts:488-490` | extra | ruled: D180 (bounded Who sample, 2026-08-14) |
| AC31 | `Export` `Button size="sm" variant="secondary"` icon `Download` `dsIcon.md` | `DemoActivityReport.tsx:127-129` | `activity.tsx:1162-1169` | exact | — |
| AC32 | Export behaviour: inert in the demo; the rebuild downloads the served CSV and deliberately raises NO success toast | `DemoActivityReport.tsx:127` | `activity.tsx:1084-1092` | divergent | ruled: D240 (ref frontend-backend-integration §6.7) |
| AC33 | `PanelBody className="flex flex-col gap-[var(--ds-space-cozy)] p-[var(--ds-space-cozy)]"` | `DemoActivityReport.tsx:143` | `activity.tsx:1174` | exact | — |
| AC34 | loading arm — `Skeleton className="h-64 w-full"` | — | `activity.tsx:1176` | extra | ruled: D180 — explicit refresh of a served payload |
| AC35 | failure arm — `Refusal` title `The activity report could not be built`, code `activity-read-failed`, outcome `Nothing was changed; this surface only reads.` | — | `activity.tsx:1178-1184` | extra | ruled: ref dashboard-surfaces §9.5.2 as-built — the report refuses to build over a degraded projection |
| AC36 | zero-run arm — `Well` with `No run started between X and Y. Archived runs are deliberately not counted here…` | — | `activity.tsx:1192-1198` | extra | ruled: D234 / ref dashboard-surfaces §9.5.1 — archived runs leave the live surfaces |
| AC37 | tiles grid `grid-cols-2 … min-[1080px]:grid-cols-5` → rebuild `min-[1080px]:grid-cols-4` | `DemoActivityReport.tsx:147` | `activity.tsx:797` | divergent | ruled: D239 — one fewer tile |
| AC38 | Tile `Runs` value | `DemoActivityReport.tsx:148` | `activity.tsx:800` | exact | — |
| AC39 | Tile `Runs` note `N distinct people touched` → rebuild `N days with runs in this span` | `DemoActivityReport.tsx:148` | `activity.tsx:801` | divergent | unserved: `people.distinct` (`docs/findings/activity.md`) |
| AC40 | Tile `Finished` value `verified + warnings` → rebuild `readBack + warnings + warningsUnknown` | `DemoActivityReport.tsx:151` | `activity.tsx:818` | divergent | ruled: D180 rule 4 — a warning set nobody derived is UNKNOWN, never zero |
| AC41 | Tile `Finished` note `X read back · Y with warnings` → rebuild appends `· Z unread` when Z > 0 | `DemoActivityReport.tsx:152` | `activity.tsx:819-823` | divergent | ruled: D180 rule 4 |
| AC42 | Tile `Finished` carries an ⓘ (three bullets on the unread split) | — | `activity.tsx:824-834` | extra | ruled: D180 rule 4 |
| AC43 | Tile `Still open` value | `DemoActivityReport.tsx:159` | `activity.tsx:841` | exact | — |
| AC44 | Tile `Still open` note `counted in neither the error rate nor hours saved` → `…nor the outcome totals` | `DemoActivityReport.tsx:161-164` | `activity.tsx:842-846` | divergent | ruled: D239 |
| AC45 | Tile `Still open` `tone="warning"` when > 0 | `DemoActivityReport.tsx:165` | `activity.tsx:847` | exact | — |
| AC46 | `Still open` ⓘ bullet 1 — "A run that has not ended has not succeeded or failed…" | `DemoActivityReport.tsx:169` | `activity.tsx:851` | exact | — |
| AC47 | `Still open` ⓘ bullet 2 — "It contributes nothing to hours saved either…" | `DemoActivityReport.tsx:170` | — | missing | ruled: D239 |
| AC48 | `Still open` ⓘ bullet — "It is reported here, beside finished work…" | `DemoActivityReport.tsx:171` | `activity.tsx:852` | exact | — |
| AC49 | `Still open` ⓘ bullet — "The states below say what each open run is waiting on…" | — | `activity.tsx:853` | extra | ruled: D239 — the slot D239 emptied is refilled with a true sentence |
| AC50 | Tile `Error rate` value `N%`, note `X failed of Y terminal runs`, `tone="warning"` above 15 | `DemoActivityReport.tsx:176-181` | `activity.tsx:858-863` | exact | — |
| AC51 | Tile `Hours saved` — value `≈ N`, note `operator's per-workflow minutes × runs that finished`, `tone="estimate"`, ⓘ with `MANUAL_MINUTES_PROVENANCE` | `DemoActivityReport.tsx:182-188` | — | missing | ruled: D239 — DROPPED, not deferred; the re-open trigger is named in `docs/findings/activity.md` |
| AC52 | `Badge tone="warning"` reading `estimate` in the tile header | `DemoActivityReport.tsx:323` | — | missing | ruled: D239 — nothing else wears it |
| AC53 | `Tile` prop `tone` admits `"estimate"` | `DemoActivityReport.tsx:309` | `activity.tsx:255` | missing | ruled: D239 |
| AC54 | tile header row reserved at `min-h-[var(--ds-h-xs)]`, `items-center gap-[var(--ds-space-snug)]` | `DemoActivityReport.tsx:321` | `activity.tsx:262` | exact | — |
| AC55 | tile ⓘ `IconButton size="xs"`, label `How <label> is counted`, `ml-auto` + `fg-faint`/hover/`data-[state=open]` classes | `DemoActivityReport.tsx:327-332` | `activity.tsx:266-272` | exact | — |
| AC56 | tile `PopoverContent title={label} width="lg" align="end"` | `DemoActivityReport.tsx:334` | `activity.tsx:274` | exact | — |
| AC57 | tile value `dsText.display dsText.nums text-[color:var(--ds-fg)]` | `DemoActivityReport.tsx:340` | `activity.tsx:280` | exact | — |
| AC58 | tile note pinned in `CardBase className="pt-[var(--ds-space-hair)]"`, `dsText.meta fg-muted` | `DemoActivityReport.tsx:343-345` | `activity.tsx:283-285` | exact | — |
| AC59 | `Card tone={warning ? "attention" : "default"}` + `CardBody grow` | `DemoActivityReport.tsx:314-315` | `activity.tsx:260-261` | exact | — |
| AC60 | `SectionLabel` `Still open — by what it is waiting on`, `mb-[var(--ds-space-snug)]` | `DemoActivityReport.tsx:194` | `activity.tsx:751` | exact | — |
| AC61 | `Table label="Outstanding runs by what they are waiting on"` | `DemoActivityReport.tsx:195` | `activity.tsx:753` | exact | — |
| AC62 | an `overflow-x-auto` wrapper around the outstanding table | — | `activity.tsx:752` | extra | **OPEN — operator call** |
| AC63 | `TH` set `State` / `Runs` (right) / `Who` | `DemoActivityReport.tsx:198-200` | `activity.tsx:755-758` | exact | — |
| AC64 | bucket order `waiting, parked, running, queued` | `demo-report-wire.ts:327` | `activity.tsx:135` | exact | — (rebuild names the same four through the wire vocabulary `awaiting-approval, blocked, running, queued`) |
| AC65 | an empty bucket is dropped, never printed as a zero | `demo-report-wire.ts:335` | `activity.tsx:747` | exact | — |
| AC66 | the whole block is hidden when nothing is open | `DemoActivityReport.tsx:192` | `activity.tsx:748` | exact | — |
| AC67 | State cell `StatusPill size="sm"` | `DemoActivityReport.tsx:365` | `activity.tsx:658` | exact | — |
| AC68 | Runs cell right-aligned `numeric` | `DemoActivityReport.tsx:367` | `activity.tsx:660` | exact | — |
| AC69 | Who cell — first name (`displayName ?? title`) `dsText.meta` truncate `fg-secondary`, then ` +N` | `DemoActivityReport.tsx:372-375` | `activity.tsx:665-667` | divergent | unserved: names on `ActivityStatusTotal.sample` — the wire carries run IDS by design (D180), so a run outside the day on screen renders its id with a `title` reason instead of a name |
| AC70 | `All N` `Button size="sm" variant="ghost" ml-auto shrink-0` | `DemoActivityReport.tsx:379-381` | `activity.tsx:672-674` | exact | — |
| AC71 | popover title = the bucket's status label | `DemoActivityReport.tsx:383` | `activity.tsx:677` | exact | — |
| AC72 | popover description `N runs` → rebuild `N runs of M — the report samples the first N` when bounded | `DemoActivityReport.tsx:383` | `activity.tsx:678-683` | divergent | ruled: D180 — the sample is the SERVER's, bounded at five |
| AC73 | popover `<ul className="flex flex-col gap-[var(--ds-space-tight)]">`, each `<li>` = name / workflow label / trace | `DemoActivityReport.tsx:384-393` | `activity.tsx:686-701` | exact | — (rebuild makes the workflow label conditional and falls back trace → runId) |
| AC74 | trailing `N further run(s) … not sampled on this report` paragraph | — | `activity.tsx:709-714` | extra | ruled: D180 (bounded sample) |
| AC75 | `SectionLabel` `By workflow`, `mb-[var(--ds-space-snug)]` | `DemoActivityReport.tsx:214` | `activity.tsx:530` | exact | — |
| AC76 | `Table label="Activity by workflow, grouped by category"` | `DemoActivityReport.tsx:215` | `activity.tsx:532` | exact | — |
| AC77 | an `overflow-x-auto` wrapper around the by-workflow table | — | `activity.tsx:531` | extra | **OPEN — operator call** |
| AC78 | `TH Workflow` | `DemoActivityReport.tsx:218` | `activity.tsx:535` | exact | — |
| AC79 | `TH Runs` right | `DemoActivityReport.tsx:219` | `activity.tsx:536` | exact | — |
| AC80 | `TH Share` right | `DemoActivityReport.tsx:220` | `activity.tsx:537` | exact | — |
| AC81 | `TH Read back` right | `DemoActivityReport.tsx:221` | `activity.tsx:538` | exact | — |
| AC82 | `TH Warnings` right | `DemoActivityReport.tsx:222` | `activity.tsx:539` | exact | — |
| AC83 | `TH Unread` right | — | `activity.tsx:540` | extra | ruled: D180 rule 4 |
| AC84 | `TH Failed` right | `DemoActivityReport.tsx:223` | `activity.tsx:541` | exact | — |
| AC85 | `TH Open` right | `DemoActivityReport.tsx:224` | `activity.tsx:542` | exact | — |
| AC86 | `TH Est. min saved` right | `DemoActivityReport.tsx:225` | — | missing | ruled: D239 |
| AC87 | category heading row — `colSpan={8}`, `bg-[var(--ds-surface-2)]`, `py-[var(--ds-space-tight)]`, `items-baseline gap-snug` | `DemoActivityReport.tsx:418-420` | `activity.tsx:364-366` | exact | — |
| AC88 | the heading text is the RAIL's human category label → rebuild prints the raw `categoryId`, or the literal `unregistered` | `DemoActivityReport.tsx:421` | `activity.tsx:367,490` | divergent | ruled: D180 rule 2 — "the report never invents a label from an id" |
| AC89 | `N workflow(s)` in `dsText.micro dsText.nums fg-muted` beside the heading | `DemoActivityReport.tsx:422-424` | `activity.tsx:368-370` | exact | — |
| AC90 | `SectionLabel` in the heading gains `shrink-0` (demo has none) | `DemoActivityReport.tsx:421` | `activity.tsx:367` | divergent | **OPEN — operator call** |
| AC91 | the wire's own `reason` sentence rides beside an `unregistered` heading, `dsText.micro` truncate `fg-faint` | — | `activity.tsx:371-373` | extra | ruled: D180 rule 2 |
| AC92 | workflow rows sorted by runs descending inside the block | `demo-report-wire.ts:239` | `activity.tsx:518` | exact | — |
| AC93 | name cell — short code (`dsText.nums dsText.micro fg-muted`) then the label, `items-baseline gap-[var(--ds-space-snug)]` | `DemoActivityReport.tsx:447-452` | `activity.tsx:507-512` | exact | — (the code is served: D242) |
| AC94 | an `unregistered` workflow renders its raw id in `--ds-status-waiting-fg` | — | `activity.tsx:514` | extra | ruled: D180 rule 2 |
| AC95 | subtotal row — `bg-[var(--ds-surface-2)]`, label `<category> — subtotal`, `font-semibold text-[color:var(--ds-fg)]` | `DemoActivityReport.tsx:443-450` | `activity.tsx:387,415,417` | exact | — |
| AC96 | subtotal `Runs`: demo re-sums the lines; rebuild uses the wire's OWN `categories[].runs` | `demo-report-wire.ts:240` | `activity.tsx:523` | divergent | ruled: D81 / D180 — never a second count |
| AC97 | `Share` = one-decimal percentage, right, `fg-muted` | `DemoActivityReport.tsx:442,457` | `activity.tsx:414,422` | exact | — |
| AC98 | `Failed` cell tinted `--ds-status-failed-fg` when > 0 | `DemoActivityReport.tsx:466` | `activity.tsx:451` | exact | — |
| AC99 | `Open` cell tinted `--ds-status-waiting-fg` when > 0 | `DemoActivityReport.tsx:469` | `activity.tsx:454` | exact | — |
| AC100 | `Est. min saved` cell `≈ N` with `title="X min/run × Y finished"` | `DemoActivityReport.tsx:472-479` | — | missing | ruled: D239 |
| AC101 | `Unread` cell — `fg-muted`, `title` naming how many finished runs have no derived receipt | — | `activity.tsx:439-450` | extra | ruled: D180 rule 4 |
| AC102 | `How long they took` block — `SectionLabel` + `MetaLine` (median / longest / measured) + the amber `TriangleAlert` unmeasured sentence | — | `activity.tsx:873-894` | extra | ruled: D180 rule 1 — durations report their misses |
| AC103 | `By day` proportional table (`Name` / `Share` / `Runs` / `%` with a plain-element bar) | — | `activity.tsx:896-900` | extra | ruled: D180 (ref frontend-backend-integration §5 Activity row) |
| AC104 | `By outcome` proportional table, deliberately un-hued | — | `activity.tsx:910-918` | extra | ruled: D180 |
| AC105 | `Failures` block — `Code` / `Runs` / `Transient` / `Examples`, plus `No run in this range settled with a structured failure.` | — | `activity.tsx:920-950` | extra | ruled: D180 (ref frontend-backend-integration §5 Activity row: failure breakdowns) |
| AC106 | the proportional bar is a plain sized element, no chart runtime | — | `activity.tsx:163-171` | extra | ruled: D180 — keeps ref frontend-backend-integration §8 guard #13 |
| AC107 | `SectionLabel` `Write ledger — what was actually filed`, `mb-[var(--ds-space-snug)]` | `DemoActivityReport.tsx:236` | `activity.tsx:975` | exact | — |
| AC108 | a seam subtitle under the ledger heading (`A separate authority from every total above…`) | — | `activity.tsx:976-979` | extra | ruled: D236 rule 2 — the seam is stated where the reader is |
| AC109 | empty state `Well` — `No ledger entries. Nothing in this report's reach filed anything into a real HR system.` | `DemoActivityReport.tsx:238-242` | `activity.tsx:981-985` | exact | — |
| AC110 | `Table label="Write ledger by system"` | `DemoActivityReport.tsx:244` | `activity.tsx:988` | exact | — |
| AC111 | `TH System` / `Entries` right / `Production` right / `Test instance` right | `DemoActivityReport.tsx:246-250` | `activity.tsx:990-994` | exact | — |
| AC112 | test-instance cell tinted `--ds-status-waiting-fg` when > 0 | `DemoActivityReport.tsx:263` | `activity.tsx:1003-1008` | exact | — |
| AC113 | ledger corpus: demo folds `DEMO_ARCHIVE[].ledger`; rebuild folds the durable append-only ledger over the same window through `foldActivityRange` | `demo-report-wire.ts:246-255` | `activity.tsx:953` | divergent | ruled: D236 |
| AC114 | the ledger block renders on the zero-run branch too | — | `activity.tsx:1199` | extra | ruled: D236 — a range with no runs can still hold entries |
| AC115 | `PanelFooter` `MetaLine` — `generated <clock>`, operator, `app <version>`, span label, `N runs` | `DemoActivityReport.tsx:282-292` | `activity.tsx:1209-1219` | exact | — |
| AC116 | footer's `<span> — not yet generated` arm before the payload lands | — | `activity.tsx:1212` | extra | ruled: D180 |
| AC117 | the `Chip` primitive appears on this surface | `DemoActivityReport.tsx:101` | — | missing | ruled: D180 — it left with the span chips (AC6/AC7) |

**Counts:** 117 rows — exact 57 · divergent 21 · missing 12 · extra 27 · **OPEN 8** (AC10, AC11,
AC12, AC19, AC24, AC62, AC77, AC90)

---

## 3. Workflow Explorer — `DemoExplorer.tsx` + `demo-explorer-wire.ts` ↔ `surfaces/explorer.tsx`

_(pending — this section is written by the explorer pass)_

---

## 4. UI catalog — `DemoCatalogView.tsx` + `demo-catalog.ts` ↔ `surfaces/ui-catalog.tsx`

_(pending — this section is written by the explorer pass)_

---

## 5. Settings and the storage doctor — `DemoSettings.tsx` + `demo-settings-wire.ts` ↔ `surfaces/settings.tsx`

_(pending)_

---

## 6. Data intake — `DemoIntake.tsx` + `demo-data-intake.ts` ↔ `surfaces/intake.tsx`

_(pending — this section is written by the intake pass)_

---

## 7. Phone capture — `DemoCapture.tsx` ↔ `phone/**` + `surfaces/capture-start.tsx`

_(pending — this section is written by the intake pass)_

---

## 8. The version-bump dialog — `DemoVersionBump.tsx` ↔ (rebuild target TBD)

_(pending)_

---

## 9. Design-system primitives — `DemoUiKit.tsx` + `demo-ui.tsx` + demo `ds/` ↔ `src/dashboard/ds/**`

_(pending — this section is written by the ds pass)_

---

## Roll-up

_(pending — written last)_
