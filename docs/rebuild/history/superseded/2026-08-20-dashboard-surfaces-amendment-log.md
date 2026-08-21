_History — superseded by `reference/dashboard-surfaces.md`'s own header and by the sections each
amendment amended (see `history/README.md`); kept verbatim as written between 2026-07-22 and
2026-08-14._

# `reference/dashboard-surfaces.md` — the dated amendment log

_The doc was titled `03 — Tracker/Event Layer + Dashboard Contract (span rebuild)` while these
sentences stood under it._

The `Status:` paragraph and the nine `**Amended …**` sentences that opened this doc from
2026-07-22 until the 2026-08-20 rewrite (cohesion plan step 5.1b). Read as a chronology of when the
doc grew each half: the closed command protocol and the recovery contract (2026-07-22), the
row-model series into §9 (07-25), the four Round-8 obligations into §10 (07-26), row-model D8/D19
and D87 (07-30), the isolated-runtime boundary into §5 (07-31, Round 10), the two-repo split
(07-31, Round 11), Phase 1f's ratification (08-02, Round 18), and D219's chunk-harness grouping
rule (08-14, Round 61).

**Why it moved.** Every amendment's CONTENT is in the section it amended, and each of those
sections says what it says today rather than what it was changed to on a date. A header that lists
nine amendments answers "how did this doc get here", which is a question `history/` and
`reference/decisions.md` exist for; it does not answer "what is true", which is the only question a
reference doc's opening should answer. The rewritten header states what the doc IS, what it owns,
and where each section went.

Two facts inside it are worth keeping findable, because both are still live and neither is stated
anywhere else in date form: §9's row-model series is **operator-ratified** (2026-07-25), and §5's
cross-repo boundary supersedes D73's live-lift design (2026-07-31, D88/D89/D93).

---

Status: **Phase 1c authority/recovery shell completed 2026-08-01; revised 2026-07-22 after the
whole-plan/legacy-code review.** The span rebuild now also
owns a closed control-command protocol, durable notifications, strict boundary schemas, and an
explicit backup/restore contract for the non-rebuildable SQLite state. **Amended 2026-07-25:** §9
carries the operator-ratified delegation and presentation decisions (row-model series D6–D20).
**Amended 2026-07-26 (Round 8):** §10 adds the four surviving Round-8 obligations this doc owns — the one projection every
count reads (D81), run versioning + archive-on-version-bump (D80), operator-assigned run display
names (D83), and the slimmed notification model (D79b).
**Amended 2026-07-30:** row-model D8 makes OCR approval Review-only; D19 places screenshot
evidence inside Receipt and run data in Context. Reconciliation D87 removes executor-capacity
projections and chips in favor of concrete worker/browser-session state.
**Amended 2026-07-31 (Round 10):** §5 now owns the isolated-runtime boundary and all-at-once
cutover contract (D88/D89), superseding D73 and the historical live-lift/scoped-flip design.
**Amended 2026-07-31 (Round 11):** D93 moves the rebuild out of the legacy tree into a standalone
`hr-automation-rebuild` repo — rebuild code at plain `src/`, rebuild tests at `tests/`, rebuild
config at `config/`, these plan docs still at `docs/rebuild/`. §5 therefore owns a **cross-repo
runtime boundary**: isolation is physical, so the D88 guard machinery is retired and only
operational separation stays gated.
**Amended 2026-08-02 (Round 18):** Phase 1f ratifies planned-start consumption, the minimal
failure/result authorities, the executable command-family boundary, and the complete atomic
write-commit bundle; rich trust projections remain Phase 2g.
**Amended 2026-08-14 (Round 61):** §Shell — a chunk harness presents as a step of its composition
on every workflow-listing surface (D219): nested under the composition via the ONE grouping rule,
served as a required wire `role`, no count roll-up, labels and startability unchanged.

