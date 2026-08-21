# Superseded — 03c §Phase summary's original migration-loop prose (2026-08-20)

**Source:** `docs/rebuild/03c-migrate-the-remaining-workflows.md` §Phase summary, as step 3b moved it
out of the dissolved master plan (§3 "Phase 3+'s goal" and §3.1 "Migration loop (per workflow)").

**Superseded by:** `docs/rebuild/03c-migrate-the-remaining-workflows.md` §The seven-step migration
playbook (2026-08-21, docs-cohesion step 5.1). Nothing was dropped — the seven steps below are the
same seven, each expanded into the artefacts it produces and the gate that proves it, with the
things that changed after this text was written folded in: D150 retired legacy change accounting
(step 7's "legacy-change-accounting map" no longer exists — live selector re-verification replaced
it, and that is now step 4), R10's testing tiers gave steps 4 and 7 their T1/T2/T3 artefacts, and
the `Dashboard · wire` sub-task became an explicit part of step 7 rather than an unwritten
assumption. The §Phase summary that replaced it states the honest state at HEAD instead of the
goal.

**Kept because** it is the as-written form of the loop the program committed to in Phase 0, and the
wording of steps 5 and 6 in particular is the original statement of two rules the rebuild has never
relaxed: an unavailable safe evidence target BLOCKS rebuild-ready, and rebuild-ready is not a
production flip.

---

_Moved from `history/superseded/2026-08-20-master-plan-dissolved.md` §3 (Phase 3+'s goal) and §3.1 (the migration loop) on 2026-08-20 (3b); this is the as-written record, the step-5 rewrite re-verifies it._

**Goal.** Migrate the remaining workflows onto the new base, **one at a time**, slowly populating the
task stores with what each needs. Every workflow gets its own migration plan doc (a child of this
plan) answering the §b questionnaire and recording its reuse/additions. These are rebuild
capability milestones only; legacy source/tests remain production and rollback assets.

1. **§b operator questionnaire** (§3.4) — asked and answered BEFORE building (charter §b: "cover
   everything for each workflow as we migrate").
2. **Author** — reuse store tasks (peer-to-peer, charter §1); add new tasks as reusable bases +
   name the workflow-specific customization (charter §3/§8); reuse/add canonical UI ids and driver
   operations first; write strict contracts + scenarios → impls → pure-logic unit tests (`fakeCtx`)
   → descriptor/result/delegation policies (ref guards-and-tests §6 red→green order).
3. **Safety guards fire** — strict schemas, driver boundary, scenario coverage, transaction pairing,
   subject-before-fence, dry-run commit-free, write safety/capability, permanent-key dedupe,
   command/delegation, provenance, graph/result typing, evidence, and stable identity all green.
4. **Live dry-run** reads the real path and asserts prepare previews exist while commit spans,
   write intents, and mutation helpers are absent.
5. **Controlled commit proof for write workflows.** Exercise each new commit/probe/verify against a
   configured test instance or a deliberately harmless, operator-approved canary. If neither exists,
   cutover is blocked—dry-run alone cannot prove landing, recovery, or dedupe. The §b questionnaire
   records target, cleanup/reversibility, expected proof, and stop condition before this test.
6. **Mark rebuild-ready; do not go live (D89).** Record the workflow's native evidence and
   capability closure, but leave production routing on `src`. There is no workflow-scoped flip,
   legacy proxy, engine generation, or mixed-engine production. All workflows switch together only
   after the whole-program cutover gate (§6).
7. **Close the learning loop.** Any failure discovered produces a regression scenario + structured
   knowledge/fix record; stale knowledge is superseded rather than appended beside the correction.
