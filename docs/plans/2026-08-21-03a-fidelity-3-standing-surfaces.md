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

**Demo:** `DemoArchive.tsx` (1614) · `demo-archive-wire.ts` (1972) · **Rebuild:** `surfaces/archive.tsx` (2748) · `archive-model.ts` (22)

The demo's Archive is a two-view takeover: **Archived runs** (a virtualised, `table-fixed` ledger of *sweeps* — each applied bump is a collapsible section head laid on the table's own `<colgroup>` — beside a 440px self-contained snapshot panel with five tabs) and **Versions & bumps** (the workflow version registry, the two bump entry points, and the change-record list). The rebuild reproduces the SHELL almost glyph-for-glyph — page header, view switcher, recess container, toolbar, colgroup tokens, sweep-head column assignment, sort semantics, footer sentence, dialog footer meta — and then diverges hard in three places. **The single biggest structural finding: the rebuild's table is not virtualised at all.** `@tanstack/react-virtual` is not a dependency of this repo, `ARCHIVE_ROW_PX` / `ARCHIVE_SECTION_PX` / `overscan: 12` / the two spacer `<tr>`s do not exist, and each section gets its own `<TBody>` instead of one flat windowed list — so the entire demo mechanic that makes the archive "cost the same at 800 rows as at 80" is absent, on a surface whose own header comment still explains why it must be there. Second: the demo's hazard vocabulary on a LIST row (the `△ N` warning-count chip, the `dry run` chip) is gone, and the dry-run chip is gone from the DETAIL too — even though `dryRun`, `priority`, `warnings`, `displayName` and `subtitle` are all served on `detail.row` (a frozen `QueueSurfaceWire`) and `docs/findings/queue-rows.md` asserts *"the archived detail draws it"* for `dryRun`, which is false at this commit. Third: the Evidence tab has no lightbox, no `Open` / `What it was` control and no purged `ImageOff` arm, so a capture cannot be opened at all. Everything else is copy drift, most of it OPEN.

