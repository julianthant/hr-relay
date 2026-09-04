# Phase governance decisions — operator context

This topic record preserves phase-transition answers. Normative exit and admission rules are in the
phase docs and the canonical decision ledger.

## D277–D279 — Phase 3a close

On 2026-08-27 the operator chose to merge the reviewed integration line into `master` with
`--no-ff`, retain per-file jsdom for wiring-level React tests, keep dashboard-specific Codex
instructions, give a live capture session the Intake column, and schedule the next live T1b work.
The durable decisions were:

- D277: jsdom is the per-file environment for wiring-level React tests; visual behavior remains in
  the parity lane.
- D278: a live capture session takes the Intake column. D294 later retired mobile Capture Mode and
  therefore superseded this implementation obligation.
- D279: Phase 3a closed 10/10, with structural fidelity residue carried to the later dashboard work
  by explicit disposition.

Normative owners: ref guards-and-tests, ref dashboard-surfaces, doc 03.1, and the then-current
dashboard deferral track.

## D320 — Phase 3 close

On 2026-09-03 the operator chose A/A:

- Separations must produce a fresh `met` T1b result on a newly vetted closed Kuali document before
  3c-A closes; the existing blocked result remains honest evidence but is not acceptance.
- Once every 3c-A exit condition is green, 3c-B is authorized to start and close Phase 3 without a
  second start approval.

D325 later supersedes only that close endpoint: the authorization still opens 3C acceptance, but
3C now closes its own part and unlocks 3D; 3D closes Phase 3.

The operator subsequently selected the replacement in ignored local configuration. The first live
dry-run verified the Kuali document and UCPath reads but failed at the New Kronos employee search,
with exact-run write authority still 0/0/0. The target is available; the required fresh `met`
result remains open. No gate was waived, no external write was authorized, and no third workflow
was admitted.

Historical owner: `docs/rebuild/history/superseded/2026-09-04-03c-authoring-after-separations.md`.
D329 supersedes this start/close shape and moves current authority to docs 03.2/03.3.

## D323 — One visible phase hierarchy

On 2026-09-03 the operator replaced the just-in-time phase numbering introduced by D319 with one
stable roadmap hierarchy:

- numbered phases are the only nodes on the vertical roadmap spine;
- every phase contains lettered parts arranged horizontally, and each part's concrete tasks run
  vertically beneath it;
- Phase 3 contains 3A Shared dashboard, 3B Separations, 3C Workflow authoring and acceptance, and
  3D Codex and Claude cooperation;
- Phase 4 is the remaining workflow-migration program: the next approved workflow is 4A, followed
  by 4B, 4C and onward as each admission packet is verified and approved;
- Phase 5 owns cutover readiness and the single authority switch; Phase 6 owns the desktop app;
- working-session history remains in each node's `log:` drawer and never appears on the phase spine.

D323 supersedes only D319's phase-number allocation. D319's safety boundary remains: an individual
workflow receives no implementation scope until its current behavior and proposed definition are
verified and approved.

Normative owners: roadmap §Governance, ref workflow-model §1.6.2, and the active phase docs 03.1–06.

## D325 — Phase 3 execution order and task ownership

On 2026-09-03 the operator made D323's visual hierarchy executable:

- Phase 3 runs in the strict order 3A, 3B, 3C, 3D. Closing and reconciling one part unlocks the
  next; already-landed work in a later part does not waive that boundary.
- One coordinator owns one lettered part. Every immediate numbered task beneath that part is one
  supervisor session with a coherent outcome and explicit exit evidence.
- Plain numbers are sequential. Same-number lettered tasks such as `2A`, `2B`, and `2C` are one
  parallel wave. They appear at the same task depth and may launch together only when their scopes,
  artifacts, authorities and external resources are independent.
- Every parallel task receives its own exact feature branch and absolute worktree in the coordinator
  ledger before dispatch. The roadmap identifies the wave; the coordinator ledger owns the
  machine-specific paths, task ids, integration order and cleanup evidence.
- Operator decisions and live-write authorizations are prerequisites on the supervisor task they
  unblock. They are not implementation tasks assigned to a supervisor.
- Phase 3 closes after 3D's attributed cooperation proof. D320 still authorizes 3C acceptance after
  its stated gates are green, but 3C now closes only its own part and unlocks 3D.

Normative owners: roadmap §Governance and docs 03.1–03.4. The existing parallel-work lifecycle owns
dispatch-time branch, worktree, integration and cleanup records.

## D326 — One decimal execution hierarchy across Phases 0–3

On 2026-09-03 the operator corrected the remaining split grammar: if Phase 1 uses 1.1-style parts,
Phase 3 must use 3.1-style parts rather than A/B/C/D. The same hierarchy now governs every
foundational phase:

