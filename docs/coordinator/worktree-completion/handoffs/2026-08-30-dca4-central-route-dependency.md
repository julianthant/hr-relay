# Handoff — DCA4 Archive evidence, central route dependency

**Date:** 2026-08-30
**Paused at:** Approved A5–A8 repairs received and independently reviewed; complete wire guard still fails only for the centrally owned generic artifact route. No full-gate allocation or commit permission.
**Cleanup owner:** Coordinator or resuming supervisor after coordinator receive.
**Remove when:** Required gates, logical commits and coordinator integration/board receive are verified, and every surviving fact is in the reports/authorities.

## Task summary

Finish ONLY Archive evidence in the existing DCA4 isolation. Do not fork more supervisors, write a foreign checkout, modify live HR authority, provision credentials, or change the shared materializer. All commands must explicitly use the workdir below; all edits must be absolute inside it. No product commits over required red gates, no push/reset/clean or broad staging.

## Plan and shared state

- Project profile: /Users/julianhein/Projects/hr-automation-rebuild/docs/coordinator/worktree-completion/project-profile.md
- Run plan: /Users/julianhein/Projects/hr-automation-rebuild/docs/coordinator/worktree-completion/run-plan.md
- Board: /Users/julianhein/Projects/hr-automation-rebuild/docs/coordinator/worktree-completion/board.md — READ ONLY. Last observed file SHA256 feb2deac2bf7b17e3887fc7920b36c5fc8416ccfa7fb31d687b9b56075b5952e; it may legitimately advance.
- Local coordination workspace: /Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4/docs/coordinator/worktree-completion
- Owning contracts: docs/rebuild/reference/{dashboard-surfaces,frontend-backend-integration,guards-and-tests}.md.
- Coordinator thread: 01a04b28-14a3-7362-8778-4543583d9a16.
- Supervisor thread: 01a052ed-f880-7f20-8c9e-8a2f356b9c35.

## Verified git and candidate

Worktree /Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4, branch feature/dca4-archive-evidence.
Intake and current HEAD: eda17b2708286e36542e1e18e9f8ef6a06cf3187. No new commits or staged paths.
Eight PRE-EXISTING commits above integration baseline13175b13340fec7b5326207fe54f98078d481d7d:
c72f0e69, a9d6efb2, 982a19f8, af4e9334, 8fab4b54, 754099cf, 366a59c9, eda17b27.
No child worktrees created; source worktree is dirty and must remain for coordinator integration.

Current bounded evidence: evidence/dca4-gates/parent-repairs-frozen-final.json
SHA256 f0089157f49c391fe877686dc17a13767ca56f9e62e74b7829a5b9983333d558.
Parent re-read all33 candidate files and verified their hashes/lengths.
UI7 3c89958afe63d1b8c0b5b8e8d01fffff25e94d89a2cbbc517ec7b799cdb4d461; backend6 1ae6ca5fc56a4d49dc44b4ea6b28c289a2dc67702419f00e3abdca9645bd28cb; protected source/test/script/config1623 digest fbcb4c5a9c7b352ce1dbb802c1b9dab30f86c4897492c54dfa2248b444f3de65.
The backend aggregate includes root lessons; backend implementation/materializer did not change in A5–A8.
Spec remains e2c03cb1480d144a4e889e52e98f4dc302bcb4c51fa16042bd448ba35bbac1c0 /23317bytes.
Six Archive references remain the accepted-scoped04 pair; full parity is still unrun.

Uncommitted candidate paths, all owned/preserved DCA4 work (exact bytes in current evidence record):
- `AGENTS.md`
- `docs/rebuild/reference/dashboard-surfaces.md`
- `docs/rebuild/reference/frontend-backend-integration.md`
- `docs/roadmap/index.html`
- `src/dashboard/AGENTS.md`
- `src/dashboard/client/queries.ts`
- `src/dashboard/surfaces/archive-model.ts`
- `src/dashboard/surfaces/archive.tsx`
- `src/domain/dashboard/archive.ts`
- `src/server/dashboard/queries/archive.ts`
- `src/server/dashboard/routes/api.ts`
- `src/server/dry-run-scenario/runtime.ts`
- `tests/parity/archive-evidence.spec.ts`
- `tests/parity/helpers/fixture-archive-evidence.ts`
- `tests/parity/helpers/fixture-bff.ts`
- `tests/parity/references/archive-evidence--graphite-warm--1280x720.a11y.yml`
- `tests/parity/references/archive-evidence--graphite-warm--1280x720.meta.json`
- `tests/parity/references/archive-evidence--graphite-warm--1280x720.png`
- `tests/parity/references/archive-evidence--paper-ink--phone-390x844.a11y.yml`
- `tests/parity/references/archive-evidence--paper-ink--phone-390x844.meta.json`
- `tests/parity/references/archive-evidence--paper-ink--phone-390x844.png`
- `tests/unit/architecture/helpers/archive-browser-route-references.ts`
- `tests/unit/architecture/helpers/redaction-surface-audit.ts`
- `tests/unit/architecture/helpers/wire-connectivity.ts`
- `tests/unit/architecture/redaction-surface-scan.test.ts`
- `tests/unit/architecture/wire-connectivity.test.ts`
- `tests/unit/dashboard/archive-capture-resource-client.test.ts`
- `tests/unit/dashboard/archive-detail-render.test.ts`
- `tests/unit/dashboard/archive-evidence-fixture.test.ts`
- `tests/unit/dashboard/archive-render.test.ts`
- `tests/unit/dry-run-scenario-composition.test.ts`
- `tests/unit/server/archive-capture-resource.test.ts`
- `tests/unit/server/archive-capture-routes.test.ts`

