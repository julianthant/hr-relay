# Task 1-2 · Revalidate data, intake, and prior-run values

## Approval and current state

The operator requested `/phase-plan` for exactly **2.6.1-2**, followed immediately
by implementation in this same task, and on 2026-09-08 approved explicit
descriptor source-to-input mappings and resolving shared-reader ownership.
This overrides the routine prompt/fresh-session handoff, not the safety, review,
isolation or gate requirements. No push or sibling implementation is authorized.

**Candidate complete; awaiting independent review.** The shared-reader prerequisite
candidate `249d96edf1cf0007e93f6313fc85d37a1dee4878` received complete P-R1 PASS and
was integrated at `826cae74414e84fcd8559bbb34a43f2d68e4678e`; this worktree was
created from resolved common base `64db38e017f585014173bae3c428e6c2a1f63099`.
The accepted D344 task-naming baseline and then Task 1-1 trust implementation were
consumed before final gates. Current candidate base is
`393d5da75e96ae431ac0fa9d73d07176d924a3d7`. Each fast-forward preserved the complete
local diff byte-identically. Branch `codex/rerun-values` remains at
`/Users/julianhein/Projects/hr-worktree-rerun-values` pending review and integration.

M/R/H implementation and final candidate gates pass. The read route serves only
explicit mappings, source-bound facts and protected-safe transaction coordinates;
Context Data/Attempts use canonical admission. Intake/OCR production rewiring was
unnecessary after dependency inspection and real cold-read proofs. Future modal
consumer is **3.1.11.2** (`dash-run-modal`); modal state/submission and repeat
consent remain their existing owners. Original acceptance stays unchecked until
independent PASS, required integration gates and owned cleanup.

**Planning validation (2026-09-08).** Scoped roadmap-binding suite passed
23 tests; `npm run lint` passed. New plan file/anchor links, existing instruction
twins and whitespace checks passed. Source/test/config/dependency files are
unchanged by this planning commit; implementation typecheck/coverage are unrun,
not claimed through inherited foundation evidence. Shared roadmap regeneration
and its freshness check belong to the serialized prerequisite plan commit.

