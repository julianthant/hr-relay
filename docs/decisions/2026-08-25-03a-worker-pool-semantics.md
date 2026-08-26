# Decisions — Phase 3a worker-pool process semantics — 2026-08-25
_Answer positionally: `1 A, 2 C + "note"`, or "all recommended". Anything unanswered stays open._

## 1 · What a dashboard stop means
**Situation.** A worker directive is durable and is currently read only between items: a stop lets an active item settle, closes its browser sessions, then ends that worker loop. Lowering a pool declaration must not silently abort a claimed run or misrepresent desired capacity as a stopped process.
**Options.**
- **A.** Stop the selected pool member after its active item settles; a scale-down selects explicit member indices — preserves the existing durable-directive safety rule and makes the affected process legible.
- **B.** Stop any idle member first, then the next member that becomes idle — improves time-to-capacity but makes the selected worker and its operator-visible history non-deterministic.
- **C.** Immediately abort the active item on every stop — reduces waiting but risks interrupting browser/write work and conflicts with the between-items directive contract.
**Recommendation.** A — it preserves claim, write-fence, and operator-trust semantics already ratified for worker directives.
**Notes.** _(your notes here)_

## 2 · Graceful-stop escalation
**Situation.** A worker can ignore a stop while stuck in browser or task code. The supervisor needs a bounded, visible escalation path; a forced exit must leave the claim for recovery rather than terminalizing or requeuing it itself.
**Options.**
- **A.** Request graceful stop, wait 120 seconds, send `SIGTERM`, wait 30 seconds, then `SIGKILL`; record every stage and leave the active claim stale for the existing recovery sweep — bounded without inventing a success outcome.
- **B.** Request graceful stop and wait indefinitely — never force-kills a task, but one hung process can permanently block a scale-down or deployment.
- **C.** Send `SIGTERM` immediately, then `SIGKILL` after 30 seconds — responds fastest, but bypasses the existing active-item settlement path in ordinary stops.
**Recommendation.** A — the escalation is explicit, bounded, and retains the existing poison-close/recovery authority path.
**Notes.** _(your notes here)_

## 3 · Initial maximum pool size
**Situation.** Each additional member creates an independent browser-profile/session set and can contend for shared external systems, even though claims, write fences, and the Duo ceremony lease remain authoritative. The architecture has a three-worker soak and a two-worker live cold-start proof; it has no higher live pool proof.
**Options.**
- **A.** Cap an initial workflow pool at 3 workers, with a named future increase requiring a new proof at that size — matches the largest current concurrency evidence.
- **B.** Cap every workflow at 2 workers — aligns with the live cold-start proof, but leaves the three-worker soak unusable from the dashboard.
- **C.** Allow any positive count — maximizes throughput, but exceeds current proof and can multiply unmeasured provider/browser pressure.
**Recommendation.** A — it exposes only the concurrency level the repository has already exercised as a fleet.
**Notes.** _(your notes here)_

## 4 · Crash and unexpected-exit reconciliation
**Situation.** `desiredWorkers` is a standing declaration while worker leases are observations; they must remain distinct. When a child exits unexpectedly, automatically replacing it could conceal a crash or repeat a failing browser condition, while never replacing it leaves declared capacity unmet.
**Options.**
- **A.** Mark the member crashed, keep the declaration unmet, and require an explicit operator `spawn-worker` action after the card exposes the stop reason — fail loud and avoids an unobserved retry loop.
- **B.** Automatically replace the member once, then require an operator action after a second crash — restores capacity faster but introduces a supervisor retry policy and a second lifecycle that must be proved.
- **C.** Always reconcile back to the declared count — maximizes availability but can repeatedly relaunch a known-bad process without an operator seeing the cause.
**Recommendation.** A — a crash is operational evidence, not a capacity signal the supervisor may silently erase.
**Notes.** _(your notes here)_

## 5 · Supervisor ownership after a dashboard restart
**Situation.** Process locks identify live workers across dashboard lifetimes, but a new dashboard supervisor did not launch the old child. It must not infer ownership from a PID alone or kill a process it cannot prove is its child.
**Options.**
- **A.** Reconstruct cards from authority/process records, but manage only children whose durable supervisor ownership record it can prove; report all other live members as externally running — preserves cross-process truth at the cost of an explicit operator handoff.
- **B.** Adopt every live pool-indexed process after validating its PID and birth token — offers seamless restart recovery, but broadens a dashboard restart into control over independently started CLI workers.
- **C.** Treat all live members as stopped when the dashboard restarts — simple, but false and directly conflicts with durable process observation.
**Recommendation.** A — observation remains durable while control stays limited to proven supervisor ownership.
**Notes.** _(your notes here)_

## Answers (2026-08-26)

| Item | Chosen | Notes |
|---:|:---:|---|
| 1 | A | |
| 2 | A | |
| 3 | A | |
| 4 | A | |
| 5 | A | |