The untracked docs/coordinator/ subtree also holds task reports/briefs/raw evidence and this recovery file. Preserve it.
Ignored dist/, node_modules/ and tests/parity/.output/ remain; no owned active command/browser or native agent.
.auth, .env, .env.local, .tracker-rebuild, .playwright-cli and coverage were absent at final check. No credentials copied.

## Progress and proof

- [x] A1–A4 boundary/UI/backend repairs and independent reviews — historical evidence in reports/dca4-a4.md.
- [x] Scoped11 Archive assertion and direct04 PNG/a11y receive; both approved decoder/abort404 controls failed as intended, restored exact e2c03, and passed positive reruns. Do NOT repeat implicitly.
- [x] A5 explicit eager loading — Terra; Tests/Standards0; parent47tests + lockedlint0; reports/dca4-a5-parent-receive.md.
- [x] A6 complete D183 resource registration/canary proof — Sol; Tests/Security/Correctness0; parent101tests + lockedlint0; reports/dca4-a6-parent-receive.md.
- [x] A7 exact4runtime+3fixture port from845ca5a115ee6eef3e10598e88ea0a7fdf361888 — Terra; same2credential red→9green, branch-only9th test preserved; three axes0; parent18tests/lint0. No newly executed post-port omission test; source tracing/pre-port stack and separate readiness refusal are distinct proof.
- [x] A8 actual mounted parent/client/parser/native-sink guard — Terra; five axes0. Parent fullfile24pass/1generic-onlyfail; original zero-problems assertion remains. reports/dca4-a8-parent-receive.md.
- [x] Final other affected regressions216tests/12files,13.10s; full globally locked typecheck/lint0; manifest regeneration unchanged, roadmap fresh, diffcheck0.
- [ ] CENTRAL generic GET /artifacts/v1/:artifactId disposition ← resume here only on coordinator direction.
- [ ] Fresh affected verification/review after authorized central receive; explicit allocation for fullcoverage and full asserted parity.
- [ ] Logical local commits, clean integration-ready report and coordinator-owned integration/removal.

Latest heavy gate remains fullcoverage05: session19166 exit1,5failed/3629passed tests,266.74s.
Raw full-coverage-05.log SHA8d894ee26188f8e404485bedbcae88965f7259f7d125cc41e25485cc491217ab.
No later coverage/full asserted parity. Focused repair proof is NOT a gate waiver.

## Unresolved authority and evidence limits

Generic route remains central, distinct from Archive's two-ID route. No dummy caller, unused-builder credit, pending exception, route deletion or production URL copy is authorized. A8 tests currently pin the exact generic residual; central aggregation must reconcile real consumers and these expectations without weakening accounting. Shared byte materializer/response repair also remains coordinator-owned and needs fresh integration gates.

Historical gate04's giant before-map contains irrecoverable truncated rows. Preserve it verbatim; original pre-gate aggregate continuity was independently audited, but there is no complete per-path before proof or retroactive protocol compliance. reports/dca4-a4-evidence-audit-04.md owns that disclosure. Current record is fresh, not reconstruction. A separate final record attempt hit Node's stdout buffer before output/write; the successful repeat streamed diff hashes; attempt01 remains disclosed.

## Verification before resuming

Read reports/dca4.md, dca4-a4.md and dca4-a8-parent-receive.md first, then verify the current evidence file and every changed path. Re-read the supplied profile/board; never infer allocation from an unlocked OS lock.

```sh
git -C /Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4 status --short
git -C /Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4 branch --show-current
git -C /Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4 log --oneline 13175b13340fec7b5326207fe54f98078d481d7d..HEAD
git -C /Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4 worktree list
```

Every test uses VITEST_MAX_WORKERS=1; architecture adds HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation.
Only one owned light command at a time. Full typecheck/lint separately take /usr/bin/lockf -k -t45 /tmp/hr-worktree-light-gate.lock.
Coverage/parity need explicit coordinator OPEN and separate /usr/bin/lockf -k -t0 /tmp/hr-dashboard-full-gate.lock.
Assertions unset PARITY_UPDATE. Busy75 queues, no spin/unlink. Unexpected heavy red/repair or final terminal releases immediately before polish.
Existing A3 gate unit is native Terra01a052f9-aace-7530-b01c-fbb9293a2446, closed; reuse it if coordinator allocates gates.
A8 writer Terra01a052ff-414f-79b3-bc5d-fa871c2457dd and all reviewers are closed; use native sup_* only, exact role-prefixed titles and profile budgets.

## Suggested skills

- /supervise — mandatory bounded orchestration, not feature implementation by parent.
- /ui and /hr-debug — any frontend/parity or evidence-led repair.
- /review — independent fixed-diff axes after authorized deltas.
- /worktree-sweep — only owned subunit cleanup; coordinator retains source removal authority.