The [part owner](README.md#task-1-2--revalidate-data-intake-and-prior-run-value-consumers)
and [Rerun contract](../../../reference/data-intake-and-edit-data.md#6-rerun-values-from-a-prior-run-charter-12)
own the outcome. D330/D331/D332 lifecycle/settings/evidence contracts remain
unchanged. The operator-approved mapping amendment is recorded under §6.6 of
the Rerun contract; it does not revive checkpoint editing or write authorization.

## Assignment and isolation

| Assignment | Branch and checkout | Prerequisite/base | Owner and merge condition |
| --- | --- | --- | --- |
| 2.6.1-2, one supervisor | Create `codex/rerun-values` at `/Users/julianhein/Projects/hr-worktree-rerun-values` | The exact reviewed shared-reader integration recorded by 1-1 in the part ledger, including verified 1.6 closure and this committed plan | This session implements, gates, freezes, integrates locally to `master` with `--no-ff` after independent PASS, then removes only its owned worktree/ref from the primary checkout. Any wave peer merge order is permitted after the common prerequisite; shared-target operations are serialized. |

Names were absent when proposed; recheck refs, paths, four-auxiliary-worktree
capacity and ownership before creation. Preserve the detached foundation review
checkout, parallel-policy worktree, sibling work and recovery notes. A prerequisite
or peer change is consumed only after its own acceptance, never via dirty copying.

Implementation stays with this supervisor; **zero supporting implementation
workers**. One fresh `sup_review` reviewer covers the complete candidate. All
Codex roles use GPT-6 Astra/high under the operator override. No coordinator or
new user-owned task is created by this assignment.

## File and contract ownership

The 1-1 session explicitly reserved these post-prerequisite seams to 1-2:

- `src/server/dashboard/queries/data.ts`: existing Context Data/Attempts reads
  plus the new source-value query.
- `src/server/dashboard/compose/data.ts`: data factory composition. Production
  supplies an explicit canonical backing bundle containing the database's read
  snapshot/evidence interface, canonical run reader and full descriptor resolver.
  Existing Context-only test compositions may omit that bundle; the new query
  then throws named `RERUN_VALUES_NOT_CONFIGURED`, never uses a raw fallback.
- `src/server/dashboard/routes/data.ts`: independently registered data routes,
  before the generic section route. Add GET
  `/api/v1/runs/:runId/rerun-values?expectedVersion=<positive integer>` here.
  Root API/composition depend on the inferred data-factory return type, so this
  assignment does not edit their shared registration.
- New `src/domain/dashboard/rerun-values.ts`,
  `src/domain/workflow/rerun-values.ts`, `src/services/start/rerun-values.ts`,
  and a narrowly scoped schema/mapping validator under `src/validation/`.
- Narrow declaration/admission changes in `src/base/workflow.ts` and explicit
  mappings in `src/workflows/separations/workflow.ts`. Add other production
  mappings only where the same inspected existing input schema admits the value;
  do not expand input forms or introduce another workflow.
- Task-owned tests under `tests/unit/`, existing source-bound/intake test files
  only for relevant proofs, and task-local synthetic fixtures. Avoid editing
  sibling-owned shared fixtures. Descriptor closure generation owns the changed
  `src/domain/workflow/generated-build-manifest.ts` and related actual generated
  outputs, serialized with peers.
- `config/pending-wire-bindings.json`: the new served-unconsumed route entry for
  3.1.11.2. `tests/unit/architecture/helpers/redaction-surface-audit.ts`: the new
  wire schema/surface, six origin entries and module disposition, with explicit
  Task 1-1 ownership clearance. Preserve Task 1-3's separate storage-doctor
  origin entries and capture-scan fixture ownership. No guard is added/retired.
- Existing `tests/parity/references/` triples only for the deliberate descriptor-identity
  correction proved below; Task 1-3 retains its new Cancelling triple.
- This task file, the approved §6.6 Rerun amendment in
  `docs/rebuild/reference/data-intake-and-edit-data.md`, and its pointer in
  `docs/rebuild/reference/decisions.md`. The 1-1 session owns shared README/roadmap
  allocation/binding updates; coordinate later completion updates and regeneration.

Exclude canonical store/service mutations, SQL migrations, A0–A3 retirement,
trust/capture readers, generic lifecycle/count/status/archive readers, current
private configuration, live HR transactions, modal state, new UI, and repeat
consent/execution changes. Existing Rerun planner validation is a consumer to
prove, not a second authorization implementation.

## Feasibility and proof bindings

| ID | Current mechanism and required change | Acceptance and negative control |
| --- | --- | --- |
| F1 · mapping admission | Old `capabilities.editData` allows only checkpoint-replayed task fields; Separations intentionally declares none. Existing omission forms already admit dates and transaction facts. Add a separate explicit mapping declaration naming source node/durable field path, label and existing input or omission target. | Descriptor construction rejects nonexistent source/target nodes/fields, forbidden gate/control sources, nonexistent omission steps, duplicate coordinates and protected targets. No field-name matching or inverse execution of omission producers. Target leaf validation preserves its ordinary constraints; final whole-input/omission validation stays with the planner. |
| F2 · canonical source | `RunRecordService.read` already distinguishes absent/live/archived/deleted. Existing `buildRerunPlan` rejects stale descriptor/version, ineligible lifecycle and uncertain writes. | One read snapshot checks canonical existence first, then expected version/descriptor/eligibility. Missing/deleted/archived/stale/malformed/parked/attempting sources refuse by a typed name. A valid source is the positive control. No fold or retained artifact resurrects a missing/deleted run. |
| F3 · exact completed values | Item checkpoint reads carry exact run/node/attempt/claim generation and schema/fingerprint/provenance. Never use latest-by-item as if it belonged to the selected run. | Filter source-run ownership, choose latest source execution deterministically, validate descriptor version/contract/output schema, then emit only explicitly mapped values. Partial sources offer completed-node candidates; missing optional union fields are named unavailable. Malformed evidence fails rather than borrowing another run. Exact source version/node/field and checkpoint execution/provenance travel with each offered value. |
| F4 · step facts | Canonical terminal outcome selects D335 defaults downstream. Checkpoints, gate records, source failure and task-event evidence describe node completion; omitted assertions are distinct. | Serve completed/failed/unfinished node and categorical step facts, with explicit evidence or missing-evidence reasons. A category is complete only when all relevant members have completion evidence. Later failed/unfinished work does not hide earlier completed values. An omitted/asserted node never becomes observed completion or transaction proof. No missing evidence is converted into completion, no source outcome is inferred from span folds. |
| F5 · transaction warning coordinates | Settled write intents and `repeatEvidenceDigest` already identify prior committed/observed-present evidence. Transaction checkpoints wrap schema-bound output/proof. | Serve source run/version, step/node/task, write-intent ID and protected-safe evidence identity. Authenticate nested output/proof against the exact transaction contract before reading a mapped transaction value. Typed transaction facts remain candidate assertions; response contains no authorization/acknowledgment/confirmation command. Parked/attempting evidence cannot become settled. |
| F6 · redaction and provenance | `retainedRunProtectedBindings` and value-free helpers preserve captured identities without current configuration reads. Existing `RerunSource.copiedFrom` checks equality against submitted values. | Withhold protected values, embedded retained protected content and disallowed target values; expose only safe unavailability reasons. No protected raw value or value-derived secret digest in JSON/errors. Validate copied-value round trip into the existing planner; changing a copied value without removing its old attribution refuses. Operator-entered values carry no invented source observation. Missing covering provenance is explicit, never a fabricated live date. |
| F7 · effects and historical artifacts | Intake reads immutable session/manifest/artifact sources; inspected OCR composition has no run/settings lifecycle dependency. Shared data reads move behind canonical admission in the prerequisite. | Real SQLite/artifact tests prove immutable intake source/hash/mapping diffs and fail-loud missing manifest/artifact links. New Rerun reads preserve source row/checkpoint/gate/write/evidence bytes, database generation, plan count, IDs/publications and artifact bytes. Query success and every refusal are read-only. Use regenerated synthetic fixtures, never removed operator databases/backups. |
| F8 · integration/consumer | New data route and inferred factory extension isolate shared root ownership. Phase 3.1.11.2 consumes this response later. | Exercise the actual Hono data registration with real canonical backing, request/version validation and typed refusals. Existing Context Data/Attempts payloads and intake read behavior remain compatible. Full offline gates cover registered workflow/descriptor changes. Preserve source version and exact field coordinates across HTTP → supplied planner request. |

Order-sensitive cases include deleted+retained evidence (deleted wins), stale
version+valid value (stale refuses), eligible source+malformed checkpoint (source
evidence refuses), omitted assertion+old settled transaction (no fabricated current
completion), and protected source+valid target schema (withheld despite type fit).
No operation in this task requires an actual operator-root migration/deployment
preflight or a live HR write. Fresh/migrated synthetic fixtures are the accepted
historical test substrate from Task 1.6.7.

## Ordered execution

1. **P · planning and prerequisite.** Validate/commit the complete plan and mapping
   amendment. Verify committed content and published prerequisite integration,
   resolve the common base, create/recheck the bound worktree and consume its
   canonical data factory. Remove the exact consumed recovery note only after
   its unique state is represented here. Keep implementation blocked until then.
2. **M · mapping contract.** Implement the separate strict declaration/compiler
   admission and schema resolver. Declare the inspected Separations date and
   UCPath transaction-number/status source mappings. Prove F1 and source/target
   shape cases before expanding the reader. Do not alter ordinary input schemas.
3. **R · read model.** Implement the snapshot-bound source query, completion facts,
   candidate provenance/protection and transaction coordinates. Prove F2–F7 with
   positive and negative real-authority cases. Preserve backend Rerun authorization.
4. **H · HTTP and regression.** Add the owned data route/factory binding, exercise
   F8 and inspect existing intake/OCR/manifest/mapping dependencies. Make only
   demonstrated necessary rewires, and record no-change findings. Generate
   descriptor outputs and verify existing Context payload compatibility.
5. **C · candidate.** Run required gates, group implementation into logical
   commits, record exact base/head/tested tree and awaiting independent review.
   Keep task completion unchecked.
6. **V · independent review.** One fresh complete read-only `sup_review` assignment
   covers F1–F8, all production/HTTP/descriptor/privacy boundaries, tests and
   exclusions against pinned plan/base/implementation/evidence SHAs. Fix required
   findings, rerun affected gates and obtain exact-candidate PASS. No self-review.
7. **I · integrate and close.** Serialize `--no-ff` local integration onto master,
   retain accepted peer work, run integration gates, re-review behavioral conflicts,
   record the delivery assessment and 3.1 consumer handoff, update only this task's
   status through the shared-document owner, regenerate/check roadmap, and remove
   only the verified integrated task worktree/ref. Stop; do not dispatch siblings.

## Gate schedule

Run commands in the verified checkout and retain complete logs outside tracked
source. Every test invocation uses the npm runner. If tests run, run lint too.

| Boundary | Exact command family and scheduling |
| --- | --- |
| Plan/record-only | `npm run test:architecture -- tests/unit/architecture/roadmap-doc-binding.test.ts`; `npm run lint`; applicable local Markdown links/instruction-twin/chain checks; `git diff --check`; serialized `npm run roadmap` then `npm run roadmap:check` through shared owner if generator inputs change. No claim that docs prove implementation. |
| Focused M/R/H | `npm test -- --project unit tests/unit/rerun-values.test.ts tests/unit/rerun-value-mappings.test.ts tests/unit/server/rerun-values.test.ts`; add `tests/unit/rerun-source-eligibility.test.ts`, `tests/unit/source-bound-repeat.test.ts`, `tests/unit/rerun-protected-identity.test.ts`, `tests/unit/intake-session.test.ts`, `tests/unit/intake-command-arms.test.ts`, `tests/unit/server/intake-surface.test.ts`, `tests/unit/intake-mapping.test.ts`, `tests/unit/ocr-command.test.ts`, `tests/unit/ocr-extraction-admission.test.ts` as their boundaries become stable. Exact new filenames may be split without changing proof ownership or membership. Run lint after meaningful test cycles. |
| Candidate and changed integration | `npm run typecheck` and `npm run lint` may overlap within available host resources; then `npm run test:coverage` without this task's compiler/linter contention. Coverage already includes all three projects; do not append a duplicate unchanged full architecture run. Use at most four effective file workers; prefer the reproducible two-worker adapter below when sharing host resources. |
| Generated | `npm run build:manifest` before `npm run build:manifest:check`; `npm run stores:catalog:check`; `npm run roadmap:check` after shared-owner generation. Serialize mutable generated artifacts with peers. |
| Presentation | New endpoint/factory only; no modal/UI changes. The deliberate descriptor-identity reference correction below is the only admitted reference delta. Existing Context Data/Attempts rendered behavior must remain compatible. If reader changes affect that payload, run affected Context parity and the required full lane before the final implementation commit under dashboard rules; a discovered visual change reopens this exclusion. |

The optional resource-only adapter imports this checkout's actual
`vitest.config.ts`, changes only root and each project `maxWorkers` to 2, and
asserts deep equality after removing only those worker fields. Recreate it using
the exact body in [Task 1.6.7 gate recipe](../../phase-1/1.6-implement-canonical-run-and-settings-authorities/task-7-close-the-rebuilt-foundation.md#gate-schedule-and-review-coverage),
substituting the current absolute checkout. Run
`npm run test:coverage -- --config <adapter>` only if npm forwarding reaches the
runner correctly; otherwise use the proven equivalent
`npm test -- --coverage --config <adapter>` followed by
`node --import tsx scripts/suite-size.ts`. Record adapter/import hashes, resolved
worker counts and exits. Membership, assertions, isolation, timeouts and floors
remain unchanged. Rebind the adapter for integration rather than importing the
implementation checkout's config.

D191 permits code-gate reuse for recording-only commits only after inspected
diffs establish unchanged relevant source/test/config/dependency inputs, with
original tested SHA/command/results and current SHA recorded. Missing evidence,
changed inputs, failed checks or material integration requires the relevant run.
No live-state evidence is claimed as current verification.

## Stop conditions and handoff

Stop dependent implementation for an unaccepted/missing shared prerequisite,
ownership collision, material new contract/input/write-authority change or a
failure that cannot be resolved inside this scope. Routine schema, route and
test implementation choices remain autonomous. Do not re-ask the approved
mapping/ownership decisions. Preserve failures and UNKNOWN-submit refusals.

At closure, record the served response/route and mapping declarations, fixtures,
exact review/gate/integration evidence, exclusions and residual defects for
3.1.11.2. Planning quality is conditional on the explicit shared prerequisite;
the known old-policy/source-target gap is resolved by the operator-approved
mapping amendment, not transferred as an undisclosed implementation discovery.

## Original task acceptance

### Task 1-2 · Revalidate data, intake, and prior-run value consumers
<!-- roadmap: p2f-data -->

- [ ] Rewire only actual run/settings dependencies across intake, OCR, manifests, mappings, and the
  D334 Rerun prefill source.
- [ ] Serve every descriptor-allowed completed-step value with exact source run/version, step/node,
  field path and provenance; preserve artifact readability and fail loud on missing canonical linkage.
  Also serve read-only completed/failed/unfinished step classification and completed-transaction evidence
  coordinates for D335 defaults/warnings. Never infer completion from an omitted-step assertion or grant
  repeat consent in this projection; 1.6.4 owns the already-built backend authorization boundary.
- [ ] Keep the projection read-only: it offers prefill candidates and never writes a lifecycle row,
  checkpoint, start plan or modal value. Redact/withhold any value the ordinary operator-suppliable
  schema does not admit.
- [ ] Treat diagnostic capture projection as Task 1-1's seam and generic lifecycle/operator reads as
  Task 1-3's seam; consume their stable contracts without editing them.

> 2026-09-04 | phase-0-3-authority-design C31da5310 R04 | consumes §D330.9 — intake, OCR, manifest, mapping
> and Edit Data rows are evidence linked by `runId` and decide no lifecycle fact — together with
> `ref clock-config-secrets` §D331.8 (a leaf has exactly one source, so no intake or Edit Data path
> writes settings or a lifecycle row) and §D332.7 item 4 (the upgrade leaves evidence and its
> immutability rules untouched, so existing artifacts stay readable across it). No redesign.
>
> 2026-09-05 | D334 operator correction | the old `run.edit-checkpoint` consumer is retired by 1.6.4.
> This task owns only the replacement READ: completed-step values and their exact provenance for the
> source-bound Rerun modal. Prove partial/missing/malformed/deleted/archived sources, copied
> versus operator-entered provenance, transaction outputs represented as assertions rather than new
> write proof, and a byte-identical source run. Task 3.1.11.2 owns all modal state and submission.



## Candidate evidence — 2026-09-08

Final implementation commit: **75e3fb655b438bcf2c97f2d1d9df3582ccdf7f15**. Final implementation tree:
`5bae9569bb327788afc373644ffdcb8e7bea597e`. The 480 implementation paths are
17 source/config/test paths plus 463 deliberately regenerated reference artifacts.
The subsequent evidence commit changes only this owner and the existing Rerun
contract's future-consumer spelling (3.1.11.2); it is the frozen review checkout
head, distinct from the implementation head. Relevant source/test/config/dependency
inputs remain identical; D191 reuse is explicit below. No push, live HR run or
production write occurred.

| Gate | Exact command and verified result |
| --- | --- |
| Typecheck / lint | `npm run typecheck`; `npm run lint`: exit 0 on accepted trust integration `5a07b329` plus this implementation. The consumed `393d5da7` completion changes only T's owner/roadmap/HTML; compiler/linter inputs are identical. Logs `/tmp/hr-rerun-typecheck-combined.log`, `/tmp/hr-rerun-lint-combined.log`, durable `.exit` files. |
| Full coverage | `npm test -- --coverage --config /tmp/hr-rerun-two-workers.config.mts`: exit 0, **446 files / 5,613 tests**, 328.45 seconds. Statements 85.91%, branches 77.66%, functions 89.88%, lines 88.12%; all configured floors pass. Log `/tmp/hr-rerun-coverage-combined.log`; `.exit` = 0. |
| Suite size | `node --import tsx scripts/suite-size.ts`: exit 0; 349 unit / 17 scenario / 80 architecture files. `/tmp/hr-rerun-suite-size-combined.log`. Coverage already includes architecture; no duplicate unchanged full architecture run. |
| Desktop parity | `npm run test:parity -- --workers=4`: **261/261, exit 0, 69.096 seconds**. `/tmp/hr-rerun-parity-combined.log`; durable `.exit`. Fresh bundle built by the wrapper; no concurrent owned build/compiler. |
| Generated outputs | `npm run build:manifest:check`, `npm run stores:catalog:check`, `npm run roadmap:check`: exit 0. Logs `/tmp/hr-rerun-{manifest,catalog,roadmap}-combined.log`. |
| Documentation / whitespace | Existing instruction twins/32,768-byte chains, owning-plan local links and complete base-to-candidate whitespace checks pass. Recording-only edits use affected roadmap binding checks and unchanged-input reuse. |

The resource-only adapter imports this checkout's actual `vitest.config.ts`,
changes only root and project `maxWorkers` to 2, and asserts deep equality after
removing those worker fields. Adapter SHA256
`c603453d99b8b5cf29b15131eb20aff96b3ecfb3383d2e4666f8e39035dcad8e`;
imported config SHA256
`1f9122bf9bbcf1fcab9e01b5aec3428bcde7f9b10b47f0f91aab41775bdbf68f`.
Membership, assertions, isolation, timeouts and coverage floors are unchanged.
Compiler/linter, full coverage and parity ran in separate coordinated windows.

### F1–F8 proof and consumer handoff

| Proof | Deciding implementation and real-authority evidence |
| --- | --- |
| F1 | `rerun-value-mappings.test.ts` proves strict endpoint/duplicate/protected mapping admission, nested target constraints and durable transaction wrapper paths. Registered Separations has four existing omission-field mappings and no revived editData capability. |
| F2–F4 | `rerun-values.test.ts` executes real successful/failed sources; checks canonical absent/stale/archive/delete/active refusal, exact source checkpoint identity/schema, earlier same-run attempts and deterministic latest attempt/claim generation, partial/failed/unfinished/omitted facts, missing optional fields/provenance and malformed JSON refusal. Explicit synthetic retained-history adapters cover corrupt/partial data without reading operator state. |
| F5–F6 | Real committed/observed-present transactions produce authenticated warning coordinates; nested schema/proof-link corruption refuses. Protected values and embedded retained copies are withheld. HTTP → planner copied attribution round-trips; edited value with stale attribution refuses, operator values remain distinct. A copied transaction output still reaches existing `confirmation-required`; no consent is granted by this read. |
| F7 | Before/after authority generation, rows, checkpoints, gates, intents, IDs and publications are identical across reads/refusals. Cold intake rereads preserve exact bytes, manifest and generation; missing exact manifest/artifact links fail without latest/cached replacements. Existing intake/OCR/mapping suites remain green. |
| F8 | Real Hono registration uses GET `/api/v1/runs/:runId/rerun-values?expectedVersion=<positive integer>`, no-store/nosniff, strict request validation and typed 200/400/404/409/410 responses. Explicit canonical composition is required. Context Data serves spanless canonical runs; Attempts retains canonical attempt/enqueue date and names absent requeue evidence. Full combined parity verifies existing rendering. |

`config/pending-wire-bindings.json` records the served-unconsumed route for
3.1.11.2. The redaction inventory registers the new wire/schema and six text
origins, preserving Task 1-3's separately owned storage-doctor origin additions.
No guard was added or retired; guard semantics and existing inventory entries
remain intact. Shared raw lifecycle ports, trust/capture and generic operator
readers retain their respective owners.

### Deliberate descriptor-provenance reference update

The approved compiler import closure changed registered descriptor fingerprints.
The first full parity assertion stopped at 190 hash mismatches (71 cases passed);
150 named only the a11y header and 40 also named a visible hash. This reopened
F8's unchanged-reference assumption, not the product's visual requirements.
Multiple captures per test explain why the complete updated corpus has 210 pairs.
The only text substitutions are:

- Descriptor-set hash `ae3c887ef96cc50bcc65f0f2a3d2456d4c70cf06ab1ee1a031f6d1ab7a548ed7`
  → `3e459f4b09a28d4992efe712a98310053030f263ac11d9c0610234142f2c8df9`, including its short display.
- Separations set hash `4651f4c1376e0e39446cae9b906368b8943449ffa8ca2b0dd85eb6863d4676f7`
  → `1f482b40a14c7dd3a92a355b547468b83dc723f4d3bbb5202b172f7dcd87457a`.
- In two populated receipt trees, registered person-lookup contract stamp
  `7e93b9b3` → `19c6e68e`; full hashes are verified in the generated manifest.

`npm run test:parity:update -- --workers=4` passed 261/261, exit 0, 65.467 seconds.
All **420 text files** match those substitutions exactly. **43 PNGs** change only
displayed descriptor labels, including five labels behind inert dialogs; two
receipt labels are outside their captured viewport. The other **179 reference
files are byte-identical**. The installed Playwright comparator with the unchanged
`threshold: 0.2, maxDiffPixels: 0` confines every counted changed pixel to seven
inspected label rectangles (largest 49 × 9 pixels). Raw subthreshold/antialias
variation outside those rectangles is within the lane's existing tolerance.
The 1280px dark run, 1024px light failed run and 1440px light archive dialog were
visually inspected. No UI code, layout, interaction, comparator or acceptance
assertion changed. Task 1-3 confirmed ownership of existing-reference reconciliation
and retains its separate new Cancelling triple.

Read-only delta evidence: `/tmp/hr-rerun-reference-delta.json`,
`/tmp/hr-rerun-counted-pixel-delta.json`, `/tmp/hr-rerun-parity-before.json`.
The original error report is preserved at `/tmp/hr-rerun-parity-final2-results.json`;
update/assert logs are `/tmp/hr-rerun-parity-update.log` and
`/tmp/hr-rerun-parity-final3.log` (261/261, exit 0, 61.520 seconds before accepted
trust consumption). Final combined parity above is the acceptance result.

### Iteration history and delivery assessment (provisional)

The operator approved explicit mapping/source-target admission after planning
identified the old checkpoint-edit policy gap. The shared canonical-reader
prerequisite was accepted before implementation. Both are recorded scope/proof
bindings, not undisclosed implementation discovery.

Early synthetic fixtures needed correct lifecycle seeding, US-format omission
dates, branded attempts and actual confirmation-state assertions. The first full
coverage run failed 45 tests in three files: missing new-route wire inventory,
missing redaction disposition, and an inherited roadmap naming mismatch.
The first two were implementation inventory omissions. The independently accepted
D344 baseline fixed the third; no baseline waiver was used. Focused repairs passed
112 tests and then 34 reader/HTTP tests; full own coverage subsequently passed
444 files / 5,596 tests before accepted trust consumption.

Read implementation corrections included keeping descriptor runtime imports out
of the archive query closure, accepting spanless canonical Context, and retaining
valid earlier same-run attempt evidence while refusing future coordinates. These
were required by the plan and verified before candidate submission. The parity
provenance inventory was a planning omission: compiler-closure discovery should
have traced fixture descriptor identity and displayed receipt stamps before
claiming unchanged references. Reference repair preserved the actual UI contract.

All implementation stayed with this supervisor (zero implementation workers).
One fresh complete independent review is required; none is claimed here yet.
Final review/repair counts and integration/cleanup evidence will be recorded at
closure. Elapsed work versus queue time is not fully measured; no savings or
blanket planning-quality score is claimed.

### Integration and close conditions

T accepted candidate `98305e1bccf3f4c1db80735496060bbcbfc68855` after complete
T-R1 PASS, integrated at `5a07b329ec8a935535ee34935fc05717bbc4f0c1`, and closed at
this candidate's base `393d5da75e96ae431ac0fa9d73d07176d924a3d7`. Its final
record verifies 2,176 unchanged candidate inputs and owned cleanup. T explicitly
transferred shared-document ownership for only p2f-data's status/binding and
serialized roadmap generation after this task's independent PASS/integration.
Coordinate primary mutations with remaining Task 1-3; preserve every peer row.

No 1-2 integration or cleanup is complete yet. Freeze the implementation/evidence
identities, obtain one complete fresh read-only `sup_review` verdict, resolve any
findings with renewed gates/review, then perform the authorized local `--no-ff`
merge and required integration checks. Remove only this worktree/ref from the
primary checkout after verified integration. Never push or dispatch siblings.


### Evidence recording checks

Fresh roadmap binding passed 23/23 tests (exit 0), owning-plan links/anchors
passed 3/3, all nine instruction pairs/chains passed, and working/staged plus
complete implementation-range whitespace passed. The final ownership wording
clarifies the already recorded fingerprint-only reference delta; it changes no
approved behavior or checkbox/binding. Full typecheck/lint/coverage/parity and
freshness results above are reused for unchanged inputs under D191.

`/tmp/hr-rerun-inputs-candidate.json` binds 2,185 tracked input files,
excluding only this evidence owner; SHA256 `d817ad15a9a2102efb71f62a69a3ed28398bf12413a1792656bc1427aa9209f9`.
The evidence commit's contract delta only updates the future consumer's decimal
task name; that exact text was present during the combined gates. The frozen
checkout's input hashes must match this manifest before review and integration.
