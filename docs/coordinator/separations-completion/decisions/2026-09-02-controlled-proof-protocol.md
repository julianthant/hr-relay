# Decision — completing separations safely — 2026-09-02

This selects the proof protocol, not advance permission to execute a live write. Implementation
and the real sequencer/run-gate-receipt test seams are already authorized. The operator has now
rejected its repeated-approval premise; see the correction below. The target/disposition choice
has not been answered. The existing historical dry-run can be inspected while this is open.

## 1 · Preserve the filing that Kuali records

**Situation.** The old proof plan files a UCPath termination, deletes it to demonstrate the pending
sweep, then records the deleted transaction in Kuali. Migration §9.36 reproduces this contradiction
with the real sequencer and fake external systems. The ordinary graph already sweeps before filing,
but does not provide the separately approved execution steps required by the proof plan. Its
person-level sweep key also permanently reuses an earlier no-op. In addition, write-safety §3.2
requires restored canary targets; retaining a real separation needs an explicit, narrowly scoped
exception in that owning contract, not an implicit waiver.

**Options.**
- **A. Independent deletion proof plus a retained real separation.** Prove deletion only on an
  explicitly named disposable Pending transaction/set. Preserve the real separation's filing
  through Kuali finalization and retain that intended result under an explicit per-target
  disposition. Amend D287 and write-safety §3.2 for those named targets only; every write still
  receives an individual approval. Cost: a disposable target must be supplied/verified and the
  approval/sweep-identity implementation must land before a fresh rehearsal.
- **B. Reversible proof targets.** Keep the existing restoration requirement and use a configured
  test instance or explicitly reversible canaries for all three writes; restore each with matching
  read-back after verification, keeping the filing present whenever Kuali cites it. Cost: appropriate
  targets and a demonstrably safe restoration path must exist before controlled completion.
- **C. Continue UI inspection now and defer controlled proof.** Use the existing submit-free run
  and keep criterion 5 open. Cost: useful UI work can proceed, but separations is not rebuild-ready.

**Recommendation.** A, if this is an intended real separation and a disposable deletion target is
available; it keeps Kuali truthful and exercises all three writes without deleting the result it cites.

**Notes.** Identify the real Kuali document to retain (4589 is the previously operator-named
candidate, subject to fresh live availability) and the exact disposable Pending transaction/set,
or choose B/C. A missing target blocks live execution, not the already-approved implementation
once the protocol is decided. Nothing here chooses another employee or reactivates gone 4537.

## Concrete implementation after the decision

| Seam | Required behavior | Acceptance |
|---|---|---|
| Deletion identity and target fence | Bind the permanent deletion key to the exact approved pending transaction set; revalidate it before fencing; refuse a changed/unapproved set. Preserve the filing key and generic sequencer reuse. Never use a random/new-run key to force another click | Same approved set reuses without another click; different approved set is distinct; appeared/unapproved row refuses before fence; UNKNOWN remains parked |
| Individual approvals | Provide a supported operator-visible controlled-proof composition/harness with separate authorization of every proof write; preserve the ordinary one-identity-gate UX. A prior identity approval cannot silently authorize the exceptional proof sequence | Real run/gate composition parks at each required decision and cannot continue on stale/foreign approvals |
| Receipt truth and disposition | Kuali may cite only the verified filing that survives finalization. Independent deletion evidence cannot stand in for a real separation filing; apply the approved restoration/retention disposition | The §9.36 invalidated-filing assertion becomes a regression refusal; supported end-to-end composition proves retained filing/read-back and finalization receipt |
| Fresh live proof and close | After code/gates, freeze source and canonical input, refresh the named targets, rehearse, obtain individual live approvals, collect all five criterion parts and A5 measurements | Exact-run no-write rehearsal; mismatch/no-fence evidence; controlled outbox/read-back/terminal proof; idempotent reuse; approved target disposition; final canonical gate table |

These are bounded implementation goals for R3, not a dispatched brief or a ratified contract.
An unavoidable change to the ordinary workflow’s gate UX would require a separate product decision;
this proposal authorizes no test-only rail and must respect D265/D266 harness placement.
R2's source-review details and gates belong to `research/r2-protocol.md` and
`reports/r2-readiness.md`. Final write approval is requested only against the fresh exact packet.

## Operator correction — 2026-09-02
“no, requiring approval should just be if they are not provided an eid. anything with just looking for name should require approval. if eid matches no need approva.”

Decoded: an independently provided EID that matches actual UCPath identity proceeds without approval; selection based only on name requires an actual operator gate even if one match is found. A name-derived candidate EID is not independent supplied identity. No extra per-write approvals on the EID-verified path. R3a owns normative ratification and implementation at the already-approved test seams. All earlier option/implementation text requiring individual approvals is historical proposal and superseded on this point. The correction does not select a disposable deletion target or authorize a false Kuali receipt; that residue remains separate.
