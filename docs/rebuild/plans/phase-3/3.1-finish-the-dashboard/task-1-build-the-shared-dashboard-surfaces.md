# Task 1 · Build the shared dashboard surfaces
<!-- roadmap: track-b -->

Read the [subphase overview](README.md) before this assignment for shared scope, dependencies, decisions and gates.

<!-- roadmap-status: track-b -->
- [x] B1 the three identity-approval ceremonies and rejection, against the SERVER's `approvalShape`; an unknown shape refuses by name (D226) — `src/dashboard/app/identity-ceremony.ts`
- [x] B2 a settled gate's decision on the panel, and a rehearsal that can never wear `verified-done` (D237/D238) — the forbidden pair is unrepresentable in `RunDetailWire`
- [x] B3 the run modal's four rows — three already in the bundle, the fourth drawn as a read-only fact (D250/D251)
- [x] B4 queue rows — `QueueBaseFields` served and drawn, rename, the bulk strip and result vector, runs vs archived runs (D230–D235)
- [x] B5 archive — frozen sections, five tabs, Export, ledger read-through (D223)
- [x] B6 explorer — the field census, the declared `when` in words, the descriptor's own prose (D227–D229)
- [x] B7 worker cards and the session footer; the rail names step, direction and bound; a CAS `conflict` is a refusal, not a success (D252/D253)
- [x] B8 the findings ledger swept to zero-or-decided; `span.patched` RETIRED; a span close binds to an OPEN entry (D254/D255)
> 2026-08-20 | docs-cohesion 03a | all eight verified present in src/dashboard and src/server/dashboard; the findings README records five open records across two files and zero undecided ones
<!-- /roadmap-status -->

Track B is the "frontend done" definition, and separations was the forcing function: each item is a
surface a migration would otherwise have had to build for itself. Two of its eight are worth reading
as rules rather than as features.

**A ceremony is the SERVER's choice, and an unknown one refuses.** `approvalShape` is computed
server-side precisely so a frontend cannot quietly turn every gate into one click, which is
`ref write-safety` §14.6's rubber-stamping risk manufactured by accident. Adding an arm to
`IdentityApprovalShapeSchema` without adding its control here is a compile error, and a shape this
build cannot describe draws a named refusal instead of an Approve button.

**Two of the eight are honesty corrections, not additions.** D237's `resolved` gate arm was keyed on
a `resolutionKey` the command service never emits, so every settled gated run's panel reported the
gate ABSENT while `resolvedBy` sat in authority; D238's `done → verified-done` mapping was
mechanical, so a dry run that wrote nothing wore the label reserved for an independently verified
real completion. Both now read the derivation that already existed rather than deriving a second
opinion beside it.

**The ledger is the completion test.** B8's sweep is what makes "done" checkable:
`docs/rebuild/findings/README.md` now carries a dated disposition on every record — landed, closed by a
named decision, won't-fix with its argument, or open against a named producer-trigger — and five
open records remain, each blocked on a commit somebody will write rather than on a question somebody
must answer.
