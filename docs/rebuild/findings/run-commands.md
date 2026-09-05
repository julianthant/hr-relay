# Findings — the operator command family (retry / cancel / gate / parked-write)

Backend problems found while auditing what an operator can actually DO to a run, 2026-08-19.
Recorded per the standing rule (`README.md`): diagnosed here, never fixed in the session that found
them. Delete a record when its fix lands in the owning doc.

---

## RESOLVED 2026-08-19 — the gate's evidence and its three ceremonies (D226)

Two records lived here and are struck. Track B1 built the three ceremonies against the SERVER's
`approvalShape` and put §14.4's packet on screen: disagreements first under their own heading, then
every approvable candidate, then D211's write plan. An unrecognised shape returns `unsupported` and
blocks the send with a named refusal — it never degrades to approve — and the arm's parameter is
typed `never`, so a fourth shape is both a compile error and a runtime refusal. Normative text:
**ref write-safety §14.11**; the surface obligations generalise in **ref frontend-backend-integration §3.4**.

- ~~The identity gate draws its buttons and never draws its EVIDENCE~~ — closed, with one honest
  nuance the fix does not hide: the evidence renders in the **ceremony dialog**, one click from the
  stream card, not inline in `InlineDecision`. §14.6's rubber-stamp shape IS closed (the packet is
  on screen and the control is blocked until the operator answers). If the operator wants the
  disagreements visible on the card itself, that is a new record, not this one.
- ~~Three of the four approval ceremonies refuse on click~~ — closed. All four now compose:
  one-click, choose-a-candidate (no default selected), type-the-EID, and reject with a reason.

ZERO records remain open. Every block below is a RESOLVED record kept for its argument
(D226 the gate ceremonies; D233 the presentation CAS; D234 the retired hide/unhide pair and
`executeBump`'s CAS; D235 the bulk strip and its once-false refusal copy; D245/D246 the
parked-write pair).
Phase 1.6 Task 4 now owns migration of command writers to the canonical run service, and Phase 3.1
Task 12-1 owns the final operator surface; neither is an unresolved finding in this file.

---

## RESOLVED 2026-08-20 — the parked write gets a way IN and keeps its way OUT (D245, D246)

Both parked-write records are struck. Normative text: **ref write-safety §4.1** for both; ref decisions round 75.

- ~~`resolve-write-present` is refused in the UI and points at a CLI path that does not exist~~ —
  closed by **D245**, and the fix is the harder half the record named rather than the copy
  one-liner. The section now serves a `proofContract`: the commit task, the completion kind, the
  exact `schemaHash` a resolution must echo, and the proof schema DESCRIBED as an ordered list of
  typed fields (`src/validation/proof-shape.ts`), from which `park-resolve.tsx` renders a real form
  and composes a schema-bound value. Both halves are derived by the composition root beside
  `gateNodes`, on that view's own rule that a BFF query may not recompute a contract's identity.
  Three things are worth carrying forward. **A free-text JSON box was never on the table** — a proof
  is schema-bound by construction, so a shape this build cannot describe answers with a NAMED
  `unavailable` reason and leaves the confirmed-ABSENT arm reachable, rather than letting the client
  invent one. **The form pre-fills nothing**, because the run holds what it TRIED to write and
  offering that back is §14.6's rubber-stamping shape one control over. And **a proof that does not
  fit is now a typed `rejected`/`schema-mismatch`** instead of a throw the dialog could only report
  as a transport failure. The load-bearing test is a round trip over every REGISTERED commit
  contract — example output → the kernel's own `proofFromOutput` → the strings an operator would
  type → the composer → byte-equal to the proof and parsing through the real schema — so a fifth
  commit contract cannot land with an undescribable proof and a quietly disabled button.
- ~~Cancelling a parked-write run strands the intent with no exit~~ — closed by **D246**, taking the
  record's SECOND option: cancel is refused while any run in the cascade holds an `attempting` or
  `parked` intent. The first option (keep the resolutions reachable for a cancelled-but-parked run)
  is a contradiction rather than a wire change — `resolvePresent` settles through beat ⑦ with a
  `resume-queued` transition and `resolveAbsent` calls `runs.resume`, both illegal on a terminal
  run, so it would mean either resuming a cancelled run or letting a COMMITTED real write land on a
  run recorded as cancelled. `attempting` is refused too and is the worse case: that run is not
  `parked-write`, so no section describes the intent at all. The confirm copy told the operator the
  wrong half of the hazard (that the outcome would stay unknown, never that it would stay
  unanswerable) and now states the refusal and the order to take.
