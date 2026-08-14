# Activity-report findings (non-normative)

Wire and plan gaps found porting the operator's rebuild-demo Activity report onto the served
`GET /api/v1/reports/activity` payload (doc 13 §3.6, §6.7, D180). Demo source:
legacy `hr-automation@1bffbd658db34ce84a08e69484db3a40b3658d6e`,
`src/dashboard/components/dev/rebuild-demo/DemoActivityReport.tsx` + `demo-report-wire.ts`.

Read `README.md` first — nothing here is a ratified decision, and the standing rules apply:
backend gaps are DIAGNOSED here and fixed by a later session, and a demo element the served wire
cannot power is recorded rather than approximated.

The port itself landed: tiles, the still-open-by-state table, the per-workflow table grouped by
category with subtotals, the caveats popover and the provenance footer are all rendering from the
served payload. Every record below is an element that is ABSENT from the ported surface, and absent
on purpose.

---

## Distinct people touched is not served

**Date:** 2026-08-14 · **Status:** recorded

**Symptom.** The demo's panel-header meta reads `55 runs · 110 people`, and its `Runs` tile's note
reads `110 distinct people touched`. The ported surface serves `34 runs` and a note counting DAYS
instead, because the people half has no source.

**Evidence.** `ActivityReportWireSchema` (`src/domain/dashboard/activity.ts`) carries `totalRuns`,
`terminalRuns`, `inFlightRuns` and four grouped totals. There is no person axis and no distinct-EID
count anywhere in the payload.

**Mechanism.** The demo computes it from whole fixture rows — `distinctPeople()` in
`demo-report-wire.ts` walks `ALL_DEMO_ROWS` including group MEMBERS and counts distinct `eid`, so a
50-person I-9 roster counts as 50 while one person in two runs counts once. The served report is an
aggregate built inside `run-queue-projection.ts`; it never exposes rows, so the frontend has nothing
to count.

**What a fix involves.** A `people: { distinct: number }` (or an absent-with-reason arm) added to
`ActivityReportWire`, computed in the same projection pass over the same corpus — critically over
members too, not just top-level rows, or the number silently under-reports rosters. It is a
supervisor-facing figure, so the member-containment rule has to be stated in the schema comment the
way the demo states it in its caveat.

---

## Hours saved has no operator-entered minutes source

**Date:** 2026-08-14 · **Status:** recorded

**Symptom.** The demo's fifth headline tile is `HOURS SAVED ≈ 3.5` with an `estimate` badge, a note
reading `operator's per-workflow minutes × runs that finished`, and an ⓘ carrying its provenance.
The ported surface has four tiles and no hours-saved tile; the demo's `estimate` tone and badge were
dropped from `Tile` with it, since nothing else wears them.

**Evidence.** The figure's whole input is `MANUAL_MINUTES` in `demo-report-wire.ts` — a hand-kept
`Record<workflowId, number>` of minutes-per-run, plus `MANUAL_MINUTES_PROVENANCE` naming it as
unmeasured. Nothing in `src/domain/` holds a per-workflow manual-minutes figure; it is not in the
descriptor, not in config, and not on the wire.

**Mechanism.** This is the only number in the demo's whole report that is not measured, which is
exactly why it needs a durable home with an owner and an edit path, not a constant compiled into a
surface. Fabricating minutes here would produce a plausible hours-saved figure on the one artifact
that leaves the operator's screen — the highest-consequence place in the product for an invented
number.

**What a fix involves.** Three decisions, none of them frontend: WHERE the minutes live (settings,
per-descriptor metadata, or a dedicated store), WHO may change them and whether changes are
versioned (a report re-run after an edit would otherwise silently restate history), and the wire
shape — the estimate should ride as `{ minutesPerRun, source }` per workflow so the surface can keep
rendering the provenance beside the number rather than asserting a total on its own.

---

## The per-workflow table serves runs only — five demo columns have no source

**Date:** 2026-08-14 · **Status:** recorded

**Symptom.** The demo's `By workflow` table has eight columns: Workflow, Runs, Share, Read back,
Warnings, Failed, Open, Est. min saved — with `failed > 0` tinted red and `open > 0` tinted amber
per row, and a two-letter workflow `code` set before each label. The ported table has three:
Workflow, Runs, Share.

**Evidence.** `ActivityWorkflowTotalSchema` is exactly `{ workflowId, registration, runs }`. The
status and outcome breakdowns are served only as WHOLE-REPORT totals (`statuses[]`, `outcomes[]`),
never crossed with the workflow axis.

**Mechanism.** The report is grouped one axis at a time. The demo folds rows, so every cross-tab is
free; the aggregate wire fixes the axes at build time and a cross-tab that was not built cannot be
recovered by the client.

**What a fix involves.** Widening `ActivityWorkflowTotal` with the per-workflow status counts —
`{ readBack, warnings, failed, cancelled, open }` — computed in the same projection pass. This is
the single highest-value gap of the set: the grouped table is the demo report's centrepiece and
three columns is a thin version of it. The `code` is separate and cheaper: it is a presentation
attribute of the descriptor (demo `DEMO_WORKFLOWS[id].code`), so it belongs on
`registration.registered` beside `label` and `categoryId`, not computed from the id.

---

## Outstanding buckets carry no identities, so the "Who" column is absent

**Date:** 2026-08-14 · **Status:** recorded

**Symptom.** The demo's `Still open — by what it is waiting on` table has three columns: State,
Runs, and Who — the latter showing the first subject's display name with a `+N`, and an `All N`
button opening a popover listing every run's name, workflow label and trace id. The ported table has
two columns and no popover.

**Evidence.** `ActivityStatusTotalSchema` is `{ status, runs }`. No run ids, no subjects, no traces.
Contrast `ActivityFailureTotalSchema`, which DOES carry `sample: RunId[]` — so the precedent for
attaching exemplar run ids to an aggregate row already exists in this same wire.

