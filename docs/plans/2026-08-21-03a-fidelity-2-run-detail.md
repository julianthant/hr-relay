# 03a demo-fidelity audit — group 2: THE RUN DETAIL

**Date:** 2026-08-21 · **Kind:** audit ledger (read-only — this pass edits no surface, no doc, no wire)
**Branch:** `feature/docs-fid-2` · **Supersedes for these regions:** the R5/R6/R8 sections of
`docs/plans/2026-08-13-detail-fidelity-audit.md` (that wave is closed; this is the RE-AUDIT at HEAD)

## The standard this ledger is written against

The dashboard is to be a **1:1 detail replica of the legacy rebuild-demo**. The operator reviews it
glyph by glyph and has rejected two "it matches" claims on sight. So every element on the surfaces
below is enumerated, and every one of them is either

- **exact** — copied, including the classes, the glyph, the words and the conditional arms; or
- a **recorded divergence** with a reason that CITES something: a `D###`, a plan decision, or a
  dated operator call; or
- an **absence attributed to a named missing producer** (`unserved:`), which is a `builds:` item for
  the backend and never a reason to drop the detail; or
- **`OPEN — operator call`**, which is this ledger admitting the tree diverges and nothing in the
  repository says why.

Nothing is "dismissed as minor". An element with no citation is OPEN even when the divergence looks
defensible — that judgement is the operator's, not this pass's.

## Oracle and evidence

