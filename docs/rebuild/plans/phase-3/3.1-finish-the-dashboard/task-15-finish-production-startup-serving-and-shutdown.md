# Task 3.1.15 · Finish production startup, serving, and shutdown
<!-- roadmap: dash-production-runtime -->

**Current assignment: 3.1.15.** Standalone prerequisite or individual task; follow its explicit dependencies.
Read [the current identity map](README.md#current-task-identities) for naming and operator-controlled integration.
Follow the [execution cadence](README.md#execution-cadence--operator-amendment-2026-09-13): focused task checks, full repository gates only at 3.1.19, no independent review.
Earlier labels and filenames are recorded in the [rename map](README.md#earlier-labels-and-filenames).

Read the [subphase overview](README.md) before this assignment for shared scope, dependencies, decisions and gates.

- [ ] Prove production bundle serving, admission/readiness, duplicate/missing-state refusal, ordered
  signal drain, second signal, crash recovery, and orphan sweep.

Current baseline and acceptance: [3.1.8 inventory](task-8-dashboard-inventory.md) and
[frozen matrix and ownership](task-8-acceptance-matrix.md). Remaining checklist items require
their mapped outcome/proof; historical subfeature credit does not complete this task.

## Approved execution brief — 2026-09-23

The operator approved this plan on 2026-09-23 for execution with a Codex Luna xhigh worker. The
frozen [A37 acceptance row](task-8-acceptance-matrix.md#a37), this task's roadmap node, and the
Phase 3.1 [execution cadence](README.md#execution-cadence--operator-amendment-2026-09-13) own its
scope and gates. The approved starting point is integrated `master` commit
`7c524542aa3b4051b7847f264fb571fb43ebaa6d`. All six roadmap prerequisites are marked done and
present in that base. Implementation uses branch `codex/3.1.15-production-runtime` in the owned
`/Users/julianhein/Projects/hr-automation-rebuild-worktrees/hr-worktree-production-runtime` worktree.
The operator retains the choice to integrate the passing candidate into `master`; approval of this
brief alone does not authorize a merge or push.

### Outcomes and ownership

1. **Build and serve the current bundle.** `npm run web:build` must leave a verifiable identity for
   its source inputs and emitted bytes. `dashboard --prod` validates that identity and the regular
   bundle entry before opening the authority, taking a process lock, or listening. Missing, stale,
   changed, or unsafe bytes refuse by name. The loopback BFF serves the ordinary app, assets and SPA
   routes beside its API, events and artifact routes. Keep API precedence, physical and lexical path
   containment, the closed media-type list and cache policy. Align the existing parity freshness
   check with any build identity change; production code must not import tests.
2. **Admit one truthful runtime.** Distinguish a valid virgin state root from an established root
   missing its authority or settings evidence. Refuse incompatible or corrupt authority, invalid
   settings, blocking preflight results and duplicate live ownership with a named cause. Complete
   initial preflight and own the socket before reporting readiness. Any failure after acquisition
   closes resources in reverse ownership order, retains its primary cause and secondary cleanup
   failures, and does not claim a successful start or release a lock ahead of an open database.
3. **Drain and recover.** SIGINT and SIGTERM stop ingress and settle active transfers, observers,
   projections and writers before worker/browser shutdown, authority closure and process-lock
   release. Use the existing D271 bounded graceful-stop/escalation policy for workers the dashboard
   actually spawned; observe their exits. A second signal during drain cannot bypass it. Any owned
   child still live or uncertain at the end makes shutdown fail visibly. Preserve externally started
   workers and unknown processes; never adopt or kill them as a shortcut. After a crash, retain stale
   process evidence, check process birth identity before admitting a new owner, and report orphaned
   worker/lease state for safe recovery. D322 backups remain explicit-only.

The production seams are `src/server/dashboard/{compose,static-bundle,http-server,worker-supervisor}.ts`,
`src/core/runtime-composition.ts`, the build script/configuration and their direct consumers. A
needed settings-reader, process-lock, preflight or parity-helper adjustment belongs here only when
it proves one of the outcomes above. The worker owns corresponding focused tests and fixtures.
No authority schema or released migration changes, workflow policy, unrelated dashboard UI,
legacy-runtime dependency, automatic backup, production cutover, or external HR write is admitted.
A material contract, ownership or dependency change returns to the operator for amendment.

### Production-path proof and controls

Use isolated scratch roots and a real `scripts/secure-env-bootstrap.ts cli dashboard --prod` child
with the actual built bundle. A valid fresh root must serve the app and API, expose the completed
preflight result, and release its exact process record after stop. Exercise these neighboring cases:

| Input or interruption | Required result and forbidden effect |
| --- | --- |
| Missing/stale bundle beside an existing root; missing bundle plus duplicate owner | Bundle refusal precedes authority/lock/socket effects; no old or changed bytes are served. |
| Live duplicate owner beside valid or incompatible state | The second process refuses without changing the first owner's database or lock; the first continues serving. |
| Established root with missing/corrupt authority or settings; pre-floor/ahead schema; blocking preflight | Named refusal, no plausible fresh baseline or implicit upgrade/backup. A genuinely virgin root still starts. |
| Failure after lock/database acquisition or socket bind | Acquired handles and timers settle, primary failure remains visible, and a released lock never precedes an open database. |
| First and second stop signals with active transfer or owned worker/browser | One ordered drain; no successful exit while an owned child remains; failed or uncertain drain exits nonzero with evidence. |
| Crashed server plus stale record and worker orphan | New owner checks identity and recovers only its own authority; orphan evidence remains visible, with no unowned process action or automatic run retry. |

The current focused baseline on the approved base is 64 passed and 4 failed across six relevant
test files, with scoped ESLint passing. `compose-real-port.test.ts` has two assertions pinned to
older schema numbers and two planning cases now blocked by `secrets.ucpath-sso`. Repair their
fixture/expectation ownership without weakening preflight or production refusal; keep positive
controls that reach the intended command path.

Run affected tests with `npm run test --` and exact edited test paths, including the existing
`tests/unit/cli-dashboard-lifecycle.test.ts`, `tests/unit/runtime-composition.test.ts`,
`tests/unit/server/{compose-real-port,static-bundle,dashboard-http-server,worker-supervisor}.test.ts`
and `tests/unit/runtime-process-orphans.test.ts` where affected. Run
`npx eslint <affected code and test paths> --max-warnings 0`, `npm run web:build`, the affected
bundle freshness and real-process checks, any affected generated check, and `git diff --check`.
Retain command results and the candidate SHA in this owner. Full repository gates, broad parity,
and A37's final production/browser correlation belong to 3.1.19; this focused release must not
claim them. Phase 3.1 requires no independent review for this task. A passing candidate is ready
for the operator's local integration decision, followed by the assigned integration checks and
owned worktree/branch cleanup if integration is authorized.

## Candidate evidence — 2026-09-23

The implementation candidate is `a1b9ae48853b389e0c9865126c7e79d4782929c0` on
`codex/3.1.15-production-runtime`, based on `7c524542aa3b4051b7847f264fb571fb43ebaa6d`.
It validates current source and emitted bundle bytes before authority/lock/socket effects, serves
the built app beside API routes, rejects inconsistent state/settings and duplicate ownership,
unwinds failed startup in reverse ownership order, and waits for dashboard-owned worker exits under
D271 before successful shutdown. Its focused controls cover live socket admission, HTTP bind
failure, both stop signals during an active transfer, stale process identity, and preserved worker
orphan evidence. The worktree is clean at this candidate.

- Root verification: `npm run test --` with the eight affected unit files passed **164/164**;
  `npx eslint` on the affected source/configuration/test files passed with zero warnings. Logs:
  `/Users/julianhein/Projects/hr-automation-rebuild-evidence/3.1.15-2026-09-23/root-final-focused.log`
  and `root-final-eslint.log` in the same directory.
- The affected parity bundle assertions passed **2/2** under a focused filter. The full
  `parity-reference-authority.test.ts` file passed 14 and failed 1 because its unchanged guard
  names absent `tests/parity/reference-detail.spec.ts`. The file was absent and the guard entry
  present at the approved base; the guard remains intact. Logs: `root-parity-bundle-focused.log`
  and `root-parity-architecture-full.log` in the evidence directory.
- `npm run web:build`, `npm run build:manifest:check`, `npm run roadmap:check`, and
  `git diff --check` passed. The build and manifest logs are
  `startup-final-web-build.log` and `startup-final-manifest-check.log` in the evidence directory.
- An isolated real `dashboard --prod` child served actual Vite HTML/JS and bootstrap readiness,
  refused a second live owner, drained with a released lock, recovered a stale server record by
  process birth identity, showed a preserved worker orphan as a warning, and refused missing or
  changed bundle bytes and an established root missing its database before taking a lock or socket.
  The sanitized log and runner are `manual-production-child-proof.log` and
  `manual-production-child-proof.mjs` in the evidence directory. No external HR write was made.

The candidate awaits the operator's local integration choice. Keep the task checklist and roadmap
node open until authorized integration and its focused integration checks complete. Full repository
gates, broad parity, and final production/browser correlation remain assigned to 3.1.19; this task
has no independent review gate.
