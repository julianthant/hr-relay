# Findings — the operator command family (retry / cancel / gate / parked-write)

Backend problems found while auditing what an operator can actually DO to a run, 2026-08-19.
Recorded per the standing rule (`README.md`): diagnosed here, never fixed in the session that found
them. Delete a record when its fix lands in the owning doc.

---

## The identity gate draws its buttons and never draws its EVIDENCE

**Recorded:** 2026-08-19 · **Status:** diagnosed — the WIRE half is complete, the surface half is
missing · **Owning doc:** doc 09 §14 (the packet), doc 03 (the decision card)

- **Symptom:** a run parked at the ALWAYS-GATE renders `InlineDecision`
  (`src/dashboard/surfaces/log-panel.tsx:544`) — the gate label, "since <time>", the held-here
  sentence, and the two `resolve-gate` buttons. It renders **none of the evidence the approval is
  about**: no candidate list, no field-by-field Kuali-vs-UCPath comparison, no `chosenFrom`/`origin`
  strings, no disagreement detail. The only trace of the packet on screen is the Approve button's
  confirm body, which names the *count* of disagreeing fields (`queries/run-detail.ts:868-871`).
- **What IS served:** the whole `identity-gate` section — packet, `options`, `approvalShape`,
  `evidenceDigest`, `resultSchemaHash`, both action descriptors — and it IS fetched now (R5's
  escalation fixed the fetch; `log-panel.tsx:182` documents the earlier state where nothing fetched
  it at all).
- **Why it matters more than a missing panel:** doc 09 §14's whole argument is that the operator
  reviews DISCONFIRMING evidence before authorizing a real termination, and §14.6's rubber-stamping
  risk is exactly "the operator clicks approve without reading". A gate that shows a button and no
  evidence is the rubber-stamp shape by construction. The D204 receipt work put the approver into
  authority; this is the other half — what they were shown.
- **Where the fix belongs:** the separations-completion plan's Track B1, and it is bigger than the
  three missing ceremonies: the packet renderer is the ceremony's substrate.

---

## Three of the four approval ceremonies refuse on click

**Recorded:** 2026-08-19 · **Status:** diagnosed — honest refusals, incomplete surface ·
**Owning doc:** doc 09 §14

- **Symptom:** `deriveApprovalShape` (`src/domain/separations/identity-evidence.ts:208`) emits three
  shapes and the wire always serves both `resolve-gate-approved` and `resolve-gate-rejected`.
  `src/dashboard/app/command-dispatch.ts` sends only **one-click approve with exactly one
  candidate** (`:105`, `:117`). It refuses, by name: `choose-a-candidate`, `type-the-eid`, and any
  rejection ("this build has no field to type one into", `:88`).
- **The sharp end:** `one-click` is the shape the server picks when names match, the candidate is
  unambiguous and there is a single active job — i.e. the EASY case. `choose-a-candidate` and
  `type-the-eid` are what the server picks when the names differ, the search was ambiguous, or the
  document EID conflicts — **the cases the gate exists for**. On those runs both buttons refuse and
  the only working exit from the UI is `Cancel run`.
- **Not a defect in the refusals.** Sending an approval the ceremony did not authorize would be the
  silent-wrong-value failure this program forbids; refusing loudly is correct. The gap is that the
  ceremonies were never built.

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

## `hide` / `unhide` / `rename` cannot report a conflict

**Recorded:** 2026-08-19 · **Status:** diagnosed · **Owning doc:** doc 03 §2.4

- `executePresentation` (`src/core/command-kernel.ts:1564-1567`) re-reads the run and CASes against
  `current.version` instead of the caller's `request.target.expectedVersion`. Every other run verb
  CASes the caller's value (`:648`, `:1588`, `:1668`). A stale `Hide` from a tab left open since
  yesterday silently applies instead of returning `conflict`.
- Low blast radius (presentation only), but it is the one place the CAS discipline has a hole, and
  the fix is to use the value the caller already sends.

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
