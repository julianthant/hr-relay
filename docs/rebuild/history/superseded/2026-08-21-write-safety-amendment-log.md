# `reference/write-safety.md` — the opening `Status:` amendment chronology (superseded)

> **Superseded.** `reference/write-safety.md`'s rewritten header states what the doc IS and what is
> true at HEAD; each section states its own as-built. Kept verbatim; never cite as normative.

This was the doc's opening `Status:` paragraph — a chronology of which review round amended which
part (Round 8's OQ1 resolution and §14's design, Round 10's ordered actor-attributed ledger, Round
11's standalone-repo path rewrite, Round 18's Phase-1f beat-⑦ ratification) — plus the two
paragraphs of framing that followed it. The facts each round settled now live in the sections that
own them; the chronology itself is what moves here.

---

Status: **Phase 1c write-safety authority shell completed 2026-08-01; revised 2026-07-22 after the
whole-plan/legacy-code review; amended 2026-07-26
(Round 8), 2026-07-31 (Round 10 — ordered actor-attributed ledger now; hash/tail tamper evidence
deferred by D79), and 2026-07-31 (Round 11 — standalone rebuild repo, D93: every path below is
inside the rebuild repo, so rebuild code sits at plain `src/` and the fence/authority database is
the rebuild repo's own `state.db`), and 2026-08-02 (Round 18 — the complete Phase-1f beat-⑦
transaction and recovery-before-requeue ordering are ratified).** Round-8 amendments: **§13 OQ1 is RESOLVED** — the 2026-07-23 live probe proved Kuali
`save-verify` is buildable and produced four binding constraints on it — **OQ2 (OnBase) is restated
as blocked on a real upload target**, and **§14 designs the identity-approval gate** (D77
ALWAYS-GATE), the control that guards the wrong-**person** class this doc's fence explicitly cannot.
The write sequence includes
a fresh expected↔observed binding proof on the staged page before the fence, and crash recovery now
requires stabilized typed negative evidence before another generation may submit. The guarantee is
stated at the boundary the UI targets can actually support; this doc does not claim unconditional
distributed exactly-once from a browser probe.

This is the highest-stakes doc in the rebuild. It governs whether a real, sometimes irreversible HR
transaction (a UCPath termination, a ServiceNow ticket, a Kuali save, an OnBase filing) is protected
from duplicate unattended attempts and reported **done only when we are sure it landed**. The operator's non-negotiable
(charter §13, 2026-07-18): *"you have to be very sure they were completed"* — completion is
**FAIL-CLOSED everywhere**: an unknown or unverifiable result is **never** treated as done.
