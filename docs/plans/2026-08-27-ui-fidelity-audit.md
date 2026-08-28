# UI-1 fidelity audit — the rebuild-demo vs the current dashboard

**Date:** 2026-08-27 · **Unit:** run UI-1, U1b (the ratified audit; U1a produced the raw map)
**Branch:** `feature/ui-fidelity` · **Produces no code** — every row here is a disposition, not a change.

| | |
|---|---|
| Demo (the design authority) | `http://localhost:5173/?view=rebuild-demo` — legacy repo at `1ec1d870`, `src/dashboard/components/dev/rebuild-demo/` |
| Current | `http://localhost:5174/?day=2026-08-27` (an EMPTY day: 0 rows, Person Lookup active) |
| Viewports | **1440×900** (every surface) and **2000×900** (shell + Settings) |
| Sessions | `playwright-cli -s=ui1b-demo` / `-s=ui1b-cur`, headless, VIEW only; both closed at the end |
| Measurement | `getBoundingClientRect()` via `page.evaluate`, plus computed `--ds-*` tokens; screenshots in `ui-fidelity-audit/` |

**The operator's ruling this audit implements** (`docs/handoffs/2026-08-27-run-ui-1-fidelity.md`): the demo is the
design authority for everything it covers — alignment, spacing, sizes, vocabulary, colour, nav active states,
and takeover-vs-dialog. Anything the current build has that the demo does not cover is neither built further nor
removed; it becomes a numbered question for the operator.

**Two data facts that are NOT fidelity findings and are never classed as one:** the demo carries its 55-row
Jul 25 fixture while the current serves an empty Aug 27 (0 rows), and the demo registers 15 workflows against
the current's 7. Every difference that follows from those two is `state-only`.

## Legend — the six classes

| class | meaning |
|---|---|
| `exact` | demo and current agree — same element, same geometry/tokens/vocabulary (mechanism may differ where noted). |
| `state-only` | the same code would render the same thing; only the DATA differs (empty day, different workflow set, different fixture). Not a defect. |
| `ruled` | a divergence an existing ledger row or ratified decision already dispositions. **Never a fix-now.** Cites its row/decision. |
| `fix-now` | a real divergence with no ruling. U2/U3 owns it. Names the current `file:line`. |
| `takeover` | the window-replacing-container conversion the operator's headline ruling covers. U2 owns it. Names the demo container and the current component. |
| `new-in-current` | an element the demo does not cover. **Not to be built further and not to be removed** — it feeds `docs/decisions/2026-08-27-ui-fidelity-new-elements.md` (U5). |

---

## 1. Shell — top bar, toolbar, columns, sessions bar

Screenshots: `ui-fidelity-audit/shell-1440-demo.png` · `ui-fidelity-audit/shell-1440-current.png`

