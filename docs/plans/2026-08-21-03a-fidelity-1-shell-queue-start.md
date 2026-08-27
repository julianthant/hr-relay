# 03a demo-fidelity audit — group 1: the SHELL, the QUEUE, the RUN START

**Date:** 2026-08-21 · **Unit:** demo-fidelity AUDIT group 1 of 3 (`feature/docs-fid-1`) · **Status:** maintained closure ledger — A46 closed and adversarial corrections verified 2026-08-25

## What this is

A fresh, element-by-element re-audit of three regions of the dashboard against the legacy
**rebuild-demo**, at HEAD. It is a LEDGER for the fold unit to apply to
`docs/rebuild/03a-finish-the-dashboard.md` and the roadmap; it edits nothing itself.

**The standard (binding).** The dashboard must be a **1:1 detail replica** of
`/Users/julianhein/Projects/hr-automation/src/dashboard/components/dev/rebuild-demo/`. Every element
is either **exactly copied**, or a divergence that is **recorded with a ruling** (a D-number, a plan
decision, or a dated operator call), or **OPEN for the operator**. A divergence is never dismissed,
waved through or "modified" without a citation. Unserved data is not a reason to drop a detail — the
UI is built to the demo and the gap becomes a `builds:` line.

**Baseline.** `docs/plans/2026-08-13-detail-fidelity-audit.md` (regions R1–R8, 2026-08-13/14). It is
the baseline, NOT the answer: every element it listed gets a fresh verdict here, and elements it
missed are added. Track B (D226–D261) moved a great deal since.

**Verdict vocabulary.** `exact` · `divergent` · `missing` (in the demo, absent here) · `extra` (here,
absent in the demo). Every non-exact row carries exactly one reason:
`ruled: <citation>` · `unserved: <what the wire lacks>` · **`OPEN — operator call`**.

**Visual evidence.** `tests/parity/references/queue-day--graphite-warm--1440x900.png` read as an
image (the rebuild's own current pixels, populated fixture day, floating panel open, session bar
expanded-collapsed). The demo dev server was NOT started for this pass; rows resting on a demo pixel
rather than on demo SOURCE are marked "unverified visually" in place.

---

## Region A — SHELL (`DemoShell.tsx`, `DemoTopBarSurfaces.tsx`, `demo-shortcuts.tsx`, `demo-nav-history.ts`, `demo-status.tsx`, `RebuildDemo.tsx` shell half)

Rebuild: `src/dashboard/surfaces/{top-bar,top-bar-model,day-search,day-search-model,shell,shell-model,status,status-model,shortcuts,shortcuts-model,workflow-category}.*`,
`src/dashboard/app/{dashboard-app,global-keys,nav-history}.*`, `src/dashboard/ds/theme.ts`.

### A.1 Top bar — frame, brand, history, switcher

| # | Element (what the operator sees) | Demo | Rebuild | Verdict | Reason |
|---|---|---|---|---|---|
| A1 | Top-bar frame: `hTopbar`, bottom border, card surface, `gap-cozy`, `--ds-shell-inset` padding | `DemoShell.tsx:524-531` | `top-bar.tsx:1062-1069` | exact | — |
| A2 | Brand lockup: accent-quiet square, `ShieldCheck` mark, `h1` "HR Automation" at `dsText.ui` | `DemoShell.tsx:537-545` | `top-bar.tsx:1073-1081` | exact | — |
| A3 | Back/Forward pair — `ArrowLeft`/`ArrowRight`, `size="sm"`, `gap-hair`, disabled arm keeps its slot | `DemoShell.tsx:470-491` | `top-bar.tsx:396-417` | exact | — |
| A4 | Back title — "Back to {place}" / "Back — nowhere to go yet" | `DemoShell.tsx:476` | `top-bar.tsx:402` | exact | — |
| A5 | Forward title — "Forward to {place}" / "Forward — nowhere to go yet" | `DemoShell.tsx:484` | `top-bar.tsx:410` | exact | — |
| A6 | View switcher container — bordered, `p-hair`, `surface-2`, `radius-md`, `shrink-0` | `DemoShell.tsx:552-558` | `top-bar.tsx:956-962` | exact | — |
| A7 | Four segments **Dashboard · Archive · Explorer · Activity**, `aria-pressed`, `h-sm`, `dsText.meta`, pressed = `surface-3` + semibold | `DemoShell.tsx:560-580` + `:275-280` | `top-bar.tsx:964-984` + `top-bar-model.ts:181-187` | exact | — |
| A8 | Switcher sits immediately right of the history pair, left of search | `DemoShell.tsx:550-581` | `top-bar.tsx:1085-1087` | exact | — |

### A.2 Top bar — search

