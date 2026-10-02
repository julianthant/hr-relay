# src/control lessons

Historical evidence moved from the instruction pair on 2026-09-04. Search by the affected
seam or decision and read matching entries before changing it. Current contracts and current
source win over historical status. Record requested lessons here; keep the entry point concise.

## Lessons

- **2026-09-01 — a committed document number chooses the live subject; a closed reference makes the
  operator's `.env` the only chooser (D300).** The registry's `separations` arm used to commit the
  canary's literal Kuali document number (`{ state: "present", documentNumber: "4537" }`) — readable
  by anyone with the checkout, and a commit alone could swap which live document a rehearsal touches.
  It now commits only a closed reference, `{ state: "configured", reference }`; the number itself
  lives in ignored `.env` and only `resolveSeparationsTestTarget` reads it. The same ruling retired
  the three D286 person-value references outright rather than re-pointing them at a document number:
  a Kuali document number is not a person and must never be copied into a name or EID field, so the
  finalization arm's person leaves are derived live by the composed chain instead of being supplied
  by the registry or the environment at all.

- **2026-08-27 — a label that exists but belongs to another workflow is not a decayed canary.**
  `resolveSeparationsKualiFinalizationTestTarget` finds a target by label alone. When the registry
  grew subjects for the composed `separations` chain, asking the finalization resolver for one of
  them fell through to "missing secret EID reference" — a registry-defect message about the wrong
  thing, and reporting it `blocked` would have read as *the subject left the university*. It now
  refuses BY NAME with both workflows in the message. The rule generalises: when a lookup key stops
  being unique across a dimension, the resolver must check that dimension before it interprets what
  it found (D85 · `ref guards-and-tests` §10.5).

- **2026-08-28 — one subject with per-workflow arms, not two entries and not an alias (D284).**
  Doc 4537 had to be addressable by the composed `separations` chain AND by
  `separations-kuali-finalization`. The union-on-`workflow` entry schema could express that only as
  TWO entries — two labels, two `availability` claims, two dated reasons about the SAME document —
  which is exactly the drift the registry exists to prevent: one row could go `gone` while the
  other still claimed `available`. The alternative considered and rejected was an alias (a second
  label pointing at the first): an alias makes a lookup ambiguous and puts the workflow choice back
  into a *name*, which is what D85 forbids. The shape that survived is the subject: identity plus
  ONE availability, and a strict `workflows` object with one arm per workflow. The compatibility
  check moved with it — a manifest case is now judged against `(label, workflow, kind)` on the ARM,
  not on the entry.

  The second half is why the finalization arm **blocks** rather than defects. 4537 has no
  transaction number until the UCPath filing ② runs, and its finalization comments are composed by
  the chain — so the canonical input genuinely cannot be assembled today. Fabricating either value
  would file a real termination against a wrong number; throwing "registry defect" would blame the
  registry for telling the truth. The entry therefore DECLARES both as `pending` with a reason, and
  the resolver reports `blocked` naming the label, the workflow, the missing field and the
  observation date — before it touches a credential, because a run that cannot start must not spend
  one. A missing field the entry did NOT declare is still a defect, by label and date, unchanged
  (D284 · D85 · `ref guards-and-tests` §10.5).

- **2026-08-28 — an AUTHORED leaf in `publicInput` is a lie the schema cannot see.** The finalization
  arm carried `terminationEffectiveDate: "08/29/2026"` as though the 2026-08-28 read had observed it;
  the live form's field is empty and the value is the one the finalization STAGES (separation date +
  1, composed by the chain's `dates` node). It parsed, it typechecked, and it would have let a
  rehearsal start from a date nobody read. It is `pending` now, with that reason. Two mechanical
  halves went in with it: the resolver's pending report order is DERIVED from the pending schema's
  shape (a hand-copied list would have skipped a new key past `blocked`, spent the EID secret and
  defected at canonical parse — the inversion D284 forbids), and `pending: {}` is refused at parse
  because a declaration that declares nothing reads as a truthful claim and makes none (D284).