| id | region | element | demo | current | class | evidence |
|---|---|---|---|---|---|---|
| UF-SH-1 | top bar | banner frame height | `[role=banner]` **y=0 h=44 x=0 w=1440**; `h-[var(--ds-h-topbar)]`, `--ds-h-topbar: 44px` | **y=0 h=44 x=0 w=1440**; same token, same computed `44px` | `exact` | live `getBoundingClientRect` both sessions; ledger A1 (`fidelity-1:42`) already `exact`. **The coordinator's "~25px taller" eyeball is REFUTED at the banner** — see UF-SH-2 for where the 13px actually comes from |
| UF-SH-2 | toolbar | the bar's own frame | full-bleed band, `x=0 w=1440`, wrapper `flex shrink-0 flex-col border-b border-[--ds-border-subtle]`, **y=44** (flush under the banner), inner `px-[var(--ds-shell-inset)]` | rounded card island, `x=12 w=1416`, wrapper `border rounded-[var(--ds-radius-lg)] mx-[--ds-shell-inset] mt-[--ds-shell-inset]`, **y=56**, inner `px-[var(--ds-space-cozy)]` | `ruled` | **A124's sibling rows B136 + B137** (`fidelity-1:463-464`) — `ruled: D224` (operator decision on the live surface). This is the entire source of the "taller top bar": chrome above the queue is demo 81px vs current 94px |
| UF-SH-3 | toolbar | row height + gap | inner row `h=36` = `--ds-h-bar`, `gap-[var(--ds-space-snug)]` | inner row `h=36` = `--ds-h-bar`, same gap | `exact` | B138 (`fidelity-1:465`); measured 36/36 |
| UF-SH-4 | toolbar | Workflow Panel toggle (`leading` slot) | `x=12 w=79`, label `os` + `12`, identical multi-line `title` | `x=25 w=73`, label `pl` + `0`, **byte-identical `title` template** | `exact` | B139; live `title` compare — both read `Workflow Panel — … (code)\n…rows across every workflow…\nThe Status Bar's Needs you pill is attention, not this count\nw cycles floating · icon · sidebar` |
| UF-SH-5 | toolbar | `Start a run` primary | `x=97 w=90`, `title="Start a run — any workflow, from anywhere (r)"` | `x=475 w=90`, byte-identical `title` | `exact` | B140; the x shift is UF-SH-9's three extra buttons, not a spacing defect |
| UF-SH-6 | toolbar | status filter chips — set + order | 10 chips: All · Needs you · Queued · Running · Review · Write parked · Done · Done-with-warnings · Failed · Cancelled | identical 10 chips, identical order, identical accessible names | `exact` | B143 (`fidelity-1:470`); live enumeration of both bars |
| UF-SH-7 | toolbar | chip label rendering | count>0 draws icon + WORD + number (`Queued 2`); count==0 draws icon + number only (`0`) | identical rule — every count is 0 on this day, so every chip below `All`/`Needs you` draws the minimal form | `state-only` | live: demo `"All8"`,`"Queued2"`,`"0"`(Write parked) vs current `"All0"`,`"0"`(Queued). Same renderer, empty day. The raw map's "current uses full words, demo is icon-only" reading is inverted by this |
| UF-SH-8 | toolbar | chip explanation on hover | native `title` per chip (`"Accepted, nothing has run. Can be bumped or cancelled."`) | no `title`; the SAME sentences are served through the `Tooltip` primitive (`spec.meaning`) | `exact` | `shell.tsx:551-620` wraps every chip in `<Tooltip content={…}>`; the operator-facing behaviour is identical, only the mechanism is the shared primitive |
| UF-SH-9 | toolbar | `Import spreadsheet` button | absent | present, `x=104 w=137` | `ruled` | A174 (`fidelity-1:250`) — `ruled: D272 item 3` (**RETAINED with a recorded exception**: it is the only served door into the intake workspace) |
| UF-SH-10 | toolbar | `Workflow explorer` button | absent | present, `x=246 w=129` — `dashboard-app.tsx:1613` | `ruled` | **Reclassed 2026-08-27 (run UI-1) from `new-in-current`.** `dashboard-surfaces.md` §10, **D275 item 1**: *"Restore the two documented catalog toolbar entries and retain deep links; B hides navigation, C deletes it. This supersedes the prior corrective statement that no buttons exist."* This button is that restoration — a second door to the same Explorer takeover the top-bar segment (A7) already opens, by design. `ruled by D275.1; kept on the sheet as confirm-or-revisit` (`docs/decisions/2026-08-27-ui-fidelity-new-elements.md` item 1) |
| UF-SH-11 | toolbar | `UI catalog` button | absent | present, `x=381 w=88` — `dashboard-app.tsx:1621` | `ruled` | **Reclassed 2026-08-27 (run UI-1) from `new-in-current`.** Same **D275 item 1** restoration as UF-SH-10 (the second of the "two documented catalog toolbar entries"). **CA41** (`fidelity-3:721`) recorded the opposite state as of 2026-08-21 — "the catalog has NO control anywhere; it is reachable only by typing `?catalog=`", citing the operator's 2026-08-14 removal of the glyph (`8f55a168`) — and D275 item 1 (2026-08-26) is the later, more specific ruling that explicitly supersedes it. `ruled by D275.1; kept on the sheet as confirm-or-revisit` (`docs/decisions/2026-08-27-ui-fidelity-new-elements.md` item 2) |
| UF-SH-12 | toolbar | sort control + `Select` | `Attention first` select + `Select` toggle at the far right (`x=1242`, `x=1361`) | identical pair (`x=1229`, `x=1348`), `title="Act on several rows at once"` byte-identical | `exact` | B145/B146/B149; live |
| UF-SH-13 | top bar | Preflight / stethoscope icon | present, first of the right cluster (`aria="Preflight — 1 failing, 1 warning"`) | absent | `ruled` | A39 (`fidelity-1:95`) — `unserved: FrontendBootstrapWireSchema#preflight`, declared-unserved in `config/pending-wire-bindings.json` (D184); the consumer is built |
| UF-SH-14 | top bar | flask "Demo surfaces" icon | present (`aria="Demo surfaces — synthetic data"`) | absent | `ruled` | A60 (`fidelity-1:116`) — `ruled: operator 2026-08-14`; demo scaffolding with no product counterpart |
| UF-SH-15 | top bar | right-cluster ORDER | doctor · bell · theme · flask · gear | bell · theme · gear | `ruled` | A66 (`fidelity-1:122`) — follows A39 + A60, no separate cause |
| UF-SH-16 | top bar | search trigger wording | `aria="Search runs"`, placeholder `"Search people, files, trace ids…"` | `aria="Search this day's runs"`, placeholder `"Search this day…"` | `ruled` | A10 (`fidelity-1:56`) — `ruled: D184` (cross-day corpus deferred; the narrowing is stated at `day-search.tsx:6-20`) |
| UF-SH-17 | top bar | theme toggle | one `IconButton`, label names the DESTINATION (`"Switch to Paper Ink"`) | identical label, identical round-trip | `exact` | A59 (`fidelity-1:115`); live in both directions |
| UF-SH-18 | top bar | day picker + prev/next + count badge | `"Pick a day — showing Sat, Jul 25 · today, 55 rows"`, badge `55` | `"Pick a day — showing Thu, Aug 27 · today, 0 rows"`, badge `0` | `state-only` | identical accessible-name template, different day |
| UF-SH-19 | queue column | column frame | `section` **y=93 h=758 x=12 w=376**, `rounded-[--ds-radius-lg]`, header `h=36` | **y=106 h=745 x=12 w=376**, same classes, header `h=36` | `ruled` | width/style identical; the 13px `y` shift and 13px height loss are UF-SH-2's card, `ruled: D224` |
| UF-SH-20 | queue column | body | grouped rows (NEEDS YOU / ACTIVE / QUEUED / FINISHED TODAY) | workflow-specific empty state, three sentences | `state-only` | empty day; D272 item 9 (honest empty states with visible reasons) is what it renders |
| UF-SH-21 | detail region | grid split | `min-[1180px]:grid-cols-[var(--ds-w-side-panel)_minmax(0,1fr)]`, COL1 **x=400 w=1028** @1440 / **w=1588** @2000 | byte-identical class string, COL1 **x=400 w=1028** @1440 / **w=1588** @2000 | `exact` | live at both viewports |
| UF-SH-22 | right column | the `Run data` aside in the **no-run-open** state | **the demo renders NO right column here either.** `RebuildDemo.tsx:756-783`: `selectedRow ? <DemoLogPanel/> : <Panel><PanelBody className="grid place-items-center …"><EmptyState title="No run open" …/>` — one full-width panel, no `aside` | one full-width `section` + `grid place-items-center` empty state, same `title="No run open"` and a **verbatim-identical** description string | `exact` | demo source read directly; the aside only exists in the run-OPEN state (`RebuildDemo.tsx` COL1 → `aside … "Run data"`, measured x=1052 w=376 with a run open). **The coordinator's "no right column in the no-run-open state" eyeball is REFUTED** — the demo's own no-run state has none |
| UF-SH-23 | floating panel | Workflow Panel window | `div[role=dialog]` **y=93 h=758 x=12 w=200**, `absolute left-[var(--ds-space-cozy)] inset-y-[…]`, header `h=36` | `div[role=dialog]` **y=106 h=745 x=12 w=200**, byte-identical class prefix, header `h=36` | `exact` | live in both. The raw map's "current only" reading was a snapshot artefact — the demo renders the same floating dialog |
| UF-SH-24 | sessions bar | frame | outer `y=863 h=37` (`border-t`), inner `y=864 h=36` `h-[var(--ds-h-bar)] px-[var(--ds-shell-inset)]` | **byte-identical class string, identical y=863 h=37 / y=864 h=36** | `exact` | live; this is the one bar that is pixel-identical end to end |
| UF-SH-25 | sessions bar | state vocabulary | `2 running · 1 authenticating · 1 idle · 1 failed` | `0 running · 0 starting · 0 idle` | `ruled` | A118 (`fidelity-1:189`) — `ruled: D248`; `authenticating`/`keepalive` have no producer and `starting` is the arm that carries "alive and not yet reporting". The absent `failed` slot is the above-zero rule, i.e. `state-only` within the same ruling |
| UF-SH-26 | sessions bar | far-right `+` (add workers) | present (`Plus`, `"Start parallel executors — pick a workflow and how many"`) | absent | `ruled` | A124 (`fidelity-1:195`) — `ruled: D249`, two named blockers: `createDashboardWorkerSupervisor` refuses the process effect by name, and no worker POOL exists in authority to hold the CAS `expectedVersion`. **Coordinator eyeball CONFIRMED as absent, and already dispositioned** |
| UF-SH-27 | sessions bar | right end | `app 3.1` · green `Live` | `app 0.1` · orange `Reconnecting` | `state-only` | different build + a BFF connectivity state, not a rendering difference |
| UF-SH-28 | 2000×900 | content width | shell fills 2000: queue 376 fixed, COL1 **w=1588**, centre 1200 + aside 376 | fills 2000 identically: queue 376, COL1 **w=1588** | `exact` | live at 2000×900 in both. **The raw map's "demo caps near ~1560px, current stretches" is REFUTED** — it was a screenshot crop, not a layout cap |

---

## 2. Settings — the takeover and every section

Screenshots: `ui-fidelity-audit/settings-storage-light-1440-demo.png` · `…-current.png` (light theme, the clearest
container pair) · `settings-hosts-1440-{demo,current}.png` · `settings-capabilities-1440-{demo,current}.png` ·
`settings-keyboard-1440-{demo,current}.png`

### 2a. The container

