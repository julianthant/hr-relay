# Trust UCPath / ServiceNow wait-before-negative-read windows
<!-- roadmap: def-propagation -->

Read the [subphase overview](README.md) before this assignment for shared scope, dependencies, decisions and gates.

<!-- roadmap-status: def-propagation -->
- [x] **Kuali is measured and closed** — four operator-authorized write/restore cycles on real doc 4490, 2026-08-04: worst observed fence→trustworthy-negative ≈ 3.3 s (D135)
- [x] D135's retired annotation contract measured the Kuali mechanism window: `minSinceFenceMs: 30_000`, two reads 5 s apart, `requireSameSourceState`; the evidence remains ref write-safety §3.4 history
- [x] `kuali/save-separation-finalization` reuses that window under D207's mechanism-transfer rule — **provisionally**, until its own controlled-commit proof confirms
- [ ] the separations finalization's own controlled commit, which is what turns that provisional transfer into a measurement
- [ ] **UCPath is unmeasured** — both termination contracts are `operator-only` with the refusal to guess stated in the contract (`create-termination.ts:105-112`, `delete-pending-terminations.ts:94-99`)
- [ ] **ServiceNow is unmeasured** — no commit contract exists for it yet; its window is measured at its own live probe
> 2026-08-25 | D266 reconciliation | verified against the three current commit contracts' `recoveryAbsence` blocks under src/domain/contracts/{kuali,ucpath}/ and §3.4's historical Kuali measurement; left: the UCPath measurement (order 7) and the separations confirmation
<!-- /roadmap-status -->

**What the deferral is.** When a write's fence lands and the read-back afterwards says the value is
NOT there, the system has two possible answers: *"it genuinely did not land"* or *"it landed and has
not propagated yet."* Trusting the negative requires a **measured propagation window** for that
system, on that mechanism. Kuali has one. **UCPath and ServiceNow do not**, so a post-fence absence
there parks for a human instead of settling.

**The decisions.** **D128** (round 26, 2026-08-04) is where the rule was paid for: Phase 2's one
authorized real write fenced, clicked Save, got HTTP 200 and a rendered *Form saved*, and persisted
nothing — so `recoveryAbsence` stayed `operator-only`, because *a write that never lands measures no
propagation window, and inventing `minSinceFenceMs` is the banned constant.* **D135** (round 30, the
same day) then measured it properly once the real causes were found and fixed. **D207** (round 53,
2026-08-14) is the transfer rule: a measured window travels with the MECHANISM when the reusing
contract names the same write request, the same negative read, and an absence that is safe in the
direction it can be wrong — **provisionally**, until the reusing write's own controlled commit
confirms it.

**Its trigger: each system's own live probe, UCPath at order 7.** This deferral is per system, not
global; it closes one system at a time, and `ref workflow-model` §1.6.2 requires each admitted
Phase 4 packet to name and close its unproven live probes.

**Built today.** The whole mechanism, and two of four contracts carry real numbers. Kuali's window
was measured on the exact form through the exact mutation: the save answers in ~2.5–3.0 s, Kuali's
own document query agrees on the first sample ~270 ms later, and a full browser reload agrees within
~3 s. `minSinceFenceMs` is nonetheless set to **30 s** — about nine times the worst observation —
with two reads 5 s apart on the same source state. That is what a measured window looks like when it
is used conservatively.

**Not built, and the asymmetry is the point.** UCPath's two contracts refuse to guess **in the
contract text itself**, and they give the reason a reader can act on: nothing in this repository has
ever watched a Smart HR submit propagate to the SS Smart HR search page, and the stakes are a real
termination rather than a benign annotation. The direction-of-error argument is what separates the
two systems — settling a Kuali negative re-fences and re-saves the IDENTICAL staged field set, while
settling a UCPath negative wrongly files **a second real termination.** That is why the same
mechanism transfer D207 allows between two Kuali writes does not reach UCPath at all.