**Mechanism.** The demo reaches `outstandingRows(span)` — the actual row objects — and reads
`displayName` off each. The aggregate has counts only.

**What a fix involves.** The narrow version is the failure row's own pattern: a bounded
`sample: RunId[]` on the non-terminal status totals, which the surface resolves against the queue
projection it already holds. The full version needs display names, and those are subject data — so
the redaction posture (`redaction-surface-scan`) has to be settled before names land on a report
that is explicitly built to be exported.

**Note.** "Who is waiting on me" is the operator question this table exists to answer, so the
two-column version answers half of it. Worth ranking above the ledger.

---

## The write ledger is not reachable from this wire

**Date:** 2026-08-14 · **Status:** recorded

**Symptom.** The demo's last block is `Write ledger — what was actually filed`: a table of
System / Entries / Production / Test instance, with the test-instance count tinted amber, and a
`Well` empty state reading "No ledger entries. Nothing in this report's reach filed anything into a
real HR system." The ported surface omits the block entirely — INCLUDING the empty state, because
rendering "nothing was filed" over an unserved axis would be an assertion, not an absence.

**Evidence.** `ActivityReportWire` has no ledger field. The demo builds it by walking
`DEMO_ARCHIVE`'s per-run `ledger[]` entries and folding by `{system, instance}`.

**Mechanism.** The rebuild's ledger is real and durable — `src/infra/ledger/ledger-projector.ts`,
append-only, never pruned, partitioned by `confirmedAt` — but it is a separate authority from the
run/queue projection this report is built inside, and D81/§8 guard #4 pin every Activity total to
that ONE projection. So this block cannot simply be summed alongside the others; it is a second
source by construction.

**What a fix involves.** A decision first: whether the ledger block is part of the Activity report
at all, or its own surface. If it stays here, the D81 constraint needs an explicit carve-out saying
the ledger is a DIFFERENT authority reported beside the projection's totals rather than derived from
them — the demo's own caveat already says as much ("they are never pruned and never archived, which
is why they can outlive the runs that filed them"), which is an argument for keeping it and stating
the seam, not for hiding it.

---

## Export is a button with no command behind it

**Date:** 2026-08-14 · **Status:** recorded

**Symptom.** The demo's panel header carries a secondary `Export` button with a download icon,
beside the ⓘ. The ported header carries the ⓘ only.

**Evidence.** Doc 13 §5's surface table already says so, in the Activity row's own words:
`export if later served`. No export route exists under `/api/v1/reports/`.

**Mechanism.** Not a gap so much as an unbuilt feature the demo drew. A button that renders and does
nothing is worse than no button on a supervisor-facing artifact, so it is absent rather than inert.

**What a fix involves.** A served export (CSV or PDF) of the same payload, plus a decision about
whether the export carries the caveats — an exported report with the numbers and without the
"hours saved is an estimate" / "error rate excludes open runs" rules is precisely the lying artifact
the demo's whole design is built to prevent.

---

## Doc 13's D180 paragraph describes the surface this port replaces

**Date:** 2026-08-14 · **Status:** recorded — needs ratification, not a fix

**Symptom.** Doc 13 §6.7's D180 as-built closes with: *"The surface opens with the sentence and the
numbers set into it, then the same totals as proportional rows — no KPI-card row and no chart
runtime, which also keeps the bundle within §8 guard #13."* The ported surface DOES open with a
headline tile row, so that sentence and the shipped code now disagree.

**Evidence.** Old surface: one `<p>` reading "34 runs started between … 34 finished; none are still
in flight", then five `ShareTable`s (day / workflow / category / status / outcome). New surface:
four tiles, the still-open table, the grouped per-workflow table, durations, By day, By outcome,
failures, footer.

**Mechanism.** The paragraph is an as-built record written when 2i-G landed, and the half of it that
carries a REASON — "no chart runtime … keeps the bundle within §8 guard #13" — is still fully
honoured: this port adds no chart library and no Node built-in, and every proportional bar is still
a plain element sized from its own share. The half with no reason attached — "no KPI-card row" — is
the half the operator's demo overrides, and the demo argues the opposite case explicitly: the
counterweights (still-open, the error rate's denominator) belong IN the headline row so finished
work is never read without the work that is not.

**What a fix involves.** A doc edit, not a code change: doc 13 §6.7's D180 paragraph restated to
describe the tile row and its counterweight-first rule, with the bundle constraint kept verbatim.
Per doc 04 the restatement is what ratifies it — until then this port is ahead of its own doc.

---

## The span control is two date bounds, not the demo's two span chips

**Date:** 2026-08-14 · **Status:** recorded · **Priority:** low, likely won't-fix

**Symptom.** The demo's page header holds a `role="group"` of two `Chip`s — the selected day
(`Sat, Jul 25`) and `Every day the tracker holds (3)`. The ported header holds the `From` / `To`
date fields the surface already had.

**Evidence.** `reportSpansForDay()` builds the demo's spans from `DEMO_DAYS`, the fixture's own list
of every day it holds. D180 requires both bounds by name and the route refuses without them:
*"an aggregate over a window the caller never named is a number nobody asked for."*

**Mechanism.** "Every day the tracker holds" is not a range the client can name — it would need a
served earliest-run date, and inventing one (epoch, or 90 days back) would be exactly the silently
different window D180 refuses. The two bounds remain the honest control.

**What a fix involves.** Probably nothing. If preset chips are wanted later they need a served
`bounds: { earliest, latest }` so a preset names a real window; the panel header's subtitle already
renders the chosen span as a human label (`Sat, Aug 1 – Fri, Aug 14`), which is the readout half of
the demo's chip row.