| id | region | element | demo | current | class | evidence |
|---|---|---|---|---|---|---|
| UF-SET-1 | container | the takeover root | `RebuildDemo.tsx:656-657` switch → `DemoSettings.tsx:1071` `<div className="flex min-h-0 flex-1">`. **Full-bleed: y=44 h=819 x=0 w=1440** (and x=0 w=2000 at 2000px). No card, no border, no radius, no gutter | `dashboard-app.tsx:1394-1402` (`takeover === "settings"`) → `<div className="flex min-h-0 flex-1 px-[var(--ds-shell-inset)] pb-[var(--ds-space-base)]">` wrapping **`SettingsPage`** (`settings.tsx:901`), whose root is a `Panel` — `border rounded-[var(--ds-radius-lg)] bg-[--ds-surface-1]`. **Inset card: y=44 h=811 x=12 w=1416** | `takeover` | screenshot pair above; live bbox both viewports. The route half of the conversion HAS landed (it is a page with history and a Back path, **not** a `Dialog` — `[role=dialog]` is absent); the GEOMETRY half has not. Ratified by **D272 item 1** and **D274 item 5** (`dashboard-surfaces.md:143,172`); ledger rows A65 (`fidelity-1:121`) / SE1 (`fidelity-3:788`) recorded it as "OPEN — operator call" before that ratification. **D275 item 2** (`:182`) constrains the fix: the shared takeover wrapper keeps its a11y + motion contract |
| UF-SET-2 | top bar | nav segment state while Settings is open | `Dashboard` **pressed=false**, `Archive`/`Explorer`/`Activity` false, gear `pressed=true` — the switcher claims nothing | `Dashboard` **pressed=true** *and* gear `pressed=true` — two simultaneous "you are here" claims | `fix-now` | live `aria-pressed` read in both. Cause: `dashboard-app.tsx:1261-1262` — `const shellView = takeover === "archive" ? "archive" : … : "queue"`, so every non-switcher takeover (`settings`, `intake`, `catalog`) silently falls back to `"queue"`; `top-bar.tsx:925` then renders `aria-pressed={view === candidate}` as true. **No ledger row covers this** (A7 marks the segments `exact` on the queue view only). Also affects the intake and catalog takeovers. **Coordinator eyeball CONFIRMED** |
| UF-SET-3 | container | `Back to the dashboard` | present, top of the left nav, `ArrowLeft` + ghost button | present, byte-identical string and placement (`settings.tsx:942-951`), plus a focus-restore on close | `exact` | live both; the focus restoration is additive behaviour with no visual counterpart |
| UF-SET-4 | left nav | width + scroll | `w-[220px] shrink-0 … overflow-y-auto border-r … p-[var(--ds-space-base)]` (`DemoSettings.tsx:1072-1075`), measured **x=0 w=220 h=819** | byte-identical class string (`settings.tsx:937-941`), measured **x=13 w=220 h=809** | `takeover` | the 13px x and 10px h deltas are entirely UF-SET-1's card; the nav itself is a byte-for-byte port |
| UF-SET-5 | 2000×900 | container width | full-bleed **w=2000** | **w=1976** (2000 − 2×12 gutter) | `takeover` | live; the same 12px inset as UF-SET-1, not a separate cap |

### 2b. The section list

| id | region | element | demo | current | class | evidence |
|---|---|---|---|---|---|---|
| UF-SET-6 | left nav | `SETTINGS` group — General · Display · Performance · Paths | 4 editable sections (`demo-settings-wire.ts:76-79`) | the group is absent entirely | `ruled` | SE14–SE17 (`fidelity-3:801-804`) — `ruled: {#def-settings}` · `unserved: settingsSections`; Phase 4 row 8 |
| UF-SET-7 | left nav | `Environment & identity` | present (`DemoSettings.tsx:149-155,534-556`) | absent | `ruled` | SE37 (`fidelity-3:824`) — `unserved: no environment/identity axis on the bootstrap` |
| UF-SET-8 | left nav | `System behaviour` | present (`DemoSettings.tsx:159,635,642-661`) | absent | `ruled` | SE39 (`fidelity-3:826`) — `unserved: no system-behaviour constants axis` |
| UF-SET-9 | left nav | the storage entry's LABEL | `Storage health` — the nav word matches the page title | `Storage` — the nav word and the page title (`Storage health`) disagree | `fix-now` | live nav enumeration. The label is SERVED, not authored in the surface: `settings-model.ts:118-124` renders `section.label` verbatim, and the value is minted at **`src/server/dashboard/queries/bootstrap.ts:154`** — `{ id: "storage", label: "Storage", revision: 1 }`. SE45 (`fidelity-3:832`) ruled the PANEL HEADER port (D276 item 4) and that half has landed (`settings.tsx:353`); the nav word was never in its scope. **Coordinator eyeball CONFIRMED** — one-word server fix |
| UF-SET-10 | left nav | group headings + `HELP`/`Keyboard` | `SETTINGS` / `STATUS` / `HELP`, `Keyboard` last | `STATUS` / `HELP`, `Keyboard` last (no `SETTINGS` group to draw) | `state-only` | follows UF-SET-6; the heading renderer is identical (`settings-model.ts:120,130`) |
| UF-SET-11 | left nav | active-entry marking | pressed pill on the open section | `aria-current="page"` on the open `<a>` + the same pill | `exact` | live; current uses the stronger link semantic for the same visual |

### 2c. Storage health

| id | region | element | demo | current | class | evidence |
|---|---|---|---|---|---|---|
| UF-SET-12 | header | title + subtitle + icon | `Storage health` / *"The tracker volume, the authority generation, and the backups a restore would use."* / `Database` | **byte-identical title and subtitle** (`settings.tsx:353`) | `exact` | live innerText both; the D276 item 4 port landed |
| UF-SET-13 | header | `meta` slot | `newest backup 12m ago` | `checked 11:46 AM` | `ruled` | SE45 (`fidelity-3:832`) — the demo's `newest backup <age>` is **unserved**; the summary wire carries no backup age, so the slot takes the served `checkedAt` |
| UF-SET-14 | body | verdict `Banner` | `Read-write — healthy`, body = the integrity line | same title/tone, body = *"From the newest write-time-verified backup manifest; the doctor below re-verifies bytes."* | `ruled` | SE46 (`fidelity-3:833`) — `ruled: D276 item 4` (ported; the banner is the verdict, the lines are the facts it came from) |
| UF-SET-15 | body | two at-rest `HealthLine` rows (Authority / Backup) | absent | present (`settings.tsx:269-270`) | `ruled` | SE47 (`fidelity-3:834`) — `extra`, ruled ref dashboard-surfaces §9.8: the at-rest summary rides the bootstrap every view already has |
| UF-SET-16 | body | the Backup dot's tone when a backup is **stale** | the demo has no HealthLine; its stale backup is a `warning` `Badge` in the backups table (`DemoSettings.tsx:942`) | `backupStatusOf` maps `stale → "waiting"` (the blue/info dot), `missing → "failed"` (`settings.tsx:107-111`) | `ruled` | SE47 (the row itself is rebuild-only) + **D222** (`settings.tsx:119-127`: a stale backup does not stop the work, so it reaches the operator as an inbox row plus the gear's attention dot, never as a band). **Coordinator eyeball "`Backup stale` on the blue/info dot" CONFIRMED as real and already dispositioned** — recorded in Notes as a tone observation, not a fidelity defect |
| UF-SET-17 | body | three stat `Card`s — Authority generation · Rows on disk · Newest backup | present (`DemoSettings.tsx:885-921`) | absent | `ruled` | SE48 (`fidelity-3:835`) — `unserved`: `rowsOnDisk` has no counterpart, `authorityGeneration` is served only inside the on-demand doctor |
| UF-SET-18 | body | `Backups` table (Taken/Age/Size/Verdict/Note) | present (`DemoSettings.tsx:923-950`) | plain restore-candidate lines (`settings.tsx:232-246`) | `ruled` | SE49 (`fidelity-3:836`) — `unserved`: backup `sizeLabel` and `note` |
| UF-SET-19 | body | `Run storage doctor` button + its whole report | absent | present (`settings.tsx:276-278`, report at `:149-245`) | `ruled` | SE51–SE59 (`fidelity-3:838-846`) — all `extra`, ruled ref dashboard-surfaces §9.8 ("two readings at two costs; the doctor is a deliberate press") |
| UF-SET-20 | body | NO restore button on either side | none | none | `exact` | SE58 (`fidelity-3:845`) |

### 2d. System hosts

