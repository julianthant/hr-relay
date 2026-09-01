# DCA4 — bounded worktree/residue audit

Read-only `/worktree-sweep` pass while awaiting the repaired candidate's browser allocation.
This is not cleanup or integration acceptance. Recheck after final gates/commits.

| Assigned worktree / branch | HEAD | State | Classification / action |
| --- | --- | --- | --- |
| `/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4` / `feature/dca4-archive-evidence` | `eda17b2708286e36542e1e18e9f8ef6a06cf3187` | Owned adopted dirty feature, tests and evidence; no new commits yet | Dirty with known work — retain for completion, then coordinator integration |

No child worktrees were created. No branch/worktree removal, pruning, merge, stash, reset or clean
was performed. The assigned source branch/tree must remain for coordinator-owned integration into
`integration/03b`; root `master` is not this supervisor's release authority. Foreign worktrees were
not inspected or cleaned; only this worktree's record was selected from git's administrative list.

Ancestry recheck: both DCA1 `c72f0e69` and R-DCF `e0cd4353` remain ancestors (exit 0).
At this audit `integration/03b` remains `13175b13340fec7b5326207fe54f98078d481d7d`; this existing
source branch has eight commits not reachable from it, all predating this supervisor's uncommitted
work. This is not eight new DCA4 completion commits. The integration owner must retain that history
and the forthcoming category commits through its normal reviewed merge. Original six intake hashes
were rechecked unchanged; transient last-run, shared materializer and regenerated manifest all have
zero diff from this source HEAD.

## Original 21-path disposition

Exact intake status is preserved in `dca4-intake.md`; nothing is silently discarded.

| Original path | Current disposition |
| --- | --- |
| `docs/rebuild/reference/dashboard-surfaces.md` | Adopted exact archived snapshot/resource authority contract; independently reviewed |
| `docs/rebuild/reference/frontend-backend-integration.md` | Adopted exact routes/wire/errors plus capability-first precedence; reviewed/test-pinned |
| `src/dashboard/AGENTS.md` | Adopted viewer contract and dated lifecycle/HTTP-boundary lessons |
| `src/dashboard/client/queries.ts` | Adopted typed exact-ID resource query and real abort signal |
| `src/dashboard/surfaces/archive-model.ts` | Adopted exact request/image-attempt lifecycle and formatting; reviewed |
| `src/dashboard/surfaces/archive.tsx` | Adopted frozen facts, honest byte/decode refusal, stable frame and local focus/touch behavior |
| `src/domain/dashboard/archive.ts` | Adopted strict resource wire boundary and exact download URL refinement |
| `src/server/dashboard/queries/archive.ts` | Adopted archived authority validation and streaming metadata verification; shared materializer unchanged |
| `src/server/dashboard/routes/api.ts` | Adopted exact archive resource/download HTTP routes and scoped capability/refusal behavior |
| `test-results/.last-run.json` | Sole generated status change preserved in intake receipt, then restored exactly to tracked value; not feature proof |
| `tests/parity/helpers/fixture-bff.ts` | Adopted opt-in exact-byte evidence routes and real HTTP dispatcher repair; original broader scenario intact |
| `tests/unit/dashboard/archive-detail-render.test.ts` | Adopted existing tests with strict typing/expectations updated to actual frozen capture behavior |
| `tests/unit/dashboard/archive-render.test.ts` | Adopted and extended async lifecycle/frame/focus/refusal regressions; red controls recorded |
| `tests/parity/archive-evidence.spec.ts` | Adopted eleven real browser cases; strengthened exact fault-injection proof; final browser execution still pending |
| `tests/parity/archive-evidence.spec.ts-snapshots/archive-evidence--graphite-warm--1280x720-darwin.png` | Moved byte-for-byte to coordination `evidence/dca4-intake/`; marked BAD intake, not accepted reference |
| `tests/parity/archive-evidence.spec.ts-snapshots/archive-evidence--paper-ink--phone-390x844-darwin.png` | Moved byte-for-byte to coordination `evidence/dca4-intake/`; marked BAD intake, not accepted reference |
| `tests/parity/references/archive-evidence--graphite-warm--1280x720.a11y.yml` | Preserved byte-for-byte under intake `reference-originals/`; active file not yet refreshed/accepted |
| `tests/parity/references/archive-evidence--graphite-warm--1280x720.meta.json` | Same preservation; active file not yet refreshed/accepted |
| `tests/parity/references/archive-evidence--paper-ink--phone-390x844.a11y.yml` | Same preservation; active file not yet refreshed/accepted |
| `tests/parity/references/archive-evidence--paper-ink--phone-390x844.meta.json` | Same preservation; active file not yet refreshed/accepted |
| `tests/unit/server/archive-capture-resource.test.ts` | Adopted exact-authority/digest/byte verification tests; repaired and independently reviewed |

Additional task-owned paths: root `AGENTS.md` lesson, generated `docs/roadmap/index.html`, exact
canonical evidence fixture, capture client/fixture/route tests, and this task's coordination reports,
brief and preserved evidence. Stage paths explicitly only after required gates; no catch-all commit.

## Ignored/generated resources

Observed by `git status --short --ignored`, `ls -ld` and `du -sh` on exact assigned paths:

| Resource | Observation | Disposition |
| --- | --- | --- |
| `node_modules/` | Existing local dependency directory | Retain while source tree is needed; regenerable dependency data, not source/evidence |
| `dist/` | Generated stamped dashboard bundle, 2.6 MB at audit | Retain for queued verification; relevant original build stamp copied into durable evidence |
| `tests/parity/.output/` | Initial red browser output, 96 KB at audit | Six error contexts preserved byte-for-byte under `evidence/dca4-gates/`; regenerate only via scoped gates |

Exact local path-presence checks found no `.env`, `.env.local`, `.tracker-rebuild`, `.auth` or
`.playwright-cli`. No credential content or live authority was read. This is a bounded observed
inventory, not a claim about external machines or foreign checkouts. All native units are closed;
no owned test/server/browser command remains at this queue point. HTTP tests closed and removed only
their own generated ephemeral fixtures through tested `finally` blocks. No foreign process killed.

## Reservation and negative-control policy

Coordinator verified repaired readiness and reserved **DCC4 → DCA2 → DCA4**; this is not slot-open.
Only after explicit allocation: first restored positive decode/abort cases in the scoped eleven-case
run, then two predeclared case-local 404 substitutions one at a time. Retain every assertion, expect
the specific missing decoder marker or exact failed-request tuple, preserve raw output, restore spec
SHA `d158e014dd85b42ae6f42fb5d02aaf2a54408f348e4ab008627eb25ce8db6de1` immediately, then run
that positive case. Expected intended reds retain the slot only with exact restoration and immediate
positive pass. Any unexpected pass/failure, hash mismatch or repair need releases the slot after
owned process stop/restoration. Every parity/coverage command separately takes the existing lock;
no reference update/commit during probes. No extra mutants or rerun loops. Full gates use only the
fully restored reviewed candidate. All actual browser/negative/full-gate outcomes remain pending.
