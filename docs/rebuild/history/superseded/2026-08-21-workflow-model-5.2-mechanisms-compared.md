_Superseded by `docs/rebuild/reference/workflow-model.md` §5.3, which states the chosen mechanism and its per-node policy. The comparison below is why; it is not a live option set._

# `reference/workflow-model.md` §5.2 — the three resume mechanisms, compared

Written 2026-07-22 while the resume model was open. It weighed checkpoint replay against
re-derivation and against widened entry schemas, and §5.3 chose the first. The choice has since been
built, live-proved and amended twice (D214's claim generation, D221's item-scoped attempt), so the
comparison is history: A is the model, B survives only as the volatile-read `always-rerun` policy,
and C was never built. Kept because the REASONS are still the reasons — a reader proposing to
re-derive a prefix, or to make every upstream field optional-with-self-lookup, should read why those
were refused before proposing them again.

---

## The comparison, as written

**A. Checkpoint replay (checkpointed run context, zod-validated at entry).** Persist every task's
schema-parsed output as a checkpoint. "Start at N" loads N's declared ancestor checkpoints,
re-validates each against its current schema/fingerprints, then runs N's bind + input parse.
*Pros:* no re-execution of side effects; works after crash; hand-supplied data validates through
the same schemas; serializability enforced for free (a Page handle can't pass a zod parse).
*Cons:* a checkpoint can go stale against the live system (**mitigated structurally by D8 —
§5.5**); schema evolution invalidates old checkpoints (loud refusal, but a refusal); needs a store.

**B. Re-derivation (recompute the prefix).** *Pros:* always consistent with live truth.
*Cons:* **disqualifying** as the general mechanism — write tasks are not idempotent (re-running a
Save = a duplicate HR transaction), and it forfeits exactly what resume-after-crash needs. Where
it *is* right: volatile read-guards (live-page dupe probes).

**C. Widened entry schemas (every upstream field optional-with-self-lookup).** Rejected outright —
it moves lookup logic into every task, makes every contract field optional (mushy types), and is
structurally a silent fallback: "missing because the pipeline broke" becomes indistinguishable
from "missing by design".