| id | region | element | demo | current | class | evidence |
|---|---|---|---|---|---|---|
| UF-SET-21 | header | section exists at all | `System hosts` (`Link2`), meta `N of M have a test host`, per-run `Banner`, System/Production/Test table | all four present | `exact` | SE40 (`fidelity-3:827`) recorded it `missing / OPEN`; **D274 item 6** (`dashboard-surfaces.md:173`, read-only hosts/capabilities) ruled it and the section has since landed. That ledger row is now stale — flagged in Notes |
| UF-SET-22 | header | subtitle | *"Which machine each system resolves to. Choosing between them is a per-run question, asked in the run modal."* | *"Where a run goes when it opens each system."* (`settings.tsx:508`) | `fix-now` | screenshot pair `settings-hosts-1440-*`; live innerText. Both are authored client constants; no row rules the wording |
| UF-SET-23 | banner | per-run banner title | `Choosing between these is a per-run decision` | **byte-identical title** | `exact` | live |
| UF-SET-24 | banner | banner body | *"The run modal picks the instance per system, prints the host it resolves to, and stamps a test badge on every row the start creates. A standing global override would redirect every future run with no expiry and nothing on screen to say so."* | *"A run envelope carries the instance per system and defaults to production; a start that asks for **test** is refused outright unless a distinct test host is configured, never quietly sent to production. This page states the hosts and sets none — a standing override here would redirect every future run with no expiry and nothing on screen to say so."* (`settings.tsx:517-525`) | `new-in-current` | the second half is the demo's sentence, ported. The first half states a REFUSAL the demo's runtime does not have — it is a true claim about this build, not a copy drift, so it is the operator's call whether the demo's shorter framing wins |
| UF-SET-25 | table | the SYSTEM column | the system's DISPLAY NAME (`UCPath`, `Kuali`, `Kronos`, `CRM`, `ServiceNow`, `OnBase`, `I-9`) — `demo-settings-wire.ts:400` maps `label` off `DEMO_SYSTEM_INSTANCES` | the raw wire id, lower-case (`ucpath`, `crm`, `onbase`, `new-kronos`, `old-kronos`, `sharepoint`) — `settings.tsx:538` renders `{host.system}` | `fix-now` | screenshot pair; the served `systemHosts` shape carries no `label`, so this is a two-file seam (wire + surface). No ledger row |
| UF-SET-26 | table | the per-system explanatory sentence under each name | present on every row (`demo-settings-wire.ts:388,403` — `note`), e.g. *"A UCPath write on the test host files nothing real and reads a stale copy of the roster."* | absent | `fix-now` | screenshot pair. The demo authors these as client constants, so the current can too; nothing rules them out |
| UF-SET-27 | table | PRODUCTION / TEST cell values | short hostnames (`ucpath.universityofcalifornia.edu`) | the real entry URLs, including a 300-character PeopleSoft deep link | `state-only` | identical renderer (`settings.tsx:540-545`, `break-all` on the URL); the demo's short strings are its own fixture values. Nothing to change in the surface — the current is printing the true configured value |
| UF-SET-28 | table | `none provisioned` absence arm | present, faint | present, faint, plus a distinct `provisioned identical to production — refused` arm (`settings.tsx:546-552`) | `new-in-current` | the third arm has no demo counterpart; it exists because `resolveSystemEntryUrl` refuses that case at run time (unit F11b finding 2) |
| UF-SET-29 | header | `N of M have a test host` meta | `4 of 7` | `0 of 9` | `state-only` | identical `systemHostsMeta` template; different configured estate |

### 2e. Workflow capabilities

| id | region | element | demo | current | class | evidence |
|---|---|---|---|---|---|---|
| UF-SET-30 | page | shape — one section per capability, one row per workflow, `N of M` per section | present (`DemoSettings.tsx:700-780`) | present, same capability-major shape, same per-section counts (`settings.tsx:624+`) | `exact` | screenshot pair `settings-capabilities-1440-*`; the docstrings on both sides argue the identical design |
| UF-SET-31 | header | subtitle | *"What each workflow can do — and, where it cannot, whether that is a decision or a gap."* | *"What each registered workflow can do, and what it will not do."* | `fix-now` | live innerText both; authored constants on both sides, no ruling |
| UF-SET-32 | banner | title | `Read from the descriptors, not from a list somebody kept up to date` | **byte-identical** | `exact` | live |
| UF-SET-33 | banner | trailing clause | banner ends at *"…gains it here on the same deploy."* | adds *"These six are what a descriptor declares; a seventh appears when a descriptor grows one, never before."* | `new-in-current` | live innerText; an added sentence about this build's capability set with no demo counterpart |
| UF-SET-34 | cell | the AVAILABLE cell | one info `Chip` carrying the detail and nothing else (`DemoSettings.tsx:682-690`) | a `Yes` `Chip` **plus** the detail beside it (`settings.tsx:593-610`) | `ruled` | the current's own docstring at `settings.tsx:578-592` is the ruling: `Chip` cannot hold a fact that will not survive truncation (`dsClip.token` outside, `dsClip.text` inside), DESIGN.md bans the cut, and **D272 items 8–9** ratified against it twice. Cite, do not "fix" |
| UF-SET-35 | cell | the N/A and `Not built` arms | `Chip` + reason sentence | `Chip` + reason sentence, same tones (`neutral` / `warning`) | `exact` | `DemoSettings.tsx:692-697` vs `settings.tsx:596-608` |
| UF-SET-36 | page | which capabilities and which workflows | 13 capabilities × 15 workflows | 6 capabilities × 7 workflows | `state-only` | descriptor-derived on both sides |

### 2f. Keyboard

| id | region | element | demo | current | class | evidence |
|---|---|---|---|---|---|---|
| UF-SET-37 | Help | `Keyboard` section reachable from Settings | present, the grouped legend + a `When they fire` list | present | `exact` | `settings-keyboard-1440-{demo,current}.png`; **D274 item 5** ratified "Settings takeover with Help→Keyboard" |
| UF-SET-38 | top bar | the STANDALONE shortcuts popover | `DemoShortcutsPopover` is defined (`DemoTopBarSurfaces.tsx:121-154`) and **has zero callers** — `?` opens nothing in the demo either | `ShortcutsPopover` is exported (`top-bar.tsx:912+`) and **has zero callers** | `ruled` | A62 (`fidelity-1:118`) — `exact`: "stays exported and unmounted, whole, for Settings → Help". Both apps are identically unwired; SE43/SE44 (`fidelity-3:841-842`) recorded the entry-point question and D274 item 5 answered it by routing Help → Keyboard |

---

## 3. Archive

Screenshots: `ui-fidelity-audit/archive-1440-demo.png` · `…-current.png`

| id | region | element | demo | current | class | evidence |
|---|---|---|---|---|---|---|
| UF-AR-1 | header | title + icon + `read-only` pill + `Back to the dashboard` | present | byte-identical | `exact` | screenshot pair |
| UF-AR-2 | header | tabs `Archived runs` / `Versions & bumps` | present, first active | identical | `exact` | screenshot pair; `dashboard-app.tsx:1450` |
| UF-AR-3 | container | takeover geometry | full-bleed page under the top bar | inset card, same 12px gutters as UF-SET-1 | `takeover` | same conversion as UF-SET-1 — demo container `RebuildDemo.tsx:658-665`, current `dashboard-app.tsx:1439-1456` (`ArchivePage`). Ratified by D275 item 2 (one shared takeover wrapper) |
| UF-AR-4 | filters | search placeholder | `Name, EID, trace, confirmation…` | `Title, trace, workflow…` | `ruled` | AR22 (`fidelity-3:84`) — `unserved: ArchiveEntryWire has no eid or confirmation field` |
| UF-AR-5 | filters | the three dropdowns (workflow / outcome / instance) | present | present, same order | `exact` | screenshot pair |
| UF-AR-6 | list | populated rows vs `The archive is empty` | 820 of 820 rows | 0 of 0 + the honest empty state naming the MAJOR-bump precondition | `state-only` | D272 item 9 (honest empty states with visible reasons) |
| UF-AR-7 | right panel | run detail vs `Nothing selected` | populated | `Pick an archived run on the left to see its stored snapshot.` | `state-only` | follows UF-AR-6 |
| UF-AR-8 | top bar | nav segment | `Archive` pressed, `Dashboard` NOT pressed | identical | `exact` | `dashboard-app.tsx:1261-1262` maps `archive` correctly — this is the arm UF-SET-2's `settings` case is missing |

