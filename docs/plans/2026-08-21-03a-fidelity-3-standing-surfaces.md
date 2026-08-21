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

**Demo:** `DemoSettings.tsx` (1241) · `demo-settings-wire.ts` (740) · mounted as a full-page takeover
at `RebuildDemo.tsx:657` · **Rebuild:** `surfaces/settings.tsx` (357) · `settings-model.ts` (18) ·
**Parity:** none — **there is no Settings scene in `tests/parity/references/`.**

This is the widest gap of the nine, and the shape of it is one sentence: **the demo's Settings is a
twelve-section full-page takeover behind a 220px left nav; the rebuild's is a `Dialog` with one
section.** Most of that is correctly ruled — `apply-settings` is the single deferred kernel arm
(`{#def-settings}`, D169, stance D193(b)), so the four editable groups, their eight leaves, the
provenance stack, the hazard escalation, the draft/action bar and the whole result surface are
absent BECAUSE nothing can save, and ref dashboard-surfaces §9.8 ratifies rendering the SERVER's
section list rather than a hand-kept one. The storage half is not a port at all but a genuine
re-derivation, and it is richer than the demo's: an on-demand doctor with authority state, eight
pending-work counts, byte-re-verified backup health, restore candidates and — a fact the demo has no
counterpart for — what the live backup SERVICE last did.

**Three findings the records do not hold.** (1) **The keyboard legend is UNREACHABLE.** The demo made
one change in two halves — delete the top bar's keyboard glyph (*"we already have help in settings"*)
AND put the legend in Settings → Help → Keyboard. The rebuild ported the deletion and not the
destination: `ShortcutsPopover` is exported from `top-bar.tsx:912` with **zero callers anywhere in
`src/` or `tests/`**, there is no `?` binding in `app/global-keys.ts`, and Settings has no Help group
— so `surfaces/shortcuts.tsx`, whose own header says *"a binding that is not here is unreachable from
Help"*, is currently reachable from nowhere. (2) **Two demo status sections need no new authority.**
System hosts reads `systemInstances`, which the bootstrap already serves, and Workflow capabilities
is derived from the same served descriptors the Explorer reads — they are absent because
`settingsSections` lists only `storage`, which is a server-side list decision, not a data gap. (3) A
demo-side oddity worth carrying across: the `System behaviour` nav entry declares `icon: Cog`
(`DemoSettings.tsx:159`) while its panel header renders `Camera` (`:635`) — whichever is ported, the
pair should agree.