| # | Element | Demo | Rebuild | Verdict | Reason |
|---|---------|------|---------|---------|--------|
| AR1 | Page header title `Archive` | `DemoArchive.tsx:224` | `archive.tsx:2694` | exact | — |
| AR2 | Header icon `Archive` at `dsIcon.lg`, `aria-hidden` | `DemoArchive.tsx:225` | `archive.tsx:2695` | exact | — |
| AR3 | Header badge `Badge tone="neutral"` + `Lock` at `dsIcon.sm` + text `read-only` | `DemoArchive.tsx:227-230` | `archive.tsx:2697-2700` | exact | — |
| AR4 | Back-button LABEL: demo is always `Back to the dashboard`; rebuild swaps to `Back to the ledger` whenever a run is selected | `DemoArchive.tsx:234` | `archive.tsx:2709` | divergent | **OPEN — operator call** |
| AR5 | Back button `variant="ghost" size="sm"` + `ArrowLeft` at `dsIcon.md` | `DemoArchive.tsx:233` | `archive.tsx:2703-2706` | exact | — |
| AR6 | View switcher container: `role="group"` `aria-label="Archive view"`, `inline-flex … gap-[var(--ds-space-hair)] rounded-[var(--ds-radius-md)] border border-[color:var(--ds-recess-border)] bg-[var(--ds-recess-bg)] p-[var(--ds-space-hair)]` | `DemoArchive.tsx:238-242` | `archive.tsx:2713-2717` | exact | — |
| AR7 | `Archived runs` switch button — `size="sm"`, `variant` secondary/ghost, `aria-pressed` | `DemoArchive.tsx:243-245` | `archive.tsx:2718-2725` | exact | — |
| AR8 | `Versions & bumps` switch button — same props | `DemoArchive.tsx:246-253` | `archive.tsx:2726-2733` | exact | — |
| AR9 | Page ROOT element: demo is a bare `div.flex.min-h-0.flex-1.flex-col`; rebuild wraps the whole page in `<Panel aria-label="Archive">` with a `useDsEnterTransition` translate/opacity enter | `DemoArchive.tsx:222` | `archive.tsx:2684-2692` | divergent | **OPEN — operator call** |
| AR10 | Runs-view grid `grid-cols-1 gap-[var(--ds-space-base)] p-[var(--ds-space-cozy)] min-[1180px]:grid-cols-[minmax(0,1fr)_minmax(0,440px)]` | `DemoArchive.tsx:261` | `archive.tsx:2669` | exact | — |
| AR11 | List `Panel className="min-h-0"` | `DemoArchive.tsx:263` | `archive.tsx:784` | exact | — |
| AR12 | List `PanelHeader title="Archived runs"` | `DemoArchive.tsx:265` | `archive.tsx:786` | exact | — |
| AR13 | List panel meta `${visible.toLocaleString()} of ${total.toLocaleString()}` | `DemoArchive.tsx:266` | `archive.tsx:787` | exact | — |
| AR14 | Retention trigger `IconButton size="sm" label="Retention"` + `Info` at `dsIcon.md` + `text-[color:var(--ds-fg-faint)] hover:text-[color:var(--ds-fg)] data-[state=open]:text-[color:var(--ds-fg)]` | `DemoArchive.tsx:270-275` | `archive.tsx:791-796` | exact | — |
| AR15 | Retention `PopoverContent title="Retention" width="lg" align="end"` | `DemoArchive.tsx:280` | `archive.tsx:806` | exact | — |
| AR16 | Retention bullet 1 — demo `An archived row is kept indefinitely — it is the audit copy.` vs rebuild `An archived row is the audit copy: schema v13 aborts UPDATE and DELETE on it in SQL, not by convention.` | `DemoArchive.tsx:283` | `archive.tsx:809` | divergent | `ruled: D179` (v13 aborts UPDATE/DELETE in SQL is D179's own sentence) |
| AR17 | Retention bullet — demo `Its evidence images are kept 90 days from the run's end and then purged; a purged pointer still names what it was of.` vs rebuild `Evidence is POINTERS — the captured bytes and the checkpoints stay where they are and are kept until an explicit purge, which is a command and not a schedule.` | `DemoArchive.tsx:284` | `archive.tsx:811` | divergent | `ruled: D179` (evidence is pointers only; there is no 90-day image purge in this tree) |
| AR18 | Retention bullet — `The write ledger is never archived and never pruned, which is why a run here still lists what it filed.` | `DemoArchive.tsx:285` | `archive.tsx:812` | exact | — |
| AR19 | Extra retention bullet about `notes/` + `spans/` pruning at `EVENT_STREAM_RETENTION_DAYS` | — | `archive.tsx:810` | extra | `ruled: ref dashboard-surfaces §10.4` (per-record retention is computed server-side) |
| AR20 | `PanelToolbar label="Find an archived run"` + `gap-[var(--ds-space-snug)] overflow-x-auto` (scrolls sideways, never wraps) | `DemoArchive.tsx:297` | `archive.tsx:824` | exact | — |
| AR21 | Search `aria-label` — demo `Search archived runs by name, EID, trace id or confirmation number` vs rebuild `Search archived runs by title, trace id or workflow` | `DemoArchive.tsx:299` | `archive.tsx:826` | divergent | `unserved: ArchiveEntryWire carries no eid / ledger confirmation / receipt lines — its haystack is title, traceId, workflowLabel, workflowCode, workflowId, runId` |
| AR22 | Search `placeholder` — demo `Name, EID, trace, confirmation…` vs rebuild `Title, trace, workflow…` | `DemoArchive.tsx:300` | `archive.tsx:827` | divergent | `unserved: ArchiveEntryWire has no eid or confirmation field` |
| AR23 | Search `className="min-w-[200px] flex-1"` + `onClear` | `DemoArchive.tsx:303-304` | `archive.tsx:830-831` | exact | — |
| AR24 | `Select aria-label="Workflow"` + `className="w-auto shrink-0"` + `<option value="all">Every workflow</option>` | `DemoArchive.tsx:306-312` | `archive.tsx:833-839` | exact | — |
| AR25 | Workflow options derived from the corpus (`workflowId → workflowLabel`) | `DemoArchive.tsx:313-317` | `archive.tsx:840-842` | exact | — |
| AR26 | `Select aria-label="Final status"` + `<option value="all">Any outcome</option>` | `DemoArchive.tsx:319-325` | `archive.tsx:844-850` | exact | — |
| AR27 | Status option LABELS — demo prints `PROPOSED_STATUS[status].label` (`Done`, `Review`, `Write parked`…); rebuild prints those same labels through the shared status model | `DemoArchive.tsx:326-330` | `archive.tsx:914`, `archive-model.ts:78` | exact | — |
| AR28 | `Select aria-label="Instance"` + options `Any instance` / `Production only` / `Touched a test instance` | `DemoArchive.tsx:332-341` | `archive.tsx:862-874` | exact | — |
| AR29 | `Clear` button — `size="sm" variant="ghost" className="shrink-0"`, rendered only when `filtered` | `DemoArchive.tsx:342-346` | `archive.tsx:875-879` | exact | — |
| AR30 | `queryIsFiltered` predicate (text trimmed ≠ "" \|\| workflow ≠ all \|\| status ≠ all \|\| instance ≠ all) | `demo-archive-wire.ts:1498-1502` | `archive.tsx:236-241` | exact | — |
| AR31 | `EMPTY_ARCHIVE_QUERY` defaults `{text:"", workflowId:"all", status:"all", instance:"all", sort:"when", dir:"desc"}` | `demo-archive-wire.ts:1488-1495` | `archive.tsx:227-234` | exact | — |
| AR32 | **VIRTUALISATION** — `useVirtualizer({count, getScrollElement, estimateSize, overscan: 12})` over one flat item list | `DemoArchive.tsx:469-474` | — | missing | OPEN — operator call (no decision covers it; `@tanstack/react-virtual` is not a dependency of this repo) |
| AR33 | Virtualisation constants `ARCHIVE_ROW_PX = 32` / `ARCHIVE_SECTION_PX = 52` | `DemoArchive.tsx:440-441` | — | missing | **OPEN — operator call** |
| AR34 | Leading/trailing spacer rows `<tr aria-hidden style={{height}}><td colSpan={5}/></tr>` | `DemoArchive.tsx:535-539`, `564-568` | — | missing | **OPEN — operator call** |
| AR35 | `flattenArchiveTable` — sections and runs in ONE sequence, a collapsed section contributing only its header | `demo-archive-wire.ts:1641-1653` | — | missing | OPEN — operator call (rebuild maps sections directly, so there is no flat item list) |
| AR36 | Scroll container `div.min-h-0.flex-1.overflow-auto` wrapping the table | `DemoArchive.tsx:512` | `archive.tsx:674` | exact | — |
| AR37 | `Table label` — demo `Archived runs` vs rebuild `Archived runs, grouped by the version bump that swept them` | `DemoArchive.tsx:513` | `archive.tsx:675` | divergent | **OPEN — operator call** |
| AR38 | `Table layout="fixed" className="min-w-[720px]"` | `DemoArchive.tsx:513` | `archive.tsx:675` | exact | — |
| AR39 | `<colgroup>` five cols, widths `--ds-w-archive-status` / auto / `-trace` / `-when` / `-duration` (token values identical: 132/148/152/104px) | `DemoArchive.tsx:518-524` | `archive.tsx:682-688` | divergent | OPEN — operator call (demo uses `className="w-[var(--ds-w-archive-status)]"`, rebuild uses `style={{width:"var(…)"}}`; same computed width, different mechanism) |
| AR40 | `THead` → one `TR` of five `TH`s, each spread from `head(key)` so label and sort key come from one map | `DemoArchive.tsx:525-533` | `archive.tsx:689-697` | exact | — |
| AR41 | `ARCHIVE_SORT_LABEL` — `status:"Outcome"`, `name:"Name"`, `trace:"Trace"`, `when:"When"`, `duration:"Ran for"` | `demo-archive-wire.ts:1471-1477` | `archive.tsx:201-207` | exact | — |
| AR42 | Duration `TH align="right" className="whitespace-nowrap"` | `DemoArchive.tsx:531` | `archive.tsx:695` | exact | — |
| AR43 | Sort direction semantics — active column flips, otherwise `opensDescending = ["when","duration"]` | `DemoArchive.tsx:201-208` | `archive.tsx:771-781` | exact | — |
| AR44 | `sort` prop value `ascending`/`descending`/`none` off the active key | `DemoArchive.tsx:483` | `archive.tsx:668` | exact | — |
| AR45 | Status comparator rank order `waiting, failed, parked, doneWarnings, running, queued, cancelled, verifiedDone` | `demo-archive-wire.ts:1544-1553` | `archive.tsx:314` (`DS_STATUS_ORDER`, `primitives-status.tsx:256-265`) | exact | — |
| AR46 | Name comparator — demo tiebreaks `displayName ?? title` → `workflowCode` → `workflowVersion`; rebuild `title` → `workflowLabel` | `demo-archive-wire.ts:1568-1571` | `archive.tsx:315` | divergent | `unserved: ArchiveEntryWire has no displayName` (the version tiebreak is available as `archivedIdentity.descriptorVersion` and is simply not used) |
| AR47 | `when` comparator — demo sorts by FIXTURE ORDER because its clock is a display string; rebuild compares real ISO `endedAt` with absent sorting LAST | `demo-archive-wire.ts:1573` | `archive.tsx:317`, `321-326` | divergent | `ruled: D124` (`endedAt` is served in its own right so this is real arithmetic, not a parse of a label) |
| AR48 | `duration` comparator — demo regex-parses the `2h 47m` label; rebuild measures `elapsedSecondsBetween(startedAt, endedAt)` | `demo-archive-wire.ts:1536-1541` | `archive.tsx:257-260`, `318` | divergent | `ruled: D124` |
| AR49 | Stable tiebreak on served/fixture order so equal rows do not reshuffle | `demo-archive-wire.ts:1591-1594` | `archive.tsx:338-345` | exact | — |
| AR50 | `groupArchiveByBump` / `groupBySweep` — grouping applied AFTER the sort, sections ordered by first row | `demo-archive-wire.ts:1615-1628` | `archive.tsx:363-377` | exact | — |
| AR51 | `TBody` structure — demo ONE `<TBody>` holding spacers + windowed items; rebuild one `<TBody>` PER section | `DemoArchive.tsx:534-569` | `archive.tsx:698-715` | divergent | OPEN — operator call (a consequence of AR32; multiple `<tbody>` is valid HTML but is not the demo's one-flat-list shape) |
| AR52 | Empty-state icon `Archive` at `dsIcon.lg`, inside `PanelBody` | `DemoArchive.tsx:490-492` | `archive.tsx:883-885` | exact | — |
| AR53 | Empty-state title, filtered arm — `Nothing in the archive matches` | `DemoArchive.tsx:493` | `archive.tsx:886` | exact | — |
| AR54 | Empty-state title, unfiltered arm — demo `The archive is empty` vs rebuild `Nothing has been archived yet` | `DemoArchive.tsx:493` | `archive.tsx:886` | divergent | **OPEN — operator call** |
| AR55 | Empty-state description, filtered arm — `Every archived run was excluded by the search or one of the filters. Clearing them shows all of them again.` | `DemoArchive.tsx:496` | `archive.tsx:889` | exact | — |
| AR56 | Empty-state description, unfiltered arm — demo `A run reaches the archive only when its workflow's MAJOR version bumps. Nothing has bumped yet.` vs rebuild `A run reaches the archive only when its workflow's version bumps — its shape moved, so it is no longer comparable with what runs today. Plan a bump under Versions & bumps to see which runs a sweep would take.` | `DemoArchive.tsx:497` | `archive.tsx:890-891` | divergent | OPEN — operator call (the MAJOR/minor split does not exist on this wire — see AR73) |
| AR57 | Empty-state action `Button size="sm" variant="secondary"` labelled `Clear the search and filters`, only on the filtered arm | `DemoArchive.tsx:499-505` | `archive.tsx:893-901` | exact | — |
| AR58 | Run row `TR interactive selected onClick className="cursor-pointer"` | `DemoArchive.tsx:603` | `archive.tsx:427` | exact | — |
| AR59 | `data-demo-row-id={entry.runId}` attribute on the run `TR` | — | `archive.tsx:427` | extra | OPEN — operator call (parity-harness hook; the demo has none) |
| AR60 | `ArchiveStatusLead` — fixed-width `dsIcon.sm` well, `aria-hidden` when empty, so pills and section badges share an x | `DemoArchive.tsx:588-597` | `archive.tsx:404-413` | exact | — |
| AR61 | Status cell `StatusPill status size="sm" hideIcon` | `DemoArchive.tsx:607` | `archive.tsx:431` | exact | — |
| AR62 | Warning-count chip beside the pill — `h-[var(--ds-h-xs)] … rounded-[var(--ds-radius-sm)] border px-[var(--ds-space-snug)]`, warning tokens, `dsText.meta/nums/flush`, `TriangleAlert` + count, `title={warnings.first}` | `DemoArchive.tsx:608-622` | `archive.tsx:424-442,479` | exact | — |
| AR63 | Name-cell button — `stopPropagation` + `onSelect`, `min-w-0 flex-1 truncate text-left text-[color:var(--ds-fg)]` + `dsFocus` | `DemoArchive.tsx:627-633` | `archive.tsx:441-447` | exact | — |
| AR64 | Name-button `title` — demo `${displayName ?? title} · ${workflowCode} ${archivedVersionTag}`; rebuild swaps the code for the full label AND appends a clause the demo has no counterpart for: `${title} · ${workflowLabel} v${N}[ — no short code: reason] — archived because ${driftWords}` | `DemoArchive.tsx:634` | `archive.tsx:448`, `285-290` | divergent | `ruled: D242` (the whole label moves to the hover) |
| AR65 | Row NAME text — demo `run.displayName ?? run.title`; rebuild `entry.title` only | `DemoArchive.tsx:636` | `archive.tsx:450` | divergent | `unserved: ArchiveEntryWire has no displayName` (served on `detail.row.displayName`, `projection.ts:309`, but not on the index entry) |
| AR66 | Name meta suffix — demo ` · ${workflowCode} ${archivedVersionTag}` (`· ec v3.1`) vs rebuild ` · ${workflowToken} v${descriptorVersion}` (`· sd v1`), same `dsText.meta dsText.nums text-[color:var(--ds-fg-muted)]` | `DemoArchive.tsx:637-640` | `archive.tsx:451-454` | divergent | `unserved: WorkflowVersionIdentity.descriptorVersion is a single positive int — no minor half exists on the descriptor or any wire` |
| AR67 | Dry-run chip on the LIST row — `FlaskConical` + copy `dry run`, info tokens, `title="Dry run — this rehearsal reads the systems and writes nothing."` | `DemoArchive.tsx:642-655` | `archive.tsx:445-462,516` | exact | — |
| AR68 | Test-instance hazard `TriangleAlert` at `dsIcon.sm` + `text-[color:var(--ds-status-waiting-fg)]`; `aria-label` demo `touched a test instance` vs rebuild `touched a test instance of ${systems}` | `DemoArchive.tsx:656-661` | `archive.tsx:476-481` | divergent | OPEN — operator call (a strictly richer label; still a divergence from the demo's exact string) |
| AR69 | App-build-unrecorded hazard `TriangleAlert` with `aria-label="app build unrecorded"` on the name cell | — | `archive.tsx:462-467` | extra | `ruled: D179` (an unstamped `appVersion` is read forward and treated as prior-version) |
| AR70 | Trace cell `TD numeric className="truncate text-[color:var(--ds-fg-muted)]"` printing `traceId` | `DemoArchive.tsx:664-666` | `archive.tsx:484-486` | exact | — |
| AR71 | When cell — demo prints the stored display clock verbatim; rebuild prints `fmtClock(endedAt)` or an em dash whose `title` is the absence reason | `DemoArchive.tsx:667-669` | `archive.tsx:487-491` | divergent | `ruled: D124` (a terminal row with no end instant renders an absence, never `now`) |
| AR72 | Duration cell `TD align="right" numeric whitespace-nowrap text-[color:var(--ds-fg-faint)]` — demo prints `durationLabel`, rebuild `fmtElapsed(seconds)` or `—` | `DemoArchive.tsx:670-672` | `archive.tsx:492-494` | divergent | `ruled: D124` |
| AR73 | Sweep-head `TR interactive onClick className={cn("h-auto", dsMotion.fast)}` | `DemoArchive.tsx:738` | `archive.tsx:530` | exact | — |
| AR74 | Sweep-head cell background `bg-[var(--ds-surface-2)] border-b border-[color:var(--ds-border)]` on all five `TD`s | `DemoArchive.tsx:732` | `archive.tsx:524` | exact | — |
| AR75 | Chevron choice `collapsed ? ChevronRight : ChevronDown`, `dsIcon.sm shrink-0 text-[color:var(--ds-fg-muted)]` inside `ArchiveStatusLead` | `DemoArchive.tsx:731`, `754-756` | `archive.tsx:523`, `546-548` | exact | — |
| AR76 | Disclosure `<button aria-expanded={!collapsed}>` with `stopPropagation` and `flex min-w-0 cursor-pointer items-center gap-[var(--ds-space-snug)] text-left` + `dsFocus` + `dsRadius.sm` | `DemoArchive.tsx:740-752` | `archive.tsx:532-544` | exact | — |
| AR77 | `sr-only` summary — the rebuild's frozen sweep identity and scope sentence differs from the demo's synthetic target sentence, but now includes the served `${kind} bump`; the absent change-record arm names its reason | `DemoArchive.tsx:733-735` | `archive.tsx:575-584` | divergent | ruled: D179/D223 — archive summary names authority sweep identity/scope; kind omission ported in `d1f87916` |
| AR78 | Sweep-head BADGE — carries bump KIND (`major`/`minor`), warning/neutral tone and `title={BUMP_KIND_LABEL[kind]}` | `DemoArchive.tsx:758-761` | `archive.tsx:609` | exact | — |
| AR79 | `no record` danger arm in the badge slot — `aria-hidden`, `dsText.meta text-[color:var(--ds-danger)]`, copy `no record` | `DemoArchive.tsx:762-766` | `archive.tsx:551` | exact | — |
| AR80 | Sweep NAME cell text — demo `bumpNameLabel(record)` = `${codes.join("+")} ${from} → ${to}` (`ec v3.1 → v4.0`), app bumps keep the bare `app 2.4 → app 3.0`; rebuild `sweepNameLabel(sweep)` = `${workflowId} v${N}, … → ${targetVersion}` (full ids, semver target) | `demo-archive-wire.ts:301-307` | `archive.tsx:390-395` | divergent | OPEN — operator call (`WorkflowVersionStateWire.workflowCode` exists, and D242 froze the code onto the archived record — the sweep head prints the raw `workflowId` anyway) |
| AR81 | Sweep NAME cell classes `dsText.meta dsText.nums block min-w-0 truncate font-semibold text-[color:var(--ds-fg)]` | `DemoArchive.tsx:774` | `archive.tsx:568` | exact | — |
| AR82 | Sweep NAME cell `title` — demo `${BUMP_SCOPE_LABEL[scope]} — ${target.full}` (a SECOND fact on hover); rebuild repeats `sweepNameLabel` (the cell's own text) | `DemoArchive.tsx:775` | `archive.tsx:569` | divergent | OPEN — operator call (a `title` equal to its own cell text is a no-op tooltip) |
| AR83 | Missing-record name arm — demo `Change record missing` vs rebuild `Sweep record missing`, both `dsText.meta block min-w-0 truncate text-[color:var(--ds-danger)]` | `DemoArchive.tsx:780-782` | `archive.tsx:562-565` | divergent | **OPEN — operator call** |
| AR84 | Sweep TRACE cell — demo prints the whole `bumpId`; rebuild prints `shortHash(applicationId)` (8 chars) with the full id in `title` | `DemoArchive.tsx:787-789` | `archive.tsx:577-579` | divergent | OPEN — operator call (a uuid does not fit the 148px trace column, but this is not a ruled truncation) |
| AR85 | Sweep WHEN cell `TD numeric whitespace-nowrap text-[color:var(--ds-fg-muted)]` — demo `record?.at`, rebuild `fmtClock(appliedAt)` or `""` | `DemoArchive.tsx:792-794` | `archive.tsx:582-584` | exact | — |
| AR86 | Sweep DURATION cell `TD align="right" whitespace-nowrap` holding `<CountBadge value={count}/>` + the ⓘ, in an `inline-flex gap-[var(--ds-space-tight)]` | `DemoArchive.tsx:797-799` | `archive.tsx:587-589` | exact | — |
| AR87 | Sweep ⓘ `IconButton size="xs"` + `stopPropagation` + `Info` at `dsIcon.sm` + `shrink-0 data-[state=open]:bg-[var(--ds-surface-3)] data-[state=open]:text-[color:var(--ds-fg)]` | `DemoArchive.tsx:802-808` | `archive.tsx:592-598` | exact | — |
| AR88 | Sweep ⓘ `label` — `About this bump — ${nameLabel}` / `About ${id}` (arms swapped in source order, same strings) | `DemoArchive.tsx:805` | `archive.tsx:595` | exact | — |
| AR89 | Sweep ⓘ `PopoverContent width="lg" align="end"` | `DemoArchive.tsx:813-814` | `archive.tsx:603-604` | exact | — |
| AR90 | Sweep ⓘ popover `title` — `bumpNameLabel(record)` vs `sweepNameLabel(sweep)`; missing arm `Change record missing` vs `Sweep record missing` | `DemoArchive.tsx:811` | `archive.tsx:601` | divergent | OPEN — operator call (inherits AR80/AR83) |
| AR91 | Sweep ⓘ popover `description` — `BUMP_KIND_LABEL[kind]`; the minor arm says the current contract's `behaviour inside the same shape`, not the demo's narrower presentation-only claim | `DemoArchive.tsx:812` | `archive.tsx:664`, `archive-model.ts:108-111` | divergent | ruled: `VersionBumpChangeRecordSchema.kind` contract; served kind ported in `d1f87916` |
| AR92 | Sweep ⓘ body — demo three paragraphs `record.what` (fg) / `record.why` (fg-muted) / `target.full` (meta, fg-muted); rebuild one scope paragraph then `<ChangeRecordBody>` (kind badge + what + why + commit) | `DemoArchive.tsx:816-822` | `archive.tsx:612-625`, `1875-1891` | divergent | `ruled: D223` (the change record is authored at plan time and read forward; a pre-generation-2 sweep prints its reason instead of a blank) |
| AR93 | Sweep ⓘ `MetaLine` — demo four items `[by, commit, at, "${n} runs archived"]` vs rebuild six `[appliedBy, "plan <hash8>", "app <ver>", <clock>, "${n} runs archived", "v… → target" \| "archived nothing, so no from-version"]` | `DemoArchive.tsx:821` | `archive.tsx:626-637` | divergent | `ruled: D179` (`fromVersions` is derived from the archived records, and `versionPlanId` / `appliedAppVersion` are D179 facts the demo had no equivalent for) |
| AR94 | Sweep ⓘ missing-record paragraph — demo `Swept by <id>, which the change-record store does not hold. The runs are intact; what is missing is why they were archived.` vs rebuild `Swept by <id>, which this index does not carry. …` | `DemoArchive.tsx:824-827` | `archive.tsx:607-610` | divergent | **OPEN — operator call** |
| AR95 | Detail `PanelHeader title` — `run.displayName` when present, otherwise the row contract's composed `run.title` | `DemoArchive.tsx:877` | `archive.tsx:1237`, `archive-model.ts:57-69` | exact | — |
| AR96 | Detail header `subtitle` — `${run.subtitle} · archived ${archivedAt} by ${archivedBy}` when present; the absence arm draws archive provenance alone | `DemoArchive.tsx:878` | `archive.tsx:1238-1240`, `archive-model.ts:57-69` | exact | — |
| AR97 | Detail header `icon={<FileClock … dsIcon.lg/>}` | — | `archive.tsx:1168` | extra | OPEN — operator call (the demo's detail header carries no icon) |
| AR98 | Detail header `meta={<StatusPill status size="sm"/>}` (with icon) | `DemoArchive.tsx:879` | `archive.tsx:1169` | exact | — |
| AR99 | Detail header action `Button size="sm" variant="ghost"` + `Download` at `dsIcon.md` + label `Export` | `DemoArchive.tsx:881-883` | `archive.tsx:1170-1179` | exact | — |
| AR100 | Exported FILENAME `archive-<traceId>.json` | `demo-archive-wire.ts:1694-1696` | `archive.tsx:1105` | exact | — |
| AR101 | Exported JSON SHAPE — demo `JSON.stringify(run, null, 2)` of the whole `ArchivedRunWire`; rebuild `JSON.stringify(detail, undefined, 2)` of the display-redacted `ArchivedRunDetailWire` | `demo-archive-wire.ts:1690-1692` | `archive.tsx:1101` | divergent | `ruled: D223` (exactly the display-redacted wire, so no new redaction surface) |
| AR102 | Export TOAST — demo `{tone:"success", title:"Archived run exported", description:"archive-<trace>.json"}`; rebuild `{tone:"success", title:"archive-<trace>.json", description:"Exactly what this page holds — the display-redacted archived record, nothing re-derived."}` (title/description swapped) | `DemoArchive.tsx:871` | `archive.tsx:1118-1122` | divergent | **OPEN — operator call** |
| AR103 | Detail `Panel aria-label={`Archived run ${title}`}` | — | `archive.tsx:1162` | extra | **OPEN — operator call** |
| AR104 | Relaunch banner mount — above the tab set, in `div.px-[var(--ds-space-cozy)].pt-[var(--ds-space-cozy)]`, `Banner tone="success"` | `DemoArchive.tsx:891-893` | `archive.tsx:1187-1191` | exact | — |
| AR105 | Relaunch banner TITLE — `New ${workflowLabel} run enqueued on ${versionTag}` from the available relaunch arm; the impossible unavailable arm fails loud | `demo-archive-wire.ts:1965` | `archive.tsx:1264`, `archive-model.ts:184-194` | exact | — |
| AR106 | Relaunch banner BODY — demo three sentences naming the replayed input labels, the archived trace, the archived version and the fingerprint rule; rebuild two sentences about the fresh trace id and the `Relaunched as` list | `demo-archive-wire.ts:1966-1969` | `archive.tsx:1194-1197` | divergent | **OPEN — operator call** |
| AR107 | Relaunch banner `MetaLine items={["new run ${traceId}", "lands in ${panel}"]}` | `DemoArchive.tsx:914` | — | missing | `unserved: the relaunch CommandResult carries no created runId/traceId back to the surface` (rebuild re-reads the index by nonce instead) |
| AR108 | Relaunch banner action `Button size="sm" variant="secondary"` + `ArrowUpRight` at `dsIcon.md` labelled `Open {panel}`, wired to `onOpenWorkflow` | `DemoArchive.tsx:898-905` | — | missing | `unserved: no created-run identity on the relaunch result` (see AR107) |
| AR109 | Relaunch banner `Dismiss` — `Button size="sm" variant="ghost"` | `DemoArchive.tsx:906-908` | `archive.tsx:1192` | exact | — |
| AR110 | Relaunch result keyed to the run it came from, so a re-selection cannot show a stale banner | `DemoArchive.tsx:155`, `368` | `archive.tsx:2519-2525`, `2645` | exact | — |
| AR111 | `Tabs` + `TabList label="Archived run detail"`, `className="min-h-0 flex-1"` | `DemoArchive.tsx:919-920` | `archive.tsx:1202-1203` | exact | — |
| AR112 | `Summary` tab (no count) | `DemoArchive.tsx:921` | `archive.tsx:1204` | exact | — |
| AR113 | `Logs` tab count — demo `run.logs.length`; rebuild `frozenLogCount(sections)` = `undefined` when the section is absent, so no number prints | `DemoArchive.tsx:922-924` | `archive.tsx:1205`, `1719-1721` | divergent | `ruled: D223` (a pre-generation-2 record reports its tabs absent, never a fabricated zero) |
| AR114 | `Data` tab count — same shape | `DemoArchive.tsx:925-927` | `archive.tsx:1206`, `1722-1724` | divergent | `ruled: D223` |
| AR115 | `People` tab CONDITION — demo `run.members.length > 0`; rebuild `sections?.people.state === "present"` (a record with no frozen sections shows no tab at all) | `DemoArchive.tsx:928-932` | `archive.tsx:1213-1215` | divergent | `ruled: D223` |
| AR116 | `Evidence` tab count — demo `run.evidence.length`; rebuild `artifactIds + checkpointNodeIds + writeIntentIds` | `DemoArchive.tsx:933-935` | `archive.tsx:1131-1133`, `1216` | divergent | `ruled: D179` (evidence is pointers of three kinds, not a capture list) |
| AR117 | Summary `ChipRow` `version` chip — demo `archivedVersionTag(run)` (`v3.1`), rebuild `v{descriptorVersion}` (`v1`) | `DemoArchive.tsx:942` | `archive.tsx:1225` | divergent | `unserved: no minor descriptor version exists in this tree` (see AR66) |
| AR118 | Summary `app` chip — demo a plain `Chip label="app"`; rebuild adds `tone="warning"` + `title={reason}` + the literal `unrecorded` on the absent arm | `DemoArchive.tsx:943` | `archive.tsx:1226-1232` | divergent | `ruled: D179` (`appVersion` is read forward and never back-filled) |
| AR119 | Summary `trace` chip | `DemoArchive.tsx:944` | `archive.tsx:1233` | exact | — |
| AR120 | Summary `by` chip — demo `run.requestedBy`, rebuild `row.actorId` | `DemoArchive.tsx:945` | `archive.tsx:1234` | exact | — |
| AR121 | Summary `priority` chip — `Chip label="priority" tone={priority==="bulk"?"neutral":"info"}` | `DemoArchive.tsx:946-948` | `archive.tsx:1308`, `archive-model.ts:72-76` | exact | — |
| AR122 | Summary `preset` chip — `{run.preset && <Chip label="preset">…}` | `DemoArchive.tsx:949` | — | missing | `unserved: no descriptor declares presets; StartPlanRecordSchema / RunEnvelopeSchema carry no preset (docs/findings/queue-rows.md)` |
| AR123 | Summary dry-run chip — `Chip tone="info" icon={<FlaskConical …/>}` with copy `dry run — wrote nothing` | `DemoArchive.tsx:950-954` | `archive.tsx:1309-1314` | exact | — |
| AR124 | Summary test-instance chip — demo `Chip tone="warning" icon={<TriangleAlert/>}` copy `test instance`; rebuild appends ` · ${systems.join(", ")}` | `DemoArchive.tsx:955-959` | `archive.tsx:1236-1240` | divergent | **OPEN — operator call** |
| AR125 | Summary `shape moved · {currentVersionTag}` warning chip, shown when the run ran an older major | `DemoArchive.tsx:960` | `archive.tsx:1241-1244` | divergent | `unserved: no minor version` (condition is otherwise identical) |
| AR126 | Summary `attempt` chip | — | `archive.tsx:1235` | extra | `ruled: D214` (attempt is the run's own identity component; the demo folds it into its attempts list) |
| AR127 | Summary `MetaLine` — demo `[workflowLabel, "code X", "enqueued …", "ended …", "ran …", …instances]`; rebuild `["started …", "ended …" \| reason, "ran …" \| "duration unknown", "archived because …", …instances]` | `DemoArchive.tsx:963-972` | `archive.tsx:1247-1255` | divergent | OPEN — operator call (`workflowLabel` and the code moved to the subtitle at AR96; `enqueued` → `started` and the added drift clause are unruled) |
| AR128 | `BumpRecordCard` / `SweepRecordCard` — missing arm is `Banner tone="warning"`; demo title `Archived by a sweep with no change record`, rebuild `Archived by a sweep this index does not carry` | `DemoArchive.tsx:1313-1318` | `archive.tsx:1031-1039` | divergent | **OPEN — operator call** |
| AR129 | Sweep card header — `SectionLabel "Archived by"` + kind Badge + scope Badge + `${from} → ${to}` right-aligned; an empty source-version list keeps its explicit archived-nothing reason | `DemoArchive.tsx:1323-1330` | `archive.tsx:1092-1121`, `archive-model.ts:137-157` | exact | — |
| AR130 | Sweep card body — demo `record.what` + `record.why` paragraphs; rebuild `sweepNameLabel` paragraph + `<ChangeRecordBody>` | `DemoArchive.tsx:1331-1332` | `archive.tsx:1051-1052` | divergent | `ruled: D223` |
| AR131 | Sweep card `MetaLine` — demo `[at, by, commit, "${n} archived"]`; rebuild `[clock, appliedBy, "plan <hash8>", "app <ver>", "${n} runs archived"]` | `DemoArchive.tsx:1333` | `archive.tsx:1053-1061` | divergent | `ruled: D179` |
| AR132 | Failure `Card tone="danger"` + `SectionLabel "Failure record"` | `DemoArchive.tsx:977-979` | `archive.tsx:1260-1262` | exact | — |
| AR133 | Failure body — demo four parts (`headline` p, `Well` titled `What this run left behind` holding `writeState`, `MetaLine [classification]`, `cause` p); rebuild the shared `<FailureDetailBody>` from `trust.tsx` | `DemoArchive.tsx:980-986` | `archive.tsx:1263` | divergent | OPEN — operator call (one rendering path with the live panel is defensible, but the demo's four named parts — especially the `What this run left behind` Well — are not reproduced) |
| AR134 | Receipt `SectionLabel "Receipt — stored, not re-derived"` | `DemoArchive.tsx:994` | `archive.tsx:1271` | exact | — |
| AR135 | Receipt confidence `Badge` tone map `verified→success / partial→warning / else neutral`, `className="ml-auto"` | `DemoArchive.tsx:995-1000` | `archive.tsx:1272-1281` | exact | — |
| AR136 | Receipt `headline` paragraph (`dsText.ui text-[color:var(--ds-fg)]`) | `DemoArchive.tsx:1002` | — | missing | `unserved: RunEvidenceReceiptSchema has no headline field` |
| AR137 | Receipt lines `Table label="Archived receipt lines"` — three columns: `label` (`w-[180px]` fg-muted), `value` (numeric), and a `w-[90px]` right cell reading `read back` (success-fg micro) or `—` (fg-faint micro) | `DemoArchive.tsx:1003-1019` | `archive.tsx:1297` (`ReceiptEvidenceBody`, `trust.tsx:207-252`) | divergent | `unserved: RunEvidenceReceiptSchema has no {label, value, verified} lines array` — it serves `input` / `observations` / `decisions` / `actions` / `verification` sections instead |
| AR138 | Receipt `MetaLine ["receipt <hash8>", result, "generated <clock>"]` | — | `archive.tsx:1285-1291` | extra | `ruled: D199` (a receipt is stamped with facts about itself) |
| AR139 | Receipt absent arm — a `Well` printing the server's reason | — | `archive.tsx:1300-1302` | extra | `ruled: D187` (a record-less node yields `unknown`; an underivable receipt names itself) |
| AR140 | Step-timeline `SectionLabel "Step timeline"` | `DemoArchive.tsx:1025` | `archive.tsx:1309` | exact | — |
| AR141 | Step-timeline BODY — demo a hand-rolled `<ul>`: `size-2` dot tinted by `--ds-status-{verified,failed,cancelled}-mark` / `--ds-fg-faint`, label (truncate), the state WORD, duration in a `w-[70px]` right cell or `—`; rebuild `<TimelineSteps steps variant="full" label="Archived run timeline"/>` | `DemoArchive.tsx:1026-1049` | `archive.tsx:1310-1312` | divergent | OPEN — operator call (both trees ship `TimelineSteps`; the demo deliberately does NOT use it here, and the state word + `cancelled` dot colour have no counterpart in the DS step vocabulary, which is `done/failed/skipped/current/pending`) |
| AR142 | Empty-steps sentence `This run recorded no steps.` | — | `archive.tsx:1311` | extra | **OPEN — operator call** |
| AR143 | Two-up grid `grid-cols-1 gap-[var(--ds-space-base)] min-[900px]:grid-cols-2` under the timeline | `DemoArchive.tsx:1053` | `archive.tsx:1316` | exact | — |
| AR144 | `SectionLabel "Immutable input — what a relaunch replays"` | `DemoArchive.tsx:1056` | `archive.tsx:1319` | exact | — |
| AR145 | Immutable-input CONTENT — demo a `label` (`w-[110px]` meta fg-muted) / `value` (body nums truncate) row per input item; rebuild a `Well` sentence saying the submission is held in authority and never served | `DemoArchive.tsx:1057-1062` | `archive.tsx:1327-1333` | divergent | `ruled: D179` (the stored raw submission is deliberately absent from the wire — `src/domain/dashboard/archive.ts:11-15` — because a relaunch replans it server-side) |
| AR146 | `SectionLabel "Attempts"` | `DemoArchive.tsx:1068` | `archive.tsx:1386` | exact | — |
| AR147 | Attempts CONTENT — demo a per-attempt block (`#ordinal` nums, `StatusPill hideIcon`, `traceId`, `at` micro `ml-auto`, then a `note` line); rebuild a `Table label="What each attempt of this run did"` with `Attempt` / `Steps` / `Ran` columns and a `#N` + step count + outcome mix + instant range | `DemoArchive.tsx:1069-1083` | `archive.tsx:1388-1401`, `1769-1802` | divergent | `ruled: D223 as-built` ("there is deliberately no per-attempt trace id and no per-attempt status pill — it would have to be invented from the span mix") |
| AR148 | Attempts card position — demo is the RIGHT half of the two-up grid beside Immutable input; rebuild is a full-width card BELOW the grid, with `Decision` taking the right half | `DemoArchive.tsx:1066-1085` | `archive.tsx:1384-1410` | divergent | **OPEN — operator call** |
| AR149 | `Decisions` card — demo `SectionLabel "Decisions"` + a block per decision (`Badge tone="neutral"` with `decision.kind`, `at · by` micro right-aligned, `question` body fg, `answer` body fg-muted), rendered only when `decisions.length > 0` | `DemoArchive.tsx:1088-1106` | `archive.tsx:1339-1372` | divergent | `unserved: RunDetailWire.gate is ONE gate, not a decisions[] array` — the rebuild renders a singular `SectionLabel "Decision"` with resolution Badge, label, `by <resolvedBy>` and `open`/absent arms |
| AR150 | Decision card `MetaLine ["N attempts", "N data facts", "N evidence facts"]` | — | `archive.tsx:1366-1372` | extra | **OPEN — operator call** |
| AR151 | `SectionLabel "Write ledger — never archived"` | `DemoArchive.tsx:1110` | `archive.tsx:1414` | exact | — |
| AR152 | Empty-ledger `Well` copy — demo `This run filed nothing, so it has no ledger entry. An absent entry is itself the answer to "did this write?".` vs rebuild `… no ledger line. An absent line is itself the answer …` | `DemoArchive.tsx:1113-1115` | `archive.tsx:1417-1419` | divergent | OPEN — operator call (two words: `entry` → `line`) |
| AR153 | Ledger `Table label` — demo `Ledger entries filed by this run` vs rebuild `Ledger lines this run filed` | `DemoArchive.tsx:1119` | `archive.tsx:1430` | divergent | **OPEN — operator call** |
| AR154 | Ledger `TH`s `System` / `Action` / `Confirmation` / `Instance` — rebuild adds `align="right"` to `Instance` | `DemoArchive.tsx:1121-1126` | `archive.tsx:1432-1437` | divergent | **OPEN — operator call** |
| AR155 | Ledger row cells — demo `system`, `action`, `confirmation` (numeric), `<Chip tone={test?"warning":"neutral"}>{instance}</Chip>`; rebuild `system` (title = pointer + idempotency key), `action` or `—` with the server's reason on hover, `confirmation` or `—` with reason, and `<Badge tone="warning">test</Badge>` / plain muted `prod` | `DemoArchive.tsx:1129-1138` | `archive.tsx:997-1020` | divergent | `ruled: D223 as-built` (`LEDGER_PRESENTATION_DECLARATIONS`; two of three contracts declare their confirmation ABSENT with a reason) |
| AR156 | Unresolved-pointer ledger row (struck-through system, `colSpan={3}` naming the failure) | — | `archive.tsx:987-995` | extra | `ruled: D223 as-built` (a pointer that resolved to nothing is still a ROW — the list of what a run filed must never be silently short) |
| AR157 | `SectionLabel "Snapshot provenance & retention"` | `DemoArchive.tsx:1149` | `archive.tsx:1452` | exact | — |
| AR158 | Provenance `MetaLine` — demo `["archived by X", "schema Y", snapshotHash, "integrity verified Z"]`; rebuild `["archived by X", "schema generation N", "integrity <hash8>", "ran under <hash8>"]` | `DemoArchive.tsx:1150-1157` | `archive.tsx:1453-1460` | divergent | `ruled: D223 as-built` (archive schema GENERATION is the version that moved; `archiveFingerprint` is the content digest) |
| AR159 | Provenance `BulletList` — demo `["Row — <purgeAt>.", "Evidence images — <purgeAt> (N of M still retained).", policy]`; rebuild two prose bullets about self-containment and SQL insert-only | `DemoArchive.tsx:1158-1164` | `archive.tsx:1461-1466` | divergent | `ruled: ref dashboard-surfaces §10.4` (per-record purge dates are computed server-side and rendered by `RetentionLines`) |
| AR160 | `RetentionLines` `<dl>` — five rows (`this archived row`, `its log lines and timeline`, `its captures and checkpoints`, `what it filed`, `evidence pointers`) with four outlook arms and `basis` on hover | — | `archive.tsx:942-968` | extra | `ruled: ref dashboard-surfaces §10.4` |
| AR161 | `Relaunched as` card listing every fresh run this record was relaunched into | — | `archive.tsx:1471-1488` | extra | `ruled: D179` (`archive_relaunches`, keyed by the FRESH run) |
| AR162 | Logs `TabPanel` class — demo `p-[var(--ds-space-cozy)]`; rebuild `flex min-h-0 flex-col gap-[var(--ds-space-base)] p-[var(--ds-space-cozy)]` | `DemoArchive.tsx:1169` | `archive.tsx:1491` | divergent | **OPEN — operator call** |
| AR163 | Log LINE shape — demo `<ul>` rows: `at` (`w-[76px]` nums fg-faint), level word (`w-[46px]` `dsText.caps` tinted by `LOG_LEVEL_CLASS`), text (`flex-1 break-words`), optional `system` in caps; rebuild a `Card` of baseline rows: `fmtClock(at)`, `<Badge tone>` for the level, message | `DemoArchive.tsx:1170-1186` | `archive.tsx:1500-1514` | divergent | **OPEN — operator call** |
| AR164 | Log LEVEL vocabulary — demo five (`info`/`warn`/`error`/`read`/`write`, with `--ds-read-fg` / `--ds-write-fg`); rebuild three (`info`/`warning`/`error`) | `DemoArchive.tsx:1298-1304` | `archive.tsx:1712-1716` | divergent | `unserved: the frozen notes stream's level enum is info \| warning \| error — there is no read/write log level` |
| AR165 | Per-line `system` token in `dsText.caps` at the row's right edge | `DemoArchive.tsx:1181-1183` | — | missing | `unserved: the frozen note row carries noteId / at / level / message only` |
| AR166 | Empty-logs `EmptyState` (`Info` lg, `This run wrote no log line`, "…the note stream was frozen at archive time and it was empty…") | — | `archive.tsx:1494-1498` | extra | `ruled: D223` (an empty tab is the one thing that reads as "the surface is broken") |
| AR167 | `FrozenSection` `Refusal` for a pre-generation-2 record (`title` `This record's <what> were never frozen`, `code="archive-sections-absent"`, outcome sentence) | — | `archive.tsx:1735-1767` | extra | `ruled: D223` (read-forward per D133) |
| AR168 | Data-point DIRECTION arrows — `ArrowDownToLine` tinted `--ds-read-fg` for a read, `ArrowUpFromLine` tinted `--ds-write-fg` for a write | `DemoArchive.tsx:1197-1201` | — | missing | `unserved: the frozen data entry carries label / valueRedacted / observedAt / source / correctedAt — no direction field` (cf. D252, which derived direction from the task contract's `effect` on the Context rail) |
| AR169 | Data-point layout — demo a stacked `<li>` (field row, then the value on its own `break-words` line, then the corrected line); rebuild a three-column `Table` `Field` / `Value` / `Observed` | `DemoArchive.tsx:1190-1222` | `archive.tsx:1530-1564` | divergent | **OPEN — operator call** |
| AR170 | `corrected` Badge — demo `Badge tone="warning"` with `title={`The machine read "${correctedFrom}". It is kept beside the value.`}`; rebuild the same badge with NO title | `DemoArchive.tsx:1203-1207` | `archive.tsx:1544-1546` | divergent | `unserved: the frozen data entry carries correctedAt only — no correctedFrom / correctedBy` |
| AR171 | `read as <correctedFrom> · corrected by <correctedBy>` line under a corrected value | `DemoArchive.tsx:1216-1220` | — | missing | `unserved: no correctedFrom / correctedBy on the frozen data entry` |
| AR172 | Per-point `system` in caps + `at` micro right-aligned; rebuild folds `source` into the `Observed` cell as ` · ${source}` | `DemoArchive.tsx:1208-1213` | `archive.tsx:1556-1559` | divergent | **OPEN — operator call** |
| AR173 | Empty-data `EmptyState` (`This run recorded no display-safe data point`) | — | `archive.tsx:1522-1526` | extra | `ruled: D223` |
| AR174 | People `Table label` — demo `People this run covered` vs rebuild `Member runs this run fanned out` | `DemoArchive.tsx:1228` | `archive.tsx:1575` | divergent | **OPEN — operator call** |
| AR175 | People columns — demo `Name` / `EID` / `Outcome` / `Detail`; rebuild `Member` / `Outcome` (align right) | `DemoArchive.tsx:1230-1235` | `archive.tsx:1577-1580` | divergent | `unserved: memberEid, member outcome word, member detail — the frozen people row carries runId / label / status only (docs/findings/queue-rows.md "Member identity, group nouns and the rejected count")` |
| AR176 | Member OUTCOME rendering — demo `Badge` toned `danger`/`warning`/`neutral` from `member.tone`, carrying the workflow's own outcome WORD; rebuild `StatusPill` off the member run's queue status | `DemoArchive.tsx:1242-1246` | `archive.tsx:1593` | divergent | `unserved: no member outcome word / tone on the frozen people row` |
| AR177 | Member `runId` printed under the label in `dsText.meta dsText.nums` | — | `archive.tsx:1588-1590` | extra | **OPEN — operator call** |
| AR178 | People-tab footer sentence (`Frozen at archive time. Each member run was archived by the same sweep …`) | — | `archive.tsx:1600-1603` | extra | **OPEN — operator call** |
| AR179 | Evidence `TabPanel` `flex flex-col gap-[var(--ds-space-base)] p-[var(--ds-space-cozy)]` | `DemoArchive.tsx:1255` | `archive.tsx:1607` | exact | — |
| AR180 | Evidence empty state — icon `Camera` lg + title `No evidence was captured` | `DemoArchive.tsx:1257-1259` | `archive.tsx:1609-1611` | exact | — |
| AR181 | Evidence empty DESCRIPTION — demo `This run filed no capture. There is nothing to purge and nothing to open.` vs rebuild `This run archived no artifact, checkpoint or write intent. There is nothing to point at.` | `DemoArchive.tsx:1260` | `archive.tsx:1612` | divergent | `ruled: D179` (evidence is three classes of pointer, not a capture list) |
| AR182 | Capture tile THUMBNAIL — demo `h-[var(--ds-h-evidence-thumb)]` at the capture's real `aspectRatio`, `bg-[var(--ds-surface-1)]`, `rounded-[var(--ds-radius-sm)]`, `Camera` at `dsIcon.md`; rebuild a `w-[96px]` box, `bg-[color:var(--ds-bg-inset)]`, `border-[color:var(--ds-border)]`, aspect from `tile.dimensions` else `4 / 3` | `DemoArchive.tsx:1348-1357` | `archive.tsx:1813-1827` | divergent | OPEN — operator call (fixed HEIGHT vs fixed WIDTH is the whole point of the demo's "a portrait page and a landscape viewport read as different things") |
| AR183 | Purged thumbnail arm — `border-dashed border-[color:var(--ds-border-strong)]` | `DemoArchive.tsx:1353` | — | missing | `unserved: the frozen capture tile carries a DECLARED retention (pinned \| purgeAfter), never an observation of whether the bytes are still there (D223 as-built)` |
| AR184 | Capture kind `Badge` tone — demo `error→danger / confirmation→success / else neutral`; rebuild `origin === "operator-request" ? neutral : danger` | `DemoArchive.tsx:1358` | `archive.tsx:1830` | divergent | **OPEN — operator call** |
| AR185 | Capture label + `MetaLine [step, SYSTEM.toUpperCase(), fmtClock(capturedAt), ref]` | `DemoArchive.tsx:1359-1362` | `archive.tsx:1831-1846` | divergent | `ruled: D223 as-built` (rebuild prints `step.nodeId` or `step unrecorded`, a `system` Chip, then `[clock, origin, "N KB", sensitivity, retention]`) |
| AR186 | Purged evidence arm — `ImageOff` at `dsIcon.sm` beside `item.retentionAt`, in `dsText.meta text-[color:var(--ds-fg-muted)]` | `DemoArchive.tsx:1365-1369` | — | missing | `unserved: declared retention only, never an observed purge (see AR183)` |
| AR187 | Retained evidence arm — bare `item.retentionAt` in `dsText.meta` at the tile's right edge | `DemoArchive.tsx:1371` | `archive.tsx:1842-1844` | divergent | OPEN — operator call (rebuild folds it into the `MetaLine` as `pinned (reason)` / `purge after <day>`) |
| AR188 | Tile ACTION button — `Button size="sm" variant={purged?"outline":"secondary"}` + `Camera` at `dsIcon.md`, labelled `Open` or `What it was`; the tile is inert in the rebuild | `DemoArchive.tsx:1373-1375` | — | missing | OPEN — operator call (a "what it was" viewer needs no bytes, so D179's pointers-only rule does not decide this) |
| AR189 | `CaptureLightbox` mounted off `openCapture`, fed `run.evidence.map(archivedCapture)` with `subject={{label, trace}}` and prev/next `onIndex` | `DemoArchive.tsx:1285-1293` | — | missing | OPEN — operator call (no capture on this surface can be opened at all) |
| AR190 | `archivedCapture` purged NOTE (`The image itself is gone — <when>. The pointer is kept so the record still names what was captured.`) | `demo-archive-wire.ts:1679-1682` | — | missing | OPEN — operator call (consequence of AR189) |
| AR191 | `Captures` `Card` with a `SectionLabel` + right-aligned `CountBadge` wrapping the tiles | — | `archive.tsx:1626-1636` | extra | `ruled: D223 as-built` |
| AR192 | `EvidencePointerGroup` for `Checkpoints` and `Write intents` (bare id `Chip`s, warning tone for intents) | — | `archive.tsx:1644-1645`, `1679-1708` | extra | `ruled: D179` (evidence is pointers) |
| AR193 | Evidence-tab footnote `The write ledger is never archived. What was filed in a real system stays where it was filed.` | — | `archive.tsx:1646-1648` | extra | `ruled: ref dashboard-surfaces §9.5.1 rule 1` |
| AR194 | `PanelFooter` read-only sentence `Read-only. There is no retry, cancel or edit here — the code this run executed is not the code that is loaded.` in `dsText.meta max-w-[80ch] text-[color:var(--ds-fg-muted)]` | `DemoArchive.tsx:1271-1273` | `archive.tsx:1655-1657` | exact | — |
| AR195 | Footer relaunch `Button className="ml-auto" variant="primary" size="sm"` + `RotateCw` at `dsIcon.md`, label `Relaunch on {versionTag}…` | `DemoArchive.tsx:1274-1282` | `archive.tsx:1658-1668` | divergent | `unserved: no minor version` (label reads `Relaunch on v1…`); rebuild also adds `loading={busy}` |
| AR196 | Relaunch-unavailable arm — a right-aligned `text-[color:var(--ds-status-waiting-fg)]` sentence in place of the button | — | `archive.tsx:1669-1673` | extra | `ruled: D179` (an archived workflow whose descriptor was retired cannot be relaunched, and the surface says so rather than offering a button that fails) |
| AR197 | Relaunch confirm `Dialog open={run !== null} onOpenChange` wrapper + `DialogContent size="lg"` | `DemoArchive.tsx:1395-1397`, `1412` | `archive.tsx:2028-2031` | exact | — |
| AR198 | Dialog TITLE — demo `Relaunch ${displayName ?? title} on ${versionTag}?` (`v3.1`); rebuild `Relaunch ${header.title} on v${N}?` (`v1`), and it reads `header.title` rather than `row.displayName ?? title` | `DemoArchive.tsx:1414` | `archive.tsx:2033` | divergent | `unserved: WorkflowVersionIdentity.descriptorVersion is a single positive int — no minor half exists on any wire` |
| AR199 | Dialog DESCRIPTION `A fresh ${workflowLabel} run from the archived input — never a resume of ${traceId}.` | `DemoArchive.tsx:1415` | `archive.tsx:2034` | exact | — |
| AR200 | Already-filed banner CONDITION — demo `plan.alreadyFiled.length > 0` (the ledger alone); rebuild `writeIntentIds.length > 0 \|\| ledger.length > 0` | `DemoArchive.tsx:1418` | `archive.tsx:2037` | divergent | `ruled: D179` (an unresolved write intent is exactly the possible-submit the refusal exists over) |
| AR201 | Already-filed banner `tone="danger"`, title `This run already filed ${plural(n, "record")} in a real system`, `icon={<TriangleAlert … dsIcon.lg/>}` | `DemoArchive.tsx:1419-1422` | `archive.tsx:2038-2041` | exact | — |
| AR202 | Banner sentence `A relaunch does not know about them. If the work still stands, this files it a second time.` | `DemoArchive.tsx:1425-1427` | `archive.tsx:2044-2046` | exact | — |
| AR203 | Banner `Well` list ROWS — demo `[system caps w-[80px]] [action truncate] [confirmation nums]`; rebuild `[system caps w-[80px]] [idempotencyKey \| "ledger <date> — <failure>"] [line <sequence>]` | `DemoArchive.tsx:1429-1437` | `archive.tsx:2056-2076` | divergent | `ruled: D223 as-built` (the same resolved rows the Write-ledger card renders, so banner and tab cannot name different transactions) |
| AR204 | Write-intent rows appended to the same `Well` list | — | `archive.tsx:2077-2089` | extra | `ruled: D179` |
| AR205 | `Field label="What this would create"` wrapping a `Well` | `DemoArchive.tsx:1443-1444` | `archive.tsx:2096-2097` | exact | — |
| AR206 | `BadgeCheck` at `dsIcon.md` + `1 ${workflowLabel} run on ${versionTag}` in `dsText.ui` | `DemoArchive.tsx:1447-1450` | `archive.tsx:2100-2103` | divergent | `unserved: no minor version` |
| AR207 | Right-aligned `Badge tone="neutral"` — demo `lands in {panel}` (the workflow's own panel) vs rebuild the fixed `lands in the queue` | `DemoArchive.tsx:1451-1453` | `archive.tsx:2104` | divergent | **OPEN — operator call** |
| AR208 | Preview `MetaLine` — demo `["trace id assigned at enqueue", "archived run ran ${archivedVersionTag}", "drives ${systems.join(", ")}"]`; rebuild `["trace id assigned at enqueue", "archived run ran v${N}", "on ${shortHash(contractFingerprint)}"]` | `DemoArchive.tsx:1455-1461` | `archive.tsx:2106-2112` | divergent | `unserved: the archived detail carries no systems[] list for the CURRENT descriptor` (item 1 is exact; item 2 is the version-format gap) |
| AR209 | `Field label` — demo `Input it replays — unchanged from the archive` vs rebuild `Input it replays` | `DemoArchive.tsx:1466` | `archive.tsx:2117` | divergent | `ruled: D179` (a relaunch replans the RAW submission through today's schemas, so "unchanged" would be false) |
| AR210 | Replayed-input LIST (`label` `w-[110px]` / `value` truncate, one `<li>` per item) | `DemoArchive.tsx:1468-1475` | `archive.tsx:2118-2124` | divergent | `ruled: D179` (the stored input is deliberately absent from the wire; the rebuild renders a `Well` sentence in its place) |
| AR211 | `SectionLabel "Decide these, rather than discover them"` — demo renders it only when `plan.cautions.length > 0`; rebuild always | `DemoArchive.tsx:1479-1484` | `archive.tsx:2127-2135` | divergent | **OPEN — operator call** |
| AR212 | Caution sentences — dry-run and test-instance warnings derive from the frozen row before the two fixed archive/relaunch cautions; no member-completion sentence is guessed | `demo-archive-wire.ts:1918-1928` | `archive.tsx:2109,2213`, `archive-model.ts:165-181` | divergent | unserved: archived detail carries no frozen member-completion vector; served dry-run/test arms ported in `d1f87916` |
| AR213 | `DialogFooter meta={`Archived run ${traceId} stays exactly as it ended.`}` | `DemoArchive.tsx:1487` | `archive.tsx:2138` | exact | — |
| AR214 | Footer `Cancel` — `Button variant="secondary"` | `DemoArchive.tsx:1488-1490` | `archive.tsx:2139` | exact | — |
| AR215 | Footer confirm — `Button variant="primary"` + `RotateCw` at `dsIcon.md` + label `Enqueue a new run` | `DemoArchive.tsx:1491-1493` | `archive.tsx:2140-2142` | exact | — |
| AR216 | Versions view shell `div.flex.min-h-0.flex-1.flex-col.p-[var(--ds-space-cozy)]` > `Panel className="min-h-0 flex-1"` | `DemoArchive.tsx:1509-1510` | `archive.tsx:2312-2313` | exact | — |
| AR217 | Versions `PanelHeader title="Versions & bumps"` + `icon={<BadgeCheck … dsIcon.lg/>}` + `meta={`app ${appVersion}`}` | `DemoArchive.tsx:1511-1516` | `archive.tsx:2314-2319` | exact | — |
| AR218 | Versions SUBTITLE — demo `Every workflow's current descriptor version, the runs stamped with it, and the two bump arms.` vs rebuild `… and what a bump would move.` | `DemoArchive.tsx:1513` | `archive.tsx:2316` | divergent | OPEN — operator call (the "two bump arms" no longer exist as a surface concept — see AR221) |
| AR219 | Versions banner `tone={blocked>0?"warning":"info"}` + `className="m-[var(--ds-space-cozy)]"` | `DemoArchive.tsx:1518-1525` | `archive.tsx:2321-2328` | exact | — |
| AR220 | Banner title, blocked arm — demo `${plural(n,"workflow")} ${has/have} runs that are not terminal — a MAJOR bump on those is refused` vs rebuild the same sentence with `MAJOR` dropped | `DemoArchive.tsx:1522` | `archive.tsx:2325` | divergent | **OPEN — operator call** |
| AR221 | Banner title, clear arm — demo `Every listed run is terminal — a major bump can proceed anywhere` vs rebuild `Every prior-version run is terminal — a bump can proceed anywhere` | `DemoArchive.tsx:1523` | `archive.tsx:2326` | divergent | **OPEN — operator call** |
| AR222 | Banner action `Button size="sm" variant="secondary"` labelled `Dashboard update…` | `DemoArchive.tsx:1527-1529` | `archive.tsx:2330-2332` | exact | — |
| AR223 | Banner BODY — demo describes BOTH arms (`A **major** bump moves every prior-version run … A **minor** bump is presentation only: nothing archives, so nothing can block it.`); rebuild describes one bump kind plus what a dashboard update does | `DemoArchive.tsx:1532-1534` | `archive.tsx:2335-2340` | divergent | OPEN — operator call (`changeRecord.kind` exists as a RECORD but no arm of the bump command behaves differently, so the demo's minor/no-archive promise has no counterpart) |
| AR224 | Registry `Table label="Workflow version registry"` | `DemoArchive.tsx:1536` | `archive.tsx:2351` | exact | — |
| AR225 | Registry table wrapped in `div.overflow-x-auto` | — | `archive.tsx:2350` | extra | **OPEN — operator call** |
| AR226 | Registry COLUMNS — demo seven (`Workflow`, `Version`, `At current`, `Older major`, `Not terminal`, `Archived`, `Bump`); rebuild six (`Workflow`, `Version`, `Archivable`, `Not terminal`, `Archived`, `Bump`) | `DemoArchive.tsx:1538-1546` | `archive.tsx:2353-2360` | divergent | `unserved: WorkflowVersionStateWire has no at-current-version count` (the column that vanished; see AR227) |
| AR227 | `At current` column (`atCurrentVersion`) | `DemoArchive.tsx:1541`, `1560-1562` | — | missing | `unserved: WorkflowVersionStateWire carries archivable + blockers only — no at-current-version count` |
| AR228 | `Older major` column (`atPriorVersion`, tinted `--ds-status-waiting-fg` when > 0) → rebuild `Archivable` (terminal prior-version runs, untinted) | `DemoArchive.tsx:1542`, `1563-1569` | `archive.tsx:2356`, `2377` | divergent | `ruled: D179` (`archivable` = terminal prior-version runs; the blockers are the other half and get their own column) |
| AR229 | Workflow cell — demo `code` (nums micro fg-muted) + `label` (ui fg); rebuild adds a third token, `shortHash(contractFingerprint)` in nums micro fg-faint | `DemoArchive.tsx:1551-1556` | `archive.tsx:2365-2375` | divergent | **OPEN — operator call** |
| AR230 | `Version` cell — demo `v{currentVersion}` two-part (`v7.2`); rebuild `v{descriptorVersion}` | `DemoArchive.tsx:1557-1559` | `archive.tsx:2376` | divergent | `unserved: no minor version` |
| AR231 | `Not terminal` cell `<CountBadge value tone={n>0?"warning":"neutral"}/>` right-aligned | `DemoArchive.tsx:1570-1572` | `archive.tsx:2378-2380` | exact | — |
| AR232 | `Archived` count cell, right-aligned numeric | `DemoArchive.tsx:1573-1575` | `archive.tsx:2381` | exact | — |
| AR233 | `Bump…` cell `Button size="sm" variant="outline"` | `DemoArchive.tsx:1576-1580` | `archive.tsx:2382-2386` | exact | — |
| AR234 | `Change records` section — `SectionLabel "Change records"` + one `Card` per record: kind Badge, scope Badge, `${from} → ${to}` nums, `at` meta, right-aligned `${commit} · ${archivedRuns} archived`, then `what` and `why` paragraphs | `DemoArchive.tsx:1586-1609` | — | missing | OPEN — operator call (the rebuild replaces it with AR235; the change record itself now exists per D223 and rides `ArchiveSweepWire.changeRecord`, so the demo's card is buildable) |
| AR235 | `Applied bumps` section — `SectionLabel` + one `Card` per sweep (scope Badge, `sweepNameLabel`, clock, right-aligned `<hash8> · N runs archived`, `MetaLine [appliedBy, app, plan]`), plus an empty `Well` reading `No bump has been applied, so nothing has been archived.` | — | `archive.tsx:2456-2487` | extra | `ruled: D179` (sweeps are the durable record; a change record is one field of a sweep, not a separate store) |
| AR236 | Per-workflow blocker tables under the registry (`SectionLabel "{label} — what a bump would refuse to bury"` + `BlockerTable`), rendered only while no plan is open | — | `archive.tsx:2399-2407`, `2188-2217` | extra | `ruled: D179` (`plan` is minted even when blocked, because the list is what the operator needs) |
| AR237 | `Reviewed plan` `Well` — `MetaLine [plan <hash8>, N would be archived, N would block, planned <clock> by <who>]`, two bullets, `Apply the bump` primary, and the `CircleAlert` "This will be refused while those runs are not terminal." note | — | `archive.tsx:2409-2445` | extra | `ruled: D179` (Apply stays clickable while blockers exist; the refusal is the contract) |
| AR238 | `BumpRefusal` — `Refusal title="The bump was refused"` with the server's verbatim message and an enter transition | — | `archive.tsx:2152-2186`, `2454` | extra | `ruled: D179` |
| AR239 | Bump dialog MOUNT — demo mounts `<DemoVersionBumpDialog>` at the PAGE root (sibling of the two views); rebuild mounts `<BumpChangeRecordDialog>` inside `VersionsView`'s `PanelBody`, between the banner and the registry table | `DemoArchive.tsx:395` | `archive.tsx:2343-2348` | divergent | **OPEN — operator call** |
| AR240 | Bump dialog TARGET prop — demo `target: BumpTarget \| null` = `{scope: "workflow" \| "multi-workflow" \| "dashboard", workflowIds}`; rebuild `authoring: BumpAuthoring \| undefined` = `{title, scope: {scope: VersionScope}, changeFingerprint}` | `DemoVersionBump.tsx:68-81` | `archive.tsx:1894-1899`, `1918` | divergent | `ruled: D179` (an `application`-scope plan must name the RUNNING build, and the change fingerprint rides the plan) |
| AR241 | Bump dialog `onOpenArchive` prop — the demo's applied banner offers `Open the archive`, which flips the view back to `runs` | `DemoArchive.tsx:395`, `DemoVersionBump.tsx:117-121` | — | missing | OPEN — operator call (the rebuild's apply re-reads the index in place and never offers the jump) |
| AR242 | Dashboard-update TRIGGER payload — demo `onBump({scope:"dashboard", workflowIds: []})` → dialog title `Dashboard update — ${plural(n,"workflow")}`; rebuild `planApplication()` → `{title: "the whole dashboard (app X)", scope:{kind:"application", applicationVersion}}` → dialog title `Bump the whole dashboard (app X)` | `DemoArchive.tsx:1527` | `archive.tsx:2289-2295`, `1953` | divergent | `ruled: D179` (the running build is read from the served index, never typed) |
| AR243 | Per-workflow TRIGGER payload — demo `onBump({scope:"workflow", workflowIds:[id]})` → title `Bump ${label}`; rebuild `plan(state)` → `{title: workflowLabel, scope:{kind:"workflows", workflowIds:[id]}}` → title `Bump ${workflowLabel}` | `DemoArchive.tsx:1577` | `archive.tsx:2278-2287`, `1953` | exact | — |
| AR244 | `Skeleton className="h-64 w-full"` while the index or a detail is loading | — | `archive.tsx:2632`, `2654` | extra | OPEN — operator call (the demo is a fixture and never loads) |
| AR245 | `Refusal` panes for a failed index read (`The archive could not be read`) and a failed detail read (`That archived run could not be read`), both `code="archive-read-failed"` | — | `archive.tsx:2633-2639`, `2656-2663` | extra | **OPEN — operator call** |
| AR246 | Selection resolves against the VISIBLE list, never the corpus | `DemoArchive.tsx:178-182` | `archive.tsx:760-764` | exact | — |
| AR247 | Section collapse state as a `ReadonlySet` toggled by id | `DemoArchive.tsx:210-217` | `archive.tsx:2604-2611` | exact | — |
| AR248 | Tab resets to `summary` when the selected run changes | `DemoArchive.tsx:860-863` | `archive.tsx:1083` | exact | — |
| AR249 | `openCapture` resets to `null` when the selected run changes | `DemoArchive.tsx:862` | — | missing | OPEN — operator call (consequence of AR189) |
| AR250 | Detail-pane `Nothing selected` `EmptyState` — title + `Pick an archived run on the left to see its stored snapshot.`, inside `Panel > PanelBody` | `DemoArchive.tsx:374-381` | `archive.tsx:2622-2630` | exact | — |

**Counts:** exact 106 · divergent 94 · missing 20 · extra 30 · OPEN 61

> 2026-08-25 | Track F archive UI | `3d461962` served list-row `dryRun` and warning facts;
> `d1f87916` drew those facts plus the already-served archive identity, priority, bump-kind and
> relaunch facts through total view-model folds. AR27, AR62, AR67, AR77, AR78, AR91, AR95, AR96,
> AR105, AR121, AR123, AR129 and AR212 are disposed above; no parity reference was updated.

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
| AC24 | caveat — error rate counts only terminal runs. **Demo says "…waiting on you or parked…"; rebuild now says "…waiting on you or write parked…"** through the shared closed-status vocabulary, while the exact pill label remains **Write parked** (`status-model.ts` → `status-vocabulary.ts`) | `demo-report-wire.ts:268` | `activity.ts:479-483` | divergent | **LANDED `4da19fd7`**; ruled: ref frontend-backend-integration §4 “State ownership” — pure presentation helpers may map closed enums to explanatory copy; the prose fold keeps the established sentence case and the pill's exact parked words |
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

**Counts:** 117 rows — exact 57 · divergent 21 · missing 12 · extra 27 · **OPEN 7** (AC10, AC11,
AC12, AC19, AC62, AC77, AC90)

---

## 3. Workflow Explorer — `DemoExplorer.tsx` + `demo-explorer-wire.ts` ↔ `surfaces/explorer.tsx`

**Demo:** `legacy `rebuild-demo/`DemoExplorer.tsx` (1027) + `demo-explorer-wire.ts` (2006) · **Rebuild:** ``src/dashboard/`surfaces/explorer.tsx` (1595) + `explorer-model.ts` (226)

The three-panel skeleton is a faithful port: identical grid tracks and breakpoints, identical `PageHeader`, identical `DryRunBoundary`, identical `DirHeaderRow`, identical ⓘ trigger/popover geometry, identical no-rehearsal banner sentence. **The biggest structural finding is that the demo's SECOND panel is a run-overlay surface and the rebuild's is a registration surface** — twenty-three separate demo elements (the run `Select` and both of its empty-arms, the run option label, the status pill, the trace `MetaLine`, the `dry run` chip, the version-mismatch banner, the per-node state dot / state word / duration / attempts / value-count / evidence / skip-reason / child note, the recorded value cell and its four chips, the recorded-only row, the provenance meta line, the run title + key lines) are ALL one ruled exclusion, ref operator-trust §5.7, seen from many angles; the toolbar slot they occupied now carries a seven-chip identity band. Second finding: **the demo's contract table is a table of operator-worded FIELDS with the run's value in column 3, and the rebuild's is a table of zod LEAVES with the field's declared provenance in column 3** — ruled D227, but it changes every cell on the page, and it pushed the editable-field pencil out of the table into two chip rows below it (EX110, unruled). Third: **the version tag lost its minor digit** — the demo prints `v1.2` everywhere and the rebuild prints `v1`, because no minor/presentation version exists anywhere in this tree's domain, wire or version-bump scope union; that gap is **not booked** in `docs/findings/explorer.md`, which reports zero open records. Fourth: **the `Version registry` header action opens the Archive's real `Versions & bumps` view** — `4e09fb49` moves the exact `archiveView=versions` state through the dashboard route, so it replaces the Explorer takeover rather than opening a local imitation. Fifth: the port header at `explorer.tsx:8-10` names `skippedAboveBoundary` and `laneOf`'s connector rule as ported, and neither exists in `explorer-model.ts`.

| # | Element | Demo | Rebuild | Verdict | Reason |
|---|---------|------|---------|---------|--------|
| EX1 | Page header title `Explorer` | `DemoExplorer.tsx:167` | `explorer.tsx:1479` | exact | — |
| EX2 | Header icon `<Workflow>` at `dsIcon.lg`, `aria-hidden` | `DemoExplorer.tsx:168` | `explorer.tsx:1480` | exact | — |
| EX3 | Header badge `Badge tone="neutral"` carrying `<Lock dsIcon.sm>` + the word `read-only` | `DemoExplorer.tsx:170-173` | `explorer.tsx:1482-1485` | exact | — |
| EX4 | Back control: `Button variant="ghost" size="sm"` + `<ArrowLeft dsIcon.md>` + copy `Back to the dashboard` | `DemoExplorer.tsx:176-178` | `explorer.tsx:1488-1495` | exact | — |
| EX5 | Header action `Button ghost sm` + `<Eye dsIcon.md>` + copy `Version registry`. It carries the Archive's real `archiveView=versions` route state, which renders `<Table label="Workflow version registry">` | `DemoExplorer.tsx:181-183` | `explorer.tsx` → `dashboard-app.tsx` → `archive.tsx` | exact | **LANDED 2026-08-25 (`4e09fb49`)** — one route-owned door, no local registry copy |
| EX6 | Page root: demo is a bare `div.flex.min-h-0.flex-1.flex-col`; rebuild is a `Panel aria-label="Workflow explorer"` with `useDsEnterTransition` + `ds-motion-enter` + `translate-y-[calc(-1*var(--ds-travel-sm))]` | `DemoExplorer.tsx:165` | `explorer.tsx:1467-1477` | divergent | ruled: dashboard-surfaces §9.5.3 |
| EX7 | Three-panel grid — `grid-cols-1`, `min-[900px]:grid-cols-[minmax(0,232px)_minmax(0,1fr)]`, `min-[1280px]:…_minmax(0,420px)]`, `gap-base p-cozy` | `DemoExplorer.tsx:191` | `explorer.tsx:1502` | exact | — |
| EX8 | Record-column placement between the two thresholds: rebuild wraps `NodeDetail` in `div.min-[900px]:col-span-2.min-[1280px]:col-span-1`; the demo has no wrapper and auto-places it | — | `explorer.tsx:1581-1587` | extra | **OPEN — operator call** |
| EX9 | Loading arm — `Panel` spanning all columns, `Spinner label="Loading the explorer projection"` + copy `Reading the registry…` | — | `explorer.tsx:1503-1512` | extra | ruled: frontend-backend-integration §"Where the frontend keeps its half" (AsyncResource) |
| EX10 | Failed arm — `Banner tone="danger" title="The explorer projection could not be read"` + `error.message` | — | `explorer.tsx:1514-1522` | extra | ruled: frontend-backend-integration §"Where the frontend keeps its half" (AsyncResource) |
| EX11 | Selected workflow: demo holds `useState(EXPLORER_GRAPHS[0].workflowId)`; rebuild takes it from `?explore=<workflowId>` and pushes back through `onWorkflow` | `DemoExplorer.tsx:141` | `explorer.tsx:1413-1421` | divergent | ruled: dashboard-surfaces §9.5.3 "Two keys, not one" |
| EX12 | List panel `PanelHeader title="Workflows"` | `DemoExplorer.tsx:279` | `explorer.tsx:307` | exact | — |
| EX13 | List panel header `meta`: demo has two arms — `${total}` when all drawn, else `${drawn} of ${total} drawn`; rebuild has only `String(workflows.length)`. The second arm is structurally unreachable here (`ExplorerWorkflowWireSchema.nodes` is `.min(1)`, so every served workflow has a graph) | `DemoExplorer.tsx:279` | `explorer.tsx:307` | divergent | **OPEN — operator call** |
| EX14 | Category group wrapper — `border-b border-[color:var(--ds-border-subtle)] last:border-b-0` | `DemoExplorer.tsx:282` | `explorer.tsx:310` | exact | — |
| EX15 | Group heading — `SectionLabel className="block px-cozy py-snug"` | `DemoExplorer.tsx:283-285` | `explorer.tsx:311-313` | exact | — |
| EX16 | Grouping projection is the SAME one the rail reads (`buildWorkflowCategoryGroups` ↔ `groupWorkflowsByCategory`), so the explorer cannot bin a workflow under a heading the product does not use | `DemoExplorer.tsx:274` | `explorer.tsx:248-260` | exact | — |
| EX17 | Row button — `aria-current={active ? "true" : undefined}`, `flex w-full min-w-0 items-center gap-snug px-cozy py-snug text-left`, `dsText.ui dsFocus dsMotion.base`, active `bg-surface-selected font-semibold`, hover `bg-surface-3` | `DemoExplorer.tsx:292-314` | `explorer.tsx:274-288` | exact | — |
| EX18 | Row `disabled={!graph}` + `cursor-default` + `text-fg-faint` for a workflow serving no graph | `DemoExplorer.tsx:294`, `:307`, `:312` | — | missing | **OPEN — operator call** |
| EX19 | Row `title=`: demo `${label} ${fmtVersionTag({major,minor})} — ${plural(n,"node")}` → `Person Lookup v1.0 — 4 nodes`; rebuild `${label} v${version} — ${plural(n,"node")}` → `Person Lookup v1 — 4 nodes` | `DemoExplorer.tsx:299` | `explorer.tsx:278` | divergent | unserved: `ExplorerWorkflowWire.minorVersion` |
| EX20 | Row `title=` second arm — `${label} serves no descriptor graph yet, so there is nothing to draw.` | `DemoExplorer.tsx:300` | — | missing | **OPEN — operator call** |
| EX21 | Row label span — `min-w-0 flex-1` + `dsClip.text` | `DemoExplorer.tsx:315` | `explorer.tsx:291` | exact | — |
| EX22 | Row trailing node count — `dsText.micro dsText.nums shrink-0 text-fg-muted` | `DemoExplorer.tsx:316-325` | `explorer.tsx:298-300` | exact | — |
| EX23 | Row trailing count `—` arm when the workflow serves no graph | `DemoExplorer.tsx:324` | — | missing | **OPEN — operator call** |
| EX24 | Nested `<ul aria-label="Proving harnesses of {label}">` indented `pl-cozy` under a composition | — | `explorer.tsx:322-331` | extra | ruled: D219 |
| EX25 | Harness secondary line inside the button — `a proving harness of {name}` at `dsText.micro` | — | `explorer.tsx:292-296` | extra | ruled: D219 |
| EX26 | List `Panel aria-label="Registered workflows"` | — | `explorer.tsx:306` | extra | **OPEN — operator call** |
| EX27 | The two-character workflow codes are deliberately ABSENT from the list row in both, for the same recorded reason (they are the trace id's first component) | `DemoExplorer.tsx:261-266` | `explorer.tsx:233-237` | exact | — |
| EX28 | Graph panel header title — demo `${graph.label} ${fmtVersionTag({major,minor})}` (`Person Lookup v1.0`); rebuild `${workflow.label} v${version}` (`Person Lookup v1`) | `DemoExplorer.tsx:386` | `explorer.tsx:592` | divergent | unserved: `ExplorerWorkflowWire.minorVersion` |
| EX29 | Header meta segment `plural(nodes,"node")` | `DemoExplorer.tsx:388` | `explorer.tsx:594` | exact | — |
| EX30 | Header meta segment `plural(reads,"read")` — demo counts contract ROWS (`contractTotals`), rebuild counts a read arm's zod OUTPUT LEAVES (`explorerGraphTotals`), so the same graph reports a different number | `demo-explorer-wire.ts:226-238` | `explorer-model.ts:56-70` | divergent | ruled: D227 |
| EX31 | Header meta segment `plural(writes,"write")`, emitted only when `> 0` — demo counts write-direction contract rows on non-`output` nodes, rebuild counts a commit arm's zod INPUT leaves and deliberately skips the prepare arm's | `DemoExplorer.tsx:390` | `explorer.tsx:596` | divergent | ruled: D227 |
| EX32 | Header meta segment `plural(files,"file")` for rows landing on disk rather than in a system of record | `DemoExplorer.tsx:391` | — | missing | ruled: operator-trust §5.7 (per-run artifact fact, not a registry one) |
| EX33 | Header `actions` = the graph ⓘ | `DemoExplorer.tsx:395` | `explorer.tsx:600` | exact | — |
| EX34 | The `PanelToolbar` band under the graph header exists in both, in the same slot, one row high | `DemoExplorer.tsx:398` | `explorer.tsx:359-382` | exact | — |
| EX35 | Toolbar `label`: demo `Lay a run over the graph`; rebuild `${workflow.label} identity` | `DemoExplorer.tsx:398` | `explorer.tsx:360` | divergent | ruled: operator-trust §5.7 (live-run overlay excluded) |
| EX36 | Toolbar leading word `Run` at `dsText.meta shrink-0 text-fg-muted` | `DemoExplorer.tsx:399` | — | missing | ruled: operator-trust §5.7 |
| EX37 | Run `Select` in a `w-[36ch] shrink-0` wrapper, `aria-label="Run to lay over the graph"`, `disabled` when the corpus is empty | `DemoExplorer.tsx:404-425` | — | missing | ruled: operator-trust §5.7 |
| EX38 | Option `Descriptor only — no run` | `DemoExplorer.tsx:416` | — | missing | ruled: operator-trust §5.7 |
| EX39 | Option `No run in the corpus` (the empty-corpus arm) | `DemoExplorer.tsx:413` | — | missing | ruled: operator-trust §5.7 |
| EX40 | Run option label `${name} · ${dsStatusText(status)} · ${reached}/${total} · ${h:mm AM}` | `DemoExplorer.tsx:505-510` | — | missing | ruled: operator-trust §5.7 |
| EX41 | Run option `off this shape` coverage arm (keyed on `matched`, not `reached`) | `DemoExplorer.tsx:508` | — | missing | ruled: operator-trust §5.7 |
| EX42 | `StatusPill status={effectiveStatus(run)} size="sm"` beside the select | `DemoExplorer.tsx:428` | — | missing | ruled: operator-trust §5.7 |
| EX43 | `MetaLine className="min-w-0 shrink truncate" items={[overlay.traceId]}` | `DemoExplorer.tsx:433` | — | missing | ruled: operator-trust §5.7 |
| EX44 | `Chip tone="info"` reading `dry run` when the overlaid run was a rehearsal | `DemoExplorer.tsx:434` | — | missing | ruled: operator-trust §5.7 |
| EX45 | Identity band in that slot — seven chip kinds: `code` · `category` · `version` · `shape` · `enqueue` · `subject` (`fixed` value, else `derived from input`) · one `system` chip per system, `tone="info"` | — | `explorer.tsx:357-384` | extra | ruled: operator-trust §5.7 (2026-08-14 presentation as-built delta) |
| EX46 | Identity band WRAPS (`flex-wrap gap-y-tight py-snug`, every chip `shrink-0`) instead of taking `PanelToolbar`'s default scrolling row | — | `explorer.tsx:369` | extra | ruled: dashboard-surfaces §9.5.3 as-built notes |
| EX47 | `no-rehearsal` hazard `Banner tone="warning"` — copy `{label} writes to {systems} and honours no dry run — there is no rehearsal of this workflow.` | `DemoExplorer.tsx:442-447` | `explorer.tsx:608-613` | exact | — |
| EX48 | `no-system-write` fact chips — `Chip label="changes"` → `no system of record`, `Chip label="dry run"` → `nothing to stop short of` | `DemoExplorer.tsx:452-457` | `explorer.tsx:618-623` | exact | — |
| EX49 | Version-mismatch `Banner tone="warning"` — `This run ran under {v}; the graph is {v} — nodes that do not line up are the version difference, not a missing step.` | `DemoExplorer.tsx:459-464` | — | missing | ruled: operator-trust §5.7 |
| EX50 | `LaneDivider` — `SectionLabel` + `h-px flex-1 bg-border-subtle`, `pt-loose` except on the first | `DemoExplorer.tsx:519-531` | — | missing | ruled: operator-trust §5.7 (no lane fact exists on the descriptor) |
| EX51 | `DryRunBoundary` — two dashed `border-danger-border` rules flanking `<ShieldAlert dsIcon.sm>` + `dsText.caps` copy `a dry run stops here`, `my-snug gap-snug` | `DemoExplorer.tsx:533-544` | `explorer.tsx:435-446` | exact | — |
| EX52 | Where the boundary is drawn: demo reads the authored `graph.dryRunBoundaryNodeId`; rebuild derives it as the FIRST `transaction` node and only when every transaction declares `stop-after-prepare` | `demo-explorer-wire.ts:153` | `explorer-model.ts:120-124` | divergent | ruled: workflow-model §1.1 (`dryRun: "stop-after-prepare" \| "unsupported"`) |
| EX53 | `Connector` geometry — `ml-[18px] flex flex-col gap-hair border-l border-border-strong py-tight pl-cozy` | `DemoExplorer.tsx:549` | `explorer.tsx:457` | exact | — |
| EX54 | Connector unconditional word `always` at `dsText.micro text-fg-faint` | `DemoExplorer.tsx:551` | `explorer.tsx:472` | exact | — |
| EX55 | Connector second unconditional arm: rebuild prints `no edge between them` when the next row declares no `depends-on` back-edge, with `title=` explaining each arm; the demo always prints `always` | — | `explorer.tsx:463-474` | extra | **OPEN — operator call** |
| EX56 | Connector conditional line shape `→ {to}: {condition}` with the condition in `text-fg-faint` | `DemoExplorer.tsx:553-557` | `explorer.tsx:458-462` | exact | — |
| EX57 | Condition TEXT: demo prints the descriptor's authored prose (`edge.condition`); rebuild composes `case {label}` / `branch {label}`, or `a case of this branch` / `a branch of this parallel` when unlabelled | `demo-explorer-wire.ts:136` | `explorer-model.ts:194-206` | divergent | ruled: operator-trust §5.7 (the surface reports the choice's NAME, never a rendering of what the closure computes) |
| EX58 | Connector emitted only when the NEXT node shares this node's lane (demo) vs between every consecutive pair (rebuild) | `DemoExplorer.tsx:485-487` | `explorer.tsx:640-645` | divergent | ruled: operator-trust §5.7 (no lane fact) |
| EX59 | Node list markup — `<ol className="flex flex-col">` of `<li className="flex flex-col">` | `DemoExplorer.tsx:466`, `:474` | `explorer.tsx:625`, `:630` | exact | — |
| EX60 | `Scenarios` section at the foot of the graph body — `SectionLabel` + one row per scenario carrying `scenarioId` and a `SourceLink label="walks"` | — | `explorer.tsx:651-664` | extra | ruled: operator-trust §5.2 (source links to … scenarios) |
| EX61 | Node row button shell — `rounded-[var(--ds-radius-md)] border p-base gap-base items-start text-left`, `dsFocus dsMotion.base`, selected `border-loud bg-surface-selected`, else `border-border bg-surface-1 hover:bg-surface-2` | `DemoExplorer.tsx:583-598` | `explorer.tsx:494-507` | exact | — |
| EX62 | Rebuild adds `cursor-pointer` and the house pressable `active:translate-y-px` to the node row | — | `explorer.tsx:499`, `:503` | extra | ruled: dashboard-surfaces §9.5.3 as-built notes |
| EX63 | `border-dashed` on a row the overlaid run did not reach | `DemoExplorer.tsx:597` | — | missing | ruled: operator-trust §5.7 |
| EX64 | Leading dot — demo paints `tone.dot` (per-state colour) on-path and a hollow `ring-1 ring-border-strong` off-path; rebuild always paints `bg-[var(--ds-border-strong)]` | `DemoExplorer.tsx:600-603` | `explorer.tsx:514` | divergent | ruled: operator-trust §5.7 |
| EX65 | Node id text: demo `dsText.ui font-semibold`; rebuild adds `dsText.nums` | `DemoExplorer.tsx:606-614` | `explorer.tsx:523-525` | divergent | **OPEN — operator call** |
| EX66 | Rebuild prints the node LABEL beside the id at `dsText.meta dsClip.text text-fg-muted`, suppressed by `nodeLabelBeside` when the label only re-slugs the id | — | `explorer.tsx:526-530`, `explorer-model.ts:167-170` | extra | **OPEN — operator call** |
| EX67 | Kind `Badge tone={KIND_TONE[kind]}` beside the id | `DemoExplorer.tsx:615` | `explorer.tsx:531` | exact | — |
| EX68 | Kind word `Task` (tone `neutral`) | `demo-explorer-wire.ts:63` | `explorer.tsx:142` | exact | — |
| EX69 | Kind word `Branch` (tone `neutral`) | `demo-explorer-wire.ts:65` | `explorer.tsx:144` | exact | — |
| EX70 | Kind word `Gate` (tone `warning`) | `demo-explorer-wire.ts:65` | `explorer.tsx:147` | exact | — |
| EX71 | Kind word `Delegation` (tone `info`) — demo kind `delegation`, rebuild kind `child-run` | `demo-explorer-wire.ts:66` | `explorer.tsx:146` | exact | — |
| EX72 | Kind word: demo `Fan-out` (tone `info`) vs rebuild `Parallel` (tone `neutral`) — both the word and the tint differ | `demo-explorer-wire.ts:67`, `DemoExplorer.tsx:125` | `explorer.tsx:145` | divergent | **OPEN — operator call** |
| EX73 | Kind word: demo `Write` (tone `danger`) vs rebuild `Transaction` (tone `danger`) | `demo-explorer-wire.ts:68` | `explorer.tsx:143` | divergent | **OPEN — operator call** |
| EX74 | Kind word `Output` (tone `success`) — a node whose product is a file rather than a system-of-record change | `demo-explorer-wire.ts:69`, `DemoExplorer.tsx:127` | — | missing | **OPEN — operator call** |
| EX75 | `Chip label="system"` naming the node's system — rebuild emits `nodeBindings`, which can emit SEVERAL chips and labels a headless store `store` (`workflow:person-lookup`) rather than `system` | `DemoExplorer.tsx:616` | `explorer.tsx:532-534`, `explorer-model.ts:144-156` | divergent | **OPEN — operator call** |
| EX76 | Delegation `Chip tone="info" label="to"` carrying the target workflow's LABEL | `DemoExplorer.tsx:617-621` | `explorer.tsx:535-537` | exact | — |
| EX77 | `Chip tone="danger"` reading `a dry run skips this` on a node above the boundary that a rehearsal skips anyway (`skippedAboveBoundary`) | `DemoExplorer.tsx:622`, `demo-explorer-wire.ts:185-190` | — | missing | unserved: no per-node `skippedInDryRun` on `ExplorerNodeWire.shape` for a non-transaction node |
| EX78 | `Chip tone="danger"` reading `a dry run does not stop this` on a transaction declaring `dryRun: "unsupported"` | — | `explorer.tsx:538-540` | extra | ruled: workflow-model §1.1 |
| EX79 | Right-aligned run-state word (`ml-auto`, `tone.cls`) with the seven-word vocabulary `done` / `running` / `waiting on you` / `failed` / `off this path` / `not reached` / `cancelled` | `DemoExplorer.tsx:108-116`, `:623` | — | missing | ruled: operator-trust §5.7 |
| EX80 | Conditional-node line under the id: demo `runs when {node.when}` (authored prose); rebuild `describeNodeCondition(shape.condition)` (a total projection of the declared condition the executor evaluates) | `DemoExplorer.tsx:625` | `explorer.tsx:542-546` | divergent | ruled: D228 |
| EX81 | Per-node duration `fmtElapsed(overlay.durationSec)` at `dsText.micro dsText.nums` | `DemoExplorer.tsx:627-631` | — | missing | ruled: operator-trust §5.7 |
| EX82 | Per-node `plural(attempts,"attempt")` when `> 1`, in `text-status-waiting-fg` | `DemoExplorer.tsx:632-636` | — | missing | ruled: operator-trust §5.7 |
| EX83 | Per-node `plural(recorded.length,"value")` count | `DemoExplorer.tsx:637-641` | — | missing | ruled: operator-trust §5.7 |
| EX84 | Per-node `evidence captured` micro line | `DemoExplorer.tsx:642-644` | — | missing | ruled: operator-trust §5.7 |
| EX85 | Per-node `overlay.skippedBecause` micro line in `text-fg-faint` | `DemoExplorer.tsx:645-647` | — | missing | ruled: operator-trust §5.7 |
| EX86 | Per-node `overlay.childNote` line in `text-info-fg` | `DemoExplorer.tsx:649` | — | missing | ruled: operator-trust §5.7 |
| EX87 | Per-node `plural(contracts,"contract")` count in the same micro-fact strip | — | `explorer.tsx:548-552` | extra | **OPEN — operator call** |
| EX88 | Per-node `re-runs on every attempt` when `shape.replay === "always-rerun"` | — | `explorer.tsx:553-555` | extra | **OPEN — operator call** |
| EX89 | Per-node `resolved by {shape.resolvedBy}` on a gate node | — | `explorer.tsx:556-560` | extra | ruled: operator-trust §5.2 (gates) |
| EX90 | Per-node `plural(editableFields.length,"correctable field")` | — | `explorer.tsx:561-565` | extra | ruled: operator-trust §5.2 (editable vs read-only checkpoint fields) |
| EX91 | Node panel `PanelHeader title={node.id}` | `DemoExplorer.tsx:706` | `explorer.tsx:1022` | exact | — |
| EX92 | Node panel header `meta`: demo puts the overlay state word there in `tone.cls`; rebuild puts `nodeLabelBeside(node)` there | `DemoExplorer.tsx:707` | `explorer.tsx:1023` | divergent | ruled: operator-trust §5.7 |
| EX93 | Node panel header `actions` = the node ⓘ | `DemoExplorer.tsx:708` | `explorer.tsx:1024` | exact | — |
| EX94 | Node panel body — `flex flex-col gap-cozy p-cozy` | `DemoExplorer.tsx:710` | `explorer.tsx:1026` | exact | — |
| EX95 | Node fact-chip row — `flex min-w-0 flex-wrap items-center gap-snug`, leading with the kind `Badge` | `DemoExplorer.tsx:713-714` | `explorer.tsx:1029-1030` | exact | — |
| EX96 | Node fact chip `Chip label="system"` — same divergence as EX75 (`system` vs `store`, one vs many) | `DemoExplorer.tsx:715` | `explorer.tsx:1031-1033` | divergent | **OPEN — operator call** |
| EX97 | Node fact `Chip tone="info" label="delegates to"` carrying the child workflow's label | `DemoExplorer.tsx:716-720` | `explorer.tsx:1034-1036` | exact | — |
| EX98 | Node fact `Chip tone="danger"` reading `changes a system of record` | `DemoExplorer.tsx:721` | `explorer.tsx:1037` | exact | — |
| EX99 | Node fact dry-run chip copy: demo `Chip tone="info"` → `a dry run skips this`; rebuild `Chip tone="info"` → `a dry run stops here — the commit does not run` (at the boundary node) or `a dry run does not commit this` | `DemoExplorer.tsx:722` | `explorer.tsx:1038-1044` | divergent | ruled: workflow-model §1.1 |
| EX100 | `MetaLine items={["runs when …"]}` under the chip row for a conditional node | `DemoExplorer.tsx:724-726` | `explorer.tsx:1047-1049` | divergent | ruled: D228 |
| EX101 | Empty-contract line: demo `MetaLine tone="faint" items={["no value moves here"]}`; rebuild `items={["a control node owns no contract; it decides which nodes run"]}` | `DemoExplorer.tsx:770` | `explorer.tsx:1052` | divergent | **OPEN — operator call** |
| EX102 | Contract `Table label="{node.id} contract" layout="fixed"` | `DemoExplorer.tsx:729` | `explorer.tsx:1054` | exact | — |
| EX103 | `colgroup` widths — demo `44% / 20% / auto`; rebuild `46% / 14% / auto` | `DemoExplorer.tsx:730-734` | `explorer.tsx:1063-1067` | divergent | **OPEN — operator call** |
| EX104 | `THead` columns `Field` · `System` · `Recorded` | `DemoExplorer.tsx:735-741` | `explorer.tsx:1068-1074` | exact | — |
| EX105 | `DirHeaderRow` read band — `colSpan={3}`, `bg-surface-2 py-tight`, `<ArrowDownToLine dsIcon.sm>` + `dsText.caps` `Reads` in `DIR_INK.read` | `DemoExplorer.tsx:811-823` | `explorer.tsx:675-687` | exact | — |
| EX106 | `DirHeaderRow` write band — `<ArrowUpFromLine dsIcon.sm>` + `Writes` in `DIR_INK.write` | `DemoExplorer.tsx:812`, `:818` | `explorer.tsx:676`, `:682` | exact | — |
| EX107 | What decides the read/write split: demo splits the node's contract ROWS by `row.dir`; rebuild splits the node's TASK ARMS by `task.effect === "read"` | `DemoExplorer.tsx:697-698` | `explorer.tsx:1014-1015` | divergent | ruled: D227 |
| EX108 | `ContractArmBand` sub-band row — task id + `ARM_WORD[arm]` verb (`runs`/`prepares`/`commits`) + task title | — | `explorer.tsx:700-730` | extra | ruled: operator-trust §5.2 (each task's …) |
| EX109 | Arm band `Chip tone="warning"` reading `no implementation` for an unbound contract | — | `explorer.tsx:713` | extra | ruled: D107 |
| EX110 | Arm band policy chips — `fresh` (with the raw ms on `title`), `from`, `proof`, `checkpoint`, `artifacts` | — | `explorer.tsx:714-724` | extra | ruled: operator-trust §5.2 |
| EX111 | Field-name cell content: demo prints the operator's word for the value (`Last day worked`), joined to the run ledger by `fieldKey`; rebuild prints the dotted zod leaf path (`selection.selected.emplId`) | `DemoExplorer.tsx:838`, `demo-explorer-wire.ts:89` | `explorer.tsx:778-780` | divergent | ruled: D227 |
| EX112 | Second line under the field name — `fieldShapeLine` → `in · string · sometimes` / `out · list`, with `options` on `title` | — | `explorer.tsx:781-786`, `explorer-model.ts:85-89` | extra | ruled: D227 |
| EX113 | Per-field `only when {row.when}` micro line under the field name | `DemoExplorer.tsx:846-848` | — | missing | unserved: `ExplorerContractFieldWire` carries no per-field `when` |
| EX114 | Editable pencil: demo puts `<Pencil aria-label="correctable at a checkpoint">` INSIDE the Field cell of the row it is true of; rebuild puts it on chips in two `FactRow`s below the table (`Detail projections`, `Operator-correctable`) | `DemoExplorer.tsx:839-844` | `explorer.tsx:1108-1117`, `:1134-1139` | divergent | **OPEN — operator call** |
| EX115 | System cell — `dsText.meta text-fg-muted` | `DemoExplorer.tsx:850-852` | `explorer.tsx:788-790` | exact | — |
| EX116 | `Recorded` cell content: demo prints the run's recorded VALUE (or `—`) with the full value on `title`; rebuild prints the field's declared PROVENANCE — `from {source}` + `fresh {age}` + `override`, or `transaction checkpoint`, `unknown` (warning), `bound by the graph`, `not recorded` | `DemoExplorer.tsx:860-896` | `explorer.tsx:742-764` | divergent | ruled: D227 |
| EX117 | `Chip tone="warning"` reading `staged` in the Recorded cell | `DemoExplorer.tsx:886` | — | missing | ruled: operator-trust §5.7 |
| EX118 | `Chip tone="warning"` reading `not read back` | `DemoExplorer.tsx:887` | — | missing | ruled: operator-trust §5.7 |
| EX119 | `Chip tone="warning"` reading `replayed` | `DemoExplorer.tsx:888` | — | missing | ruled: operator-trust §5.7 |
| EX120 | `Chip tone="info"` reading `corrected` | `DemoExplorer.tsx:889` | — | missing | ruled: operator-trust §5.7 |
| EX121 | `proved by {row.proof}` micro line inside the Recorded cell — the rebuild carries the same fact as the arm band's `Chip label="proof"` and `TaskRecord`'s `Write safety` row instead | `DemoExplorer.tsx:891-893` | `explorer.tsx:720-722`, `:876-901` | divergent | ruled: operator-trust §5.2 (transaction … proof) |
| EX122 | `RecordedOnlyRow` — a value the run recorded that the contract does not list, shown muted rather than filtered away | `DemoExplorer.tsx:904-924` | — | missing | ruled: operator-trust §5.7 |
| EX123 | Provenance `MetaLine` — `attempt {n}` · `{n} replayed from a checkpoint` · `{n} corrected by you` | `DemoExplorer.tsx:776-788` | — | missing | ruled: operator-trust §5.7 |
| EX124 | Run title + `keyLines` block at the foot of the node panel (`runOverlay.title` in `dsText.ui font-semibold`, then each line in `dsText.body dsText.nums`) | `DemoExplorer.tsx:793-804` | — | missing | ruled: operator-trust §5.7 |
| EX125 | `FactRow` label/value pair primitive (`w-[9rem]` label column) used throughout the rebuild's node panel | — | `explorer.tsx:180-187` | extra | **OPEN — operator call** |
| EX126 | `Depends on` FactRow — upstream chips, or the sentence `Nothing — this node may start immediately.` | — | `explorer.tsx:1086-1096` | extra | ruled: operator-trust §5.2 (nodes/edges) |
| EX127 | `NodeShapeFacts` task arm — `Replay` FactRow with `Chip label="checkpoint"` and `Chip label="condition"` (`always runs` or the condition kind) | — | `explorer.tsx:1173-1187` | extra | **OPEN — operator call** |
| EX128 | `NodeShapeFacts` transaction arm — `Write sequence` FactRow: `dry run`, `probe`, `probe→fence` (raw ms on `title`), `lease`, `retry before fence` | — | `explorer.tsx:1188-1201` | extra | ruled: operator-trust §5.2 (transaction subject-binding, probe, fence, proof, dry-run boundary) |
| EX129 | `NodeShapeFacts` branch arm — one `FactRow label="case {name}"` per case, target chips | — | `explorer.tsx:1202-1213` | extra | ruled: operator-trust §5.2 (branch conditions) |
| EX130 | `NodeShapeFacts` parallel arm — `join` FactRow plus one `FactRow label="branch {id}"` per branch | — | `explorer.tsx:1214-1226` | extra | ruled: operator-trust §5.2 (parallel joins) |
| EX131 | `NodeShapeFacts` child-run arm — nine chips: `target` `edge` `cardinality` `await` `join` `on child failed` `cascade` `after retry` `visibility` | — | `explorer.tsx:1227-1242` | extra | ruled: operator-trust §5.2 (delegation policies) |
| EX132 | `NodeShapeFacts` gate arm — `resolved by` and `status key` chips | — | `explorer.tsx:1243-1251` | extra | ruled: operator-trust §5.2 (gates) |
| EX133 | `Detail projections` FactRow — one chip per `node.details` entry, `title="{key} · {display}"`, pencil icon when the path is operator-correctable | — | `explorer.tsx:1100-1124` | extra | **OPEN — operator call** |
| EX134 | `Operator-correctable` FactRow — `Chip tone="info"` + pencil per `node.editableFields` entry | — | `explorer.tsx:1126-1146` | extra | ruled: operator-trust §5.2 (editable vs read-only checkpoint fields) |
| EX135 | `Coverage points` FactRow — `{id} — {detail}` per derived coverage point | — | `explorer.tsx:1148-1159` | extra | ruled: operator-trust §5.7 (each node's own derived coverage points are served instead) |
| EX136 | `TaskRecord` section per arm — `aria-label={taskId}`, top border, `Badge` carrying the arm verb (`danger` when the effect is `commit`), task id, task title | — | `explorer.tsx:824-836` | extra | ruled: operator-trust §5.2 |
| EX137 | `TaskRecord` → `Implemented by` — `store` / `kind` / `driver` chips, or `Banner tone="warning" title="No implementation is bound yet"` + the pending-binding note | — | `explorer.tsx:838-855` | extra | ruled: D107 |
| EX138 | `TaskRecord` → `Subject binding` — `kind` `from input` `identity` `observes` (with `<ScanEye>`) `match` `required at`, or the declared `reason` / `none declared` | — | `explorer.tsx:857-874` | extra | ruled: operator-trust §5.2 |
| EX139 | `TaskRecord` → `Write safety` — `completion` `verifies with` `probes with` `absence after fence` (`operator-only` or `stabilized · {ms}ms · {n} reads`) `unverifiable by page` | — | `explorer.tsx:876-901` | extra | ruled: operator-trust §5.2 |
| EX140 | `TaskRecord` → `Errors` — one chip per declared error code | — | `explorer.tsx:903-907` | extra | ruled: operator-trust §5.2 |
| EX141 | `TaskRecord` → `Requires` — `secret` and `provider` chips, `tone="info"` | — | `explorer.tsx:909-920` | extra | ruled: operator-trust §5.2 (secrets) |
| EX142 | `TaskRecord` → `Freshness` — `default` (raw ms on `title`), `override`, and one chip per `byField` rule | — | `explorer.tsx:922-938` | extra | ruled: operator-trust §5.2 |
| EX143 | `TaskRecord` → `Provenance` — `default` plus one chip per `byField` rule | — | `explorer.tsx:940-949` | extra | ruled: operator-trust §5.2 |
| EX144 | `TaskRecord` → `UI vocabulary` — catalog-id chips labelled by kind with `title="{label} — verified {date}"`, or the sentence `No catalog entry names this contract — it reaches no browser page.` | — | `explorer.tsx:951-965` | extra | ruled: operator-trust §5.2 (UI elements/page states) |
| EX145 | `TaskRecord` → `Scenarios` — one chip per scenario id | — | `explorer.tsx:967-971` | extra | ruled: operator-trust §5.2 |
| EX146 | `TaskRecord` → `Source` — `SourceLink label="contract"` and `SourceLink label="impl"` | — | `explorer.tsx:973-978` | extra | ruled: operator-trust §5.2 (source links) |
| EX147 | `TaskRecord` → trailing `MetaLine tone="faint"` with `input`/`output`/`impl` fingerprints truncated to 12 chars | — | `explorer.tsx:980-989` | extra | ruled: operator-trust §5.7 |
| EX148 | `SourceLink` primitive — resolved arm is `Chip` + `<FileCode2 dsIcon.sm>` + path; unresolved arm is `Chip tone="warning"` + `<SquareArrowOutUpRight>` + `unresolved: {attemptedPath}` with `title="{attemptedPath} — {reason}"` | — | `explorer.tsx:197-215` | extra | ruled: operator-trust §5.7 (source links RESOLVE; they are never interpolated) |
| EX149 | Graph ⓘ trigger — `IconButton size="xs"`, `label="What is this graph? — {label}"`, `<Info dsIcon.sm>`, `text-fg-faint hover:text-fg data-[state=open]:text-fg` | `DemoExplorer.tsx:943-948` | `explorer.tsx:1301-1306` | exact | — |
| EX150 | Graph ⓘ `PopoverContent title={label} side="bottom" align="end" width="lg"`, body `flex flex-col gap-base` | `DemoExplorer.tsx:950-951` | `explorer.tsx:1308-1309` | exact | — |
| EX151 | Graph ⓘ opens with the descriptor's own `summary` sentence at `dsText.body leading-relaxed text-fg` | `DemoExplorer.tsx:952` | `explorer.tsx:1316`, `:1275-1277` | exact | — |
| EX152 | `Prose` absent arm — italic `text-fg-faint` naming the file that owes a sentence, instead of composing prose from a label | — | `explorer.tsx:1267-1274` | extra | ruled: D229 |
| EX153 | Derivation paragraph — `This graph is the as-built descriptor, read from the one composition root at {path}. A node appears here because the descriptor factory returned it — there is no hand-maintained list anywhere behind this page.` | — | `explorer.tsx:1317-1325` | extra | ruled: D229 |
| EX154 | `POSTURE_NOTE.boundary`: demo `A dry run executes every node above the dashed line and stops there. That line, not gated access, is the whole safety boundary of a rehearsal.` vs rebuild `…and stops after the transaction's prepare arm — the commit never runs. That line, …` | `DemoExplorer.tsx:931-932` | `explorer.tsx:1281-1282` | divergent | ruled: workflow-model §1.1 |
| EX155 | `POSTURE_NOTE["no-rehearsal"]`: demo opens `This workflow changes a system of record and honours no dry run, …`; rebuild opens `This workflow declares a transaction that honours no dry run, …` | `DemoExplorer.tsx:933-934` | `explorer.tsx:1283-1284` | divergent | **OPEN — operator call** |
| EX156 | `POSTURE_NOTE["no-system-write"]`: the demo's trailing sentence `Anything it writes lands in a file, not in an HR record.` is dropped, and the opening clause changes from `This workflow changes no system of record` to `This workflow declares no transaction node` | `DemoExplorer.tsx:935-936` | `explorer.tsx:1285-1286` | divergent | **OPEN — operator call** |
| EX157 | Field-census paragraph — `{n} reads and {n} writes count FIELDS, derived from each contract's own zod shape (D227): … A prepare arm stages the values its commit then writes, so its inputs are not counted twice.` | — | `explorer.tsx:1329-1331` | extra | ruled: D227 |
| EX158 | Read-only paragraph (left-bordered `border-border-loud pl-base`): demo `The graph is the descriptor; the overlay is one run's own recorded steps. Neither is editable here — read-only was ratified first, and an authoring surface would have to bump a version to mean anything.` vs rebuild `Nothing here is editable. Read-only was ratified first (ref operator-trust §5.1), and the editing half is deferred out of Phase 2 by D186 — an authoring surface would have to bump a version to mean anything.` | `DemoExplorer.tsx:954-963` | `explorer.tsx:1332-1342` | divergent | ruled: D186 |
| EX159 | `WorkflowRegistration` block inside the graph ⓘ — `SectionLabel "Registered as"` + `edit data` / `review` / `run surface` / `intake` / `capture` chips, then `descriptor` + `module` `SourceLink`s, then a fingerprint `MetaLine` (`contract …` · `result …` · `{n} files fingerprinted` · `result from {nodes}`) | — | `explorer.tsx:386-433`, `:1343` | extra | ruled: operator-trust §5.2 |
| EX160 | Graph ⓘ trailing `MetaLine tone="faint"`: demo `[fmtVersionTag, {n} nodes, {n} edges, systems]` (`v1.0`); rebuild `[v{major}, {n} nodes, {n} edges, systems]` (`v1`) | `DemoExplorer.tsx:964-972` | `explorer.tsx:1344-1352` | divergent | unserved: `ExplorerWorkflowWire.minorVersion` |
| EX161 | Graph ⓘ trailing MetaLine `no system` fallback when the graph touches none | `DemoExplorer.tsx:970` | `explorer.tsx:1350` | exact | — |
| EX162 | Node ⓘ trigger — `IconButton size="xs"`, `label="What is this node? — {id}"`, same `<Info dsIcon.sm>` and hover/open ink | `DemoExplorer.tsx:983-988` | `explorer.tsx:1364-1369` | exact | — |
| EX163 | Node ⓘ `PopoverContent title={node.id} side="bottom" align="end" width="lg"` | `DemoExplorer.tsx:990` | `explorer.tsx:1371` | exact | — |
| EX164 | Node ⓘ opens with the descriptor's own `purpose` sentence | `DemoExplorer.tsx:992` | `explorer.tsx:1373` | exact | — |
| EX165 | Node ⓘ second paragraph `{node.label} — a {kind} node of {workflow.label}.` | — | `explorer.tsx:1374-1376` | extra | **OPEN — operator call** |
| EX166 | Delegation paragraph — demo `The child keeps its own Queue Row in its own panel and is linked from here — it is never nested under this run, and it is never counted twice.` vs rebuild `The child keeps its own queue row in its own panel …` (`Queue Row` → `queue row`) | `DemoExplorer.tsx:993-998` | `explorer.tsx:1377-1382` | divergent | **OPEN — operator call** |
| EX167 | Write/transaction paragraph — demo `A dry run of {label} does not execute this node.` / `A dry run of {label} executes this node too — it is a real write on a rehearsal.` vs rebuild `A dry run of {label} stages this node and stops before its commit arm.` / `A dry run of {label} cannot rehearse this node — it declares no dry-run behaviour at all.` | `DemoExplorer.tsx:999-1005` | `explorer.tsx:1383-1389` | divergent | ruled: workflow-model §1.1 |
| EX168 | Pencil paragraph — demo `A pencil on a field means the descriptor allows you to correct it at a checkpoint. Identity, input, idempotency, proof and provenance are structurally read-only and carry none.` vs rebuild `…allows an operator to correct it at a checkpoint. …` (`you` → `an operator`) | `DemoExplorer.tsx:1006-1009` | `explorer.tsx:1390-1394` | divergent | **OPEN — operator call** |
| EX169 | Node ⓘ `UI ids` block — `SectionLabel "UI ids"` + one `dsText.meta dsText.nums` line per semantic id + the footnote `Semantic ids, never raw selectors — a selector in a descriptor breaks every time a page moves a div.` The rebuild moves the ids to `TaskRecord`'s `UI vocabulary` FactRow and drops the footnote entirely | `DemoExplorer.tsx:1010-1022` | `explorer.tsx:951-965` | divergent | ruled: operator-trust §5.7 (UI links are reversed out of the catalog's own `taskUses`) |
| EX170 | Closure paragraph — `Every closure this node owns — \`bind\`, \`choose\`, \`derive\`, the write-safety key — is reported as the shape it sits in plus the file that owns it. … A node's \`when\` is the exception because it stopped being a closure.` | — | `explorer.tsx:1395-1402` | extra | ruled: operator-trust §5.7 |
| EX171 | Empty state on a graph-less selection: demo `EmptyState` icon `<Workflow dsIcon.lg>`, title `No descriptor graph is served for this workflow`, description `It is listed rather than hidden — a list that silently omits a workflow teaches you the product has never heard of it.`; rebuild titles `No workflow is registered as "{id}"` / `{label} declares no nodes` and describes `The server serves an empty registry, so there is no graph to explore.` / `Registered today: {ids}.` | `DemoExplorer.tsx:204-213` | `explorer.tsx:1538-1564` | divergent | **OPEN — operator call** |
| EX172 | Empty-state `action` — a `Button size="sm"` reading `Open {firstWorkflowId}` | — | `explorer.tsx:1553-1561` | extra | **OPEN — operator call** |
| EX173 | Empty-state panel spans `min-[1280px]:col-span-2` in both | `DemoExplorer.tsx:205` | `explorer.tsx:1539` | exact | — |
| EX174 | Default open node: demo lands on the node the run is sitting on (`stoppedAtNodeId`, else the last reached) and falls back to `graph.nodes[0]`; rebuild always falls back to `workflow.nodes[0]` | `DemoExplorer.tsx:241-249` | `explorer.tsx:1453` | divergent | ruled: operator-trust §5.7 |
| EX175 | Switching workflow drops the open node (both) — demo also drops the run choice | `DemoExplorer.tsx:194-201` | `explorer.tsx:1529-1535`, `:1455` | exact | — |
| EX176 | Zoom / fit / pan / draggable-canvas controls — neither surface has any; both refuse the workflow-builder canvas by design | `DemoExplorer.tsx:82-83` | `explorer.tsx:40-43` | exact | — |
| EX177 | Keyboard affordance — both make every list row and every graph row a native `<button>` carrying `aria-current`, with `dsFocus`; neither adds roving tabindex or arrow-key navigation | `DemoExplorer.tsx:292`, `:583` | `explorer.tsx:274`, `:494` | exact | — |
| EX178 | Search / filter control on the Explorer — neither surface has one | `DemoExplorer.tsx` (none) | `explorer.tsx` (none) | exact | — |
| EX179 | Rail indentation — dashboard-surfaces §9.5.3 says a controller's downstream nodes are "indented beneath it"; BOTH surfaces render a flat `<ol>` in declaration order, so the doc describes a shape neither has | `DemoExplorer.tsx:466-491` | `explorer.tsx:625-649` | exact | — |
| EX180 | Port-provenance claim: `explorer.tsx:8-10` names `skippedAboveBoundary` among the ported wire helpers; `explorer-model.ts` exports no such function and no early-skip mark is drawn | `demo-explorer-wire.ts:185-190` | `explorer.tsx:9-10` | divergent | **OPEN — operator call** |
| EX181 | Port-provenance claim: the same header names `laneOf`'s connector rule; no lane concept exists and the `Connector` is emitted between every consecutive pair | `demo-explorer-wire.ts:193-195` | `explorer.tsx:10` | divergent | ruled: operator-trust §5.7 (no lane fact) |
| EX182 | Node id resolution: demo's node `id` IS the descriptor step label (prose, e.g. `Job summary`) and carries `aliases[]` for renamed steps; rebuild's is a kebab `NodeId` and there is no alias concept | `demo-explorer-wire.ts:99-108` | `explorer.tsx:523-525` | divergent | ruled: operator-trust §5.7 (aliases exist only to lay an older run over the graph) |

**Counts:** exact 55 · divergent 42 · missing 33 · extra 52 · OPEN 30

## 4. UI catalog — `DemoCatalogView.tsx` + `demo-catalog.ts` ↔ `surfaces/ui-catalog.tsx`

**Demo:** `legacy `rebuild-demo/`DemoCatalogView.tsx` (384) + `demo-catalog.ts` (510) · **Rebuild:** ``src/dashboard/`surfaces/ui-catalog.tsx` (300), `generated/ui-catalog.json` (120 entries), `src/stores/{ucpath,kuali,crm,new-kronos}/UI-CATALOG.md`

**These two files are not two versions of one surface — they are two different artifacts that share a word.** `DemoCatalogView` is the demo's **"Row & panel catalog"** (`DemoShell.tsx:283`, reached behind the flask-icon scaffolding door at `DemoShell.tsx:362`, `:378`): a five-section reference page for the QUEUE-ROW vocabulary — 8 named row variants over the 3 ratified row types, 3 containment kinds, the rollup precedence chain and the one member shape, 4 Log-Panel kinds with derived tab strips, and the whole thing read back the other way as a per-workflow map. `ui-catalog.tsx` is the **semantic SELECTOR catalog** (D177 / ref operator-trust §5.8): 120 screens, elements, page states and observations read from the committed `generated/ui-catalog.json`, each carrying its `verifiedAt` and both evidence refs. There is **no rebuild counterpart to the row-and-panel catalog anywhere in `src/dashboard/surfaces/`**, and **no demo counterpart to the selector catalog anywhere in `rebuild-demo/`** — so every row below is `missing` or `extra`, and none is `exact`. The demo's whole surface is covered by one ruling — `config/legacy-capabilities.json#legacy-dashboard-dev` is `retired` under D184, on the argument that `dev/rebuild-demo/` was itself the port SOURCE and "cannot exist in the rebuild by construction" — but that ruling is about not porting the demo shell, not about whether the row-and-panel VOCABULARY deserves a product surface; CA1 puts that question to the operator explicitly. Two smaller findings: the rebuild's catalog has **no entry control at all** (the top-bar glyph was removed by operator decision, `top-bar.tsx:1128-1130`, while dashboard-surfaces §9.5.3 still says "Entry is two `ghost` buttons in the panel's action bar beside `Import spreadsheet`" — no such button exists in `queue-toolbar.tsx`, `shell.tsx` or `dashboard-app.tsx`), and the row's `verification.scenarios` are rendered as a COUNT with the scenario names never shown.

| # | Element | Demo | Rebuild | Verdict | Reason |
|---|---------|------|---------|---------|--------|
| CA1 | The row-and-panel vocabulary as a product surface at all — 8 row variants, 3 containment kinds, rollup precedence, 4 panel kinds, the per-workflow map | `DemoCatalogView.tsx:113-384` | — | missing | **OPEN — operator call** |
| CA2 | Entry point — a flask-icon scaffolding door listing `Row & panel catalog` / `note: "every row variant and panel kind, named"` | `DemoShell.tsx:283`, `:362-378` | — | missing | ruled: D184 (`config/legacy-capabilities.json#legacy-dashboard-dev`, `retired`) |
| CA3 | Page shell — `min-h-0 flex-1 overflow-y-auto` over `mx-auto max-w-6xl flex-col gap-page px-section py-section` | `DemoCatalogView.tsx:129-130` | — | missing | ruled: D184 |
| CA4 | `SectionHead` — a `size-7` bordered `rounded-md bg-surface-2` icon square, `h2` at `dsText.section font-semibold`, blurb at `dsText.body leading-relaxed text-fg-muted` | `DemoCatalogView.tsx:77-96` | — | missing | ruled: D184 |
| CA5 | Section 1 head — icon `LayoutList`, title `Queue Rows — 8 named variants over the 3 ratified types`, blurb `The row TYPE is structural (Run / Group / Member). The variant is what it is about, and it decides the title rule, what the row body carries, and which Log Panel you land in.` | `DemoCatalogView.tsx:133-137` | — | missing | ruled: D184 |
| CA6 | Variant grid — `grid gap-cozy min-[1100px]:grid-cols-2` | `DemoCatalogView.tsx:138` | — | missing | ruled: D184 |
| CA7 | `specimenCard` — `flex flex-col border p-cozy` + `dsRadius.lg` + `dsBorder.base` + `dsSurface.card`, a flex COLUMN so `CardBase` can pin trailing blocks to one line across a row | `DemoCatalogView.tsx:44` | — | missing | ruled: D184 |
| CA8 | Variant card heading — `h3` at `dsText.title font-semibold text-fg` carrying the variant name | `DemoCatalogView.tsx:142` | — | missing | ruled: D184 |
| CA9 | Variant card row-type pill — `h-[var(--ds-h-xs)] rounded-sm dsText.caps` on ONE recessed plane with three INK weights (`--ds-fg` / `--ds-recess-fg` / `--ds-recess-fg-quiet`), never three hues | `DemoCatalogView.tsx:25-33`, `:143-153` | — | missing | ruled: D184 |
| CA10 | `ExampleButton` — `Button size="sm" variant="secondary" className="ml-auto"` with `iconAfter={<ArrowRight dsIcon.sm>}` and copy `See {DEMO_ROWS[id].title.slice(0,22)}` | `DemoCatalogView.tsx:99-111` | — | missing | ruled: D184 |
| CA11 | Variant card `subject` line — one sentence at `dsText.body … text-fg-secondary` (e.g. `One person, one run, no members.`) | `DemoCatalogView.tsx:156` | — | missing | ruled: D184 |
| CA12 | Variant card `titleRule` line at `dsText.meta … text-fg-muted` (e.g. `Title = the resolved person name. Subtitle = EID if known, else the trace id.`) | `DemoCatalogView.tsx:157` | — | missing | ruled: D184 |
| CA13 | Variant card `carries[]` bullet list — `specBullet` (`mt-snug size-1 rounded-full bg-fg-faint`) + text at `dsText.meta` | `DemoCatalogView.tsx:74-75`, `:159-166` | — | missing | ruled: D184 |
| CA14 | Variant card `gotcha` block — a `rounded-md border` box in the waiting tone triad (`--ds-status-waiting-border/bg/fg`) inside `CardBase` | `DemoCatalogView.tsx:172-182` | — | missing | ruled: D184 |
| CA15 | Variant card workflow chips — `catalogChip` (recessed plane, `dsClip.token`, `h-[var(--ds-h-xs)]`) carrying `{code}` in `dsText.nums` + `{label}`, with the per-workflow `note` on `title=` | `DemoCatalogView.tsx:62-72`, `:184-191` | — | missing | ruled: D184 |
| CA16 | The eight variant names verbatim — `Person Run Row` · `Document Run Row` · `Review Run Row` · `Catalog Run Row` · `Packet Group Row` · `Roster Group Row` · `Person Member Row` · `Rejected Member Row` | `demo-catalog.ts:75`,`99`,`121`,`139`,`153`,`173`,`197`,`218` | — | missing | **OPEN — operator call** |
| CA17 | Section 2 head — icon `Link2`, title `Containment — the one field that decides where a child lives`, blurb `Not every child of a row is a member. Getting this wrong is what makes the same run appear in two panels and the badges disagree with the rows.` | `DemoCatalogView.tsx:200-204` | — | missing | ruled: D184 |
| CA18 | Containment grid — `grid gap-cozy min-[1100px]:grid-cols-3` | `DemoCatalogView.tsx:205` | — | missing | ruled: D184 |
| CA19 | Containment card heading — `h3` name at `dsText.title` beside the raw `key` at `dsText.micro dsText.nums text-fg-muted` | `DemoCatalogView.tsx:208-211` | — | missing | ruled: D184 |
| CA20 | Containment card `rule` paragraph at `dsText.body … text-fg-secondary` | `DemoCatalogView.tsx:212` | — | missing | ruled: D184 |
| CA21 | Containment `FactRow` pair — a `w-11` label column carrying `Lives` and `Counts` so the two facts read straight across all three cards | `DemoCatalogView.tsx:53-60`, `:219-222` | — | missing | ruled: D184 |
| CA22 | Containment card `examples[]` bullet list inside `CardBase`, so three cards of two/three examples end on one line | `DemoCatalogView.tsx:225-234` | — | missing | ruled: D184 |
| CA23 | The three containment kinds verbatim — `Member` · `Linked` · `Rejected`, each with its `rule` / `counts` / `lives` sentences | `demo-catalog.ts:455-491` | — | missing | **OPEN — operator call** |
| CA24 | Section 3 head — icon `Layers`, title `Rollup precedence and the one member shape`, blurb `A group's status is never authored — it is rolled up from its members through one shared function. …` | `DemoCatalogView.tsx:242-246` | — | missing | ruled: D184 |
| CA25 | Rollup card — `Rollup precedence` label at `dsText.ui font-semibold` + the paragraph `First match wins. A rejected member is excluded entirely — but an otherwise-verified group holding one drops to Done with warnings, so a packet with an unreadable page can never read as clean.` | `DemoCatalogView.tsx:247-252` | — | missing | ruled: D184 |
| CA26 | Rollup chain — `ROLLUP_STEPS` (derived from `ROLLUP_PRECEDENCE` through `PROPOSED_STATUS[s].label`, never authored) drawn as `catalogChip`s separated by `<ArrowRight dsIcon.sm text-fg-faint>` | `DemoCatalogView.tsx:253-260`, `demo-catalog.ts:493` | — | missing | ruled: D184 |
| CA27 | Member-shape card — `MEMBER_SHAPE.range` as the `h3`, an `ExampleButton`, and the `what` paragraph; ONE entry because there is one shape (the ladder had four rungs, then three, now none) | `DemoCatalogView.tsx:262-275`, `demo-catalog.ts:495` | — | missing | ruled: D184 |
| CA28 | Section 4 head — icon `PanelRight`, title `Log Panels — 4 kinds, tabs derived not fixed`, blurb `One Log Panel surface, but the tab set comes from the row you selected — read here off the same derivation the panel calls, so this page cannot document a tab set the product does not have. …` | `DemoCatalogView.tsx:280-284` | — | missing | ruled: D184 |
| CA29 | Panel-kind grid — `grid gap-2.5 min-[1100px]:grid-cols-2` (the one place the page uses a raw `2.5` rather than a space token) | `DemoCatalogView.tsx:285` | — | missing | ruled: D184 |
| CA30 | Panel card heading — `h3` name + `ExampleButton label="Open it"` | `DemoCatalogView.tsx:288-291` | — | missing | ruled: D184 |
| CA31 | Panel card `forRows` line (e.g. `Person Run Row · Document Run Row · Catalog Run Row`) | `DemoCatalogView.tsx:292` | — | missing | ruled: D184 |
| CA32 | Panel card tab specimen — the SAME treatment the real panel uses: a `border-b` strip of `-mb-px border-b-2` items, the first underlined `border-b-[color:var(--ds-accent)] font-semibold`, labels DERIVED from `tabsForPanelKind` + `TAB_LABEL` so the catalog cannot document a tab set the panel does not render | `DemoCatalogView.tsx:294-312`, `demo-catalog.ts:237-259` | — | missing | ruled: D184 |
| CA33 | Panel card default-tab line — `Opens on:` in `text-fg-secondary` followed by `defaultTab` (e.g. `Running → Logs · terminal → Receipt · failed → Logs, on the record it left behind`) | `DemoCatalogView.tsx:313-315` | — | missing | ruled: D184 |
| CA34 | Panel card `Always visible` caps label + `pinned[]` bullets with an info-tinted bullet at 60% opacity | `DemoCatalogView.tsx:317-325` | — | missing | ruled: D184 |
| CA35 | Panel card `Specifics` caps label + `specifics[]` bullets, the ONLY section pinned to `CardBase` (so the slack sits between two labelled sections rather than under the tab specimen) | `DemoCatalogView.tsx:327-343` | — | missing | ruled: D184 |
| CA36 | The four panel-kind names verbatim — `Run Panel` · `Review Panel` · `Group Panel` · `Member Panel` | `demo-catalog.ts:263`,`281`,`300`,`318` | — | missing | **OPEN — operator call** |
| CA37 | Section 5 head — icon `Workflow`, title `Every workflow, and the rows it produces`, blurb `The same table read the other way — pick your workflow, see which row variants it puts in the queue and what is specific about each.` | `DemoCatalogView.tsx:351-355` | — | missing | ruled: D184 |
| CA38 | Workflow-map table — `overflow-hidden border rounded-lg`, one row per workflow, `w-40` code+label column (`code` in `dsText.nums text-fg-muted`, label in `dsText.ui font-medium`), then a `w-40` variant column and a note column, `border-t` between rows | `DemoCatalogView.tsx:356-379` | — | missing | ruled: D184 |
| CA39 | `byWorkflow` inversion — the variant→workflows mapping read back the other way and sorted by label, computed in a `useMemo` rather than authored twice | `DemoCatalogView.tsx:116-126` | — | missing | ruled: D184 |
| CA40 | The selector catalog as a surface at all — `UiCatalogWorkspace`, read-only, serving the COMMITTED `generated/ui-catalog.json` and refusing a stale one | — | `ui-catalog.tsx:155-299` | extra | ruled: D177 (ref operator-trust §5.8) |
| CA41 | Entry point — the catalog has NO control anywhere; it is reachable only by typing `?catalog=` (`top-bar.tsx:1128-1130` records the glyph's removal as an operator decision, while dashboard-surfaces §9.5.3 still describes two `ghost` buttons in the panel action bar) | — | `top-bar.tsx:1128-1130`, `url-state.ts:36-41` | extra | **OPEN — operator call** |
| CA42 | `PanelHeader title="UI catalog"` | — | `ui-catalog.tsx:224` | extra | ruled: D177 |
| CA43 | `PanelHeader subtitle="The committed selector-semantics catalog, exactly as generated"` | — | `ui-catalog.tsx:225` | extra | ruled: D177 |
| CA44 | `PanelHeader icon={<BookMarked dsIcon.lg>}` | — | `ui-catalog.tsx:226` | extra | ruled: D177 |
| CA45 | `PanelHeader meta` = the tracked artifact path (`generated/ui-catalog.json`), so the surface names the bytes it served | — | `ui-catalog.tsx:227` | extra | ruled: operator-trust §5.8 |
| CA46 | Header action — `IconButton size="sm" label="Close the UI catalog"` with `<X dsIcon.md>` | — | `ui-catalog.tsx:228-235` | extra | ruled: D177 |
| CA47 | `PanelToolbar label="Search the UI catalog"` | — | `ui-catalog.tsx:238` | extra | ruled: D177 |
| CA48 | `SearchInput` placeholder — `kuali save · observation · ucpath person org` | — | `ui-catalog.tsx:243` | extra | ruled: D177 |
| CA49 | `SearchInput` aria-label — `Search the UI catalog by id, label, system or search term` | — | `ui-catalog.tsx:242` | extra | ruled: D177 |
| CA50 | `SearchInput` sizing `w-full max-w-[28rem]` + `onClear` rendering a `Clear search` button | — | `ui-catalog.tsx:240`, `:245` | extra | ruled: D177 |
| CA51 | Result count beside the box — `{n} entries` when unfiltered, `{n} of {m} entries` when filtered | — | `ui-catalog.tsx:247-253` | extra | ruled: D177 |
| CA52 | Search semantics — case-insensitive substring over whitespace-split terms where EVERY term must hit, matched against `id` + `label` + `system` + `kind` + `searchTerms`, defined once in `matchesUiCatalogQuery` so the surface and its tests agree | — | `src/domain/dashboard/explorer.ts:599-620` | extra | ruled: operator-trust §5.8 |
| CA53 | Grouping — one `<section aria-label="{system}">` per system in `localeCompare` order, headed `SectionLabel` reading `{system} · {n} entr{y\|ies}` | — | `ui-catalog.tsx:287-296` | extra | ruled: operator-trust §5.8 |
| CA54 | Row kind `Badge` — `Screen` / `Element` / `Page state` / `Observation`, with ONLY `observation` tinted (`info`) | — | `ui-catalog.tsx:64-69`, `:97` | extra | ruled: dashboard-surfaces §9.5.3 ("one saturated mark, spent on consequence") |
| CA55 | Row identity line — entry `id` at `dsText.ui dsText.nums font-medium` followed by `label` at `dsText.meta text-fg-secondary` | — | `ui-catalog.tsx:98-101` | extra | ruled: D177 |
| CA56 | Row fact chips (band 1) — `system`, `screen`, `role`, `effect` (tinted `warning` when not `observe`), `authoritative for` (`info`), `sensitivity` (tinted `warning` when `hr`) | — | `ui-catalog.tsx:104-124` | extra | ruled: dashboard-surfaces §9.5.3 |
| CA57 | Row provenance chips (band 2) — `verified` with `<ScanEye dsIcon.sm>`, `fixture`, `live`, `owner`, all at the same weight as the id rather than behind a disclosure | — | `ui-catalog.tsx:126-133` | extra | ruled: operator-trust §5.8 ("provenance sits beside the id, not behind it") |
| CA58 | Row `used by` chips — one per `taskUses` entry, reversed out of the catalog's own data rather than recomputed by walking recipes | — | `ui-catalog.tsx:135-141` | extra | ruled: operator-trust §5.7 (UI links are reversed out of the catalog's own `taskUses`) |
| CA59 | Row trailing `MetaLine tone="faint"` — `search: {terms joined by " · "}` and `{n} verification scenario(s)`; the scenario NAMES in `verification.scenarios` are counted and never listed | — | `ui-catalog.tsx:143-150` | extra | **OPEN — operator call** |
| CA60 | Row separator — `border-b border-border-subtle py-base last:border-b-0` on each `<li>` | — | `ui-catalog.tsx:95` | extra | ruled: D177 |
| CA61 | Loading arm — `Spinner label="Loading the UI catalog"` + copy `Reading the committed catalog…` | — | `ui-catalog.tsx:257-262` | extra | ruled: frontend-backend-integration §"Where the frontend keeps its half" (AsyncResource) |
| CA62 | Failed arm — `Banner tone="danger" title="The committed UI catalog could not be served"` carrying the generator's own remediation message, drawn as a refusal rather than an outage | — | `ui-catalog.tsx:264-273` | extra | ruled: operator-trust §5.8 |
| CA63 | Empty arm — `EmptyState` with `<CircleAlert dsIcon.lg>`, title `Nothing in the catalog matches “{query}”` (typographic quotes), description `All {n} entries were searched by id, label, system, kind and registered search terms. Try one word — a system (kuali), a kind (observation), or part of an id (timekeeper).` | — | `ui-catalog.tsx:275-285` | extra | ruled: D177 |
| CA64 | Reading measure — `PanelBody className="px-cozy [&>*]:max-w-[var(--ds-w-explorer-measure)]"` (1120px), content at the leading edge rather than centred | — | `ui-catalog.tsx:256` | extra | ruled: dashboard-surfaces §9.5.3 as-built notes |
| CA65 | Arrival motion — the same `ds-motion-enter` + `translate-y-[calc(-1*var(--ds-travel-sm))]` the intake and explorer takeovers use | — | `ui-catalog.tsx:212-221` | extra | ruled: dashboard-surfaces §9.5.3 as-built notes |
| CA66 | Panel `aria-label="UI catalog"` on the takeover root | — | `ui-catalog.tsx:214` | extra | ruled: D177 |
| CA67 | Regenerate control — deliberately NOT offered; `npm run ui:catalog` is the one writer, and a surface that regenerated on read would silently heal a stale checkout | — | `ui-catalog.tsx:24-27` | extra | ruled: operator-trust §5.8 |
| CA68 | Four tracked per-store markdown projections of the same catalog (`src/stores/{ucpath,kuali,crm,new-kronos}/UI-CATALOG.md`), rendered by no surface | — | `src/stores/kuali/UI-CATALOG.md` | extra | ruled: operator-trust §5.8 |
| CA69 | Parity coverage — the `catalog-search` scene is frozen at three viewports × two themes, driven with `kuali` typed and asserting `33 of 120 entries` | — | `tests/parity/references/catalog-search--graphite-warm--1440x900.a11y.yml:1-71` | extra | ruled: D132 |

**Counts:** exact 0 · divergent 0 · missing 39 · extra 30 · OPEN 6

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

**Demo:** `DemoIntake.tsx` (1091) + `demo-data-intake.ts` (892), launched from `DemoRunStart.tsx:1008` as a Radix dialog off the Run Modal's `spreadsheet` method · **Rebuild:** `surfaces/intake.tsx` (1361), a `Panel` workspace at `?intake=<sessionId>`

The two surfaces share a vocabulary and almost nothing else structurally. The demo is a **six-stage wizard in a dialog** — `File › Header row › Mapping › Validate › Manifest › Rerun diff`, a `StageRail` across the top, a footer whose primary button changes verb per stage. The rebuild is a **three-band workspace with two tabs** (`Mapping` / `Review`) and a sticky outcome band, which D173 ratifies explicitly and at length. That reshaping is ruled and is not the finding. **The finding is what fell out during the reshape and was never re-homed: stages 5 and 6 have no rebuild surface at all.** The demo's `ManifestStage` — plan id, source sha, artifact id, mapping fingerprint, mapping snapshot hash, workflow contract fingerprint, created-at, the derived totals line, and the per-source-row disposition table with item id / input hash / parsed input — renders **nowhere** in the rebuild; the enqueued banner shows one bare `manifest <uuid>` in a MetaLine. And the demo's `RerunStage` added/removed item lists are unserved by `RerunDiffSchema`, which carries only five `{what, was, now}` axis digests. Second finding, smaller but reachable by ordinary use: the demo gates `Review the plan` behind an explicit *"I have read all N rejected rows"* checkbox and doc `data-intake-and-edit-data.md` §2.2 step 4 says Run is *"Enabled only when … the operator has reviewed the rejection list"* — the rebuild's `Run` is enabled the moment validation returns, with four unresolved rejections on screen (see `intake-review--paper-ink--1280x720.a11y.yml`, `button "Run 3 rows"`, not disabled), and the courtesy blocker list in `OutcomeBand` omits `unresolved-rejections` entirely. The kernel refuses it, so nothing wrong is filed — but the operator presses a live button and is answered with a refusal the band could have named before the press. Third: every per-column and per-candidate **number the demo shows is served and dropped** — header-candidate `confidence`, suggestion `score`, binding origin.

| # | Element | Demo | Rebuild | Verdict | Reason |
|---|---------|------|---------|---------|--------|
| IN1 | Container: Radix `Dialog` + `DialogContent size="xl"` vs `Panel` workspace at `?intake=<sessionId>` | `DemoIntake.tsx:263` | `intake.tsx:1316` | divergent | ruled: D173 |
| IN2 | Title copy: "Spreadsheet intake" vs "Import a spreadsheet" | `DemoIntake.tsx:266` | `intake.tsx:1318` | divergent | **OPEN — operator call** |
| IN3 | Subtitle: "A sheet becomes N runs only after a header row, an operator-built column mapping, and a per-cell accept-or-reject on every row." vs "&lt;workflowLabel&gt; — one run per row" | `DemoIntake.tsx:267` | `intake.tsx:1319` | divergent | **OPEN — operator call** |
| IN4 | Header icon — neither surface puts one on the title | `DemoIntake.tsx:264` | `intake.tsx:1317` | exact | — |
| IN5 | Header action "Another file" (ghost, `RotateCcw` `dsIcon.sm`) | — | `intake.tsx:1323` | extra | ruled: D173 |
| IN6 | Back button (footer, ghost, `ArrowLeft` `dsIcon.md`, steps one stage back) | `DemoIntake.tsx:365` | — | missing | ruled: D173 |
| IN7 | Dismiss control: footer "Cancel" (secondary) vs header "Close" (ghost, sm) | `DemoIntake.tsx:373` | `intake.tsx:1332` | divergent | **OPEN — operator call** |
| IN8 | Footer meta echoes `header row N` | `DemoIntake.tsx:357` | `intake.tsx:1029` (`intake-model.ts:96`) | exact | **ported** `80967ce5` (F2 a) — the sticky outcome band is this workspace's footer |
| IN9 | Footer meta echoes `fingerprint <first 8>` | `DemoIntake.tsx:358` | `intake.tsx:1029` (`intake-model.ts:96`) | exact | **ported** `80967ce5` (F2 a) — `shortHash` is 8, the demo's own prefix |
| IN10 | Stage indicator: `<nav aria-label="Intake stages — step N of 6">` vs `TabList label="Intake stage"` with 2 tabs | `DemoRunStartKit.tsx:441` | `intake.tsx:1255` | divergent | ruled: D173 |
| IN11 | Stage "File" | `DemoIntake.tsx:92` | — | missing | ruled: D173 |
| IN12 | Stage "Header row" (a stage) vs a `Field` inside the source band | `DemoIntake.tsx:93` | `intake.tsx:311` | divergent | ruled: D173 |
| IN13 | Stage "Mapping" | `DemoIntake.tsx:94` | `intake.tsx:1256` | exact | — |
| IN14 | Stage "Validate" vs tab "Review" | `DemoIntake.tsx:95` | `intake.tsx:1263` | divergent | ruled: D173 |
| IN15 | Stage "Manifest" | `DemoIntake.tsx:96` | — | missing | **OPEN — operator call** |
| IN16 | Stage "Rerun diff" | `DemoIntake.tsx:97` | — | missing | **OPEN — operator call** |
| IN17 | Stage separator glyph `›` (`dsText.meta`, muted before / faint after) | `DemoRunStartKit.tsx:455` | — | missing | ruled: D173 |
| IN18 | Settled-stage `Check` glyph in `--ds-success-fg` vs a numeric `count` on the tab | `DemoRunStartKit.tsx:466` | `intake.tsx:1256` | divergent | ruled: D173 |
| IN19 | Unsettled-stage ordinal numeral (`dsText.nums`, opacity 80 current / 60 other) | `DemoRunStartKit.tsx:468` | — | missing | ruled: D173 |
| IN20 | `aria-current="step"` on the current stage vs tab `[selected]` | `DemoRunStartKit.tsx:462` | `intake-mapping…a11y.yml:44` | divergent | ruled: D173 |
| IN21 | Enqueue-applied banner: success tone, `CheckCircle2` `dsIcon.lg`, headline + detail + created `KeyValueList` + MetaLine(clock, `requested by …`) | `DemoRunStartKit.tsx:336` | `intake.tsx:1221` | divergent | **OPEN — operator call** |
| IN22 | Enqueued copy: demo's headline/detail pair vs "This file has been enqueued" + "Its rows are now runs in the queue. The manifest is the join…" | `DemoRunStartKit.tsx:339` | `intake.tsx:1223` | divergent | **OPEN — operator call** |
| IN23 | Enqueued action: demo "Close" (secondary) vs "Show the runs" | `DemoRunStartKit.tsx:341` | `intake.tsx:1225` | divergent | **OPEN — operator call** |
| IN24 | Conflict arm: warning `Banner` + `form built against contract` / `server serves contract` `KeyValueList` + "Reload the form" vs `Refusal` "This session moved while you were reading it" code `version-conflict` meta `now at version N` + "Dismiss" | `DemoRunStartKit.tsx:359` | `intake.tsx:216` | divergent | **OPEN — operator call** |
| IN25 | Transport arm "The command did not reach the server" | — | `intake.tsx:233` | extra | ruled: D173 |
| IN26 | Rejected arm: `Refusal` "The server refused that" / outcome "nothing changed" | — | `intake.tsx:210` | extra | ruled: D173 |
| IN27 | Visible `SectionLabel` "Source file" vs a bare `aria-label="Source file"` region with no printed label | `DemoIntake.tsx:414` | `intake.tsx:274` | divergent | **OPEN — operator call** |
| IN28 | Source-file picker: list of fixture sheet `Card`s (interactive, `selected`, `aria-pressed`, Enter/Space) | `DemoIntake.tsx:418` | — | missing | ruled: D173 |
| IN29 | Sheet card glyph `FileSpreadsheet` `dsIcon.lg` shrink-0 muted | `DemoIntake.tsx:433` | `intake.tsx:276` | exact | — |
| IN30 | Sheet card meta `<size> · N rows read · sha <8>` | `DemoIntake.tsx:437` | `intake.tsx:283` | divergent | **OPEN — operator call** |
| IN31 | File size label (e.g. "28 KB") | `DemoIntake.tsx:437` | — | missing | unserved: `IntakeSessionWire.artifact` carries no byte size — UNBOOKED |
| IN32 | `Chip label="target"` naming the destination workflow on the file row | `DemoIntake.tsx:440` | — | missing | **OPEN — operator call** |
| IN33 | `Badge tone="info"` `mapping <savedMappingHint>` on the file row | `DemoIntake.tsx:441` | — | missing | unserved: no saved-mapping join on `IntakeSessionWire` — UNBOOKED |
| IN34 | `Well`: "The parser returns detected columns and a few sample values per column — never the whole file to this surface. Row values are read again, server-side, at validation." | `DemoIntake.tsx:447` | — | missing | **OPEN — operator call** |
| IN35 | `Dropzone` (`<label>` over a real `<input type="file">`, never filters a dropped file) | — | `intake.tsx:1193` | extra | ruled: D173 |
| IN36 | Dropzone idle copy "Drop a spreadsheet of people for &lt;workflowLabel&gt;" | — | `intake.tsx:1194` | extra | ruled: D173 |
| IN37 | Dropzone hint "A .csv or .xlsx, up to 25 MB. Nothing runs until you map its columns and review what it rejects." | — | `intake.tsx:1196` | extra | ruled: D173 |
| IN38 | Accepted types `.csv,.xlsx,.xls` as a picker HINT only | — | `intake.tsx:115` | extra | ruled: D173 |
| IN39 | Drag-over state: accent border + `--ds-accent-quiet` fill, `Upload` glyph turns accent; depth counter not a boolean | — | `primitives-form.tsx:717` | extra | ruled: D173 |
| IN40 | Dropzone busy state: `cursor-progress opacity-70`, label swaps to "Reading…" | — | `primitives-form.tsx:671` | extra | ruled: D173 |
| IN41 | Upload refusal `Refusal` "That file could not be read" / outcome "no session was opened" | — | `intake.tsx:1189` | extra | ruled: D173 |
| IN42 | `CaptureStart` mounted as a peer of the dropzone | — | `intake.tsx:1204` | extra | ruled: D175 |
| IN43 | Loaded file name, with a fallback sentence "(this session predates file names)" | `DemoIntake.tsx:435` | `intake.tsx:279` | divergent | ruled: D133 |
| IN44 | Digest: `sha <8>` vs `sha256 <12>…` | `DemoIntake.tsx:437` | `intake.tsx:283` | divergent | **OPEN — operator call** |
| IN45 | Row count: "N rows read" vs "N data rows" | `DemoIntake.tsx:437` | `intake.tsx:284` | divergent | **OPEN — operator call** |
| IN46 | Column count "N columns" | — | `intake.tsx:285` | extra | **OPEN — operator call** |
| IN47 | "uploaded &lt;h:mm AM&gt;" | — | `intake.tsx:286` | extra | **OPEN — operator call** |
| IN48 | Session-state `Badge` (`mapping` / `validated` / `enqueued`), success tone when enqueued | — | `intake.tsx:291` | extra | ruled: D173 |
| IN49 | Sheet picker `Field label="Sheet"` + `Select`, shown only when `sheets.length > 1` | — | `intake.tsx:296` | extra | ruled: D173 |
| IN50 | Header-row proposal: info `Banner` titled "The parser proposes row N" + "A proposal, with its reasoning — not a decision. Every downstream binding is keyed to the row you confirm here…" | `DemoIntake.tsx:464` | `intake.tsx:312` | divergent | ruled: D173 |
| IN51 | Header candidates as selectable `Card`s vs `<option>`s inside one `Select` | `DemoIntake.tsx:472` | `intake.tsx:321` | divergent | ruled: D173 |
| IN52 | `Chip label="row"` per candidate | `DemoIntake.tsx:488` | `intake.tsx:323` | divergent | ruled: D173 |
| IN53 | Per-candidate `confidence 0.96` (2dp) | `DemoIntake.tsx:489` | `intake.tsx:332` (`intake-model.ts:61`) | divergent | **ported** `80967ce5` (F2 a) — the fact lands, in the ` · ` slot of the option label, because D173 made the candidate list one `Select` and an `<option>` carries text alone |
| IN54 | Per-candidate `why` sentence, e.g. "6 of 6 cells distinct and non-empty; 5 match known field aliases" | `DemoIntake.tsx:490` | — | missing | unserved: `ServedHeaderCandidateSchema` omits `signals` and has no prose field — UNBOOKED |
| IN55 | Candidate row preview: ALL non-empty cells joined ` · ` vs first 6 only inside the option label | `DemoIntake.tsx:493` | `intake.tsx:323` | divergent | **OPEN — operator call** |
| IN56 | "(empty row)" fallback for a candidate whose cells are all blank | `DemoIntake.tsx:493` | — | missing | **OPEN — operator call** |
| IN57 | Confirm button "Use row N as the header" (primary, `Table2` `dsIcon.md`) vs applying on `change` | `DemoIntake.tsx:501` | `intake.tsx:318` | divergent | ruled: D173 |
| IN58 | Discovery-reason sentences (4 arms: `no-rows` / `ambiguous-candidates` / no-confident / `preselected`) | — | `intake.tsx:370` | extra | ruled: D173 |
| IN59 | Layout-change confirm: warning `Banner` "Changing the layout discards the decisions made under the old one" with the exact bound/correction/exclusion counts, "Keep this layout" + "Change it anyway" (danger) | — | `intake.tsx:332` | extra | ruled: D173 |
| IN60 | Saved-mapping banner "Saved mapping loaded — &lt;id&gt;, saved &lt;YYYY-MM-DD&gt;" + "…shown, not applied silently — nothing runs until you look at them." | `DemoIntake.tsx:542` | — | missing | unserved: no saved-mapping join on `IntakeSessionWire` — UNBOOKED |
| IN61 | New-layout banner "New layout — nothing is pre-filled" + "…Every field starts **unbound**; the suggestions below are proposals you accept, never guesses that are applied for you." | `DemoIntake.tsx:547` | — | missing | **OPEN — operator call** |
| IN62 | Reverted-binding danger banner `“<field>” reverted to unmapped` + the stored-position-is-not-a-fallback paragraph + `mapping.note` | `DemoIntake.tsx:554` | — | missing | unserved: no saved-mapping join on `IntakeSessionWire` — UNBOOKED |
| IN63 | Pending-confirmation warning banner "N reused binding needs confirming" + "…two identical headings are semantically unknowable." | `DemoIntake.tsx:564` | — | missing | unserved: `ColumnBindingSchema` has no `confirmationRequired` — UNBOOKED |
| IN64 | Table accessible name: "Column mapping for &lt;fileName&gt;" vs "Map &lt;workflowId&gt; fields to columns of &lt;sourceName&gt;" | `DemoIntake.tsx:571` | `intake.tsx:440` | divergent | **OPEN — operator call** |
| IN65 | Grid column count: 4 (Target field / Source column / Samples / Suggestion) vs 3 (Samples folded under Bound column) | `DemoIntake.tsx:574` | `intake.tsx:443` | divergent | ruled: D173 |
| IN66 | `TH` "Target field" vs "Workflow field" | `DemoIntake.tsx:575` | `intake.tsx:443` | divergent | **OPEN — operator call** |
| IN67 | `TH` "Source column" vs "Bound column" | `DemoIntake.tsx:576` | `intake.tsx:444` | divergent | ruled: D173 |
| IN68 | `TH` "Samples" as its own column | `DemoIntake.tsx:577` | — | missing | ruled: D173 |
| IN69 | `TH` "Suggestion" vs "Suggested" | `DemoIntake.tsx:578` | `intake.tsx:445` | divergent | **OPEN — operator call** |
| IN70 | Required marker: aria-hidden `*` in `--ds-fg-danger`, `ml-0.5`, inline after the label vs `Badge tone="warning">required` | `DemoIntake.tsx:594` | `intake.tsx:491` | divergent | **OPEN — operator call** |
| IN71 | Field sub-line: `<canonicalLabel> · <rule>` (e.g. "UCPath EID · 10 followed by 6 digits") vs MetaLine `<targetFieldId>` + `canonical <canonicalFieldId>` | `DemoIntake.tsx:600` | `intake.tsx:493` | divergent | unserved: `IntakeTargetSchema` has no `rule` and no `canonicalLabel` — UNBOOKED |
| IN72 | Select accessible name "Source column for &lt;label&gt;" vs "Column bound to &lt;label&gt;" | `DemoIntake.tsx:607` | `intake.tsx:520` | divergent | **OPEN — operator call** |
| IN73 | Empty option label "— unbound —" vs "— not bound —" | `DemoIntake.tsx:611` | `intake.tsx:532` | divergent | **OPEN — operator call** |
| IN74 | Duplicate-heading option label `Header (#2)` vs `Header (2)` | `DemoIntake.tsx:514` | `intake.tsx:387` | divergent | **OPEN — operator call** |
| IN75 | Blank-header option label "(blank header)" | — | `intake.tsx:386` | extra | **OPEN — operator call** |
| IN76 | Choosing the empty option UNBINDS the field vs the empty option is inert (`if (next.length === 0) return`) | `DemoIntake.tsx:207` | `intake.tsx:528` | divergent | ruled: D173 |
| IN77 | `Chip label="from"` printing the binding origin (`saved` / `suggestion` / `manual`) | `DemoIntake.tsx:620` | — | missing | unserved: `ColumnBindingSchema` has no `origin` — UNBOOKED |
| IN78 | "Confirm which column" (sm, outline) on an ambiguous reused binding | `DemoIntake.tsx:622` | — | missing | unserved: `ColumnBindingSchema` has no `confirmationRequired` — UNBOOKED |
| IN79 | Samples: dedicated `TD numeric max-w-[220px]` truncating `bound ?? suggested` samples joined ` · `, `—` when none vs a `dsText.meta dsText.nums` line under the Select, first 3 only, absent when unbound | `DemoIntake.tsx:630` | `intake.tsx:539` | divergent | ruled: D173 |
| IN80 | Suggestion cell shape: at most ONE proposal, plain text vs N proposals, each a recessed dashed `--ds-recess-*` box | `DemoIntake.tsx:634` | `intake.tsx:579` | divergent | ruled: D173 |
| IN81 | Accept verb: `Accept “<column label>”` / `Accepted` (disabled when already bound) vs `Use it` with `aria-label="Bind <column label>"` | `DemoIntake.tsx:645` | `intake.tsx:597` | divergent | ruled: D173 |
| IN82 | Suggestion score printed as `(0.94)` | `DemoIntake.tsx:637` | `intake.tsx:609` (`intake-model.ts:75`) | exact | **ported** `80967ce5` (F2 a) — parenthesised after the reason, same muted span |
| IN83 | Suggestion reason: composed prose `“Employee Name” matches the alias “employee name”` vs a fixed 4-term vocabulary joined `", "` (`known header` / `matches the field label` / `words in common` / `its values parse`) | `DemoIntake.tsx:637` | `intake.tsx:128` | divergent | unserved: `SuggestionSchema.why` is a closed enum array, not prose — UNBOOKED |
| IN84 | Ambiguity note "another column scores the same — check both" | — | `intake.tsx:605` | extra | ruled: D173 |
| IN85 | "no proposal" in `dsText.meta` + `--ds-fg-faint` | `DemoIntake.tsx:649` | `intake.tsx:572` | exact | — |
| IN86 | Duplicate-header dialog: title `Which “<header>” column means <label>?`, description, one `Card` per candidate with `Header — occurrence N`, `Badge "saved binding"`, samples, `Use this one` (primary, `Check` `dsIcon.md`), footer Cancel | `DemoIntake.tsx:682` | — | missing | unserved: no saved-mapping join / `confirmationRequired` on `IntakeSessionWire` — UNBOOKED |
| IN87 | Mapping empty state "No header row is settled yet" + "Columns are read relative to the header row…" (`Table2` `dsIcon.lg`) | — | `intake.tsx:428` | extra | ruled: D173 |
| IN88 | Advance verb: footer `Validate N rows` (primary, disabled when nothing is bound) vs sticky-band `Validate` / `Re-validate` (secondary) | `DemoIntake.tsx:377` | `intake.tsx:994` | divergent | ruled: D173 |
| IN89 | Counts strip: `Chip`s rows / valid / rejected / excluded / corrected with tone flips vs `CountBadge` + "of N rows would run" + MetaLine "N rejected", "N excluded" | `DemoIntake.tsx:761` | `intake.tsx:952` | divergent | ruled: D173 |
| IN90 | `corrected` count | `DemoIntake.tsx:769` | — | missing | unserved: `IntakeValidationWireSchema` has no `corrected` (it exists on `IntakeManifestTotalsSchema`) — UNBOOKED |
| IN91 | "N rejection event(s) recorded" | `DemoIntake.tsx:771` | — | missing | unserved: `IntakeValidationWireSchema` has no `rejectionEvents` — UNBOOKED |
| IN92 | Client-side block `Refusal` "This plan cannot start" + code + outcome "nothing is enqueued" + "Back to mapping" action | `DemoIntake.tsx:776` | — | missing | ruled: D173 |
| IN93 | Block codes and their verbatim messages: `required-field-unmapped`, `duplicate-header-unconfirmed`, `no-valid-rows` | `demo-data-intake.ts:784` | — | missing | unserved: `enqueueReadiness`'s verdict is not on `IntakeSessionWire`; it is only reachable by pressing Run — UNBOOKED |
| IN94 | Mis-map hint: warning `Banner` "This looks like the wrong column" + "Re-map it" action + "…all N rows failed &lt;kind&gt; coercion. Wrong column?" + "Every row failing the same way is a mapping problem, not N data problems" | `DemoIntake.tsx:793` | — | missing | unserved: no mis-map hint on `IntakeValidationWireSchema` — UNBOOKED |
| IN95 | No-rejections empty state: "No rejections" / "Every source row coerced and parsed cleanly…" vs "All N rows are runnable" / "Nothing was rejected and nothing was excluded, so every row in this file would fan out." (`CheckCircle2` `dsIcon.lg`) | `DemoIntake.tsx:809` | `intake.tsx` `ValidationReview` | exact | **ported** 2026-08-26 — the empty arm now uses the demo vocabulary |
| IN96 | Not-yet-validated empty state ("This mapping has not been validated", two-arm description, `ListChecks` `dsIcon.lg`) | — | `intake.tsx:640` | extra | ruled: D173 |
| IN97 | MetaLine "validated &lt;clock&gt;" / "values read as of &lt;clock&gt;" | — | `intake.tsx:667` | extra | **OPEN — operator call** |
| IN98 | Review preamble "Every rejected row is fixed or excluded before this file can run — there is deliberately no way to ignore one. An exclusion is durable and keeps the reason it was made with." | — | `intake.tsx:682` | extra | **OPEN — operator call** |
| IN99 | Rejections layout: one `Table` row PER REJECT (Row / Kind / Field-column / Why / Resolve) vs one `<section aria-label="Source row N">` card per SOURCE ROW | `DemoIntake.tsx:816` | `intake.tsx` `RejectedRowsTable` | exact | **ported** 2026-08-26 |
| IN100 | Reject kind marker: `Badge` printing the raw kind, warning for `duplicate-identity`/`cross-field` and danger otherwise vs `Badge tone="danger"` printing a re-worded code label for all six | `DemoIntake.tsx:833` | `intake.tsx` `RejectedRowsTable` | exact | **ported** 2026-08-26 |
| IN101 | Reject vocabulary: raw kinds vs "unmapped field" / "cell could not be read" / "value out of shape" / "row rejected by the workflow" / "duplicate person" / "fields disagree" | `demo-data-intake.ts:523` | `intake.tsx` `RejectedRowsTable` | exact | **ported** 2026-08-26 |
| IN102 | Row number: `TD numeric align="right"` vs `Chip label="row" tone="danger"` | `DemoIntake.tsx:829` | `intake.tsx` `RejectedRowsTable` | exact | **ported** 2026-08-26 |
| IN103 | Offending column: `“<header>”` in `dsText.meta` muted vs MetaLine item `column <header>` | `DemoIntake.tsx:838` | `intake.tsx` `RejectedRowsTable` | exact | **ported** 2026-08-26 |
| IN104 | Offending value: `raw: <value>` verbatim, `(empty)` when blank vs `value <redacted (class)>` / `<value> (<transform>)` / "(a structured value)" | `DemoIntake.tsx:839` | `intake.tsx:726` | divergent | ruled: D82 |
| IN105 | Reason sentence: composed client-side `<workflow> intake, row N, column “X” (→ field): <reason>` vs the server's `reject.reason` verbatim in a `role="alert"` span | `demo-data-intake.ts:669` | `intake.tsx:793` | divergent | ruled: D173 |
| IN106 | `code <code>` printed under the reason | `DemoIntake.tsx:844` | `intake.tsx:847` | exact | **ported** `780860d0` (F2 b) — first item of the reject's `MetaLine`, so it sits against the reason as the demo draws it |
| IN107 | Fix affordance: "Fix cell" (sm outline) opening a separate editor `Card` vs an always-present inline `Input` + "Fix cell" per correctable reject | `DemoIntake.tsx:849` | `intake.tsx` `RejectedRowsTable` | exact | **ported** 2026-08-26 |
| IN108 | Fix editor heading `Correct row N · <targetFieldId>` | `DemoIntake.tsx:866` | `intake.tsx` `RejectedRowsTable` | exact | **ported** 2026-08-26 |
| IN109 | Fix `Field label="Corrected value"` + description "The source file is never rewritten. The correction is recorded in the manifest with the original beside it, and the value is re-coerced and re-parsed before it can become valid." vs a bare placeholder `corrected <label>` | `DemoIntake.tsx:869` | `intake.tsx` `RejectedRowsTable` | exact | **ported** 2026-08-26 |
| IN110 | Fix commit verb "Re-coerce this cell" (primary, `Check` `dsIcon.md`, disabled when blank OR unchanged) vs "Fix cell" (sm, disabled only when blank) | `DemoIntake.tsx:879` | `intake.tsx:821` | divergent | **OPEN — operator call** |
| IN111 | Fix "Cancel" (secondary, `X` `dsIcon.md`) | `DemoIntake.tsx:876` | `intake.tsx` `RejectedRowsTable` | exact | **ported** 2026-08-26 |
| IN112 | Exclude affordance "Exclude…" (sm outline) opening an editor `Card` vs an always-present inline `Input` + "Exclude row" | `DemoIntake.tsx:853` | `intake.tsx` `RejectedRowsTable` | exact | **ported** 2026-08-26 |
| IN113 | Exclude editor heading `Exclude row N` | `DemoIntake.tsx:888` | `intake.tsx` `RejectedRowsTable` | exact | **ported** 2026-08-26 |
| IN114 | Exclude `Field label="Reason"` `required` + error "An exclusion without a reason is a row that vanished. Say why." + description "Recorded in the manifest with a timestamp, so the receipt can never imply every source row ran." | `DemoIntake.tsx:889` | `intake.tsx` `RejectedRowsTable` | exact | **ported** 2026-08-26 |
| IN115 | Exclude placeholder "duplicate export line — already filed last week" vs "why this person is not in this batch" | `DemoIntake.tsx:895` | `intake.tsx` `RejectedRowsTable` | exact | **ported** 2026-08-26 |
| IN116 | Exclude commit verb "Exclude with this reason" (primary, `Check` `dsIcon.md`) vs "Exclude row" (sm, secondary) | `DemoIntake.tsx:901` | `intake.tsx` `RejectedRowsTable` | exact | **ported** 2026-08-26 |
| IN117 | Separator rule between a row's rejects and its resolve controls | — | `intake.tsx:806` | extra | **OPEN — operator call** |
| IN118 | Review gate: `Checkbox` "I have read all N rejected row(s)" + "Nothing half-launches: the plan stays closed until every non-valid row has been corrected, excluded, or seen." | `DemoIntake.tsx:908` | `intake.tsx` `ValidationReview` | exact | **ported** 2026-08-26 |
| IN119 | Advance gate itself: `canContinueFromValidate = !block && (rejected === 0 \|\| reviewed)` vs `Run` enabled the moment `validation.state === "validated"`, unresolved rejections and all | `DemoIntake.tsx:260` | `intake.tsx` `OutcomeBand` | exact | **ported** 2026-08-26 — the acknowledgement is bound to the exact served rejection set |
| IN120 | Courtesy blocker list: no `unresolved-rejections` entry, so the band cannot say why the kernel will refuse | `demo-data-intake.ts:784` | `intake.tsx` `OutcomeBand` | exact | **ported** 2026-08-26 |
| IN121 | Corrections `Well`: `SectionLabel "Corrections"` + `row N · <field>: “<original>” → “<corrected>”` | `DemoIntake.tsx:918` | `intake.tsx:723` (`intake-model.ts:115`) | divergent | **ported** `780860d0` (F2 b) — the list lands in the demo's slot (after the rejections, before the exclusions), drawn as the exclusions section's twin rather than as a `Well`. The `“<original>” →` half stays **unserved**: `IntakeRowCorrectionSchema` has no `original` — UNBOOKED |
| IN122 | Exclusions block: `Well` + `SectionLabel "Exclusions"` + `row N — <reason>` vs `<section aria-label="Excluded rows">` + `SectionLabel "Excluded by you"` + `Chip label="row"` + reason + MetaLine(`excludedAt`) | `DemoIntake.tsx:929` | `intake.tsx` `ValidationReview` | exact | **ported** 2026-08-26 |
| IN123 | The whole Manifest stage | `DemoIntake.tsx:946` | `intake.tsx` `ManifestStageView` | ported | **ported** 2026-08-25 — preflight reservation remains distinct from a committed terminal manifest |
| IN124 | Manifest success banner "N of M source rows will run" + "Every source row below has exactly one disposition. The counts are derived from those dispositions, never summed from the rejection history…" | `DemoIntake.tsx:954` | `intake.tsx` `ManifestStageView` | exact | **ported** 2026-08-25 |
| IN125 | Manifest `KeyValueList` row `plan id` | `DemoIntake.tsx:962` | `intake.tsx` `ManifestStageView` | divergent | **ported** 2026-08-25 — preflight says `reserved plan id`; terminal says `plan id`, never committed before enqueue |
| IN126 | Manifest row `source` = `<originalName> · sha <12>` | `DemoIntake.tsx:963` | `intake-model.ts` `manifestStage` | exact | **ported** 2026-08-25 |
| IN127 | Manifest row `artifact` = artifact id | `DemoIntake.tsx:964` | `intake-model.ts` `manifestStage` | exact | **ported** 2026-08-25 |
| IN128 | Manifest row `mapping fingerprint` | `DemoIntake.tsx:965` | `intake-model.ts` `manifestStage` | exact | **ported** 2026-08-25 |
| IN129 | Manifest row `mapping snapshot` hash | `DemoIntake.tsx:966` | `intake-model.ts` `manifestStage` | exact | **ported** 2026-08-25 |
| IN130 | Manifest row `workflow contract` fingerprint | `DemoIntake.tsx:967` | `intake-model.ts` `manifestStage` | exact | **ported** 2026-08-25 |
| IN131 | Manifest row `created` instant | `DemoIntake.tsx:968` | `intake-model.ts` `manifestStage` | divergent | **ported** 2026-08-25 — terminal `manifest.createdAt` is the formatted operator clock; upload time remains source metadata |
| IN132 | Manifest row `totals` = `N rows · V valid · R rejected · E excluded · C corrected` | `DemoIntake.tsx:970` | `intake-model.ts` `manifestStage` | exact | **ported** 2026-08-25 |
| IN133 | Source-row disposition `Table` (Row / Disposition / Item / Input hash / Parsed input) | `DemoIntake.tsx:977` | `intake.tsx` `ManifestRows` | ported | **ported** 2026-08-25 — exact local 10-row pages bound eager rendering without claiming D9 virtualization |
| IN134 | Disposition `Badge` tones — valid=success, excluded=neutral, rejected=danger | `DemoIntake.tsx:996` | `intake-model.ts` `manifestStage` | exact | **ported** 2026-08-25 |
| IN135 | Per-row `inputHash` first 10 chars | `DemoIntake.tsx:1001` | `intake.tsx` `ManifestRows` | exact | **ported** 2026-08-25 — full hash remains keyboard/touch reachable in row detail |
| IN136 | Per-row parsed input rendered `key=value · key=value`, or `rejects: <ids>` when the row is not valid, or `—` | `DemoIntake.tsx:1004` | `intake-model.ts` `manifestStage` | exact | **ported** 2026-08-25 — clipped resting text has a keyboard/touch-reachable full-value detail |
| IN137 | "Compare with a prior intake" (outline, `GitCompare` `dsIcon.md`) | `DemoIntake.tsx:388` | — | missing | **OPEN — operator call** |
| IN138 | Run verb: `Start N runs` (primary, `Play` `dsIcon.md`, disabled on block or already-applied) vs `Run N rows` (primary, no icon) | `DemoIntake.tsx:391` | `intake.tsx` `OutcomeBand` | exact | **ported** 2026-08-26 |
| IN139 | Rerun stage empty state "No prior intake of this source" + "…This source has not been imported before, so there is nothing to compare it with — and nothing is invented to fill the gap." | `DemoIntake.tsx:1031` | `intake.tsx` `RerunStageView` | exact | **ported** 2026-08-25 |
| IN140 | Rerun header banner `Compared with <planId>, made <YYYY-MM-DD>` vs "This file has already been enqueued, with this exact plan" / "This file has run before, and the plan has changed since" | `DemoIntake.tsx:1040` | `intake.tsx:876` | divergent | ruled: D171 |
| IN141 | Rerun verdict prose (3 arms — contract changed = "a rerun is a MIGRATION, not a replay"; mapping changed; identical) vs a per-axis `was… → now…` digest list | `demo-data-intake.ts:886` | `intake.tsx:888` | divergent | ruled: D171 |
| IN142 | Rerun chips `unchanged` / `added` / `removed` / `mapping` / `contract` with tone flips | `DemoIntake.tsx:1045` | `intake.tsx` `RerunStageView` | ported | **ported** 2026-08-25 — `changed inputs` is an additional hash-only count required by the served diff |
| IN143 | Two rerun `Well`s: "In this plan, not in &lt;planId&gt;" / "In &lt;planId&gt;, not here", each listing `<itemId> — <label>` or "nothing" | `DemoIntake.tsx` `RerunMembership` | divergent | **ported** 2026-08-25 — exact local 10-row pages list stable item id + input-hash prefix with full detail reachable; an operator-facing item label has no served producer |
| IN144 | Closing rerun banner "Reruns never relabel replayed data as newly observed" (`TriangleAlert` `dsIcon.lg`) + "…Anything it replays is marked as replayed on the receipt; only a value actually re-read from a system is recorded as observed." | `DemoIntake.tsx:1085` | — | missing | **OPEN — operator call** |
| IN145 | Rerun axis vocabulary "the file" / "the mapping" / "the workflow's mappable fields" / "the workflow contract" / "the input schema" | — | `intake.tsx:857` | extra | ruled: D171 |
| IN146 | Rerun meta `manifest <8>…` / `ran <clock>` / `N of M rows ran` | — | `intake.tsx:872` | extra | ruled: D171 |
| IN147 | Sticky outcome band that never scrolls away | — | `intake.tsx:944` | extra | ruled: D173 |
| IN148 | "Not ready — &lt;blockers joined by 'and'&gt;." sentence | — | `intake.tsx:968` | extra | ruled: D173 |
| IN149 | "This mapping has not been validated, so nothing is known about its rows yet." | — | `intake.tsx:969` | extra | ruled: D173 |
| IN150 | Dry-run checkbox in the outcome band, shown only when the descriptor supports it | — | `intake.tsx:977` | extra | ruled: D173 |
| IN151 | Per-control spinner keyed to the in-flight command (`bind:<field>`, `fix:<row>:<field>`, `exclude:<row>`, `validate`, `run`) | — | `intake.tsx:1049` | extra | ruled: D173 |
| IN152 | `Arriving` mount transition wrapper (`--ds-travel-sm`, `dsMotion.enter`) | — | `intake.tsx:186` | extra | ruled: D173 |
| IN153 | Loading skeleton at `--ds-h-review-page-min` while the session reads | — | `intake.tsx:1173` | extra | ruled: D173 |
| IN154 | Read-failure banner "This intake session could not be read" | — | `intake.tsx:1177` | extra | ruled: D173 |
| IN155 | Run-wide constants rendered read-only | — | `intake.tsx:934` (count only; nothing renders them) | missing | ruled: D173 (D173's own text says "CONSTANTS RENDER READ-ONLY"; the surface renders none) |

**Counts:** exact 30 · divergent 49 · missing 42 · extra 34 · OPEN 37

## 7. Phone capture — `DemoCapture.tsx` ↔ `phone/**` + `surfaces/capture-start.tsx`

**Demo:** `DemoCapture.tsx` (430), mounted at `DemoRunStart.tsx:740` as the Run Modal's `capture` method · **Rebuild:** `phone/capture-app.tsx` (595), `phone/capture-client.ts` (298), `phone/phone-controls.tsx` (198), `phone/photo-tile.tsx` (164), `phone/phone.css` (115), `capture.html`, `surfaces/capture-start.tsx` (164)

**These two are not the same surface, and the mismatch is total.** `DemoCapture.tsx` is a **desktop panel** — its own docstring says so: *"what the desktop is served about a phone session, and every page that has landed on it."* The rebuild's `phone/**` is the **phone** — the other end of the same session — and its operator-side counterpart, `capture-start.tsx`, is one button and a QR. So the entire demo surface (the phase badge, the session MetaLine, the unreadable-page banner, the "What was recorded" facts list, the "Pages received" contact sheet and its per-page tiles, the ⓘ disclosure, the multi-session picker) has **no rebuild counterpart at all**, and every one of those rows is `missing`; conversely the whole phone bundle is `extra`, ruled by D175 at length. That is a real structural gap rather than a bookkeeping artefact: after the operator scans the QR there is **no served operator-side view of the capture at all** — `CAPTURE_PHONE_ROUTES` is a closed nine-route union, all phone-scoped, and the only operator route is `POST /api/v1/capture/sessions`, which mints. The operator gets a QR and then silence: no "waiting for phone", no page count, no expiry countdown, no unreadable-page alert, no way to see what landed. Two smaller findings: the demo's unreadable-page banner tells the operator to *"Retake it on the phone"* and the phone has no retake — `PUT /api/v1/capture/phone/photos/:photoId` exists in the route union and `CapturePhoneClient` never implements it, so the only path is Remove then re-photograph. And D174's uniform-refusal rule **is honoured** — the phone renders `resource.message` verbatim for every unresolvable token, and the server has exactly one sentence for all four failure modes (`capture-surface.ts:202`) — so unknown, malformed, expired and discarded genuinely answer identically. The demo has no token concept to compare against.

| # | Element | Demo | Rebuild | Verdict | Reason |
|---|---------|------|---------|---------|--------|
| CP1 | Operator-side section: `aria-label="Capture session"` + visible `SectionLabel "Capture session"` vs `SectionLabel "Or photograph it"` | `DemoCapture.tsx:221` | `capture-start.tsx:106` | divergent | ruled: D175 |
| CP2 | Multi-session `Select` (`aria-label="Open capture session"`, option `<id> · <phase label> · N pages`, width capped at `--ds-w-popover-lg`) | `DemoCapture.tsx:232` | — | missing | unserved: no operator-scoped `GET /api/v1/capture/sessions` — UNBOOKED |
| CP3 | ⓘ `IconButton size="xs"` label "How this demo serves a capture", `aria-expanded`, `Info` `dsIcon.sm` | `DemoCapture.tsx:248` | — | missing | **OPEN — operator call** |
| CP4 | In-place disclosure `Well` + 4-item `BulletList` explaining what the desktop is and is not served | `DemoCapture.tsx:270` | — | missing | **OPEN — operator call** |
| CP5 | No-session `EmptyState` "No capture session is open" + "A capture starts on the phone. Until one is open there is nothing to build a plan from, and nothing here will invent one." (`Camera` `dsIcon.lg`) | `DemoCapture.tsx:201` | — | missing | **OPEN — operator call** |
| CP6 | `SectionLabel "State"` + `Well` holding the session's own facts | `DemoCapture.tsx:294` | — | missing | unserved: no operator-scoped session read — UNBOOKED |
| CP7 | Phase `Badge` with glyph — `awaiting-phone`/`Smartphone`, `awaiting-pages`/`Hourglass`, `receiving`/`ArrowDownToLine`, `blocked`/`CircleAlert` (warning), `ready`/`Play` — all `dsIcon.sm`, and `ready` deliberately NEUTRAL not success | `DemoCapture.tsx:78` | — | missing | unserved: no operator-scoped session read — UNBOOKED |
| CP8 | Session MetaLine: id · deviceLabel or `pairing code <code>` · `opened <clock>` · `paired <clock>` · `last page <clock>` · `expires <clock>` | `DemoCapture.tsx:300` | — | missing | unserved: no operator-scoped session read — UNBOOKED |
| CP9 | Unreadable-page warning `Banner`, singular `Page N could not be read` / plural `N pages could not be read`, body `<reason> Retake it on the phone — focus <score>.` or a `BulletList` per page | `DemoCapture.tsx:316` | — | missing | unserved: no `unreadable`/`focusScore` on `CapturePhotoWireSchema` — UNBOOKED |
| CP10 | `SectionLabel "What was recorded"` + `KeyValueList` — Page N of M / Arrived (to the second) / Pixels W × H / Size / File / Type / Read (warning tone when flagged) | `DemoCapture.tsx:338` | — | missing | unserved: `CapturePhotoWireSchema` carries only `photoId`, `ordinal`, `mediaType`, `bytes`, `artifactId` — no filename, no pixel dimensions, no arrival instant — UNBOOKED |
| CP11 | `SectionLabel "Pages received"` + `CountBadge` | `DemoCapture.tsx:372` | — | missing | unserved: no operator-scoped session read — UNBOOKED |
| CP12 | Contact sheet: `<ul role="list" aria-label="Pages received">` on a `repeat(auto-fill,minmax(var(--ds-w-capacity-cell),1fr))` grid | `DemoCapture.tsx:405` | — | missing | unserved: no operator-scoped session read — UNBOOKED |
| CP13 | Page tile: frame at the page's OWN served `aspectRatio`, `FileText` `dsIcon.md`, `Page N`, arrival clock, then `sizeLabel` or the word `unreadable` on a third always-drawn line | `DemoCapture.tsx:101` | — | missing | unserved: as CP10 — UNBOOKED |
| CP14 | Page tile accessible name `Page N — arrived <h:mm:ss>, <size>, <W> by <H>[, flagged unreadable]` | `DemoCapture.tsx:104` | — | missing | unserved: as CP10 — UNBOOKED |
| CP15 | Tile treatment rule: selection is a FILL (`--ds-surface-selected`), the unreadable flag is an EDGE (`--ds-status-waiting-*`), so inspecting a flagged page cannot repaint its warning | `DemoCapture.tsx:117` | — | missing | unserved: as CP9 — UNBOOKED |
| CP16 | No-page `EmptyState` "No page has arrived yet" with a two-arm description (paired → "…Take the first page on &lt;device&gt;." / not paired → "The phone has not picked this session up. Enter &lt;code&gt; on it to pair.") | `DemoCapture.tsx:381` | — | missing | unserved: no operator-scoped session read — UNBOOKED |
| CP17 | Two-column grid with a 1px divider TRACK reading `--ds-border-strong`, so both columns end level | `DemoCapture.tsx:286` | — | missing | **OPEN — operator call** |
| CP18 | Contact sheet scrolls inside a bordered `Well` capped at `--ds-h-capture-box` | `DemoCapture.tsx:398` | — | missing | **OPEN — operator call** |
| CP19 | Pairing mechanism: a typed `pairingCode` shown as text vs a scanned QR carrying a 32-byte token in the URL fragment | `DemoCapture.tsx:303` | `capture-start.tsx:111` | divergent | ruled: D174 |
| CP20 | The phone link as selectable/copyable text | `DemoCapture.tsx:303` | — | missing | ruled: D174 (the raw token exists for one render and the surface offers no text form on purpose) |
| CP21 | Operator "waiting for phone" state after the session opens | `DemoCapture.tsx:79` | — | missing | unserved: no operator-scoped session read and no poll/SSE for capture — UNBOOKED |
| CP22 | Operator session controls (expire / discard / close from the desktop) — neither surface offers any | `DemoCapture.tsx:220` | `capture-start.tsx:104` | exact | — |
| CP23 | "Start a phone capture" `Button` + `Smartphone` `dsIcon.md`, `loading` while minting | — | `capture-start.tsx:133` | extra | ruled: D175 |
| CP24 | Idle line "Photograph a paper form with a phone instead of uploading a file." + `QrCode` `dsIcon.md` shrink-0 | — | `capture-start.tsx:154` | extra | ruled: D175 |
| CP25 | QR symbol: inline `<svg role="img">` 200px, `shapeRendering="crispEdges"`, one `<path>` in `--ds-fg` on `--ds-surface-1`, accessible name "QR code opening this capture on a phone, for &lt;workflowLabel&gt;" | — | `capture-start.tsx:62` | extra | ruled: D175 |
| CP26 | Started copy "Scan this with the phone's camera" + "The link opens a page that photographs pages and sends them here. It is good for one capture and expires on its own — this code is the only copy, so leave it on screen until the phone has opened it." | — | `capture-start.tsx:116` | extra | ruled: D175 |
| CP27 | `ingress-not-built` refusal: `Refusal` "No phone can reach this dashboard", code "capture ingress", outcome = the server's `remediation`, body = the server's `message` | — | `capture-start.tsx:141` | extra | ruled: D174 |
| CP28 | Transport-fault arm kept separate: "The capture could not be started" / code "request failed" / outcome "no session was opened" | — | `capture-start.tsx:150` | extra | ruled: D174 |
| CP29 | Phone page shell: separate Vite entry `capture.html`, `<title>Photograph a form</title>` (never carries the token), `viewport-fit=cover`, no `maximum-scale` | — | `capture.html` | extra | ruled: D175 |
| CP30 | Phone light theme: `data-demo-theme="light"` on `<html>` and `<body>`, `color-scheme: light` | — | `capture.html` | extra | ruled: D175 |
| CP31 | Phone header: `<h1>` = `session.formType ?? "Photograph a form"` at `--ds-phone-text-lead` (18px) | — | `capture-app.tsx:496` | extra | ruled: D175 |
| CP32 | Phone header context hint paragraph (`session.contextHint`) | — | `capture-app.tsx:500` | extra | ruled: D175 |
| CP33 | Loading state "Opening this capture…" | — | `capture-app.tsx:238` | extra | ruled: D175 |
| CP34 | Token-refusal arm: `role="alert"` tinted box, `AlertTriangle` size-6, "This capture is not open", then the server's ONE sentence "this capture link is not open — ask the operator for a new one" — byte-identical for unknown, malformed, expired and discarded | — | `capture-app.tsx:243` · `capture-surface.ts:202` | extra | ruled: D174 |
| CP35 | Empty phone state "No pages yet" + "Photograph the form one page at a time. You can reorder or remove a page before you send it." | — | `capture-app.tsx:369` | extra | ruled: D175 |
| CP36 | Camera affordance: real `<input type="file" accept="image/*" capture="environment">` inside a `<label>`, value cleared after each change | — | `phone-controls.tsx:176` | extra | ruled: D175 |
| CP37 | Camera label swaps "Take the first page" → "Add a page"; `Camera` size-5; keeps the primary right-hand slot even after the first photograph | — | `capture-app.tsx:460` | extra | ruled: D175 |
| CP38 | Photo tile ordinal: a real numeral at `--ds-phone-numeral` (30px), tabular, `w-[2ch]` right-aligned, `aria-hidden` | — | `photo-tile.tsx:78` | extra | ruled: D175 |
| CP39 | Photo tile thumbnail: 112px wide at `--ds-aspect-page` (US Letter 612×792), `object-contain` letterbox, `loading="eager"`, alt `Page N of M, as photographed` | — | `photo-tile.tsx:96` | extra | ruled: D175 |
| CP40 | Photo tile name line `Page N of M` at lead size; deliberately NO byte count | — | `photo-tile.tsx:123` | extra | ruled: D175 |
| CP41 | Failed-preview arm: `ImageOff` size-5 in `--ds-danger` inside the frame + a `role="alert"` message beside it | — | `photo-tile.tsx:110` | extra | ruled: D175 |
| CP42 | Reorder affordance: explicit `PhoneIconButton` ▲/▼ (`ChevronUp`/`ChevronDown` size-6), never drag, disabled at each end | — | `photo-tile.tsx:134` | extra | ruled: D175 |
| CP43 | Reorder accessible names `Move Page N of M earlier` / `Move Page N of M later` | — | `photo-tile.tsx:135` | extra | ruled: D175 |
| CP44 | Per-page "Remove" `PhoneButton tone="quiet"` + `Trash2` size-5 — deliberately not danger, since red is reserved for Discard | — | `photo-tile.tsx:151` | extra | ruled: D175 |
| CP45 | Retake / replace-in-place a page (demo's unreadable banner says "Retake it on the phone") | `DemoCapture.tsx:325` | — | missing | unserved: `PUT /api/v1/capture/phone/photos/:photoId` is in `CAPTURE_PHONE_ROUTES` and `CapturePhoneClient` implements no `replacePhoto` — UNBOOKED |
| CP46 | Review toggle: `PhoneButton tone="quiet"` + `ListOrdered` size-5, hidden at zero pages | — | `capture-app.tsx:448` | extra | ruled: D175 |
| CP47 | "Done" quiet button leaving reorder mode | — | `capture-app.tsx:413` | extra | ruled: D175 |
| CP48 | Send: `PhoneButton tone="primary" grow` + `Send` size-5, label `Send N page(s)` — the count line, carried by the verb | — | `capture-app.tsx:427` | extra | ruled: D175 |
| CP49 | Sent outcome: success skin, `CheckCircle2` size-6, "N pages sent", "The bundle is in the queue. You can put the phone down." | — | `capture-app.tsx:287` | extra | ruled: D175 |
| CP50 | Sent identities: a `<dl>` of Run + Manifest ids, `ds-nums break-all` | — | `capture-app.tsx:297` | extra | ruled: D174 |
| CP51 | Failed outcome: danger skin, `AlertTriangle` size-6, "N pages could not be sent", the projector's `handoff.message` verbatim in `role="alert"` | — | `capture-app.tsx:322` | extra | ruled: D175 |
| CP52 | Failed actions: "Discard" (danger, `Trash2` size-5) + "Try again" (primary, grow, `RotateCcw` size-5) | — | `capture-app.tsx:339` | extra | ruled: D175 |
| CP53 | Discarded outcome: neutral skin, `Trash2` size-6 muted, "This capture was discarded", "Nothing was sent. Ask the operator for a new link to start again." | — | `capture-app.tsx:306` | extra | ruled: D175 |
| CP54 | Reserved `NoticeSlot`: always in the DOM at `--ds-phone-notice-min` (two body lines), `role="alert"`, `AlertTriangle` size-5, danger-quiet fill | — | `capture-app.tsx:515` | extra | ruled: D175 |
| CP55 | `ActionBar`: `sticky bottom-0`, negative page inset, top border, `env(safe-area-inset-bottom)` padding | — | `capture-app.tsx:541` | extra | ruled: D175 |
| CP56 | Phone control geometry: 48px touch floor, 12px inter-control gap, 16px page inset, 16px body type | — | `phone.css:38` | extra | ruled: D175 |
| CP57 | Press feedback `active:scale-[0.97]` instead of the console's 1px nudge | — | `phone-controls.tsx:76` | extra | ruled: D175 |
| CP58 | Tile settle motion: `.phone-settle` opacity + `translateY(var(--ds-travel-md))` over `--ds-dur-enter`, flipped one frame after mount; no stagger | — | `phone.css:101` · `capture-app.tsx:181` | extra | ruled: D175 |
| CP59 | Tone rule "nothing here claims a page is good — no green, no check, no 'accepted' anywhere; the only tone spent is amber, on the page that cannot be read" | `DemoCapture.tsx:51` | `capture-app.tsx:287` (success green on the sent outcome) | divergent | **OPEN — operator call** (the rebuild's green marks a durable enqueue, not a page verdict; there is no rebuild surface that shows received pages at all) |
| CP60 | `data-parity-ready` on the phone frame, the app's own statement that every page's bytes have resolved | — | `capture-app.tsx:492` | extra | ruled: D175 |
| CP61 | Per-control busy state (`aria-busy`, `Loader2` spins in place of the icon, only THIS control disabled) | — | `phone-controls.tsx:95` | extra | ruled: D175 |
| CP62 | No step indicator on the phone — capture / review / settled are three states of one page | — | `capture-app.tsx:18` | extra | ruled: D175 |

**Counts:** exact 1 · divergent 3 · missing 20 · extra 38 · OPEN 6

---

## 8. The version-bump dialog — `DemoVersionBump.tsx` ↔ `surfaces/archive.tsx` (the bump half)

**Demo:** `DemoVersionBump.tsx` (340) · `demo-archive-wire.ts` (the plan, the labels, the refusals) ·
**Rebuild:** the flow lives INSIDE `surfaces/archive.tsx` — `BumpChangeRecordDialog` (`:1912-2015`),
`BumpRefusal` (`:2152-2186`), `BlockerTable` (`:2188-2217`) and the plan/apply half of `VersionsView`
(`:2225-2495`) · **Parity:** none — no version-bump scene exists.
_Boundary note: region 1 audits the bump's MOUNT and the Versions view around it (AR218–AR241); this
region audits the dialog's own contents and the plan/apply flow._

**The headline is that the demo's two ARMS have no behavioural counterpart in the rebuild.** In the
demo, `kind` is the whole design: **major** moves the run's shape, so it ARCHIVES and a non-terminal
run BLOCKS it; **minor** is presentation only, so it archives nothing, in-flight runs carry on, and
*"there is nothing a run could be doing that would block this"* — the dialog reshapes around the
choice (a different banner, a different blocker table with a different column head, a different
archivable list, different field labels, different placeholders, a different primary button). In the
rebuild, `VersionBumpChangeRecordSchema.kind` (`change-record.ts:30`) is a **pure label**: grepping
`src/domain/archive/`, `src/server/dashboard/queries/archive.ts` and `src/core/command-kernel.ts`
finds no arm that branches on it. So a bump recorded as `minor` archives every prior-version run and
can be refused by a non-terminal one — the two things the demo says a minor bump must never do.

Two structural divergences are RULED and read as improvements. The demo's one dialog does authoring,
preview, refusal and apply in a single press; the rebuild splits it into **author → plan → apply**,
which is D179's own shape (*"apply re-derives candidates AND blockers from authority inside its own
transaction… a refused apply leaves the plan `planned`"*), and the rebuild keeps `Apply the bump`
clickable while blockers exist for D179's stated reason. And the refusal handles the CAS `conflict`
arm beside `rejected`, which is D253.

**One divergence goes the wrong way on the demo's own stated discipline.** The demo's primary button
is never disabled — *"pressing it returns the SERVER's refusal with the blocking runs named, and a
greyed-out button would have hidden the one rule this flow exists to enforce"* — and an empty change
record is a real server refusal (`change-record-incomplete`, `demo-archive-wire.ts:1847-1855`). The
rebuild instead **disables** `Plan the bump…` until the record parses (`archive.tsx:2003`), which is
the greyed-out button the demo argued against, in the one place the demo had a named refusal for it.

**And the operator applies a bump without seeing which runs it takes.** The demo lists every
archivable run by name in a scrolling `Well`; the rebuild's reviewed plan reports a COUNT.

| # | Element | Demo | Rebuild | Verdict | Reason |
|---|---------|------|---------|---------|--------|
| VB1 | `kind` reshapes the whole flow — major archives and can be blocked, minor archives nothing and cannot be blocked | `DemoVersionBump.tsx:48-59`, `demo-archive-wire.ts:144-149,1832,1857` | `change-record.ts:30` (a label; nothing branches on it) | divergent | **OPEN — operator call** |
| VB2 | one dialog does author + preview + refuse + apply → rebuild splits into author → plan → apply | `DemoVersionBump.tsx:108-297` | `archive.tsx:1912`,`2297`,`2409` | divergent | ruled: D179 — apply re-derives candidates and blockers from authority inside its own transaction |
| VB3 | the plan is derived CLIENT-side (`deriveBumpPlan`) → rebuild plans on the server and carries `versionPlanId` / `planFingerprint` / `expectedVersion` | `DemoVersionBump.tsx:99` | `archive.tsx:2304-2307` | divergent | ruled: D179 |
| VB4 | bump dialog mounted at the PAGE root → rebuild mounts it inside `VersionsView`'s `PanelBody` | `DemoArchive.tsx:395` | `archive.tsx:2344-2348` | divergent | **OPEN — operator call** (also AR239) |
| VB5 | `DialogContent size="xl"` → rebuild `size="lg"` | `DemoVersionBump.tsx:109` | `archive.tsx:1952` | divergent | **OPEN — operator call** |
| VB6 | dialog title — demo `Bump <label>` for one target, `Dashboard update — N workflows` for many; rebuild always `Bump <authoring.title>` | `DemoVersionBump.tsx:104` | `archive.tsx:1953` | divergent | **OPEN — operator call** (the multi-workflow title has no counterpart) |
| VB7 | dialog description — demo `${BUMP_SCOPE_LABEL[scope]} · ${BUMP_SCOPE_NOTE[scope]}`, so it changes with the scope; rebuild one fixed sentence | `DemoVersionBump.tsx:109`, `demo-archive-wire.ts:166-177` | `archive.tsx:1954` | divergent | **OPEN — operator call** |
| VB8 | the kind control — demo a `RadioGroup` labelled `What kind of change is this?` with a full `BUMP_KIND_NOTE` description under each option; rebuild a `Select` in `Field label="Kind"` with two one-line `<option>`s | `DemoVersionBump.tsx:142-154` | `archive.tsx:1957-1962` | divergent | **OPEN — operator call** |
| VB9 | option labels — demo `Major — the run's shape changed` / `Minor — presentation only`; rebuild `major — the shape changed` / `minor — behaviour changed` | `demo-archive-wire.ts:140-141` | `archive.tsx:1959-1960` | divergent | **OPEN — operator call** |
| VB10 | the default kind — demo opens on `major`; rebuild opens on `minor` | `DemoVersionBump.tsx:98` | `archive.tsx:1923,1930` | divergent | **OPEN — operator call** |
| VB11 | changing the kind clears a standing result (`setResult(null)`) | `DemoVersionBump.tsx:147-148` | — | missing | **OPEN — operator call** |
| VB12 | target `Badge`s — one per workflow, tone info, reading `<label> <from> → <to>` | `DemoVersionBump.tsx:157-163` | — | missing | **OPEN — operator call** (the registry table carries the versions, but the dialog names no target) |
| VB13 | minor-arm `Banner tone="success"` — `Nothing can block a minor bump, because nothing is archived`, plus the in-flight sentence naming what a major bump would have blocked | `DemoVersionBump.tsx:166-178` | — | missing | **OPEN — operator call** (follows VB1) |
| VB14 | major-arm blockers `Banner` — tone `danger` when any blocker is a parked write else `warning`, title `N run(s) must be resolved before this bump`, `TriangleAlert` at `dsIcon.lg` | `DemoVersionBump.tsx:180-196` | `archive.tsx:2321-2341` | divergent | **OPEN — operator call** (the rebuild's banner is a standing info banner on the Versions panel, not tone-varying and not counted) |
| VB15 | the parked-write emphasis in the banner — `N is/are a parked write — a write whose outcome is unknown may never be buried in an archive` | `DemoVersionBump.tsx:187-195` | `archive.tsx:2205-2206` | divergent | **OPEN — operator call** (the rebuild says it per-row in the resolution cell, never in aggregate) |
| VB16 | `SectionLabel` `Must be terminalized or resolved first` → rebuild `<workflowLabel> — what a bump would refuse to bury` | `DemoVersionBump.tsx:206` | `archive.tsx:2404` | divergent | **OPEN — operator call** |
| VB17 | `BlockerTable` `TH` set — demo `Run` / `Status` / `Why` / `<resolutionHead>`; rebuild `Run` / `State` / `What has to happen` | `DemoVersionBump.tsx:313-316` | `archive.tsx:2194-2196` | divergent | **OPEN — operator call** (the `Why` column is gone) |
| VB18 | blocker `Run` cell — demo two lines, the run title over `<panel> · <day>`; rebuild the `traceId` alone, numeric | `DemoVersionBump.tsx:322-329` | `archive.tsx:2202` | divergent | unserved: `WorkflowVersionStateWire.blockers[]` carries `runId` / `traceId` / `runState` and no title, panel or day |
| VB19 | blocker `Status` cell — a `StatusPill size="sm"` through the total authority-state fold; `terminal` fails loud because it cannot be a blocker | `DemoVersionBump.tsx:331` | `archive.tsx:2286`, `archive-model.ts:89-103` | exact | — |
| VB20 | blocker `Why` cell (`max-w-[260px]`) | `DemoVersionBump.tsx:333` | — | missing | unserved: no `why` on `WorkflowVersionStateWire.blockers[]` |
| VB21 | blocker resolution cell — demo prints the SERVED `requiredResolution`; rebuild derives three sentences client-side from `runState` | `DemoVersionBump.tsx:334` | `archive.tsx:2204-2210` | divergent | unserved: no `requiredResolution` on `WorkflowVersionStateWire.blockers[]` |
| VB22 | the resolution column head is PARAMETERISED — `What has to happen` for blockers, `What a MAJOR bump would have demanded` for the minor arm's unaffected list | `DemoVersionBump.tsx:207,219` | `archive.tsx:2196` | divergent | **OPEN — operator call** (follows VB1) |
| VB23 | minor-arm section `Still in flight — unaffected (N)`, reusing `BlockerTable` | `DemoVersionBump.tsx:211-222` | — | missing | **OPEN — operator call** (follows VB1) |
| VB24 | `SectionLabel` `Would be archived — N run(s)` / `Would be archived — nothing` | `DemoVersionBump.tsx:226-228` | `archive.tsx:2416` | divergent | **OPEN — operator call** (the rebuild reports it as one `MetaLine` item, `N would be archived`) |
| VB25 | the archivable LIST — a `Well max-h-[190px] overflow-y-auto` of every run, each a `StatusPill size="sm" hideIcon` + truncating title + `<workflowLabel> <versionTag>` in micro nums | `DemoVersionBump.tsx:242-254` | — | missing | **OPEN — operator call** — the operator applies a bump seeing a COUNT and never the runs it takes |
| VB26 | minor empty-arm `Well` — `A minor bump archives no run at all. The archive is the consequence of a SHAPE change, and this is not one.` | `DemoVersionBump.tsx:229-234` | — | missing | **OPEN — operator call** (follows VB1) |
| VB27 | major zero-archivable `Well` — `No terminal runs are listed for this scope, so this bump would move the version and archive nothing.` | `DemoVersionBump.tsx:235-240` | — | missing | **OPEN — operator call** |
| VB28 | change-record layout — demo a two-up `grid-cols-1 min-[720px]:grid-cols-2`; rebuild four stacked `Field`s | `DemoVersionBump.tsx:259` | `archive.tsx:1956` | divergent | **OPEN — operator call** |
| VB29 | `Field label="What changed"` with description `Recorded beside the version, in the same store as fix records.` → rebuild `What moved`, no description, a `hint` char counter and `maxLength={200}` | `DemoVersionBump.tsx:260` | `archive.tsx:1963-1969` | divergent | **OPEN — operator call** |
| VB30 | the What placeholder is kind-dependent (two different examples) → rebuild one fixed placeholder | `DemoVersionBump.tsx:264` | `archive.tsx:1967` | divergent | **OPEN — operator call** (follows VB1) |
| VB31 | the Why LABEL is kind-dependent — `Why the shape had to move` / `Why this is presentation only` → rebuild the fixed `Why` | `DemoVersionBump.tsx:268` | `archive.tsx:1972` | divergent | **OPEN — operator call** (follows VB1) |
| VB32 | the Why description — `The record says which kind it was, and the archive's group header shows it.` → `The half nobody can reconstruct from a diff.` | `DemoVersionBump.tsx:269` | `archive.tsx:1974` | divergent | **OPEN — operator call** |
| VB33 | the Why placeholder is kind-dependent → rebuild one fixed placeholder | `DemoVersionBump.tsx:276` | `archive.tsx:1981` | divergent | **OPEN — operator call** (follows VB1) |
| VB34 | `Textarea rows={2}` → rebuild `rows={3}` with `maxLength={1000}` | `DemoVersionBump.tsx:273` | `archive.tsx:1978-1980` | divergent | **OPEN — operator call** |
| VB35 | a `Commit` `Field`, optional, recording its own absence reason when left empty | — | `archive.tsx:1985-1995` | extra | ruled: ref dashboard-surfaces §10.2 — a fabricated hash on the record that exists to be trustworthy is worse than an honest "none" |
| VB36 | live character-count `hint`s on What and Why | — | `archive.tsx:1963,1975` | extra | **OPEN — operator call** |
| VB37 | `DialogFooter meta="There is no force arm. The refusal is the feature."` | `DemoVersionBump.tsx:282` | — | missing | **OPEN — operator call** |
| VB38 | Cancel `Button` — demo `variant="secondary"` full size; rebuild `variant="ghost" size="sm"` | `DemoVersionBump.tsx:283-285` | `archive.tsx:1998` | divergent | **OPEN — operator call** |
| VB39 | primary label — demo `Bump and archive N run(s)` / `Bump — archive nothing`; rebuild `Plan the bump…` | `DemoVersionBump.tsx:291-293` | `archive.tsx:2008` | divergent | ruled: D179 — the two-step plan/apply |
| VB40 | the primary escalates to `variant="danger"` with a `ShieldAlert` icon when it is a major bump with blockers | `DemoVersionBump.tsx:287-288` | — | missing | **OPEN — operator call** |
| VB41 | **the primary is NEVER disabled** — an incomplete change record is a real server refusal (`change-record-incomplete`), because a greyed-out button hides the rule the flow exists to enforce → rebuild `disabled` until the record parses | `DemoVersionBump.tsx:286-294`, `demo-archive-wire.ts:1847-1855` | `archive.tsx:2003` | divergent | **OPEN — operator call** |
| VB42 | `Apply the bump` stays clickable while blockers exist | `DemoVersionBump.tsx:286` | `archive.tsx:2428-2430` | exact | — (D179's own rule, honoured at the apply step) |
| VB43 | applied `Banner tone="success"` carrying the result headline and detail | `DemoVersionBump.tsx:112-125` | — | missing | **OPEN — operator call** |
| VB44 | the applied banner's `Open the archive` action (`Archive` icon, `variant="secondary"`), shown for a major bump, flipping the view back to `runs` | `DemoVersionBump.tsx:117-121` | — | missing | **OPEN — operator call** (also AR241) |
| VB45 | refusal `Refusal` with a kind-dependent `outcome` — `nothing was archived and no version moved` / `no version moved` | `DemoVersionBump.tsx:127-133` | `archive.tsx:2171-2174` | divergent | **OPEN — operator call** (the rebuild's outcome is one fixed sentence; follows VB1) |
| VB46 | the refusal prints the server's own sentence verbatim rather than paraphrasing it | `DemoVersionBump.tsx:132` | `archive.tsx:2182` | exact | — |
| VB47 | the code-less refusal arm — `Banner tone="danger"` … `the server sent no refusal code, so there is nothing here to quote in a bug report` | `DemoVersionBump.tsx:134-138` | — | missing | **OPEN — operator call** |
| VB48 | the CAS `conflict` arm handled beside `rejected`, mapped to the code `version-conflict` | — | `archive.tsx:2157-2158` | extra | ruled: D253 — an unhandled union arm IS a fallback |
| VB49 | the refusal carries `meta={["plan <shortHash>"]}` | — | `archive.tsx:2175` | extra | ruled: D179 |
| VB50 | an enter transition wrapper around the refusal, so it reads as the answer to the click | — | `archive.tsx:2156,2164-2169` | extra | **OPEN — operator call** |
| VB51 | the `Reviewed plan` `Well` — a `MetaLine` of `plan <hash>` / `N would be archived` / `N would block` / `planned <clock> by <who>`, two rules as a `BulletList`, and `Apply the bump` | — | `archive.tsx:2410-2444` | extra | ruled: D179 |
| VB52 | the apply-time rules — *"Applying archives every prior-version run in scope. It cannot be undone"* and *"A relaunch from the archive later starts a FRESH run on the current version"* | — | `archive.tsx:2423-2424` | extra | ruled: D179 |
| VB53 | the plan's blocker table is rendered once, under the reviewed plan, instead of once per workflow | — | `archive.tsx:2395-2408,2452` | extra | ruled: D179 |

**Counts:** 53 rows — exact 3 · divergent 29 · missing 13 · extra 8 · **OPEN 38 marks** across
three numbered decision groups below: MAJOR/MINOR behavior (2), the reviewed plan naming its runs
(12), and the authoring shape/copy decision (31). VB13, VB22, VB23, VB26, VB30, VB31, VB33 and
VB45 all follow the first group rather than asking eight more copies of it.

---

## 9. Design-system primitives — `DemoUiKit.tsx` + `demo-ui.tsx` + demo `ds/` + `DESIGN.md` ↔ `src/dashboard/ds/**`

**Demo:** `legacy `rebuild-demo/`` — `DemoUiKit.tsx` (1189), `demo-ui.tsx` (229), `DESIGN.md` (676), `ds/{tokens.css,tokens.ts,theme.ts,primitives-*.tsx}` · **Rebuild:** ``src/dashboard/`` — `ds/{tokens.css,tokens.ts,theme.ts,ui.tsx,primitives-*.tsx}`, `DESIGN.md`

This is the highest-fidelity region in the whole audit, and it is high-fidelity by *construction* rather than by re-implementation: all six `primitives-*.tsx` files, `tokens.css`, `tokens.ts`, `theme.ts` and `DESIGN.md` were **copied byte-for-byte** from legacy `hr-automation@793abe1f` with a provenance header, and the total delta across ~2,700 lines of primitives and ~1,300 lines of tokens is **eight hunks**. Token comparison is therefore not an estimate: the demo declares **231 distinct custom properties**, the rebuild declares **237** — set difference is **zero missing, zero divergent values, six extra** (`--rehearsal` + four `--ds-rehearsal-*`, ruled D232; `--ds-w-explorer-measure`, ruled by ref dashboard-surfaces §13.5). The barrel is the same story: **122 exports in the demo, 124 in the rebuild, zero missing.** **The one structural finding is the opposite of drift — it is an absence: `DemoUiKit.tsx`, the 1189-line specimen page, has NO equivalent in the rebuild.** There is no `kit.html`, no `kit-entry.tsx`, no specimen surface, and `ui-catalog.tsx` is an unrelated thing (the generated *selector* catalog, D177). This matters beyond a missing dev page for a reason the tree itself creates: `src/dashboard/DESIGN.md` is ported **verbatim** and is declared *binding*, and it still tells its reader at `:112`, `:690`, `:691` and `:696-697` to skim `DemoUiKit.tsx` and to open `kit.html` on port 3943 — artifacts that do not exist in this checkout. Its own porting header lists exactly two adaptations and the specimen page is not among them, so the binding document ships a live instruction nobody in this tree can follow. That is the same failure shape as D188's "an inventory that gates cutover must not be milestoned by guesswork" and D187's parity lesson: **a claim in a governing doc that no artifact satisfies is worse than no claim.** Everything else here is exact or is an operator-ratified addition.

### 9.1 Tokens

| # | Element | Demo | Rebuild | Verdict | Reason |
|---|---------|------|---------|---------|--------|
| UK1 | File provenance header — rebuild prepends `/* Ported from legacy hr-automation@793abe1f…, src/dashboard/components/dev/rebuild-demo/ds/tokens.css */` | `tokens.css:1` | `tokens.css:1` | extra | ruled: D93 cross-repo "porting = copy with provenance" |
| UK2 | File banner title — `REBUILD DEMO — DESIGN TOKENS  (dev-only)` vs `REBUILD DASHBOARD — DESIGN TOKENS` | `tokens.css:2` | `tokens.css:4` | divergent | ruled: D93 — this tree is not dev-only; the demo's own `DEV-ONLY` marker is the thing being retired |
| UK3 | Palette-budget doctrine — demo `one accent + four semantic hues`, rebuild `one accent + FIVE semantic hues (info / success / warning / danger / rehearsal)` | `tokens.css:29-32` | `tokens.css:31-50` | divergent | ruled: D232 |
| UK4 | Naming convention block `--ds-<group>-<role>[-<state>]` and the group list | `tokens.css:34` | `tokens.css:51` | exact | — |
| UK5 | `:root` fallback block — aliases the app's own theme so a primitive outside a themed subtree still resolves | `tokens.css:45` | `tokens.css:62` | exact | — |
| UK6 | `--ds-surface-*` family — 8 names (`page`, `1`, `2`, `3`, `selected`, `disabled`, `overlay`, `scrim`), 24 declarations across all three blocks | `tokens.css:51`,`56`,`70` | `tokens.css:68`,`73`,`786` | exact | — (24 tokens) |
| UK7 | `--ds-surface-scrim: color-mix(in srgb, hsl(0 0% 0%) 66%, transparent)` (`:root`) / `rgba(0, 0, 0, 0.66)` (dark) | `tokens.css:56`,`749` | `tokens.css:73`,`791` | exact | — |
| UK8 | `--ds-surface-selected: color-mix(in srgb, var(--ds-fg) 4%, var(--ds-surface-1))` | `tokens.css:70`,`751` | `tokens.css:87` | exact | — |
| UK9 | `--ds-fg*` family — 6 names (`--ds-fg`, `-secondary`, `-muted`, `-faint`, `-inverse`, `-link`), 18 declarations | `tokens.css:161`,`762` | `tokens.css:178`,`804` | exact | — (18 tokens) |
| UK10 | `--ds-border*` family — 7 names (`--ds-border`, `-subtle`, `-strong`, `-loud`, `-w`, `-w-emphasis`, `-w-rail`), 15 declarations | `tokens.css:146`,`153`,`756` | `tokens.css:163`,`170`,`798` | exact | — (15 tokens) |
| UK11 | `--ds-border-w: 1px` / `--ds-border-w-emphasis` / `--ds-border-w-rail` | `tokens.css:153` | `tokens.css:170` | exact | — |
| UK12 | `--ds-accent*` family — 5 names (`--ds-accent`, `-hover`, `-fg`, `-quiet`, `-mark`), 15 declarations; dark `#fafafa` | `tokens.css:177`,`775` | `tokens.css:194`,`817` | exact | — (15 tokens) |
| UK13 | `--ds-control-*` family — 5 names (`-bg`, `-bg-hover`, `-bg-active`, `-border`, `-fg`), 15 declarations | `tokens.css:172`,`770` | `tokens.css:189`,`812` | exact | — (15 tokens) |
| UK14 | `--ds-recess-*` family — 4 names (`-bg`, `-border`, `-fg`, `-fg-quiet`) | `tokens.css:119` | `tokens.css:136` | exact | — (4 tokens) |
| UK15 | `--ds-status-waiting-*` — `bg`/`fg`/`mark`/`border`/`solid-bg`/`solid-fg`; `bg: color-mix(in srgb, var(--warning) 14%, transparent)`, dark `#f79009 14%` | `tokens.css:223`,`790` | `tokens.css:240`,`832` | exact | — (6 tokens × 3 blocks) |
| UK16 | `--ds-status-failed-*` — 6 tokens; `bg: color-mix(in srgb, var(--destructive) 14%, transparent)`, dark `#f04438 14%` | `tokens.css:231`,`797` | `tokens.css:248`,`839` | exact | — |
| UK17 | `--ds-status-parked-*` — 4 tokens; `bg: color-mix(in srgb, var(--warning) 13%, transparent)` | `tokens.css:239` | `tokens.css:256` | exact | — |
| UK18 | `--ds-status-done-warnings-*` — 4 tokens; `bg: color-mix(in srgb, var(--warning) 9%, transparent)` (the 9% that separates it from parked's 13%) | `tokens.css:245` | `tokens.css:262` | exact | — |
| UK19 | `--ds-status-running-*` — 4 tokens; `bg: color-mix(in srgb, var(--foreground) 6%, transparent)` — neutral on purpose | `tokens.css:253` | `tokens.css:270` | exact | — |
| UK20 | `--ds-status-queued-*` — 4 tokens; `bg: transparent` | `tokens.css:259` | `tokens.css:276` | exact | — |
| UK21 | `--ds-status-cancelled-*` — 6 tokens; `bg: color-mix(in srgb, var(--muted-foreground) 14%, transparent)` | `tokens.css:266` | `tokens.css:283` | exact | — |
| UK22 | `--ds-status-verified-done-*` — 6 tokens; `bg: color-mix(in srgb, var(--success) 14%, transparent)` | `tokens.css:277` | `tokens.css:294` | exact | — |
| UK23 | `--ds-status-*` total — 40 distinct names, **120 declarations** across the three blocks; both trees identical | `tokens.css:223-282` | `tokens.css:240-299` | exact | — (120 tokens) |
| UK24 | `--ds-info-*` family — 7 names (`fg`,`mark`,`bg`,`border`,`solid-bg`,`solid-fg`,`solid-hover`), 21 declarations; dark `--ds-info-fg: #4ea1f3` | `tokens.css:283`,`290`,`836` | `tokens.css:300`,`307`,`878` | exact | — (21 tokens) |
| UK25 | `--ds-danger*` family — 5 names (`--ds-danger`, `-fg`, `-quiet`, `-border`, `-solid`), 15 declarations; `--ds-danger-fg: hsl(0 65% 8%)` / dark `#2a0806` | `tokens.css:185`,`783` | `tokens.css:202`,`825` | exact | — (15 tokens) |
| UK26 | `--ds-success-*` family — 4 names, 12 declarations; dark `--ds-success-mark: #12b76a`, light `#059669` | `tokens.css:293`,`843` | `tokens.css:310`,`885` | exact | — (12 tokens) |
| UK27 | `--ds-read-*` direction family — 4 names, 12 declarations; `--ds-read-fg: #38bdf8`, light drops to sky-600/700 | `tokens.css:327`,`852` | `tokens.css:358`,`903` | exact | — (12 tokens) |
| UK28 | `--ds-write-*` direction family — 4 names, 12 declarations; `--ds-write-fg: #c4b5fd` | `tokens.css:331`,`856` | `tokens.css:362`,`907` | exact | — (12 tokens) |
| UK29 | `--rehearsal: #a78bfa` (`:root` + dark) / `#6d28d9` (light) — the raw fifth hue | — | `tokens.css:323`,`893` | extra | ruled: D232 |
| UK30 | `--ds-rehearsal-fg` — `#a78bfa` dark (6.5:1 on `#18181b`) / `#6d28d9` light (7.1:1 on white) | — | `tokens.css:324`,`894` | extra | ruled: D232 |
| UK31 | `--ds-rehearsal-mark` — `#a78bfa` dark / `#7c3aed` light (violet-600, 5.5:1 as a mark) | — | `tokens.css:325` | extra | ruled: D232 |
| UK32 | `--ds-rehearsal-bg` — `color-mix(… 13%, transparent)` dark / `10%` light | — | `tokens.css:326` | extra | ruled: D232 |
| UK33 | `--ds-rehearsal-border` — `color-mix(… 55%, transparent)` dark / `40%` light | — | `tokens.css:327` | extra | ruled: D232 |
| UK34 | No `--ds-rehearsal-solid-*` step — deliberately absent so the hue is only ever a chip, never a fifth voice in the loudness ladder | — | `tokens.css:318-322` | extra | ruled: D232 |
| UK35 | `--log-*` categorical ramp — 4 names (`slate`, `cyan`, `teal`, `violet`), 8 declarations; `--log-violet: #f79009` (amber, despite the name — the name outlived the colour) | `tokens.css:735`,`736` | `tokens.css:777`,`778` | exact | — (8 tokens) |
| UK36 | `--ds-space-*` — 8 names: `hair` 2px, `tight`, `snug`, `base`, `cozy`, `loose`, `section`, `page` 32px | `tokens.css:368`,`375` | `tokens.css:399`,`406` | exact | — (8 tokens) |
| UK37 | `--ds-radius-*` — 6 names: `xs` 3px, `sm`, `md`, `lg`, `xl`, `pill` | `tokens.css:570` | `tokens.css:612` | exact | — (6 tokens) |
| UK38 | `--ds-h-*` control/layout heights — 19 names incl. `xs`,`sm`,`md`,`lg`,`row` 32px,`topbar` 44px,`toolbar`,`bar`,`timeline-bar`,`micro-pipeline`,`evidence-row/thumb/well`,`capture-box/thumb`,`member-line/well/well-open`,`review-page-min` | `tokens.css:391`,`408` | `tokens.css:422`,`439` | exact | — (19 tokens) |
| UK39 | `--ds-w-rail: 200px` (the workflow rail) | `tokens.css:501` | `tokens.css:532` | exact | — |
| UK40 | `--ds-w-side-panel: 376px` and `--ds-w-context-rail: var(--ds-w-side-panel)` — the context-rail column width | `tokens.css:506`,`507` | `tokens.css:537`,`538` | exact | — |
| UK41 | `--ds-w-context-rail-wide: 520px` and `--ds-w-context-spine: 34px` | `tokens.css:514`,`515` | `tokens.css:545`,`546` | exact | — |
| UK42 | Archive column widths — `--ds-w-archive-trace: 148px`, `-status`, `-when`, `-duration` | `tokens.css:479` | `tokens.css:510` | exact | — (4 tokens) |
| UK43 | `--ds-w-popover-{sm,md,lg}` — `sm: 240px` | `tokens.css:518` | `tokens.css:560` | exact | — (3 tokens) |
| UK44 | `--ds-w-menu: 216px`, `--ds-w-chip-cell: 148px`, `--ds-w-capacity-cell`, `--ds-w-row-indent`, `--ds-w-row-link-max`, `--ds-w-session-card`, `--ds-w-evidence-thumb`, `--ds-w-member-eid`, `--ds-w-member-detail` | `tokens.css:525`,`533` | `tokens.css:567`,`575` | exact | — (9 tokens) |
| UK45 | `--ds-w-explorer-measure: 1120px` — the reading measure for the explorer / UI-catalog takeover (376px rail + ~700px record column) | — | `tokens.css:557` | extra | ruled: ref dashboard-surfaces §13.5 (`decisions.md` 2i-G / D176-D177 slice) |
| UK46 | `--ds-text-*` type scale — 7 sizes exactly (`micro` 10px, `meta`, `ui`, `body`, `section`, `title`, `display`) | `tokens.css:345` | `tokens.css:376` | exact | — (7 tokens) |
| UK47 | `--ds-lh-*` line heights — 7, paired 1:1 with the type scale (`micro` 13px …) | `tokens.css:346` | `tokens.css:377` | exact | — (7 tokens) |
| UK48 | `--ds-elev-1: 0 1px 2px hsl(0 0% 0% / 0.35)`, `--ds-elev-2`, `--ds-elev-3` — three elevations, 9 declarations | `tokens.css:581`,`582`,`584`,`867` | `tokens.css:623`,`624`,`626`,`918` | exact | — (9 tokens) |
| UK49 | `--ds-focus-ring`, `--ds-focus-ring-w: 2px`, `--ds-focus-ring-offset` — the one focus ring, 5 declarations | `tokens.css:604`,`605`,`866` | `tokens.css:646`,`647`,`917` | exact | — (5 tokens) |
| UK50 | `--ds-dur-*` motion — 7 names (`1` 90ms, `2`, `3`, `4`, `enter` 150ms, `exit`, `move`), 21 declarations | `tokens.css:618`,`628` | `tokens.css:660`,`670` | exact | — (21 tokens) |
| UK51 | `--ds-ease-{standard,out,in}`; `standard: cubic-bezier(0.45, 0, 0.55, 1)` | `tokens.css:648` | `tokens.css:690` | exact | — (3 tokens) |
| UK52 | `:root[data-demo-theme-switching]` block — collapses every duration to `0ms` (`--ds-dur-1: 0ms`, `--ds-dur-enter: 0ms`) so a theme flip does not animate | `tokens.css:667`,`671` | `tokens.css:709`,`713` | exact | — |
| UK53 | `graphite-warm` (dark) theme block — full literal palette, selector triple `[data-demo-theme="dark"], :root[…], body[…]` | `tokens.css:744` | `tokens.css:725` | exact | — |
| UK54 | `paper-ink` (light) theme block — full literal palette, same selector triple | `tokens.css:888` | `tokens.css:939` | exact | — |
| UK55 | **Whole-file token-set comparison** — 231 distinct custom properties in the demo, 237 in the rebuild; `comm` of the sorted name sets yields **zero demo-only names** | `tokens.css` | `tokens.css` | exact | — (231 tokens) |
| UK56 | **Whole-file token-value comparison** — `diff -u` over both files reports only additions inside the value blocks; **not one existing declaration's value differs** in `:root`, dark or light | `tokens.css` | `tokens.css` | exact | — |
| UK57 | `tokens.ts` — `dsText` (7 sizes + `nums`/`flush`/`tight` helpers) | `tokens.ts:20` | `tokens.ts:24` | exact | — |
| UK58 | `tokens.ts` — `dsSurface`, `dsClip`, `dsBorder`, `dsRadius`, `dsElev` | `tokens.ts:50`,`87`,`104`,`114`,`124` | `tokens.ts:54`,`91`,`108`,`118`,`128` | exact | — |
| UK59 | `tokens.ts` — `dsFocus = "outline-none ds-focus"`, `dsFocusWithin = "ds-focus-within"` | `tokens.ts:137`,`138` | `tokens.ts:141`,`142` | exact | — |
| UK60 | `tokens.ts` — `dsMotion` (the five motion classes), `dsLayer`, `dsGap`, `dsPad`, `dsIcon` | `tokens.ts:152`,`181`,`210`,`224`,`248` | `tokens.ts:156`,`185`,`214`,`228`,`252` | exact | — |
| UK61 | `tokens.ts` — **whole file byte-identical** apart from the 4-line provenance header, the `DEV-ONLY` marker, and the import-path line in the docblock | `tokens.ts` | `tokens.ts:1-16` | exact | — |
| UK62 | `theme.ts` — `DemoTheme` union, `DEMO_THEME_ATTR`, `DEMO_THEME_LABEL = {dark:"Graphite Warm", light:"Paper Ink"}`, `useDemoTheme` | `theme.ts:42` | `theme.ts:47` | exact | — |
| UK63 | `theme.ts` storage — demo reads/writes `localStorage` inline behind bare `try/catch`; rebuild routes through `readEnumPreference`/`writePreference` with an explicit `THEME_DEFAULT = "dark"` const | `theme.ts:45-56`,`99-118` | `theme.ts:50-58`,`101-113` | divergent | ruled: project CLAUDE.md fail-loud "when you catch, don't swallow" — a bare `catch { return "dark" }` is the banned pattern; no visual or DOM effect |
| UK64 | `DESIGN.md` — ported **verbatim**, byte-for-byte, with a 24-line provenance comment stating so | `DESIGN.md:1` | `DESIGN.md:1-24` | exact | — |
| UK65 | `DESIGN.md` — the one content edit: parity-review link `docs/rebuild/reviews/second-look-2026-07-22.md` → `docs/rebuild/history/design-inputs/2026-07-22-second-look.md` | `DESIGN.md:19` | `DESIGN.md:43` | divergent | ruled: 2026-08-20 docs restructure (ref frontend-backend-integration; the target file moved) |
| UK66 | `DESIGN.md` porting header claims the barrel is `src/dashboard/ds/ui.ts`; the actual file is `ui.tsx` | — | `DESIGN.md:18` | divergent | **OPEN — operator call** |
| UK67 | `DESIGN.md` porting header names only TWO adaptations (barrel path, guard file) — the missing specimen page is not disclosed | — | `DESIGN.md:13-22` | divergent | **OPEN — operator call** |
| UK68 | `tailwind-palette` / `frontend-tailwind-compliance` ratchet arm — bans raw Tailwind palette classes and raw hex in string literals/JSX text, so no palette divergence *can* be introduced outside `tokens.css` | n/a | `ratchet-arms.ts:132`,`460-467` | extra | ruled: ref guards-and-tests (arm registered in `guard-inventory.json`) |
| UK69 | Ratchet-arm port dropped 3 of legacy's 4 checks (reduced-motion coverage, z-index scale, image loading) while `DESIGN.md` still asserts two of them are "guard enforced" by name | `DESIGN.md:209`,`546`,`548-549` | `ratchet-arms.ts:441-457` | divergent | **OPEN — operator call** (self-declared in the arm's own comment: "a document claiming a guard that does not run is worse than no claim") |

### 9.2 Primitives

| # | Element | Demo | Rebuild | Verdict | Reason |
|---|---------|------|---------|---------|--------|
| UK70 | **Barrel export set** — 122 named exports in `demo-ui.tsx`, 124 in `ui.tsx`; `comm` of the sorted sets yields **zero demo-only exports** | `demo-ui.tsx` | `ui.tsx` | exact | — (122 exports) |
| UK71 | Barrel — every re-export path rewritten `./ds/x` → `./x.js` (`verbatimModuleSyntax` + `.js` extensions) | `demo-ui.tsx:21-217` | `ui.tsx:25-229` | divergent | ruled: project CLAUDE.md conventions (`verbatimModuleSyntax`; `.js` on relative imports) |
| UK72 | Every primitive file — `import { cn } from "@/lib/utils"` → `from "../lib/utils.js"` | all `primitives-*.tsx` | all `primitives-*.tsx` | divergent | ruled: project CLAUDE.md conventions (no `@/` alias in this tree) |
| UK73 | Every primitive file — `DEV-ONLY —` stripped from each module docblock's first line | all `primitives-*.tsx` | all `primitives-*.tsx` | divergent | ruled: D93 — this tree is the product, not a dev-only demo |
| UK74 | **Button** — `cva` with variants `primary` \| `secondary` \| `outline` \| `ghost` \| `danger` \| `dangerGhost`, sizes `sm` \| `md` \| `lg`, `block` boolean, `defaultVariants: {variant:"secondary", size:"md", block:false}`; `loading` renders `Loader2`; classes and DOM identical | `primitives-core.tsx:133` | `primitives-core.tsx:137` | exact | — |
| UK75 | **IconButton** — variants `ghost` \| `outline` \| `danger`, sizes `xs` \| `sm` \| `md` \| `lg`, required `label` (becomes `aria-label`), `icon`, `loading`, `title`; same forwardRef, same DOM | `primitives-core.tsx:212` | `primitives-core.tsx:216` | exact | — |
| UK76 | **Badge** — `cva` tones `neutral` \| `info` \| `success` \| `warning` \| `danger` \| `attention` \| `infoOutline`, `defaultVariants: {tone:"neutral"}` | `primitives-core.tsx:292` | `primitives-core.tsx:296` | exact | — |
| UK77 | **CountBadge** — shares `badgeVariants`, `tone = "neutral"` default, tabular numerals | `primitives-core.tsx:301` | `primitives-core.tsx:305` | exact | — |
| UK78 | **Chip / DsChipProps** — `CHIP_TONE` = `neutral` \| `info` \| `warning` \| `danger`; same `tone = "neutral"` default and same recessed-plane neutral | `primitives-core.tsx:334`,`389` | `primitives-core.tsx:338`,`393` | exact | — |
| UK79 | **Kbd** | `primitives-core.tsx:480` | `primitives-core.tsx:484` | exact | — |
| UK80 | **Spinner** | `primitives-core.tsx:503` | `primitives-core.tsx:507` | exact | — |
| UK81 | **Skeleton** | `primitives-core.tsx:518` | `primitives-core.tsx:522` | exact | — |
| UK82 | **Separator** | `primitives-core.tsx:532` | `primitives-core.tsx:536` | exact | — |
| UK83 | **VisuallyHidden** | `primitives-core.tsx:553` | `primitives-core.tsx:557` | exact | — |
| UK84 | **`DS_STATUS`** — the eight ratified statuses, same keys and same order: `waiting`, `failed`, `parked`, `doneWarnings`, `running`, `queued`, `cancelled`, `verifiedDone`; every `label`, `tier`, `icon`, `chip`, `solid` identical | `primitives-status.tsx:102` | `primitives-status.tsx:122` | exact | — (8 statuses) |
| UK85 | `DS_STATUS_ORDER` and `DS_ATTENTION_STATUSES = ["waiting","failed"]` | `primitives-status.tsx:233`,`245` | `primitives-status.tsx:256`,`268` | exact | — |
| UK86 | `DsStatusSpec.accessibleLabel?` — new optional field; `doneWarnings` gains `accessibleLabel: "Done with warnings"`. **Visible label is unchanged** (`"Done"`) | `primitives-status.tsx:52` | `primitives-status.tsx:56-73`,`174` | extra | ruled: D126 (amends ref dashboard-surfaces §9 row-model D22) |
| UK87 | `dsStatusAccessibleName(status, age?)` — new exported fn; falls back to `label` for the other seven statuses | — | `primitives-status.tsx:289` | extra | ruled: D126 |
| UK88 | `dsStatusText(status, age?)` — unchanged, still the *visible* vocabulary | `primitives-status.tsx:252` | `primitives-status.tsx:275` | exact | — |
| UK89 | **StatusPill** — sizes `sm` \| `md`, `tier` drives solid vs tinted, same DOM | `primitives-status.tsx:273` | `primitives-status.tsx:311` | exact | — |
| UK90 | **StatusDot** — `aria-label` changes from `spec.label` to `dsStatusAccessibleName(status)`; `title={spec.label}` unchanged, so **pixels are identical and only the a11y name moves** | `primitives-status.tsx:356` (`aria-label={spec.label}`) | `primitives-status.tsx:394` (`aria-label={dsStatusAccessibleName(status)}`) | divergent | ruled: D126 |
| UK91 | **StatusIcon** | `primitives-status.tsx:386` | `primitives-status.tsx:427` | exact | — |
| UK92 | **Panel** | `primitives-layout.tsx:31` | `primitives-layout.tsx:35` | exact | — |
| UK93 | **PanelHeader** — `title`, `subtitle`, actions slot | `primitives-layout.tsx:55` | `primitives-layout.tsx:59` | exact | — |
| UK94 | **PanelToolbar** | `primitives-layout.tsx:105` | `primitives-layout.tsx:109` | exact | — |
| UK95 | **PanelBody** | `primitives-layout.tsx:131` | `primitives-layout.tsx:135` | exact | — |
| UK96 | **PanelFooter** | `primitives-layout.tsx:135` | `primitives-layout.tsx:139` | exact | — |
| UK97 | **Card** | `primitives-layout.tsx:157` | `primitives-layout.tsx:161` | exact | — |
| UK98 | **CardHeader** | `primitives-layout.tsx:193` | `primitives-layout.tsx:197` | exact | — |
| UK99 | **CardBody** | `primitives-layout.tsx:216` | `primitives-layout.tsx:220` | exact | — |
| UK100 | **CardFooter** | `primitives-layout.tsx:363` | `primitives-layout.tsx:367` | exact | — |
| UK101 | **CardBase** — trailing control on the row's bottom edge | `primitives-layout.tsx:259` | `primitives-layout.tsx:263` | exact | — |
| UK102 | **CompareGrid** — cards read ACROSS | `primitives-layout.tsx:305` | `primitives-layout.tsx:309` | exact | — |
| UK103 | **CompareCard** | `primitives-layout.tsx:335` | `primitives-layout.tsx:339` | exact | — |
| UK104 | **SectionLabel** | `primitives-layout.tsx:378` | `primitives-layout.tsx:382` | exact | — |
| UK105 | **Banner** — `BANNER_TONE` = `info` \| `success` \| `warning` \| `danger`; `DsBannerTone` derived as `keyof typeof BANNER_TONE`; icons `Info`/`CheckCircle2`/`TriangleAlert`/`CircleAlert`; forwards no unknown props | `primitives-layout.tsx:424` | `primitives-layout.tsx:428` | exact | — |
| UK106 | **PageHeader** | `primitives-layout.tsx:479` | `primitives-layout.tsx:483` | exact | — |
| UK107 | **MetaLine** — the provenance line | `primitives-layout.tsx:532` | `primitives-layout.tsx:536` | exact | — |
| UK108 | **ChipRow** — wrapping row of peer facts, `--ds-w-chip-cell` track | `primitives-layout.tsx:585` | `primitives-layout.tsx:589` | exact | — |
| UK109 | **Refusal** | `primitives-layout.tsx:630` | `primitives-layout.tsx:634` | exact | — |
| UK110 | **BulletList** | `primitives-layout.tsx:676` | `primitives-layout.tsx:680` | exact | — |
| UK111 | **EmptyState** — `title` + optional body | `primitives-layout.tsx:717` | `primitives-layout.tsx:721` | exact | — |
| UK112 | **Tabs / TabList / Tab / TabPanel** — full roving-focus + `role="tablist"`/`tab`/`tabpanel` wiring identical | `primitives-layout.tsx:782`,`801`,`848`,`901` | `primitives-layout.tsx:786`,`805`,`852`,`905` | exact | — (4 primitives) |
| UK113 | **Well** | `primitives-layout.tsx:939` | `primitives-layout.tsx:943` | exact | — |
| UK114 | **useDsEnterTransition** | `primitives-layout.tsx:982` | `primitives-layout.tsx:986` | exact | — |
| UK115 | **FloatingSurface** | `primitives-layout.tsx:1009` | `primitives-layout.tsx:1013` | exact | — |
| UK116 | **Field / useFieldControl** — visible label, `aria-describedby` wiring, error announcement | `primitives-form.tsx:63`,`37` | `primitives-form.tsx:68`,`42` | exact | — |
| UK117 | **Input** | `primitives-form.tsx:148` | `primitives-form.tsx:153` | exact | — |
| UK118 | **Textarea** | `primitives-form.tsx:167` | `primitives-form.tsx:172` | exact | — |
| UK119 | **Select** — same `ChevronDown` affordance and same DOM | `primitives-form.tsx:200` | `primitives-form.tsx:205` | exact | — |
| UK120 | **Checkbox** — Radix, `Check`/`Minus` indeterminate | `primitives-form.tsx:269` | `primitives-form.tsx:274` | exact | — |
| UK121 | **RadioGroup** | `primitives-form.tsx:314` | `primitives-form.tsx:319` | exact | — |
| UK122 | **Switch** | `primitives-form.tsx:376` | `primitives-form.tsx:381` | exact | — |
| UK123 | **SearchInput** — `Search`/`X` affordances | `primitives-form.tsx:432` | `primitives-form.tsx:437` | exact | — |
| UK124 | **ValueField** | `primitives-form.tsx:505` | `primitives-form.tsx:510` | exact | — |
| UK125 | **LockedValue** — `Lock` glyph | `primitives-form.tsx:600` | `primitives-form.tsx:605` | exact | — |
| UK126 | **Dropzone** — a real `<input type="file">` inside a `<label>`; never filters a dropped file; drag depth is a counter not a boolean; `busy` disables and relabels | — | `primitives-form.tsx:666` | extra | ruled: D173 |
| UK127 | `Upload` added to the `lucide-react` import in `primitives-form.tsx` (Dropzone's glyph) | `primitives-form.tsx:10` | `primitives-form.tsx:15` | extra | ruled: D173 |
| UK128 | **Dialog / DialogTrigger / DialogClose** — Radix roots | `primitives-overlay.tsx:210-212` | `primitives-overlay.tsx:214-216` | exact | — |
| UK129 | **DialogContent** — `DsDialogSize` = `sm` \| `md` \| `lg` \| `xl`; same scrim, focus trap, `X` close | `primitives-overlay.tsx:260`,`218` | `primitives-overlay.tsx:264`,`218` | exact | — |
| UK130 | **DialogBody** | `primitives-overlay.tsx:348` | `primitives-overlay.tsx:352` | exact | — |
| UK131 | **DialogFooter** | `primitives-overlay.tsx:366` | `primitives-overlay.tsx:370` | exact | — |
| UK132 | **Drawer / DrawerTrigger / DrawerClose / DrawerContent** — `DsDrawerSide` = `right` \| `bottom` | `primitives-overlay.tsx:407-409`,`418` | `primitives-overlay.tsx:411-413`,`422` | exact | — |
| UK133 | **Tooltip / TooltipProvider** | `primitives-overlay.tsx:521`,`508` | `primitives-overlay.tsx:525`,`512` | exact | — |
| UK134 | **Popover / PopoverTrigger / PopoverAnchor / PopoverClose** | `primitives-overlay.tsx:573-576` | `primitives-overlay.tsx:577-580` | exact | — |
| UK135 | **PopoverContent** — `DsPopoverWidth` = `sm` \| `md` \| `lg`, `side`, `title`, `hideTitle` | `primitives-overlay.tsx:621`,`583` | `primitives-overlay.tsx:625`,`583` | exact | — |
| UK136 | **ContextMenu / ContextMenuTrigger / ContextMenuSeparator / ContextMenuContent / ContextMenuLabel / ContextMenuItem / openContextMenuFor** | `primitives-overlay.tsx:765-767`,`780`,`804`,`856`,`870` | `primitives-overlay.tsx:769-771`,`784`,`808`,`860`,`874` | exact | — (7 exports) |
| UK137 | **DsToast / useToasts / ToastProvider** — `DsToastTone` = `info` \| `success` \| `warning` \| `danger`; a `danger` toast never auto-dismisses, everything else clears at 3s | `primitives-overlay.tsx:915`,`943`,`968` | `primitives-overlay.tsx:919`,`947`,`972` | exact | — |
| UK138 | Toast id minting — demo `` `toast-${Date.now().toString(36)}-${Math.random()…}` ``, rebuild `` `toast-${String(nextToastId.current)}` `` from a per-provider `useRef` counter. Id is used **only as a React `key`** (`primitives-overlay.tsx:1059`), never emitted into the DOM, so rendered output is identical | `primitives-overlay.tsx:983` | `primitives-overlay.tsx:975-977`,`993-994` | divergent | ruled: `clock-single-source` guard (`guard-inventory.json:20`) bans the `Date.now()` read; ref frontend-backend-integration §7 parity lane needs the id deterministic |
| UK139 | **useDsModalPresence / useDsModalOpen** | `primitives-overlay.tsx:118`,`130` | `primitives-overlay.tsx:122`,`134` | exact | — |
| UK140 | **Table / THead / TBody / TH / TD** — hairline separators, tabular numerals, `DsSortDirection` sort affordances (`ArrowUp`/`ArrowDown`/`ChevronsUpDown`) | `primitives-data.tsx:28`,`63`,`71`,`106`,`156` | `primitives-data.tsx:32`,`67`,`75`,`117`,`167` | exact | — (5 primitives) |
| UK141 | **TR** — rebuild adds `active:bg-[var(--ds-surface-3)]` + `dsMotion.fast` to the `interactive` arm; `hover:bg-[var(--ds-surface-2)]` and `selected` unchanged. `:active` is transient so no stored parity screenshot can observe it | `primitives-data.tsx:75` (`interactive && "cursor-pointer hover:bg-[var(--ds-surface-2)]"`) | `primitives-data.tsx:79` (adds `"active:bg-[var(--ds-surface-3)]"`, `dsMotion.fast`) | extra | **OPEN — operator call** |
| UK142 | **ProgressBar** | `primitives-data.tsx:194` | `primitives-data.tsx:205` | exact | — |
| UK143 | **TimelineSteps** — `DsStepState` = `done` \| `current` \| `pending` \| `failed` \| `skipped`; `STEP_DOT`/`STEP_TEXT` maps identical | `primitives-data.tsx:290` | `primitives-data.tsx:311` | exact | — |
| UK144 | `DsStep.trailing` + `DsStep.trailingTitle` — new optional right-aligned column on the step row (the measured duration), plus the wrapper `<span>` reflow that hosts it (`flex-1 items-baseline gap-…` around the label stack) | `primitives-data.tsx:259`,`351-358` | `primitives-data.tsx:270`,`375-390` | extra | **OPEN — operator call** |
| UK145 | **KeyValueList** | `primitives-data.tsx:372` | `primitives-data.tsx:403` | exact | — |
| UK146 | **The specimen page itself** — `DemoUiKit.tsx`, 1189 lines, `TooltipProvider delayDuration={250}` + `ToastProvider` wrapping a `max-w-[1180px]` main | `DemoUiKit.tsx:124` | — | missing | **OPEN — operator call** |
| UK147 | Kit `KitHeader` — sticky `h-[var(--ds-h-topbar)]` bar, `ShieldCheck` in an accent-quiet square, title *"Rebuild demo — design system"*, `Badge tone="info"` reading *"dev only · specimen page"*, and a 7-item anchor `nav aria-label="Sections"` | `DemoUiKit.tsx:145` | — | missing | **OPEN — operator call** |
| UK148 | Kit `Section` specimen shell — `h2` at `dsText.section` + a `max-w-[80ch]` note paragraph over a `--ds-border-subtle` hairline | `DemoUiKit.tsx:174` | — | missing | **OPEN — operator call** |
| UK149 | Kit `Row` specimen shell — a `w-[130px]` `SectionLabel` beside a wrapping specimen tray | `DemoUiKit.tsx:205` | — | missing | **OPEN — operator call** |
| UK150 | Kit §Status — *"The eight statuses"*, note *"Four separating channels per status: hue, emphasis tier, icon and label…"*, plus the 8-row `QUEUE_SAMPLE` dense-queue proof | `DemoUiKit.tsx:227-300` | — | missing | **OPEN — operator call** |
| UK151 | Kit §Actions — note *"One primary per surface, one danger per surface…"*; Rows `Variants`, `Sizes`, `States`, `Icon buttons` | `DemoUiKit.tsx:301-366` | — | missing | **OPEN — operator call** |
| UK152 | Kit §Display — note *"Small parts that carry a value… Every number is tabular…"*; Rows `Badges`, `Counts`, `Chips`, `Keys`, `Loading` | `DemoUiKit.tsx:367-454` | — | missing | **OPEN — operator call** |
| UK153 | Kit §Containers — note *"Depth comes from surface plus a hairline, never from a shadow…"*; Panel/Banner/MetaLine/BulletList/ChipRow/CardBase/CompareGrid/EmptyState specimens incl. the 5-width `CHIP_ROW_SPECIMEN` | `DemoUiKit.tsx:455-758` | — | missing | **OPEN — operator call** |
| UK154 | Kit §Forms — note *"Every control has a visible label; errors are announced, not just coloured…"*; `Recorded value` and `Checkbox` specimens | `DemoUiKit.tsx:759-892` | — | missing | **OPEN — operator call** |
| UK155 | Kit §Overlays — note *"Radix owns focus… A danger toast never auto-dismisses."*; Rows `Dialog`, `ContextMenu`, `Toast`, `Tooltip`, `Popover` + the Drawer specimen | `DemoUiKit.tsx:893-1113` | — | missing | **OPEN — operator call** |
| UK156 | Kit §Foundations — note *"Seven type sizes, one 8px space rhythm, five surfaces, three elevations, one focus ring…"*; `TYPE_SPECIMENS`, `SURFACES` swatch list and the `ELEVATIONS` trio cast on `--ds-surface-page` | `DemoUiKit.tsx:1114-1188` | — | missing | **OPEN — operator call** |
| UK157 | `kit.html` + `kit-entry.tsx` — the standalone mount for the specimen page | `kit.html`, `kit-entry.tsx` | — | missing | **OPEN — operator call** |
| UK158 | `DESIGN.md` still instructs the reader to skim `DemoUiKit.tsx` and open `http://localhost:3943/…/kit.html` — a binding document naming artifacts absent from this tree | `DESIGN.md:112`,`690`,`691`,`696-697` | `DESIGN.md:112`,`690`,`691`,`696-697` | divergent | **OPEN — operator call** |
| UK159 | `src/dashboard/surfaces/ui-catalog.tsx` — the generated **selector** catalog surface. NOT a DS specimen page; it is the demo's `DemoCatalogView.tsx` counterpart and does not display primitives | `DemoCatalogView.tsx` | `ui-catalog.tsx:1` | exact | — (noted here only to close the "is there an equivalent?" question) |

**Counts:** exact 119 · divergent 13 · missing 12 · extra 15 · OPEN 18

---

## Roll-up

### Counts

| # | Region | Rows | exact | divergent | missing | extra | OPEN marks |
|---|--------|-----:|------:|----------:|--------:|------:|-----------:|
| 1 | Archive | 250 | 106 | 94 | 20 | 30 | 61 |
| 2 | Activity report | 117 | 57 | 21 | 12 | 27 | 7 |
| 3 | Workflow Explorer | 182 | 55 | 42 | 33 | 52 | 30 |
| 4 | UI catalog | 69 | 0 | 0 | 39 | 30 | 6 |
| 5 | Settings + storage doctor | 72 | 2 | 8 | 48 | 14 | 15 |
| 6 | Data intake | 155 | 10 | 64 | 47 | 34 | 57 |
| 7 | Phone capture | 62 | 1 | 3 | 20 | 38 | 6 |
| 8 | Version-bump dialog | 53 | 3 | 29 | 13 | 8 | 38 |
| 9 | Design-system primitives | 159 | 119 | 13 | 12 | 15 | 18 |
| | **Total** | **1119** | **353** | **274** | **244** | **248** | **238** |

**How to read the spread.** The two ends are the interesting part. The design system is 75% `exact`
because it was COPIED rather than re-implemented; the UI catalog is 0% `exact` because the two files
paired under that name are not the same surface at all. Everything between is a port whose
divergences are mostly ruled. The 238 OPEN marks map to **30 unresolved numbered decision groups**
below: 35 numbered groups total, less four resolved groups (13–15 and 22) and one doc/code
inconsistency that requires repair rather than an operator ruling (19). A single decision (the
bump's arms, the specimen page, the Settings container) can still drag a dozen rows behind it.

**Parity blind spots found while doing this.** `tests/parity/references/` has scenes for archive,
activity, explorer, catalog, intake and capture, and **none for Settings, none for the version-bump
dialog, and none for a UI-kit page** — the three regions with the largest gaps are the three nobody
photographs.

---

### The OPEN list, as decisions rather than rows

Each entry is one question for the operator, with every row it settles. `→` names the rows.

**Structural — each of these decides many rows**

1. **The archive index is not virtualised.** `@tanstack/react-virtual` is not a dependency of this
   repo; the row/section pixel constants, `overscan`, the two spacer `<tr>`s and one flat item list
   are all absent, and each sweep gets its own `<TBody>`. `archive.tsx:12-19` still argues the demo's
   800-row case. → AR32, AR33, AR34, AR35, AR51
2. **The version bump's MAJOR/MINOR arms are a label.** Nothing in `src/domain/archive/`, the archive
   query or the command kernel branches on `VersionBumpChangeRecordSchema.kind`, so a bump recorded
   `minor` archives every prior-version run and can be refused by a non-terminal one — the two things
   the demo says a minor bump must never do. → VB1, and behind it VB13, VB22, VB23, VB26, VB30, VB31,
   VB33, VB45
3. **There is no DS specimen page.** `DemoUiKit.tsx` (7 sections) has no counterpart — no `kit.html`,
   no `kit-entry.tsx`, no surface on which the full primitive set can be reviewed. Build it, or record
   the deferral with a named trigger. → UK146–UK157
4. **The row-and-panel vocabulary has no rebuild surface.** The demo's catalog names 8 row variants,
   3 containment kinds, a rollup chain and 4 panel kinds; only `panelKind` (`run`/`member`/`group`)
   reaches the wire, and `review` has no arm. D184 retires the demo SHELL as a port target and does
   not answer this. → CA1, CA16, CA23, CA36
5. **Settings is a `Dialog`; the demo is a full-page takeover behind a 220px nav.** §9.8 rules the
   section list and the read-only-ness and is silent on the container. → SE1, SE2, SE3, SE4, SE8
6. **The keyboard legend is reachable from nowhere.** The demo made one change in two halves — delete
   the top bar's keyboard glyph (*"we already have help in settings"*) AND add Settings → Help →
   Keyboard. The rebuild ported the deletion only: `ShortcutsPopover` (`top-bar.tsx:912`) has zero
   callers in `src/` or `tests/`, and `app/global-keys.ts` binds no `?`. → SE7, SE43, SE44
7. **Two Settings status sections need no new authority.** System hosts reads `systemInstances`,
   already on the bootstrap; Workflow capabilities is descriptor-derived, from the same descriptors
   the Explorer reads. They are absent because `settingsSections` lists only `storage`. → SE40, SE41,
   SE42
8. **The operator half of phone capture does not exist.** `DemoCapture.tsx` is the DESKTOP view of a
   phone session; the rebuild built the phone. After the QR is scanned nothing on the desktop shows
   pages received, the phase, the expiry, an unreadable page or a contact sheet. D175 rules the phone;
   nothing rules the operator half's disappearance. → CP3, CP4, CP5, CP17, CP18, CP59
9. **Intake stages 5 and 6 have no surface.** The Manifest stage renders nowhere (the enqueued banner
   shows one bare `manifest <uuid>`) and the rerun diff's added/removed lists are unserved. D173
   ratifies the dialog→workspace reshaping in detail and says nothing about where these went. →
   IN15, IN16, IN123, IN124, IN126, IN127, IN131, IN137, IN139, IN144
10. **The intake review gate is gone.** `Run` goes live the moment validation returns, with unresolved
    rejections on screen — `intake-review--paper-ink--1280x720.a11y.yml` shows `button "Run 3 rows"`
    beside four unresolved rejects. The kernel refuses it so nothing wrong is filed, but
    `ref data-intake-and-edit-data` §2.2 step 4 and §7 vector 4 both say the button is disabled, and
    the courtesy blocker list never names `unresolved-rejections`. → IN118, IN119, IN120
11. **No archived capture can be opened.** The tile is inert: no `Open` / `What it was` action, no
    lightbox, no purged note. A "what it was" viewer needs no bytes, so D179's pointers-only rule does
    not decide it. → AR188, AR189, AR190, AR249
12. **The reviewed bump plan reports a count, never the runs.** The demo lists every archivable run by
    name in a scrolling `Well`. → VB25, VB24

**Records that are false or stale at HEAD — fix the record or fix the code**

13. **RESOLVED 2026-08-25 (`3d461962`, `d1f87916`).** The index now serves `dryRun` and `warnings`;
    the list/detail draw them with the already-served `priority`, `displayName` and `subtitle`.
    → AR62, AR67, AR95, AR96, AR121, AR123
14. **RESOLVED 2026-08-25 (`d1f87916`).** The stale comment is gone and every sweep location folds
    `changeRecord.value.kind`; a generation-1 absence stays named rather than guessed.
    → AR77, AR78, AR91, AR129
15. **RESOLVED 2026-08-25 (`4e09fb49`).** The Explorer's `Version registry` action reaches the
    Archive's actual `Versions & bumps` view through `?archive=&archiveView=versions`; the route owns
    the visible Archive view, so no local panel impersonates the registry. → EX5
16. `explorer.tsx:8-10` claims `skippedAboveBoundary` was ported; `explorer-model.ts` exports no such
    function and no early-skip mark is drawn. → EX180
17. `src/dashboard/DESIGN.md` is ported verbatim and declared binding, and at `:112`, `:690`, `:691`
    and `:696-697` instructs its reader to skim `DemoUiKit.tsx` and open `kit.html` on port 3943 —
    artifacts absent from this tree. Its porting header names two adaptations and neither the missing
    page nor the barrel's real path. Behind it, the ratchet-arm port dropped 3 of legacy's 4 checks
    while `DESIGN.md:209`,`:546`,`:548-549` still name two of them as guard-enforced. → UK66, UK67,
    UK69, UK158
18. `ref dashboard-surfaces` §9.5.3 says catalog entry is *"two `ghost` buttons in the panel's action
    bar beside `Import spreadsheet`"*; no such button exists in `queue-toolbar.tsx`, `shell.tsx` or
    `dashboard-app.tsx`, and the catalog is reachable only by typing `?catalog=`. → CA41
19. `ref data-intake-and-edit-data`'s D173 text says *"CONSTANTS RENDER READ-ONLY"*; `intake.tsx:934`
    reads `session.constants.length` inside a blocker computation and nothing renders one. Recorded as
    IN155 (`ruled: D173`) rather than OPEN, because no arm sets a constant today — but the decision's
    own sentence is not satisfied by the code.

**Cross-region conventions the operator should rule once**

20. **The takeover `Panel` wrapper.** Every rebuild takeover wraps the demo's bare `div` in a `Panel`
    with `aria-label` and a `useDsEnterTransition` translate/opacity enter (`activity.tsx:1095`,
    `archive.tsx:2168`, `explorer.tsx:1475`). Consistent, and nowhere ruled. → AC12, AR9
21. **`overflow-x-auto` wrappers.** The rebuild wraps tables the demo leaves bare. → AC62, AC77, AR225
22. **Raw wire enums where the demo prints a label — archive arms resolved 2026-08-25
    (`d1f87916`), Activity resolved in this unit (`4da19fd7`).** The archive filter, bump blocker table and
    Activity caveat now use the shared status vocabulary. The Activity prose keeps `waiting on you`
    and renders the parked arm as `write parked`, while the pill remains `Write parked`. → AC24
    (**resolved**), AR27 (**resolved**), VB19 (**resolved**)
23. **Async states the demo has no counterpart for** — `Skeleton` panes and `Refusal` panes on the
    archive and Activity. Honest additions; nowhere ruled as a convention. → AR244, AR245
24. **Two names per row in the Explorer** — the rebuild prints the node LABEL beside the id, and adds
    a `contracts` count and a `re-runs on every attempt` line that `ref operator-trust` §5.2 does not
    list. → EX66, EX87, EX88, EX127, EX133, EX165
25. **The Explorer's editable pencil moved out of the field cell** into two `FactRow`s below the table,
    reversing the demo's stated argument that *"editability is a property of a FIELD, so it is a mark
    on the field's own row"*. → EX114, EX125

**Copy, token and shape drift — one operator pass would clear most of these**

26. Archive copy: back-button label, table label, both empty-state arms, the test-instance
    `aria-label`, the sweep name/trace/title/popover strings, the detail header title and subtitle,
    the export toast, the relaunch banner's title and body, the summary `MetaLine`, the ledger well
    and table labels, the log-line and data-point shapes, the People tab, the capture tile geometry
    and badge tones, the relaunch preview's badge and cautions, and the Versions view's four banner
    sentences. → AR4, AR27, AR37, AR39, AR54, AR56, AR59, AR68, AR80, AR82, AR83, AR84, AR90, AR94,
    AR97, AR102, AR103, AR105, AR106, AR124, AR127, AR128, AR133, AR141, AR142, AR148, AR150, AR152,
    AR153, AR154, AR162, AR163, AR169, AR172, AR174, AR177, AR178, AR182, AR184, AR187, AR207, AR211,
    AR212, AR218, AR220, AR221, AR223, AR229, AR239, AR241
27. Intake naming and copy: 18 renamed labels and sentences (title, subtitle, Cancel→Close, the
    invisible `Source file` heading, `sha` length, row-count wording, the mapping table's name and two
    column heads, the unbound option, the duplicate-header suffix, the rejections empty state, the six
    reject labels, the exclude placeholder and button, the fix button, and `Start N runs`→`Run N rows`).
    → IN2, IN3, IN7, IN27, IN44, IN45, IN64, IN66, IN69, IN72, IN73, IN74, IN95, IN101, IN110, IN115,
    IN116, IN138
28. Intake shape: the rejection list became cards, the fix and exclude editors collapsed into inline
    inputs, the exclusions `Well` became a chip section, and the enqueue-result banner family changed
    arms. → IN21–IN24, IN30, IN32, IN34, IN46, IN47, IN55, IN56, IN61, IN70, IN75, IN97–IN100,
    IN102, IN103, IN107–IN109, IN111–IN114, IN117, IN122
29. Intake facts the wire serves and the surface drops: per-candidate `confidence`, suggestion `score`,
    the reject `code`, the whole corrections list, the manifest `artifact` id and `createdAt`, and the
    footer's header-row and fingerprint echo. → IN8, IN9, IN53, IN82, IN106, IN121, IN126, IN127, IN131
30. Explorer copy and geometry: the list header meta, four graph-less arms that are structurally
    unreachable, the connector sentence, three kind words and their tones, the fact-chip vocabulary,
    the empty-contract sentence, the `colgroup` split, two posture notes, the delegation paragraph's
    capitalisation, the pencil paragraph's voice, and the whole empty-state block plus its new action.
    → EX8, EX13, EX18, EX20, EX23, EX26, EX55, EX65, EX72, EX73, EX74, EX75, EX96, EX101, EX103,
    EX155, EX156, EX166, EX168, EX171, EX172
31. Version-bump dialog: the authoring step's shape and every string in it. → VB4–VB12, VB14–VB17,
    VB27–VB29, VB32, VB34, VB36–VB38, VB40, VB41, VB43, VB44, VB47, VB50
32. Activity: the date pair carries no `role="group"`/`aria-label` where the chip group did, two
    spacing tokens drift, and a `shrink-0` the demo does not have. → AC10, AC11, AC19, AC90
33. Settings storage: the section header, the health banner, the stat cards and the backups table.
    → SE45, SE46, and the banner's container/icon (SE63, SE64)
34. DS: `TR`'s `interactive` arm gains an `active:` state and `dsMotion.fast`, and `DsStep` gains a
    `trailing` duration column that reflows `TimelineSteps`. → UK141, UK144
35. Catalog: the row `MetaLine` counts verification scenarios where §5.8's thesis is naming them.
    → CA59

---

### Proposed `builds:` lines

Notation per `.claude/skills/custom-update-plan/SKILL.md` §Notation — `FE` / `BE` / `BOTH` / `WIRE` /
`DOCS` / `PROOF`. These are PROPOSED, not landed: this audit edits no doc and no roadmap node.

**`{#dash-defaults}`** — `docs/rebuild/03a-finish-the-dashboard.md` §roadmap-status

```
- [ ] FE the archive index is VIRTUALISED — `@tanstack/react-virtual` is not a dependency of this repo, the row/section pixel constants, the spacer rows and the one flat item list are all absent, and each sweep still gets its own `<TBody>`, while `archive.tsx:12-19` argues the demo's 800-row case (fidelity-3 AR32–AR35, AR51)
- [ ] FE the archive index draws the facts its own detail already holds — `dryRun`, `warnings`, `displayName`, `subtitle` and `priority` are served on `detail.row` and read by nothing (fidelity-3 AR62, AR67, AR95, AR96, AR121, AR123)
- [ ] FE the sweep head prints the bump KIND — `changeRecord.value.kind` has ridden `ArchiveSweepWire` since D223 (fidelity-3 AR77, AR78, AR91, AR129)
- [x] FE every closed-enum status renders through its ds label — the archive filter and rows, the bump blocker table and the Activity caveat all use the shared wire→display fold; the Activity prose renders `waiting on you or write parked` and the pill's exact label remains `Write parked` (fidelity-3 AC24, AR27, VB19)
- [ ] FE the intake review gate — `Run` is live beside unresolved rejections, which `ref data-intake-and-edit-data` §2.2 step 4 and §7 vector 4 both say it is not, and the courtesy blocker list never names `unresolved-rejections` (fidelity-3 IN118–IN120)
- [ ] FE the version bump's MAJOR/MINOR arms behave, or the field stops claiming they do — nothing branches on `VersionBumpChangeRecordSchema.kind`, so a `minor` bump archives every prior-version run (fidelity-3 VB1)
- [ ] FE the reviewed bump plan names the runs it would archive, not their count (fidelity-3 VB25)
- [ ] DOCS the four false-at-HEAD provenance claims are corrected or the code catches up — `docs/findings/queue-rows.md:221`, `archive.tsx:386-388`, `ref operator-trust` §5.7 vs `archive.tsx:2351`, `explorer.tsx:8-10` (fidelity-3 §Roll-up 13–16)
- [ ] PROOF a parity scene for Settings, for the version-bump dialog and for a DS specimen page — the three regions with the largest gaps are the three the corpus does not photograph
```

**`{#def-settings}`** — `docs/rebuild/04-close-the-deferrals.md` §roadmap-status

```
- [ ] FE Settings → Help → Keyboard, or a global `?` — the top bar's keyboard glyph was deleted on the operator's instruction *"we already have help in settings"* and the destination was never built, so `ShortcutsPopover` (`top-bar.tsx:912`) has ZERO callers and `surfaces/shortcuts.tsx` is reachable from nowhere (fidelity-3 SE7, SE43, SE44)
- [ ] BE `settingsSections` lists the status sections whose data is already served — System hosts reads `systemInstances` off the bootstrap, Workflow capabilities is descriptor-derived; neither needs new authority (fidelity-3 SE40–SE42)
- [ ] FE the storage section's at-rest half — the three stat cards (authority generation, rows on disk, newest backup) and the `Backups` table with Size / Verdict / Note (fidelity-3 SE45, SE46, SE48, SE49)
- [ ] WIRE `rowsOnDisk`, and a backup's `sizeLabel` and `note`, so those cards and that table have something true to print (fidelity-3 SE48, SE49)
- [ ] the container question — Settings is a `Dialog` and the demo is a full-page takeover behind a 220px nav; `ref dashboard-surfaces` §9.8 rules the section list and is silent on the shape (fidelity-3 SE1–SE4, SE8)
- [ ] FE once the write half lands: the four editable groups and their eight leaves, the three-layer provenance stack, the source badges, the hazard badge and its escalation banner, the per-section dirty marker and the one action bar (fidelity-3 SE9–SE36)
```

**`{#def-byte-path}`** — `docs/rebuild/04-close-the-deferrals.md` §roadmap-status

```
- [ ] BOTH the OPERATOR half of phone capture — `DemoCapture.tsx` is the DESKTOP view of a phone session and this tree built the phone; after the QR is scanned nothing shows pages received, the phase, the expiry, an unreadable page or a contact sheet. D175 rules the phone; nothing rules the operator half (fidelity-3 CP3–CP5, CP17, CP18, CP59)
- [ ] WIRE an operator-scoped capture-session read (list + one) and a poll or SSE — `CAPTURE_PHONE_ROUTES` is a closed phone-scoped union and the only operator route mints a session (fidelity-3 CP2, CP6–CP8, CP11, CP12, CP16, CP21)
- [ ] WIRE `unreadable` / `focusScore` on `CapturePhotoWireSchema`, plus a photo's filename, pixel dimensions and arrival instant, so the unreadable-page alert and the tile frame have something to read (fidelity-3 CP9, CP10, CP13–CP15)
- [ ] FE the phone's RETAKE — `PUT /api/v1/capture/phone/photos/:photoId` is already in `CAPTURE_PHONE_ROUTES` and `CapturePhoneClient` implements no `replacePhoto`, while the surface's own copy tells the operator to "Retake it on the phone" (fidelity-3 CP45)
```

**`{#def-search-export}`** — `docs/rebuild/04-close-the-deferrals.md` §roadmap-status

```
- [ ] BE the artifact-bytes route also unblocks the ARCHIVE's evidence tiles — no archived capture can be opened at all, so the demo's `Open` / `What it was` action, its lightbox and its purged note have nowhere to land (fidelity-3 AR188–AR190, AR249)
- [ ] FE the archive's `Change records` section — the record rides `ArchiveSweepWire.changeRecord` today, so this is buildable with no wire change (fidelity-3 AR234)
- [ ] FE the intake MANIFEST stage and the rerun diff — plan id, source sha, artifact id, mapping fingerprint, mapping snapshot hash, workflow contract fingerprint, the totals line and the per-source-row disposition table; the enqueued banner shows one bare `manifest <uuid>` today (fidelity-3 IN123–IN137)
- [ ] WIRE the intake fields those two stages need on `IntakeSessionWire` — `mappingFingerprint`, `mappingSnapshotHash`, `workflowContractFingerprint`, a pre-flight `intakeManifestId`, `SourceRowDispositionSchema` / `ValidRowSchema`, and `RerunDiffSchema.added` / `removed` (fidelity-3 IN125, IN128–IN130, IN133–IN136, IN142, IN143)
- [ ] DOCS book the wire gaps this audit named that nothing books — 22 intake and 5 capture gaps have no `docs/findings/intake.md` or `capture.md`, `docs/findings/explorer.md` reports zero open records while three explorer gaps are real (the minor version half, per-node `skippedInDryRun`, per-field `when`), and no minor/presentation version exists anywhere in the tree so every `v3.1`-shaped tag renders `v1`
```

---

### What this audit did NOT do

It changed nothing. No surface, no token, no doc, no roadmap node and no findings file was edited —
the deliverable is this ledger. The `ruled:` citations were each verified against
`docs/rebuild/reference/decisions.md` and the owning doc at HEAD; where no decision covered a
divergence it is marked **OPEN** rather than attributed to a decision that does not say it. The nine
regions were audited from source, against the demo running at `http://localhost:5173/?view=rebuild-demo`
and the parity references, at the paths named in each section header.