---

## 4. Explorer

Screenshots: `ui-fidelity-audit/explorer-1440-demo.png` · `…-current.png`

| id | region | element | demo | current | class | evidence |
|---|---|---|---|---|---|---|
| UF-EX-1 | header | title + icon + `read-only` pill + `Back to the dashboard` + `Version registry` link | present | byte-identical structure and strings | `exact` | screenshot pair |
| UF-EX-2 | container | takeover geometry | full-bleed | inset card | `takeover` | demo `RebuildDemo.tsx:666-667`, current `dashboard-app.tsx:1482-1505` (`ExplorerPage`); D275 item 2 |
| UF-EX-3 | left column | `Workflows` + count, grouped by category with run counts | 15 workflows | 7 workflows, same grouping | `state-only` | different registry |
| UF-EX-4 | centre | descriptor graph — run picker, node list with Task/Output/Gate/Write badges | present | present, plus contract chips (code/category/version/shape/enqueue/subject/systems) | `state-only` | the chips are the same served descriptor fields the demo shows differently per descriptor kind |
| UF-EX-5 | centre | `SCENARIOS` block linking `tests/scenario/…` | absent | present (`explorer.tsx:651-664`) | `ruled` | EX60 (`fidelity-3:547`) — `extra`, `ruled: operator-trust §5.2` (source links to scenarios). EX145 (`:632`) rules the per-task scenario chips the same way |
| UF-EX-6 | right column | node detail — badges, FIELD/SYSTEM/RECORDED table | present | present, same table, plus `READS` grouping and override/fresh/from-live tags | `state-only` | descriptor-derived |

---

## 5. Activity

Screenshots: `ui-fidelity-audit/activity-1440-demo.png` · `…-current.png`

| id | region | element | demo | current | class | evidence |
|---|---|---|---|---|---|---|
| UF-AC-1 | header | `Activity report` title + icon | present | byte-identical | `exact` | screenshot pair |
| UF-AC-2 | container | takeover geometry | full-bleed | inset card | `takeover` | demo `RebuildDemo.tsx:668-669`, current `dashboard-app.tsx:1457-1481` (`ActivityPage`); D275 item 2 |
| UF-AC-3 | header right | span control | day pill + `Every day the tracker holds (3)` pill | `From` / `To` date inputs | `ruled` | AC7 + AC8 (`fidelity-3:363-364`) — `ruled: D180`: an unbounded span would need a served `bounds: { earliest, latest }`; the two bounds ARE the ratified control (`activity.tsx:1119-1126`) |
| UF-AC-4 | body | the prior refusal that blocked the populated-body audit | rendered | **rendered on the reconciled 2026-08-27 single-day span**: HTTP 200, 4 stream runs, all 4 present in live authority | `state-only` | **CLOSED 2026-08-27:** populated body audited in UF-AC-5–14, completing D281's ordered U9→U10 receive (`dashboard-surfaces.md:216-219`). The prior refusal was the local stale-schema16 authority split diagnosed in `docs/findings/activity.md` (U9 `9e3a49df`), not a UI divergence. A range reaching 2026-08-12 still correctly refuses; this row does not claim the broad 2026-08-01–2026-08-27 span is reconciled |
| UF-AC-5 | headline | stat-tile strip count and geometry | 5 tiles, x=`25 / 304.6 / 584.2 / 863.8 / 1143.4`, w=`271.6`, h=`100` | 4 tiles, x=`25 / 374.5 / 724 / 1073.5`, w=`341.5`, h=`85` | `ruled` | screenshot pair + demo `DemoActivityReport.tsx:147-189` (`grid-cols-5`) vs current `activity.tsx:806-873` (`grid-cols-4`). This is the direct geometric consequence of D239 dropping the fifth tile, not a separate fix (`frontend-backend-integration.md:1685-1704`) |
| UF-AC-6 | headline | `Runs` tile and its secondary axis | `55` · `110 distinct people touched` | `4` · `1 day with runs in this span` | `state-only` | fixture/range values differ. The absent people axis is the OPEN backend record **Distinct people touched is not served** in `docs/findings/activity.md`, not frontend fix-now work; demo `DemoActivityReport.tsx:114,147-148`, current `activity.tsx:48-57,806-811` |
| UF-AC-7 | headline | `Finished` tile | `23` · `16 read back · 7 with warnings` | `1` · `0 read back · 1 with warnings` | `state-only` | same completion split over different report data; demo `DemoActivityReport.tsx:149-153`, current `activity.tsx:812-843` |
| UF-AC-8 | headline | `Still open` tile | `19`, warning arm, `counted in neither the error rate nor hours saved` | `0`, default arm, `nothing in this span is still open` | `state-only` | the conditional zero/non-zero arms are state-driven; demo `DemoActivityReport.tsx:154-175`, current `activity.tsx:845-865`. D239's removal of the hours-saved axis is dispositioned once in UF-AC-10 |
| UF-AC-9 | headline | `Error rate` tile | `27.8%` · `10 failed of 36 terminal runs` | `75%` · `3 failed of 4 terminal runs` | `state-only` | same numerator/terminal-denominator presentation over different data; demo `DemoActivityReport.tsx:176-181`, current `activity.tsx:795-799,867-872` |
| UF-AC-10 | headline | `Hours saved` tile | `≈ 3.5`, `estimate`, and operator-minutes provenance | absent | `ruled` | demo `DemoActivityReport.tsx:182-188`; **D239 drops this tile as a decision, not a deferral**, because the demo's `MANUAL_MINUTES` has no measured or durable source (`frontend-backend-integration.md:1685-1704`) |
| UF-AC-11 | body | `STILL OPEN — BY WHAT IT IS WAITING ON` | present with 4 non-zero rows: Review / Write parked / Running / Queued | omitted because this span has 0 open runs | `state-only` | both implementations omit the block at zero rather than draw an empty outstanding table; demo `DemoActivityReport.tsx:191-210`, current `activity.tsx:747-785` |
| UF-AC-12 | body | `BY WORKFLOW` population | 8 categories / 15 workflows | 1 category / 1 workflow | `state-only` | both are category-grouped renderings of their report data; screenshot/snapshot pair + demo `DemoActivityReport.tsx:212-232`, current `activity.tsx:489-567` |
| UF-AC-13 | `BY WORKFLOW` | `Unread` column | absent | present between `Warnings` and `Failed`; this reconciled span reads `0` | `new-in-current` | current `activity.tsx:41-44,440-459,470-478,543-552` explicitly calls the axis NEW; demo headers at `DemoActivityReport.tsx:217-226` have no counterpart. **UNRESOLVED:** carry to the operator/next sheet; do not remove it or build it further in this audit |
| UF-AC-14 | `BY WORKFLOW` | `Est. min saved` column | present, including category subtotals | absent | `ruled` | demo `DemoActivityReport.tsx:217-230`; current `activity.tsx:473-487,543-552`; D239 deliberately leaves `ActivityWorkflowTotal` without `minutesPerRun` (`frontend-backend-integration.md:1685-1704`) |

---

## 6. Notifications drawer

Screenshots: `ui-fidelity-audit/notifications-1440-demo.png` · `…-current.png`