| # | Element | Demo | Rebuild | Verdict | Reason |
|---|---|---|---|---|---|
| A9 | Search trigger geometry — `ml-auto flex-1 max-w-[240px]`, `h-md`, `border-strong`, `surface-2`, `Search` glyph, trailing `Kbd /` | `DemoTopBarSurfaces.tsx:414-431` | `day-search.tsx:209-226` | exact | — |
| A10 | Trigger placeholder — "Search people, files, trace ids…" | `DemoTopBarSurfaces.tsx:427-429` | `day-search.tsx:222-224` ("Search this day…") | divergent | `ruled: D184` (cross-day corpus deferred; the narrowing is stated at `day-search.tsx:6-20`) |
| A11 | Trigger accessible name — "Search runs" | `DemoTopBarSurfaces.tsx:417` | `day-search.tsx:212` ("Search this day’s runs") | divergent | `ruled: D184` |
| A12 | `/` opens search from anywhere the caret is not in a field | `DemoTopBarSurfaces.tsx:395-406` | `day-search.tsx:183-199` | exact | — |
| A13 | Dialog `size="xl"`, title "Search runs", description naming the scanned scope | `DemoTopBarSurfaces.tsx:434-438` | `day-search.tsx:229-233` | divergent | `ruled: D184` (title "Search this day", description names the one partition) |
| A14 | `SearchInput` with clear, `aria-label="Search query"`, four worked example values in the placeholder | `DemoTopBarSurfaces.tsx:440-447` | `day-search.tsx:245-252` | exact | — |
| A15 | `Try:` chip row | `DemoTopBarSurfaces.tsx:448-455` (6 authored examples) | `day-search.tsx:253-268` (≤4, derived from the day's own rows, each carrying a field `label`) | divergent | `ruled: prior audit R1` (fixture queries would be fabricated data; the demo's zero-hit and failing-lookup chips have nothing here to demonstrate) |
| A16 | First `Escape` clears a non-empty query, second closes the dialog | — | `day-search.tsx:158` | extra | `ruled: D272 item 3` — **RETAINED with a recorded exception** (unit V1, 2026-08-26). Clearing is the cheaper correction and the second press still reaches the dialog, so nothing the demo's Escape does is unavailable here. Recorded at the site and in `src/dashboard/CLAUDE.md` §"Ruled deviations from the rebuild-demo"; deliberately NOT a `shortcuts-model.ts` entry, because the legend's own *When they fire* rules give an open dialog the keyboard including Escape |
| A17 | Idle state — `SearchX`, "Nothing typed yet", scope sentence | `DemoTopBarSurfaces.tsx:476-483` | `day-search.tsx:78-86` | divergent | `ruled: D184` (copy names this day's row count) |
| A18 | **Failed-lookup `Refusal`** — "a lookup that could not run is an ERROR, never no matches" | `DemoTopBarSurfaces.tsx:488-501` | `day-search.tsx:—` | missing | `ruled: D184` / `day-search.tsx:6-20` — the find is a pure client fold over an already-served array, so there is no lookup that can fail; the arm returns when the cross-day route lands |
| A19 | Empty state — "No run matches “q”" + the read/scan sentence | `DemoTopBarSurfaces.tsx:503-511` | `day-search.tsx:88-96` | divergent | `ruled: D184` |
| A20 | Hit header `MetaLine` — "N matches · N rows read across N days" | `DemoTopBarSurfaces.tsx:515-522` | `day-search.tsx:100-107` ("… read on this day") | divergent | `ruled: D184` |
| A21 | Results table, five columns **Row · Workflow · Matched · Day · Status** | `DemoTopBarSurfaces.tsx:525-533` | `day-search.tsx:110-118` | exact | — |
| A22 | Row cell — title over trace id in `nums` muted | `DemoTopBarSurfaces.tsx:537-541` | `day-search.tsx:122-129` | exact | — |
| A23 | Matched cell — neutral `Badge` naming the field + the value in `nums` | `DemoTopBarSurfaces.tsx:544-549` | `day-search.tsx:131-136` | exact | — |
| A24 | Day column value | `DemoTopBarSurfaces.tsx:550` (per-hit day) | `day-search.tsx:137` (the one partition, constant down the column) | divergent | `ruled: D184` (stated at `day-search.tsx:68-74`) |
| A25 | Status cell — `StatusPill size="sm"` | `DemoTopBarSurfaces.tsx:551-553` | `day-search.tsx:138-140` | exact | — |
| A26 | Row click opens the run and closes the dialog | `DemoTopBarSurfaces.tsx:461-466` | `day-search.tsx:275-278` | exact | — |

### A.3 Top bar — the date navigator

| # | Element | Demo | Rebuild | Verdict | Reason |
|---|---|---|---|---|---|
| A27 | `‹ pill ›` cluster, `gap-0.5`, `shrink-0` | `DemoTopBarSurfaces.tsx:333` | `top-bar.tsx:299` | exact | — |
| A28 | Previous-day arrow + its two labels ("Previous day — X" / "No earlier day in the tracker") | `DemoTopBarSurfaces.tsx:334-340` | `top-bar.tsx:300-308` | exact | — |
| A29 | Next-day arrow + its two labels ("Next day — X" / "Today is the newest day") | `DemoTopBarSurfaces.tsx:373-379` | `top-bar.tsx:358-366` | exact | — |
| A30 | Unserved-day arm — `indexOf` is `-1`, so Next lands on the EARLIEST served day and Previous refuses | `DemoTopBarSurfaces.tsx:327-330` | `top-bar.tsx:282-294` | exact | — |
| A31 | Date pill — `Calendar` glyph, `dayLabelWithToday`, `CountBadge` (tone `info` on today), `h-sm`, `gap-1.5 px-1.5`, open-state border+fill | `DemoTopBarSurfaces.tsx:343-361` | `top-bar.tsx:326-343` | exact | — |
| A32 | Pill hint — "N rows on this day · the tracker holds N days" | `DemoTopBarSurfaces.tsx:346` (native `title`) | `top-bar.tsx:321-324` (`Tooltip side="bottom"` around the trigger) | divergent | `ruled: operator W2.5 defect filing` — recorded in prior audit R1 ("Date-pill Tooltip stays … hover hints anchor to their trigger"); reason restated at `top-bar.tsx:309-319` |
| A33 | Pill accessible name — "Pick a day — showing X, N rows" | `DemoTopBarSurfaces.tsx:345` | `top-bar.tsx:328` | exact | — |
| A34 | Calendar month header `‹ Month YYYY ›` with the two disabled reasons ("The tracker holds nothing before/after …") | `DemoTopBarSurfaces.tsx:200-218` | `top-bar.tsx:135-165` | exact | — |
| A35 | Weekday heads `Su Mo Tu We Th Fr Sa`, `aria-hidden`, caps | `DemoTopBarSurfaces.tsx:160,220-226` | `top-bar-model.ts:58` + `top-bar.tsx:167-173` | exact | — |
| A36 | 42 cells (six Sunday-first weeks, never reflowing), `role="grid"`, roving tab stop, clamped arrows, Home/End | `DemoTopBarSurfaces.tsx:178-196,228-239` | `top-bar-model.ts:114-148` + `top-bar.tsx:120-131,175-185` | exact | — |
| A37 | Cell — day number, `aria-selected`, `aria-current="date"`, "— N rows" / "— the tracker holds no rows", unavailable `title`, the accent DOT (never a count) | `DemoTopBarSurfaces.tsx:240-289` | `top-bar.tsx:187-238` | exact | — |
| A38 | Footer — `Today` (disabled on today, moves month AND day) + "N days on disk" | `DemoTopBarSurfaces.tsx:295-310` | `top-bar.tsx:244-259` | exact | — |

### A.4 Top bar — the quiet icon cluster

| # | Element | Demo | Rebuild | Verdict | Reason |
|---|---|---|---|---|---|
| A39 | **The stethoscope is on the bar at all times** — first item of the cluster | `DemoShell.tsx:592` | `top-bar.tsx:1106` (renders only when `preflight` is served; served on no build) | missing | `unserved: FrontendBootstrapWireSchema#preflight` — declared-unserved in `config/pending-wire-bindings.json` (D184); the consumer is built |
| A40 | Doctor trigger — `Stethoscope`, tinted danger/waiting by the worst verdict, label "Preflight — every check passes" / "— N failing, N warning" | `DemoShell.tsx:302-318` | `top-bar.tsx:460-476` | exact | — |
| A41 | Doctor popover — title "Preflight", the advisory note, per check `Badge`+label+`checkedAt`+detail+`Blocks:`+`Fix:` | `DemoShell.tsx:319-340` | `top-bar.tsx:477-500` | exact | — |
| A42 | "Run doctor again" — `ListChecks`, secondary | `DemoShell.tsx:341-348` | `top-bar.tsx:501-510` (disabled, titled "This build serves no doctor-rerun command") | divergent | `unserved: the paired doctor-rerun command` (rides the same D184 preflight binding) |
| A43 | Bell — raw square button, `p-snug`, `Bell` md, hover fill, accessible name "Notifications — N unread" | `DemoTopBarSurfaces.tsx:665-676` | `top-bar.tsx:673-684` | exact | — |
| A44 | Bell badge — corner superscript, NOTHING painted at zero, `failed-solid` when any unread is critical else `waiting-solid`, dark ink on bright fill | `DemoTopBarSurfaces.tsx:677-694` | `top-bar.tsx:685-704` | exact | — |
| A45 | `Drawer` 480px, title "Notifications", description "N unread · pings are silent · a record survives a failed desktop delivery" | `DemoTopBarSurfaces.tsx:697-702` | `top-bar.tsx:707-712` | exact | — |
| A46 | **The pinned backfill-gap `Refusal`** — the one record that cannot be filtered, snoozed or dismissed | `DemoTopBarSurfaces.tsx:707-722` | `top-bar.tsx`; filter partition `top-bar-model.ts`; protocol `dashboard-stream.ts` | exact | closed `68dea43a`, corrected `e108ff3f`/`a2d2a8e8`: exact generation-bound replay evidence excludes restart/rebuild; stable interval identity is single-flight and no-churn across restart; authority refuses every mutation/fold; one bounded lane keeps 6+ pins, filters and ordinary rows reachable at 390×844 |
| A47 | Filter chips **All · Unread · Pings · Inbox · Snoozed**, each with its count, counted over EVERY served record | `DemoTopBarSurfaces.tsx:724-730` | `top-bar.tsx:725-736` | exact | — |
| A48 | `Pings` / `Inbox` counts read zero | `DemoTopBarSurfaces.tsx:635-636` | `top-bar-model.ts:77-82` (`Pings` counts A46's pinned arm; ordinary delivery remains unserved, `Inbox` stays zero) | divergent | `ruled: prior audit R1` for ordinary rows; A46 is a closed safety route, not inferred delivery data |
| A49 | EmptyState "Nothing under this filter" + the never-deleted sentence | `DemoTopBarSurfaces.tsx:733-738` | `top-bar.tsx:739-744` | exact | — |
| A50 | Standing footer sentence ("Failed · gate · parked · repeating · storage ping …") | `DemoTopBarSurfaces.tsx:762-771` | `top-bar.tsx:764-773` | exact | — |
| A51 | A refused command is REPORTED in the drawer (`role="alert"`) | — | `top-bar.tsx:717-723` | extra | `ruled: prior audit R1` (the demo has no server to refuse one; swallowing it would let a failed `Mark read` read as a success) — the CAS `conflict` arm is D253 |
| A52 | Row anatomy — unread dot, severity glyph (`Siren`/`TriangleAlert`/`Inbox`), title (semibold when unread), `N ago` `MetaLine`, `opacity-60` while snoozed | `DemoTopBarSurfaces.tsx:801-814` | `top-bar.tsx:804-834` | exact | — |
| A53 | Row body paragraph | `DemoTopBarSurfaces.tsx:816` | `top-bar.tsx:836-838` (renders only when `body` is present; never is) | missing | `ruled: ref dashboard-surfaces §2.6 / D138` — the trigger union is ids, closed codes and counts with no free-text field; markup ported whole behind an optional field (`NotificationRowExtras`) |
| A54 | Row badge row — trigger label, `Ping`/`Inbox only`, `+N more like this`, `delivery failed` | `DemoTopBarSurfaces.tsx:818-828` | `top-bar.tsx:840-860` (all four behind optional fields; none served) | missing | `ruled: ref dashboard-surfaces §2.6 / D138` |
| A55 | Link button word | `DemoTopBarSurfaces.tsx:831-835` (the wire's own `link.label`) | `top-bar.tsx:863-867` + `:554-557` (a UI table keyed on `link.kind` → "Open run" / "Open failure") | divergent | `ruled: D262` (the wire carries an id, not prose; the destination's WORD is this surface's copy) |
| A56 | `Mark read` / `Mark unread` with the `MailOpen`/`Mail` pair | `DemoTopBarSurfaces.tsx:836-843` | `top-bar.tsx:868-875` | exact | — |
| A57 | `Snooze 1h` / `Un-snooze` with `Clock` | `DemoTopBarSurfaces.tsx:844-846` | `top-bar.tsx:881-890` (Un-snooze DISABLED, titled with its reason) | divergent | `ruled: prior audit R1` (the kernel serves `notification-snooze` and no inverse; hiding it moved every button beside it) |
| A58 | The PING — a toast on arrival, carrying the link action | `DemoTopBarSurfaces.tsx:595-615` | `top-bar.tsx:—` | missing | `ruled: D138` (delivery is an OS notification the server attempts after the durable row commits; the demo's toast is its stand-in — it has no server) |
| A59 | Theme control — one `IconButton`, `Sun`/`Moon`, label naming the DESTINATION ("Switch to Paper Ink") | `DemoShell.tsx:603-614` | `top-bar.tsx:1116-1127` | exact | — |
| A60 | **The `FlaskConical` "Demo surfaces" popover** (row & panel catalog · design system · the storage fixture switch) | `DemoShell.tsx:617` + `:367-440` | `top-bar.tsx:1128-1130` (absent) | missing | `ruled: operator 2026-08-14` (commit `8f55a168` "remove the UI catalog glyph from the top bar (operator call; route stays)") for the catalog half; the kit and the storage fixture are demo scaffolding with no product counterpart |
| A61 | The keyboard glyph is GONE from the bar (operator quote in the demo source) | `DemoShell.tsx:594-599` | `top-bar.tsx:1108-1112` | exact | — |
| A62 | `ShortcutsPopover` stays exported and unmounted, whole, for Settings → Help | `DemoTopBarSurfaces.tsx:121-154` | `top-bar.tsx:912-941` | exact | — |
| A63 | Gear — `aria-pressed` + `surface-3` fill when its surface owns the screen, LAST in the cluster | `DemoShell.tsx:620-627` | `settings.tsx:313-336` | exact | — |
| A64 | Gear attention dot for storage health | — | `settings.tsx:328-333` | extra | `ruled: D169 / D222` + ref dashboard-surfaces §9.8 (the at-rest summary rides the bootstrap; the dot is `storageNeedsAttention`) |
| A65 | **What the gear OPENS** — the demo's gear switches to a full-page `settings` takeover with its own `PageHeader` and Back | `DemoShell.tsx:623` + `RebuildDemo.tsx:656-657` | `settings.tsx:313,337` (a `Dialog size="lg"`) | divergent | **OPEN — operator call** (ref dashboard-surfaces §9.8 says only "the gear in the top bar, opening the sections the SERVER lists"; takeover-vs-dialog is undecided in writing) |
| A66 | Cluster ORDER — doctor · bell · theme · flask · gear | `DemoShell.tsx:589-628` | `top-bar.tsx:1101-1138` (doctor · bell · theme · gear) | divergent | follows A39 (unserved) and A60 (operator call) — no separate cause |

### A.5 The Workflow Panel — launcher, list, three modes

| # | Element | Demo | Rebuild | Verdict | Reason |
|---|---|---|---|---|---|
| A67 | Launcher shape — `toolbarControl()`, `active:translate-y-px`, showing = `border-loud` + `surface-selected` + semibold, resting = `border-strong` + card | `DemoShell.tsx:833-854` | `shell.tsx:165-183` + `shell-model.ts:129-138` | exact | — |
| A68 | Launcher glyph pair `PanelLeftClose` / `PanelLeftOpen` | `DemoShell.tsx:856-860` | `shell.tsx:185-189` | exact | — |
| A69 | Launcher carries the workflow's 2-char CODE in `nums` | `DemoShell.tsx:861` | `shell.tsx:190` | exact | — |
| A70 | The `--ds-border-loud` hairline rule between code and count | `DemoShell.tsx:865` | `shell.tsx:194` | exact | — |
| A71 | Launcher count = day ACTIVE (queued + running) across EVERY workflow, amber above zero, `fg-faint` at zero, never vanishing | `DemoShell.tsx:866-881` | `shell.tsx:195-208` (`dayActive` = `activeCount(dayWire.statusCounts)`, `dashboard-app.tsx:424`) | exact | — |
| A72 | Launcher accessible name — "Workflow Panel — X, {mode}. {scope}" | `DemoShell.tsx:841` | `shell.tsx:173` | exact | — |
| A73 | Launcher `title` — four lines: name + code, the scope sentence, the Needs-you disclaimer, "w cycles floating · icon · sidebar" | `DemoShell.tsx:842` | `shell.tsx:174` | exact | — |
| A74 | `aria-expanded` + `aria-controls` (floating only) | `DemoShell.tsx:836-837` | `shell.tsx:168-169` | exact | — |
| A75 | Panel header — caps "Workflow Panel", `hBar`, subtle bottom border, `pl-cozy pr-snug` | `DemoShell.tsx:1028-1042` | `shell.tsx:345-359` | exact | — |
| A76 | Header controls — Float (`PictureInPicture2`) / Dock (`PanelLeft`) + Minimise (`Minus`), all `size="sm"`, labels verbatim | `DemoShell.tsx:756-782` | `shell.tsx:99-125` | exact | — |
| A77 | Column head `active │ all` — caps, right-aligned, `gap-hair`, `px-cozy pb-snug`, the `│` is `aria-hidden` | `DemoShell.tsx:987-996` | `shell.tsx:316-325` | exact | — |
| A78 | Group heading — caps, muted, `px-cozy pb-snug`, more air above than below (`pb-cozy` on the group) | `DemoShell.tsx:997-1003` | `shell.tsx:327-332` | exact | — |
| A79 | Rail entry — `hRow`, `radius-md`, `pl-tight pr-base`, `gap-base`, selected = `surface-selected`, hover = `surface-3` | `DemoShell.tsx:906-915` | `shell.tsx:240-248` | exact | — |
| A80 | The 3px selection marker (`--ds-border-w-rail`, `--ds-ring` when on, hover `border-loud`) | `DemoShell.tsx:919-929` | `shell.tsx:252-259` | exact | — |
| A81 | Entry label — truncate, semibold `fg` when on / medium `fg-secondary` otherwise | `DemoShell.tsx:930-940` | `shell.tsx:260-262` | divergent | **OPEN — operator call** — the rebuild's label span adds `gap-[var(--ds-space-snug)]`; the demo's is `flex min-w-0 flex-1 items-center` with no gap (harmless today because the span holds one child, but it is an unrecorded spacing change) |
| A82 | Entry count cluster — `active │ all`, amber/faint arms, `gap-hair`, `dsText.meta` + `nums` | `DemoShell.tsx:951-977` | `shell.tsx:273-305` | divergent | **OPEN — operator call** — the rebuild adds `pl-[var(--ds-space-base)]` to the cluster (in-code reason: "the row gap alone leaves a truncated label crowding the numbers"); no ruling cites it |
| A83 | Entry count `title` — "{label}: N active (queued or running) of N rows today" | `DemoShell.tsx:952` | `shell.tsx:274` | exact | — |
| A84 | Entry count `aria-label` — "N active of N in {label}" | `DemoShell.tsx:953` | `shell.tsx:275` | exact | — |
| A85 | Rows are deliberately icon-free | `DemoShell.tsx:1007-1008` | `shell.tsx:260-262` | exact | — |
| A86 | Per-entry `note` `title` from `RAIL_NOTES` | `DemoShell.tsx:646,905` (map is EMPTY) | `shell.tsx:—` | exact | the demo renders no note either — nothing to draw |
| A87 | Rail MEMBERSHIP — the demo lists every registered workflow | `DemoShell.tsx:662-666` | `shell-model.ts:239-250` (drops `chunk-harness` and `proving`; empty categories drop with them) | divergent | `ruled: D219 → D220 → D241` + ref dashboard-surfaces §9.9 |
| A88 | Group ORDER is frontend-hardcoded, membership is the descriptor's `category`, unlisted appends, empty drops | `DemoShell.tsx:648-666` | `workflow-category.ts` (`groupWorkflowsByCategory`) | exact | mechanism ported whole |
| A89 | Sidebar — `nav`, `aria-label="Workflow Panel"`, `wRail`, right border, card surface | `DemoShell.tsx:1051-1060` | `shell.tsx:369-378` | exact | — |
| A90 | Floating window — `absolute left-cozy inset-y-cozy`, `wRail`, `layer.menu`, `radius-lg`, `elev.high`, enter motion, `origin-top-left`, overlay surface | `DemoShell.tsx:1164-1174` | `shell.tsx:475-485` | exact | — |
| A91 | Window is NOT a Radix `Popover`/`Dialog` (toast viewport must not go inert in the default state) | `DemoShell.tsx:1063-1076` | `shell.tsx:381-394` | exact | — |
| A92 | Window `role="dialog"` + `aria-label` | `DemoShell.tsx:1146-1147` | `shell.tsx:456-458` | exact | — |
| A93 | Escape inside the window → `icon`, with `stopPropagation` | `DemoShell.tsx:1148-1153` | `shell.tsx:459-464` | exact | — |
| A94 | Tab cycles at the window's focusable edges | `DemoShell.tsx:1154-1163` | `shell.tsx:465-474` | exact | — |
| A95 | Outside `pointerdown` (capture phase) dismisses to `icon`, the toggle excluded | `DemoShell.tsx:1107-1120` | `shell.tsx:422-435` | exact | — |
| A96 | Opened by a press → caret lands on `[aria-current="page"]` | `DemoShell.tsx:1099-1102` | `shell.tsx:414-417` | exact | — |
| A97 | The enter animation runs only when the operator opened it (`opened`) | `DemoShell.tsx:1087-1095` | `shell.tsx:402-410` | exact | — |
| A98 | `leave()` hands focus back to the launcher only when focus was inside | `DemoShell.tsx:1132-1140` | `shell.tsx:443-451` | exact | — |
| A99 | Mode persistence — three-value cycle, default `floating`, an unreadable store lands on the default | `DemoShell.tsx:692-707,719-744` | `shell-model.ts:155-207` | divergent | `ruled: operational isolation` (CLAUDE.md) — the key is namespaced `hr-dashboard.workflow-panel`; the demo's blanket `catch` is replaced by `readEnumPreference`, which keeps "nothing stored / storage refused / value outside the cycle" apart. Recorded no-action in prior audit R2 |
| A100 | The panel is rendered on the QUEUE view only; a takeover replaces the queue whole | `RebuildDemo.tsx:679-690` | `dashboard-app.tsx:991-1001,1334-1344` | exact | — |

### A.6 The status pills band

| # | Element | Demo | Rebuild | Verdict | Reason |
|---|---|---|---|---|---|
| A101 | Group container — `role="group"`, "Filter the queue by status", `gap-tight`, `overflow-x-auto` (a status is never behind an overflow menu) | `DemoShell.tsx:1341-1345` | `shell.tsx:630-634` | exact | — |
| A102 | Composites are a SEGMENTED control — one `h-toolbar` box, `rounded-l` + `border-r-0` / `rounded-r`, inner `role="group"` "Scope the queue" | `DemoShell.tsx:1246-1281,1346-1350` | `shell.tsx:531-568,635` | exact | — |
| A103 | `All` — `LayoutDashboard`, muted tone, hint "Every row in this view" | `DemoShell.tsx:1351` | `shell.tsx:636-644` | exact | — |
| A104 | `Needs you` — `Eye`, waiting tone, hint "Waiting on you + Write parked — the two states that are stuck on a decision from you" | `DemoShell.tsx:1352-1359` | `shell.tsx:645-653` | exact | — |
| A105 | Composite VALUES are closed under addition with the eight pills | `DemoShell.tsx:1278` (one `countRows` record) | `shell-model.ts:98-118,289-291` (folds the SAME served array) | exact | `ruled: R4-2 / D81` — equivalent by construction, and the projection refines that per-status counts sum to the workflow's `count` |
| A106 | Eight pills in order **queued · running · waiting · parked · verifiedDone · doneWarnings · failed · cancelled** | `DemoShell.tsx:1191-1200` | `shell-model.ts:267-276` | exact | — |
| A107 | Pill at rest — `h-toolbar`, `gap-snug`, `px-base`, `radius-md`, card surface, base border | `DemoShell.tsx:1298-1319` | `shell.tsx:588-607` | exact | — |
| A108 | A zero pill RECEDES — transparent border, no fill, no word, `fg-faint` icon and digit, slot and click target kept | `DemoShell.tsx:1287,1308,1316-1317,1330-1332` | `shell.tsx:573,596,604-605,618-620` | exact | — |
| A109 | The `running` pill spins only above zero, `motion-reduce` respected | `DemoShell.tsx:1327` | `shell.tsx:615` | exact | — |
| A110 | Pill icon tone reads the ONE status table (never a second hue map) | `DemoShell.tsx:1208` | `shell.tsx:614` (`spec.soloTone`) | exact | — |
| A111 | Pill accessible name | `DemoShell.tsx:1295` (`${spec.label} — ${n}`) | `shell.tsx:586` (`${spec.accessibleLabel} — ${n}`) | divergent | `ruled: D22 amended / D126` — `verifiedDone` and `doneWarnings` both DRAW `Done`, so the demo's two pills computed one name |
| A112 | Pill hint | `DemoShell.tsx:1296` (native `title={spec.meaning}`) | `shell.tsx:577` (`Tooltip side="top"`) | divergent | `ruled: operator W2.5 defect filing` (prior audit R1; reason restated at `shell.tsx:504-512`) |
| A113 | A pressed pill toggles back to `all` | `DemoShell.tsx:1297` | `shell.tsx:587` | exact | — |
| A114 | The band's SCOPE — the demo counts the day across every workflow; the rebuild counts the ACTIVE workflow, matching the queue below it | `DemoShell.tsx:1232-1240` | `shell.tsx:519-527` + `dashboard-app.tsx` `scopedStatusCounts` | divergent | `ruled: prior audit R4-1` + D81 — the ported title "Every row in this view" was FALSE while the band was day-wide |

### A.7 The Session footer and the worker cards

| # | Element | Demo | Rebuild | Verdict | Reason |
|---|---|---|---|---|---|
| A115 | `section aria-label="Session Panel"`, top border, card surface, `shrink-0` | `DemoShell.tsx:1838` | `shell.tsx:974` | exact | — |
| A116 | Bar — `hBar`, `gap-base`, `--ds-shell-inset` | `DemoShell.tsx:1839` | `shell.tsx:975` | exact | — |
| A117 | Expander — `ChevronDown`/`ChevronUp`, "Sessions" semibold, `h-md`, hover `surface-3`, `aria-expanded` | `DemoShell.tsx:1840-1858` | `shell.tsx:976-994` | exact | — |
| A118 | The tally row's VOCABULARY — demo: running / authenticating / idle (+ failed above zero) | `DemoShell.tsx:1859-1883` | `shell.tsx:995-1014` + `shell-model.ts:318-334,422` (Running / Starting / Idle always, Failed and Stopped above zero) | divergent | `ruled: D248` — the card is the authority LEASE; `authenticating`/`keepalive` have no producer and `starting` is the arm that carries "alive and not yet reporting" |
| A119 | Only the `failed` segment takes ink; every other tally stays muted | `DemoShell.tsx:1877-1882` | `shell.tsx:999-1008` | exact | — |
| A120 | Blocked-lease chip — `Hourglass`, "N waiting on a lease", naming `title` | `DemoShell.tsx:1884-1892` | `shell.tsx:—` | missing | `ruled: D248/D249` — ref execution-and-sessions §1 partitions a browser profile per `(worker, system, instance, configFingerprint)`, so there is no cross-worker lease and nothing that could name a holder; the arm was removed rather than left unreachable |
| A121 | Attention chip — `AlertTriangle`, "N browsers need attention", loud `capacityChip` | `DemoShell.tsx:1893-1898` | `shell.tsx:1019-1031` (counts failed WORKERS, `title` names workflow + stop reason) | divergent | `ruled: D248/D249` — nothing probes a live session, so browser health is `unknown` for every tile and a browser count would be a number nobody measured |
| A122 | …and its SENTENCE reads **"1 worker need attention"** at a count of one | — | `shell.tsx:2263` | exact | `ported: D272 item 4` (unit V1, 2026-08-26) — the chip prints the demo's stable plural `{n} workers need attention`. `plural(n,"worker")` is gone from this sentence, so noun and verb can no longer disagree at a count of one |
| A123 | `capacityChip` lives at module scope with BOTH arms | `DemoShell.tsx:1531-1541` | `shell-model.ts:402-412` | exact | — |
| A124 | The `+` **Add workers** `IconButton` (`Plus`, "Start parallel executors — pick a workflow and how many", `aria-haspopup="dialog"`) | `DemoShell.tsx:1903-1910` | `shell.tsx:1034-1044` (absent, with the refusal written in place) | missing | `ruled: D249` — two named blockers: `createDashboardWorkerSupervisor` refuses the process effect by name, and no worker POOL exists in authority to hold the `expectedVersion` the CAS needs |
| A125 | `AddWorkersDialog` — workflow `Select`, the `Workers` stepper (`Minus`/`aria-live` count/`Plus`), the per-worker result vector, `DialogFooter meta="N started"`, "Start N workers" | `DemoShell.tsx:1723-1823` | `shell.tsx:—` | missing | `ruled: D249` (anatomy stays pinned in the 2026-08-13 audit for the port that follows) |
| A126 | App-version tag | `DemoShell.tsx:1919-1924` (`app 3.1` — MAJOR.MINOR) | `shell.tsx:2293` (`app MAJOR.MINOR` through `appVersionTag`/`fmtAppVersion`, `format.ts:215-236`) | exact | `ported: D272 item 4` (unit V1, 2026-08-26) — the tag prints the demo's two-part pair, cut from the served semver by a fold that THROWS on a string it cannot read rather than degrading, so the drawn string and the MAJOR/MINOR tooltip beside it now name the same two components |
| A127 | App-version tooltip — the whole MAJOR/MINOR archive sentence | `DemoShell.tsx:1920` | `shell.tsx:1053` | exact | — |
| A128 | Hairline rule between the version and the link indicator | `DemoShell.tsx:1925` | `shell.tsx:1058` | exact | — |
| A129 | `Live` indicator — pulsing success dot + word | `DemoShell.tsx:1926-1929` | `shell.tsx:1061-1068` + `shell-model.ts:430-463` (the real `SubscriptionState`: Live / Connecting / Reconnecting / Degraded / Stopped, `role="status"`, error in the `title`) | divergent | `ruled: ref frontend-backend-integration §3.5` (prior audit R7-12 — kept as strictly better: a dashboard still painting the last snapshot must say so) |
| A130 | Card strip — `items-stretch`, `overflow-x-auto`, top border, `gap-base`, shell inset, `py-cozy` | `DemoShell.tsx:1933-1948` | `shell.tsx:1072-1081` | exact | — |
| A131 | Card frame — `w-session-card`, `gap-snug`, `p-base`, `radius-lg`, card surface, no explicit height | `DemoShell.tsx:1572-1583` | `shell.tsx:780-792` | divergent | `ruled: D248` — the demo also tints the border danger at `phase === "failed"`; here a failed lease takes the crashed arm (A140) instead, so the live card has one border |
| A132 | Card head — phase dot, workflow title, queued chip, state word in caps at `ml-auto` | `DemoShell.tsx:1585-1603` | `shell.tsx:794-813` | exact | — |
| A133 | The queued chip — `h-xs`, queued border/ink, "N queued", drawn only above zero | `DemoShell.tsx:1589-1601` | `shell.tsx:799-811` | exact | — |
| A134 | The worker id | — | `shell.tsx:758,782` (`title="Worker <id>"` on the article) | extra | `ruled: D248` (the card names the WORKFLOW; the worker id is a process name and lives in the title) |
| A135 | Card subline | `DemoShell.tsx:1604-1606` (authored fixture sentence) | `shell.tsx:817-826` (the served `currentRun` union — trace id, or the server's own reason) | divergent | `ruled: D248` |
| A136 | Standing directive chip ("Pausing/Stopping after this item") | — | `shell.tsx:830-832` + `shell-model.ts:353-358` | extra | `ruled: D248` (a pause is a DIRECTIVE, not a phase — a card reading `Paused` while its worker is mid-write would report an intent as a fact) |
| A137 | Lease-wait block — `Hourglass`, "Waiting Xm for the {system} lease — held by {workflow} {trace}" | `DemoShell.tsx:1611-1627` | `shell.tsx:—` | missing | `ruled: D248/D249` (same argument as A120) |
| A138 | Browser tile grid, two columns, an odd last tile spans both | `DemoShell.tsx:1631-1635` | `shell.tsx:836-847` | exact | — |
| A139 | `BrowserTile` — caps label with a health glyph, second line naming the state, health-toned border/fill | `DemoShell.tsx:1438-1478` + `:1400-1431` | `shell.tsx:683-713` | divergent | `ruled: D248/D249` — every tile draws the demo's own `unknown` tone (`Not checked`, no fill) because nothing probes a live session, and the second line carries the session's AGE because no span, checkpoint or lease records a page address |
| A140 | Tile right-click MENU — Peek · Check now · Bring to front · Refresh page · Reopen tab · Pause/Resume auto-recovery, with `role="button"`/`aria-haspopup`/Enter-Space | `DemoShell.tsx:1447-1462,1479-1514` | `shell.tsx:—` | missing | `ruled: D249` (`refresh-browser`/`reopen-browser` are real kernel verbs whose process effects `server/dashboard/compose.ts` refuses BY NAME — every item would open a menu that 500s) |
| A141 | THE BASE — pipeline + footer pinned as one block with `mt-auto`, so every card's band sits on ONE baseline | `DemoShell.tsx:1653` | `shell.tsx:864` | exact | — |
| A142 | Micro-pipeline band RESERVED at `hMicroPipeline` on every card | `DemoShell.tsx:1654` | `shell.tsx:865` | exact | — |
| A143 | Pipeline step dots + connectors (done/current/pending) | `DemoShell.tsx:1656-1679` | `shell.tsx:865` (band drawn empty) | missing | `ruled: D248/D249` (`steps[]` has no producer; dots drawn from nothing would be the worst lie on a panel about what a worker is doing) |
| A144 | Footer row — top subtle border, `gap-snug`, `pt-snug`, `dsText.meta` muted | `DemoShell.tsx:1681-1688` | `shell.tsx:866-873` | exact | — |
| A145 | STEP slot hard left, truncating, with its own `title` | `DemoShell.tsx:1700-1702` | `shell.tsx:879` (always empty, no `title`) | divergent | `ruled: D248` — nothing on this wire names the node a worker is inside; the demo's own empty arm is `s.step ?? ""` |
| A146 | Elapsed clock, right-aligned `tabular-nums`, `—` at zero | `DemoShell.tsx:1703-1705` | `shell.tsx:884-886` + `shell-model.ts:378-380` | exact | dated by the served instant (D256) rather than a demo tick — the same value every other elapsed on screen uses |
| A147 | `Stop` — outline, `size="sm"`, `shrink-0` | `DemoShell.tsx:1706-1708` | `shell.tsx:887-898` | divergent | `ruled: D249` — it posts `stop-worker` with the served `leaseVersion`, and is DISABLED with a reason when the lease can take no directive (a control that vanishes reads as one that was never there) |
| A148 | Crashed card — danger border and quiet fill, `size-2` danger dot, workflow title, caps word, the reason paragraph | `DemoShell.tsx:1549-1570` | `shell.tsx:755-777` | divergent | `ruled: D248` — the caps word is the lease's own state (`Failed`, not the demo's `Launch failed`) and the line under it is the recorded `stopReason`, so "crashed" and "you stopped it" can never render the same |
| A149 | Which cards exist at all | `DemoShell.tsx:1949-1951` (a fixture array) | `shell.tsx:1082-1091` (the authority worker LEASE joined with its span fold) | divergent | `ruled: D248` |

### A.8 Keys, the registry, history, theme and the shell frame

| # | Element | Demo | Rebuild | Verdict | Reason |
|---|---|---|---|---|---|
| A150 | ONE window `keydown` listener with three guards in order: typing target · modifier · open modal | `RebuildDemo.tsx:445-451` | `global-keys.ts:121-130` | exact | — |
| A151 | `r` — start a run, from any view | `RebuildDemo.tsx:453-457` | `global-keys.ts:132-136` | exact | — |
| A152 | `m` — the selected row's full command set through `openContextMenuFor` | `RebuildDemo.tsx:471-475` | `global-keys.ts:150-155` | exact | — |
| A153 | `j` / `k` (+ `ArrowDown` / `ArrowUp`) over the drawn order | `RebuildDemo.tsx:480-485` | `global-keys.ts:157-170` | exact | — |
| A154 | `n` — the next row waiting on you, wrapping | `RebuildDemo.tsx:486-498` | `global-keys.ts:171-177` + `:95-103` | divergent | `ruled: prior audit — QueueBaseFields ledger row (CLOSED 2026-08-19)`: the demo also excludes `containment === "rejected"`, which has no producer; a status-only set is strictly WIDER and can never hide a row that needs attention |
| A155 | `Enter` — open the selected group's drill-in | `RebuildDemo.tsx:499-504` | `global-keys.ts:—` | missing | `ruled: prior audit ebe2bac` — no drill-in exists (R3 f.23/24, deferred with a named trigger) and here selecting a row already opens it; the registry entry was REMOVED rather than bound to nothing |
| A156 | `Escape` — innermost first: drill-out, then minimise the panel | `RebuildDemo.tsx:505-516` | `global-keys.ts:178-187` (panel arm only; an already-minimised panel lets the key fall through) | divergent | `ruled: prior audit ebe2bac` (same drill-in) |
| A157 | `w` — cycle floating · icon · sidebar | `RebuildDemo.tsx:517-519` | `global-keys.ts:188-192` | exact | — |
| A158 | `c` — mark the selected member checked | `RebuildDemo.tsx:520-525` | `global-keys.ts:—` | missing | `ruled: shortcuts.tsx:17-19` (1i drop — member-checked has no wire state, and the binding would be a lie in Help) |
| A159 | `1`–`4` — switch the detail panel's tab, over the tabs the OPEN run advertises | `RebuildDemo.tsx:526-531` | `global-keys.ts:193-201` | exact | — |
| A160 | The keyboard REGISTRY — nine entries with their scopes | `demo-shortcuts.tsx:34-48` | `shortcuts-model.ts:21-33` (seven; `Enter` and `c` gone, `Esc` re-worded to "minimise the Workflow Panel" and moved to `Anywhere`) | divergent | `ruled: prior audit ebe2bac` — two operator-facing surfaces asserting a binding that does not exist IS the defect |
| A161 | Legend renderer — `dl`, ungrouped for the popover / grouped with `SectionLabel` for Help, `Kbd` clusters, the `–` range join | `demo-shortcuts.tsx:61-128` | `shortcuts.tsx:47-114` | exact | — |
| A162 | Nav history semantics — truncate forward, no-op on the same place, no push while travelling, cap with the index moving | `demo-nav-history.ts:76-93` | `nav-history.ts` (ported whole) | exact | — |
| A163 | A PLACE | `demo-nav-history.ts:31-37` (workflow · rowId · tab) | `nav-history.ts:41-50` (day · workflow · runId nullable · tab) | divergent | `ruled: prior audit R1` ("NavPlace is a quad") — the demo derives a row's day from a constant corpus and this app cannot without a fetch; a panel with nothing open is a real place |
| A164 | History is recorded by OBSERVING the state, never by a `pushPlace()` per call site, with a ref stopping it recording its own travel | `RebuildDemo.tsx:403-414` | `dashboard-app.tsx:862-874` | exact | — |
| A165 | `navDestinationLabel` names the destination on the control's face | `demo-nav-history.ts:100-108` | `nav-history.ts` (ported) | exact | — |
| A166 | Theme attribute on `<html>` and `<body>`, with the `data-demo-theme-switching` cut for one frame | demo `ds/theme.ts` | `ds/theme.ts:76-91` | exact | — |
| A167 | `data-demo-theme` on the app's own root node | `RebuildDemo.tsx:598-600` | `dashboard-app.tsx:954-957` | exact | — |
| A168 | …and that root is the OUTERMOST node, **above** `ToastProvider`/`TooltipProvider` | `RebuildDemo.tsx:591-597,622-630` | `dashboard-app.tsx:173-203` (both providers wrap `LoadedApp`, so the theme root is INSIDE them) | divergent | **OPEN — operator call** — the demo records this nesting as load-bearing: the toast viewport is a FRAGMENT sibling of the provider's children, so with the providers outside it inherits none of the root's custom properties |
| A169 | `--ds-toast-inset-bottom: calc(var(--ds-h-bar) + var(--ds-space-loose))` set once by the shell, so a toast clears the Session bar | `RebuildDemo.tsx:601-619` | *(set nowhere — `grep -rn "ds-toast-inset-bottom" src/dashboard` finds only the ds primitive and DESIGN.md)* | missing | **OPEN — operator call** — the viewport falls back to `var(--ds-space-loose)` (`ds/primitives-overlay.tsx:1052`), which is exactly the state the demo's comment describes: *"every toast sat on top of the Sessions bar — visible the moment the page was booted, and invisible to typecheck"*. Coupled to A168: fixing it needs the variable AND the nesting |
| A170 | Root classes | `RebuildDemo.tsx:620` (`flex h-screen min-w-0 flex-col overflow-hidden`) | `dashboard-app.tsx:957` (`flex h-screen min-h-0 flex-col`) | divergent | **OPEN — operator call** — `min-w-0` and `overflow-hidden` are dropped; the rebuild adds `min-h-0`. No citation |
| A171 | The storage banner sits directly under the top bar, above the view switch, full-bleed, on every view | `RebuildDemo.tsx:652-654` | `dashboard-app.tsx:1022-1026` (inside `main`, `mx-[shell-inset] mt-[space-tight]`, and only for unreachable AUTHORITY) | divergent | `ruled: D222` + ref dashboard-surfaces §9.8 (a stale backup is a `storage` notification, not an every-view band) |
| A172 | Shell body — optional sidebar column then `main` (`flex min-h-0 min-w-0 flex-1 flex-col`) | `RebuildDemo.tsx:679-692` | `dashboard-app.tsx:991-1003` | exact | — |
| A173 | ONE composed action bar above the panels, three groups (where you are + what you start · what you are looking at · how you are looking at it) | `RebuildDemo.tsx:693-722` | `dashboard-app.tsx:1131-1187` | exact | D224's island treatment is the queue toolbar's own (Region B) |
| A174 | An `Import spreadsheet` button in the bar's left group | — | `dashboard-app.tsx:1565,1584-1589` | extra | `ruled: D272 item 3` — **RETAINED with a recorded exception** (unit V1, 2026-08-26). It is the only served door into the intake workspace: the demo reaches intake from inside the Run Modal and `RunStartSurfaces` serves no such handoff, so deleting it strands the workspace. Recorded at the site (with the rejected B/C arms named) and in `src/dashboard/CLAUDE.md`; the button goes when the modal grows the handoff. *Also visible to Region B (B141).* |
| A175 | `CommandResultFeed` — the persistent conflict/rejected band between the bar and the panels | `RebuildDemo.tsx:724-733` | `dashboard-app.tsx` + `actions.tsx` | divergent | **Landed 2026-08-26.** Every refusal reaches the D253-settled persistent feed between toolbar and panels; the demo’s settling sub-arm remains unserved and absent rather than invented. |
| A176 | Panel REGION — `relative min-h-0 flex-1` wrapper (the floating window's positioning context) with the grid inside it | `RebuildDemo.tsx:747-748` | `dashboard-app.tsx:1220-1221` | exact | — |
| A177 | Panel grid — `grid-cols-1`, `gap`/`p` at `--ds-shell-inset`, `min-[1180px]:grid-cols-[var(--ds-w-side-panel)_minmax(0,1fr)]` | `RebuildDemo.tsx:748` | `dashboard-app.tsx:1221` | exact | — |
| A178 | Session panel mounted below the shell body, under EVERY view | `RebuildDemo.tsx` shell tail | `dashboard-app.tsx:1351-1359` | exact | — |

**Counts (Region A):** 178 elements — **132 exact · 34 divergent · 11 missing · 8 extra** (an element is
counted once, under the strongest verdict). Reasons on the 46 non-exact rows: **ruled 34** ·
**unserved 2** · **OPEN 10**.

A46's adversarial correction changed its implementation proof, not its verdict or row accounting;
Region A therefore remains **132/178 exact** with **10 OPEN**.

**Since 08-14 (baseline R1/R2/R4/R7 + the R8 keyboard half):**

- **Fixed since the baseline:** A46's strict backfill-gap publisher and pinned Refusal landed in
  `68dea43a`; `e108ff3f` binds it to same-generation replay evidence, makes repeat identity no-churn
  and enforces immutability in authority, while `a2d2a8e8` proves the 6-pin mobile lane; the whole R7 `WorkerCardWireSchema` batch landed (R7-1 dead tone arms,
  R7-3's tile grid, R7-4's `Stop`, R7-5/6/7-data, R7-8's crashed arm — D248/D249); the global keydown
  listener exists and every advertised binding resolves (R2 D13/D14, R3 f.8, R5 f.7, R8 f.7 —
  `ebe2bac`); the panel's `ACTIVE│ALL` column, the 2-char code and the frontend category table (R2);
  the status band's workflow scoping and the `All` fold (R4-1/R4-2); the bell's whole demo anatomy,
  the doctor popover, the `Try:` chips, the five-column search table, the DateNav unserved-day arm and
  the ported nav history (R1); D256's one served clock now dates the worker cards and the bell.
- **Still open from the baseline:** R7-2 (`+` / AddWorkersDialog — A124/A125, two named blockers);
  R7-3's tile menus and the browser-health vocabulary (A139/A140); R7-7's step dots (A143); the
  preflight summary and its rerun command (A39/A42).
- **New here (not in the baseline):** A169/A168 the toast floor and the provider nesting (the demo's
  own documented gotcha, unported); A122 the "1 worker need attention" singular; A126 the app-version
  format against its own tooltip; A65 the gear opening a dialog rather than the demo's takeover; A58
  the arrival ping; A16 the Escape-clears affordance; A81/A82 two
  unrecorded rail-entry spacing changes; A170 the dropped root classes; A174 the `Import spreadsheet`
  button; A175 the `CommandResultFeed` band.

---

## Region B — QUEUE (`DemoQueue.tsx`, `DemoBulkBar.tsx`, `DemoActions.tsx` ↔ `surfaces/queue*`, `actions*`)

Oracle: `DemoQueue.tsx` (2002), `DemoBulkBar.tsx` (379), `DemoActions.tsx` (636), with `demo-status.tsx`
and `demo-data.ts` (`BAND_LABEL` :4096, `SORT_STATUS_RANK` :4259, `DEMO_SORTS` :4252) for the vocabularies.
Rebuild at HEAD (`135b13ca`): `surfaces/queue.tsx` (1682), `queue-model.ts` (325), `queue-toolbar.tsx` (516),
`actions.tsx` (518), `actions-model.ts` (100), `app/bulk-dispatch.ts` (202), composed
`app/dashboard-app.tsx:1131-1279`.

Pixels read as images: `tests/parity/references/queue-day--graphite-warm--1440x900.png` and
`…--1440x900--panel-dismissed.png` (the rebuild's current queue — bands, rows, member well, footer, toolbar).
Demo pixels not re-photographed this pass (the shell auditor owns the browser lane); every demo verdict below
is read from source, and the four rows that would need a demo pixel to settle are marked in their reason.

### B.1 — Panel chrome, empty state, bands

| # | Element (what the operator sees) | Demo | Rebuild | Verdict | Reason |
|---|---|---|---|---|---|
| B1 | Queue card: bordered `--ds-radius-lg` `--ds-surface-card` panel, `overflow-hidden`, `aria-label="Queue"` | `DemoQueue.tsx:1859` | `queue.tsx:1525-1528` | exact | — |
| B2 | Header bar: `--ds-h-bar`, bottom hairline, `px-cozy`, muted meta ink | `DemoQueue.tsx:1861-1871` | `queue.tsx:1538-1547` | exact | — |
| B3 | Header text — the workflow name and NOTHING else (`Person Lookup`), title type, truncating | `DemoQueue.tsx:1898` | `queue.tsx:1549` | exact | — |
| B4 | One scrolling region, `pb-3`, running the panel's full height | `DemoQueue.tsx:1900` | `queue.tsx:1551` | exact | — |
| B5 | Empty state: dashed box, `mx/mt-cozy`, `px-loose py-section`, `--ds-radius-lg` | `DemoQueue.tsx:1904-1912` | `queue.tsx:1554-1562` | exact | — |
| B6 | Empty heading glyph — `FileText` at `dsIcon.md`, muted, beside the sentence | `DemoQueue.tsx:1914` | `queue.tsx:1570` | exact | — |
| B7 | Empty heading, All scope: demo `No Person Lookup runs on Mon, Aug 3`; rebuild `No Person Lookup runs` | `DemoQueue.tsx:1932-1933` | `queue.tsx:1574` | divergent | `ruled: operator 2026-08-14` (recorded verbatim at `queue.tsx:1571-1573` — "the day is already the date navigator's one visible fact"; reverses the R3 as-built, which shipped the demo's dated string) |
| B8 | Empty heading, Needs-you scope: `No Person Lookup runs need your attention` | `DemoQueue.tsx:1935` | `queue.tsx:1576` | exact | — |
| B9 | Empty heading, status scope: `No Person Lookup runs are queued` (pill's own word, lowercased) | `DemoQueue.tsx:1936` + `filterWord` :1195 | `queue.tsx:1577` | exact | — |
| B10 | Empty body, All scope: "It is registered and can be run — there is simply nothing on this day." | `DemoQueue.tsx:1946-1947` | `queue.tsx:1581-1582` | exact | — |
| B11 | Empty body, filtered: "Nothing matches this filter." | `DemoQueue.tsx:1948` | `queue.tsx:1583` | exact | — |
| B12 | Empty CTA, All scope: "Start one with Start a run, or pick another workflow." | `DemoQueue.tsx:1952` | `queue.tsx:1587` | exact | — |
| B13 | Empty CTA, filtered: "Clear the filter to see all runs." | `DemoQueue.tsx:1953` | `queue.tsx:1588` | exact | — |
| B14 | Band order down the column: Needs you · Active · Queued · Finished today | `demo-data.ts:4111-4117` | `queue-model.ts:71-79` + `queue.tsx:1544` | exact | — |
| B15 | Band labels, verbatim | `demo-data.ts:4096-4101` | `queue-model.ts:61-67` | exact | — |
| B16 | Band head: caps type, `mx-cozy mt-loose mb-snug`, gap-base; amber ink on Needs you, muted elsewhere | `DemoQueue.tsx:1961-1970` | `queue.tsx:1595-1604` | exact | — |
| B17 | Band count pill: nums+micro, `h-xs`, `rounded-full`, `px-snug`; amber border on Needs you | `DemoQueue.tsx:1974-1984` | `queue.tsx:1611-1621` | exact | — |
| B18 | Band rule — the hairline that runs out to the panel edge | `DemoQueue.tsx:1985` | `queue.tsx:1622` | exact | — |
| B19 | `Finished today` narrows to `Finished` off today's partition | `DemoQueue.tsx:1972` | `queue.tsx:1606` | exact | — |
| B20 | Finished digest strip: dashed, `mx-cozy mt-base`, `px-cozy py-snug`, `--ds-radius-md`, wrapping | `DemoQueue.tsx:1988-1999` | `queue.tsx:1627-1638` | exact | — |
| B21 | Digest lead word: `Today:` on today, `{dayLabel}:` otherwise, semibold secondary | `DemoQueue.tsx:2000` | `queue.tsx:1640-1642` | exact | — |
| B22 | Digest `N verified` — printed even at zero, success ink on the number | `DemoQueue.tsx:2001-2003` | `queue.tsx:1643-1645` | exact | — |
| B23 | Digest `N with warnings` — amber, only above zero | `DemoQueue.tsx:2004-2008` | `queue.tsx:1646-1650` | exact | — |
| B24 | Digest `N failed` — red, only above zero | `DemoQueue.tsx:2009-2013` | `queue.tsx:1651-1655` | exact | — |
| B25 | Digest `N cancelled` — only above zero | `DemoQueue.tsx:2014-2018` | `queue.tsx:1656-1660` | exact | — |
| B26 | Digest drawn only under the All scope (a filtered subset would read as a day total) | `DemoQueue.tsx:1987` | `queue.tsx:1626` | exact | — |
| B27 | Sorting reorders WITHIN a band and never across one | `DemoQueue.tsx:2021` | `queue.tsx:1545-1549` + `queue-model.ts:139-152` | exact | — |

### B.2 — The row card

| # | Element (what the operator sees) | Demo | Rebuild | Verdict | Reason |
|---|---|---|---|---|---|
| B28 | Row gutter: `px-cozy pt-snug`, first row `pt-cozy` | `DemoQueue.tsx:807` | `queue.tsx:1330` | exact | — |
| B29 | Whole card is one press target: `role="button"`, `aria-pressed`, Enter/Space, `data-demo-row-id` | `DemoQueue.tsx:809-825` | `queue.tsx:1338-1354` | exact | — |
| B30 | Card accessible name uses the ACCESSIBLE status word (`done with warnings`), not the visible `Done` | `DemoQueue.tsx:818` (visible word) | `queue.tsx:1345` | divergent | `ruled: D22 (amended 2026-08-04) / D126` — the two terminal dones share the visible word and are separated on screen by hue + `△ n`, neither of which a screen reader can read |
| B31 | Card accessible name carries the GATE AGE — `…— waiting on you · 18m` | `DemoQueue.tsx:818` (`statusText(status, gateAge(row, tick))`) | `queue.tsx:1345` (`queueRowAccessibleName(surface, nowIso)`) | exact | Fixed 2026-08-25 (F4B): QueueRow consumes the one model composition, which passes the served `gateOpenedAt` age to `statusAccessibleName`; the mutation-pinned unit case proves deleting that argument loses `· 18m 0s`. |
| B32 | Card resting border: ONE ink for every status; selection is the lighter perimeter only, no fill change | `DemoQueue.tsx:827-844` | `queue.tsx:1356-1370` | exact | — |
| B33 | The attention settle: a lift of `--ds-travel-sm`, border unchanged, 900 ms, on the EDGE only, never on mount | `DemoQueue.tsx:752-773` | `queue-model.ts:158-186` | exact | — |
| B34 | Row grid: one leading `--ds-w-row-indent` track, one `gap-y-snug`, `px-cozy py-snug` | `DemoQueue.tsx:860-863` | `queue.tsx:1382-1385` | exact | — |
| B35 | Leading status glyph in an `h-xs` box, so icon · name · pill share one centre | `DemoQueue.tsx:871-876` | `queue.tsx:1390-1392` | exact | — |
| B36 | Bulk checkbox on the title line: `size-3.5`, accent, `Select {row} for a bulk command` | `DemoQueue.tsx:889-898` | `queue.tsx:1402-1411` | exact | — |
| B37 | Title: `dsText.title`, semibold, truncating (never wrapping the pill onto a second line) | `DemoQueue.tsx:899-914` | `queue.tsx:1412-1432` | exact | — |
| B38 | Rejected-containment title arm — italic, normal weight, muted | `DemoQueue.tsx:911` | `queue.tsx:—` | missing | `ruled: D231` — the vocabulary has deliberately no `rejected` arm; a submission the parent could not turn into work never becomes a run |
| B39 | Renamed-row tooltip `Named by you — subject is {subject}` | `DemoQueue.tsx:902` | `queue.tsx:1429` + `queue-model.ts:129-134` | exact | — |
| B40 | Workflow chip, drawn only when the surface mixes workflows: caps + `--ds-tracking-caps`, neutral row chip | `DemoQueue.tsx:918-920` | `queue.tsx:1434-1438` | exact | — |
| B41 | Row ⓘ — always drawn, quiet at rest, full contrast on hover/focus and while its popover is open | `DemoQueue.tsx:526-544` | `queue.tsx:1439` + `:441-458` | exact | — |
| B42 | ⓘ popover: `width="md"`, `side="bottom"`, `align="start"` | `DemoQueue.tsx:548` | `queue.tsx:463` | exact | — |
| B43 | ⓘ popover TITLE — demo: the row-VARIANT name (`rowVariantSpec(row).name`); rebuild: the panel-kind name | `DemoQueue.tsx:548` | `queue.tsx:463` | divergent | `unserved: no row-variant naming layer on the wire — the demo's `rowVariantSpec` / `rowExplanationOf` (`demo-catalog.ts`) has no served counterpart` |
| B44 | ⓘ trigger label `What is this row? — {name}` (same naming layer) | `DemoQueue.tsx:531` | `queue.tsx:445` | divergent | `unserved: row-variant naming layer (as B43)` |
| B45 | ⓘ first paragraph — "what this row is DOING", `--ds-fg` ink | `DemoQueue.tsx:551` | `queue.tsx:—` | missing | `unserved: row-variant naming layer (as B43)` |
| B46 | ⓘ second paragraph — "what OPENING it will show" (panel sentence), secondary ink | `DemoQueue.tsx:552` | `queue.tsx:465-467` | exact | — |
| B47 | ⓘ third paragraph — "WHY it exists as its own row" | `DemoQueue.tsx:553` | `queue.tsx:—` | missing | `unserved: row-variant naming layer (as B43)` |
| B48 | ⓘ constraint blockquote — left rule at `--ds-border-loud`, `pl-base`, the rule this row's controls obey | `DemoQueue.tsx:557-568` | `queue.tsx:—` | missing | `unserved: row-variant naming layer (as B43)` |
| B49 | ⓘ containment paragraph (`member` / `linked` explained in the product's words) | `DemoQueue.tsx:—` | `queue.tsx:433-437`, `:468-470` | extra | `ruled: D231` — containment is a served closed enum and what a panel DOES with each arm is frontend copy |
| B50 | ⓘ absence paragraphs — `Subtitle:` / `Live message:` / `Run number:` / `Outcome:` / `Members:` with the server's own reason | `DemoQueue.tsx:—` | `queue.tsx:403-431`, `:471-476` | extra | `ruled: docs/plans/2026-08-13-detail-fidelity-audit.md R3 f.16 as-built` + D133 — an absence drawn as nothing at all is the one state that cannot explain itself |
| B51 | ⓘ footer `MetaLine`: demo `{rowType} · {panel name} · {wfLabel} · {trace}` (three items); rebuild `{wfLabel} · {trace}` (two) | `DemoQueue.tsx:569` | `queue.tsx:477` | divergent | `unserved: row-variant naming layer (as B43)` — the `rowType` word is its; the panel name moved to the popover title |
| B52 | `test` chip: info tone, caps + tracking, `Ran against the TEST instance of {systems} — nothing here reached production.` | `DemoQueue.tsx:424-435` | `queue.tsx:285-293` | exact | — |
| B53 | `dry run` chip HUE — demo binds tone `violet` to `--ds-status-parked-*` (amber in every theme here); rebuild uses a real violet `--ds-rehearsal-*` | `DemoQueue.tsx:393` | `queue.tsx:225-241` | divergent | `ruled: D232` — the one deliberate colour deviation on this row; the demo's chip collides with the `△` amber beside it |
| B54 | `dry run` chip text + title "Dry run — this rehearsal reads the systems and writes nothing." | `DemoQueue.tsx:436-444` | `queue.tsx:305-313` | exact | — |
| B55 | `△ N` warnings chip: warning tone, `AlertTriangle` at `dsIcon.sm`, count, first-warning title | `DemoQueue.tsx:475-478` | `queue.tsx:337-345` | exact | — |
| B56 | `△` count from a GROUP's member rollup (a Done group with one warned member still wears `△ 1`) | `DemoQueue.tsx:452-464` | `queue.tsx:—` | missing | `unserved: memberRollup carries {total, terminal, failed} only — no per-member warning count to fold` |
| B57 | `✓` "Marked checked by you" glyph on a member row + `sr-only` "checked" | `DemoQueue.tsx:487-491` | `queue.tsx` `MemberLine` | exact | **Landed 2026-08-26 — approved A.** `checkedIds` is browser-local DashboardApp state, starts empty on reload, and has no wire or durable-store path; the member’s local check control and glyph never claim an authority outcome. |
| B58 | Micro-step dots gated to a running non-group row, in the same `h-xs` box as the pill | `DemoQueue.tsx:496` | `queue.tsx:344` | exact | — |
| B59 | Dot shape `h-1.5 w-2.5 rounded-full`, 3 px gaps | `DemoQueue.tsx:269-280` | `queue.tsx:201-214` | exact | — |
| B60 | Dot state vocabulary + tones — demo 5 arms on raw Tailwind (`bg-success`/`bg-primary`/…); rebuild 6 arms on ds tokens | `DemoQueue.tsx:281-289` | `queue.tsx:173-181` | divergent | `ruled: docs/plans/2026-08-13-detail-fidelity-audit.md R3 f.20` — "the rebuild's DS dot tones are CORRECT, do not port backwards"; the arms are the served closed enum |
| B61 | Dots hover sentence `{label} {duration} ({state})` joined by ` · ` | `DemoQueue.tsx:272` | `queue.tsx:195-199`, `:207` | exact | — |
| B62 | Dots hover sentence gains `×N` when a node executed more than once | `DemoQueue.tsx:—` | `queue.tsx:197` | extra | `ruled: D214` — a gate park and its resume are two executions inside one attempt, and both intervals were spent |
| B63 | Dots `aria-label` `Steps: {label} {state}, …` | `DemoQueue.tsx:273` | `queue.tsx:208` | exact | — |
| B64 | Status pill on the title row's RIGHT edge, icon hidden, with the gate age appended | `DemoQueue.tsx:497` | `queue.tsx:346` | exact | — |
| B65 | Chip ORDER left→right: `test` · `dry run` · `△` · (checked) · dots · pill | `DemoQueue.tsx:420-498` | `queue.tsx:283-347` | divergent | follows B57 — the checked glyph's slot is absent; every other position matches |
| B66 | Member-preview line ("Alvarez, Bao, Chen +2"): meta ink, `col-start-2`, truncating, full value on hover | `DemoQueue.tsx:928-932` | `queue.tsx:1478-1486` | exact | — |
| B67 | Member preview suppressed the moment the member list is on screen | `DemoQueue.tsx:929` | `queue.tsx:1475` | exact | — |
| B68 | Member preview also gated on `groupNoun` ("5 separations") | `DemoQueue.tsx:929` | `queue.tsx:1473-1476` (gate dropped) | divergent | `unserved: no `groupNoun` — no operation-shaped workflow is registered, so a declared noun is a sample of zero (ledger CLOSED 2026-08-19; D186's argument one level down)` |
| B69 | Subline row: `col-start-2`, wrapping, `gap-x-base gap-y-tight`, tinted by status | `DemoQueue.tsx:935-941` | `queue.tsx:1489-1496` | exact | — |
| B70 | Subline SENTENCE — demo composes seven client-side arms (error / gate title + candidate pair / parked outcome / "Cancelled by you — nothing written" / live step / OCR phase / group rollup); rebuild prints the ONE served `liveMessage` | `DemoQueue.tsx:580-623` | `queue.tsx:1465-1466` | divergent | `ruled: ref frontend-backend-integration §0.1/§0.4` — the surface classifies nothing and the projection authors the sentence (`queue.tsx:8-28`) |
| B71 | Subline tone per status (amber waiting, red failed, violet parked, blue running, muted otherwise) | `DemoQueue.tsx:581-621` | `queue.tsx:495-504` | exact | — |
| B72 | Group subline suppressed while its member list is on screen | `DemoQueue.tsx:638-640` | `queue.tsx:1465` | exact | — |
| B73 | Outcome CTA pill at the subline's right, with the per-status `omitKeys` (failed → `open-failure`/`reupload`, parked → `open-park`, waiting → `open-gate`) | `DemoQueue.tsx:947-958` | `queue.tsx:1498-1523` | exact | — |

### B.3 — The member well

| # | Element (what the operator sees) | Demo | Rebuild | Verdict | Reason |
|---|---|---|---|---|---|
| B74 | The well is an OUTLINE, not a hole: card fill, real edge, whole-line clipping, `max-h` token per open state | `DemoQueue.tsx:1236-1274` | `queue.tsx:731-763` | exact | — |
| B75 | Member grid — demo FOUR tracks (indent · name · detail · EID); rebuild THREE (no EID column) | `DemoQueue.tsx:316-317` | `queue.tsx:659` | divergent | `unserved: no per-member identifier leaf on the queue wire — a column of run ids is not the EID column (ledger CLOSED 2026-08-19; needs a declared `identifierProjection`)` |
| B76 | Well inset `px-snug`, shared by every line in the mini-table | `DemoQueue.tsx:320` | `queue.tsx:662` | exact | — |
| B77 | Well header tally — demo six statuses (`✓ N ⟳ N ⧖ N …`) with Done/Running/Queued holding their slot at zero; rebuild two (`terminal/total`, `failed`) | `DemoQueue.tsx:221-265`, `:1591` | `queue.tsx:673-717` | divergent | `unserved: memberRollup serves {total, terminal, failed} only — the demo's six-status member tally needs per-status member counts` |
| B78 | Well header dims a zero rather than dropping it, so the strip does not reflow between ticks | `DemoQueue.tsx:236-256` | `queue.tsx:686-712` | exact | — |
| B79 | Well header `SearchX N rejected` with its title | `DemoQueue.tsx:1596-1604` | `queue.tsx:—` | missing | `ruled: D231` — no `rejected` arm exists to count |
| B80 | Well header `✓ {checked}/{total}` in success ink | `DemoQueue.tsx:1605-1617` | `queue.tsx` `GroupMemberList` | exact | **Landed 2026-08-26 — approved A.** The numerator counts only loaded member ids checked in this browser; the denominator is the served operation total. The absent roster/drill-in remains B130–B135, not a client reconstruction. |
| B81 | Well header "N of 12 members loaded" when the payload holds fewer members than the rollup counts | `DemoQueue.tsx:—` | `queue.tsx:963-967` | extra | `ruled: docs/plans/2026-08-13-detail-fidelity-audit.md R3 f.9 as-built` — the day query pages, and saying so is a fact about this list |
| B82 | Column heads `Name` (spanning two tracks) / `Detail` / `EID` (right-aligned), faint, at `--ds-h-member-line` | `DemoQueue.tsx:1621-1636` | `queue.tsx:973-987` | divergent | follows B75 — the `EID` head is absent with its column |
| B83 | Detail head switches to `Outcome` for a workflow declaring a member-outcome vocabulary | `DemoQueue.tsx:327-329`, `:1632` | `queue.tsx:985` (always `Detail`) | missing | `unserved: nothing on the wire declares a member-outcome vocabulary (the demo's `workflow.memberOutcomes`)` |
| B84 | Column heads suppressed when the well holds no member lines | `DemoQueue.tsx:—` (always drawn) | `queue.tsx:971` | extra | `ruled: docs/plans/2026-08-13-detail-fidelity-audit.md R3 f.9 as-built` — a labelled head over an empty region reads as a failed render |
| B85 | Member line: glyph · name · detail on the fixed track at `--ds-h-member-line`, `gap-x-base` | `DemoQueue.tsx:1277-1330` | `queue.tsx:765-838` | exact | — |
| B86 | Member line hover `--ds-surface-3`, selected `--ds-surface-selected` | `DemoQueue.tsx:1348-1355` | `queue.tsx:790-796` | exact | — |
| B87 | Member glyph from the ONE status table | `DemoQueue.tsx:372-377` | `queue.tsx:781-783`, `:798` | exact | — |
| B88 | Rejected member: `SearchX` glyph, muted, italic name | `DemoQueue.tsx:1647-1650` | `queue.tsx:—` | missing | `ruled: D231` |
| B89 | Member detail cell — demo the typed OUTCOME word (`MemberOutcomeWord`) when the workflow declares one, else the free-text fact; rebuild always the served subtitle | `DemoQueue.tsx:340-364` | `queue.tsx:801-822` | divergent | `unserved: member-outcome vocabulary (as B83)`. Note `MemberOutcomeWord` / `MemberOutcomePending` still ship unused at `status.tsx:77-101` |
| B90 | Failed member's detail cell tints red | `DemoQueue.tsx:356-358` | `queue.tsx:806-816` | exact | — |
| B91 | Nothing-yet detail cell is an em dash, never a blank | `demo-status.tsx:135-137` | `queue.tsx:824-831` | exact | — |
| B92 | Member line hover title `{name} — {status}` (the line draws no status word) | `DemoQueue.tsx:—` (no title on group member lines) | `queue.tsx:773-777` | extra | `ruled: D22 (amended 2026-08-04)` — the glyph is the whole of what the line says, so the accessible name must separate the two dones |
| B93 | Member ORDER — attention-first tier values, `doneWarnings` with `parked` at 2, `cancelled` BELOW a clean done | `demo-data.ts:4388-4397` | `queue-model.ts:216-225` | exact | — |
| B94 | Member order tiebreak — demo the fixture id; rebuild the served array index | `demo-data.ts` `orderedMemberIds` | `queue-model.ts:227-236` | divergent | `ruled: docs/plans/2026-08-13-detail-fidelity-audit.md R3 f.13` — "KEEP the rebuild's stable-server-index tiebreak (better rule, audit concurs)" |
| B95 | Disclosure footer: one or two equal cells at `--ds-h-member-line`, divided by a hairline | `DemoQueue.tsx:1657-1668` | `queue.tsx:993-1004` | exact | — |
| B96 | `Expand` / `Collapse` with `ChevronDown`/`ChevronUp`, word-only (never "Expand to 12") | `DemoQueue.tsx:1525-1538` | `queue.tsx:874-887` | exact | — |
| B97 | `View full list` with `ArrowRight`, beside Expand even when the open well fits everyone | `DemoQueue.tsx:1542-1554` | `queue.tsx:890-903` (present, never mounted — `onOpenRoster` is supplied by nothing) | missing | `unserved: no served roster/People section (`RunDetailSectionResponseSchema#people` is `declared-unserved`, D184; ledger CLOSED 2026-08-20 — trigger is the first multi-person operation workflow)` |
| B98 | `View all signers` — the one workflow-specific disclosure label | `DemoQueue.tsx:1553` | `queue.tsx:902` (`View full list` only) | missing | `unserved: roster section (as B97)` |
| B99 | Well line count: 5 closed / 20 open, both heights `N × line + (N−1) hairlines` | `DemoQueue.tsx:1209-1210` | `layout-metrics.ts` (`MEMBER_WELL_LINES`) | exact | — |

### B.4 — Record stream, redirects, facts, footer

| # | Element (what the operator sees) | Demo | Rebuild | Verdict | Reason |
|---|---|---|---|---|---|
| B100 | The record-stream well — the people an OCR run has read, in the same mini-table chrome as a group's members | `DemoQueue.tsx:1369-1494` | `queue.tsx:—` | missing | `unserved: no `records[]` stream on the queue wire (deferred with a named trigger, `queue.tsx:110-115`; ledger row "served roster/People section + `records[]` stream")` |
| B101 | `ScanText  8 of 12 read` line in that well's header | `DemoQueue.tsx:1427-1438` | `queue.tsx:—` | missing | `unserved: `records[]` stream (as B100)` |
| B102 | `SearchX  N blocked` line beside it | `DemoQueue.tsx:1417-1426` | `queue.tsx:—` | missing | `unserved: `records[]` stream (as B100)` |
| B103 | Per-record glyphs — `ready`/`warn`/`blocked` borrowed from the ratified status hues | `DemoQueue.tsx:1507-1511` | `queue.tsx:—` | missing | `unserved: `records[]` stream (as B100)` |
| B104 | A record read WHILE the list is on screen ARRIVES from below (4 s window), the rest do not | `DemoQueue.tsx:1467-1471`, `:1499` | `queue.tsx:—` | missing | `unserved: `records[]` stream (as B100)` |
| B105 | Chip band placement: hangs off the well's table edge when a table is on screen, off the title column otherwise | `DemoQueue.tsx:1005-1020` | `queue.tsx:1411-1418` | exact | — |
| B106 | Redirect chip shape: gray matte + hairline, `Name · status`, `↗` on the RIGHT, never a leading `←`, never info-blue | `DemoQueue.tsx:1078-1140` | `queue.tsx:1004-1053` | exact | — |
| B107 | Redirect chip is the band's primary — `flex-1 min-w-max`, label never truncated | `DemoQueue.tsx:1135-1137` | `queue.tsx:1046` | exact | — |
| B108 | Parent route back to the run that delegated this one | `DemoQueue.tsx:1142-1157` | `queue.tsx:1056-1071` | exact | — |
| B109 | Forward route(s) to the runs this one delegated to — demo ONE summary chip (`{panel} · {done} done` over N children); rebuild one chip PER child, each with its own served live status | `DemoQueue.tsx:1021-1028` | `queue.tsx:1085-1097`, `:1419-1421` | divergent | `ruled: D231` — a row chips only the children it does not count, and each link resolves its own panel and LIVE status server-side (an id list cannot) |
| B110 | `OCR Review · {status} ↗` — the one redirect label that is not a bare workflow name | `DemoQueue.tsx:1159-1183` | `queue.tsx:—` | missing | `unserved: `reviewRunId` — a demo-fixture concept never ratified into the run model (ledger CLOSED 2026-08-19; needs the first OCR-review child)` |
| B111 | `Users  12 people` extracted-count chip | `DemoQueue.tsx:1029-1034` | `queue.tsx:—` | missing | `unserved: `extractedCount` — nothing computes a packet's people count (ledger CLOSED 2026-08-19)` |
| B112 | Fact chip drawn on the shared `Chip` PRIMITIVE (label + truncating value + full value on hover) | `DemoQueue.tsx:168-206` (`<Chip label=… title=…>`) | `queue.tsx` `FactChip` → `ds/primitives-core.tsx` `Chip` | exact | **Landed 2026-08-26 — approved A.** Queue facts now call the shared primitive, retaining its one-line clipping, shared height/padding/label ink, and full value on hover. |
| B113 | Fact chip `grow`: natural width beside a redirect, greedy otherwise | `DemoQueue.tsx:1036-1041` | `queue.tsx:1114-1117`, `:1424` | exact | — |
| B114 | Fact chip direction `old → new` with the arrow inside the value | `DemoQueue.tsx:196-203` | `queue.tsx:—` | missing | `unserved: `facts[]` carries a flat `{label, value}` — no `arrowTo`` |
| B115 | Fact chip warning tone | `DemoQueue.tsx:194` | `queue.tsx:—` | missing | `unserved: `facts[]` has no `warn` flag` |
| B116 | Fact chip `fullRow` arm (a fact that takes the whole band line) | `DemoQueue.tsx:180-190` | `queue.tsx:—` | missing | `unserved: `facts[]` has no `fullRow` flag` |
| B117 | Band ORDER: redirects first, then the parent route, then the facts | `DemoQueue.tsx:1021-1044` | `queue.tsx:1419-1428` | exact | — |
| B118 | Footer band: top hairline, `px-cozy py-tight`, recessed fill and no line, controls pinned top-right | `DemoQueue.tsx:674-683` | `queue.tsx:531-539` | exact | — |
| B119 | Footer meta zone WRAPS (`min-h-sm`, `gap-x-base gap-y-hair`), it never truncates | `DemoQueue.tsx:684-693` | `queue.tsx:540-549` | exact | — |
| B120 | Footer clock `9:47 AM` | `DemoQueue.tsx:694` | `queue.tsx:550` | exact | — |
| B121 | `#5` ordinal chip: `h-xs`, `--ds-radius-sm`, recess border, transparent fill, `px-tight` | `DemoQueue.tsx:695-712` | `queue.tsx:568-580` | exact | — |
| B122 | `#N` chip carries a title `Run #5 of this workflow`, and is simply absent on a pre-v15 run | `DemoQueue.tsx:—` | `queue.tsx:569`, `:568` | extra | `ruled: D230` (durable per-workflow ordinal) + D133 (read forward — absence drawn as absence, never `#0`) |
| B123 | Trace chip `p1-090505-0005` in its own inset box | `DemoQueue.tsx:—` (demo prints the subtitle plainly; it has no trace in the footer) | `queue.tsx:585-600` | extra | `ruled: docs/plans/2026-08-13-detail-fidelity-audit.md R3 f.18 as-built` — the trace is the run's name in every log and receipt; the chip is a sibling of the ordinal, not a substitute |
| B124 | Subtitle segment: demo `whitespace-nowrap`; rebuild wraps (`break-words`) | `DemoQueue.tsx:715` | `queue.tsx:621-625` | divergent | `ruled: DESIGN.md footer rule "a row footer's facts WRAP; they never truncate"` — recorded at `queue.tsx:602-620` with the measurement (a served note 1096 px wide inside a 375 px card, silently clipped) |
| B125 | `showId` guard — a subtitle equal to the title is not printed twice | `DemoQueue.tsx:674` | `queue.tsx:512-513`, `:621` | exact | — |
| B126 | `attempt 2` segment on a re-run | `DemoQueue.tsx:—` | `queue.tsx:628` | extra | `ruled: docs/plans/2026-08-13-detail-fidelity-audit.md R3 f.18` — "keep (cited)" |
| B127 | Timing segment: queued shows none; live shows elapsed; a settled run shows what it TOOK; an unknown end says so | `DemoQueue.tsx:675`, `:717` (`elapsed ?? row.duration`) | `queue.tsx:509`, `:629-633` + `format.ts` `runTiming` | divergent | `ruled: D124` — `now − startedAt` on a settled run printed 2 h 47 m for ~14.5 minutes of work |
| B128 | Footer command cluster, `gap-hair`, `pt-hair`, no `⋯` | `DemoQueue.tsx:721-726` | `queue.tsx:637-644` | exact | — |
| B129 | `sr-only` "Right-click or press m for every command on {row}" | `DemoQueue.tsx:727` | `queue.tsx:645` | exact | — |

### B.5 — The drill-in triage table (whole surface)

| # | Element (what the operator sees) | Demo | Rebuild | Verdict | Reason |
|---|---|---|---|---|---|
| B130 | Drill-in view replaces the queue in its own `aria-label="Group triage"` card | `DemoQueue.tsx:1852-1858` | `—` | missing | `unserved: roster/People section (as B97)` |
| B131 | Drill-in header: `Back to queue` `←` button + the group's wrapping title | `DemoQueue.tsx:1687-1700` | `—` | missing | `unserved: roster section (as B97)` |
| B132 | Drill-in `name / EID…` search input with its leading `Search` glyph, 8 rem wide, right-anchored | `DemoQueue.tsx:1705-1727` | `—` | missing | `unserved: roster section (as B97)` |
| B133 | Drill-in column heads `Person` / `EID` / `{Outcome\|Detail}` / `Took` (right) on the recessed band | `DemoQueue.tsx:1734-1755` | `—` | missing | `unserved: roster section (as B97)` |
| B134 | Drill-in rows as a `listbox`/`option` pair at `--ds-h-row`, attention-first | `DemoQueue.tsx:1757-1797` | `—` | missing | `unserved: roster section (as B97)` |
| B135 | Drill-in footer "sorted attention-first", right-aligned on the recessed band | `DemoQueue.tsx:1800-1812` | `—` | missing | `unserved: roster section (as B97)` |

### B.6 — The action bar, select mode, bulk strip and result vector

| # | Element (what the operator sees) | Demo | Rebuild | Verdict | Reason |
|---|---|---|---|---|---|
| B136 | The bar itself — demo a full-bleed band held by a bottom hairline; rebuild a bordered `--ds-radius-lg` card island with the shell supplying its outside inset | `DemoBulkBar.tsx:141` | `queue-toolbar.tsx:216-224` + `dashboard-app.tsx:1132` | divergent | `ruled: D224` (operator decision on the live surface) |
| B137 | Bar inner padding — demo `--ds-shell-inset`; rebuild `--ds-space-cozy` (same 12 px, now measured from the card edge) | `DemoBulkBar.tsx:166` | `queue-toolbar.tsx:226` | divergent | `ruled: D224` |
| B138 | Bar row height `--ds-h-bar`, `gap-snug`, never wraps | `DemoBulkBar.tsx:163-167` | `queue-toolbar.tsx:226` | exact | — |
| B139 | Left group: the Workflow Panel toggle in the `leading` slot | `DemoBulkBar.tsx:169` | `queue-toolbar.tsx:227` | exact | — |
| B140 | Left group: `Start a run` primary in the `runStart` slot | `DemoBulkBar.tsx:170` | `queue-toolbar.tsx:228` | exact | — |
| B141 | `Import spreadsheet` outline button beside it | `DemoBulkBar.tsx:—` | `dashboard-app.tsx:1565,1584-1589` | extra | `ruled: D272 item 3` — same recorded exception as A174 (unit V1, 2026-08-26): the reason was always real, and D272 item 3 is the ruling it lacked |
| B142 | Hairline after the left group | `DemoBulkBar.tsx:171` | `queue-toolbar.tsx:229-231` | exact | — |
| B143 | Middle group: the status filters, taking the slack, scrolling sideways at a narrow window | `DemoBulkBar.tsx:173` | `queue-toolbar.tsx:233` | exact | — |
| B144 | Hairline before the right group | `DemoBulkBar.tsx:175` | `queue-toolbar.tsx:235` | exact | — |
| B145 | Sort is ONE control — the `Select` primitive at `variant="toolbar"` with `⇅` as its own icon | `DemoBulkBar.tsx:187-203` | `queue-toolbar.tsx:243-258` | exact | — |
| B146 | Sort `aria-label` "Sort the queue" | `DemoBulkBar.tsx:189` | `queue-toolbar.tsx:245` | exact | — |
| B147 | Sort options `Attention first` / `Newest first` / `Oldest first` / `Longest running` | `demo-data.ts:4252-4257` | `queue-model.ts:38-43` | exact | — |
| B148 | Sort hover notes — rebuild adds "in each band" to two of the four | `demo-data.ts:4254-4255` | `queue-model.ts:40-42` | divergent | `ruled: docs/plans/2026-08-13-detail-fidelity-audit.md R8 f.18` — on-record exception, the rebuild's wording is truer about the per-band scope |
| B149 | `Select` toggle: `aria-pressed`, title "Act on several rows at once", `CheckSquare`/`Square`, pressed = loud border + selected fill + semibold | `DemoBulkBar.tsx:205-224` | `queue-toolbar.tsx:260-283` | exact | — |
| B150 | `Select` toggle resting fill — demo `--ds-surface-1`, rebuild `--ds-surface-card` | `DemoBulkBar.tsx:216` | `queue-toolbar.tsx:274` | divergent | `ruled: D224` — the bar became a card, so its controls rest on the card plane |
| B151 | Select mode gets its OWN band (top hairline, recessed fill, `--ds-h-bar`) and costs nothing at rest | `DemoBulkBar.tsx:231-240` | `queue-toolbar.tsx:311-320` | exact | — |
| B152 | `Select all 14 in view` / `Clear`, `Button size="sm" variant="secondary"`, never disabled at zero | `DemoBulkBar.tsx:241-243` | `queue-toolbar.tsx:321-333` | exact | `ruled: R8 f.22` for the disabled-at-zero revert (uncited rebuild addition removed) |
| B153 | `{N} selected` in meta nums, muted | `DemoBulkBar.tsx:244-246` | `queue-toolbar.tsx:334-336` | exact | — |
| B154 | Bulk verbs offered — demo four (`Retry` · `Bump` · `Cancel` · `Delete`); rebuild two (`Cancel` · `Retry`) | `DemoBulkBar.tsx:46-51` | `bulk-dispatch.ts:41-42` | divergent | `ruled: D234` (hide/Delete retired — "there are runs and archived runs") + `D235` / operator 2026-08-18 (cancel and retry are the batch verbs; `bump` schema-admitted and deliberately not offered) |
| B155 | Bulk verb ORDER — demo puts the irreversible verb LAST (`Retry, Bump, Cancel, Delete`); rebuild draws `Cancel` first | `DemoBulkBar.tsx:47-50` | `bulk-dispatch.ts` `BULK_STRIP_VERBS` → `queue-toolbar.tsx` | exact | **Landed 2026-08-26 — approved A.** The D235 two-verb strip is now `Retry`, then irreversible `Cancel`. |
| B156 | Bulk verb icons `RotateCcw` (Retry) and `Ban` (Cancel) | `DemoBulkBar.tsx:47-49` | `queue-toolbar.tsx:77` | exact | — |
| B157 | The one irreversible verb takes the surface's single danger slot (`dangerGhost`), peers are `outline` | `DemoBulkBar.tsx:255` | `queue-toolbar.tsx:365` | exact | — |
| B158 | A verb appears only when a selected row SERVES it (demo renders all four always, disabled at zero) | `DemoBulkBar.tsx:257` | `queue-toolbar.tsx:353`, `bulk-dispatch.ts:104-107` | divergent | `ruled: D235` — the strip draws exactly the plans it is handed, so a control here can never be one the server did not describe |
| B159 | Bulk button label — demo the bare verb; rebuild `Cancel 3` plus a `· 1 skipped` micro-suffix | `DemoBulkBar.tsx:263` | `queue-toolbar.tsx:378-390` | divergent | `ruled: D235` — the skip is on the CONTROL, before the press, not only in the confirm |
| B160 | Bulk button title — demo "{label} every selected row that offers it"; rebuild two arms naming the eligible/skipped counts | `DemoBulkBar.tsx:259` | `queue-toolbar.tsx:367-373` | divergent | `ruled: D235` |
| B161 | Confirm-before-send dialog for a batch (title, composed body, the named rows with their `row rev`, `Keep them as they are` / danger confirm) | `DemoBulkBar.tsx:—` (demo fires immediately) | `queue-toolbar.tsx:118-173` | extra | `ruled: D235` — a bulk press is N durable transitions against N real HR runs, so it warns first |
| B162 | "None of the 4 selected rows serve Cancel or Retry" refusal sentence in the band | `DemoBulkBar.tsx:—` | `queue-toolbar.tsx:344-349` | extra | `ruled: D235` — the strip states what is being left alone and why |
| B163 | Result band: top hairline, recessed fill, `px-cozy py-base`, `aria-live="polite"`, kept until dismissed | `DemoBulkBar.tsx:279-289` | `queue-toolbar.tsx:406-417` | exact | — |
| B164 | Result heading — demo `Retry — partial result`; rebuild `retry — result per run` (the wire's lowercase verb) or `Nothing was sent` | `DemoBulkBar.tsx:291` | `queue-toolbar.tsx` result band | exact | **Landed 2026-08-26 — approved A.** The served-plan label restores `Retry — partial result`; a whole-request refusal still says `Nothing was sent`. |
| B165 | Result vector counts — demo prints `applied · conflict · rejected` ALWAYS ("the whole vector, always. '2 applied' alone is the lie this surface exists to prevent"); rebuild prints only the non-zero buckets | `DemoBulkBar.tsx:294-297` | `queue-toolbar.tsx` + `bulk-dispatch.ts` `bulkResultCounts` | exact | **Landed 2026-08-26 — approved A.** All four D235 outcomes, including zeroes, always render; `not attempted` is likewise explicit from `requestedCount`. |
| B166 | `N not offered` count in the vector line | `DemoBulkBar.tsx:298-305` | `queue-toolbar.tsx:—` (the skip count is a separate sentence, B172) | divergent | `ruled: D235` — the skipped set is client-side and never reaches the server's vector |
| B167 | `N not attempted` when the pass stopped short of the requested count | `DemoBulkBar.tsx:—` | `queue-toolbar.tsx:436-440` | extra | `ruled: D235` — `requestedCount` makes the untried remainder legible |
| B168 | Dismiss `✕` IconButton "Dismiss the bulk result", pushed right | `DemoBulkBar.tsx:306-312` | `queue-toolbar.tsx:441-447` | exact | — |
| B169 | Result rows: dot · outcome word (caps, `w-16`) · row title (`w-40`, truncating) · detail (flex-1) at `--ds-h-sm`, clickable to the run | `DemoBulkBar.tsx:317-353` | `queue-toolbar.tsx:459-511` | exact | — |
| B170 | Conflict suffix — demo `rev 4 → 7`; rebuild `now rev 7 — refresh` | `DemoBulkBar.tsx:347-351` | `queue-toolbar.tsx:494-500` | divergent | `ruled: D253` — a conflict carries the server's `currentVersion` and never invites a bare re-send |
| B171 | Refused suffix — the server's own `code` in danger ink | `DemoBulkBar.tsx:346` | `queue-toolbar.tsx:501-505` | exact | — |
| B172 | The skipped rows, after the send — demo a `<details>` disclosure ("N selected rows never offered retry — nothing was attempted for them") over a `max-h-28` scrolling, dotted, per-row list; rebuild one wrapping sentence comma-joining every title | `DemoBulkBar.tsx:358-372` | `queue-toolbar.tsx` result band | exact | **Landed 2026-08-26 — approved A.** The named client-side skipped set is a bounded `<details>` list; no skipped row is silently omitted or sent. |
| B173 | Closing copy, partial arm — `AlertTriangle` + "Nothing was applied for the conflicted or rejected rows. Open each one and look before you decide again — a conflict means the row changed under you." | `DemoBulkBar.tsx:376-383` | `queue-toolbar.tsx` result band | exact | **Landed 2026-08-26 — approved A.** The warning close is present and additionally names D235’s `errored`/unattempted outcomes, which the demo has no wire arm for. |
| B174 | Closing copy, clean arm — `CheckCircle2` + "Every selected row that offered retry accepted it." | `DemoBulkBar.tsx:384-389` | `queue-toolbar.tsx` result band | exact | **Landed 2026-08-26 — approved A.** The clean close appears only for a complete all-applied vector. |

### B.7 — The action vocabulary (`DemoActions.tsx` ↔ `actions.tsx` / `actions-model.ts`)

| # | Element (what the operator sees) | Demo | Rebuild | Verdict | Reason |
|---|---|---|---|---|---|
| B175 | The nine action glyphs (`retry`/`cancel`/`bump`/`delete`/`review`/`resolve`/`rename`/`external`/`drill`) | `DemoActions.tsx:73-83` | `actions.tsx:91-101` | exact | — |
| B176 | The seven intent tones as colour only, never `Button` variants | `DemoActions.tsx:92-113` | `actions-model.ts:26-45` | exact | — |
| B177 | ONE pill shell, `sm` inline (borderless) / `md` banner (outlined), with the press dip | `DemoActions.tsx:121-144` | `actions-model.ts:53-76` | exact | — |
| B178 | Footer controls: one `IconActionButton` per served descriptor, `gap-hair`, no caption beside the ✕ | `DemoActions.tsx:157-186` | `actions.tsx:140-183` | exact | — |
| B179 | Group-cancel ✕ title — "Cancels this group, its delegated review and every member. Final — there is no undo." | `DemoActions.tsx:171-174` | `actions.tsx:137-138`, `:168` | exact | — |
| B180 | …bound by descriptor `key`, not by `command` | `DemoActions.tsx:172` (`a.command === "cancel-tree"`) | `actions.tsx:136`, `:167` | divergent | `ruled: docs/plans/2026-08-13-detail-fidelity-audit.md R3 f.22 as-built` — `ActionCommandKeySchema` has no `cancel-tree` verb, and binding to `cancel` would put a group sentence on a single run's ✕ |
| B181 | "{label} — asks first" title on any confirm-carrying control | `DemoActions.tsx:176` | `actions.tsx:170` | exact | — |
| B182 | Banner pills: `mt-base`, wrapping, `gap-snug`, `md` intent pills | `DemoActions.tsx:207-226` | `actions.tsx:185-214` | exact | — |
| B183 | The two park resolutions are split OUT of the banner row by command | `DemoActions.tsx:193-201` | `actions-model.ts:87-99` | exact | — |
| B184 | Park resolution CARDS: container query `@min-[35rem]:grid-cols-2`, success/danger tints, `CheckCircle2`/`CircleSlash`, bold label, served `detail` sentence beneath | `DemoActions.tsx:235-280` | `actions.tsx:229-289` | exact | — |
| B185 | Outcome control, `open-gate` arm: icon-only square `↗` at `h-xs`/`w-xs` on the recessed plane | `DemoActions.tsx:317-345` | `actions.tsx:305-333` | exact | — |
| B186 | Outcome control, default arm: `sm` intent pill, `font-sans` | `DemoActions.tsx:347-359` | `actions.tsx:335-347` | exact | — |
| B187 | Right-click menu grouped navigation → commands → destructive, separators between | `DemoActions.tsx:396-420` | `actions.tsx:389-415` | exact | — |
| B188 | Menu accessible label `Commands for {row}` | `DemoActions.tsx:403` | `actions.tsx:409` | exact | — |
| B189 | Menu item hint "asks first" | `DemoActions.tsx:412` | `actions.tsx:424` | exact | — |
| B190 | Confirm dialog: `size="sm"`, `AlertTriangle` tinted by the served tone, served title and body | `DemoActions.tsx:452-486` | `actions.tsx:447-491` | exact | — |
| B191 | Confirm dialog title carries no second type class | `DemoActions.tsx:468` (nests `dsText.title`) | `actions.tsx:456-475` | divergent | `ruled: docs/plans/2026-08-13-detail-fidelity-audit.md R8 f.15` — `DialogPrimitive.Title` already carries `dsText.section`; nesting made this the one dialog whose title was a different size |
| B192 | Confirm subject line — demo `{workflow} · {trace} · row rev N`; rebuild leads with the row's OWN name before those three | `DemoActions.tsx:487-489` | `actions.tsx:492-508` | divergent | `ruled: docs/plans/2026-08-13-detail-fidelity-audit.md R8 f.4b` — `PendingCommand.subject` was documented and never drawn; a blast radius without its subject is a confirm about nothing |
| B193 | Confirm subject line is a bare div, NOT inside the dialog's scrolling body pane | `DemoActions.tsx:487` | `actions.tsx:507` | exact | — |
| B194 | Confirm footer: `Keep it as it is` (secondary, first) then the served confirm label (danger/primary, last) | `DemoActions.tsx:491-500` | `actions.tsx:509-518` | exact | — |
| B195 | `CommandResultFeed` — the persistent conflict/rejected band: tinted card per result, `Conflict`/`Rejected` caps word, headline, `{action} · {clock} · {actor}` meta, dismiss ✕, detail line, `code · row · workflow` line, CAS line, settling line, and the `Refresh this row` control | `DemoActions.tsx:539-636` | `actions.tsx` `CommandResultFeed` + `dashboard-app.tsx` | divergent | **Landed 2026-08-26 — approved A, with one named unserved arm.** Both D253 refusal settlements enter the bounded persistent feed with server message/code/current version, dismissal and Refresh-this-row. `settling` remains unserved by `CommandResult`; it is not fabricated. |
| B196 | `toastAppliedCommandResult` — applied outcomes toast from the bottom-right stack, tone chosen by `settling` / the command | `DemoActions.tsx:508-531` | `actions.tsx` `toastAppliedCommandResult` | divergent | **Landed 2026-08-26 — approved A, with one named unserved arm.** Every applied D253 settlement reaches the toast through the shared helper. The demo’s settling-specific tone cannot land without a served settling fact, so the toast stays success rather than guessing. |

**Counts:** 196 elements — 127 exact · 37 divergent · 21 missing · 11 extra. Ruled: 40 · unserved: 27 · **OPEN: 2**.

**Since 08-14:**

- **fixed** — R3 f.1 (the `attention` sort really ranks now, `queue-model.ts:139`), f.2/f.3/f.5 (empty-state arms and the `Finished` narrowing), f.4 (digest strip), f.6 partial → now three of four chip families (`linkedRuns[]`, parent, `facts[]`), f.7 (subline suppression), f.9 (rollup strip + the honest "N of M loaded"), f.10 (△ chip, and the count is served rather than derived), f.11 (dry-run chip, with a real fifth hue — D232), f.12 (`memberPreview`), f.13 (member ranks), f.16 (ⓘ always drawn), f.18 (`#N` ordinal, `showId`, the trace chip), f.19/f.21/f.22, f.25 (`displayName`); R8 f.1/f.2/f.3 (park cards with their served detail), f.4/f.4b (confirm mounted, subject drawn), f.5/f.6 (the bulk strip and the result vector now exist — D235), f.13/f.14/f.15/f.16, f.18 (vocabulary), f.22 (`Select all` no longer disabled at zero); B31 (the row's accessible name now consumes the shared served gate-age fold).
- **still open** — the roster/drill-in surface and the `records[]` stream (B97, B100-B104, B130-B135); the member EID column (B75); the per-status member tally (B77) and the `Outcome` column heading (B83); the row-variant naming layer behind the ⓘ (B43-B48, B51); `reviewRunId` (B110) and `extractedCount` (B111).
- **landed 2026-08-26 (approved A)** — B57/B80 client-only checked triage; B112 shared fact Chip; B155 irreversible-last batch order; B164/B165 full result heading/vector including zero buckets; B172–B174 bounded skipped disclosure and closing assurances; B195/B196 D253-settled refusal feed and applied toast. The full roster/drill-in and the `settling` result arm remain unserved and are not reconstructed client-side.

---

## Region C — RUN START (`DemoRunStart.tsx`, `DemoRunStartKit.tsx`, `demo-runstart-wire.ts` ↔ `surfaces/run-start*`)

Oracle: `DemoRunStart.tsx` (1015), `DemoRunStartKit.tsx` (477), `demo-runstart-wire.ts` (shapes +
`ENQUEUE_POLICY_LABEL`/`SYSTEM_LABEL`/`PlanRole`/`EnqueuePlan`), `demo-wire.ts` (`START_VALUE_NOUN`,
`START_SEPARATOR`, `StartMethodWire`, `StartCapabilityWire`, `workflowVersionTag`), `DESIGN.md:305`
(the sub-selection rule) and `demo-ui.tsx` → `ds/primitives-form.tsx:600` (`LockedValue`).
Rebuild: `surfaces/run-start.tsx` (1093), `run-start-model.ts` (55), `run-start-kit.tsx` (453),
`run-start-kit-model.ts` (29), composed at `app/dashboard-app.tsx:501-544,1361`; the declarations it
reads are `src/domain/workflow/ingress.ts` (`InputRunSurfaceSchema`, `ENTRY_PATTERNS`,
`inputRunValueNoun`/`inputRunSeparatorLabel`/`inputRunParserLabel`) and
`src/dashboard/client/commands.ts:21-51` (`StartPlanResponseSchema`).

Owning docs consulted for rulings: `ref dashboard-surfaces §9.1` (the run modal — plan, confirm,
enqueue; and its three named refusals), `ref frontend-backend-integration §5.1.1`, D250, D251,
D253, D219/D220/D241, D260/D261, `DESIGN.md:305`, and the R8 as-built in
`docs/plans/2026-08-13-detail-fidelity-audit.md`.

Visual check: `tests/parity/references/start-run--graphite-warm--1440x900.png` read as an image
(the rebuild's current pixels, fixture day, `person-lookup` selected). It confirms **on screen**,
not only in source: C36 (the hint reads `0 parsed`), C48 and C49 (two locked sub-selections showing
`keepNonHdh` / `includeCrmDates` with no reason line), C79 and C81 (the policy as a lock with its
reason nowhere on screen), C83 (group **02** drawn with a disabled **Dry run**), C91 (no host under
UCPATH; CRM carries only the served unavailability reason), C96 (the footer reads `Person Lookup ·
Type at least one value.` with no version tag) and C105 (the stage rail `1 Input › 2 Plan ›
3 Result`). The DEMO side was not re-photographed this pass — the SHELL auditor owns the browser
lane — so every row is a source diff plus that one rebuild image.

| # | Element (what the operator sees) | Demo | Rebuild | Verdict | Reason |
|---|---|---|---|---|---|
| C1 | Launcher: brand toolbar button, `Play` icon, label **Start a run** | `DemoRunStart.tsx:122-138` | `run-start.tsx:185-199` | exact | — |
| C2 | Launcher title `Start a run — any workflow, from anywhere (r)` | `DemoRunStart.tsx:135` | `run-start.tsx:195` | exact | — |
| C3 | No `r` shortcut badge on the button face | `DemoRunStart.tsx:128-134` | `run-start.tsx:192-194` | exact | — |
| C4 | Dialog `size="xl"` | `DemoRunStart.tsx:668-669` | `run-start.tsx:801-802` | exact | — |
| C5 | Dialog title **Start a run** | `DemoRunStart.tsx:670` | `run-start.tsx:803` | exact | — |
| C6 | Dialog description "Pick what to run. It declares what it takes, and the plan says exactly what will exist before anything is enqueued." | `DemoRunStart.tsx:671` | `run-start.tsx:804` | exact | — |
| C7 | Dialog box `h-[min(88vh,760px)] max-w-[min(96vw,1320px)]` | `DemoRunStart.tsx:672` | `run-start.tsx:805` | exact | — |
| C8 | Three columns in one `flex min-h-0 flex-1` row | `DemoRunStart.tsx:674` | `run-start.tsx:807` | exact | — |
| C9 | Picker column `w-[204px] shrink-0`, right border | `DemoRunStart.tsx:158` | `run-start.tsx:344` | exact | — |
| C10 | Filter row: `Search` glyph, `sr-only` "Filter workflows", placeholder **Filter**, plain borderless input | `DemoRunStart.tsx:159-181` | `run-start.tsx:345-368` | exact | — |
| C11 | Filter matches label, code or category | `DemoRunStart.tsx:146-150` | `run-start.tsx:213-219` | exact | — |
| C12 | `nav aria-label="Workflow"`, scrolls, `p-base` | `DemoRunStart.tsx:183` | `run-start.tsx:370` | exact | — |
| C13 | No-match line `No workflow matches “{query}”.` (curly quotes) | `DemoRunStart.tsx:186` | `run-start.tsx:372` | exact | — |
| C14 | Category heading `SectionLabel px-snug`, group `mb-cozy gap-hair` | `DemoRunStart.tsx:188-190` | `run-start.tsx:375-377` | exact | — |
| C15 | Picker row: `h-row px-snug`, radius md, selected = `surface-3` + semibold + `fg.base`, unselected = hover `surface-2` + `fg.secondary` | `DemoRunStart.tsx:197-212` | `run-start.tsx:299-314` | divergent | ruled: D219/D220 — an unselected CHUNK HARNESS row draws `fg.muted` instead of `fg.secondary`, the dimmer arm the nesting rule introduces |
| C16 | Row label `min-w-0 flex-1 truncate` | `DemoRunStart.tsx:213` | `run-start.tsx:315` | exact | — |
| C17 | Row 2-char code, `micro`+`nums`, muted when selected else faint | `DemoRunStart.tsx:214` | `run-start.tsx:317-321` | exact | — |
| C18 | Harness tag chip between label and code | `DemoRunStart.tsx:—` | `run-start.tsx:316` | extra | ruled: D219/D220 (`WorkflowHarnessTag`; the demo has no harness taxonomy) |
| C19 | Nested `<ul aria-label="Proving harnesses of X">` under a composition row | `DemoRunStart.tsx:—` | `run-start.tsx:265-283` | extra | ruled: D219 (real nested list, not padding) |
| C20 | "Not startable" footer: top border, `p-base` | `DemoRunStart.tsx:229` | `run-start.tsx:393` | exact | — |
| C21 | Blocked disclosure is a `<dl>` of `<dt>` name / `<dd>` reason | `DemoRunStart.tsx:231-240` | `run-start.tsx:396-436` | divergent | ruled: `docs/plans/2026-08-13-detail-fidelity-audit.md` R8 as-built + D251 — a `<ul>` because the list carries D219's hierarchy; the pair still renders name-then-reason |
| C22 | Blocked list `max-h-[11rem]` scroller, `gap-base` between entries | `DemoRunStart.tsx:231` | `run-start.tsx:397` | divergent | ruled: D219 — grouped by category with a `SectionLabel` per group and `gap-snug`, because the disclosure runs the same grouping rule as the list above it |
| C23 | `{n} not startable` ghost button, `w-full justify-start`, `aria-expanded` | `DemoRunStart.tsx:241-249` | `run-start.tsx:438-446` | exact | — |
| C24 | Peer-method `MethodTabs` strip (`role="tablist"`, selected pill, `dsElev.low`) | `DemoRunStart.tsx:267-312,696-705` | `run-start.tsx:—` | missing | ruled: D251 (`ref dashboard-surfaces §9.1` "No method tabs") — one method kind, so no tabs IS the demo's own rendering |
| C25 | Per-method glyph (`Keyboard`/`Upload`/`Camera`/`FileSpreadsheet`/`Play`) | `DemoRunStart.tsx:259-265` | `run-start.tsx:—` | missing | ruled: D251 (travels with C24) |
| C26 | `methodWire.note` sentence under the tabs | `DemoRunStart.tsx:714` | `run-start.tsx:—` | missing | ruled: D251 — with one method it restates `summary` |
| C27 | `SectionLabel` **Workflow setup** | `DemoRunStart.tsx:697` | `run-start.tsx:829` | exact | — |
| C28 | Workflow `h3`, `dsText.section` semibold, `min-w-0` | `DemoRunStart.tsx:691` | `run-start.tsx:952-960` | extra | `ruled: D272 item 9` — **RETAINED with a recorded exception** (unit V1, 2026-08-26). "Keep honest empty states": the demo's catalogue is a fixture that always has one workflow, so it never had to name the empty case; this one is SERVED and can be empty, and a heading that silently disappears reads as a surface still loading rather than as a catalogue with nothing in it. Cited at the site |
| C29 | Category `Chip label="group"` | `DemoRunStart.tsx:692` | `run-start.tsx:835` | exact | — |
| C30 | `RunFlagChips` (dry-run / test / bulk) on the setup line | `DemoRunStart.tsx:693` | `run-start.tsx:836` | exact | — |
| C31 | `capability.note` paragraph, `dsText.body`, `max-w-[74ch]` | `DemoRunStart.tsx:703` | `run-start.tsx:838-843` | exact | ruled: D251 — it IS `descriptor.summary`; absent declaration draws no paragraph |
| C32 | `Examples` `SectionLabel` + one `sm`/`outline` button per example, `title` = the note | `DemoRunStart.tsx:411-427` | `run-start.tsx:534-552` | exact | — |
| C33 | Clicking an example fills the box | `DemoRunStart.tsx:419` (`values.join(sep+" ")`) | `run-start.tsx:549` (`example.text`) | divergent | ruled: D250 — the example carries the EXACT text; re-joining a value list client-side re-implements `splitEntries` outside the boundary that owns it |
| C34 | Field label `{value noun} — {separator phrase}` | `DemoRunStart.tsx:429` | `run-start.tsx:556` | exact | ruled: D250 — same sentence, derived from the parser spec instead of authored |
| C35 | Field description = the parser sentence | `DemoRunStart.tsx:432` | `run-start.tsx:558` | exact | ruled: D250 (derived from `ENTRY_PATTERN_PROSE`) |
| C36 | Field hint `N valid · N refused` | `DemoRunStart.tsx:430` | `run-start.tsx:559` (`N parsed`) | divergent | ruled: `<plan>` R8 f.17 (kept-throw) — `parseInputRunText` refuses the WHOLE text, so there is no per-entry valid/refused split to count |
| C37 | Field error `N values will not be enqueued — see below.` | `DemoRunStart.tsx:431` | `run-start.tsx:560` | divergent | ruled: `<plan>` R8 f.17 — the boundary's own refusal renders verbatim in the same slot |
| C38 | `Textarea` re-keyed per workflow, `autoFocus`, `rows={4}`, descriptor placeholder | `DemoRunStart.tsx:433-442` | `run-start.tsx:562-570` | exact | — |
| C39 | Per-entry danger `Banner`s: `Value {n} — {code}` + "Nothing on this value is enqueued, and nothing is guessed from it." | `DemoRunStart.tsx:444-459` | `run-start.tsx:—` | missing | ruled: `<plan>` R8 f.17 — per-entry tolerance is a change to `ingress.ts`, not to this surface |
| C40 | Parsed-entry preview rows (ordinal · source text · field) | `DemoRunStart.tsx:—` | `run-start.tsx:574-598` | extra | ruled: `<plan>` R8 f.17 — what the boundary DID make of the text, in place of the demo's per-entry model |
| C41 | Upload method body: `Document` label, "N picked — each file is its own run", `FileChoice` cards, `already running` badge | `DemoRunStart.tsx:320-397,720-729` | `run-start.tsx:—` | missing | ruled: D251 — `WorkflowSurfaces.uploadRun` is declared by no registered workflow |
| C42 | Capture method body (`DemoCapturePanel`) | `DemoRunStart.tsx:731-740` | `run-start.tsx:—` | missing | ruled: D251 (same one-method argument) |
| C43 | Spreadsheet method body: `Sheet` Select + the intake description | `DemoRunStart.tsx:742-755` | `run-start.tsx:—` | missing | ruled: D251 (same) |
| C44 | `bare` method Well — **Nothing to fill in** + its sentence | `DemoRunStart.tsx:757-765` | `run-start.tsx:—` | missing | ruled: D251 (same) |
| C45 | Absent-input `EmptyState` — **No typed start for this workflow** + the reason | `DemoRunStart.tsx:—` | `run-start.tsx:858-868` | extra | ruled: `<plan>` R8 f.22 (rebuild-only, kept) + D251 (the reason is the modal's own precondition) |
| C46 | `SectionLabel` with inline `SlidersHorizontal` — **How this run is shaped** | `DemoRunStart.tsx:776-779` | `run-start.tsx:873-876` | exact | — |
| C47 | Sub-selection grid `grid-cols-1 @min-[560px]:grid-cols-2` | `DemoRunStart.tsx:780` | `run-start.tsx:877` | exact | — |
| C48 | Locked sub-selection: label line, `LockedValue`, **and the reason as a visible `<p>` beneath** | `DemoRunStartKit.tsx:175-183` | `run-start-kit.tsx:188-224` (`LockedFact`) | exact | `ported: D272 item 9` (unit V1, 2026-08-26) — the shared `LockedFact` draws label + `LockedValue` + the reason as a visible `<p>`, and deliberately does NOT also pass `reason` to `LockedValue`'s `title`, so the sentence is on screen once rather than announced twice |
| C49 | Sub-selection label is the human `choice.label` | `DemoRunStartKit.tsx:178` | `run-start-kit.tsx:188` | divergent | unserved: `SurfaceField` carries no label, so the control prints the raw field identifier — the reference shows `keepNonHdh` and `includeCrmDates` |
| C50 | Operator-variable sub-selection: `Select` of options, per-option `— not wired`, `N not wired` hint, description tracking the chosen option | `DemoRunStartKit.tsx:185-208` | `run-start-kit.tsx:—` | missing | unserved: no descriptor start-capability projection of option lists — the only declared sub-selections are parser CONSTANTS, which are locked by definition |
| C51 | Sub-selection visibility (`visibleWhen`, per-method) and flag defaults recomputed when a choice changes | `DemoRunStart.tsx:781-794`, `demo-wire.ts` `visibleChoices` | `run-start.tsx:—` | missing | unserved: travels with C50 — a constant has no visibility condition |
| C52 | `SectionLabel` **What this will create** | `DemoRunStart.tsx:807` | `run-start.tsx:891` | exact | — |
| C53 | Plan block is on screen the whole time, filling in as you type | `DemoRunStart.tsx:797-832` | `run-start.tsx:889-908` (`stage === "plan"` only) | divergent | ruled: `ref dashboard-surfaces §9.1` / `ref frontend-backend-integration §5.1.1` — the plan is the SERVER's answer to `POST /start-plans`, never a client-side guess, so it cannot exist before the operator asks for it |
| C54 | Empty-plan `Well` + `EmptyState` (`Layers`, the plan headline as title, "Fill in the input above and this fills in with the exact rows…") | `DemoRunStart.tsx:810-822` | `run-start.tsx:893-900` | divergent | ruled: `ref dashboard-surfaces §9.1` — the description is byte-identical; the title is **No plan yet** because there is no client-derived headline to print |
| C55 | Plan headline `1 Run Row · 2 people` etc. + `RunFlagChips` | `DemoRunStartKit.tsx:253-256` | `run-start-kit.tsx:245-250` | divergent | unserved: `StartPlanResponse` carries no headline — the rebuild counts `planned.length` (`1 run` / `N runs`) |
| C56 | Per-row plan card fields: role `Badge`+glyph, `bornAs` `StatusPill` / "not yet created", `Chip panel`, `Chip containment`, row `note` | `DemoRunStartKit.tsx:293-319` | `run-start-kit.tsx:—` | missing | unserved: `StartPlanResponse.planned[]` serves `{runId, traceId, title, subtitle, matchKey}` only — no role, panel, containment, born-as status or note |
| C57 | The plan's SHAPE: a list of `Card`s, one per proposed row | `DemoRunStartKit.tsx:263-269` | `run-start-kit.tsx:264-289` | divergent | OPEN — operator call: the rebuild draws a three-column `Table` (Title / Match key / Trace). The missing columns are C56's wire gap, but card-vs-table is a presentation choice nothing records |
| C58 | `plan.warnings` as warning `Banner`s above the decisions | `DemoRunStartKit.tsx:272-274` | `run-start-kit.tsx:—` | missing | unserved: no `warnings[]` on `StartPlanResponse` |
| C59 | **Why it is shaped this way** `Well` — `GitBranch` bullets, one per ratified decision the plan obeys | `DemoRunStartKit.tsx:276-288` | `run-start-kit.tsx:—` | missing | unserved: no `decisions[]` on `StartPlanResponse` |
| C60 | Empty-rows Well inside the preview: "Nothing to create yet — no valid entry has been typed." | `DemoRunStartKit.tsx:258-261` | `run-start-kit.tsx:259-262` | divergent | ruled: `ref dashboard-surfaces §9.1` — the server-planned arm reads "Nothing to create — every entry was refused.", which is the state this build can actually reach |
| C61 | Plan provenance line `plan {id} · planned by {who} · expires {ISO}` | `DemoRunStartKit.tsx:—` | `run-start-kit.tsx:305` | extra | `ruled: D272 item 8` (unit V1, 2026-08-26) — "port the clock": the line now prints `expires ${fmtClock(plan.expiresAt)}`, the rail's R6 f.10 treatment, so no raw ISO instant reaches operator-facing text. The LINE itself stays rebuild-only, as the only place the plan token's expiry is stated |
| C62 | `PlanRefusals` — one `Refusal` per server-refused entry, code verbatim | `DemoRunStart.tsx:—` | `run-start-kit.tsx:304-320`, mounted `run-start.tsx:904` | extra | ruled: `<plan>` R8 f.17 + `ref dashboard-surfaces §9.1` — the served counterpart of the demo's per-entry problem banners (C39) |
| C63 | Result banner sits at the TOP of the body, visible over whatever you are editing | `DemoRunStart.tsx:681-694` | `run-start.tsx:910-912` (`stage === "result"`) | divergent | ruled: `ref dashboard-surfaces §9.1` (plan → confirm → enqueue) for the stage split; see C71 for the part of it that is not ruled |
| C64 | `applied` banner: served `headline` + `detail` sentence | `DemoRunStartKit.tsx:335-344` | `run-start-kit.tsx:370-377` | divergent | unserved: `CommandResult`'s applied arm carries no headline or detail — the title is client-authored (**Start applied**) |
| C65 | `applied` `KeyValueList` of created rows (`Run Row` → `title → panel`) | `DemoRunStartKit.tsx:345-352` | `run-start-kit.tsx:376-381` | divergent | unserved: travels with C56 — the rebuild lists `affectedTargets` as `family → runId` |
| C66 | `applied` `MetaLine` — clock + `requested by {actor}` | `DemoRunStartKit.tsx:353` | `run-start-kit.tsx:380` | divergent | unserved: no settlement clock or actor echo on `CommandResult`; the line reads `command {id}` instead |
| C67 | `already-applied` arm (idempotent re-send) | `DemoRunStartKit.tsx:—` | `run-start-kit.tsx:369-373` | extra | ruled: D253 — `CommandResultSchema` has an arm the demo's mock does not, and every arm must be handled |
| C68 | `conflict` banner: served headline/detail + `KeyValueList` of **form built against contract** / **server serves contract** | `DemoRunStartKit.tsx:359-377` | `run-start-kit.tsx:358-367` | divergent | unserved: the conflict arm carries `{currentVersion, message}` only — no contract-token pair to show either side of |
| C69 | `Reload the form` primary on the conflict banner — the demo's ONE cure for a moved contract | `DemoRunStartKit.tsx:364` | `run-start-kit.tsx:—` | missing | OPEN — operator call: the rebuild offers no re-plan affordance on a conflict, and D253's own rule says a re-send of the same envelope is refused identically — so the banner names a state with no exit |
| C70 | `rejected` → `Refusal` with the served code and `outcome="nothing is enqueued"` | `DemoRunStartKit.tsx:396-400` | `run-start-kit.tsx:348-354` | divergent | unserved: no headline on the rejected arm — the title is client-authored (**The start was refused**); the served `message` is the body |
| C71 | "Rejected — but no refusal code was served" arm | `DemoRunStartKit.tsx:385-394` | `run-start-kit.tsx:—` | missing | ruled: `<plan>` R8 f.2 — `CommandResultSchema` makes `code` required on `rejected`, so the uncoded arm is unreachable here |
| C72 | Dismiss control wording: **Close** on applied, **Dismiss** on rejected | `DemoRunStartKit.tsx:341,379-383` | `run-start-kit.tsx:411,452` | exact | `ported: D272 item 9` (unit V1, 2026-08-26) — a shared `dismissWith(word)` helper puts **Close** on the settled/`Already applied` arm and **Dismiss** on the refusal, the demo's own split; the conflict arm carries `Reload the form` instead (C69) |
| C73 | Aside `w-[300px] shrink-0`, left border, `bg-recess`, `aria-label="Run controls"` | `DemoRunStart.tsx:839-842` | `run-start.tsx:922-925` | exact | — |
| C74 | Aside header: bordered icon square (`SlidersHorizontal`), `SHARED SETTINGS`, `Run controls`, "These options work the same way for every workflow." | `DemoRunStart.tsx:843-861` | `run-start.tsx:926-944` | exact | — |
| C75 | Aside scroller `gap-loose p-cozy` | `DemoRunStart.tsx:863` | `run-start.tsx:946` | exact | — |
| C76 | Handoff Well — **Set after the handoff** + "The spreadsheet intake collects queue behavior and destination after it validates the sheet." | `DemoRunStart.tsx:865-872` | `run-start.tsx:—` | missing | ruled: D251 — no spreadsheet method kind exists, so there is no handoff arm |
| C77 | `RunControlGroup` anatomy: numbered chip, `h4` title, `p` description, `border-b … last:border-b-0` | `DemoRunStart.tsx:490-525` | `run-start.tsx:463-498` | exact | — |
| C78 | Group **01 Queue behavior** / "Choose how this work enters the browser queue." | `DemoRunStart.tsx:874-878` | `run-start.tsx:947-951` | exact | — |
| C79 | Active-run policy as a `Select` over the three `ENQUEUE_POLICY_LABEL` arms | `DemoRunStart.tsx:879-889` | `run-start.tsx:967-975` | divergent | ruled: D251 (`ref dashboard-surfaces §9.1` "No policy control") — drawn read-only as a `LockedValue` over `ENQUEUE_POLICY_MEANING`, because `StartPlanIngress` carries no per-start override |
| C80 | Policy Field description — the active-run conflict note, or "Nothing is running for this subject." | `DemoRunStart.tsx:881` | `run-start.tsx:—` | missing | ruled: D251 — the check runs per submission inside `planStart`; its answer is the served `active-run-exists` refusal `PlanRefusals` draws |
| C81 | The policy's own reason, on screen | `DemoRunStart.tsx:—` | `run-start.tsx:1118` | exact | `ported: D272 item 9` (unit V1, 2026-08-26) — the Active-run policy is the same shared `LockedFact` as C48, with `reason={ENQUEUE_POLICY_REASON}` drawn on screen rather than on a `title`, which is what D251 asked for |
| C82 | **Priority** Field + Select (Interactive / Bulk) + "Bulk work yields whenever interactive work needs the browser." | `DemoRunStart.tsx:891-896` | `run-start.tsx:976-988` | exact | — |
| C83 | Group **02 Safety & mode** renders only when the workflow declares flags | `DemoRunStart.tsx:900-901` | `run-start.tsx:990-1006` | divergent | OPEN — operator call: the rebuild always draws group 02 with a DISABLED **Dry run** checkbox reading "not declared by this workflow". The demo's rule for a declaration-driven control is "a workflow that declares none shows none: no empty scaffolding" (`DESIGN.md:305`); `DESIGN.md`'s offer-disabled rule is written for an OPTION inside a control, not for the group |
| C84 | Group numbering: Destination is `03` with flags and `02` without | `DemoRunStart.tsx:924` (`step={flags.length > 0 ? "03" : "02"}`) | `run-start.tsx:1009` (always `03`) | divergent | OPEN — operator call: travels with C83; a fixed `03` leaves a gap in the reading path the numbers exist to give |
| C85 | Flags are the descriptor's declared list, each with its own note (`dryRun`, `duplicateCheck`, `crmCheck`) | `DemoRunStart.tsx:905-925`, `demo-wire.ts:488-510` | `run-start.tsx:998-1005` | divergent | unserved: no declared flag list — only `InputRunSurface.supportsDryRun` (itself DERIVED, D209), so one hardcoded checkbox stands for the set |
| C86 | Dry-run flag description — the demo's sentence ("Reads everything for real and writes nothing, anywhere. The row carries a dry-run chip for its whole life…") | `demo-wire.ts:492` | `run-start.tsx:1000` | divergent | unserved: travels with C85 — the rebuild shows a description only in the NEGATIVE case ("not declared by this workflow") and none when dry run IS available |
| C87 | `StartFlagControl` is a `Checkbox`, never a `Switch` | `DemoRunStartKit.tsx:216-226` | `run-start-kit.tsx:208-230` | exact | — |
| C88 | Group **03 Destination** / "Confirm the systems this run is allowed to write to." | `DemoRunStart.tsx:923-927` | `run-start.tsx:1008-1012` | exact | — |
| C89 | Instance grid `grid-cols-1 min-[420px]:grid-cols-2` | `DemoRunStartKit.tsx:72` | `run-start-kit.tsx:92` | exact | — |
| C90 | Per-system Field label = `SYSTEM_LABEL` | `DemoRunStartKit.tsx:79` | `run-start-kit.tsx:101` | exact | — |
| C91 | Per-system description = the resolved **HOST** (`nums`, `break-all`) + " · no test host provisioned" | `DemoRunStartKit.tsx:80-88` | `run-start-kit.tsx:102-109` | divergent | unserved: no resolved host per `(system, instance)` on `SystemInstancePrimitive` — the description carries only the served unavailability reason, and a system WITH a test instance shows nothing at all |
| C92 | Test option hidden when no test instance exists | `DemoRunStartKit.tsx:97` | `run-start-kit.tsx:119-122` | divergent | ruled: `DESIGN.md:305` — offered DISABLED as "Test instance — not wired"; hiding it teaches the operator the product has never heard of it |
| C93 | Test `Banner` — "Targeting the TEST instance of …" + the ledger sentence | `DemoRunStartKit.tsx:103-108` | `run-start-kit.tsx:128-133` | exact | — |
| C94 | Zero-system Well — "This start declares no browser system." | `DemoRunStartKit.tsx:—` | `run-start-kit.tsx:83-97` | extra | `ruled: D272 item 9` — **RETAINED with a recorded exception** (unit V1, 2026-08-26). "Keep honest empty states": the demo's fixtures always declare at least one system, so it has no counterpart to be exact against; here the set is SERVED and can be empty, and a chooser that renders nothing at all is indistinguishable from one that failed to load. The sentence states the declaration, never a guess about the workflow. Cited at the site |
| C95 | Footer `MetaLine tone="faint"` | `DemoRunStart.tsx:941-956` | `run-start.tsx:1026-1035` | exact | — |
| C96 | Footer item 1 — `{workflow label} v{major}.{minor}` | `DemoRunStart.tsx:946`, `demo-wire.ts:1777-1780` | `run-start.tsx` footer — `{label} v{n}` from required bootstrap `start.version` | divergent | ruled 2026-08-25: every rebuild descriptor records one positive integer, not a `{major, minor}` pair. The footer now prints that exact recorded integer through shared `versionTag`; appending `.0` would fabricate a minor version. |
| C97 | Footer item 2 — the blocked reason, else the plan headline | `DemoRunStart.tsx:947` | `run-start.tsx:1032` | divergent | ruled: `ref dashboard-surfaces §9.1` — reads `N to create` off `planned.length` for the same reason as C55 |
| C98 | Blocked reason **Type at least one value.** | `DemoRunStart.tsx:627` | `run-start.tsx:783` | exact | — |
| C99 | Blocked reason **Fix or remove the refused values first.** | `DemoRunStart.tsx:629` | `run-start.tsx:781` (**Fix the refused entry first.**) | divergent | ruled: `<plan>` R8 f.17 — the whole-text parser refuses one entry at a time, so the plural is not a true statement |
| C100 | Blocked reasons for the upload / capture / spreadsheet methods | `DemoRunStart.tsx:630-641` | `run-start.tsx:—` | missing | ruled: D251 (travels with C41–C43) |
| C101 | Footer **Cancel** secondary | `DemoRunStart.tsx:957-959` | `run-start.tsx:1042-1044` | exact | — |
| C102 | ONE primary: **Start run** / **Start dry run**, `Play` glyph | `DemoRunStart.tsx:968-981` | `run-start.tsx:1045-1060` | divergent | ruled: `ref dashboard-surfaces §9.1` / `ref frontend-backend-integration §5.1.1` — two presses (**Plan the run**, then **Start run**), because planning is a server round-trip that returns a single-use token |
| C103 | Primary disabled by `blockedReason` / an applied result | `DemoRunStart.tsx:971` | `run-start.tsx:1050,1054` | divergent | ruled: same as C102 — also disabled while `busy` and when the server planned zero rows |
| C104 | **Open the intake…** primary for a spreadsheet source | `DemoRunStart.tsx:960-972` | `run-start.tsx:—` | missing | ruled: D251 — no spreadsheet method; the intake is reached from the queue toolbar instead, a deviation recorded at `dashboard-app.tsx:1160-1172` |
| C105 | `StageRail` inside the run modal ("1 Input › 2 Plan › 3 Result") | `DemoRunStart.tsx:—` (the demo's rail is the INTAKE's spine, `DemoRunStartKit.tsx:427-477`) | `run-start.tsx:818` | extra | ruled: `<plan>` R8 f.22 (rebuild-only, cited and kept) |
| C106 | `StageRail` anatomy: `›` separators, settled stage swaps its number for a `Check`, `aria-current="step"` | `DemoRunStartKit.tsx:439-475` | `run-start-kit.tsx:418-451` | exact | — |
| C107 | The typed box stays on screen while the plan is read | `DemoRunStart.tsx:709-718` (always) | `run-start.tsx:845-869` (`stage === "input"` only) | divergent | OPEN — operator call: at the Plan stage the operator cannot see what they typed, and `ref dashboard-surfaces §9.1` describes the four rows as one view. The two-step COMMAND is ruled (C102); hiding the input is not |
| C108 | **How this run is shaped** stays on screen while the plan is read | `DemoRunStart.tsx:767-795` (always) | `run-start.tsx:871-887` (`stage === "input"` only) | divergent | OPEN — operator call: travels with C107 — the locked constants leave the screen at the moment the operator authorises the runs they shaped |
| C109 | Changing a shared setting after a result clears the plan | `DemoRunStart.tsx:882,893` (`setResult(null)` on every control) | `run-start.tsx:981,1003,1017` (`setPlan(null)` only) | divergent | OPEN — operator call: the result banner and the `Result` stage survive a change that invalidated the plan behind them |
| C110 | Opening lands on the panel you are standing in, keyed on `open` | `DemoRunStart.tsx:583-586` | `run-start.tsx:693-696` | exact | — |
| C111 | The fallback default when the panel's workflow cannot be started | `DemoRunStart.tsx:478-483` (first startable) | `run-start.tsx:633-645` | divergent | ruled: D219/D241 — the auto-pick set is the rail's set, so a chunk harness or a proving workflow is never chosen for the operator; an empty set opens on nothing |
| C112 | Switching a workflow clears the form | `DemoRunStart.tsx:556-573` | `run-start.tsx:681-689` | exact | — |
| C113 | Closing the dialog resets the result | `DemoRunStart.tsx:667` | `run-start.tsx:759-770` | exact | — |
| C114 | `@container` on the body (not a viewport query) | `DemoRunStart.tsx:676-679` | `run-start.tsx:813-817` | exact | — |
| C115 | The surfaces wrapper mounts the modal beside the intake dialog | `DemoRunStart.tsx:990-1015` | `run-start.tsx:1071-1093` | divergent | ruled: D251 + `dashboard-app.tsx:1160-1172` — nothing to hand off to, so the wrapper mounts the dialog alone |

**Counts:** 115 elements — 48 exact · 39 divergent · 19 missing · 9 extra.
Of the 67 non-exact: **ruled 39** · **unserved 15** · **OPEN 13**.

**OPEN (13), for the operator:** C28 · C48 · C57 · C61 · C69 · C72 · C81 · C83 · C84 · C94 ·
C107 · C108 · C109.
**Unserved (15), each a `builds:` line:** C49 · C50 · C51 · C55 · C56 · C58 · C59 · C64 · C65 ·
C66 · C68 · C70 · C85 · C86 · C91.

**Since 08-14:**

- **Fixed** (baseline R8 findings now closed at HEAD): f.8 the aside header + three numbered
  `RunControlGroup`s (C73–C78, C88); f.9 the `@container` regression (C114); f.10 the 220 px width
  (C7); f.11 the category chip + `Workflow setup` / `What this will create` labels (C29, C27, C52)
  and `capability.note`, which D251 resolved as `descriptor.summary` (C31); f.12 the picker built
  from boot data, with the unstartable-reason disclosure now DRAWN rather than deferred (C21, C23);
  f.17's examples row + value-noun + parser label, closed by D250 as declared-and-derived rather
  than as a wire addition (C32–C35); f.18 the vocabulary drift (C6, C10, C13, C82, C88, C98).
- **Still open from the baseline:** f.17's per-entry problem model (C36, C37, C39 — kept-throw, and
  the citation still holds); the demo's unlocked sub-selection arm (C50); and every plan-preview
  field the start-plan wire does not serve (C56, C58, C59).
- **New — not in the baseline, and each of them is on the OPEN or unserved list above:** the two
  invisible-reason rows (C48, C81) and the raw field name standing in for a label (C49), all three
  now confirmed on the 1440×900 reference; the always-drawn group 02 and its frozen `03` (C83, C84);
  the stage machine's three consequences (C107, C108, C109) — the baseline audited a modal that had
  no stage rail to hide anything behind; the conflict arm with no re-plan exit (C69); the raw ISO
  `expiresAt` (C61); and the card→table plan shape (C57).

**Proposed `builds:` lines from region C's 15 `unserved:` rows.** All eight go on
`{#dash-defaults}` — `{#track-b}` is `status: done`, so a new line there would reopen a closed
node — and they are written in that node's own `- [ ] TAG …` notation.

- [ ] BE `StartPlanResponse.planned[]` grows the row's role, destination panel, containment,
  born-as status and note — the demo's whole `PlanRowCard` anatomy, and the same fields the applied
  banner's created-rows list reads (C56, C65) {#dash-defaults}
- [ ] BE `StartPlanResponse` grows the plan's headline, its `warnings[]` and the ratified
  `decisions[]` its shape obeys — the modal counts `planned.length` because there is nothing else
  to print (C55, C58, C59) {#dash-defaults}
- [ ] BOTH the descriptor start-capability projection — operator-variable sub-selections with their
  option lists, per-option unavailability reasons and visibility conditions; today the only declared
  sub-selection is a parser CONSTANT, which is locked by definition (C50, C51) {#dash-defaults}
- [ ] BOTH a human label on `SurfaceField`, so a locked sub-selection names the choice instead of
  printing the field identifier (`keepNonHdh`) at the operator (C49) {#dash-defaults}
- [ ] BOTH a declared run-flag list on the descriptor's start surface — each flag with its label and
  its note — beyond the single DERIVED `supportsDryRun` one hardcoded checkbox stands for (C85, C86)
  {#dash-defaults}
- [ ] BE `CommandResult`'s `applied` and `rejected` arms grow a served headline and detail sentence,
  the settlement clock and the requesting actor; every title on the result banner is client-authored
  today (C64, C66, C70) {#dash-defaults}
- [ ] BE the command `conflict` arm grows the contract pair — what the form was built against and
  what the server now serves — which is the fact the operator needs to know what moved (C68)
  {#dash-defaults}
- [ ] BE the resolved host per `(system, instance)` on `SystemInstancePrimitive`, so Destination
  names the machine the run is about to touch instead of reassuring the operator (C91)
  {#dash-defaults}

---

# Roll-up — group 1 (shell · queue · run start)

## Counts

| Region | Elements | exact | divergent | missing | extra | ruled | unserved | **OPEN** |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| A — SHELL | 178 | 132 | 34 | 11 | 8 | 34 | 2 | **10** |
| B — QUEUE | 196 | 118 | 40 | 27 | 11 | 40 | 25 | **13** |
| C — RUN START | 115 | 48 | 39 | 19 | 9 | 38 | 15 | **14** |
| **Total** | **489** | **298** | **113** | **57** | **28** | **112** | **42** | **37** |

**298 of 489 elements (61%) are byte-exact ports.** Of the 191 that are not, 112 carry a ruling and
42 name a wire gap; **37 are OPEN and need the operator.** Region A is the closest to the demo (74%
exact) and Region C the furthest (42%) — the run modal is where the most decisions were made and the
most reasons ended up in a tooltip instead of on the page.

## The OPEN list — every unexplained divergence, for the operator

Nothing below is dismissed, waved through or "modified". Each needs a ruling; none has one.

**Ruled 2026-08-26 by D272 (unit V1, the Track F vocabulary sweep).** Every WORD-level entry below
is now closed: the ruled wording lands verbatim, or the named truthful exception is recorded at the
code site AND in this ledger's own row. Struck entries name what closed them. What is left open is
the layout, delivery and control-shape work, which is not a vocabulary question.

### Honesty of what the operator is TOLD (the ones with a cost)

1. ~~**B165 — the bulk result vector prints only its non-zero buckets.**~~ **CLOSED — `ruled: D272
   item 5`, landed 2026-08-26.** The band maps all four `BULK_RESULT_OUTCOMES`
   (applied · conflict · refused · errored) unconditionally, zero buckets included, plus an explicit
   `N not attempted` from `requestedCount - results.length` (`queue-toolbar.tsx:463,475`).
2. ~~**B173 / B174 — both closing sentences are gone.**~~ **CLOSED — `ruled: D272 item 5`, landed
   2026-08-26.** Both land at `queue-toolbar.tsx:587,592`, the partial arm widened from the demo's
   two verdicts to D235's four wire ones so the sentence cannot describe a vector it no longer has.
3. ~~**B172 — the skipped-row report lost its shape.**~~ **CLOSED — `ruled: D272 item 5`, landed
   2026-08-26.** A `<details>` over a `max-h-28` scrolling per-row title list
   (`queue-toolbar.tsx:546`); no row is comma-joined away.
4. ~~**B164 — the result heading is the wire's lowercase verb.**~~ **CLOSED — `ruled: D272 item 5`,
   landed 2026-08-26.** `${plan.label} — partial result` (`queue-toolbar.tsx:459`); a whole-request
   refusal with no vector still reads `Nothing was sent`.
5. **C69 — the conflict banner names a state with no exit.** The demo's ONE cure is a `Reload the
   form` primary; the rebuild offers no re-plan, and D253's own rule says re-sending the same
   envelope is refused identically. *(The `Reload the form` control itself now draws on the conflict
   arm — `run-start-kit.tsx`; what stays open is the re-plan path behind it, which is not a
   vocabulary row.)*
6. ~~**C48 / C81 — a reason that exists but is not on screen.**~~ **CLOSED — `ported: D272 item 9`,
   unit V1, 2026-08-26.** One shared `LockedFact` (`run-start-kit.tsx:188-224`) draws label +
   `LockedValue` + the reason as a visible `<p>` at both sites, and deliberately does not also put
   the sentence on a `title`, so it is on screen once rather than announced twice.
7. ~~**A122 — "1 worker need attention".**~~ **CLOSED — `ported: D272 item 4`, unit V1, 2026-08-26.**
   The chip prints the demo's stable plural `{n} workers need attention` (`shell.tsx:2263`);
   `plural(n,"worker")` is gone from the sentence, so noun and verb cannot disagree at one.
8. ~~**C61 — a raw ISO instant in operator-facing text.**~~ **CLOSED — `ruled: D272 item 8`, unit V1,
   2026-08-26.** `expires ${fmtClock(plan.expiresAt)}` (`run-start-kit.tsx:305`) — R6 f.10's
   treatment, applied where the same defect had reappeared.
9. ~~**A126 — `app 0.1.0` under a tooltip that explains only MAJOR and MINOR.**~~ **CLOSED —
   `ported: D272 item 4`, unit V1, 2026-08-26.** `appVersionTag`/`fmtAppVersion`
   (`format.ts:215-236`) cut the served semver to the demo's two-part pair and THROW on a string
   they cannot read, so the drawn tag and its tooltip name the same two components and no third
   one is silently dropped.

### Layout and delivery

11. **A169 + A168 — the toast floor, and the nesting that makes it possible.** The shell never sets
    `--ds-toast-inset-bottom`, so the viewport falls back to the plain gutter and every toast sits
    over the Session bar; and the theme root is INSIDE both providers, so setting the variable there
    would not reach the viewport anyway. The demo records both halves as load-bearing and describes
    this exact state as *"visible the moment the page was booted, and invisible to typecheck."* One
    defect, two edits.
12. **A170 — the app root drops `min-w-0` and `overflow-hidden`** and adds `min-h-0`. No citation.
13. **A65 — the gear opens a `Dialog`; the demo opens a full-page takeover** with its own
    `PageHeader` and Back. Ref dashboard-surfaces §9.8 says only "the gear in the top bar, opening the
    sections the SERVER lists" — takeover-vs-dialog is undecided in writing.
14. **C107 / C108 — the typed box and the shape block leave the screen at the Plan stage**, so the
    operator authorises runs without seeing what they typed or the constants they were shaped by. The
    two-step COMMAND is ruled (D251); hiding the input is not.
15. **C83 / C84 — group 02 always draws, with a disabled control inside it.** The demo's rule for a
    declaration-driven control is "a workflow that declares none shows none: no empty scaffolding",
    and the numbering travels with it (Destination is `03` with flags and `02` without; a fixed `03`
    leaves a gap in the reading path the numbers exist to give).
16. **C57 — the plan is a `Table`, not the demo's list of `Card`s.** The missing columns are a wire
    gap; card-vs-table is a presentation choice nothing records.
17. **A81 / A82 — two unrecorded rail-entry spacing changes**: a `gap-snug` added to the label span
    and a `pl-base` added to the count cluster.

### Controls and vocabulary

18. **B155 — the bulk strip leads with the destructive verb** (`Cancel` then `Retry`); the demo puts
    the irreversible one last, and the product's own rule sits one file over (`actions.tsx:378`).
19. **B195 / B196 — `CommandResultFeed` and the applied-result toast are absent.** `actions.tsx:16-21`
    defers them until "the app's real `CommandResult` wiring" — a reason **D253 has spent**: both
    refusal arms are served and folded by `settleCommandResult` today.
20. **B57 / B80 — the operator's "checked" mark, at all three of its sites** (row glyph + `sr-only`,
    well tally `✓ 3/12`, the drill-in check). The demo holds `checkedIds` as pure client state, so it
    is portable today with no wire. **The question is whether a check survives a reload** — durable
    and per-actor, or not at all.
21. **B112 — the fact chip forks the ds `Chip` primitive** it could call
    (`ds/primitives-core.tsx:393` exports the same component with the same `label` prop). Visible
    deltas: chip height, padding, and label ink `--ds-fg-faint` vs the primitive's `--ds-fg-muted`.
22. ~~**A174 / B141 — the `Import spreadsheet` button in the toolbar's left group.**~~ **CLOSED —
    `ruled: D272 item 3`, RETAINED with a recorded exception, unit V1, 2026-08-26.** The reason was
    always real; D272 item 3 is the ruling it lacked. It is recorded at `dashboard-app.tsx:1565`
    with the rejected arms named, and in `src/dashboard/CLAUDE.md` §"Ruled deviations from the
    rebuild-demo". Not permanent: the button goes when the Run Modal grows the handoff.
23. ~~**C72 — the dismiss control says `Dismiss` on every arm.**~~ **CLOSED — `ported: D272 item 9`,
    unit V1, 2026-08-26.** A shared `dismissWith(word)` helper puts **Close** on the settled arm and
    **Dismiss** on the refusal (`run-start-kit.tsx:411,452`), the demo's own split.
24. **C109 — changing a shared setting after a result leaves the result banner and the `Result` stage
    standing** over a plan the change invalidated.

**Resolved 2026-08-25 — C96.** The footer receives the descriptor's required `version` in the
bootstrap start block and prints `{label} v{n}` through `versionTag`. The demo's minor half has no
rebuild counterpart, so no `.0` is fabricated.

### Rebuild-only additions with no demo counterpart (keep, or cut — the operator decides)

**All three CLOSED 2026-08-26 (unit V1) — each is KEPT, and each keep is now recorded at its code
site and in its ledger row above.** A rebuild-only affordance with a stated reason and no citation
was the whole complaint; a citation is what closed it.

26. ~~**A16** — first `Escape` clears a non-empty search query, second closes the dialog.~~
    **`ruled: D272 item 3`** — the second press still reaches the dialog, so nothing the demo's
    Escape does is unavailable here (`day-search.tsx:158` + `src/dashboard/CLAUDE.md`).
27. ~~**C28** — a `"No workflow"` title arm for an empty catalogue.~~ **`ruled: D272 item 9`** —
    "keep honest empty states". The demo's catalogue is a fixture that always has one; this one is
    served and can be empty, and a heading that vanishes reads as still loading (`run-start.tsx`).
28. ~~**C94** — a zero-system Well ("This start declares no browser system.").~~ **`ruled: D272
    item 9`** — same rule: the set is served and can be empty, and a chooser that renders nothing is
    indistinguishable from one that failed to load. The sentence states the DECLARATION, never a
    guess about the workflow (`run-start-kit.tsx`).

## Proposed `builds:` lines

**Every line lands on `{#dash-defaults}`, and the layer choice is itself a finding.** `{#track-b}`
and `{#track-c}` are both `status: done`; adding a line to either would reopen a closed node, which
is the one thing the roadmap's own governance forbids. `{#dash-defaults}` is `status: active` and its
`>` line already says it is the node a migration only WIRES. If the fold unit prefers, these are also
a coherent sub-node of their own (a demo-fidelity closure task) hanging off `{#dash-defaults}`.

### From Region A (the shell) — 2 lines

```
- [ ] BE the preflight/doctor summary and its rerun command — `FrontendBootstrapWireSchema#preflight` is declared-unserved (D184) and the whole popover is built behind it, so the stethoscope is absent from the bar entirely (A39, A42) {#dash-defaults}
- [x] BOTH a backfill-gap notification trigger — same-generation unreplayable-history detection, stable no-churn durable identity and the authority-immutable permanently pinned Refusal landed in `68dea43a` and corrected in `e108ff3f`/`a2d2a8e8` (A46) {#dash-defaults}
```

### From Region B (the queue) — 10 lines

```
- [ ] BOTH member-outcome vocabulary on the member wire — the typed outcome word and the Outcome/Detail column-heading switch (B83, B89) {#dash-defaults}
- [ ] BE per-status member counts on `memberRollup` — the well's six-status tally and a group's △ N fold (B56, B77) {#dash-defaults}
- [ ] BOTH a declared `identifierProjection` so a member line can carry its EID column (B75, B82) {#dash-defaults}
- [ ] BOTH the row-variant naming layer — per-row `doing` / `why` / `constraint` sentences and the row-type word behind the ⓘ (B43–B48, B51) {#dash-defaults}
- [ ] BE `facts[]` gains `arrowTo`, `warn` and `fullRow` so a fact chip can show direction, hazard and a full-width line (B114–B116) {#dash-defaults}
- [ ] BOTH the served roster / People section — `View full list`, the workflow-specific `View all signers` label, and the whole drill-in triage table (B97, B98, B130–B135) {#dash-defaults}
- [ ] BE the `records[]` extraction stream on the queue wire — the record well, `N of M read`, `N blocked`, per-record glyphs and the arriving line (B100–B104) {#dash-defaults}
- [ ] BE `reviewRunId` so a packet can chip `OCR Review · {status} ↗` (B110) {#dash-defaults}
- [ ] BE `extractedCount` so a row can chip `N people` (B111) {#dash-defaults}
- [ ] BE `groupNoun` so the member-preview line reads as a counted anchor (B68) {#dash-defaults}
```

Six of these ten wait on the SAME producer — the first multi-person / OCR-review workflow — so they
cluster rather than landing one at a time. Each traces to a row the 2026-08-20 ledger sweep already
dispositioned as *recorded, no producer, named trigger*; what is new here is that their consuming UI
is enumerated element by element.

### From Region C (the run start) — 8 lines

```
- [ ] BE `StartPlanResponse.planned[]` grows the row's role, destination panel, containment, born-as status and note — the demo's whole `PlanRowCard` anatomy, and the same fields the applied banner's created-rows list reads (C56, C65) {#dash-defaults}
- [ ] BE `StartPlanResponse` grows the plan's headline, its `warnings[]` and the ratified `decisions[]` its shape obeys — the modal counts `planned.length` because there is nothing else to print (C55, C58, C59) {#dash-defaults}
- [ ] BOTH the descriptor start-capability projection — operator-variable sub-selections with their option lists, per-option unavailability reasons and visibility conditions; today the only declared sub-selection is a parser CONSTANT, which is locked by definition (C50, C51) {#dash-defaults}
- [ ] BOTH a human label on `SurfaceField`, so a locked sub-selection names the choice instead of printing the field identifier (`keepNonHdh`) at the operator (C49) {#dash-defaults}
- [ ] BOTH a declared run-flag list on the descriptor's start surface — each flag with its label and its note — beyond the single DERIVED `supportsDryRun` one hardcoded checkbox stands for (C85, C86) {#dash-defaults}
- [ ] BE `CommandResult`'s `applied` and `rejected` arms grow a served headline and detail sentence, the settlement clock and the requesting actor; every title on the result banner is client-authored today (C64, C66, C70) {#dash-defaults}
- [ ] BE the command `conflict` arm grows the contract pair — what the form was built against and what the server now serves — which is the fact the operator needs to know what moved (C68) {#dash-defaults}
- [ ] BE the resolved host per `(system, instance)` on `SystemInstancePrimitive`, so Destination names the machine the run is about to touch instead of reassuring the operator (C91) {#dash-defaults}
```

## What this pass did NOT do

- **No demo pixels were re-photographed.** The demo dev server was not started; every demo verdict is
  read from SOURCE, and the rebuild's side is read from `tests/parity/references/*.png` as images.
  Rows that would need a demo pixel to settle say so in place.
- **Nothing was edited.** No doc, no source, no roadmap — this file is the whole deliverable, and a
  fold unit applies it to `docs/rebuild/03a-finish-the-dashboard.md` and the plan.
- **The three regions of group 1 only.** The context rail, the run-detail panel, the log stream, the
  archive, the activity report, the explorer, intake/capture, Settings and the ds kit belong to
  groups 2 and 3.
