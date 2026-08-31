# DCC1 F1b — HTTP boundary regression proofs

2026-08-30 · native `sup_sol_dcc1_f1b_http_boundary_proofs` · high reasoning.
Status: PARTIAL — both requested proof gaps are pinned; the expanded snapshot exposes an additional
production refusal side effect. The required full two-file test gate is RED, not waived.

## Scope and preserved state

All commands/edits used `/Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc1` on
`feature/r-dcc-dcc1-exclusive`. Incoming index tree was
`429a3483eca61b211026478d2d610b7b00884ecf`; HEAD remains
`0c115123a738f62cbe01c9b45f53b7289284479c`, MERGE_HEAD remains
`13175b13340fec7b5326207fe54f98078d481d7d`. No commit, agent, browser/build, heavy gate,
live authority, migration, board or other-checkout change.

- BFF `settingsAuthoritySnapshot` now reads optional `.authority.json` initialization and `.lock`
  bytes using the existing filesystem observation helper. It does not call the effectful Settings
  authority reader. All body-read spies, body-used assertions and durable snapshots remain intact.
- Four typed-client cases pin bulk 409, non-command 409/422 and undeclared command 500. Each first
  proves the same body parses through the real typed client at 200, then requires
  `DashboardClientError(kind="http", exact status)` at the disallowed status. Existing positive
  command statuses and 403/415 tests are unchanged.
- `/tdd` tests mode used the dispatch-confirmed seams and mutation proof. `/ui` routed only the
  client error-handling review; no rendered change or visual acceptance is claimed (parent M4 owns
  that). Existing F1/root and client contracts already document these invariants; no AGENTS change.

## Red/green evidence

Every Vitest invocation used the exact prefix:
`env VITEST_MAX_WORKERS=1 HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation npm run test --`.
No gate ran before the parent's explicit F3b release.

| Invocation suffix / command | Result |
|---|---|
| `tests/unit/server/bff-flow.test.ts tests/unit/dashboard/client-transport.test.ts` | Exit 1: 50 passed / 1 failed (51). All 17 client tests passed. BFF schema-mismatch zero-effects assertion now detects initialization evidence creation. |
| `tests/unit/server/bff-flow.test.ts -t 'without consuming'` with an actual `deps.settingsEditor.settings.read()` middleware before the ingress guard | Exit 1: 3 failed / 31 skipped. Each reached the unchanged zero-read/body-used assertions, then failed on initialization bytes changing from absent to a 218-byte virgin record. |
| `tests/unit/dashboard/client-transport.test.ts -t 'keeps bulk 409\|keeps non-command'` with all-route 409/422 admission | Exit 1: 3 failed / 14 skipped; each reported `Missing expected rejection`. |
| `tests/unit/dashboard/client-transport.test.ts -t 'keeps undeclared command'` with all-command-status admission | Exit 1: 1 failed / 16 skipped; `Missing expected rejection`. |
| `tests/unit/server/bff-flow.test.ts tests/unit/dashboard/client-transport.test.ts -t 'without consuming\|keeps bulk 409\|keeps non-command\|keeps undeclared command'` after restoring both production blobs | Exit 0: 7 passed / 44 skipped. This is targeted mutation restoration proof, not the full acceptance gate. |
| `/usr/bin/lockf -k -t 45 /tmp/hr-worktree-light-gate.lock npm run lint` | Exit 0; full lint with zero warnings. |
| `git diff --check`; `git diff --cached --check` | Exit 0. |

Temporary production changes were restored exactly:

| File | Original and restored blob |
|---|---|
| `src/server/dashboard/routes/api.ts` | `a6fb0f45ac423a5f6c1c5439a51a51dabda013ab` |
| `src/dashboard/client/transport.ts` | `f65a6c574539a1cbd6535e4005acb1a7b80dce8b` |
| BFF test final blob | `bc41eebb2729f955acdbe4a8990e5d788ff2810a` |
| Client transport test final blob | `a4fe95a56eebd7af661b27b00df794baa9003342` |

## Exact remaining issue / parent handoff

`tests/unit/server/bff-flow.test.ts:915` now proves that a schema-mismatched Settings command on a
pristine authority creates `${settingsPath}.authority.json`. The unchanged production
`src/infra/config/settings-file.ts:1530` calls `readState()` before its schema-hash comparison at
line 1533. `readState()` creates initialization evidence at lines 1160–1162 when absent. Settings,
prepare, current, journal, audit and generation values remain unchanged; initialization does not.
The command still returns the expected 422/schema-mismatch. This is a real newly observed side
effect, not a mutation left behind or a reason to omit the added snapshot field.

No permanent production repair was authorized in F1b. Preserve this red test and let the parent
assign the smallest owning-authority repair or explicitly resolve the contract; do not preinitialize
the fixture or weaken the equality to hide the finding. Parent final typecheck/full gates,
independent review and commit remain required. Only the two assigned tests and this report are
staged by F1b; parent report/spec edits remain intact and unstaged.

Resume prompt: Read this report alongside the existing
`docs/coordinator/worktree-completion/project-profile.md` and verify HEAD, MERGE_HEAD and dirty
ownership first. Resume at the schema-mismatch initialization side effect in the owning Settings
authority; retain the full two-file gate and exact production restoration evidence above.

Following the repository handoff requirement, this report contains the bounded handoff state instead
of creating another artifact outside the explicit F1b path allowlist. No board write or fresh task
is requested. All F1b processes have settled; light-gate ownership returns to the parent.