| id | region | element | demo | current | class | evidence |
|---|---|---|---|---|---|---|
| UF-NT-1 | presentation | right-side overlay drawer, ~460px, full height, page dimmed | present | identical presentation | `exact` | screenshot pair; A43–A47 `exact` |
| UF-NT-2 | header | title + subtitle template + close | `N unread · pings are silent · a record survives a failed desktop delivery` | **byte-identical template** | `exact` | screenshot pair |
| UF-NT-3 | filters | 5 chips All / Unread / Pings / Inbox / Snoozed | present | identical set and labels | `exact` | A48 (`fidelity-1:104`) rules only the COUNTS reading zero — `ruled: prior audit R1` |
| UF-NT-4 | body | populated cards vs `Nothing under this filter` | populated | the empty state, naming that a zero count never means a deletion | `state-only` | empty day; D272 item 9 |
| UF-NT-5 | body | row paragraph + row badge row (`Ping` / `Inbox only` / `+N more like this` / `delivery failed`) | present | absent | `ruled` | A53 + A54 (`fidelity-1:109-110`) — `ruled: ref dashboard-surfaces §2.6 / D138` |
| UF-NT-6 | body | link-button word, `Snooze 1h` / `Un-snooze` | demo wording | rebuild wording | `ruled` | A55 (`ruled: D262`) and A57 (`ruled: prior audit R1`) |
| UF-NT-7 | footer | the durable-record footnote | present | **byte-identical text** | `exact` | screenshot pair |
| UF-NT-8 | toast | the PING toast on arrival | present | absent | `ruled` | A58 (`fidelity-1:114`) — `ruled: D138`; delivery is an OS notification the server attempts after the durable row commits |
| UF-NT-9 | body | a refused command reported in the drawer | absent | present | `ruled` | A51 (`fidelity-1:107`) — `extra`, `ruled: prior audit R1` |

---

## 7. Search dialog

Screenshots: `ui-fidelity-audit/search-1440-demo.png` · `…-current.png`

| id | region | element | demo | current | class | evidence |
|---|---|---|---|---|---|---|
| UF-SR-1 | presentation | centred modal over a dimmed page, ~1060–1080px | present | present, same dialog pattern | `exact` | screenshot pair; D273 item 3 ratified the demo search geometry |
| UF-SR-2 | title | dialog title | `Search runs` | `Search this day` | `ruled` | A10 / D184 — the same day-scoping ruling as UF-SH-16 |
| UF-SR-3 | subtitle + placeholder | scope sentence and example string | across every day the tracker holds | over the rows this day already served | `ruled` | A10 / D184 |
| UF-SR-4 | body | the `Try:` example-chip row | 6 authored examples (`DemoTopBarSurfaces.tsx:448-455`) | **the row exists** (`day-search.tsx:253-268`) and derives ≤4 chips from the day's own rows — on a 0-row day it has nothing to draw | `ruled` | A15 (`fidelity-1:61`) — `divergent`, `ruled: prior audit R1` (fixture queries would be fabricated data). The raw map's "no Try: row in current" was the empty day, not a missing element |
| UF-SR-5 | body | `Nothing typed yet` empty state | present | present, same icon and title, scope-appropriate description | `exact` | screenshot pair; D273 item 3 (served empty and paging states) |

---

## 8. Start a run

Screenshots: `ui-fidelity-audit/startrun-1440-demo.png` · `…-current.png`

| id | region | element | demo | current | class | evidence |
|---|---|---|---|---|---|---|
| UF-RS-1 | presentation | centred modal, ~1020px, three columns | present | present | `exact` | screenshot pair |
| UF-RS-2 | header | title + subtitle | `Start a run` / *"Pick what to run. It declares what it takes, and the plan says exactly what will exist before anything is enqueued."* | **byte-identical** | `exact` | screenshot pair |
| UF-RS-3 | header | the `1 Input › 2 Plan › 3 Result` stage rail | the demo's rail is the INTAKE's spine (`DemoRunStartKit.tsx:427-477`), not the run modal's | present in the run modal (`run-start.tsx:818`) | `ruled` | C105 (`fidelity-1:673`) — `extra`, `ruled: <plan> R8 f.22` (rebuild-only, cited and kept) |
| UF-RS-4 | left rail | workflow picker grouped by category + filter + `N not startable` | 8 groups | 2 groups, same shape, `5 not startable` | `state-only` | different registry |
| UF-RS-5 | centre | the method tab strip (EIDs / Upload a packet / Photograph the pages) | present (`DemoRunStart.tsx:267-312`) | absent | `ruled` | C24 (`fidelity-1:592`) — `ruled: D251` / ref dashboard-surfaces §9.1 "No method tabs": one method kind, so no tabs IS the demo's own rendering |
| UF-RS-6 | centre | `WHAT THIS WILL CREATE` panel | present (`DemoRunStart.tsx:807`) | **present** (`run-start.tsx:891`) — it holds its empty arm until a plan exists | `exact` | C52 (`fidelity-1:620`) marks it `exact`; the raw map's "demo only" reading was the un-planned state |
| UF-RS-7 | right rail | `SHARED SETTINGS / Run controls`, `01 Queue behaviour`, `02 Destination` | present | byte-identical headers and numbering | `exact` | screenshot pair |
| UF-RS-8 | right rail | Active-run policy control | a dropdown | locked read-only text with a lock glyph | `state-only` | the workflow's own input surface fixes the value; the same renderer draws a dropdown when the descriptor leaves it open (the same rule that draws `keepNonHdh`/`includeCrmDates` locked) |
| UF-RS-9 | right rail | `02 Destination` system dropdowns | 1 (UCPath) | 4 (CRM / KUALI / NEW KRONOS / UCPATH) | `state-only` | one row per system the selected descriptor declares |
| UF-RS-10 | footer | the primary button | `Start run` / `Start dry run` | `Plan the run`, then `Start run` | `ruled` | C102 (`fidelity-1:670`) — `ruled: ref dashboard-surfaces §9.1 / ref frontend-backend-integration §5.1.1`: planning is a server round-trip returning a single-use token, so it is two presses |

---

## 9. Theme

| id | region | element | demo | current | class | evidence |
|---|---|---|---|---|---|---|
| UF-TH-1 | both | the two theme names | `Graphite Warm` (dark) / `Paper Ink` (light); the button names the DESTINATION | identical names, identical destination-naming | `exact` | A59 (`fidelity-1:115`) |
| UF-TH-2 | demo | **does the demo's light theme actually render light?** | **YES.** After the toggle: `--ds-surface-1: #ffffff`, `--ds-fg: #0b0f19`, `body` bg `rgb(246,248,250)`, banner bg `rgb(255,255,255)`, `localStorage["rebuild-demo.theme"] = "light"`, and the rendered page is visibly light | n/a | `exact` | `ui-fidelity-audit/settings-storage-light-1440-demo.png` — a fully light demo page. **U1a's raw "the demo's light theme renders dark" finding is REFUTED**: it was a stale/mis-timed capture, not a demo bug. Paper Ink IS a real reference and the light theme is a legitimate fidelity target |
| UF-TH-3 | current | light theme | | `--ds-surface-1: #ffffff`, body `rgb(246,248,250)` — the same computed values | `exact` | `ui-fidelity-audit/settings-storage-light-1440-current.png` |
| UF-TH-4 | both | `documentElement.className` after switching to light | stays the stale string `"dark"`; `data-theme` is `null` | identical stale `"dark"`, `data-theme` `null` | `exact` | both apps carry the same class-name staleness, so it is not a fidelity divergence. Recorded in Notes as a shared latent defect |

---

## Summary A — `takeover` rows (U2)

