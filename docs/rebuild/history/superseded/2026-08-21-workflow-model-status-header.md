_Superseded by `docs/rebuild/reference/workflow-model.md`'s rewritten header and by each section named below, which state what is true rather than when it changed._

# `reference/workflow-model.md` — the `Status:` amendment chronology (2026-07-22 → 2026-08-14)

This is the opening `Status:` paragraph the workflow-model doc carried until the 2026-08-21 cohesion
rewrite. It was a chronology of *when* the doc grew each contract, which is a fact about the doc's
edit history rather than about the system. Every claim in it is now stated in the section that owns
it; the pointers are in the table below.

---

Status: **revised 2026-07-22 after the whole-plan/legacy-code review; amended 2026-07-26 (Round 8),
2026-07-31 (Round 10 — native-only envelope and global cutover boundary), and 2026-07-31 (Round 11 —
standalone rebuild repo, D93: the rebuild lives in its own `hr-automation-rebuild` repo at plain
`src/`, making runtime isolation physical and retiring the same-tree guards that enforced it).**
The abandoned Step-0 spike and skeleton were deleted. The expanded graph, typed delegation/control
seams, and three-effect task API require a new real-scale type proof before code lands in the
rebuild repo's `src/`. Round-8 amendments: §4 records the two graph-legality rules the
identity-approval gate
(ref write-safety §14, D77) imposes, and the descriptor's per-run stamp now includes the **app version**
alongside the workflow version + fingerprint (D80 archive-on-bump, owned by ref dashboard-surfaces §10.2).
**Amended 2026-08-14 (Round 61):** §1.2.1 — every workflow MODULE declares a required closed
`role` (`standalone` / `composition` / `chunk-harness of <id>` / `proving`, the last per D220),
validated at the composition root;
presentation of the role is ref dashboard-surfaces's (D219).

---

## Where each claim now lives

| claim in the chronology | where it is stated now |
|---|---|
| the abandoned Step-0 spike and skeleton were deleted | nowhere, deliberately: the spike left no code and no contract, so there is nothing for a contract doc to say about it. The build record is `docs/rebuild/00-design-the-foundation.md` |
| the expanded graph / typed delegation / three-effect API need a real-scale type proof before code lands | **discharged.** `reference/workflow-model.md` §3's as-built records `tests/types/flow-graph.typecheck.ts` (a 21-node graph plus sixteen `@ts-expect-error` controls) and `tests/unit/flow-type-budget.test.ts`'s measured budget |
| D93 — the rebuild is its own repository, so runtime isolation is physical | the root `CLAUDE.md` §Cross-repo rules and §Operational isolation; `reference/workflow-model.md` §7's last row |
| Round 8 — §4 records the identity-approval gate's two graph-legality rules | `reference/workflow-model.md` §4, unchanged and normative there (D77, `ref write-safety` §14) |
| Round 8 — the per-run stamp includes the app version | `reference/dashboard-surfaces.md` §10.2 (D80/D179); the run record carries `appVersion` durably |
| Round 61 / D219 — every MODULE declares a required closed `role` | `reference/workflow-model.md` §1.2.1, which owns the union, the `proving` arm (D220) and the composition-root validation |
