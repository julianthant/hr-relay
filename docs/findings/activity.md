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

**Landed 2026-08-15 — the two open wire gaps are deleted per the ledger rule.** The
per-workflow cross-tab (eight columns, one summation pass, D81 reconciliation refusals, the
three-arm warnings-unknown honesty) and the Who sample (bounded run-id samples on non-terminal
status totals, names resolved client-side only) are served and drawn; doc 13 §6.7's D180
as-built owns the contract. `Est. min saved` stays under the hours-saved decide-first record;
the two-letter `code` stays with the taxonomy question.

## Distinct people touched is not served

**Date:** 2026-08-14 · **Status:** triaged 2026-08-14 — blocked on a person axis existing in the
projection corpus at all: today no row (or member) carries an EID or subject identity (the same
absence `docs/findings/queue-rows.md` records for titles and the subtitle slot). Once subject
identity lands on rows AND members, this becomes the same-pass count described below; counting
before then would have nothing true to count.

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

**Date:** 2026-08-14 · **Status:** triaged 2026-08-14 — decide-first, NOT wire work. The three
decisions below (durable home, ownership/versioning, wire shape) need an operator-ratified entry
in doc 13 before anyone builds; a fabricated minutes table is the exact invented-number failure
this record names. No implementation until then.

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

## The write ledger is not reachable from this wire

**Date:** 2026-08-14 · **Status:** triaged 2026-08-14 — decide-first. Serving the block requires
an explicit D81 carve-out (the ledger is a DIFFERENT authority reported beside the one
projection's totals, with the seam stated), which touches §8 guard #4's pinned constraint —
ratification, not a projection edit. The recorded argument favors keeping the block and stating
the seam; awaiting that ratification.

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

**Date:** 2026-08-14 · **Status:** triaged 2026-08-14 — decide-first, doc 13 §5's own words
("export if later served"). Building it needs a served export route plus the caveat decision (an
export without the "hours saved is an estimate" / "error rate excludes open runs" rules is the
lying artifact the design prevents). Not built until a doc entry lists it.

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

## The span control is two date bounds, not the demo's two span chips

**Date:** 2026-08-14 · **Status:** triaged 2026-08-14 — won't-fix; the two bounds ARE D180's
ratified control ("an aggregate over a window the caller never named is a number nobody asked
for"), and preset chips would first need a served `bounds: { earliest, latest }`. Kept as the
diagnosis for that future option; no work owed. · **Priority:** low

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