- Phase 0 uses 0.1–0.3, Phase 1 uses 1.1–1.6, Phase 2 uses 2.1–2.6, and Phase 3 uses 3.1–3.4;
- each decimal part has one coordinator, each immediate numbered task has one supervisor, and each
  task's checklist lines are its proof-bearing subtasks;
- parallel execution is recorded in the coordinator run plan with exact independent scopes,
  worktrees/branches and integration order, not encoded through letter-suffixed task labels;
- historical labels remain in dated logs/evidence only and stable roadmap ids do not change;
- historical evidence stays valid for 0.1–0.2, 1.1–1.5 and 2.1–2.5;
- the strict active order is 0.3 → 1.6 → 2.6 → reopened 3.1 → 3.2 → 3.3 → 3.4.

D326 supersedes D323/D325's lettered naming and parallel-wave labels, not their one-plan,
coordinator ownership, isolation, integration, or close-before-next-part rules.

Normative owners: roadmap §Governance, docs 00–03.4, and the canonical decision ledger D326.

## D328 — Numeric wave members identify parallel supervisor tasks

On 2026-09-04 the operator chose a visible task grammar that makes parallel execution legible in
the roadmap and in every worktree binding. A serial supervisor task keeps the ordinary `N` label.
When two or more independent supervisor tasks are admitted as one parallel wave, they share that
ordinal and receive consecutive numeric members: `N-1`, `N-2`, ... . Thus `3.1.9-1` and
`3.1.9-2` are peer supervisor tasks in Phase 3.1 wave 9, not a task and its checklist subtask.

- the hyphenated source label is one task identity at the same hierarchy depth as a serial task;
- the shared `N` identifies the wave and the `-M` member identifies one independently supervised
  branch/worktree row;
- a parallel group has at least two members, starts at `-1`, and is consecutive and contiguous;
- serial ordinals and parallel-wave ordinals advance together without gaps;
- the coordinator ledger still owns exact scope, base SHA, branch, absolute worktree, gate,
  integration order, cleanup, and task archival; the label records concurrency, not completion;
- historical labels remain in dated logs/evidence only, and stable roadmap ids do not change.

D328 supersedes only D326's prohibition on encoding parallelism in task labels. D326's decimal
phase/part hierarchy, one-coordinator-per-part rule, one-supervisor-per-task rule, and strict part
order remain binding. Letter-suffixed task-wave grammar remains retired.

Normative owners: roadmap §Governance, `docs/roadmap/notation.md`, admitted phase plans and the
canonical decision ledger D328.

## D329 — Authoring freezes before controlled acceptance

On 2026-09-04 the operator corrected Phase 3's chronology and retired its last active legacy labels:

- Phase 3.2 owns every remaining code-changing seam, current-source revalidation of landed work,
  Person Lookup `live-read`, Separations dry-run acceptance, and an independent exact-candidate freeze.
- Historical completion is carried through an exact old-to-new task crosswalk, but starts as
  `current verification pending`; only current-source proof may close a new task.
- A revalidation supervisor may repair a defect wholly inside its assigned seam. A cross-seam defect
  creates a newly numbered 3.2 remediation task. The final freeze task is audit-only; any failure
  invalidates the candidate and restarts the audit after remediation.
- Phase 3.3 performs no software development. Its four serial tasks are candidate/target admission
  plus final rehearsal, an independent pending-sweep proof, the coupled UCPath filing plus Kuali
  finalization, and acceptance reconciliation/lifecycle close.
- One bounded operational authorization names the exact candidate commit and fingerprints, the
  disposable and real targets, the restoration/retention disposition, and the permitted sequence.
  It expires on source or load-bearing configuration drift, target drift, unexpected failure, or
  an UNKNOWN submission.
- Active Phase 3 filenames are `03.1-finish-the-dashboard.md`,
  `03.2-finish-workflow-authoring.md`, `03.3-accept-person-lookup-and-separations.md`, and
  `03.4-co-operate-with-claude.md`. The former 03b/03c plans remain verbatim under
  `docs/rebuild/history/superseded/`; old task numbers and 3c-A/3c-B are historical lookup keys only.

D329 supersedes D320 and D326 where they place Separations before final workflow authoring or let
the old 3c-A/3c-B structure control execution. It preserves D319's admission boundary, D326's
decimal hierarchy and strict part sequencing, D328's numeric parallel-wave grammar, D309 identity
authority, D310's independent deletion witness/filing-survival protocol, and the no-retry rule for
UNKNOWN writes.

Normative owners: roadmap §Governance, docs 03.2 and 03.3, ref workflow-model §1.6, ref write-safety
§3.2/§14, and the canonical decision ledger D329.