The conversion is one change applied to one shared wrapper, not four. The demo's containers: the switch at
**`RebuildDemo.tsx:656-678`** (`settings` → `DemoSettingsPage`, `archive` → `DemoArchivePage`, `explorer` →
`DemoExplorerPage`, `report` → `DemoActivityReportPage`) and Settings' own root at
**`DemoSettings.tsx:1071-1075`** (`<div className="flex min-h-0 flex-1">` + a `w-[220px]` nav). All four are
full-bleed under the top bar: **x=0, w=viewport, no card, no radius, no gutter**.

| id | current component | current file:line | what changes | landed |
|---|---|---|---|---|
| UF-SET-1 | `SettingsPage` (a `Panel`) inside the takeover arm | `app/dashboard-app.tsx:1394-1402` (the `px-[--ds-shell-inset] pb-[--ds-space-base]` wrapper) + `surfaces/settings.tsx:901-935` (the `Panel` root) | drop the gutter + the card frame; keep `D275 item 2`'s shared a11y/motion wrapper | `ab67408f` (+ `5dc014f9` focus-on-enter) |
| UF-SET-4 | the 220px nav inside it | `surfaces/settings.tsx:937-941` | nothing of its own — it moves with UF-SET-1 | `ab67408f` (+ `5dc014f9` focus-on-enter) |
| UF-SET-5 | the same at 2000px | as above | full-bleed at every width | `ab67408f` (+ `5dc014f9` focus-on-enter) |
| UF-AR-3 | `ArchivePage` | `app/dashboard-app.tsx:1439-1456` | same wrapper change | `ab67408f` (+ `5dc014f9` focus-on-enter) |
| UF-EX-2 | `ExplorerPage` | `app/dashboard-app.tsx:1482-1505` | same wrapper change | `ab67408f` (+ `5dc014f9` focus-on-enter) |
| UF-AC-2 | `ActivityPage` | `app/dashboard-app.tsx:1457-1481` | same wrapper change | `ab67408f` (+ `5dc014f9` focus-on-enter) |

Ratified by **D272 item 1** and **D274 item 5** (Settings is the demo's full-page takeover) and constrained by
**D275 item 2** (one shared takeover wrapper). The ROUTE half already landed — none of these is a `Dialog`, and
`[role=dialog]` is absent from all four; only the geometry is outstanding.

## Summary B — `fix-now` rows (U2/U3), grouped by seam

**Seam 1 — the shell's view state (1 row, `src/dashboard/app/` + `src/dashboard/surfaces/`)**

| id | fix | file:line | landed |
|---|---|---|---|
| UF-SET-2 | a non-switcher takeover must not leave the switcher claiming `Dashboard`. `shellView` falls back to `"queue"` for `settings`, `intake` and `catalog`; it needs an arm that presses nothing | `app/dashboard-app.tsx:1261-1262` (the fallback) · `surfaces/top-bar.tsx:925` (the consumer) | `e1c978f4` |

**Seam 2 — the served settings-section label (1 row, `src/server/`)**

| id | fix | file:line | landed |
|---|---|---|---|
| UF-SET-9 | the served label reads `Storage`; the page it opens is titled `Storage health` | `src/server/dashboard/queries/bootstrap.ts:154` | `7975e209` |

**Seam 3 — the System hosts section (3 rows, `src/dashboard/surfaces/settings.tsx` + the `systemHosts` wire)**

| id | fix | file:line | landed |
|---|---|---|---|
| UF-SET-22 | subtitle copy | `surfaces/settings.tsx:508` | `6db7e75f` (+ `a656c75c` verbatim onbase/i9, + `a01c6bf0` URL clip) |
| UF-SET-25 | the SYSTEM column prints the raw wire id, not a display name (needs a `label` on the served shape) | `surfaces/settings.tsx:538` + the `systemHosts` wire | `6db7e75f` (+ `a656c75c` verbatim onbase/i9, + `a01c6bf0` URL clip) |
| UF-SET-26 | no per-system explanatory sentence (the demo authors these as client constants) | `surfaces/settings.tsx:534-560` | `6db7e75f` (+ `a656c75c` verbatim onbase/i9, + `a01c6bf0` URL clip) |

**Seam 4 — the Workflow capabilities section (1 row, `src/dashboard/surfaces/settings.tsx`)**

| id | fix | file:line | landed |
|---|---|---|---|
| UF-SET-31 | subtitle copy | `surfaces/settings.tsx:~630` (the `CapabilitiesSection` `PanelHeader`) | `6db7e75f` (+ `a656c75c` verbatim onbase/i9, + `a01c6bf0` URL clip) |

Six `fix-now` rows across four seams — comfortably one unit; no split needed. Seam 2 is the only one that leaves
`src/dashboard/`.

## Summary C — `new-in-current` rows (operator sheets)

Neither built further nor removed. Each needs a numbered "where do you want this?" item.

**U10 adds UF-AC-13 below. It is unresolved and belongs on the next operator sheet; this audit makes
no product decision about it.**

**UF-SH-10 and UF-SH-11 are reclassed `ruled` in §1 above (2026-08-27, run UI-1 — D275 item 1) and are kept
in this table only because the two-doors-to-one-place shape D275 item 1 ratified is still worth a
confirm-or-revisit question, not because either is open on the merits.**

| id | element | where it lives | precise description |
|---|---|---|---|
| UF-SH-10 | `Workflow explorer` toolbar button | `app/dashboard-app.tsx:1613` | A 129px secondary button in the queue toolbar's left group, between `Import spreadsheet` and `UI catalog`, with no `title` and no icon-only variant. It opens the same Explorer takeover the top bar's `Explorer` segment opens, so the surface has two doors. The demo has one (the segment). **Ruled by D275.1; kept on the sheet as confirm-or-revisit** — sheet item 1, recommendation A (keep). |
| UF-SH-11 | `UI catalog` toolbar button | `app/dashboard-app.tsx:1621` | An 88px secondary button in the same group, opening `surfaces/ui-catalog.tsx` (the generated catalog, D177). **CA41 records that the operator removed this glyph from the top bar on 2026-08-14 (`8f55a168`), leaving `?catalog=` as the only route** — a control has since reappeared in a different place. The question is whether the 08-14 decision still stands. **Ruled by D275.1; kept on the sheet as confirm-or-revisit** — sheet item 2, recommendation A (keep). |
| UF-SET-24 | the System-hosts banner's first sentence | `surfaces/settings.tsx:517-521` | *"A run envelope carries the instance per system and defaults to production; a start that asks for test is refused outright unless a distinct test host is configured, never quietly sent to production."* — a true statement about a refusal this build has and the demo's runtime does not. Keep (the fact is real and load-bearing) or trim to the demo's shorter framing? |
| UF-SET-28 | the `provisioned identical to production — refused` host arm | `surfaces/settings.tsx:546-552` | A danger-toned third arm in the TEST column, between `provisioned` and `none provisioned`, for a host configured but byte-equal to production — which `resolveSystemEntryUrl` refuses at run time. The demo has two arms. Unreachable on the current estate (all 9 read `none provisioned`). |
| UF-SET-33 | the Workflow-capabilities banner's trailing clause | `surfaces/settings.tsx:~640` | *"These six are what a descriptor declares; a seventh appears when a descriptor grows one, never before."* — one added sentence naming this build's capability count. |
| UF-AC-13 | Activity `BY WORKFLOW` table's `Unread` column | `surfaces/activity.tsx:440-459,470-478,543-552` | A current-only warning-evidence axis between `Warnings` and `Failed`. It distinguishes a finished run whose derived evidence receipt has not been read from one that was read back clean; the demo fixture has no corresponding column. **Unresolved operator question for the next sheet:** whether this honest current-only axis stays in this table or belongs elsewhere. U10 neither removes nor extends it. |

## Follow-ups — opened by the U2 conversion, not fixed by it

Not a class and not a fix. This is a row a LATER ruling has to reach; it is recorded here so the next pass does
not re-derive it, and it is **not counted** in the Counts table below (which is counted over the ten surface
tables only).

| id | element | where it lives | precise description |
|---|---|---|---|
| UF-FU-1 | the intake workspace and the UI catalog still hand-roll the takeover wrapper | `app/dashboard-app.tsx` — the `intake` arm and the `catalog` arm, each still a `flex min-h-0 flex-1 px-[--ds-shell-inset] pb-[--ds-space-base]` div — plus `surfaces/intake.tsx` and `surfaces/ui-catalog.tsx`, whose roots are still `Panel`s | U2 converted the FOUR demo-covered takeovers to the shared `TakeoverFrame`. The wrapper was duplicated **six** times; these are the other two, left alone deliberately — the demo covers neither surface, so neither has a ruled geometry target, and converting them would have been an unruled change wearing a refactor's clothes. The consequence is now visible: they render as inset cards in a 12px gutter while the other four are full-bleed, and they still carry their own copy of the arrival (`Panel` + `useDsEnterTransition` + the two `data-[demo-enter=from]:` classes) — the drift `TakeoverFrame` exists to end, surviving in two places. **`new-in-current`-adjacent**: both elements are real and in use; neither is to be built further nor removed until the operator rules. U4a widened the gap by giving `TakeoverFrame` its focus-on-enter contract, so these two are now the only takeovers that do NOT move focus when they open — an accessibility difference, not only a geometric one. Closing it is one substitution per arm the moment a ruling exists. |
| UF-FU-2 | `StorageBanner` keeps its 12px shell inset above an x=0 takeover, while the demo's own band is full-bleed | `app/dashboard-app.tsx` (the `StorageBanner` mount, above the `shellView` switch — recorded there per U4a's `d0dbc272`) — demo `RebuildDemo.tsx:654` | The demo mounts its degraded-storage band above the shellView switch too, and the demo's band IS full-bleed (`x=0`). The current keeps a `mx-[--ds-shell-inset]` margin above the SAME point, so the band is a 12px-inset rounded card sitting over a full-bleed takeover beneath it — not "the demo has no such state," but a real geometric mismatch. It is deliberately unfixed: the band is the shared `Banner` primitive (a rounded, four-side-bordered card) that **D276 item 4** kept rather than reverting to the demo's hand-rolled div, and dropping only the margin would leave a rounded card flush against both viewport edges — the full match is a `Banner` SHAPE change that also moves the queue view, and no audit row rules it. Unruled; sheet item 7. |

