# Queue-row findings

Records where a queue-row element the demo draws — or doc 03 §9 ratifies — cannot be powered
by what the BFF serves today. Verified 2026-08-14 by running the rebuild dashboard
(`localhost:5174`, real `separations` runs on day `2026-08-14`) beside the demo
(`localhost:5173/?view=rebuild-demo`, legacy `hr-automation@1bffbd6`) at 1440×900 and reading
both screenshots element by element.

**The frontend half is already 1:1.** `src/dashboard/surfaces/queue.tsx` is a faithful port of
`DemoQueue.tsx` — same grid, same chip shell, same footer band, same bands and digest. Every
record below is a MISSING WIRE FIELD or a MISSING PROJECTOR, not a rendering gap: each one is a
row the component would draw the moment the field arrives. Most are already batched on the
hookup ledger in `docs/plans/2026-08-13-detail-fidelity-audit.md` (rows *"`QueueBaseFields`
batch"* and *"queue/run action descriptors"*); they are restated here per record so a backend
session can take them one at a time.

Shared evidence for every record: `GET /api/v1/dashboard?day=2026-08-14` and
`QueueBaseFields` in `src/domain/dashboard/projection.ts`.

---

## A failed row shows no error sentence

**Recorded:** 2026-08-14 · **Status:** recorded · **Owning doc:** doc 03 §1.2 (queue-row
projection), §9 D13

**Symptom.** All six of today's rows are `failed` and NONE of them says why on the card. The
demo's failed row prints the error in the subline directly under the title
(`DemoQueue.tsx:582`, `sublineFor` → `row.error`), which is what makes a failed queue row
triage-able without opening it. D13 goes further and requires the parent to mirror a linked
child's error **verbatim, never "Unknown error"**.

**Demo element.** The subline — the coloured sentence between the title row and the footer.

**Missing wire.** Nothing: `liveMessage` is served `{state:"absent", reason:"live messages ride
the notes projection, which lands after 1g"}` on every row, and `queue.tsx` correctly draws no
subline for an absent message rather than inventing one. The field exists; no producer fills it.

**Where it would come from.** The terminal `FailureRecord`'s own summary for a terminal-failed
run (authority already holds it — the run-detail `failure` section renders it), folded into
`liveMessage` by `src/server/dashboard/queries/run-queue-projection.ts`. This is the single
highest-value row in this file: it is one served string away, and it is the difference between
a queue you scan and a queue you have to click through.

---

## The title is a document number, not a subject

**Recorded:** 2026-08-14 · **Status:** recorded · **Owning doc:** doc 03 §1.2, §9 D15

**Symptom.** Every rebuild row reads `Separation 4502` / `Separation 4524`. Every demo row
reads a person — `Priya Anand`, `Marcus Boone`, `Lena Hoffmann` — or the file the run is about
(`Oath_Packet_Summer.pdf`). Three of today's six rows are the SAME document number, so the
column the operator scans distinguishes nothing.

**Demo element.** The row title (`row.displayName ?? row.title`), plus its
`title="Named by you — subject is <subject>"` tooltip when the operator has renamed the run.

**Missing wire.** A subject-derived `title`, and `QueueBaseFields.displayName` (the operator's
own name for a run — it rides the row AND the receipt in the demo).

**Where it would come from.** The projector already reads the run's identity; the subject's name
is resolved by the identity chunk mid-run, so the honest shape is a title that starts as the
document number and is REPLACED once the subject node has a checkpoint — never a blank and
never a guess. `displayName` is a separate operator-authored durable field with no producer at
all.

---

## No run-number `#N` chip in the footer

**Recorded:** 2026-08-14 · **Status:** recorded · **Owning doc:** doc 03 §1.2

**Symptom.** The demo footer reads `2:18 PM · #1 · 10620118`; the second segment is the run's
ordinal for that workflow (`DemoQueue.tsx:709`, `#{row.run}`; the same value is printed on the
rename dialog's meta line beside subject/trace/elapsed, `DemoRunIdentity.tsx:433`).

**Demo element.** The bordered `#N` chip, second segment of the footer provenance line.

**Missing wire.** `QueueBaseFields.runNumber`.

**Where it would come from.** A per-workflow monotonic ordinal assigned at enqueue and retained
on `RunRecord` — it must be durable, because deriving it from the day's row order would give
the same run a different number on a different day's page.

**Deviation kept in the meantime.** `queue.tsx` draws the **trace id** in that chip slot
instead. That is deliberate and stays: the trace id is the run's name in every log, receipt and
support conversation, the demo's own comment says it is the last thing that may be cut, and a
chip that would otherwise be empty is worse than one carrying the id an operator actually
greps. When `runNumber` lands, the two are siblings, not substitutes.

---

## No gate age on the status pill (D12)

**Recorded:** 2026-08-14 · **Status:** recorded · **Owning doc:** doc 03 §9 **D12**

**Symptom.** D12 is ratified and unamended: *"the collapsed row shows the gate's age —
`Waiting on you · 10m`. An aging gate is the most actionable fact in the queue."* The rebuild
row draws the bare word. The rendering half already exists — `StatusBadge` takes an `age`
prop (`surfaces/status.tsx:138`) and `HeaderChips` passes none, because nothing on the wire
dates the gate.

**Demo element.** `StatusBadge status={status} age={gateAge(row, tick)}` (`DemoQueue.tsx:493`).

**Missing wire.** `QueueBaseFields.gateOpenedAt` (an ISO instant), for `awaiting-approval` rows.

**Where it would come from.** The open gate's own record — the same source the run-detail
decision notice reads. Age is then display-only arithmetic against the bootstrap-calibrated
`nowIso` the queue already receives, exactly like elapsed. It must NOT be derived from
`updatedAt`: that moves on every patch and would report a gate as younger than it is, which is
the one direction this fact may never err in.

---

## No `dry run` chip

**Recorded:** 2026-08-14 · **Status:** recorded · **Owning doc:** doc 03 §1.2, doc 09 (dry run)

**Symptom.** The rehearsal/real separator is invisible on the queue. The demo draws a violet
`dry run` chip beside `test`, titled *"this rehearsal reads the systems and writes nothing"*
(`DemoQueue.tsx:437`). The rebuild draws the `test` chip (the field IS served, as
`resolvedInstances[].instance`) but has nothing for dry run — so a rehearsal and a real filing
look identical in the one column an operator scans before acting.

**Demo element.** The violet `dry run` chip on the title row.

**Missing wire.** `QueueBaseFields.dryRun`.

**Where it would come from.** The run envelope's own `dryRun` — the same flag the write kernel
refuses a real write on (`executeDryRun` vs `executeTransaction`), so it is already durable per
run and needs only to be projected.

---

## The warning count is a constant, not a count

**Recorded:** 2026-08-14 · **Status:** recorded · **Owning doc:** doc 03 §9 D22 / D126

**Symptom.** `HeaderChips` draws `△ 1` for any `partial` (→ `doneWarnings`) row, with a comment
saying so: the number is not counted, it is the smallest true statement ("at least one"). The
demo's chip carries the real count from `row.warnings`, or a group's rolled-up member warnings.
D126's ratified argument for keeping the visible word `Done` on both terminal dones leans on
this chip being one of the three visible channels separating them — a channel that always
reads `1` is weaker than the argument assumes.

**Demo element.** `△ N` beside the status pill.

**Missing wire.** `QueueBaseFields.warnings` (`{count, first}` in the demo — the count plus the
first warning's sentence for the chip's title), and the member rollup's warning tally for a
group row.

**Where it would come from.** The terminal result record's warning set.

---

## No per-row action controls

**Recorded:** 2026-08-14 · **Status:** recorded · **Owning doc:** doc 03 §2.4 (command
protocol), doc 13 §0.4

**Symptom.** Every demo row carries its frequent commands at the footer's right edge: a queued
row shows `≫` (promote) and `×` (cancel); a finished row shows `↺` (re-run) and `🗑` (delete);
the full set is a right-click away. The rebuild draws none, on any row, in any state — the
queue's only affordance is selecting the row.

**Demo element.** `FooterActions` (footer, right) + `RowContextMenu` (right-click) +
`OutcomeActionButton` (on the subline).

**Missing wire.** BOTH halves are missing, which is why this is a wire gap rather than a wiring
oversight: there is no `actions[]` field on `QueueBaseFields` and no projector that would build
one. `src/dashboard/app/dashboard-app.tsx:118` holds `SERVED_ACTIONS = []` with the same
diagnosis.

**Where it would come from.** A per-row projection of `ActionDescriptorWire[]` bound to the
row's `rowRevision` as its CAS target. **The consumer is already complete**: `FooterActions`,
`RowContextMenu` and the confirm-first dialog are ported and mounted, `onAction` is passed on
both panels and routes into `runAction` → `composeCommandRequest` → the one command client. The
day the field is served, every row control is live with no frontend change.

*(Precedent to copy: the two run-detail SECTION payloads that carry decisions — `parked-write`
and `identity-gate` — already project real descriptors in
`src/server/dashboard/queries/run-detail.ts`. The generic row-level arm is the only one absent.)*

---

## No linked-run chip

**Recorded:** 2026-08-14 · **Status:** recorded · **Owning doc:** doc 03 §9 D6, D10, D13

**Symptom.** Nearly every demo row carries a full-width chip under the title routing to a
related run — `Oath Upload · running ↗`, `OCR Review · done ↗` — which is how a linked child
and its parent stay one thought across two panels. The rebuild draws exactly one arm of that
band, `ParentBackChip`, and it is gated on `lineage.state === "child"`; all six of today's rows
are `root`, so the band never appears.

**Demo element.** `PanelRedirectChip` (:1099) and `LinkedReviewChip` (:1159).

**Missing wire.** `QueueBaseFields.linkedRunIds` and `reviewRunId`, each resolvable to a target
panel + the target's own status (the chip prints `Name · status`).

**Where it would come from.** The delegation manifest / linked-child records the kernel already
writes. Note this is the same gap the composition taxonomy record in
[workflow-taxonomy.md](workflow-taxonomy.md) approaches from the rail's side: a chunk run and
the composition that ran it are currently unrelated rows.

---

## No fact chips and no extracted-people count

**Recorded:** 2026-08-14 · **Status:** recorded · **Owning doc:** doc 03 §9 D7

**Symptom.** A demo row's chip band carries the run's own so-what — `signed 2:24 PM` on a
finished oath, `6 people` on a packet still at OCR review (which is D7, ratified: *"a packet
still at OCR review shows its extracted count"*). The rebuild has no equivalent, so a settled
row states its status and nothing about its outcome.

**Demo element.** `FactChipView` (:168) and the `Users` + count chip (:1030).

**Missing wire.** `QueueBaseFields.facts[]` and `extractedCount`.

**Where it would come from.** The run's terminal result — the same values the receipt prints.
The demo's `FactChipView` shape (label + value + growth behaviour) is the oracle for the field.

---

## `subtitle` carries a prose run note, not an external identifier

**Recorded:** 2026-08-14 · **Status:** recorded · **Owning doc:** doc 03 §1.2

**Symptom.** The demo's footer subtitle slot holds a short external identifier — an EID
(`10620118`) or a document id (`os-142012-b410`) — which is why it sits inline between the
trace chip and the timing. This projection serves the run's NOTE there instead: one of today's
rows carries *"re-read 1 — chunk 6b: the first run refused on a Playwright strict-mode
violation in the Person Org settle wait (D213); reading the document again on the fixed
driver"* — 1096 px of prose in a 375 px card.

**Demo element.** The third footer segment.

**Missing wire.** Not a missing field — a semantic mismatch in what `subtitle` is filled with,
plus the absence of a distinct external-identifier field (the demo's `eid` / `itemId`-shaped
value) for the slot the layout was designed around.

**Frontend half, fixed 2026-08-14.** The segment carried the demo's `whitespace-nowrap`, so the
long note neither wrapped nor ellipsized — the card's `overflow-hidden` cut it mid-word with no
signal that anything was cut. It now wraps (`min-w-0 break-words`), which is DESIGN.md's stated
footer rule (*"A row footer's facts WRAP; they never truncate … so a run with a queue note
takes a second line instead of cutting its trace id to `1…`"*) and is pixel-identical on a
demo-shaped short subtitle. The row is readable; whether a three-line prose note belongs in a
queue footer at all is the backend question this record holds open.
