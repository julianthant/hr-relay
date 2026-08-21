# 03a demo-fidelity audit — group 1: the SHELL, the QUEUE, the RUN START

**Date:** 2026-08-21 · **Unit:** demo-fidelity AUDIT group 1 of 3 (`feature/docs-fid-1`) · **Status:** ledger only — no doc, no code touched

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
| A16 | First `Escape` clears a non-empty query, second closes the dialog | — | `day-search.tsx:236-243` | extra | **OPEN — operator call** (rebuild-only affordance, no demo counterpart and no citation) |
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
| A46 | **The pinned backfill-gap `Refusal`** — the one record that cannot be filtered, snoozed or dismissed | `DemoTopBarSurfaces.tsx:707-722` | `top-bar.tsx:—` | missing | `unserved: no backfill-gap notification trigger` — ref dashboard-surfaces §2.6's trigger union carries no gap arm, and nothing publishes one |
| A47 | Filter chips **All · Unread · Pings · Inbox · Snoozed**, each with its count, counted over EVERY served record | `DemoTopBarSurfaces.tsx:724-730` | `top-bar.tsx:725-736` | exact | — |
| A48 | `Pings` / `Inbox` counts read zero | `DemoTopBarSurfaces.tsx:635-636` | `top-bar.tsx:631-632` | divergent | `ruled: prior audit R1` (no row declares a delivery route; their filter answers the EmptyState, which says a zero here never means a record was deleted) |
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
| A122 | …and its SENTENCE reads **"1 worker need attention"** at a count of one | — | `shell.tsx:1029` (`plural(n,"worker")` + " need attention") | divergent | **OPEN — operator call** — subject/verb disagreement on the singular; visible in `tests/parity/references/queue-day--graphite-warm--1440x900.png`. The demo's chip is always plural, so the port inherited a sentence that only works above one |
| A123 | `capacityChip` lives at module scope with BOTH arms | `DemoShell.tsx:1531-1541` | `shell-model.ts:402-412` | exact | — |
| A124 | The `+` **Add workers** `IconButton` (`Plus`, "Start parallel executors — pick a workflow and how many", `aria-haspopup="dialog"`) | `DemoShell.tsx:1903-1910` | `shell.tsx:1034-1044` (absent, with the refusal written in place) | missing | `ruled: D249` — two named blockers: `createDashboardWorkerSupervisor` refuses the process effect by name, and no worker POOL exists in authority to hold the `expectedVersion` the CAS needs |
| A125 | `AddWorkersDialog` — workflow `Select`, the `Workers` stepper (`Minus`/`aria-live` count/`Plus`), the per-worker result vector, `DialogFooter meta="N started"`, "Start N workers" | `DemoShell.tsx:1723-1823` | `shell.tsx:—` | missing | `ruled: D249` (anatomy stays pinned in the 2026-08-13 audit for the port that follows) |
| A126 | App-version tag | `DemoShell.tsx:1919-1924` (`app 3.1` — MAJOR.MINOR) | `shell.tsx:1052-1057` (`app 0.1.0` — semver, `AppVersionSchema` at `domain/dashboard/primitives.ts:6`) | divergent | **OPEN — operator call** — the tooltip beside it is the demo's verbatim MAJOR/MINOR sentence, so the drawn string has a third component the sentence never explains |
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
| A174 | An `Import spreadsheet` button in the bar's left group | — | `dashboard-app.tsx:1173-1180` | extra | **OPEN — operator call** — a named deviation in code (`:1161-1172`: the demo reaches intake from inside the Run Modal and this tree serves no such handoff, so deleting it would strand the intake workspace) but no ruling cites it. *Also visible to Region B.* |
| A175 | `CommandResultFeed` — the persistent conflict/rejected band between the bar and the panels | `RebuildDemo.tsx:724-733` | *(absent)* | missing | `ruled: actions.tsx:16-19` — deferred with its surface; the REFUSAL half is live and raises its own persistent toast from `park-resolve.tsx`, and D253 made the two refusal arms exhaustive |
| A176 | Panel REGION — `relative min-h-0 flex-1` wrapper (the floating window's positioning context) with the grid inside it | `RebuildDemo.tsx:747-748` | `dashboard-app.tsx:1220-1221` | exact | — |
| A177 | Panel grid — `grid-cols-1`, `gap`/`p` at `--ds-shell-inset`, `min-[1180px]:grid-cols-[var(--ds-w-side-panel)_minmax(0,1fr)]` | `RebuildDemo.tsx:748` | `dashboard-app.tsx:1221` | exact | — |
| A178 | Session panel mounted below the shell body, under EVERY view | `RebuildDemo.tsx` shell tail | `dashboard-app.tsx:1351-1359` | exact | — |

**Counts (Region A):** 178 elements — **131 exact · 34 divergent · 12 missing · 8 extra** (an element is
counted once, under the strongest verdict). Reasons on the 47 non-exact rows: **ruled 34** ·
**unserved 3** · **OPEN 10**.

**Since 08-14 (baseline R1/R2/R4/R7 + the R8 keyboard half):**

- **Fixed since the baseline:** the whole R7 `WorkerCardWireSchema` batch landed (R7-1 dead tone arms,
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
  format against its own tooltip; A65 the gear opening a dialog rather than the demo's takeover; A46
  the pinned backfill-gap record; A58 the arrival ping; A16 the Escape-clears affordance; A81/A82 two
  unrecorded rail-entry spacing changes; A170 the dropped root classes; A174 the `Import spreadsheet`
  button; A175 the `CommandResultFeed` band.
