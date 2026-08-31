# Supervisor brief — D293 destination-only Run-modal port

Invoke `/supervise` and `/ui`. Resume the existing Run-modal supervisor task. The operator's final
answer is `1A`: preserve both newer screens—the Options screen and the separate Steps screen opened
by `Customize steps`—and remove only the per-start Destination controls. This is a bounded port and
proof run, not permission to merge the old conflicting branch.

## Authorities and exact branch state

- Repository profile: `/Users/julianhein/Projects/hr-automation-rebuild/docs/coordinator/worktree-completion/project-profile.md`
- Coordinator board, read only: `/Users/julianhein/Projects/hr-automation-rebuild/docs/coordinator/worktree-completion/board.md`
- Final D293 amendment commit: `e5595e4e`
- Closed decision: `/Users/julianhein/Projects/hr-automation-rebuild/docs/coordinator/worktree-completion/decisions/dcf-modal-authority-conflict.md`
- Receive report: `/Users/julianhein/Projects/hr-automation-rebuild/docs/coordinator/worktree-completion/reports/dcf-run-modal-receive.md`
- Visual evidence: `/Users/julianhein/Projects/hr-automation-rebuild/docs/coordinator/worktree-completion/evidence/run-modal-comparison/`
- Owned worktree: `/Users/julianhein/.codex/worktrees/7356/hr-automation-rebuild`
- Preserved source branch: `codex/r-dcf-dashboard-fidelity` clean at `45b525f1`
- Authoritative product base: `integration/03b` at `13175b13340fec7b5326207fe54f98078d481d7d`
- Owned branch: `codex/r-dcf-modal-port`, currently clean at that exact base
- Report: `docs/coordinator/worktree-completion/reports/dcf-modal-port.md`
- Partial-stop handoff only if needed: `docs/coordinator/worktree-completion/handoffs/2026-08-31-dcf-modal-port.md`

Before editing, verify that the owned branch is clean at `13175b13`. If any stopped 1B work exists,
inventory it and reverse only that intent without resetting or discarding unrelated work. Read the
current repository instructions, amended D293 in root ref dashboard-surfaces §9.1 and the decision
index, D285 on `integration/03b`, the closed sheet and the receive report. Never force, delete,
rewrite or merge the preserved DCF branch.

## Product ruling

D284 keeps its later sole-4537-canary meaning. D285 remains authoritative in full:

- ordinary path `Input -> Options -> Confirm`;
- Options is always present and owns `Customize steps`;
- enabling it inserts the separate `Steps` screen after Options;
- `selectedStepKeys`, the step-selection service/wire, confirmation and request fingerprint remain;
- the descriptor summary, active-run policy, priority, dry run and existing queue copy remain unless
  a current authority requires a correction independently of the old DCF branch.

Port only the compatible destination-removal intent from `e52a22fe` onto the later base:

- remove the Destination group and per-system UCPath/CRM production/test selectors;
- remove destination state and system-instance plumbing used only by this dashboard form;
- omit `requestedInstance` from the dashboard start-plan request and its dashboard fingerprint;
- keep the optional lower-level `requestedInstance` ingress for other authorized producers/tools;
- show no test-target badge or claim that the dashboard selected a test system;
- let the planner's existing resolution select production for every declared browser system.

Do not port the graph-timeline commits `376a2675`/`cf9884a9`, their schema, copy, tests or parity
references. Do not remove or redesign Customize steps. Do not import stale plans or reuse the old
colliding D284/D285 decision text. Preserve every unrelated later integration behavior.

## Units and proof

1. **P1 — stopped-state and delta map.** Verify the clean branch/base, record that no 1B product
   mutation survived the stop, and map only the compatible destination-removal delta against current
   D285 files and tests.
2. **P2 — destination-only implementation.** Through `/ui`, remove the form's destination controls,
   state, request/fingerprint field and test badge while preserving both selected screens and every
   D285 step-selection boundary. Update focused source/UI tests and the nearest `AGENTS.md`.
3. **P3 — authority and rendered proof.** Carry amended D293 owner/pointer text from `e5595e4e` by
   intent, regenerate the roadmap, and use `playwright-cli` to prove desktop plus 375px/768px layouts,
   keyboard/focus, Options, enabled Customize steps, the separate Steps screen, plan/confirm/result
   continuity, and absence of Destination/test-target controls. Close every browser session.
4. **P4 — review, gates and handback.** Run focused single-worker tests, locked typecheck/lint,
   manifest and roadmap checks, then serialized `npm run test:coverage` and asserted
   `npm run test:parity`. If expected destination-only visual diffs require re-freezing, inspect every
   affected image/a11y diff, use the one deliberate update path, and rerun asserted parity. Review
   standards, spec, correctness, silent failures, performance, tests, docs, security and UI/a11y.
   Commit by logical category with exact-path staging, leave a clean branch, and report exact commits,
   gates, screenshots, limitations and serial integration position.

Use only allowed native `sup_scout`, `sup_analyst`, `sup_luna` and `sup_terra` roles with exact
prefixes and budgets. The Sol supervisor owns the hard reconciliation, visual judgment,
consequential review, commits and final proof. Do not mutate any other worktree, `integration/03b`,
master, remote, live HR authority or legacy source. No direct merge, push, live run or cleanup of
retained branches.
