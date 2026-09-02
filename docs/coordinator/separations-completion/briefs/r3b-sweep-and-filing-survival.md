# R3b — exact pending sweep and surviving filing authority

Date: 2026-09-02. No date gate. Base: `36f0562f` plus coordinator receive/admission commit.
Repository: `/Users/julianhein/Projects/hr-automation-rebuild` on `feature/03b-live-close`.
Profile/workspace/board/run plan: `/Users/julianhein/Projects/hr-automation-rebuild/docs/coordinator/separations-completion/{project-profile.md,board.md,run-plan.md}`. Board READ ONLY; coordinator alone writes it.
Report: `docs/coordinator/separations-completion/reports/r3b-sweep-and-filing-survival.md`.
Evidence: `docs/coordinator/separations-completion/evidence/r3b/`; restricted live screenshots stay ignored.

## Cleared boundary
R3a/D309 is verified complete. A supplied EID with exact UCPath read-back has machine authority and no workflow approval gate; name-resolved identity has the existing real operator gate. D287's extra in-workflow per-write approvals are superseded on the supplied-EID path. Do not re-open that decision.

This run implements the remaining safe protocol mechanics without a real HR write and without selecting a real deletion target. The workflow must never delete the filing Kuali records. The eventual controlled deletion proof is independent of the real separation filing, on an exact disposable Pending set. The actual target and its restoration/retention disposition remain an operational R4 packet, not an implementation blocker. No caller-controlled bypass, random idempotency key, direct sequencer script, forged approval, test-only rail or reinterpretation of immutable intents.

## Units

### u17 — exact pending-transaction-set deletion authority
Own the deletion contract, UCPath pending-row read/stage/probe/verify driver, fake driver, sequencer integration and compatibility tests.
- Replace person-only deletion identity with a canonical exact approved Pending transaction set and its load-bearing row facts. The permanent key/digest must distinguish distinct sets for one EID; replay of the same set reuses without browser/click. An empty historical no-op must not suppress a later nonempty set.
- Establish stable transaction identity through live read-only UCPath mapping when necessary. Use actual exposed row/transaction identifiers and recorded provenance; never guess selectors or use position/index as identity. If no stable identity exists, fail loud and return the verified blocker rather than broadening the sweep.
- Before fence/click, re-read and require exact agreement: missing, ambiguous, changed, newly appeared unapproved, or extra eligible rows refuse with zero fence/click. The selected set must be the complete eligible set for the declared all-pending-clear outcome. Verify exactly that set absent afterward while protected filing targets remain present.
- Define explicit compatibility/refusal for immutable old person-only intents; never rewrite/reinterpret them.

### u18 — finalization cites a currently surviving filing
Own the filing-presence read, descriptor wiring, finalization input/receipt truth and real composition regression.
- Keep ordinary order sweep-before-file. The independent deletion proof cannot consume or delete the filing receipt used by Kuali.
- Before Kuali finalization is eligible, perform a typed fresh UCPath read proving the exact durable successful filing transaction ID still exists for the exact supplied/read-back EID, effective date and acceptable status. Bind this observation through the existing freshness boundary. Missing, denied, deleted, changed, ambiguous or mismatched filing refuses before Kuali fence/click.
- A downstream refusal preserves the filing receipt and must never re-file to repair finalization. D307 asserted transaction input stays asserted and cannot become controlled-filing evidence.
- Turn migration §9.36's deleted-filing diagnostic into a green regression refusal through the supported run/executor/gate/receipt composition with temporary SQLite and fake external systems. Also prove the valid surviving path, crash/resume/replay, supplied-EID no-gate path, name-only gate path, `dryRun=true` zero writes, and UNKNOWN stop.

## Authority and validation
The supervisor owns central contract/compatibility judgment and integration. `/supervise` may dispatch only native permitted roles, one bounded seam each, with exact ownership; use isolated `feature/<unit>` worktrees for writable parallel units and merge `--no-ff`, or keep the established serial primary exception if the work cannot safely isolate from runtime. The coordinator writes no source/canonical file and no worker writes the board. Do not perform real HR writes, delete real UCPath rows, mutate target registry/environment, approve a workflow gate, or start a new dashboard run in R3b. Live read-only selector/identity verification and fake-external writes are authorized. Use /ui + playwright-cli only if rendered UI changes; otherwise parity is still required when served fingerprints move.

Ratify the protocol mechanics in D287's owner and pointer only to the extent proved by code: deletion is independent and exact-set scoped; the real filing must survive through finalization; extra supplied-EID workflow approvals are superseded. Do not claim an actual target/disposition or controlled live proof. Update nearest instruction twins and affected tests/manifests. Historical evidence remains historical.

Required gates: focused red→green proof; typecheck; lint; full default test:coverage; build manifest check; roadmap check; parity assert (deliberate update only after reviewed intentional delta); diff check; exact instruction twin comparisons. Stop the owned dashboard before port-using full coverage and restore it afterward with matching served fingerprint, healthy storage, closed owned browsers and no new write/run rows. Conduct consequential correctness/security/replay/compatibility review. Commit logical categories locally with explicit paths; no push/master merge. Return a coherent implemented report or a verified stable-identity blocker. No successful nested-run handoff; no operator question unless a real judgment remains after completing all unblocked work.