| What | Where |
|---|---|
| demo source (the spec) | `/Users/julianhein/Projects/hr-automation/src/dashboard/components/dev/rebuild-demo/` (read-only) |
| rebuild source | `src/dashboard/surfaces/**` + `src/dashboard/app/**` at HEAD of `feature/docs-fid-2` |
| rebuild pixels | `tests/parity/references/run-*.png`, read AS IMAGES at 1440×900 — the corpus is CURRENT (last re-freeze `81287bb1`, "every drift mapped to a ratified decision (D226–D261)", which post-dates every surface commit in this audit's scope) |
| baseline | `docs/plans/2026-08-13-detail-fidelity-audit.md` §R5 (run-detail header), §R6 (context rail), §R8 (park/resolve + confirm) |

**What the baseline did NOT cover, and this pass adds.** R5 audited only the log panel's HEAD BLOCK
(37 elements) and named `DemoLogPanel.tsx` as its oracle. It never opened `DemoRunIdentity.tsx`,
`DemoEvidence.tsx`, `DemoReceipt.tsx` or `DemoFailure.tsx`, and it explicitly assigned the log
STREAM to "the log-stream region", which no region ever claimed. Four of this ledger's six regions
are therefore first audits, not re-audits.

## Verdict / reason vocabulary

`exact` · `divergent` · `missing` (in the demo, absent here) · `extra` (here, absent in the demo).
Reason for any non-`exact` row is exactly one of:

- `ruled: D### / <plan> §x / operator <date>` — the divergence is on record with its argument;
- `unserved: <wire gap>` — the element cannot be drawn because a named producer does not exist;
- `OPEN — operator call`.

---

## R-A — Run identity: the provenance bar, the run selector, the rename

**Demo:** `DemoRunIdentity.tsx` (448 lines, whole file).
**Rebuild:** `src/dashboard/surfaces/run-identity.tsx` + `run-identity-model.ts`; mounted on the log
stream's floor bar at `src/dashboard/surfaces/log-panel.tsx:1196`; the rename dialog is mounted at
`src/dashboard/app/dashboard-app.tsx:1387`.

**FIRST AUDIT** — the 2026-08-13 wave never enumerated this file.

| # | Element | Demo | Rebuild | Verdict | Reason |
|---|---|---|---|---|---|
| A1 | bar wrapper `flex min-w-0 shrink-0 items-center gap-[--ds-space-snug]` | `DemoRunIdentity.tsx:93` | `run-identity.tsx:113` | exact | |
| A2 | workflow-version tag VALUE (`v3.1` from `fmtVersionTag`) → 8-char descriptor-fingerprint prefix | `:88,107` | `:98,129` + `run-identity-model.ts:11-16` | divergent | `ruled: port rule-(c)`, stated `run-identity.tsx:10-15` — `workflowVersion`/`workflowMinorVersion` are fixture-only; the wire's name for a run's shape is `descriptorHash` |
| A3 | the literal `wf ` noun in front of the tag | (none — demo prints the bare `v3.1`) | `:129` | extra | **OPEN — operator call** (a bare 8-hex string needs a noun where `v3.1` did not; nothing records the addition) |
| A4 | tag title, CURRENT arm | `:98` | `:120` | divergent | `ruled:` A2 |
| A5 | tag title, SHAPE-MOVED arm (verbatim "…a retry would replay retired code.") | `:97` | `:117` | divergent | `ruled:` A2 |
| A6 | tag title, `unserved` arm ("this dashboard serves no … descriptor at all") | (no counterpart) | `:119` | extra | `ruled: D256/D257` (`ed0e1fb3`) — `classifyRunShape` refuses to call an unregistered workflow "moved" |
| A7 | tag tone: waiting-fg on the hazard, muted otherwise | `:100-105` | `:122-127` | exact | |
| A8 | `dry run` chip — `FlaskConical`, the word, the "A rehearsal: it read every system and wrote to none." title | `:111-119` | `:140-151` | exact | |
| A9 | `dry run` chip HUE | `--ds-info-fg` `:114` | `--ds-rehearsal-fg` `:145` | divergent | `ruled: D232`, stated `:133-139` (`info` is the queue row's `test` hue; one fact may not have two colours) |
| A10 | `test` chip — `TriangleAlert`, the word, the "…nothing here reached production." title, waiting-fg | `:120-131` | `:152-163` | exact | |
| A11 | ⓘ trigger `IconButton size="xs" label="Run provenance"` + `Info` | `:135` | `:167` | exact | |
| A12 | `PopoverContent title="Provenance" description={trace} width="lg" side="top" align="end"` | `:137` | `:169` | exact | |
| A13 | KVL `Workflow` value separator | `${label} ${ranVersion}` `:141` | `${label} · ${ranShape}` `:173` | divergent | **OPEN — operator call** (a middot the demo does not draw) |
| A14 | KVL `App build` + the absent arm (`unstamped`, warning tone) | `:142` | `:174-178` | divergent | `ruled: D179` read-forward, stated `:101-106` |
| A15 | KVL `Requested by` | `row.requestedBy` `:143` | `surface.actorId` `:179` | exact | same fact, the wire's name |
| A16 | KVL `Priority` | `:144` | `:188` | exact | |
| A17 | KVL `Named` (conditional on a display name) | `:145` | `:195-197` | exact | |
| A18 | KVL `Config` (short config fingerprint) | (no counterpart) | `:198` | extra | **OPEN — operator call** (a real served fact, but the demo's ⓘ was deliberately trimmed to provenance an operator acts on) |
| A19 | KVL `Attempt` `#N` | (no counterpart) | `:199` | extra | **OPEN — operator call** (R5 f.2 DELETED the header `attempt N` badge on the demo's own argument that the attempt affordance is the rail's `RunSelector`; this puts the fact back in the ⓘ) |
| A20 | KVL resolved-instance rows, warning tone on `test` | `:146-150` | `:200-204` | exact | |
| A21 | bullet — priority, both arms, verbatim | `:155-157` | `:209-211` | exact | |
| A22 | bullet — shape, MOVED arm | `:158-159` | `:212-213` | divergent | `ruled:` A2 |
| A23 | bullet — shape, `unserved` arm | (no counterpart) | `:214-215` | extra | `ruled:` A6 |
| A24 | bullet — shape, CURRENT arm ("The MAJOR digit is the run's shape; the minor is presentation…") | `:160` | `:216` | divergent | `ruled:` A2 — a fingerprint has no major/minor to talk about |
| A25 | bullet — app build, stale + current arms, verbatim | `:161-163` | `:219-221` | exact | |
| A26 | bullet — app build, `unstamped` arm | (no counterpart) | `:217-218` | extra | `ruled: D179` |
| A27 | bullet — named ("…the trace id … is unchanged — history matches either way.") | `:164-166` | `:228-230` | exact | |
| A28 | **preset block** — `SectionLabel` `{source} “{name}” — merged at enqueue` + the 2-column `<dl>` of merged fields | `:169-183` | absent | missing | `unserved:` no descriptor declares `presets`; the choice is recorded nowhere from ingress to span (`docs/findings/queue-rows.md`; the `QueueBaseFields` ledger row, CLOSED 2026-08-19) |
| A29 | **`RunSelector`** — the whole `‹ #2 of 2 ›` strip: `History` glyph, `Attempts` `SectionLabel`, prev/next `IconButton`s, `#n of N`, `StatusBadge`, the attempt summary, the duration, the DERIVED attempt trace and its ` · older` suffix with the two titles | `:208-258` | absent (`context-rail.tsx:1080` records the deviation) | missing | `unserved:` the wire serves the attempt ORDINAL only — no lineage array. On-record substitute: R6 f.18's locked `ContextSection` |
| A30 | **rerun diff** — `What changed since attempt #N` + per-entry `DIFF_TONE` badge (`input`/`replayed`/`correction`/`write proof`), the `w-28` label, the struck prior value, `ArrowRight`, the current value, the note line | `:195-200,260-295` | absent | missing | `unserved:` same row as A29 |
| A31 | `RenameRunDialog` — `Dialog open/onOpenChange` | `:330` | `:277` | exact | |
| A32 | `DialogContent size="sm"` + title arms `Rename this run` / `Name this run` | `:332` | `:324` | exact | |
| A33 | body REMOUNTED per run via `key` | (no counterpart) | `:284` | extra | `ruled:` stated `:280-283` — a half-typed name may not survive a row change |
| A34 | `Field` label `Name` + `IconButton "What a name does"` with `aria-expanded`, and the "not a Popover" reasoning | `:357-385` | `:326-350` | exact | |
| A35 | `Field error` shown after an attempted send | (no counterpart) | `:354` | extra | **OPEN — operator call** (`renameDraftProblem` is real and the composer re-checks it, but the demo has no error affordance and no decision records adding one) |
| A36 | `Input` value / `autoFocus` / `onChange` | `:387-390` | `:356-359` | exact | |
| A37 | `Input` Enter arm | `if (Enter && trimmed) onConfirm` `:391-393` | `if (Enter) submit()` `:360-362` | divergent | same OPEN as A35 |
| A38 | `Input` placeholder | `row.title \|\| "Friday exception pack"` `:394` | `surface.title` `:363` | divergent | **OPEN — operator call** (`title` is required on the wire so the demo's fallback is unreachable — record the reasoning or restore the string) |
| A39 | rule `Well` + the three bullets, verbatim | `:397-407` | `:366-376` | exact | |
| A40 | `DialogFooter meta={<MetaLine tone="faint">}` | `:426-437` | `:392-403` | exact | |
| A41 | meta item `subject …` | `row.title \|\| "—"` `:433` | `surface.title` `:396` | divergent | same OPEN as A38 |
| A42 | meta item trace id | `:433` | `:397` | exact | |
| A43 | meta item `#N` | unconditional `:434` | conditional on a served `runNumber` `:399` | divergent | `ruled: D230` (schema v15 read-forward), stated `:388-390` |
| A44 | meta item elapsed | `fmtElapsed(row.elapsedSec)` `:434` | `runTiming(surface, nowIso, isTerminalQueueStatus)` `:400` | divergent | `ruled: D124` — a terminal row's duration is `endedAt − startedAt`, never `now −` |
| A45 | footer `Cancel` (secondary) + the "not 'Keep the name it has'" reasoning | `:439-441` | `:405-407` | exact | |
| A46 | footer primary `Save the name` | `:442` | `:408` | exact | |
| A47 | primary disabled predicate (+ a `title` carrying the problem) | `!trimmed` `:442` | `problem !== undefined` + `title` `:408` | divergent | same OPEN as A35 |
| A48 | bar MOUNT: floor bar, right side, after an `h-[--ds-h-xs] w-px` divider | `DemoLogPanel.tsx:1181-1182` | `log-panel.tsx:1195-1201` | exact | |
| A49 | the trailing live/idle dot after the bar (`bg-success` while running, `bg-muted-foreground/40` otherwise) | `DemoLogPanel.tsx:1183` | absent | missing | **OPEN — operator call** (`surface.status` is in hand two lines above, at `log-panel.tsx:1191`) |

**R-A counts — 49 elements: 23 exact · 14 divergent · 4 missing · 8 extra.**
**Since 08-14:** the whole region is new to the ledger. Three things moved at HEAD after the wave:
the `dry run` chip landed (D232), the rename dialog + the `Priority` row landed (D233), and the
shape hazard stopped firing on every run (D256/D257, `ed0e1fb3` — before it, the run's one-workflow
fingerprint was compared against the bootstrap's whole-SET hash, so the amber tag was permanent).

**OPEN in R-A (7 questions):** A3 the `wf ` noun · A13 the `·` separator · A18 the `Config` row ·
A19 the `Attempt` row · A35/A37/A47 the rename error affordance · A38/A41 the placeholder and
`subject` fallbacks · A49 the live/idle dot.

---

## R-B — The log panel: region, header band, outcome bar, tabs, timeline, stream, inline records

**Demo:** `DemoLogPanel.tsx` (2757 lines).
**Rebuild:** `src/dashboard/surfaces/log-panel.tsx` (2051) + `log-panel-model.ts` (72).

**PARTIAL re-audit.** R5 enumerated 37 elements of the HEADER BLOCK only and closed all 17 of its
findings. The timeline, the stream, the inline records and the floating notices were assigned to a
"log-stream region" that no region of the 08-13 wave ever claimed, so everything below R-B/B36 is a
first audit. R5's own 17 findings are re-checked at HEAD and appear inline (B12, B15/16, B19, B20,
B21, B23, B25, B26, B30, B32, B63, B90, B105, B111).

### B-shell — `PanelRegion`

| # | Element | Demo | Rebuild | Verdict | Reason |
|---|---|---|---|---|---|
| B1 | region wrapper: stacked scroller below the threshold, grid above, three rail-width arms (collapsed / dataExpanded / default) | `:2235-2251` | `:1736-1762` | divergent | `ruled: R5 f.16` + `ref dashboard-surfaces §Shell` — the viewport queries `min-[1280px]`/`min-[1480px]` became container queries `@min-[868px]/detail`/`@min-[1068px]/detail`; decision-cited, test-pinned, renders identically |
| B2 | `w-full` on that wrapper | (implicit — the demo's parent is a grid cell) | `:1754` | extra | `ruled: D187` — without it the grid resolved to `2px 376px` and the whole panel was a sliver |
| B3 | the separate `@container/detail` DECLARATION wrapper | (no counterpart) | `:1735` | extra | `ruled:` B1 — a container query cannot style its own container |
| B4 | `Run shape` section: `min-w-0 shrink-0 border`, surface-1, `dsRadius.lg`, col-span arms, deliberately NOT `overflow-hidden` | `:2253-2272` | `:1765-1777` | exact | |
| B5 | the gate that draws it | `steps.length > 0 \|\| sharedMemberPipeline(row)` `:2233` | `detail.timeline.events.length > 0` `:1764` | divergent | `unserved:` there is no shared member pipeline to test for (B63) |
| B6 | `Run detail` section: `@container relative flex min-h-[24rem] min-w-0 flex-col overflow-hidden` + border/radius, `relative` for the notice anchor | `:2274-2292` | `:1779-1791` | exact | |
| B7 | spine-or-rail branch with the same col/row placement arms | `:2294-2318` | `:2000-2024` | exact | arms remapped per B1 |
| B8 | the MEASURED JS half deciding spine-vs-rail (`containerType` + `getBoundingClientRect`) | (demo reads `useContextRail()` alone) | `:1668-1687` | extra | `ruled:` `ref dashboard-surfaces §Shell`, stated `:1644-1667` — which component MOUNTS is not a decision CSS can make |

### B-head — identity band, outcome bar, tabs

| # | Element | Demo | Rebuild | Verdict | Reason |
|---|---|---|---|---|---|
| B9 | ONE scroller with a sticky head; `--ds-panel-head-h` published by a `ResizeObserver` on the head | `:2485-2489,2442-2451` | `:1793-1797,1586-1601` | exact | |
| B10 | identity band: `flex flex-wrap items-center border-b` + subtle border + `gap-x-base/gap-y-tight px-cozy py-base` | `:2496-2505` | `:1815-1820` | exact | |
| B11 | title span: `dsText.title`, `dsText.flush`, `min-w-0 max-w-full break-words font-semibold` | `:2507-2509` | `:1822-1830` | exact | |
| B12 | NO status chip and NO `attempt N` badge on this line — the operator's "avoid redundancy" | `:2510-2526` | `:1798-1814` | exact | R5 f.1/f.2, deletion ported WITH its reason |
| B13 | the `ml-auto` group carrying ⓘ + trace, dropping under at natural length | `:2534-2537` | `:1831-1846` | exact | |
| B14 | `PanelKindInfo` trigger: `xs` ghost `IconButton`, `Info`, `stopPropagation`, the `data-[state=open]` pair | `:796-806` | `:1383-1392` | exact | |
| B15 | trigger LABEL | `What kind of row and panel this is — ${variantName} in a ${panelName}` `:801` | `What kind of panel this is — ${panelName}` `:1388` | divergent | `ruled: R5 f.11` as-built — the demo's row VARIANT is the demo talking about itself |
| B16 | popover title / description | `title={variantName}` · `Opens in a ${panelName}` `:807` | `title={panelName}` · `PANEL_KIND_EXPLANATION[panelKind]` `:1394` | divergent | `ruled: R5 f.11` as-built (the rebuild's own vocabulary, `:1340-1352`) |
| B17 | popover `MetaLine items={[wfLabel, trace]} tone="faint"` | `:808` | `:1395` | exact | |
| B18 | outcome band geometry: `flex flex-wrap items-center border-b` + `gap-x-base/gap-y-tight px-cozy py-snug` | `:2380-2388` | `:1857-1862` | exact | |
| B19 | the band's TINT | 6-arm `OUTCOME_TONE[row.outcome.tone]` `:2186-2193` | 8-arm `OUTCOME_TONE[DsStatus]` `:1306-1323` | divergent | `ruled: R5 f.3` as-built + the `OutcomeWireSchema text+tone` ledger row (CLOSED 2026-08-20) — keyed off the same `DsStatus` the band's own dot renders, so dot and band physically cannot disagree |
| B20 | the leading dot | hand-rolled `size-1.5 rounded-full` + `tone.dot` `:2389` | `StatusDot status={outcomeStatus}` `:1868` | divergent | `ruled:` DESIGN.md's two-renderers rule, stated `:1864-1867` |
| B21 | the one-sentence "so what" | SERVED `row.outcome.text` `:2390` | DERIVED — `terminalOutcomeText` / `gate.label` / `outcome.reason` `:1622-1627`, `log-panel-model.ts:67-72` | divergent | `ruled: D238` + the same ledger row — an authored sentence is one wire field away from disagreeing with the verdict it describes, which is exactly what D237/D238 fixed |
| B22 | `ml-auto flex min-w-max` group for the age + the action | `:2564` | `:1870` | exact | |
| B23 | the gate age on the bar | `gateAge(row, tick)` `:2565-2569` | `decisionAge(gate.openedAt, nowIso)` behind `gate.state === "open"` `:1877-1881` | exact | R5 f.5; the clock is the SERVED one (`efab4e1` finding 2) so the queue and the panel cannot report two ages |
| B24 | `OutcomeActionButton` with `omitKeys` | `:2570-2574` | `:1882-1887` | exact | |
| B25 | `PANEL_OMITS_OUTCOME_ACTIONS = ["open-park"]` | `:128` | `:1287` | exact | R5 f.6's flip, with the reasoning ported |
| B26 | the settling band (`SettlingPanel` in a `border-b px-3 py-2`) | `:2581-2585` | absent | missing | `ruled: D198` — structurally unreachable; already on the 08-13 ledger as "no action" |
| B27 | tab bar: `role="tablist" aria-label="Run detail sections"`, `dsSize.hBar`, `dsBorder.base`, `gap-tight px-base` | `:2601-2609` | `:1892-1900` | exact | |
| B28 | tab `Tooltip content={`${label} — press ${i+1}`} side="top"` and its "not a native `title`" reasoning | `:2632` | `:1907` | exact | |
| B29 | tab button classes: `relative -mb-px … border-b-2 border-transparent`, `h-[--ds-h-bar] gap-snug px-base`, `dsText.ui`, `dsFocus`, `dsMotion.base`, active = accent underline + semibold | `:2633-2647` | `:1908-1922` | exact | |
| B30 | tab words + glyphs: `People`/`Users`, `Review`/`ClipboardList`, `Logs`/`ScrollText`, `Receipt`/`Receipt` | `:2172-2177` + `demo-wire.ts:2070` | `:169-178` | exact | R5 f.9 (`Receipt`, not `ReceiptText`) |
| B31 | tab ORDER | derived from the served `detailSurfaces`, `people` first in the map | fixed `review, people, logs, receipt` | divergent | `ruled: ref frontend-backend-integration §3.3`, stated `log-panel-model.ts:22-27` |
| B32 | the per-tab attention DOT (`absolute right-hair top-snug size-1.5 rounded-full` waiting hue) | `:2615,2651-2656` | absent | missing | `unserved:` no producer — nothing counts unread notes or unseen receipt content per run (`GateDecisionWireSchema.kind` + tab attention counts, CLOSED 2026-08-20) |
| B33 | NOTHING at the end of the tab bar (the second panel-kind copy, deleted) | `:2661-2667` | `:1930` | exact | deletion ported |
| B34 | `defaultTabFor` arms | four, incl. `review` and the group's attention scan `:149-169` | three `log-panel-model.ts:42-49` | divergent | `unserved:` no `review`/`group` panel kind is produced; `#review`/`#people` are `declared-unserved` (D184) |
| B35 | `UnservedTab` for an advertised-but-unserved section | (no counterpart — the demo serves every tab it draws) | `:1219-1228,1965` | extra | `ruled: D184/D198` declared-absence pattern |

### B-timeline — `Timeline` / `StepStrip`

| # | Element | Demo | Rebuild | Verdict | Reason |
|---|---|---|---|---|---|
| B36 | container `px-cozy py-base` + `flex items-stretch gap-hair` segment row | `:547-548` | `:426,449,326` | exact | |
| B37 | per-segment dot `size-1.5 rounded-full` + tone + `animate-pulse motion-reduce:animate-none` on current/waiting | `:563-570` | `:336-343` / `:458-465` | exact | |
| B38 | per-segment label `dsClip.text dsText.micro` + tone | `:571` | `:344-346` / `:466-468` | exact | |
| B39 | SKIPPED arm: hollow ring, dashed outlined bar, `line-through decoration-1`, and `skipped, did not run: <why>` in the accessible name | (no counterpart — the demo has no `skipped` state) | `:225-229,251-265,344` | extra | `ruled: D123` |
| B40 | REPLAYED arm: verified-done hue, hollow ring, the word `replayed` where a duration would print | (no counterpart) | `:241-248,299-311,370-371` | extra | `ruled: D259` |
| B41 | the segment ELEMENT itself | `<button type="button" onClick={NOOP}>` with `dsFocus`, `dsMotion.base`, `hover:brightness-125` `:574-619` | a non-focusable `<span aria-label=…>` `:348-358`, `:470-480` | divergent | **OPEN — operator call.** The disclosure below it carries `group-focus-within:block` (`:385`) and the rebuild's group now has NO focusable child, so the member disclosure is unreachable by keyboard; the hover tint and the focus ring are gone with the button |
| B42 | three bar shapes — outlined/transparent = not reached · solid = done or working · hatched = stopped on you | `:612-617` | `:354-356` + `:187-190` | exact | |
| B43 | the hatch gradient | `repeating-linear-gradient(45deg, var(--color-warning) 0 4px, transparent 4px 8px)` `:613` | same, `var(--ds-status-waiting-mark)` `:355` | exact | the rebuild's token for the same hue |
| B44 | `opacity-70` on an untimed non-pending segment | `:617` | absent | missing | **OPEN — operator call** (the demo dims a segment it could not measure) |
| B45 | the number under the bar, WAITING arm | `gateAge(row, tick)` — the elapsed age `:629` | `since ${fmtClock(openedAt)}` — a wall clock `:368-369` | divergent | `ruled: D225`, stated `:313-322`. **Noted tension:** the demo's own argument (`DemoLogPanel.tsx:2557-2563`) is that the AGE, not the clock, is the number that decides which of two waiting runs you open first — the rebuild keeps the age on the outcome bar and the clock on the strip |
| B46 | `×N` marker, gated at ≥ 2 | `s.attempts && s.attempts > 1` `:631-633` | `step.executions`, schema `min(2)` (`run-detail.ts:218`) `:376-380` | exact | the gate is in the schema rather than the JSX, which is stronger |
| B47 | hover card: `absolute top-full z-50 mt-1 hidden w-60 … p-2.5 text-left shadow-lg group-hover:block group-focus-within:block` | `:636-641` | `:383-391` | exact | tokenised border/bg |
| B48 | hover-card side anchor rule (`> 2 && i >= n-2` → `right-0`) | `:558,640` | `:332,389` | exact | |
| B49 | hover-card heading (the step label, semibold) | `:643` | `:392` | exact | |
| B50 | hover-card `Status` row | `:644-647` | absent | missing | **OPEN — operator call** (the state is in hand; the rebuild replaced the fact rows with a member list) |
| B51 | hover-card `Waiting` / `Took` rows | `:648-660` | absent (duration appears per MEMBER only) | missing | `ruled: D225` — the card's job became disclosing the category's members; the step's own duration prints under the bar |
| B52 | hover-card `System` row | `:661-666` | absent | missing | `unserved:` nothing serves a system on a timeline step (D252 serves it on a context-data entry's `origin`, which is a different row) |
| B53 | hover-card `Attempts` row | `:667-672` | absent | missing | `ruled: D225` — carried by the `×N` marker and the member list |
| B54 | hover-card `keyLines` block | `:673-679` | absent | missing | `unserved:` no per-step key lines on the wire; the stream carries the notes |
| B55 | hover-card `Step screenshot →` | `:680` | absent | missing | `unserved:` `RunDetailSectionResponseSchema#captures` is `declared-unserved` (D184) |
| B56 | hover-card MEMBER list (label · state · duration · replayed-from) | (no counterpart) | `:393-404` | extra | `ruled: D225` — the grouping must hide nothing |
| B57 | the ORPHAN-GATE trailing segment (a gated run whose steps record no wait) | `:687-705` | absent | missing | **OPEN — operator call.** The demo keeps it precisely so a wait can never vanish because the shape did not line up — "the one thing this timeline may not do" |
| B58 | axis row: `mt-1.5 border-t pt-1` micro/nums muted, start · rule · total | `:711-717` | `:429-441`, `:496-508` | exact | |
| B59 | axis START value | `row.time` `:712` | `fmtClock(first.at)` `:438` | exact | |
| B60 | axis TOTAL | `${fmtElapsed(active)} working` — the SUM of step durations `:714-716` | `${fmtElapsed(totalSec)} elapsed` — the first→last event SPAN `:440` | divergent | **OPEN — operator call.** Two different numbers; the demo's line deliberately names the WORKING half because the segments are equal-width and make no duration claim |
| B61 | axis `· {gateAge} waiting on you` half | `:715` | absent | missing | **OPEN — operator call** (same line; the age is computed 1400 lines away at `:1877`) |
| B62 | the flat EVENT strip (a second timeline for a run the projector did not categorise) | (no counterpart) | `:447-512` | extra | `ruled: D225` read-forward — `timeline.steps` is optional, so a pre-D225 run keeps the per-event strip |
| B63 | `SharedPipelineStrip` (`Shared member pipeline`, `{n} people · identical steps`, per-segment `done/total` fill bars in four flex-grown bands) | `:736-776` | absent | missing | `unserved:` no producer — no registered workflow is `operation`-shaped (member roster/conveyor + shared member pipeline ledger row, CLOSED 2026-08-20) |

### B-stream — `LogsTab`

| # | Element | Demo | Rebuild | Verdict | Reason |
|---|---|---|---|---|---|
| B64 | stream wrapper, no scroller of its own | `pb-2 pt-1` `:1072` | `pb-base pt-tight` `:1101` | exact | |
| B65 | **the stream is GROUPED BY STEP, with a sticky per-step heading** (`sticky top-[var(--ds-panel-head-h,0px)] … text-[11px] font-semibold` + a hairline rule) | `:1060-1065,1082-1085` | absent — one flat list | missing | **OPEN — operator call.** The rebuild publishes `--ds-panel-head-h` (`:1586-1601`) whose stated purpose is *"the log stream's step dividers … land BELOW it"*, and there are no dividers to land. Notes carry `sequence`; the timeline carries per-node steps |
| B66 | line row `flex items-start gap-snug px-cozy pl-5 py-hair` | `:1095` | `:1119-1123` | exact | |
| B67 | line timestamp cell (`mt-hair shrink-0` micro/nums muted) | `:1096` | `:1125-1133` | exact | |
| B68 | line icon cell (`mt-hair w-3.5 shrink-0 text-center`) | `:1097-1099` | `:1134-1136` | exact | |
| B69 | line ICON VOCABULARY | 9-kind `LINE_ICON` — `nav`/`search`/`read`/`write`/`ok`/`error`/`warn`/`pause`/`event`, with the `--ds-read-*` / `--ds-write-*` DIRECTION hues `:190-215` | 3-level `NOTE_ICON` — `info`/`warning`/`error` `:981-985` | divergent | `unserved:` a note carries a `level`, not a kind; nothing records nav/search/read/write/ok/pause/event on a note |
| B70 | line TONE | partial `LINE_TONE` over ok/error/warn, default `text-secondary-foreground` `:228-232,1100` | total `NOTE_TONE` over the three levels `:975-979` | divergent | same as B69 |
| B71 | `pause` line row tint (`bg-info/6`) | `:1095` | absent | missing | same as B69 |
| B72 | per-line `SystemChip` | `:1101` | absent | missing | `unserved:` a note carries no system |
| B73 | per-line read/write `Pill` chips (`ArrowDownToLine`/`ArrowUpFromLine`, `h-[--ds-h-xs]`, read/write token trio, label + `dsText.nums` value) | `:234-258,1103` | absent | missing | `unserved:` a note carries no field/value pairs |
| B74 | per-line `attempt N` badge | `:1104-1106` | absent | missing | `unserved:` a note carries no attempt |
| B75 | per-line duration | `:1107` | absent | missing | `unserved:` a note carries no duration |
| B76 | search dimming `opacity-35` on a non-match | `:1092,1095` | `:1116,1122` | exact | |
| B77 | search hit highlight | `rounded-sm bg-info/15` `:1100` | `dsRadius.xs bg-[--ds-info-bg]` `:1142` | exact | |
| B78 | search PREDICATE | text OR any pill's `label value` `:1046-1048` | `note.message` only `:1049-1050` | divergent | same as B73 — there are no pills to match |
| B79 | empty-stream state | (none — a fixture always has lines) | `EmptyState` "No log lines yet" `:1107-1111` | extra | **OPEN — operator call** (defensible, uncited) |
| B80 | `More lines follow.` | (none — the demo pages nothing) | `:1156-1165` | extra | **OPEN — operator call** (the wire pages via `nextCursor`; the sentence is honest but uncited, and it is not a control) |
| B81 | `live — streaming` pulse line | `:1137-1142` | absent | missing | `ruled:` port rule-(c) — fixture-only (`row.id === "pl-daniel"`) |
| B82 | floor bar `sticky bottom-0 mt-auto flex items-center gap-snug border-t … px-cozy py-snug` | `:1147` | `:1171-1176` (adds `flex-wrap`) | exact | |
| B83 | the search control | raw `<input class="w-40 …">` + an `sr-only <label htmlFor>` `:1148-1157` | the `SearchInput` DS primitive, `aria-label`, an `onClear`, `w-48` `:1178-1185` | divergent | **OPEN — operator call** (DS alignment plus a clear affordance the demo lacks; one width step wider) |
| B84 | `plural(matchCount, "match", "matches")` behind a non-empty query | `:1158-1162` | `:1186-1190` | exact | |
| B85 | the dead `System ▾` control, DELETED | `:1163-1175` | absent | exact | deletion ported |
| B86 | divider + `RunProvenanceBar` on the right | `:1181-1182` | `:1195-1201` | exact | see A48 |
| B87 | the trailing live/idle dot | `:1183` | absent | missing | **OPEN — operator call** — see A49 |

### B-inline — the decision, the records, the floating notice

| # | Element | Demo | Rebuild | Verdict | Reason |
|---|---|---|---|---|---|
| B88 | decision card geometry: `mx-cozy my-base ml-5 border p-cozy`, `dsRadius.lg`, `dsFocus`, `border-[length:--ds-border-w-rail]`, waiting tint | `:377-390` | `:545-556` | exact | |
| B89 | decision anchor: `tabIndex={-1}`, a `data-*` hook, `aria-label="Decision — <title>"` | `:378-381` | `:547-549` | exact | `data-demo-decision` → `data-panel-decision` |
| B90 | decision head icon ARM | `parked ? Pause : identity ? UserRoundSearch : ClipboardList` `:372` | `UserRoundSearch`, unconditional `:560` | divergent | `ruled:` the `GateDecisionWireSchema.kind` ledger row (CLOSED 2026-08-20) — `parked` is not a gate in this tree, and every registered gate is `resolvedBy: "operator"`, so a served enum would have one reachable arm |
| B91 | decision head right-hand text | `open {age} · since {clock}` `:396-398` | `since {clock}` `:572-580` | divergent | **OPEN — operator call.** R5 f.15's as-built records `open {age}` as LANDED; the card shows only the clock while the outcome bar shows only the age, so neither surface carries the demo's pair |
| B92 | decision `note` paragraph (`mt-tight pl-5 leading-relaxed` muted) | `:401-403` | absent | missing | `unserved:` `GateDecisionWireSchema` carries a `label`, no per-gate note |
| B93 | the candidate grid inside the CARD (`CompareGrid rows={5} min="14rem"` + `CandidateCard`: heading / name / identifier / `matched on …` / `See this candidate` \| `No capture — this was never on a page`) | `:268-338,406-418` | absent from the card; the packet renders in `IdentityApproveDialog` | divergent | `ruled: D226` — the ceremony surface renders the packet with the one control the SERVER asked for |
| B94 | the "run is held here" sentence | two arms, the staged one counting writes `:421-425` | the no-staged arm, verbatim `:585-587` | divergent | `unserved:` `staged` is STRUCTURAL, not a wire gap — a `prepare` contract is `checkpoint: "in-memory-only"` (D252's row) |
| B95 | the `gate.staged` block (`ArrowUpFromLine` / `w-32` field / value / `SystemChip` / `staged`\|`unconfirmed` Badge) | `:429-453` | absent | missing | same as B94 |
| B96 | `ParkResolutions` + `BannerActions` inside the decision card | `:455-456` | `BannerActions` only `:588-592` | divergent | `ruled:` same row as B90 — the park is its own record (`InlineParkedWrite`, `park-resolve.tsx:169`) |
| B97 | `CaptureLightbox` opened from a candidate | `:459-467` | absent | missing | `unserved:` `#captures` is `declared-unserved` (D184) |
| B98 | `InlineGateDecisionRecord` — the SETTLED gate's card (verdict tint, `decision` Chip, `Approved by <who>`, the instant) | (no counterpart) | `:617-683` | extra | `ruled: D237` |
| B99 | `InlineParkedWrite` — the parked write's own in-stream record | (the demo folds `parked` into `InlineDecision`) | `park-resolve.tsx:169`, mounted `:1092-1095` | extra | `ruled: ref write-safety §4.1` + the B90 row |
| B100 | `FailureCardView` — the in-stream failure MARKER for a retried step with no record behind it | `:472-486` | absent | missing | `unserved:` there is no `failCard` fact; an `error`-level note is what the stream carries |
| B101 | `InlineFailureRecord` | `DemoFailure.tsx` | `:696-777` + `trust.tsx` | — | audited in full as **R-E** below |
| B102 | notice geometry: tint on an INNER layer, `absolute bottom-cozy left-cozy`, `w-[--ds-w-popover-md]`, `dsLayer.sticky`, `dsMotion.enter` + the `data-[demo-enter=from]` pair, bottom-LEFT so it shares no coordinate with the toast stack | `:884-905` | `:857-870` | exact | the whole independence argument is ported |
| B103 | notice two-line button: icon + truncated title, then `CornerDownRight <verb>` left and `open {age}` right | `:924-948` | `:875-911` | exact | |
| B104 | notice dismiss `IconButton` + "…the decision stays open" | `:949-954` | `:912-917` (label parameterised) | exact | |
| B105 | notice per-kind icon/tone | branched on `gate.kind` `:874-876` | a `tone` prop with two call sites | divergent | `ruled:` B90's row + `ref dashboard-surfaces` (both decisions are named) |
| B106 | a SECOND notice for a parked write (`Pause`, "Go to the parked write", "…the write stays parked") | (no counterpart) | `:1985-1997` | extra | `ruled: ref write-safety §4.1`; `Pause` not `PauseCircle` is R5 f.15 |
| B107 | notice PRECEDENCE — at most one, and the gate wins | (no counterpart) | `:1628-1642` | extra | `ruled:` DESIGN.md — two floating surfaces may not share one corner |
| B108 | `useSeekAnchor` — callback ref, `IntersectionObserver` at `threshold: 0.3`, the no-observer "assume not visible" arm, `scrollIntoView` + `focus({preventScroll:true})` with a reduced-motion branch | `:970-1001` | `:931-969` | exact | |
| B109 | `goToDecision` target tab | `panelKindOf(row) === "review" ? "review" : "logs"` `:2358` | always `"logs"` `:1495-1498` | divergent | `unserved:` no `review` panel kind (B34) |
| B110 | where an inline surface HANGS | a fixture-flagged `line.card` `:1110-1122` | `anchorIndex(lines, instant)` `:996-1002` | divergent | `ruled:` stated `:987-994` — a served note page carries no marker, so the anchor is two served timestamps; a record is never dropped for want of a place |
| B111 | member branch in the sticky head: `ConveyorHeader` + `MemberSourceBlock` | `:2069-2165,2324-2328` | absent | missing | `unserved:` no producer (member roster/conveyor ledger row, CLOSED 2026-08-20) |
| B112 | member action bar (`Retry` / `Mark checked` \| `Checked` / `Skip`, `Kbd c` checks · `Kbd n` next attention, sticky bottom) | `:2698-2738` | absent | missing | same as B111 |
| B113 | `ReviewTab` and `PeopleTab` bodies | `:1231-1941` | `UnservedTab` `:1965` | missing | `unserved:` `#review` / `#people` are `declared-unserved` (D184) |
| B114 | `ParkResolveDialog` mounted at the REGION, not beside the record | `:2748-2754` | `:2040-2045` | exact | |
| B115 | `IdentityApproveDialog` mounted at the region | (no counterpart) | `:2034-2039` | extra | `ruled: D226` |

**R-B counts — 114 elements (B101 forwards to R-E): 48 exact · 24 divergent · 27 missing · 15 extra.**

**Since 08-14.** R5's 17 header findings all hold at HEAD — none regressed. What CHANGED under the
panel since the wave: D225 replaced the per-event strip with the categorical `StepStrip` (B45, B51,
B53, B56, B62); D237 added the settled-gate record (B98); D238 rewrote the outcome sentence (B21);
D259 added the `replayed` arm (B40); D226 moved the candidate grid into the ceremony (B93, B115);
and `efab4e1` moved the panel's clock to the served one (B23). Five ledger rows the wave left
"booked" were dispositioned on 2026-08-20 with named missing producers, and they are the reason
B32, B63, B90, B111 and B112 are absences rather than defects.

**OPEN in R-B (11 questions):** B41 the non-focusable timeline segment (and the dead
`group-focus-within` behind it) · B44 the untimed-segment dim · B50 the hover card's `Status` row ·
B57 the orphan-gate segment · B60 the axis's `working` total · B61 the axis's `waiting on you` half ·
B65 the stream's step grouping and sticky headings · B79 the empty-stream state · B80
`More lines follow.` · B83 the search control · B87 the live/idle dot (= A49) · B91 `open {age}` on
the decision card. Plus one recorded TENSION, not an OPEN: B45, where D225's `since <clock>`
contradicts the demo's own argument for the age.

---

## R-C — The Context rail: Data / Edit Data, provenance, freshness, the edit policy

**Demo:** `DemoContextRail.tsx` (1204 lines).
**Rebuild:** `src/dashboard/surfaces/context-rail.tsx` (1120) + `context-rail-model.ts` (220);
mounted `log-panel.tsx:2000-2024`.

**RE-AUDIT.** R6 enumerated 52 elements / 26 findings on 2026-08-13 and landed them in `05c3b33`.
Four of its wire rows have since been dispositioned (D252, D253, and the delegation / prior-run
rows on 2026-08-20), which changes the verdict on eleven of them. This table is the state at HEAD.

### C-shell — the hook, the spine, the rail frame

| # | Element | Demo | Rebuild | Verdict | Reason |
|---|---|---|---|---|---|
| C1 | rail storage key | `rebuild-demo.context-rail` `:125` | `hrauto-rebuild.context-rail` `context-rail-model.ts:41` | divergent | `ruled: R6 f.25` — operational isolation |
| C2 | the blocked-storage arm | `try/catch → true` `:127-137` | `readEnumPreference` / `writePreference` returning a distinguishable outcome | divergent | `ruled:` the fail-loud house rule, stated in code — "not a reason to refuse the operator this one, but it is a distinguishable outcome, not a silence" |
| C3 | the three-column decision | `matchMedia("(min-width:1280px)")` inside the hook `:147-161` | a MEASURED `threeColumn` argument from the layout owner `context-rail-model.ts:77` | divergent | `ruled: ref dashboard-surfaces §Shell` — see B8; the CSS half is a container query, so the JS half must read the same box |
| C4 | who owns `dataExpanded` | the ONE hook — and `setOpen(false)` clears it `:181-191` | split: `LogPanel` holds the layout flag, `ContextRail` holds the header word; collapsing clears NEITHER | divergent | **OPEN — operator call.** Collapse the rail while it is expanded, then re-open it: the grid column is still `--ds-w-context-rail-wide` while the freshly mounted rail's header reads `Run data` and its control offers `Widen`. The demo cannot desync because one hook owns both |
| C5 | spine `<aside aria-label="Run data, collapsed">` + border/bg/radius/`pb-base` | `:1054-1062` | `:912-918` | exact | |
| C6 | spine expand `IconButton` + `PanelRightOpen` on the `h-bar` baseline, with the "position, not motion" reasoning | `:1069-1076` | `:925-937` | exact | |
| C7 | spine control LABEL | `Show run data — extracted fields, attempts and delegation` `:1071` | `Show run data — extracted fields and attempts` `:932` | divergent | `ruled: R6 f.24` as-built — a spine may not advertise a section that does not render |
| C8 | spine vertical `Run data` caps (`[writing-mode:vertical-rl]`) | `:1079` | `:940-942` | exact | |
| C9 | spine vertical field count `plural(n, "field")` | `:1080-1082` | `:943-947` | exact | |
| C10 | rail `<aside aria-label="Run data">`, `@container`, border/bg/radius | `:1119-1128` | `:1001-1010` | exact | |
| C11 | rail header: `Database` glyph, title, the `Run data · editing` arm, `Hide run data` + `PanelRightClose` at `ml-auto` | `:1130-1147` | `:1012-1032` | exact | R6 f.4 |
| C12 | rail body scroller `flex min-h-0 flex-1 flex-col gap-cozy overflow-y-auto` + cozy padding | `:1149` | `:1034` | exact | |
| C13 | section ORDER — Data · Attempts · Delegation | `:1151` | `:1036` | exact | R6 f.19 |
| C14 | `Evidence` is NOT a rail section | (the demo says so twice) | `:1039-1045` | exact | R6 f.19; re-homes to Receipt |
| C15 | no summary count row at the rail floor | `:665-680` (the ban) | `:1109-1116` (the ban, restated in place) | exact | R6 f.20 |

### C-Data head

| # | Element | Demo | Rebuild | Verdict | Reason |
|---|---|---|---|---|---|
| C16 | the Data `<section>` accessible name | `aria-label="Data"` `:590` | `aria-label="Extracted fields"` `:611` | divergent | **OPEN — operator call** (R6 f.3a moved the visible `SectionLabel`; the a11y name moved with it, which the finding did not ask for) |
| C17 | head row `flex items-center gap-snug` + `SectionLabel min-w-0 truncate` reading `Extracted fields` | `:591-592` | `:616-617` | exact | R6 f.3a |
| C18 | `About run data` ⓘ trigger (`xs`, faint → fg, `data-[state=open]`) | `:600-608` | `:456-464` | exact | R6 f.3b |
| C19 | ⓘ popover `title="Run data" side="bottom" align="start" width="lg"` | `:609` | `:465` | exact | |
| C20 | ⓘ `KeyValueList` — `Generation` · `Captured {age} ago` · `Accepted age {N} min at {node}` | `:618-624` | absent | missing | `unserved:` `ContextDataSectionSchema` carries no checkpoint generation, `capturedAt` or consuming node (R6 f.7's batch; D252 served a per-ENTRY bound, which is a different fact) |
| C21 | ⓘ bullet 1 | "…every field the run recorded, **grouped by the workflow step that produced it**." `:627` | "This ledger contains every field the run recorded." `:468` | divergent | **OPEN — operator call** — the clause was dropped when grouping was unserved, and D252 has since made it true again, so the sentence now UNDERSTATES the surface |
| C22 | ⓘ bullet 2 — reads correctable, writes never edited | `:628` | `:469` | exact | |
| C23 | ⓘ bullet — the freshness limit | `:629` | absent | missing | `ruled:` stated `:447-452` — no checkpoint-level `maxAgeMin` to name, and a bullet stating a limit the wire cannot name would invent the number. D252's per-ENTRY bound prints at C49 instead |
| C24 | ⓘ bullet — the save arm | two arms (`continues` / records a correction) `:630-632` | the correction arm only `:474` | divergent | `unserved:` `continue-with-data` is not a served command here, stated `:470-473` |
| C25 | ⓘ bullet — "Starting a custom run uses the complete data set shown here…" | `:633` | absent | missing | `unserved:` no custom-run descriptor (prior-runs / custom-run ledger row) |
| C26 | ⓘ bullet — `editPolicySummary(row)` | `:634` | absent | missing | `unserved:` no per-run policy summary on the wire |
| C27 | ⓘ bullet — "A correction takes a reason, and the reason becomes the field's operator provenance…" | (no counterpart) | `:475` | extra | `ruled: R6 f.21` on-record deviation |
| C28 | Widen/Narrow `IconButton size="sm" ml-auto` + `Maximize2`/`Minimize2` + both labels verbatim | `:642-654` | `:622-634` | exact | R6 f.3c |
| C29 | `FeedsIntoLine` (info-tinted block: `Result feeds` caps · the label · the target trace) | `:203-218`, mounted `:657` | absent | missing | `unserved:` no producer — the child's side of a delegation edge (delegation links ledger row, CLOSED 2026-08-20) |
| C30 | the empty ledger — a plain `<p>`, not a card, with the demo's sentence verbatim | `:659-662` | `:637-644` | exact | R6 f.17 |

### C-ledger row

| # | Element | Demo | Rebuild | Verdict | Reason |
|---|---|---|---|---|---|
| C31 | the direction RAIL: `w-[--ds-border-w-emphasis] self-stretch rounded-pill` in the read/write mark colour, the arrow on the LABEL line, an `sr-only` word | `:234-263` | `:279-315` | exact | R6 f.12, landed by D252 |
| C32 | the `sr-only` word | `write` `:260` | `written` `:312` | divergent | **OPEN — operator call** (one word; the demo's pair is `read`/`write`) |
| C33 | the `dir === undefined` neutral rail | (no counterpart — the demo always knows) | `:280-290` | extra | `ruled: D252` — defaulting to `read` would claim the run changed nothing |
| C34 | row wrapper `flex gap-snug py-snug` + inner `flex min-w-0 flex-1 flex-col gap-hair` | `:340-342` | `:346-352` | exact | |
| C35 | label line `flex items-center gap-tight` | `:346` | `:360` | exact | |
| C36 | the label element: a real `<label htmlFor>` with `cursor-text` when editable, a `<span>` when not, both `title`d, `flex-1 truncate font-medium fg-secondary` | `:333,346-355` | `:258-262,361-369` | exact | R6 f.14 + f.15 |
| C37 | `changed` Badge (warning, `shrink-0`, "You changed this value. It is not saved yet.") | `:359-363` | `:687-695` | exact | R6 f.2 |
| C38 | `corrected` Badge | `info`, title quotes the observed reading `:364-372` | `info`, title `Corrected by an operator at {clock}…` `:220-228` | divergent | `ruled: R6 f.10` (tone) + `f.22` (clocked, never raw ISO). The OBSERVED reading is not quoted — the wire carries one value per entry |
| C39 | `refreshed` Badge | `:373-381` | absent | missing | `unserved:` needs the superseded reading beside the current one; this wire carries one value per entry (D252's row) |
| C40 | `staged` Badge | `:382-390` | absent | missing | `unserved:` STRUCTURAL — a `prepare` contract is `checkpoint: "in-memory-only"`, so a staged value never becomes the checkpoint a ledger row reads (D252's row) |
| C41 | `unconfirmed` Badge | `:391-399` | absent | missing | `unserved:` same — an unconfirmed write is a `parked-write` run whose transaction node has no checkpoint; its honest surface is `ref write-safety §4.1`'s park section |
| C42 | the locked-policy ONE-WORD `tag` Badge (`policy.tag`, `title={policy.reason}`) | `:402-406` | absent — the reason rides `LockedValue` alone | missing | `unserved:` the edit wire carries a reason, no one-word tag. **Named in D252's row and it did not land with the rest of that batch** |
| C43 | `derived` Badge | (no counterpart) | `:238-245` | extra | `ruled: R6 f.23` — W2's `source`; the `operator` arm draws nothing on purpose, stated `:233-237` |
| C44 | `SystemChip` placement | on every ROW `:407` | on the STEP HEADING `:663-665` | divergent | `ruled: D252`, stated `:651-657` — every value a step recorded came from the same place |
| C45 | the observation clock | `point.ts`, folded away below `@min-[26rem]` `:413-417` | `fmtClock(observedAt)` with NO fold `:246-253` | divergent | `ruled:` stated `:191-205` — the demo's two competitors for that line are unserved here, and a threshold carried across unexamined would hide the clock at every width the product draws (376 at rest, 520 mid-edit) |
| C46 | the value line: `ValueField` when editable, `LockedValue` when not, `w-full` | `:425-429` | `:700-717` | exact | |
| C47 | what `LockedValue` prints | the checkpoint base `:428` | `entry.valueRedacted` `:701` | exact | server-redacted, rendered verbatim; this surface never unmasks |
| C48 | the pending-correction sentence under an editable value | (no counterpart) | `:718-725` | extra | `ruled: R6 f.22` keep-with-fix (clocked) |
| C49 | the per-entry FRESHNESS note under the value (`Reusable for N min before <writes>. …`) | (the demo states this at checkpoint level, C20/C58) | `:731-735` + `context-rail-model.ts:151-164` | extra | `ruled: D252` — printed only where it can BITE; an empty `feeds` set refuses nothing, so it prints nothing |

### C-grouping (LEVEL 1)

| # | Element | Demo | Rebuild | Verdict | Reason |
|---|---|---|---|---|---|
| C50 | the ledger has a STEP level at all | `:762-803` | `:658-740` | exact | R6 f.1's first half, closed by D252 |
| C51 | the step group's CHROME | a `Well` per step (`overflow-hidden p-0`), a RECESSED heading band (`min-h-[--ds-h-sm] items-center px-base py-tight`), a `border-t border-recess-border bg-surface-1` body, `px-base` rows separated by `border-t border-border-subtle`, and `gap-base` between groups `:762-803` | a bare `<div className="flex flex-col">` with a `SectionLabel` and `pt-snug` — no Well, no band, no row dividers, no inter-group gap `:658-667` | divergent | **OPEN — operator call.** R6 f.1 named "Well + recessed caps band + divided rows" in one breath; D252 delivered the LEVELS and none of the chrome, so the hierarchy the operator asked to see before reading any copy is carried by a caps label alone |
| C52 | the heading's type treatment | `dsText.caps dsText.flush truncate fg-secondary` `:772` | `SectionLabel` `:662` | exact | the same caps treatment through the shared primitive |
| C53 | grouping KEY and order | `[...new Set(row.data.map(d => d.step))]` — first appearance, by label `:504` | `groupEntriesByStep` — by `origin.nodeId`, plus an unattributed group | divergent | `ruled: D252`, stated `:651-657` — "grouped by node id and never by label" |
| C54 | the UNATTRIBUTED group (rows the build cannot attribute, drawn with no heading) | (no counterpart) | `:659-667` | extra | `ruled: D252` — a made-up heading would be the guess |

### C-refusals, freshness, the action dock

| # | Element | Demo | Rebuild | Verdict | Reason |
|---|---|---|---|---|---|
| C55 | a REJECTED save | the `Refusal` primitive — headline, the server's `code` (or "unknown — the server refused without one"), `outcome="nothing was written to the checkpoint"`, a `Dismiss` button `:684-697` | one `role="alert"` red `<span>` carrying `settlement.problem` `:742-746` | divergent | **OPEN — operator call.** R6 f.6's as-built flattened every non-applied outcome to one danger span; D253 then routed the CAS `conflict` into that same span. So both refusals now read as one uncoded sentence where the demo shows the code — and "a refusal you cannot quote is one you cannot get help with" is the demo's own line |
| C56 | the CAS-conflict BANNER — headline, detail, `The checkpoint moved because …`, per-field `yours` / `server now` Chips with a `take the server's` link, and the two exits (`Keep my edits and save against generation N` / `Discard my edits and load the fresh checkpoint`) | `:701-749` | absent (the conflict IS caught — `settleCommandResult` — and rendered as C55's span) | missing | `unserved:` the per-FIELD re-offer is a change to what `executeEditCheckpoint` RETURNS, not a wire projection (D253's row; trigger named: the first change to that refusal payload) |
| C57 | the two TOASTS on a refused save — `Not saved — the checkpoint moved` / the refusal headline, each stating how many edits are still held | `:548-562` | absent | missing | **OPEN — operator call.** The drafts ARE held (`:586`), and nothing says so out loud; the operator sees a red line and no statement that their work survived |
| C58 | the stale-checkpoint sentence on the surface (`Captured N ago — older than the Nm limit. Reusing them takes an override.`) | `:816-820` | absent | missing | `unserved:` no checkpoint-level `capturedAt`/`maxAgeMin` (R6 f.7). D252's per-entry bound (C49) is the served substitute |
| C59 | the freshness OVERRIDE dialog — `These values are older than the next write accepts`, the four Chips (`captured`/`age`/`limit`/`consumed by`), the `Why reuse them?` `Textarea` with its 8-character minimum, and the three exits (`Cancel` / `Override — reuse these values` / `Re-read live instead`) | `:938-981` | absent | missing | `unserved:` `envelope.freshnessOverride` is planned at ENQUEUE and no command mints one from a panel (D252's row; trigger = that command) |
| C60 | the LIVE LOCK sentence (`aria-live="polite"`, never `role="alert"`) | (no counterpart) | `:747-771` | extra | `ruled:` `efab4e1` finding 1 + `ref dashboard-surfaces` D19 |
| C61 | the `Why is this correct?` reason `Field`, ABOVE the dock | (no counterpart — the demo's save is a mock) | `:773-791` | extra | `ruled: R6 f.21` on-record deviation — `CheckpointPatchSchema.reason` is `z.string().min(1)` |
| C62 | dock `Well` + `grid grid-cols-2 gap-snug`, every button `w-full`, and the whole "every edge is a column" argument | `:827-858` | `:819-820` | exact | R6 f.5 |
| C63 | the `aria-live="polite"` state line at row zero, spanning both columns | `:859-865` | `:821-831` | exact | |
| C64 | the state line's `Loaded the values from run #N` arm | `:862-863` | absent | missing | `unserved:` reachable only through `Load prior run`, stated `:825-827` — not written as an unreachable branch |
| C65 | `Load prior run` (`History`) | unconditional `:866-884` | behind an optional `onLoadPriorRun` that nothing passes `:832-842` | missing | `unserved:` prior-runs list (ledger row, CONSUMER READY 2026-08-14) — the dock draws two cells, which is the fail-visible absence |
| C66 | `Reset edits` (`RotateCcw`, disabled at zero changes) | `:885-897` | `:843-852` | exact | |
| C67 | the SAVE arm | the SERVER's descriptor — `continue-with-data` → `Play`, `edit-checkpoint` → `Save`; label, `title` and `variant` all off the descriptor `:898-915` | a fixed `primary` `Save {n} corrections` with `Save` `:853-873` | divergent | `unserved:` no `data`-placement action descriptors; the one command is `run/edit-checkpoint` |
| C68 | the lone-commit-arm `col-start-2` rule (the primary's place is the bottom-right cell) | `:902-907` | `:862-867` | exact | comment ported verbatim |
| C69 | `Start custom run` (`Play`) | unconditional `:916-927` | behind an optional handler nothing passes `:874-884` | missing | `unserved:` custom-run descriptor (same ledger row as C65) |
| C70 | a `saveBlocked` sentence UNDER the dock | (no counterpart) | `:887-891` | extra | **OPEN — operator call** (honest, but it duplicates the primary's own `title`) |
| C71 | `Saving…` on the primary while in flight | (no counterpart — the demo's save is synchronous) | `:872` | extra | **OPEN — operator call** (small; a real command needs a pending state, nothing records the addition) |

### C-attempts and delegation

| # | Element | Demo | Rebuild | Verdict | Reason |
|---|---|---|---|---|---|
| C72 | the `Attempts` section, gated on `> 1` attempts so a labelled section is never empty | `:1111-1114,1178-1186` | `:992-998,1077-1092` | exact | R6 f.18's gate |
| C73 | what the section CONTAINS | `RunSelector` — a control that changes which attempt you are reading `:1183` | a locked `ContextSection` ledger `:1085-1090` | divergent | `ruled: R6 f.18` on-record deviation, stated `:1080-1084`; see A29 |
| C74 | the `Separator` above it | `:1180` | `:1079` | exact | |
| C75 | `DelegationLinks` — the `Delegation` section, its redirect-styled `<button>` links in the queue's grey language, the three sentence arms, `ArrowUpRight` | `:1000-1048,1187-1192` | absent | missing | `unserved:` no producer — no descriptor declares a `child-run` node and `ChildRunExecutor` is unwired (delegation ledger row, CLOSED 2026-08-20) |
| C76 | the hidden-sections hint | `Attempts and delegation are hidden while you edit…`, ungated `:1196-1200` | `Attempts are hidden while you edit…`, gated on `hasAttempts` `:1103-1107` | divergent | `ruled: R6` as-built — this rail draws one of the demo's two hideable sections, and a control advertising a section that is not there lies about its contents |

**R-C counts — 76 elements: 31 exact · 18 divergent · 17 missing · 10 extra.**

**Since 08-14 (eleven of R6's 26 findings moved).** f.1's step LEVEL landed with D252 (C50) and its
Well/band/divider CHROME did not (C51 — now the region's largest visual gap). f.12/f.13's
`DirectionMark` and `SystemChip` landed with D252 (C31, C44). f.7's freshness split: the per-ENTRY
bound is served (C49) and the checkpoint-level trio plus the override dialog remain unserved with
named producers (C20, C23, C58, C59). f.6's `conflict` arm is now HANDLED rather than silently
treated as a save (D253) — but it is handled by flattening into f.6's own one-span compromise
(C55/C56). f.11's `staged`/`unconfirmed` closed as STRUCTURAL rather than as wire gaps (C40, C41),
while its third member, the one-word policy `tag`, did not land and has no disposition of its own
(C42). f.8/f.9's delegation and `feedsInto` closed with no producer (C29, C75).

**OPEN in R-C (9 questions):** C4 the `dataExpanded` desync across a collapse · C16 the section's
accessible name · C21 the ⓘ bullet that now understates the surface · C32 `written` vs `write` ·
C51 the step group's missing chrome · C55 the flattened refusal (no code, no `Refusal`) · C57 the
missing "your edits are still here" toasts · C70 the duplicated blocked-reason sentence · C71 the
`Saving…` label.