| # | Element | Demo | Rebuild | Verdict | Reason |
|---|---------|------|---------|---------|--------|
| SE1 | the surface is a full-page takeover (`flex min-h-0 flex-1` + a left nav) → rebuild is a `Dialog` with `DialogContent title="Settings" size="lg"` | `DemoSettings.tsx:1074` | `settings.tsx:337` | divergent | **OPEN — operator call** (ref dashboard-surfaces §9.8 rules the section LIST and the read-only-ness; it is silent on the container) |
| SE2 | `<nav aria-label="Settings sections">` — `w-[220px] shrink-0`, `border-r`, `bg-[var(--ds-surface-1)]`, `p-[var(--ds-space-base)]`, `gap-[var(--ds-space-hair)]` | `DemoSettings.tsx:1075-1077` | — | missing | **OPEN — operator call** (follows SE1) |
| SE3 | nav's `Back to the dashboard` ghost `Button` with `ArrowLeft` `dsIcon.md`, `justify-start` | `DemoSettings.tsx:1079-1081` | — | missing | **OPEN — operator call** (follows SE1 — a dialog has no back; Archive and Explorer keep theirs) |
| SE4 | `Separator className="my-[var(--ds-space-tight)]"` under the back button | `DemoSettings.tsx:1082` | — | missing | **OPEN — operator call** (follows SE1) |
| SE5 | nav group heading `Settings` (`SectionLabel`, `px-base py-tight`) | `DemoSettings.tsx:1083` | — | missing | unserved: `settingsSections` serves only `{id:"storage"}` (`src/server/dashboard/queries/bootstrap.ts:122`) |
| SE6 | nav group heading `Status` (`px-base pb-tight pt-cozy`) | `DemoSettings.tsx:1093` | — | missing | unserved: `settingsSections` serves only `storage` |
| SE7 | nav group heading `Help` | `DemoSettings.tsx:1097` | — | missing | **OPEN — operator call** (Help is client-side and needs no served section) |
| SE8 | `SectionButton` — `aria-current="page"`, `entry.icon` at `dsIcon.md shrink-0`, truncating label, active = `bg-[var(--ds-surface-selected)]` + `font-semibold`, idle = `fg-muted` with `hover:bg-[var(--ds-surface-3)]`, `dsFocus`, `dsMotion.base` | `DemoSettings.tsx:1164-1180` | — | missing | **OPEN — operator call** (follows SE1) |
| SE9 | per-section `N unsaved` marker in `--ds-status-waiting-fg` with `title="N unsaved change(s) in <section>"` | `DemoSettings.tsx:1181-1188` | — | missing | ruled: `{#def-settings}` (D169, stance D193(b)) — nothing saves, so nothing is dirty |
| SE10 | the draft is PAGE state keyed by leaf and survives a section switch | `DemoSettings.tsx:1042` | — | missing | ruled: `{#def-settings}` |
| SE11 | the ONE action bar — `N unsaved change(s)`, a `MetaLine` of per-group counts, `Discard all` ghost, `Save N change(s)` primary; `rounded-lg`, `border-[color:var(--ds-border-loud)]`, `bg-[var(--ds-surface-2)]` | `DemoSettings.tsx:1132-1147` | — | missing | ruled: `{#def-settings}` — `apply-settings` is the one entry in `PHASE1_DEFERRED` and answers `rejected{code:"capability-unavailable"}` |
| SE12 | `ResultSurface` — success `Banner`, a code-less danger `Banner`, and a `Refusal` with `outcome="nothing was saved"`, each over a `Well` list of per-leaf `saved`/`refused` outcomes with their codes | `DemoSettings.tsx:307-363` | — | missing | ruled: `{#def-settings}` |
| SE13 | in-page degraded `Banner` — `Storage is read-only — no setting can be saved` | `DemoSettings.tsx:1105-1110` | — | missing | ruled: `{#def-settings}` + D222 |
| SE14 | section `General` (`Cog`) — *"The dates that roll over each fiscal year."* | `demo-settings-wire.ts:76` | — | missing | ruled: `{#def-settings}` · unserved: `settingsSections` |
| SE15 | section `Display` (`Monitor`) — *"How the queue is presented. Nothing here changes what a run does."* | `demo-settings-wire.ts:77` | — | missing | ruled: `{#def-settings}` · unserved: `settingsSections` |
| SE16 | section `Performance` (`Gauge`) — *"How hard the executor is allowed to push. Every value here is a budget, not a target."* | `demo-settings-wire.ts:78` | — | missing | ruled: `{#def-settings}` · unserved: `settingsSections` |
| SE17 | section `Paths` (`FolderTree`) — *"Where downloaded reports are written."* | `demo-settings-wire.ts:79` | — | missing | ruled: `{#def-settings}` · unserved: `settingsSections` |
| SE18 | leaf `annual.fiscalYearStart` — *Fiscal year start*, date control | `demo-settings-wire.ts:146-148` | — | missing | ruled: `{#def-settings}` |
| SE19 | leaf `display.defaultSort` — enum `Attention first` / `Newest first` / `Oldest first` | `demo-settings-wire.ts:156-167` | — | missing | ruled: `{#def-settings}` |
| SE20 | leaf `display.groupAutoExpand` — enum `On` / `Off` | `demo-settings-wire.ts:173-183` | — | missing | ruled: `{#def-settings}` |
| SE21 | leaf `performance.ocrConcurrency` — number | `demo-settings-wire.ts:189` | — | missing | ruled: `{#def-settings}` |
| SE22 | leaf `performance.ocrValidationRetries` — number | `demo-settings-wire.ts:207` | — | missing | ruled: `{#def-settings}` |
| SE23 | leaf `performance.duoTimeoutSec` — number | `demo-settings-wire.ts:218` | — | missing | ruled: `{#def-settings}` |
| SE24 | leaf `performance.defaultWorkers` — number, the ONE leaf carrying a `hazard` | `demo-settings-wire.ts:229` | — | missing | ruled: `{#def-settings}` |
| SE25 | leaf `paths.reportsDir` — text | `demo-settings-wire.ts:240` | — | missing | ruled: `{#def-settings}` |
| SE26 | `LeafCard` — `grid-cols-1 … min-[900px]:grid-cols-[minmax(0,1fr)_300px]`, provenance column with `border-t` → `min-[900px]:border-l` | `DemoSettings.tsx:437,488` | — | missing | ruled: `{#def-settings}` |
| SE27 | `ProvenanceStack` — three layers (`<env var name>` / `settings.json` / `code default`), unset in `fg-faint`, losers `line-through`, winner `font-semibold` + an `in effect` marker in `--ds-status-waiting-fg`, then `from <origin>` | `DemoSettings.tsx:248-283` | — | missing | ruled: `{#def-settings}` — the whole surface's thesis (`env > settings.json > default`) has no served counterpart |
| SE28 | `SourceBadge` — tone map `env→warning`, `settings→info`, `default→neutral`, `title` = `SETTING_SOURCE_NOTE` | `DemoSettings.tsx:223-234` | — | missing | ruled: `{#def-settings}` |
| SE29 | `WhatItDoes` ⓘ — `IconButton size="xs" variant="ghost"`, label `What <title> does`, `PopoverContent width="md"` | `DemoSettings.tsx:290-300` | — | missing | ruled: `{#def-settings}` |
| SE30 | hazard `Badge tone="warning"` with `TriangleAlert` reading `hazard`, `title` = the consequence | `DemoSettings.tsx:446-451` | — | missing | ruled: `{#def-settings}` |
| SE31 | hazard escalation `Banner tone="warning"` — `Above <safeMax> <unit>, this can put wrong data into a real record`, then the consequence and the detection | `DemoSettings.tsx:474-485` | — | missing | ruled: `{#def-settings}` |
| SE32 | `unsaved` `Badge tone="info"` with `title="Typed, not yet saved. It is included in the page's Save."` | `DemoSettings.tsx:452-456` | — | missing | ruled: `{#def-settings}` |
| SE33 | the leaf KEY printed `ml-auto` in `dsText.micro dsText.nums fg-faint` | `DemoSettings.tsx:457` | — | missing | ruled: `{#def-settings}` |
| SE34 | numeric range hint — `min–safeMax safe · max max`, or `min–max accepted` when there is no hazard | `DemoSettings.tsx:463-468` | — | missing | ruled: `{#def-settings}` |
| SE35 | `LeafControl` — enum → `Select max-w-[280px]`; number → `Input` `max-w-[140px]` with `min`/`max`/`step`/`inputMode="numeric"`; date → `Input type="date"`; text → `Input max-w-[280px]`; every one `aria-label="<label> value"` | `DemoSettings.tsx:386-420` | — | missing | ruled: `{#def-settings}` |
| SE36 | the leaf's `unit` printed beside its control | `DemoSettings.tsx:462` | — | missing | ruled: `{#def-settings}` |
| SE37 | status section `Environment & identity` (`Lock`, `dsIcon.lg`) — *"Values the deployment owns. Visible, and not yours to set."*, meta `N values`, four facts (`operator.timekeeperName`, `operator.actor`, `performance.navRetries`, `paths.trackerDir`) | `DemoSettings.tsx:149-155,534-556` | — | missing | unserved: no environment/identity axis on the bootstrap |
| SE38 | `EnvironmentCard` — a `Lock` glyph beside a FLAT value (never a disabled input), a `ShieldAlert` reason in `--ds-status-waiting-fg`, the `toChangeIt` sentence, and a `Try to set it anyway` outline `Button` that returns a real refusal | `DemoSettings.tsx:567-617` | — | missing | unserved: no environment/identity axis; the refusal path is `{#def-settings}` |
| SE39 | status section `System behaviour` — nav declares `Cog`, the panel header renders `Camera`; grouped constant tables `Value` / `In effect` (right) / `Why it is not a preference` | `DemoSettings.tsx:159,635,642-661` | — | missing | unserved: no system-behaviour constants axis |
| SE40 | status section `System hosts` (`Link2`) — meta `N of M have a test host`, the per-run `Banner`, and a `System` / `Production` / `Test` table with a `none provisioned` arm | `DemoSettings.tsx:812-857` | — | missing | **OPEN — operator call** — the data is ALREADY served as `systemInstances` on the bootstrap; the section is absent because `settingsSections` does not list it |
| SE41 | status section `Workflow capabilities` (`Table2`) — capability-major sections, an `N of M` `Badge` per capability, an ⓘ carrying each capability's meaning, three cell shapes (filled `Chip` / hairline `N/A` / warning `Not built` with its reason), and a `Where a dry run stops` posture table | `DemoSettings.tsx:682-806` | — | missing | **OPEN — operator call** — every cell is descriptor-derived, and the Explorer already reads those descriptors |
| SE42 | capability `Banner tone="info"` — *"Read from the descriptors, not from a list somebody kept up to date"* | `DemoSettings.tsx:735-738` | — | missing | **OPEN — operator call** (follows SE41) |
| SE43 | Help section `Keyboard` (`Keyboard` icon) — the grouped legend at `max-w-[64ch]` plus a `When they fire` bullet list of three rules | `DemoSettings.tsx:990-1015` | — | missing | **OPEN — operator call** — and the rebuild's `ShortcutsPopover` (`top-bar.tsx:912`) has **zero callers**, with no `?` binding, so the legend is reachable from nowhere |
| SE44 | `initialSection` — the Top Bar's Help route lands the page on `Keyboard` | `DemoSettings.tsx:1029-1030` | — | missing | **OPEN — operator call** (follows SE43) |
| SE45 | storage section header — `PanelHeader title="Storage health"`, `Database` at `dsIcon.lg`, subtitle *"The tracker volume, the authority generation, and the backups a restore would use."*, meta `newest backup <age>` → rebuild renders a bare `SectionLabel` reading `Storage` | `DemoSettings.tsx:869-875` | `settings.tsx:268` | divergent | **OPEN — operator call** |
| SE46 | storage `Banner` — `Read-write — healthy` (success) / `Read-only — degraded` (danger), body = the reason or the integrity line | `DemoSettings.tsx:877-879` | — | missing | **OPEN — operator call** — the rebuild states health as two `HealthLine` rows with `StatusDot`s instead |
| SE47 | two at-rest `HealthLine` rows (`StatusDot` + label + value) for Authority and Backup | — | `settings.tsx:269-270` | extra | ruled: ref dashboard-surfaces §9.8 — the at-rest summary rides the bootstrap every view already has |
| SE48 | three stat `Card`s — `Authority generation`, `Rows on disk`, `Newest backup` — each a `SectionLabel`, a `dsText.display dsText.nums` number, and a `CardBase`-pinned note | `DemoSettings.tsx:885-921` | — | missing | unserved: `rowsOnDisk` has no counterpart; `authorityGeneration` IS served but only inside the on-demand doctor, never at rest |
| SE49 | `Backups` table — `Taken` / `Age` / `Size` (right) / `Verdict` (a `success`/`warning`/`danger` `Badge`) / `Note` | `DemoSettings.tsx:923-950` | `settings.tsx:232-246` | divergent | unserved: backup `sizeLabel` and `note`; the rebuild prints restore candidates as plain `dsText.meta dsText.nums` lines rather than a table |
| SE50 | degraded-only pair of `Card`s — `Still works` and a danger-toned `Does not work`, each a `BulletList` | `DemoSettings.tsx:952-967` | — | missing | ruled: ref dashboard-surfaces §9.8 — *"every line of them would have been a claim about a system nobody had asked"* |
| SE51 | `Run storage doctor` `Button` with a `Running doctor…` disabled state and `aria-label="Run the read-only storage doctor"` | — | `settings.tsx:276-278` | extra | ruled: ref dashboard-surfaces §9.8 — two readings at two costs; the doctor is a deliberate press |
| SE52 | doctor provenance line `Read-only doctor · checked <clock>` | — | `settings.tsx:164-166` | extra | ruled: ref dashboard-surfaces §9.8 |
| SE53 | doctor authority line — `healthy — schema vN · generation N · N pages`, or `degraded — <code>: <summary>` | — | `settings.tsx:168-180` | extra | ruled: ref dashboard-surfaces §9.8 |
| SE54 | doctor pending-work grid — eight labelled counts (pending commands, unresolved write intents, leases, durable outbox, terminal outbox, provider reservations, artifact outbox, capture finalizations), with an `unavailable — <cause>` arm | — | `settings.tsx:149-158,182-197` | extra | ruled: ref dashboard-surfaces §9.8 |
| SE55 | doctor backup line — state, file name, age, and `generation gap N` or `generation gap unknown` | — | `settings.tsx:199-214` | extra | ruled: ref dashboard-surfaces §9.8 — byte-re-verified backup health |
| SE56 | doctor backup-SERVICE line — `ok` / `FAILED` (`role="alert"`, danger) / `never-run` with its reason | — | `settings.tsx:216-230` | extra | ruled: ref dashboard-surfaces §9.8 — *"a backup run that threw leaves no manifest for the doctor to find"* |
| SE57 | doctor restore candidates — `ok <manifest> — created … · generation … · age …` or `INVALID <manifest> — <code>: <summary>` | — | `settings.tsx:236-245` | extra | ruled: ref dashboard-surfaces §9.8 |
| SE58 | NO restore button on either side | `DemoSettings.tsx:923-950` | `settings.tsx:232-246` | exact | — |
| SE59 | doctor failure arm — a `role="alert"` danger line carrying the thrown message | — | `settings.tsx:280-284` | extra | ruled: ref dashboard-surfaces §9.8 |
| SE60 | at-rest provenance sentence — *"Summary checked … — from the newest write-time-verified backup manifest; the doctor below re-verifies bytes."* | — | `settings.tsx:271-274` | extra | ruled: ref dashboard-surfaces §9.8 — two readings at two costs, said on the surface |
| SE61 | a served section this build cannot draw says so by name — *"This build has no renderer for the served section "<id>"."* | — | `settings.tsx:345-350` | extra | ruled: ref dashboard-surfaces §9.8 |
| SE62 | app-wide band trigger: demo fires on `storage === "read-only-degraded"`; rebuild fires on `authority !== "healthy"` only, and a stale/missing backup becomes an inbox row plus the gear's dot | `DemoSettings.tsx:1206` | `settings.tsx:101` | divergent | ruled: D222 |
| SE63 | band container: demo is a bespoke `div` with `border-b border-[color:var(--ds-danger-border)]` and `bg-[var(--ds-danger-quiet)]`; rebuild uses the `Banner` primitive at `tone="danger"` | `DemoSettings.tsx:1209` | `settings.tsx:104-105` | divergent | **OPEN — operator call** |
| SE64 | band icon `ShieldAlert` at `dsIcon.lg` in `--ds-danger` → rebuild takes `Banner`'s own danger icon | `DemoSettings.tsx:1211` | `settings.tsx:104` | divergent | **OPEN — operator call** |
| SE65 | band title — `Storage is read-only — the dashboard is diagnostic only` → `Authority storage is unavailable` | `DemoSettings.tsx:1213-1215` | `settings.tsx:107` | divergent | ruled: ref dashboard-surfaces §9.8 — every word is derived from facts the bootstrap serves |
| SE66 | band body — demo prints `snapshot.reason`; rebuild prints `AUTHORITY_HAZARD` plus the backup hazard when both are true, authority first | `DemoSettings.tsx:1216` | `settings.tsx:114-120` | divergent | ruled: ref dashboard-surfaces §9.8 / D24's hazard exemption |
| SE67 | band `What still works?` / `Hide what still works` outline toggle with `aria-expanded`, disclosing two `Well`s | `DemoSettings.tsx:1219-1238` | — | missing | ruled: ref dashboard-surfaces §9.8 — no third sentence, no disclosure list |
| SE68 | band `Storage health` secondary `Button` routing to Settings | `DemoSettings.tsx:1222-1224` | `settings.tsx:109-111` | exact | — |
| SE69 | band `MetaLine` `checked <clock>` | — | `settings.tsx:121` | extra | ruled: ref dashboard-surfaces §9.8 |
| SE70 | the gear's attention dot — `StatusDot` at the icon's top-right when `storageNeedsAttention` | — | `settings.tsx:328-332` | extra | ruled: D222 — the backup state reaches the operator as the dot plus an inbox row |
| SE71 | the gear reports it owns the screen — `aria-pressed={open}` plus a `bg-[var(--ds-surface-3)]` fill | — | `settings.tsx:323-324` | extra | ruled: ref dashboard-surfaces §9.9 |
| SE72 | the demo's storage-fixture switch, parked behind the demo badge | `DemoSettings.tsx:106-108` | — | missing | ruled: demo scaffolding — a fixture switch with no production counterpart |

**Counts:** 72 rows — exact 2 · divergent 8 · missing 48 · extra 14 · **OPEN 15 marks** (SE1, SE2,
SE3, SE4, SE7, SE8, SE40, SE41, SE42, SE43, SE44, SE45, SE46, SE63, SE64) across **10 distinct
questions** — SE2/SE3/SE4/SE8 all follow SE1's container choice, SE42 follows SE41, and SE44 follows
SE43.

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
