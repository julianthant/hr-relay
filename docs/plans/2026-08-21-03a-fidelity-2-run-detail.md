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
| A3 | the literal `wf ` noun in front of the tag | (none — demo prints the bare `v3.1`) | `:129` | exact | `ported: D273 item 1` (unit V1, 2026-08-26) — the `wf ` noun is gone and the bare tag prints in the demo's own slot (`run-identity.tsx:139`). The fact it labelled is named in full two elements to the right, in the ⓘ's `Workflow` row |
| A4 | tag title, CURRENT arm | `:98` | `:120` | divergent | `ruled:` A2 |
| A5 | tag title, SHAPE-MOVED arm (verbatim "…a retry would replay retired code.") | `:97` | `:117` | divergent | `ruled:` A2 |
| A6 | tag title, `unserved` arm ("this dashboard serves no … descriptor at all") | (no counterpart) | `:119` | extra | `ruled: D256/D257` (`ed0e1fb3`) — `classifyRunShape` refuses to call an unregistered workflow "moved" |
| A7 | tag tone: waiting-fg on the hazard, muted otherwise | `:100-105` | `:122-127` | exact | |
| A8 | `dry run` chip — `FlaskConical`, the word, the "A rehearsal: it read every system and wrote to none." title | `:111-119` | `:140-151` | exact | |
| A9 | `dry run` chip HUE | `--ds-info-fg` `:114` | `--ds-rehearsal-fg` `:145` | divergent | `ruled: D232`, stated `:133-139` (`info` is the queue row's `test` hue; one fact may not have two colours) |
| A10 | `test` chip — `TriangleAlert`, the word, the "…nothing here reached production." title, waiting-fg | `:120-131` | `:152-163` | exact | |
| A11 | ⓘ trigger `IconButton size="xs" label="Run provenance"` + `Info` | `:135` | `:167` | exact | |
| A12 | `PopoverContent title="Provenance" description={trace} width="lg" side="top" align="end"` | `:137` | `:169` | exact | |
| A13 | KVL `Workflow` value separator | `${label} ${ranVersion}` `:141` | `${label} · ${ranShape}` `:173` | exact | `ported: D273 item 1` (unit V1, 2026-08-26) — the ⓘ's `Workflow` value is `${workflowLabel} ${ranShape}`, the demo's space separator (`run-identity.tsx:189`). The middot read as two facts where the demo draws one qualified name |
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
| A38 | `Input` placeholder | `row.title \|\| "Friday exception pack"` `:394` | `surface.title` `:363` | divergent | `ruled: D273 item 1` (unit V1, 2026-08-26) — **RETAINED with a named truthful exception:** `placeholder={surface.title}` with no fallback behind it. `QueueSurfaceWireSchema.title` is `z.string().min(1)`, so the demo's fixture-name fallback is a branch this wire cannot reach — and an unreachable fallback is exactly the plausible-but-wrong substitution the fail-loud rule bans. Stated at `run-identity.tsx:411` |
| A39 | rule `Well` + the three bullets, verbatim | `:397-407` | `:366-376` | exact | |
| A40 | `DialogFooter meta={<MetaLine tone="faint">}` | `:426-437` | `:392-403` | exact | |
| A41 | meta item `subject …` | `row.title \|\| "—"` `:433` | `surface.title` `:396` | divergent | `ruled: D273 item 1` (unit V1, 2026-08-26) — the same recorded exception as A38: the footer prints `subject ${surface.title}` bare, because the demo's em-dash fallback is unreachable on a `.min(1)` title (`run-identity.tsx:445`) |
| A42 | meta item trace id | `:433` | `:397` | exact | |
| A43 | meta item `#N` | unconditional `:434` | conditional on a served `runNumber` `:399` | divergent | `ruled: D230` (schema v15 read-forward), stated `:388-390` |
| A44 | meta item elapsed | `fmtElapsed(row.elapsedSec)` `:434` | `runTiming(surface, nowIso, isTerminalQueueStatus)` `:400` | divergent | `ruled: D124` — a terminal row's duration is `endedAt − startedAt`, never `now −` |
| A45 | footer `Cancel` (secondary) + the "not 'Keep the name it has'" reasoning | `:439-441` | `:405-407` | exact | |
| A46 | footer primary `Save the name` | `:442` | `:408` | exact | |
| A47 | primary disabled predicate (+ a `title` carrying the problem) | `!trimmed` `:442` | `problem !== undefined` + `title` `:408` | divergent | same OPEN as A35 |
| A48 | bar MOUNT: floor bar, right side, after an `h-[--ds-h-xs] w-px` divider | `DemoLogPanel.tsx:1181-1182` | `log-panel.tsx:1195-1201` | exact | |
| A49 | the trailing live/idle dot after the bar (`bg-success` while running, `bg-muted-foreground/40` otherwise) | `DemoLogPanel.tsx:1183` | absent | exact | `ported: D273 item 4` (unit V1, 2026-08-26) — `RunLivenessDot` draws after the provenance bar: the running pulse, the idle mark, and an `sr-only` live/idle word the demo's colour-only dot never had (`log-panel.tsx:1650`) |

**R-A counts — 49 elements: 23 exact · 14 divergent · 4 missing · 8 extra.**
**Since 08-14:** the whole region is new to the ledger. Three things moved at HEAD after the wave:
the `dry run` chip landed (D232), the rename dialog + the `Priority` row landed (D233), and the
shape hazard stopped firing on every run (D256/D257, `ed0e1fb3` — before it, the run's one-workflow
fingerprint was compared against the bootstrap's whole-SET hash, so the amber tag was permanent).

**OPEN in R-A — 7 questions at audit; the five WORD-level ones are CLOSED (unit V1, 2026-08-26,
`ruled: D273 items 1 and 4`):** ~~A3 the `wf ` noun~~ (deleted, the demo's bare slot) ·
~~A13 the `·` separator~~ (the demo's space) · ~~A38/A41 the placeholder and `subject`
fallbacks~~ (**retained**, and the exception named: a `.min(1)` title makes both demo arms
unreachable, and an unreachable fallback is the substitution the fail-loud rule bans) ·
~~A49 the live/idle dot~~ (`RunLivenessDot`, with an `sr-only` word the demo's colour-only dot
lacked). Still open, and NOT vocabulary: A18 the `Config` row · A19 the `Attempt` row ·
A35/A37/A47 the rename error affordance.

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
| B44 | `opacity-70` on an untimed non-pending segment | `:617` | absent | exact | `ported: D273 item 2` (unit V1, 2026-08-26) — `timelineSegmentUnmeasured` drives the demo's `opacity-70` on a segment that ran and could not be measured (`log-panel-model.ts`, `log-panel.tsx:486`) |
| B45 | the number under the bar, WAITING arm | `gateAge(row, tick)` — the elapsed age `:629` | `since ${fmtClock(openedAt)}` — a wall clock `:368-369` | divergent | `ruled: D225`, stated `:313-322`. **Noted tension:** the demo's own argument (`DemoLogPanel.tsx:2557-2563`) is that the AGE, not the clock, is the number that decides which of two waiting runs you open first — the rebuild keeps the age on the outcome bar and the clock on the strip |
| B46 | `×N` marker, gated at ≥ 2 | `s.attempts && s.attempts > 1` `:631-633` | `step.executions`, schema `min(2)` (`run-detail.ts:218`) `:376-380` | exact | the gate is in the schema rather than the JSX, which is stronger |
| B47 | hover card: `absolute top-full z-50 mt-1 hidden w-60 … p-2.5 text-left shadow-lg group-hover:block group-focus-within:block` | `:636-641` | `:383-391` | exact | tokenised border/bg |
| B48 | hover-card side anchor rule (`> 2 && i >= n-2` → `right-0`) | `:558,640` | `:332,389` | exact | |
| B49 | hover-card heading (the step label, semibold) | `:643` | `:392` | exact | |
| B50 | hover-card `Status` row | `:644-647` | absent | exact | `ported: D273 item 2` (unit V1, 2026-08-26) — the hover card names `step.state` in a word above the member list (`log-panel.tsx:532`); D273 item 2 names this row by name |
| B51 | hover-card `Waiting` / `Took` rows | `:648-660` | absent (duration appears per MEMBER only) | missing | `ruled: D225` — the card's job became disclosing the category's members; the step's own duration prints under the bar |
| B52 | hover-card `System` row | `:661-666` | absent | missing | `unserved:` nothing serves a system on a timeline step (D252 serves it on a context-data entry's `origin`, which is a different row) |
| B53 | hover-card `Attempts` row | `:667-672` | absent | missing | `ruled: D225` — carried by the `×N` marker and the member list |
| B54 | hover-card `keyLines` block | `:673-679` | absent | missing | `unserved:` no per-step key lines on the wire; the stream carries the notes |
| B55 | hover-card `Step screenshot →` | `:680` | absent | missing | `unserved:` `RunDetailSectionResponseSchema#captures` is `declared-unserved` (D184) |
| B56 | hover-card MEMBER list (label · state · duration · replayed-from) | (no counterpart) | `:393-404` | extra | `ruled: D225` — the grouping must hide nothing |
| B57 | the ORPHAN-GATE trailing segment (a gated run whose steps record no wait) | `:687-705` | absent | missing | **OPEN — operator call.** The demo keeps it precisely so a wait can never vanish because the shape did not line up — "the one thing this timeline may not do" |
| B58 | axis row: `mt-1.5 border-t pt-1` micro/nums muted, start · rule · total | `:711-717` | `:429-441`, `:496-508` | exact | |
| B59 | axis START value | `row.time` `:712` | `fmtClock(first.at)` `:438` | exact | |
| B60 | axis TOTAL | `${fmtElapsed(active)} working` — the SUM of step durations `:714-716` | `${fmtElapsed(totalSec)} elapsed` — the first→last event SPAN `:440` | exact | `ported: D273 item 2` (unit V1, 2026-08-26) — the axis total is `{fmtElapsed(workingSec)} working`, the SUM of step durations: the number the demo's equal-width segments make no claim about (`log-panel.tsx:586`) |
| B61 | axis `· {gateAge} waiting on you` half | `:715` | absent | exact | `ported: D273 item 2` (unit V1, 2026-08-26) — the `waiting on you` half joins the same axis line while a gate is open (`log-panel.tsx:587`) |
| B62 | the flat EVENT strip (a second timeline for a run the projector did not categorise) | (no counterpart) | `:447-512` | extra | `ruled: D225` read-forward — `timeline.steps` is optional, so a pre-D225 run keeps the per-event strip |
| B63 | `SharedPipelineStrip` (`Shared member pipeline`, `{n} people · identical steps`, per-segment `done/total` fill bars in four flex-grown bands) | `:736-776` | absent | missing | `unserved:` no producer — no registered workflow is `operation`-shaped (member roster/conveyor + shared member pipeline ledger row, CLOSED 2026-08-20) |

### B-stream — `LogsTab`

| # | Element | Demo | Rebuild | Verdict | Reason |
|---|---|---|---|---|---|
| B64 | stream wrapper, no scroller of its own | `pb-2 pt-1` `:1072` | `pb-base pt-tight` `:1101` | exact | |
| B65 | **the stream is GROUPED BY STEP, with a sticky per-step heading** (`sticky top-[var(--ds-panel-head-h,0px)] … text-[11px] font-semibold` + a hairline rule) | `:1060-1065,1082-1085` | contiguous producing rows group under their served `step · task`; notes retain no fabricated producer heading | exact | the heading uses the published `--ds-panel-head-h`, spans the whole contiguous producer run, and preserves server sequence order |
| B66 | line row `flex items-start gap-snug px-cozy pl-5 py-hair` | `:1095` | `:1119-1123` | exact | |
| B67 | line timestamp cell (`mt-hair shrink-0` micro/nums muted) | `:1096` | `:1125-1133` | exact | |
| B68 | line icon cell (`mt-hair w-3.5 shrink-0 text-center`) | `:1097-1099` | `:1134-1136` | exact | |
| B69 | line ICON VOCABULARY | 9-kind `LINE_ICON` — `nav`/`search`/`read`/`write`/`ok`/`error`/`warn`/`pause`/`event`, with the `--ds-read-*` / `--ds-write-*` DIRECTION hues `:190-215` | note level icons; observed rows use their served read/write direction glyph and hue; a mixed observed batch uses neutral database; fence uses an authority-fence glyph | divergent | `unserved:` note kinds remain only levels and no wire arm serves nav/search/ok/pause/event; the served row kinds no longer pretend otherwise |
| B70 | line TONE | partial `LINE_TONE` over ok/error/warn, default `text-secondary-foreground` `:228-232,1100` | note levels retain their own tone; observed direction uses the Context rail's read/write hues; fence stays neutral | divergent | exact for the wire's independent note / observation / fence semantics, divergent from the demo's unavailable general kind vocabulary |
| B71 | `pause` line row tint (`bg-info/6`) | `:1095` | absent | missing | same as B69 |
| B72 | per-line `SystemChip` | `:1101` | exact `SystemChip` on observed rows only | divergent | a note has no system and an authority fence is deliberately not presented as a page observation; neither receives an invented chip |
| B73 | per-line read/write `Pill` chips (`ArrowDownToLine`/`ArrowUpFromLine`, `h-[--ds-h-xs]`, read/write token trio, label + `dsText.nums` value) | `:234-258,1103` | exact direction pills for each served redacted observation fact | divergent | notes have no facts; a fence has no fabricated page fact; the pill label/value search reaches the strict wire's field/key and redacted value |
| B74 | per-line `attempt N` badge | `:1104-1106` | exact on observed and fenced rows | divergent | note attempts are unserved and remain absent rather than defaulted |
| B75 | per-line duration | `:1107` | absent | missing | `unserved:` a note carries no duration |
| B76 | search dimming `opacity-35` on a non-match | `:1092,1095` | `:1116,1122` | exact | |
| B77 | search hit highlight | `rounded-sm bg-info/15` `:1100` | `dsRadius.xs bg-[--ds-info-bg]` `:1142` | exact | |
| B78 | search PREDICATE | text OR any pill's `label value` `:1046-1048` | note prose OR an observed pill's served label/value | exact | fence rows have no invented searchable page detail |
| B79 | empty-stream state | (none — a fixture always has lines) | `EmptyState` "No log lines yet" `:1107-1111` | extra | **OPEN — operator call** (defensible, uncited) |
| B80 | `More lines follow.` | (none — the demo pages nothing) | `Load more lines` appends the immutable next cursor snapshot | extra | `ruled:` the strict wire pages through `nextCursor`; the explicit control is a truthful pagination affordance, not a demo-text port |
| B81 | `live — streaming` pulse line | `:1137-1142` | absent | missing | `ruled:` port rule-(c) — fixture-only (`row.id === "pl-daniel"`) |
| B82 | floor bar `sticky bottom-0 mt-auto flex items-center gap-snug border-t … px-cozy py-snug` | `:1147` | `:1171-1176` (adds `flex-wrap`) | exact | |
| B83 | the search control | raw `<input class="w-40 …">` + an `sr-only <label htmlFor>` `:1148-1157` | the `SearchInput` DS primitive, `aria-label`, an `onClear`, `w-48` `:1178-1185` | divergent | `ruled: D273 item 3` (unit V1, 2026-08-26) — the demo's `w-40` GEOMETRY is restored (`log-panel.tsx:1626`). The `SearchInput` primitive, its `aria-label` and its `onClear` stay, under DESIGN.md's two-renderers rule: a raw `<input>` beside a DS primitive is a second renderer for one control |
| B84 | `plural(matchCount, "match", "matches")` behind a non-empty query | `:1158-1162` | `:1186-1190` | exact | |
| B85 | the dead `System ▾` control, DELETED | `:1163-1175` | absent | exact | deletion ported |
| B86 | divider + `RunProvenanceBar` on the right | `:1181-1182` | `:1195-1201` | exact | see A48 |
| B87 | the trailing live/idle dot | `:1183` | absent | exact | `ported: D273 item 4` (unit V1, 2026-08-26) — the same one `RunLivenessDot` as A49: colour, motion and an `sr-only` word, so the state survives with no colour at all (`log-panel.tsx:1650`) |

### B-inline — the decision, the records, the floating notice

| # | Element | Demo | Rebuild | Verdict | Reason |
|---|---|---|---|---|---|
| B88 | decision card geometry: `mx-cozy my-base ml-5 border p-cozy`, `dsRadius.lg`, `dsFocus`, `border-[length:--ds-border-w-rail]`, waiting tint | `:377-390` | `:545-556` | exact | |
| B89 | decision anchor: `tabIndex={-1}`, a `data-*` hook, `aria-label="Decision — <title>"` | `:378-381` | `:547-549` | exact | `data-demo-decision` → `data-panel-decision` |
| B90 | decision head icon ARM | `parked ? Pause : identity ? UserRoundSearch : ClipboardList` `:372` | `UserRoundSearch`, unconditional `:560` | divergent | `ruled:` the `GateDecisionWireSchema.kind` ledger row (CLOSED 2026-08-20) — `parked` is not a gate in this tree, and every registered gate is `resolvedBy: "operator"`, so a served enum would have one reachable arm |
| B91 | decision head right-hand text | `open {age} · since {clock}` `:396-398` | `since {clock}` `:572-580` | exact | `ported: D273 item 4` (unit V1, 2026-08-26) — the decision head's right-hand text is the demo's pair, `open {age} · since {clock}` (`log-panel.tsx:807`), so the age and the instant are no longer split across two surfaces |
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

**R-B counts — 114 elements (B101 forwards to R-E): 50 exact · 26 divergent · 23 missing · 15 extra.**

**Since 08-14.** R5's 17 header findings all hold at HEAD — none regressed. What CHANGED under the
panel since the wave: D225 replaced the per-event strip with the categorical `StepStrip` (B45, B51,
B53, B56, B62); D237 added the settled-gate record (B98); D238 rewrote the outcome sentence (B21);
D259 added the `replayed` arm (B40); D226 moved the candidate grid into the ceremony (B93, B115);
and `efab4e1` moved the panel's clock to the served one (B23). Five ledger rows the wave left
"booked" were dispositioned on 2026-08-20 with named missing producers, and they are the reason
B32, B63, B90, B111 and B112 are absences rather than defects.

**OPEN in R-B — 9 questions at audit; the six WORD-and-GLYPH ones are CLOSED (unit V1, 2026-08-26,
`ruled: D273 items 2, 3 and 4`):** ~~B44 the untimed-segment dim~~ · ~~B50 the hover card's
`Status` row~~ · ~~B60 the axis's `working` total~~ · ~~B61 the axis's `waiting on you` half~~ ·
~~B83 the search control~~ (**geometry ported, primitive retained** — a raw `<input>` beside a DS
primitive is a second renderer for one control) · ~~B87 the live/idle dot (= A49)~~ ·
~~B91 `open {age}` on the decision card~~. Still open, and NOT vocabulary: B41 the non-focusable
timeline segment (and the dead `group-focus-within` behind it) · B57 the orphan-gate segment ·
B79 the empty-stream state. Plus one recorded TENSION, not an OPEN: B45, where D225's
`since <clock>` contradicts the demo's own argument for the age.

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
| C16 | the Data `<section>` accessible name | `aria-label="Data"` `:590` | `aria-label="Extracted fields"` `:611` | divergent | `ruled: D273 item 5` (unit V1, 2026-08-26) — **RETAINED with a named truthful exception:** the `aria-label` IS the section's visible label. The demo's region says `Data` under a visible `Extracted fields`, a mismatch it inherited when its own visible label changed and its region name did not; porting it would put two names on one region and undo the one-expression rule this bundle ratified for WCAG 2.5.3. `DATA_SECTION_LABEL` feeds both halves so they cannot drift (`context-rail.tsx:796` + `src/dashboard/CLAUDE.md`) |
| C17 | head row `flex items-center gap-snug` + `SectionLabel min-w-0 truncate` reading `Extracted fields` | `:591-592` | `:616-617` | exact | R6 f.3a |
| C18 | `About run data` ⓘ trigger (`xs`, faint → fg, `data-[state=open]`) | `:600-608` | `:456-464` | exact | R6 f.3b |
| C19 | ⓘ popover `title="Run data" side="bottom" align="start" width="lg"` | `:609` | `:465` | exact | |
| C20 | ⓘ `KeyValueList` — `Generation` · `Captured {age} ago` · `Accepted age {N} min at {node}` | `:618-624` | absent | missing | `unserved:` `ContextDataSectionSchema` carries no checkpoint generation, `capturedAt` or consuming node (R6 f.7's batch; D252 served a per-ENTRY bound, which is a different fact) |
| C21 | ⓘ bullet 1 | "…every field the run recorded, **grouped by the workflow step that produced it**." `:627` | "This ledger contains every field the run recorded." `:468` | exact | `ported: D273 item 5` (unit V1, 2026-08-26) — the bullet is the demo's again, "…every field the run recorded, **grouped by the workflow step that produced it**.", which D252 made true (`context-rail.tsx:504`) |
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
| C32 | the `sr-only` word | `write` `:260` | `written` `:312` | exact | `ported: D273 item 5` (unit V1, 2026-08-26) — the `sr-only` word is the demo's `read`/`write` pair; `written` was a tense this ledger uses nowhere else (`context-rail.tsx:327`) |
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
| C70 | a `saveBlocked` sentence UNDER the dock | (no counterpart) | `:887-891` | extra | `ruled: D273 item 6` (unit V1, 2026-08-26) — "remove duplicate", resolved toward the VISIBLE half: the primary's `title` is gone and the under-dock `saveBlocked` sentence is kept, because a reason that lives only on a tooltip is unavailable to touch and keyboard (`context-rail.tsx:1116,1156-1160`) |
| C71 | `Saving…` on the primary while in flight | (no counterpart — the demo's save is synchronous) | `:872` | extra | `ruled: D273 item 6` (unit V1, 2026-08-26) — **RETAINED**, the item's own "retaining Saving". The demo's save is a synchronous mock and this is a real `run/edit-checkpoint` round trip; the label IS the pending state, so the fact reaches a screen reader on the control's accessible name rather than through decoration (`context-rail.tsx:1135` + `src/dashboard/CLAUDE.md`) |

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

**OPEN in R-C — 9 questions at audit; the five WORD-level ones are CLOSED (unit V1, 2026-08-26,
`ruled: D273 items 5 and 6`):** ~~C16 the section's accessible name~~ (**retained**: the
`aria-label` IS the visible label, under the one-expression WCAG 2.5.3 rule this bundle ratified) ·
~~C21 the ⓘ bullet that now understates the surface~~ (the demo's clause is back, and D252 made it
true) · ~~C32 `written` vs `write`~~ · ~~C70 the duplicated blocked-reason sentence~~ (the
tooltip half went; the visible half stayed) · ~~C71 the `Saving…` label~~ (**retained**, D273 item
6's own "retaining Saving"). Still open, and NOT vocabulary: C4 the `dataExpanded` desync across a
collapse · C51 the step group's missing chrome · C55 the flattened refusal · C57 the missing "your
edits are still here" toasts.

---

## R-D — The Receipt tab: the verdict band, the evidence body, the captures

**Demo:** `DemoReceipt.tsx` (492) + `DemoLogPanel.tsx:1942-2054` (`ReceiptTab` / `StagedBlock` /
`ShortReceipt`) + `DemoEvidence.tsx` (1039, of which `ReceiptCapturesSection` and its stack are the
Receipt tab's).
**Rebuild:** `src/dashboard/surfaces/receipt.tsx` (133) + `trust.tsx` `ReceiptEvidenceBody`
(`:207-295`) + `system-chip.tsx`; mounted `log-panel.tsx:1953-1964`.

**FIRST AUDIT** — no region of the 08-13 wave opened `DemoReceipt.tsx` or `DemoEvidence.tsx`.
`receipt.tsx`'s own header still calls itself "the 1i Receipt PLACEHOLDER" and says the full body
"lands with the trust surfaces in 2g"; 2g landed, `ReceiptEvidenceBody` exists, and the header was
never corrected — so the first finding of this region is that its own deferral note is stale.

### D-tab frame

| # | Element | Demo | Rebuild | Verdict | Reason |
|---|---|---|---|---|---|
| D1 | `ReceiptTab` composition — the full receipt OR a short one, then a `border-t p-cozy` captures block | `DemoLogPanel.tsx:1942-1959` | `ReceiptView` alone `log-panel.tsx:1953-1964` | divergent | see D2 and D4 |
| D2 | `ShortReceipt` — the pre-receipt summary card: tone-tinted box, `ShieldCheck` + headline, the `verified` corner tag, the `lines[]` label/value rows with their per-line `read-back` marks, inline per-person confirmations, the `note` | `DemoLogPanel.tsx:1984-2054` | an `EmptyState` "No receipt yet — {reason}. A receipt is written at the run's terminal outcome." `receipt.tsx:69-73` | divergent | `unserved:` the demo's `row.receipt` is a fixture-authored summary; nothing in this tree serves a pre-terminal receipt digest, and D82 is explicit that a receipt is DERIVED at the terminal instant. The rebuild's honest absence is arguably the better answer — recorded, not silently swapped |
| D3 | `StagedBlock` — `Staged — goes live when the run continues` / `Unconfirmed — resolve present or absent`, per-value `ArrowUpFromLine` + field + value + `SystemChip`, drawn under BOTH receipt arms | `DemoLogPanel.tsx:1963-1982,1950,2051` | absent | missing | `unserved:` STRUCTURAL, the same argument as C40/C41 — a `prepare` contract is `checkpoint: "in-memory-only"` and an unconfirmed write is a `parked-write` run with no checkpoint (D252's row) |
| D4 | `ReceiptCapturesSection` and its whole stack — `Screenshots` label + count Badge, the per-kind `Chip` filter row, the `Download ▾` menu (text / JSON / copy trace), the per-step capture groups with their count Badges, `ReceiptCaptureCard`, `CaptureLightbox`, `PageFacsimile`, `ExtractionRecord`, `CaptureThumb` | `DemoEvidence.tsx:100-113,300-1039`; mounted `DemoLogPanel.tsx:1955-1957` | absent | missing | `unserved:` `RunDetailSectionResponseSchema#captures` is `declared-unserved` (D184). R6 f.19 also re-homes `context-evidence` HERE when the evidence service lands, so this is the one slot two ledger rows point at |

### D-verdict band

| # | Element | Demo | Rebuild | Verdict | Reason |
|---|---|---|---|---|---|
| D5 | band container `flex flex-col gap-snug border px-cozy py-base rounded-lg` + the four tone arms | `DemoReceipt.tsx:194-205` | `receipt.tsx:103-114` | exact | |
| D6 | `ShieldCheck` at `dsIcon.lg` + its three fg arms | `:208-218` | `:117-127` | exact | |
| D7 | the verdict WORD, read from `DS_STATUS` and never restated; `partial` keeping its own word | `:74-80,219` | `:31-37,128` | exact | the "typed once — rename the status and the receipt follows" rule ported |
| D8 | the `confidence` Chip beside the word (`{confidence} — {CONFIDENCE_COPY}`, `neutral` when verified else `warning`) | `:82-86,220-222` | absent from the band — `confidence` is a word in the body's trailing `MetaLine` (`trust.tsx:286`) | exact | `ported: D273 item 7` (unit V1, 2026-08-26) — the band carries `confidence {word} — {CONFIDENCE_COPY}` beside the verdict word, the demo's pairing, as a tinted span rather than a `Chip` so the sentence wraps instead of truncating (`receipt.tsx:246`) |
| D9 | band `MetaLine` — `receipt {id} · generated {clock} · attempt N · retry of X · filed by {actor}` | `:224-232` | scattered: `completed {clock}` on the band `:130`, `receipt {id} · run {id}` in a `Receipt` section `:84`, and `confidence / result / attempt / retry of / generated` in the body's trailing MetaLine `trust.tsx:284-292` | exact | `ported: D273 item 7` (unit V1, 2026-08-26) — one band `MetaLine` from `receiptIdentityItems` prints receipt · generated · attempt · retry of in the demo's order, with run / failure / completed beside them. The receipt stops ending on the facts the demo opens with (`receipt.tsx:251`) |
| D10 | `filed by {actor}` | `:230` | absent | missing | `unserved:` `RunEvidenceReceiptSchema` carries no actor (`src/domain/trust/evidence.ts:128-152`). D82 derives the receipt from authority and the run's `actorId` is on the QUEUE surface, not on the receipt |

### D-banners

| # | Element | Demo | Rebuild | Verdict | Reason |
|---|---|---|---|---|---|
| D11 | the `receiptInvariant` Banner — "This receipt fails its own invariant — the verdict is not printed as fact" | `:235-239` | absent | missing | `ruled: D273 item 7` (unit V1, 2026-08-26) — **NEVER PORTED, deliberately**, which is the item's own "never the unrepresentable invariant banner". The reasoning the audit found nowhere is now written down at `receipt.tsx:134-150` and PINNED by `receipt-invariant-unrepresentable.test.ts`: an unmet-verification receipt throws at the boundary rather than reaching this component, so a banner here could only ever be dead code claiming a check it does not perform |
| D12 | the TEST-instance Banner, both sentences verbatim | `:241-246` | `receipt.tsx:75-80` | exact | drawn from the ROW's `resolvedInstances` rather than the receipt's own, stated `:48-52` |
| D13 | the DRY-RUN Banner — info, "Dry run — this run was a rehearsal", "A dry run reads everything and writes nothing. Any value below is an observation, never a change." | `:248-252` | absent | exact | `ported: D273 item 7` (unit V1, 2026-08-26) — the info Banner with both demo sentences, drawn on a REQUIRED `dryRun === true` only: a caller that does not know the answer cannot render "not a rehearsal" about a run that was one (`receipt.tsx:164`) |

### D-sections

| # | Element | Demo | Rebuild | Verdict | Reason |
|---|---|---|---|---|---|
| D14 | `ReceiptSection` = `<section>` + `SectionLabel` + `gap-snug` children | `:95-102` | `receipt.tsx:39-46` / `trust.tsx:70-77` (`TrustSection`, which adds an `aria-label`) | exact | |
| D15 | `Who the system said this was, at the moment of the write` — the `subjectAtCommit` Well: `ScanEye`, the name, an `EID` Chip, `SystemTag`, the right-hand clock, the proof sentence | `:254-270` | absent | missing | `unserved:` the receipt schema has no subject-at-commit block. The fact EXISTS one table over — the write intent's fenced subject digest, and `FailureDetailWire.subject` renders the analogous pair on the failure side — so the producer is the receipt DERIVATION projecting it, not a new observation |
| D16 | `What was written, and what proved it` — a `WriteAction` `Well` per commit/prepare | `:104-180,272-280` | a flat `Actions` `TrustSection`: one `FactRow` reading `{taskId}` · `{kind} — {WRITE_STATE_SENTENCE}` · `{clock}` `trust.tsx:226-237` | divergent | the region's largest gap; each missing part is D17–D22 |
| D17 | the `commit` / `prepare` Badge (info / neutral) | `:110` | absent — the kind is folded into the value string | divergent | `unserved:` the kind IS served (`ActionEvidenceSchema.kind`); the Badge is not drawn. **OPEN — operator call** |
| D18 | the action `target` + `SystemTag` + the right-hand clock | `:111-113` | `taskId` only; no system, clock at the row's `meta` | divergent | `unserved:` `ActionEvidenceSchema` carries `{id, taskId, kind, writeState, proofRef?, artifactId?, occurredAt}` — no target and no system |
| D19 | the `wrote[]` field/value table inside the Well | `:116-123` | absent | missing | `unserved:` same — the receipt's action entry carries no written values |
| D20 | the CONFIRMATION block — success-tinted, `{label}` in caps + the number — OR the fallback sentence "{SYSTEM} issues no confirmation number for this operation — the read-back below is the proof." | `:125-141` | absent | missing | `unserved:` no confirmation on the action entry. This is the single most operator-visible absence on the receipt: the number an HR filing is quoted by |
| D21 | the READ-BACK block — four arms (`read back` / `NOT read back — the system cannot show it` / `NOT read back — no check was made` / `read-back FAILED — outcome unverified`), each with its icon, its tint, the observed-or-note line and the clock | `:88-93,143-175` | absent per action; the receipt's `Verification` section carries obligations and verdicts instead | divergent | `unserved:` the action entry has a `proofRef` but no read-back verdict. The FACT is in the receipt (a `verification` entry), just not beside the write it proves |
| D22 | `action.detail` | `:177` | absent | missing | `unserved:` no detail on the action entry |
| D23 | `Per-person confirmations (N)` — the four-column `Table` (Person / EID / Confirmation / Read back) with the `verified` / `none to read` / `unverified` arms, and the D17 note beneath it | `:282-330` | absent | missing | `unserved:` no `members` on the receipt, and no `operation`-shaped workflow exists — the same producer B111 and the member-roster ledger row wait on |
| D24 | `Completion criteria` — per criterion a `Check`/`X`/`CircleAlert`, `{criterion} — {result}`, `{method} → {observed} · {clock}`, and the note | `:332-368` | `Verification` — one `FactRow`: `{obligation}` · `{verdict}` · `required` `trust.tsx:239-253` | exact | `ported: D273 item 7` (unit V1, 2026-08-26) — `VerificationMarkGlyph` puts the demo's `Check` / `X` / `CircleAlert` over the SERVED verdict on each criterion. The method, observed, instant and note columns stay `unserved` (`trust.tsx:837`) |
| D25 | `What was read` — the observations `Table` (Field / Value / System / Observed) plus the per-read action rows | `:370-411` | `Observations` — a `FactsSection` of `FactRow`s printing `{field}` · `{value}` · `{source.kind}` `trust.tsx:211` | PORTED | `ported cf2ee74a` — was: **OPEN, SERVED-AND-DROPPED**. `EvidenceSourceSchema`'s `system` and `checkpoint` arms carry `taskId` AND `observedAt` (`evidence.ts:25-26`); `trust.tsx` prints `source.kind` alone. The demo's `System` and `Observed` columns are both derivable from the bytes already on the wire. **Closed** by `evidenceSourceMeta` (`trust-model.ts`), a TOTAL fold over the six source arms — the facts ride the per-ENTRY fact rather than a section footer, because this tree's facts are per-entry and a footer would have to pick one to speak for the rest |
| D26 | `What was decided, and why` — `{key}: {outcome}` + `decided by the operator \| decided by rule · {clock}` + the reason | `:413-429` | `Decisions` — `{kind} — {outcome}` · reason `trust.tsx:213-224` | divergent | `unserved:` `DecisionEvidenceSchema` has no `by` and no `at`. Derivable one hop away for a GATE — D204's `gate-result` source arm carries `resolvedBy`/`resolvedAt` and the decision cites it through `evidence[]` — which makes this a derivation, not an observation |
| D27 | `The input this run was given` — a `KeyValueList` with `· redacted at capture`, and an `input hash {…}` `MetaLine` | `:431-439` | `Input` — a `FactsSection` printing `redacted — {classification}` for a redacted value `trust.tsx:210` | divergent | the redaction treatment is exact-equivalent (and stronger — it names the classification). The `input hash` line was **OPEN, SERVED-AND-DROPPED** (`EvidenceSourceSchema`'s `input` arm carries `inputFingerprint`, `evidence.ts:24`) and is `ported cf2ee74a` — it rides the same `evidenceSourceMeta` line as D25, cut through `shortHash` |
| D28 | `Fresh or replayed` — `{lane} — {label} · {age}` + the detail sentence | `:441-453` | `Reused evidence` — `{kind}` · `{age} old` · `limit {age}` `trust.tsx:257-268` | divergent | `unserved:` `ReuseEvidenceSchema` carries `{id, kind, source, ageMs, freshnessLimitMs}` — `kind` is the demo's `lane`; there is no label and no detail. The rebuild ADDS the limit, which the demo does not print |
| D29 | `What remains uncertain` — `CircleAlert` + the text + the explicit "load-bearing — this is why the run cannot read as done" / "declared non-load-bearing — it cannot change the transaction or the core result" sentence | `:455-473` | `Warnings` — `{code}` · summary · a `load-bearing` meta word `trust.tsx:270-282` | exact | `ported: D273 item 7` (unit V1, 2026-08-26) — the Warnings rows carry the `CircleAlert` mark and `uncertaintySentence(loadBearing)`: both of the demo's full sentences, where one word had stood on the section whose whole job is saying what is still uncertain (`trust.tsx:874`) |
| D30 | the receipt `note` paragraph | `:475-477` | absent | missing | `unserved:` no `note` on the receipt |
| D31 | the FINGERPRINT footer — `border-t pt-base`, the `Fingerprint` glyph, and `trace` / `descriptor` / `config` Chips | `:479-484` | absent | PORTED | `ported cf2ee74a` — was: **OPEN, SERVED-AND-DROPPED**. `traceId`, `descriptorFingerprint` and `configFingerprint` are all on `RunEvidenceReceiptSchema` (`evidence.ts:129,135-136`), and D199's whole argument is that the receipt's `descriptorFingerprint` is a fact about THAT RUN. The provenance bar prints two of the three; the receipt — the artifact read months later — printed none. **Closed** by `ReceiptFingerprints` (`trust.tsx`), the demo's footer element for element: last, under a subtle rule, `Fingerprint` glyph, three chips. The two hashes cut through `shortHash` (the product's ONE id length) with the whole value on the chip's `title`; the trace id is legible and prints whole |
| D32 | the receipt's own `failure` id | (no counterpart — the demo has none) | absent | PORTED | `ported cf2ee74a` — was: **OPEN**, `unserved`-inverse (`RunEvidenceReceiptSchema.failure` is served and was drawn nowhere, so a failed run's receipt did not name the failure record beside it). **Closed** on the receipt's identity `MetaLine` (`receipt.tsx`), beside `receipt {id} · run {id}` |
| D33 | SECTION ORDER | verdict → invariant → test → dry-run → subject → writes → members → criteria → reads → decisions → input → reuse → warnings → note → fingerprints | input → observations → decisions → actions → verification → output → reuse → warnings → trailing meta | divergent | `ruled:` stated `trust.tsx:14-15` — "the receipt's schema order IS the narrative order". Note it inverts the demo's: the demo opens on the WRITE and closes on the input; this opens on the input |
| D34 | an `Output` facts section | (no counterpart — the demo's equivalent is the writes block) | `trust.tsx:255` | extra | `ruled:` `RunEvidenceReceiptSchema.output` |
| D35 | empty sections omitted rather than explained | throughout | `trust.tsx:16-17` | exact | D24 restraint |
| D36 | the receipt-ABSENT arms — `missing` / `purged` EmptyStates and an `error` danger Banner carrying the code | (no counterpart — the demo's receipt always exists) | `receipt.tsx:88-94` | extra | `ruled: D184/D198` declared-absence pattern |
| D37 | `SystemChip` atom | `DemoEvidence.tsx:66-84` | `system-chip.tsx:28-46` | exact | `SYSTEM_ACCENT` maps every system to the ONE `SYSTEM_CHIP` class (`demo-data.ts:67-75`), so a single constant is byte-equivalent; the label goes through `SYSTEM_LABEL` rather than `toUpperCase()`, stated `:7-10` |
| D38 | `SystemTag` atom, with `· TEST` called out | `DemoEvidence.tsx:87-97` | `system-chip.tsx:49-58` | exact | |
| D39 | `receipt.tsx`'s own header comment | — | `:5-11` calls itself "the 1i Receipt PLACEHOLDER" and says the full body "lands with the trust surfaces in 2g" | — | `ported: D273 item 7` (unit V1, 2026-08-26) — **CLOSED as a stale claim.** `receipt.tsx:13` no longer calls itself the 1i placeholder awaiting 2g; the header now states what the file renders |

**R-D counts — 39 rows: 9 exact · 15 divergent · 12 missing · 3 extra** (D39 is a comment, counted
in none of the four). Four rows moved to PORTED on 2026-08-21, `cf2ee74a`; the counts above are the
AUDIT's, kept as taken.

**Since 08-14:** the whole region is new to the ledger. What moved at HEAD: 2g's
`ReceiptEvidenceBody` replaced the 1i placeholder body (D5–D9, D24–D29 all describe a real body
rather than an empty frame), and D199 put the run's OWN `descriptorFingerprint` on the receipt —
which is what makes D31 a served-and-dropped finding rather than a wire gap.

**OPEN in R-D — 10 questions at audit; the four SERVED-AND-DROPPED ones are CLOSED (`cf2ee74a`,
2026-08-21, unit F1): D25 the observation's `taskId` + `observedAt` · D27 the `inputFingerprint` ·
D31 the `trace` / `descriptor` / `config` footer · D32 the receipt's `failure` id.**

**The remaining six are CLOSED too (`ruled: D273 item 7`; the ports landed in unit F8a, the
dispositions in unit V1, 2026-08-26):** ~~D8 the confidence Chip and its three sentences~~ (a
tinted span rather than a Chip, so the sentence wraps instead of truncating) · ~~D9 the scattered
identity line~~ (one band `MetaLine`, the demo's order) · ~~D11 the invariant Banner~~ (**never
ported, deliberately** — D273 item 7's "never the unrepresentable invariant banner"; the reasoning
the audit found nowhere is now written down and pinned) · ~~D13 the dry-run Banner~~ (both
sentences, on a REQUIRED flag) · ~~D24 the criterion icon~~ · ~~D29 the uncertainty icon and its
two full sentences~~ · ~~D39 the stale placeholder comment~~. **D17 the commit/prepare Badge**
landed with them; its row is held by the receipt/trust ACTION-entry unit and is dispositioned
there, not here.

---

## R-E — The failure record

**Demo:** `DemoFailure.tsx` (398).
**Rebuild:** `InlineFailureRecord` (`log-panel.tsx:696-777`) + `FailureDetailBody`
(`trust.tsx:87-175`) + `FailureAdvisoryPanel` (`advisory.tsx:51`).

**FIRST AUDIT** — the 08-13 wave never opened `DemoFailure.tsx`. Image-verified against
`tests/parity/references/run-failed--paper-ink--1440x900.png` at 1440×900.

| # | Element | Demo | Rebuild | Verdict | Reason |
|---|---|---|---|---|---|
| E1 | card geometry — `mx-cozy my-base ml-5 border p-cozy`, `dsRadius.lg`, `dsFocus`, `border-[length:--ds-border-w-rail]`, danger tint; same shape as the inline decision | `DemoFailure.tsx:169-177` | `log-panel.tsx:718-726` | exact | |
| E2 | anchor — `tabIndex={-1}`, a `data-*` hook, an `aria-label` | `:165-168` | `:714-717` | exact | `data-demo-failure-record` → `data-panel-failure-record`; the label is `Failure record — {summary}` vs a bare `Failure record` — see E4 |
| E3 | head `TriangleAlert` at `dsIcon.md` in danger | `:180` | `:729` | exact | |
| E4 | the head's WORDS | `{failure.summary}` — the run's own sentence, semibold, in danger `:181` | the constant `This run failed` `:730-732`, with `summary` moved into the body's first line (`trust.tsx:107`) | exact | `ported: D273 item 8` (unit V1, 2026-08-26) — the head prints `{detail.summary}`, the run's own sentence, semibold in danger. The constant `This run failed` stated a category where the demo states the fact (`trust.tsx:276`) |
| E5 | head `code` Chip (danger) | `:182-184` | absent from the head — `code` is the first item of the body `MetaLine` (`trust.tsx:114`) | exact | `ported: D273 item 8` (unit V1, 2026-08-26) — the danger `code` Chip is back in the head beside the summary (`trust.tsx:279`) |
| E6 | head permanence Chip — `transient — a later attempt may differ` / `permanent — the same input will fail again` | `:185-187` | a bare `transient` word in the body `MetaLine`, and NO permanent arm at all (`trust.tsx:115`) | divergent | `ruled: D273 item 8` (unit V1, 2026-08-26) — both arms land VERBATIM (`transient — a later attempt may differ` / `permanent — the same input will fail again`), which is the row's whole point: the permanent reading is the one that tells the operator not to press retry. They ride a wrapping `MetaLine` sentence rather than the demo's Chip, because a Chip truncates the half of the sentence that carries the instruction (`trust.tsx:301`) |
| E7 | head `record {failureId}` Chip | (no counterpart) | `log-panel.tsx:733-737` | extra | reasonable — the record's own id; uncited |
| E8 | **`What this run left behind`** — its own labelled, bordered block (`ml-5 border p-base rounded-md`, surface-1), with the write-state sentence in one of three tones | `:190-205` | the sentence alone, bold, in the body flow, no block, no label, no tone (`trust.tsx:108-111`) | exact | `ported: D273 item 8` (unit V1, 2026-08-26) — the write-state sentence has its own bordered, `aria-label`ed `What this run left behind` block again. `WRITE_STATE_SENTENCE`'s six arms were already verbatim, so the frame was the whole of what this row was missing (`trust.tsx:390`) |
| E9 | the write-state tone arms (`none` → success, `unknown` → parked, else waiting) | `:156-161,202` | absent — one weight for all six states | divergent | `ruled: D273 item 8` (unit V1, 2026-08-26) — the demo's tone arms land over THIS palette: `nothing-written` to success, every other state to the waiting hue. `unknown` takes no third token because parked and waiting are one colour here, so a separate arm would claim a distinction the palette cannot draw (`trust.tsx:225`) |
| E10 | the MIRRORED child Banner (D13) — the danger banner, the verbatim child error, `child {trace}`, the "quoted verbatim…" note, and the `Open the child run` button | `:208-232` | absent | missing | `unserved:` no producer — no descriptor declares a `child-run` node and `ChildRunExecutor` is unwired (delegation ledger row, CLOSED 2026-08-20) |
| E11 | **`What is safe to retry`** — the section label | `:234-235` | `What to do` (`trust.tsx:143`) | exact | `ported: D273 item 8` (unit V1, 2026-08-26) — the section is labelled `What is safe to retry`, the demo's question, rather than the instruction list `What to do` (`trust.tsx:423`) |
| E12 | per-remediation SAFETY verdict — `safe` / `needs a fix first` / `blocked`, each with `Check`/`CircleAlert`/`CircleSlash` and its tone | `:54-58,237-253` | a `remediation` Chip naming the KIND (`Retry` / `Operator` / `Configuration` / `Code change` / `No safe action`), `danger` only on `no-safe-action` (`trust.tsx:98-104,146-148`) | divergent | `unserved:` `RemediationActionSchema` carries `{kind, message}` and no safety verdict (`src/domain/trust/failure.ts:37-42`). The two axes overlap only at `no-safe-action` ↔ `blocked` |
| E13 | remediation `label` + `detail` on two lines | `:255-258` | one line: Chip + `message` | divergent | `unserved:` the wire carries one `message`, not a label/detail pair |
| E14 | the BLOCKED options are listed with their reasons rather than hidden | `:130-133,237` | preserved — every served remediation renders | exact | the rule ports even though the vocabulary does not |
| E15 | **the disclosure** — `Show the diagnostic record` / `Hide the diagnostic record` + a rotating `ChevronDown`, `aria-expanded`, `data-demo-failure-toggle`, and everything below it behind that press | `:266-281,284` | absent — every section renders unconditionally | exact | `ported: D273 item 8` (landed `823b266b`; disposition unit V1, 2026-08-26) — `Show the diagnostic record` / `Hide the diagnostic record` is a real `<button>` with `aria-expanded` (`trust.tsx:454-473`), and the classification, cause chain and bundle sit behind it again, so a 400px dump no longer buries the lines after it |
| E16 | `What had already happened when it failed` — the four-column progress `Table` (Step / State / System / What it left behind) with the `done` / `FAILED HERE` / `never ran` vocabulary | `:60-64,286-310` | absent | missing | `unserved:` `FailureDetailWireSchema` carries no progress ledger. The facts exist elsewhere (`timeline.steps` states, and `writeState` per action on the receipt) — the producer is a projection joining them, not a new observation |
| E17 | `Classification` `KeyValueList` — `Fingerprint` | `:316` | in the Cause-chain `MetaLine`, truncated to 12 chars + `…` (`trust.tsx:166`) | divergent | ruled by nothing; the truncation is sensible and uncited — folded into E20 |
| E18 | `Classification` — `Code` | `:317` | the body `MetaLine` (E5) | divergent | see E5 |
| E19 | `Classification` — `Occurred {clock}` | `:318` | absent; the rebuild prints `failed {completedAt}` off the OUTCOME instead (`log-panel.tsx:743`) | PORTED | `ported df5ea509` — was: **OPEN, SERVED-AND-DROPPED**. `FailureDetailWireSchema.occurredAt` is required and was drawn nowhere; the run's terminal instant is a DIFFERENT moment from the failure's. **Closed** as `occurred {clock}` on the body's first `MetaLine`, in the demo's position (after `code`). The panel's `failed {completedAt}` STAYS: both are true and each is now named for what it dates |
| E20 | `Classification` — `Run: {traceId} · attempt {N}` | `:319` | absent | PORTED | `ported df5ea509` — was: **OPEN, SERVED-AND-DROPPED** (`traceId` and `attempt` are both required on `FailureDetailWireSchema`). **Closed** as `run {traceId} · attempt {N}`, the demo's `Run` row, before `node`/`task` as the demo has it |
| E21 | `Classification` — `Node` / `Task` | `:320-321` | the body `MetaLine`, as `node {id}` / `task {id}` (`trust.tsx:116-117`) | exact | same facts, one line instead of two rows |
| E22 | `Classification` — `Subject expected` / `Subject observed` (the observed row in danger tone) | `:322-325` | a `MetaLine` pair using `displayRedacted ?? digest` (`trust.tsx:122-131`) | exact | `ported: D273 item 8` (unit V1, 2026-08-26) — the `observed` half of the Classification pair renders in `--ds-danger`, the demo's tone; the redaction preference stays as `trust.tsx:11-13` states it (`trust.tsx:516`) |
| E23 | `Classification` — `Screen` / `Page state` | `:326-327` | the `MetaLine` at `trust.tsx:135-136` | exact | |
| E24 | `Classification` — `URL (redacted)` | `:328` | absent | PORTED | `ported df5ea509` — was: **OPEN, SERVED-AND-DROPPED** (`page.urlRedacted` on the wire and drawn nowhere; `page.titleRedacted` served with no demo counterpart). **Closed** — BOTH halves of the served `page` block draw, as `title (redacted) {…}` / `url (redacted) {…}`. The parenthetical is the demo's own word and is load-bearing: these were redacted AT CAPTURE, so what prints is the whole of what the record holds |
| E25 | `Classification` — `Failed action: {operation} on {elementId} · step {N}` | `:329-338` | `during {operation}` + `step {N}`; `elementId` is dropped (`trust.tsx:137-138`) | PORTED | `ported df5ea509` — was: **OPEN, SERVED-AND-DROPPED** (`action.elementId` is on the wire). **Closed** as `on {elementId}` beside `during {operation}`. The demo's `{operation ?? "action"}` fallback is NOT ported: an unserved half drops out of the line rather than being spoken for. The fixture corpus carries no `elementId`, so the arm is drawn and unphotographed |
| E26 | `subject.note` paragraph | `:341-343` | absent | missing | `unserved:` no note on the subject union; `proofRef` is served and also undrawn |
| E27 | `Cause chain` as an ordered `<ol>` with a `w-14` caps LAYER column, the text, and a per-cause clock | `:346-359` | a `TrustSection` of `FactRow`s: `primary — {code}` / `secondary — {code}` · summary · a `transient` meta (`trust.tsx:154-163`) | divergent | `unserved:` `FailureCauseSchema` carries `{code, summary, role, transient}` — no layer, no instant. The ROLE is the rebuild's own axis and is a real improvement; the `<ol>` ordering is lost |
| E28 | the `Diagnostic bundle {id}` BUTTON (`Package` glyph) | `:361-364` | `FailureDetailBody`'s exact labeled secondary action, with the existing explicit absent sentence | exact | `ported Track F ledger 2 E29` — the button opens only from the `present` bundle-id arm; the absent arm stays explicit and does not pretend a package exists |
| E29 | `BundleDialog` — `lg`, `Diagnostic bundle {id}` title, the `Captured {clock} · {size} · content-addressed, redacted at capture time` description, the explanatory paragraph, the per-content `Check` + key + detail list, the `Redacted at capture, never at render` info Banner, `Close` + `Download the manifest` | `:66-108` | `GET /api/v1/diagnostic-bundles/:bundleId` reads the exact durable D137 row and verified attachment bytes; `…/manifest` downloads its canonical durable JSON | exact | `ported Track F ledger 2 E29` — strict wire serves captured clock, recorded attachment-byte total, re-derived content digest, attachment identity/details and the capture-time redaction facts; missing, corrupt and mismatched rows leave as typed route errors rather than a guessed bundle |
| E30 | `Seen {N}× in {window} — last {trace} at {clock}. {note}` / `First time this fingerprint has been seen.` | `:365-376` | `same failure seen {N} times`, in the body `MetaLine`, drawn only when `> 1` (`trust.tsx:118`) | divergent | `ruled: D273 item 8` (unit V1, 2026-08-26) — the separate OPEN this row named is CLOSED: `failureFingerprintHistory` prints `First time this fingerprint has been seen.` at a count of one, so silence and "seen once" no longer read the same (`trust.tsx:593`). The demo's `lastTrace` half stays refused by D141 |
| E31 | `This failure happened on a member row, not on this one.` | `:379-383` | absent | missing | `unserved:` no member rows (same producer as B111) |
| E32 | `What the run said` — the run's own `error`-level notes, clock + message, beneath the record | (no counterpart) | `log-panel.tsx:755-773` | extra | `ruled:` stated `:685-695` — 1i served the record's identity and the surrounding facts before the ref operator-trust projection landed; it stayed because the stream's own words are the evidence for the summary |
| E33 | `FailureAdvisoryPanel` — the `AI advisory` section, its `Explain this failure` button, the availability refusal | (no counterpart) | `log-panel.tsx:747` + `advisory.tsx` | extra | `ruled: D178` — below the record's own remediation, never above it, stated `:745-746` |
| E34 | the record's non-`available` arms (`error` → code + message; `missing`/`purged` → the reason) | (no counterpart) | `log-panel.tsx:749-753` | extra | `ruled: D184/D198` declared-absence pattern |

**R-E counts — 34 elements: 9 exact · 14 divergent · 7 missing · 4 extra.** (Four rows moved to PORTED on 2026-08-21, `df5ea509`; E28/E29 moved to exact on 2026-08-25.)

**Since 08-14:** first audit. The body itself is 2g/2i-A work (`FailureDetailBody`, D140/D142) that
post-dates the 1i frame; nothing in this region regressed during the fidelity wave, and nothing in
the fidelity wave audited it.

**OPEN in R-E — 12 questions at audit; the four SERVED-AND-DROPPED ones are CLOSED (`df5ea509`,
2026-08-21, unit F1): E19 `occurredAt` · E20 `traceId` + `attempt` · E24 `page.urlRedacted` and
`page.titleRedacted` · E25 `action.elementId`.**

**The eight WORD-and-GLYPH ones are CLOSED too (`ruled: D273 item 8`; the ports landed in units
F8b/F8c, the dispositions in unit V1, 2026-08-26):** ~~E4 the head says a category where the demo
says the fact~~ · ~~E5 the `code` Chip~~ · ~~E6 the missing `permanent` arm~~ (both arms land
verbatim, on a wrapping `MetaLine` rather than a Chip that truncates the half carrying the
instruction) · ~~E8 the write-state block's frame and label~~ · ~~E9 its three tones~~ (two of
them: `unknown` takes no third token because parked and waiting are one colour here) ·
~~E11 `What is safe to retry` vs `What to do`~~ · ~~E22 the observed-subject danger tone~~ ·
~~E30's `First time this fingerprint has been seen.` arm~~. **E15 the whole disclosure** landed
with them (`823b266b`). Nothing in R-E is left open.

---

## R-F — Park / resolve, and the gate ceremonies

**Demo:** `DemoParkResolve.tsx` (375) + `DemoActions.tsx:231-280` (`ParkResolutions`, R8 f.1's oracle)
+ the gate half of `DemoLogPanel.tsx`'s `InlineDecision` (`:268-338,406-427`).
**Rebuild:** `src/dashboard/surfaces/park-resolve.tsx` (792) + `park-resolve-model.ts` +
`identity-approve.tsx` (606) + `identity-approve-model.ts` + `app/identity-ceremony.ts` +
`app/proof-form.ts`; `ParkResolutions` in `actions.tsx`.

**RE-AUDIT + FIRST AUDIT.** R8's park/resolve half (25 elements, findings 1–3, 13–16, 19–21) is
re-checked at HEAD after `9847877`. The identity-approval ceremony did not exist at R8 time and is
first-audited here. Image-verified against
`tests/parity/references/run-parked-write--graphite-warm--1440x900--resolve-absent.png`.
`DemoActions.tsx` as a whole belongs to another unit; only the park-resolution CARDS are audited
here, because they render inside this region's surfaces.

### F-park, in the stream

| # | Element | Demo | Rebuild | Verdict | Reason |
|---|---|---|---|---|---|
| F1 | `InlineParkedWrite` — the parked write as its OWN in-stream record | (the demo folds `parked` into `InlineDecision`) | `park-resolve.tsx:169`, mounted `log-panel.tsx:1092-1095` | extra | `ruled: ref write-safety §4.1` + the `GateDecisionWireSchema.kind` ledger row (CLOSED 2026-08-20) — `parked` is not a gate in this tree, so an icon arm keyed on it would draw a gate over a run that has none |
| F2 | `Bound to` — the `SubjectFacts` chips (identifier kind + display suffix, artifact, catalog key, binding digest, proof id, observed clock; or the `unscoped` arm with its reviewed reason) | the `gate.staged` block one surface over `DemoLogPanel.tsx:429-453` | `park-resolve.tsx:129-156,222` | divergent | `ruled:` same row as F1 — the demo names STAGED FIELDS, this names the FENCED SUBJECT, because those are the two different things the two models park on |
| F3 | the kernel's own `parkedMessage`, verbatim, with no friendlier paraphrase beside it | (the demo authors its own gate copy) | stated `park-resolve.tsx:14-19` | extra | `ruled:` stated in code — ref write-safety §4's `park()` interpolates a driver error or a probe's reason, and a second sentence would be this surface guessing at a live transaction |
| F4 | `ParkResolutions` — tinted cards, `CheckCircle2` / `CircleSlash`, the bold served label, the served `detail` in muted meta, two columns | `DemoActions.tsx:231-280` | `actions.tsx` `ParkResolutions` | exact | R8 f.1 as-built (`9847877`); the `banner`-placement PARTITION is test-pinned |
| F5 | the cards' two-column rule | a plain two-column grid | a CONTAINER query `@min-[35rem]:grid-cols-2` | divergent | `ruled:` stated in code — these render in the detail region's centre column, whose width is a function of the rail's state; keyed to the window, two resolutions were forced side by side into a 414px column |

### F-park dialog

| # | Element | Demo | Rebuild | Verdict | Reason |
|---|---|---|---|---|---|
| F6 | `Dialog open onOpenChange` + `DialogContent size="lg"` | `DemoParkResolve.tsx:157-160` | `park-resolve.tsx:661-665` | exact | R8 f.13 |
| F7 | dialog TITLE + DESCRIPTION | client-authored per arm (`Record the write as PRESENT` / `…ABSENT`, plus the two sentences naming the workflow and the system) `:160-165` | the SERVER's `confirm.title` / `confirm.body` `:665` | divergent | `ruled: R8 f.19` + `ref frontend-backend-integration §8.5` — on record as a deliberate deviation |
| F8 | the fence-facts `Well` — a flex-wrap chip row | `subject` · `fenced` · `generation` · `fence clears` `:333-340` | `system` · `fenced` · `generation` · `key` + the inline `SubjectFacts` chips `:676-684` | divergent | R8 f.14 as-built (the flex-wrap `Well`, not a `ChipRow` grid). `system` and `key` are additions; `fence clears` is absent — see F17 |
| F9 | the refusal block — `Refusal` when the server sent a code, a danger `Banner` when it did not, with "nothing was recorded · your answer below is untouched" | above the fields `:170-184` | `RefusedNotice` in a RESERVED `min-h-[--ds-h-lg]` slot BELOW the fields `:425-463,750-752` | divergent | `ruled: R8 f.2` as-built — the two arms map EXACTLY onto this wire (`rejected` has a required `code`, `conflict` has none) — plus R8 f.21's reserved-space decision, cited and kept |
| F10 | `Which {system} record did you open?` — a `RadioGroup` over `fence.candidates`, with the `subject-key-mismatch` error and the same-name-neighbour note | `:186-198` | absent | missing | `ruled: R8 f.20` — the subject is correctly read-only: the wire serves ONE fenced subject, so a chooser would offer a choice the fence itself refuses |
| F11 | present arm — `What is your proof?` `RadioGroup` (`I read the confirmation on the page` / `The page could not be shown — my attestation`) | `:202-219` | absent | missing | `unserved:` the served proof contract is an ordered FIELD LIST (D245) with no operator-attestation arm |
| F12 | present arm — the proof `Field` (label from `fence.proofLabel`, the format description, the `proof-parse-failed` error, an `Input` with `spellCheck={false}` and the example placeholder) | `:220-233` | `ProofForm` — the contract's own ordered fields, per-field labels and hints, a `Select` for booleans, composed and bound to the SERVED hash `:325-397` + `app/proof-form.ts` | divergent | `ruled: D245` — a single free-text box would be the client guessing the proof's shape; where the build cannot describe it, `ProofUnavailable` prints the server's reason |
| F13 | present arm — the attestation `Textarea` and its "same weight, signed by you" description | `:234-248` | absent | missing | `unserved:` no operator-attestation arm on the served contract (same producer as F11) |
| F14 | absent arm — `What did you check, and what did you see?`, its description, the `Textarea` and the placeholder | `:252-264` | `:710-742` | exact | the sentence and the placeholder are the demo's, with `for this EID` in place of the fixture EID |
| F15 | the evidence `Field` on the PRESENT arm too, with its own question (`Where did you see this, and how did you get there?`) | (present arm has none) | `:703-717` | extra | `ruled: D245` — the kernel's present payload requires a note; the proof says what the page held and this says where the operator stood |
| F16 | absent arm — `How many times did you look?` over `OBSERVATION_OPTIONS` (`Once, just now` / `Twice, at least 10 minutes apart` / `Twice, back to back`), with the fence-clears sentence appended while uncleared, and its `FieldNote` | `:52-68,265-288` | absent | missing | `ruled:` stated `park-resolve.tsx:24-27` — ref write-safety's `recoveryAbsence` is `operator-only` for every contract but the one live-measured Kuali write, the wire serves no fence window, and a `minSinceFenceMs` invented here is exactly the banned constant |
| F17 | `fenceCleared` / `fenceClearsAt` and the `fence clears` chip | `:121,337-339` | absent | missing | same as F16 |
| F18 | `FieldNote` — an error REPLACES the note, `role="alert"` | `:316-325` | the DS `Field`'s own `error` slot, with a refusal suppressing it `:718-733` | divergent | `ruled: R8 f.16` as-built — widened past the port: BOTH note problems (empty and over-500) land on the Field, and a server refusal suppresses it so there are never two verdicts on one answer |
| F19 | footer `Not yet` (secondary) | `:294-296` | `:758-760` | exact | |
| F20 | footer primary — the ARM picks the variant and the glyph (`primary` + `CheckCircle2` / `danger` + `CircleSlash`) | `:297-304` | `:776-787` | exact | R8 f.3 |
| F21 | footer primary LABEL | client-authored `I saw it — record present` / `I looked — record absent` `:303` | the server's `confirm.confirmLabel` `:786` | divergent | `ruled: R8 f.19`, `ref frontend-backend-integration §8.5` |
| F22 | footer `meta` slot | (none on this dialog) | `{runId} · rev {N} · generation {N}` `:756` | exact | `ported: D273 item 9` (unit V1, 2026-08-26) — "remove park footer metadata": the `DialogFooter` takes no `meta` slot at all and the run/rev/generation line is gone. The generation was already a fence chip four lines up (`park-resolve.tsx:711`) |
| F23 | `loading` on the primary rather than a swapped label | (the demo's submit is synchronous) | `:761-763,779` | extra | `ruled:` stated in code — the label stays put so the button never changes width under a pointer mid-click |
| F24 | the submit's disabled predicate | `canSubmit`, from the typed values `:148-154` | `blocked`, folding the note problem, the per-field proof problems and the in-flight state, plus `title={blocked}` `:778-780` | divergent | `ruled: R8 f.16` (the reason moved to the Field; the `title` is the residue) |
| F25 | a fresh open resets the answer, but never mid-flight | `:106-117` | `:527-531` | exact | |
| F26 | `SettlingPanel` — the info Banner, the spinner, `Still parked — settling N of M observations`, the next-probe sentence, the `fence cleared` / `waiting` / `not_before` MetaLine | `:350-374` | absent | missing | `ruled:` stated `park-resolve.tsx:28-33` + D198 — `createWriteRecovery` writes NOTHING on `wait`, so no durable row carries an observation count or a `nextProbeAt` |
| F27 | the settling BAND under the outcome bar | `DemoLogPanel.tsx:2581-2585` | absent | missing | same as F26 (= B26) |

### F-gate ceremony (D226)

| # | Element | Demo | Rebuild | Verdict | Reason |
|---|---|---|---|---|---|
| F28 | WHERE the gate is answered | in the stream card: the `CandidateCard` grid plus `BannerActions`, one click per served descriptor | a DIALOG the served descriptor opens (`IdentityApproveDialog`), with the packet rendered inside | divergent | `ruled: D226` + `ref write-safety §14.11` — two of the four ceremonies need a value no served fact carries (which candidate, and why a rejection), and routing them through a confirm-only path would offer a risky approval as one click, which is §14.6 risk 1 manufactured by accident |
| F29 | `PacketSubject` — `document` · `document name` · `UCPath name` · `name tier` (warning off `same`) · `EID read` · `observed` | (no counterpart) | `identity-approve.tsx:117-130` | extra | `ruled: D226/D211` — the packet is exactly what the approval's digest binds |
| F30 | `PacketComparisons` — `What disagrees` FIRST, then `What agrees` | (no counterpart) | `:158-200` | extra | `ruled:` the 2026-08-12 lesson — `classifyNameSimilarity` answers `same` for the very incident that motivated the gate, so the packet leads with DISCONFIRMING evidence |
| F31 | the candidate list | `CandidateCard` on a `CompareGrid` with shared row tracks: heading · name · identifier · `matched on {reason}` · `See this candidate` \| `No capture — this was never on a page` | `PacketCandidates` — `Approvable candidates`, per option an `EID` Chip and a `from` Chip | divergent | `ruled: D226` for the move. The `matched on` REASON track and the capture button are absent — `unserved:` `#captures` is `declared-unserved` (D184), and the shared-row-track alignment argument (a card with no reason holds the space) has no counterpart here |
| F32 | `PacketPlan` — `What this approval authorizes` | (no counterpart) | `:238-256` | extra | `ruled: D211` — a gate DEPENDENCY is not a gate PACKET; the write plan is inside the digest the approval binds |
| F33 | `CeremonyControl` — the four SERVER-computed `approvalShape` arms: the one-candidate info Banner, `Which candidate does this separation document mean?`, `Type the employee ID this separation is about`, and `Why is this not the right person?` | (the demo has one shape: two buttons) | `:306-397` + `app/identity-ceremony.ts` | extra | `ruled: D226` + `ref write-safety §14.11` — an unrecognised shape draws a NAMED refusal and BLOCKS the send; it never falls back to the approve button |
| F34 | ceremony dialog `size="lg"` with the server's `confirm.title` / `confirm.body` | — | `:545` | extra | `ruled:` same as F7 |
| F35 | the ceremony's own `RefusedNotice` | — | `identity-approve.tsx:399-425`, byte-similar to `park-resolve.tsx:425-463` and differing only in "the gate is still open" vs "nothing was recorded" | extra | `ruled: D273 item 10` (unit V1, 2026-08-26) — "one parameterized truthful refusal notice": the forked copy is gone. Both surfaces call the shared `RefusedNotice` parameterized by ceremony (`identity-approve.tsx:531`, `park-resolve.tsx:693`), so the two sentences that must differ still differ and nothing else can fork |
| F36 | `app/identity-ceremony.ts` — the ONE pure fold both the surface and `command-dispatch.ts` read | — | 227 lines | extra | `ruled: D226` |

**R-F counts — 36 elements: 6 exact · 11 divergent · 7 missing · 12 extra.**

**Since 08-14.** R8's park findings 1, 2, 3, 13, 14, 15, 16 and 19 all landed in `9847877` and hold
at HEAD (F4, F6, F8, F9, F18, F20, F21). Two things moved after that: **D245** closed the
`proof-contract-unserved` refusal — the section now serves the commit contract's proof as an ordered
field list, `ProofForm` renders it, and the evidence note went onto BOTH arms (F12, F15) — and
**D226** built the three identity ceremonies plus rejection against the server's `approvalShape`,
which is the whole F-gate block and did not exist when R8 was written. R8's own verification limit
("the rebuild's park dialog could NOT be screenshotted") is CLOSED: `run-parked-write` is in the
corpus in four states.

**OPEN in R-F — both CLOSED (unit V1, 2026-08-26):** ~~F22 the footer meta slot~~
(`ruled: D273 item 9` — removed; the generation was already a fence chip four lines up) ·
~~F35 the duplicated `RefusedNotice`~~ (`ruled: D273 item 10` — one shared atom, parameterized by
ceremony, so the two sentences that must differ still differ and nothing else can fork).
Nothing in R-F is left open.

---

## Roll-up

### Counts

| Region | Elements | exact | divergent | missing | extra | OPEN |
|---|---:|---:|---:|---:|---:|---:|
| R-A run identity | 49 | 23 | 14 | 4 | 8 | 7 |
| R-B log panel | 114 | 50 | 26 | 23 | 15 | 9 |
| R-C context rail | 76 | 31 | 18 | 17 | 10 | 9 |
| R-D receipt | 39 | 9 | 15 | 12 | 3 | 12 |
| R-E failure record | 34 | 7 | 15 | 8 | 4 | 13 |
| R-F park + ceremonies | 36 | 6 | 11 | 7 | 12 | 2 |
| **total** | **348** | **126** | **99** | **71** | **52** | **52** |

`exact` is 36 % of the surface. Of the 97 divergences and 75 absences, **119 carry a citation**
(a D-number, an R-finding as-built, a named missing producer, or a stated in-code argument) and
**53 do not** — those are the OPEN list below, plus one recorded tension (B45).

**The counts above are the AUDIT's, kept as taken.** At HEAD on 2026-08-26 the OPEN column reads
**8**, not 52: unit F1 closed the eight served-and-dropped rows, units F6–F8c landed the ports, and
unit V1 dispositioned every word-and-glyph row against D273. The per-region "OPEN in R-x" lines
below each carry their own current reading.

### Since the 2026-08-14 wave

Two regions are re-audits (R-C = R6, the park half of R-F = R8) and one is a partial re-audit
(R-B's header = R5). **No R5, R6 or R8 finding regressed.** What changed under them is the
2026-08-19/20 decision run: D225 (the categorical strip), D226 (the ceremonies), D232/D233
(the rehearsal chip, the rename), D237/D238 (the settled-gate record, the derived outcome
sentence), D245 (the served proof contract), D250–D253 (the run modal, the rail's step/direction/
bound, the CAS conflict as a refusal), D256/D257/D259 (the served clock, the followed panel, the
replayed arm) and the 2026-08-20 ledger sweep that dispositioned every remaining wire row.

**Three regions had never been audited at all** — R-A, R-D and R-E — and they hold 32 of the 54
OPEN questions between them. That is the honest headline: the wave audited what it had oracles
for, and `DemoRunIdentity.tsx`, `DemoReceipt.tsx`, `DemoEvidence.tsx` and `DemoFailure.tsx` were
never opened.

### OPEN — operator call (54 at audit; 46 after unit F1; **10 rows after unit V1**)

**Ruled 2026-08-26 by D273.** Every WORD-level and GLYPH-level row on this sheet is now closed —
the ruled wording lands verbatim, or the named truthful exception is recorded at the code site and
in the row. Ten rows are still open and every one is structure or behaviour: **A18** the `Config`
row · **A19** the `Attempt` row · **A35/A37/A47** the rename error affordance · **B41** the
non-focusable timeline segment · **B57** the orphan-gate segment · **B79** the empty-stream state ·
**B80** the cursor-backed `Load more lines` control · **C4** the `dataExpanded` desync · **C51** the
step group's chrome · **C55/C57** the flattened refusal and the missing "your edits survived"
statement. **D17** is held by the receipt/trust ACTION-entry unit and dispositioned there.
Nothing left open on this sheet is a vocabulary question.

**Served-and-dropped (8) — ALL EIGHT CLOSED 2026-08-21, unit F1 (`cf2ee74a` the receipt four,
`df5ea509` the failure four).** They were the cheapest to close and the most surprising to leave;
each entry below keeps the audit's sentence and names what now draws it:

1. ~~**D25** the observation's `taskId` and `observedAt` — `EvidenceSourceSchema`'s `system` and `checkpoint` arms carry both; the receipt prints `source.kind` alone.~~ → `evidenceSourceMeta`, a total fold over the six source arms (`trust-model.ts`).
2. ~~**D27** the `inputFingerprint` — served on the `input` source arm; the demo's `input hash` line is absent.~~ → the same fold's `input` arm, cut through `shortHash`.
3. ~~**D31** the receipt's `traceId` / `descriptorFingerprint` / `configFingerprint` footer — all three on `RunEvidenceReceiptSchema`; the artifact read months later prints none.~~ → `ReceiptFingerprints`, the demo's footer element for element.
4. ~~**D32** the receipt's `failure` id — served, drawn nowhere.~~ → the receipt's identity `MetaLine`.
5. ~~**E19** the failure's `occurredAt` — required on the wire; the record prints the RUN's terminal instant instead, which is a different moment.~~ → `occurred {clock}`, printed BESIDE the run's `failed {clock}`; both are true and each is now named for what it dates.
6. ~~**E20** the failure's `traceId` + `attempt` — both required, both absent.~~ → `run {trace} · attempt {N}`, in the demo's position.
7. ~~**E24** `page.urlRedacted` — served, absent (and `page.titleRedacted` is served and consumed by nobody).~~ → both halves draw, as `title (redacted)` / `url (redacted)`.
8. ~~**E25** `action.elementId` — served, absent.~~ → `on {elementId}`, with no `"action"` stand-in for an absent operation.

**Structural / behavioural (7):**

9. ~~**E15** the failure record has NO disclosure~~ — **CLOSED 2026-08-26 (`823b266b`, unit F8b; `ruled: D273 item 8`).** `Show the diagnostic record` / `Hide the diagnostic record` is a real `<button>` with `aria-expanded` (`trust.tsx:454-473`), and the classification, cause chain and bundle sit behind it again.
10. **B41** the timeline segment is a non-focusable `<span>`, not the demo's `<button>` — so the member disclosure's `group-focus-within:block` can never fire, and the hover tint and focus ring are gone.
11. ~~**B65** the log stream is a FLAT list.~~ Ported 2026-08-25: contiguous producer rows now carry a sticky `step · task` heading under `--ds-panel-head-h`; notes remain ungrouped rather than taking a fabricated step.
12. **C4** `dataExpanded` is owned by two components; collapsing an expanded rail and re-opening it gives a wide rail whose header says `Run data` and whose control offers `Widen`.
13. **C51** the step group lost the `Well`, the recessed band and the row dividers R6 f.1 named beside the levels.
14. **C55 / C57** a refusal is one uncoded red span, and nothing says the operator's edits survived it.
15. **B57** the orphan-gate timeline segment — the demo keeps it so a wait can never vanish because the shape did not line up.

**Words and glyphs (24) — ALL CLOSED (unit V1, the Track F vocabulary sweep, 2026-08-26; ports
landed across units F1/F6/F7/F8a–c and are dispositioned here).** The rule applied to every one:
the ruled wording lands VERBATIM, or the truthful exception is named at the code site AND in the
row. Twenty ported, four are recorded exceptions — A38/A41 (the demo's fallbacks are unreachable on
a `.min(1)` title, and an unreachable fallback is the substitution the fail-loud rule bans), B83
(geometry ported, the DS primitive kept — a raw `<input>` beside it is a second renderer for one
control), C16 (the `aria-label` IS the visible label, under the one-expression WCAG 2.5.3 rule),
and E6/E9 (both permanence sentences verbatim on a wrapping line rather than a truncating Chip; two
tone arms, because parked and waiting are ONE colour in this palette and a third would claim a
distinction it cannot draw). **D17** landed with them and is dispositioned by the receipt/trust
ACTION-entry unit rather than here.

~~A3 · A13 · A38/A41 · B44 · B50 · B60 · B61 · B83 · B87/A49 · B91 · C16 · C21 · C32 · D8 · D9 ·
D13 · D24 · D29 · E4 · E5 · E6 · E8/E9 · E11 · E22 · E30~~

**Rebuild-only additions with no citation (8) — 4 CLOSED, 4 still open.** Closed by unit V1:
~~C70 the duplicated blocked-reason sentence~~ (`ruled: D273 item 6` — the tooltip half went, the
visible half stayed, because a reason on a `title` is unavailable to touch and keyboard) ·
~~C71 `Saving…`~~ (**retained**, D273 item 6's own "retaining Saving") · ~~F22 the park footer's
meta slot~~ (`ruled: D273 item 9` — removed) · ~~F35 the duplicated `RefusedNotice`~~
(`ruled: D273 item 10` — one parameterized atom). Still open: A18 the `Config` row · A19 the
`Attempt` row · A35/A37/A47 the rename error affordance · B79 the empty-stream state · B80 the
cursor-backed `Load more lines` control.

**Stale claims in code (2) — BOTH CLOSED (unit F8a, dispositioned by unit V1).** ~~D11's missing
invariant Banner~~ — the reasoning is now written down at `receipt.tsx:134-150` and PINNED by
`receipt-invariant-unrepresentable.test.ts`: an unmet-verification receipt throws at the boundary
rather than reaching the component, so the banner could only ever be dead code claiming a check it
does not perform. That is D273 item 7's "never the unrepresentable invariant banner", with teeth.
~~**D39**~~ — `receipt.tsx`'s header states what the file renders instead of what it once deferred.

One recorded TENSION, not an OPEN: **B45**, where D225's `since <clock>` under a blocked segment
contradicts the demo's own argument that the AGE is the comparable number.

### Proposed `builds:` lines

**`{#dash-defaults}`** — the generic surfaces every workflow inherits:

```
- [ ] FE the run-detail pure-ports the fidelity re-audit found — the failure record's disclosure and
      write-state block (R-E E8/E9/E15), the timeline segment restored to a focusable control
      (R-B B41), the step group's Well + recessed band + row dividers (R-C C51), and the rail's
      one-owner `dataExpanded` (R-C C4)
- [ ] FE the receipt prints the four facts it already holds — the observation's task and clock, the
      input fingerprint, the trace/descriptor/config footer, and the failure id (R-D D25/D27/D31/D32)
- [ ] FE the failure record prints the four facts it already holds — `occurredAt`, `traceId` +
      `attempt`, `page.urlRedacted`, `action.elementId` (R-E E19/E20/E24/E25)
- [ ] BE the receipt's action entry carries what proved the write — target, system, the written
      values, the confirmation number and the read-back verdict beside the write it proves
      (R-D D16-D22); today `ActionEvidenceSchema` is `{taskId, kind, writeState, occurredAt}`
- [x] BOTH a diagnostic bundle is READABLE — `capturedAt`, recorded attachment-byte size, the contents
      index, redaction list and exact-id manifest route now power the `BundleDialog` (R-E E28/E29)
- [x] FE the run-detail vocabulary sweep — 24 words and glyphs the re-audit found off the demo
      (R-A/B/C/D/E "Words and glyphs"), each reverted or recorded: closed 2026-08-26 under D273,
      twenty ported verbatim and four kept as named truthful exceptions (A38/A41, B83, C16, E6/E9)
```

**`{#track-b}`** — the node is `done` and must not reopen; these are proposed as a **new sibling
`Track B2 · run-detail fidelity`** under `{#dash-defaults}`, since Track B's own definition of
"frontend done" was the findings ledger, not the demo diff:

```
- [ ] DOCS B2a the operator rules the 54 OPEN questions in
      `docs/plans/2026-08-21-03a-fidelity-2-run-detail.md` — each becomes ported, or a recorded
      divergence with its argument
- [ ] FE B2b the 8 served-and-dropped facts (R-D + R-E) — no wire moves
- [ ] FE B2c the 6 structural findings (R-E E15 · R-B B41/B57 · R-C C4/C51/C55+C57)
- [ ] FE B2d the 8 uncited rebuild-only additions — kept with a stated argument, or removed
- [ ] DOCS B2e `receipt.tsx`'s header stops calling itself the 1i placeholder (R-D D39), and the
      D11 invariant question is answered in the owning doc
- [ ] PROOF B2f the corpus re-freeze covering every change, one deliberate pass
```

**`{#observed-logs}`** — the log stream carries what the page said; this re-audit sharpens the
node's `FE` line and adds the demo's own line anatomy as the target:

```
- [x] FE the stream is GROUPED BY its served producer with a sticky heading — the demo's structural
      shape, and the reason `--ds-panel-head-h` is published at all (R-B B65)
- [x] FE observed rows carry their served system, read/write pills and attempt badge; search widens
      to a pill's label and value, while notes stay prose and a fence receives no fabricated page fact
      (R-B B69-B74, B78)
- [ ] BOTH the demo's unserved general line kinds and duration (R-B B69-B75) — `pause` still has no
      wire kind, and no log row carries an honest duration
- [ ] FE the `pause` line's own row tint (R-B B71) and the floor bar's live/idle dot (R-B B87)
- [ ] BE the timeline hover card's `System` row and its key lines (R-B B52/B54) — the same
      provenance points this node emits, read one level up
```
