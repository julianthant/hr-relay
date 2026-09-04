# Live verification decisions — operator context

This topic record preserves answers about Separations canaries and bounded live-run execution.
Normative behavior remains in docs 03.2/03.3, the Separations migration record, and the reference docs
named by `docs/rebuild/reference/decisions.md`.

## D280 — 4568 dry-run-first canary

On 2026-08-27 the operator chose the combined option: run the composed workflow on Kuali document
4568 with `dryRun=true` first, then use it for the controlled ② → ① → ③ sequence only if that audit
was clean and each ALWAYS-GATE was approved. D284 later superseded 4568's active-canary role without
erasing its historical evidence.

## R2 preflight and receive

These were run-local choices, not durable architecture decisions:

| Date | Call | Answer |
|---|---|---|
| 2026-08-27 | Repair `setRangeField` before the live pass | Do the verified driver unit first. |
| 2026-08-27 | Reuse the rehearsal reads for ② | Yes; the designed checkpoint policy permits it. |
| 2026-08-27 | Driver for ③ | Use the composed graph, with standalone Kuali finalization only after the named Kronos refusal. |
| 2026-08-27 | Integration timing | Merge the reviewed integration branch `--no-ff` after the run stages. |
| 2026-08-27 | Registration-only workflow mode | A workflow with no transaction node runs without pretending to be a dry run. |
| 2026-08-27 | Stale BFF | Restart only the verified BFF, leave Vite untouched, and require served/tree fingerprint equality. |

The run remained subject to the frozen-tree boundary, no post-② whole-graph retry, and UNKNOWN
submit stop rule recorded by its plan and board.

## D284 — one active Separations test subject

On 2026-08-28 the operator selected option A's verify-first boundary and narrowed the registry to
one active subject: Kuali document 4537 under `finalization-canary`, supported by both Separations
workflows. Every other active label was removed; historical observations remained migration
evidence. If the subject disappeared or materially changed, it stayed registered with an honest
unavailable state and no substitute.

Normative owner: doc 03.3 §The canary and target registry.

## D286 — test-subject secrets

The operator selected both recommendations on 2026-08-28. Display names and the EID moved behind
strict secret references, and the EID reference had to be provisioned and smoked without printing
its value before controlled commit ②.

Normative owner: doc 03.3 §The canary and target registry.

## D287 — controlled sequence

After one green composed rehearsal with exact-run 0/0/0 write evidence, the operator authorized
② → ① → ③ and an immediate ① witness after ②. Every ALWAYS-GATE remained in force, and an UNKNOWN
submit remained terminal for retry purposes.

D310 later separated the pending-sweep witness from the real filing, and D329 now requires the
independent sweep to complete before the coupled filing/finalization task. The old ② → ① → ③
sequence is historical authorization, not permission or ordering for another run.

Normative owner: doc 03.3 Tasks 1–3.

## R2c diagnostic scope

The operator authorized one narrowly scoped, redacted diagnostic-capture unit before the deferred
repair. It could capture categorical/count/boolean settlement facts after a real timeout, but could
not change the 45-second bound, turn unknown into empty, add a selector fallback, expose an
identifier, retry the search/workflow, or change transaction behavior. This was operational scope,
not a D-numbered product decision.
