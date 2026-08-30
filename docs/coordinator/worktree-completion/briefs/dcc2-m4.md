# DCC2 M4 — integration acceptance and preserved UI

Role: `sup_terra_dcc2_m4_verify_preflight`, native high, 240k/220k. Sequential verification only.
Every command/edit uses `/Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc2` explicitly.
Profile: `/Users/julianhein/Projects/hr-automation-rebuild/docs/coordinator/worktree-completion/project-profile.md`.
Report: `docs/coordinator/worktree-completion/reports/dcc2-m4.md` in assigned worktree.
Evidence directory: `docs/coordinator/worktree-completion/evidence/dcc2-m4/`.
All shared boards, root checkout, integration branches and foreign worktrees are out of scope.

## Inputs and boundary

Read complete profile, applicable AGENTS.md and `/Users/julianhein/.agents/skills/ui/SKILL.md`
plus the routed verification playbook yourself. Browser interaction uses the installed
playwright-cli reference; never Chrome MCPs. No real HR workflow, credential access or live authority.
All runtime test state must be isolated synthetic fixtures from the declared parity harness.

The supervisor will supply the reviewed immutable candidate tree at dispatch. HEAD remains
`ac40292b8e3e8ff9b66242bbf8f8288554335f40`, pending authorized merge of frozen baseline
`13175b13340fec7b5326207fe54f98078d481d7d`. Verify HEAD, MERGE_HEAD, exact index tree,
zero unmerged paths and tracked worktree/index equality before gates. Reports/evidence are
intentionally untracked until the separate documentation commit.

M3 reconciles one preflight authority and preserves baseline Settings/Explorer/reporting UI.
Product dashboard source equals frozen baseline; parity helper changes only doctor trust-root options.
Do not redesign/re-freeze references, alter thresholds/timeouts/assertions, or commit.
If a gate fails, report exact failure and candidate identity; supervisor assigns any repair.

## Gate protocol

Do not start coverage/parity until this supervisor explicitly confirms the coordinator's heavy slot.
With allocation, still take `/tmp/hr-dashboard-full-gate.lock` using `/usr/bin/lockf -k -t 0`.
A busy lock is a scheduling result: report it, do not spin or unlink. One owned gate at a time.
Set `HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation` for guard-data-only use.

1. Spot-check prior locked typecheck/lint and final focused evidence; report exact applicable tree.
   Any required full repeat must use `/usr/bin/lockf -k -t 45 /tmp/hr-worktree-light-gate.lock`.
2. Run allocated full coverage: `env HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation
   /usr/bin/lockf -k -t 0 /tmp/hr-dashboard-full-gate.lock env VITEST_MAX_WORKERS=1 npm run test:coverage`.
3. Run allocated parity: `/usr/bin/lockf -k -t 0 /tmp/hr-dashboard-full-gate.lock npm run test:parity`.
   Preserve complete output and real exit codes. Use existing parity references unchanged.
   Inspect relevant Settings/preflight/storage output and report rendered behavior/evidence,
   not simply test invocation. Browser session cleanup is owned sessions only.
4. Verify generated manifest/roadmap checks and `git diff --check` against reviewed candidate.
   Do not stage report/evidence or mutate product source; supervisor owns integration.

Acceptance: full gate outputs/counts/coverage floors, unchanged reference corpus, relevant UI proof,
verified final tree, no active owned test/browser processes and no unreported product changes.
Report STATUS / ROLE / MODEL / REASONING / COMMITS / FILES / GATES / REVIEW-HINT / NOTES.
Prior SIGTERM checks are CANCELED and prior red intermediate suites remain red in the ledger.
