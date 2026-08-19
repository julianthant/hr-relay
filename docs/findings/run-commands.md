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
**doc 09 §14.11**; the surface obligations generalise in **doc 13 §3.4**.

- ~~The identity gate draws its buttons and never draws its EVIDENCE~~ — closed, with one honest
  nuance the fix does not hide: the evidence renders in the **ceremony dialog**, one click from the
  stream card, not inline in `InlineDecision`. §14.6's rubber-stamp shape IS closed (the packet is
  on screen and the control is blocked until the operator answers). If the operator wants the
  disagreements visible on the card itself, that is a new record, not this one.
- ~~Three of the four approval ceremonies refuse on click~~ — closed. All four now compose:
  one-click, choose-a-candidate (no default selected), type-the-EID, and reject with a reason.

Four records remain open below, with a second RESOLVED block among them (D233) sitting where the
records it closed were.

---

## `resolve-write-present` is refused in the UI and points at a CLI path that does not exist

**Recorded:** 2026-08-19 · **Status:** diagnosed · **Owning doc:** doc 09 §4.1

- **Symptom:** the parked-write surface hard-blocks the *present* arm
  (`src/dashboard/surfaces/park-resolve.tsx:422`, `submit()` guards `if (arm !== "absent") return`
  at `:444`) with code `proof-contract-unserved`, and tells the operator to *"resolve this write
  from the CLI"* (`:285`). **The CLI has no such command.** `npm run rebuild:cli` supports
  `help | phase | dashboard | worker | explain | ocr | storage`; there is no run-mutation
  subcommand at all, and `POST /api/v1/commands` is the only mutation door in the system.
- **Consequence:** a fenced write that DID land can be recorded as absent (wrong, and durable) or
  left parked forever. The one honest exit is unbuilt and the error copy misdirects.
- **Two fixes, either order:** serve the proof contract so the present arm can be composed, and/or
  correct the copy to name the real path. The copy fix is a one-liner and should not wait.

---

## Cancelling a parked-write run strands the intent with no exit

**Recorded:** 2026-08-19 · **Status:** diagnosed · **Owning doc:** doc 09 §4.1

- **Symptom:** `executeCancel` (`src/core/command-kernel.ts:642`) has no `parked-write` branch — by
  design, because doc 09:939 says cancel "cannot alter the intent" and there is deliberately no
  force-done endpoint. The operator IS warned in the confirm copy
  (`queue-row-actions.ts:171-176`). But after the cancel the run is `terminal/cancelled`, and
  `buildParkedWritePayload` throws unless `lifecycle.state === "parked-write"`
  (`queries/run-detail.ts:900`) — so the section stops being served and **both resolutions become
  unreachable from the UI**.
- **The rule is right; the trap is the ordering.** Either the resolutions must stay reachable for a
  cancelled-but-parked run, or cancel must refuse while an intent is `attempting`/`parked` and say
  so. Today the operator can reach a state the surface cannot describe.

---

## RESOLVED 2026-08-19 — the presentation CAS hole, and the rename control behind it (D233)

Two records are struck here; the surviving `unhide` record below is a different defect and is
untouched. Normative text: **doc 03 §"Drawing the second batch"**.

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

**One CAS observation this pass did NOT act on**, recorded rather than fixed because it is outside
the seam: **`executeBump` (`command-kernel.ts:715`) never compares `request.target.expectedVersion`
at all.** It re-reads the run, checks the lifecycle, and passes `current.version` to
`bumpPriority` — the same shape `executePresentation` had. The record above said *"every other run
verb CASes the caller's value"* and cited `:648` / `:1588` / `:1675`, which is true of those three
and not of bump. The blast radius is genuinely small (a stale bump reorders a queued run's claim and
is refused outright once the run is no longer queued), but it is the same hole, and "one CAS rule
with no exceptions" is the property that makes the discipline checkable. **What closes it:** the one
line the presentation fix already models, plus the two `runCommand(..., 999)` bump assertions in
`command-kernel.test.ts` that would have to state the live version instead.

---

## `unhide` is a dead verb across the whole stack

**Recorded:** 2026-08-19 · **Status:** diagnosed · **Owning doc:** doc 03 §2.4

- The kernel arm exists, `ActionCommandKeySchema` carries the key, `command-dispatch.ts:163` has the
  case — and **nothing can ever produce the descriptor**: `queue-row-actions.ts`'s `ServedCommand`
  type excludes it (`:87`), because hidden runs are excluded from the queue projection and this
  build has no hidden-runs surface (`:35`).
- It escapes `wire-connectivity` because that guard checks kernel↔schema symmetry, not that a served
  key is ever projected. **Either build the hidden-runs view or retire the verb** — and consider
  widening the guard, since this is the shape of hole it exists to catch.

---

## The bulk band's refusal copy states a false reason

**Recorded:** 2026-08-19 · **Status:** diagnosed — trivially fixable, actively misleading ·
**Owning doc:** doc 03

- `src/dashboard/surfaces/queue-toolbar.tsx:194` tells the operator *"No command is served for a
  queue row yet, so nothing can be applied to a selection,"* and the file header (`:32-40`) asserts
  `QueueSurfaceWire` has no `actions` field. Both were true on 2026-08-14 and are now false:
  `domain/dashboard/projection.ts:206` has the field and `run-queue-projection.ts:1054` populates it.
- The selection UI (checkboxes, select-all, count) works; only the bulk ACTIONS were never rewired.
  The honest current reason is "no bulk arm is built", not "no row command exists".
