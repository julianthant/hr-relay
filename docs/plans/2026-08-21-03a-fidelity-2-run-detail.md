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
