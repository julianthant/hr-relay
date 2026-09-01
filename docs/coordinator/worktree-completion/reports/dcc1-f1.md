# DCC1 F1 — strict HTTP command ingress

2026-08-30 · `sup_sol_dcc1_f1_strict_ingress` · native `sup_sol`, high reasoning.
Status: assigned seam complete and staged for parent review; no commit, coverage or parity claim.

## Scope and invariant

Every command/edit ran in `/Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc1`.
HEAD remains `0c115123a738f62cbe01c9b45f53b7289284479c`; MERGE_HEAD remains
`13175b13340fec7b5326207fe54f98078d481d7d`. The approved merge remains open.

- Removed the loose intermediate body contract. Server provenance replaces only its three owned
  fields on still-untrusted input; canonical strict single/bulk schemas parse before identity reads
  and acceptance serialization. No parallel hand-authored command schema or domain changes.
- Bulk parse errors now return the existing typed `schema-mismatch` refusal directly; an accepted
  bulk arm and execution callback carry `BulkRunCommandRequest`, never unvalidated `unknown`.
- Preserved server actor/source/time stamping, serialized single-id acceptance, durable ordered
  bulk parent identity and replay of original acceptance time. DCR/D75 mismatch refusal remains
  coordinator-owned, not implemented here.
- Repaired the editor request's Origin/Host headers. The provenance test compares complete journal
  and audit envelopes to an independently constructed expected envelope, then hashes that expected
  envelope with Node SHA-256 and the declared domain separator rather than comparing the producer
  to itself or retaining an obsolete schema-dependent hash literal.
- Regression matrix covers unknown envelope/target/nested payload fields, invalid identity/action/
  target types, empty bulk targets and non-object bodies. Missing/foreign Origin and text/plain
  exercise both actual HTTP doors with real Request read-method spies, `bodyUsed=false`, and exact
  unchanged file/current/journal/audit/generation/run/parent/child observations.

Skills: `/debug` fast arm used the reproduced known BFF failures; `/tdd` tests mode used the
dispatch-confirmed real BFF seam and temporary mutation proof. No scouts or other agents spawned.

## Gate evidence

All focused Vitest commands used this exact prefix:
`env HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npm run test --`.

| Command after that prefix (unless shown in full) | Result |
|---|---|
| `tests/unit/server/bff-flow.test.ts` — initial reproduction | Exit 1; 2 failed / 21 passed. Persisted hash actual `f68515…` vs stale `a339d4…`; editor status 403 vs 200. |
| `tests/unit/server/bff-flow.test.ts` — repaired tests, then strict implementation | Each exit 0; 30 passed before adding four non-object cases. |
| `tests/unit/server/bff-flow.test.ts -t 'without consuming'` — early-body-read mutant | Exit 1; 3 failed / 27 skipped. Real `text` read called once despite unchanged refusal status. |
| `tests/unit/server/bff-flow.test.ts -t 'unknown envelope field'` — silent unknown-field deletion mutant | Exit 1; 1 failed / 29 skipped. Single endpoint returned 200 instead of 400. |
| `tests/unit/server/bff-flow.test.ts tests/unit/architecture/strict-boundary-schemas.test.ts tests/unit/architecture/control-command-single-path.test.ts` — final restored tree | Exit 0; 3 files / 48 tests passed, including 34 BFF tests. |
| `/usr/bin/lockf -k -t 45 /tmp/hr-worktree-light-gate.lock npm run typecheck` | Exit 0; full `tsc --noEmit`. |
| `/usr/bin/lockf -k -t 45 /tmp/hr-worktree-light-gate.lock npm run lint` | Exit 0; full ESLint, zero warnings. |
| `git diff --check`; `git diff --cached --check`; `git ls-files -u` | Exit 0; no whitespace errors or unresolved index entries. |

Both mutations were restored. `operator-mutation-ingress.ts` is byte-identical to its original
blob `4f30b3fc5ed1b89188fa051160ad6430fa0879a3`; no debug tag remains in either helper.

## Handoff to parent

Explicitly staged only F1's four paths: `AGENTS.md`,
`src/server/dashboard/commands/operator-command-ingress.ts`,
`tests/unit/server/bff-flow.test.ts`, and this report. Existing merge index entries are preserved.
Parent documentation corrections and the unused kernel import removal remain unstaged and intact.
No migration history, board, live authority, other checkout, branch or worktree was changed.

The parent owns the separate compose test's missing `singleton_id` repair, other original review
findings, final independent review, allocated coverage/parity, merge commit and integration.
The original eight-file parent command is not claimed green. Light-gate ownership returns to the
parent with this report; no task-owned gate remains running.