---

## RESOLVED 2026-08-19 — the presentation CAS hole, and the rename control behind it (D233)

Two records are struck here; the surviving `unhide` record below is a different defect and is
untouched. Normative text: **ref dashboard-surfaces §"Drawing the second batch"**.

- ~~`hide` / `unhide` / `rename` cannot report a conflict~~ — closed. `executePresentation` CASed
  against its own re-read (`current.version`), which cannot fail, so a stale command applied
  silently and answered "Recorded." All three verbs now CAS `request.target.expectedVersion` like
  every other run verb. The reasoning the record called *low blast radius* is what is worth keeping:
  it is true of `hide` and false of `rename`, because a name is a value the operator AUTHORED and
  applying yesterday's over today's discards somebody's edit. The guard covering that arm had been
  asserting the hole as a feature, under the heading *"scopes CAS to the real race families"*; the
  case and its registered invariant both moved in the same commit.
- ~~Rename has a kernel command and no operator control~~ (recorded in
  [queue-rows.md](queue-rows.md), struck there too) — closed. The row serves a `rename` descriptor
  at `menu`, the surface intercepts it for the dialog's value, and the composer refuses a rename
  with no name rather than posting a plausible one.

~~**One CAS observation this pass did NOT act on** — `executeBump` never compares
`request.target.expectedVersion`~~ — closed 2026-08-19 with the D234 block below, on this record's
own reasoning and D233's rule.

---

## RESOLVED 2026-08-19 — the hide/unhide pair is retired, and bump joins the CAS rule (D234)

Two records are struck here. Normative text: **ref dashboard-surfaces §"D234 — the queue's model is runs and
archived runs"**.

- ~~`unhide` is a dead verb across the whole stack~~ — closed by RETIREMENT, on the operator's
  dated ruling: *"there are runs and archived runs; there should be no hidden runs."* The record
  named two exits — build the hidden-runs view, or retire the verb — and the operator took the
  second. `hide` went with it: its own confirm copy admitted the row *"cannot be brought back from
  here"*, which is a one-way door dressed as a reversible tombstone. The whole stack moved (both
  kernel arms, both schema enums, the served vocabulary, the descriptor policy, the client
  composer, the row descriptor, and the hidden-run exclusion the projection was applying in three
  places). The durable `RunRecord.hidden` stays as a parse-tolerated `optional()` vestige, because
  the schema is strict and every stored row carries `"hidden": false` — dropping the key would stop
  the authority database opening.
  **The guard widening this record suggested was cheap and true, so it landed**:
  `wire-connectivity`'s command arm gains a third direction — every serveable verb must be one some
  producer emits, read by CALLING `queueRowActions` over every status and by scanning the
  comment-stripped literals of `queries/run-detail.ts`. Comments are stripped because `unhide`
  appeared in the projector ONLY inside the prose explaining why it is never served; a scan that
  counted prose would have called the dead key healthy.
- ~~`executeBump` never compares `request.target.expectedVersion`~~ (recorded in the D233 block
  above, struck there too) — closed on D233's own rule, with no new decision number. The check
  lands BEFORE the lifecycle precondition, matching `executeCancel`, and the two
  `runCommand(..., 999)` assertions the record named now state the live version. **Every run verb
  CASes the caller's value. There are no exceptions left.**

---

## ~~The bulk band's refusal copy states a false reason~~ — CLOSED 2026-08-19 (D235)

The false copy is gone because the thing it apologized for now exists: the bulk strip composes
Cancel/Retry from the intersection of the selection's own served `actions[]`, warns first, and the
result-vector band reports run by run. Normative text: ref dashboard-surfaces §"D235 — a bulk command is N children
and one vector". Server: `POST /api/v1/commands/bulk`, N derived-id children through the one command
path. Pinned by `tests/unit/dashboard/bulk-dispatch.test.ts` and `bff-flow.test.ts`'s D235 case.