## Gaps — what could not be settled, and why

G1 is retained below as closed audit history. G2 remains the only demo-covered populated surface this audit did
not newly reach; G3–G5 keep their earlier dispositions.

| # | gap | why | what would close it |
|---|---|---|---|
| G1 | **CLOSED 2026-08-27 — Activity's populated body** | 2026-08-27 is reconciled: its 4 stream runs all resolve in live authority and the single-day report returns HTTP 200. The prior refusal was a local stale-schema16 split diagnosed in `docs/findings/activity.md` / U9 `9e3a49df` | closed by the final 1440×900 current/demo captures and UF-AC-5–14. The older 2026-08-01–2026-08-27 range is **not** claimed fixed: any range reaching the orphan on 2026-08-12 still correctly refuses |
| G2 | **the run-OPEN centre and right column** (progress stepper, People/Logs/Receipt tabs, the `Run data` aside, DELEGATION) | the current serves 0 rows on 2026-08-27, so no run can be opened. The demo's own no-run state WAS reached and compared (UF-SH-22) | a day with rows, or the parity lane's fixtures. The three `fidelity-2` run-detail ledger rows (`-2-run-detail.md`, R-rows) already cover this surface and were not re-derived here |
| G3 | **a standalone keyboard-help overlay** | it does not exist in either app: `DemoShortcutsPopover` (`DemoTopBarSurfaces.tsx:121-154`) and `ShortcutsPopover` (`top-bar.tsx:912+`) both have zero callers, and `?` opens nothing in either. Settled as UF-SET-38 `ruled` (A62 `exact`) rather than left open | nothing — the gap is symmetric and already ruled |
| G4 | **the demo's Preflight / Demo-surfaces popovers' contents** | both icons are demo-only and already ruled absent (UF-SH-13/14), so their panels have no current counterpart to diff | nothing |
| G5 | **stale ledger row SE40** | `fidelity-3:827` still records `System hosts` as `missing / OPEN — operator call`; D274 item 6 ruled it and the section has landed (UF-SET-21). Same for SE43/SE44 vs D274 item 5 | a ledger disposition pass — U5's ledger-update scope |

## Counts

| class | rows |
|---|---|
| `exact` | 43 |
| `state-only` | 24 |
| `ruled` | 39 |
| `fix-now` | 6 |
| `takeover` | 6 |
| `new-in-current` | 4 |
| **total** | **122** |

Counted mechanically over the ten surface tables (Summaries A–C re-list ids already classed above and are not
counted twice): every row carries exactly one of the six classes, and no id appears in two surface tables.

**Updated 2026-08-27 (run UI-1):** UF-SH-10 and UF-SH-11 reclassed `new-in-current` → `ruled` (D275 item 1) —
`ruled` 34 → 36, `new-in-current` 5 → 3. The total (112) is unchanged; only the class distribution moved.

**Updated 2026-08-27 (run UI-2 U10):** the reconciled-day Activity follow-up adds UF-AC-5–14 — six
`state-only`, three `ruled`, and one unresolved `new-in-current` row. No `fix-now` row was found. Total 112 → 122.

## Notes

1. **Three of the coordinator's six eyeball candidates are refuted by measurement, and the refutations matter more
   than the confirmations.** The top bar is 44px in both, from the same `--ds-h-topbar` token; the demo's own
   no-run-open state has no right column; and neither app caps its content width at 2000px. The perceived
   "taller top bar" is the D224-ruled toolbar card (13px of gutter + margin), which is a ratified decision, not a
   regression.
2. **The other three are confirmed and each already has a home:** the nav's double-pressed state is the one
   genuinely new defect (UF-SET-2), `Storage` vs `Storage health` is a one-word server fix (UF-SET-9), and the
   sessions bar's `+` is D249-blocked on two named runtime facts (UF-SH-26).
3. **`aria-pressed` on `Dashboard` is a silent-fallback bug, not only a visual one.** `shellView`'s
   `… : "queue"` at `dashboard-app.tsx:1262` substitutes a plausible-but-wrong value for three takeovers rather
   than saying "no segment applies" — the shape the root `CLAUDE.md` fail-loud rule warns about, expressed in the
   view layer.
4. **`UF-SET-34` is the row most likely to be mis-classed by a later pass.** The capability cell's `Yes` chip
   looks like a fidelity drift; it is a ratified reversal (D272 items 8–9) with the reasoning written into
   `settings.tsx:578-592`. Do not "fix" it.
5. **Both apps leave `documentElement.className` reading `"dark"` after switching to light** (UF-TH-4), and
   neither sets `data-theme`. Because it is identical on both sides it is not a fidelity row — but it is a
   latent defect any theme-aware CSS added later will trip over.
6. **The demo renders its floating Workflow Panel as a `[role=dialog]` at x=12 w=200, exactly as the current
   does** (UF-SH-23). U1a's raw map read this as current-only; it is not.
7. **Ledger hygiene for U5:** SE40 (System hosts), SE43/SE44 (Keyboard entry point) and A65/SE1 (takeover vs
   dialog) all still read `missing` or `OPEN — operator call` while D274 items 5–6 and D272 item 1 have since
   ruled them. `dashboard-surfaces.md` §10 is headed **D272–D276** — there is no D271, despite the handoff's
   "D271–D276".
