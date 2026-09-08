# Task 1-2 · Revalidate data, intake, and prior-run values

## Approval and current state

The operator requested `/phase-plan` for exactly **2.6.1-2**, followed immediately
by implementation in this same task, and on 2026-09-08 approved explicit
descriptor source-to-input mappings and resolving shared-reader ownership.
This overrides the routine prompt/fresh-session handoff, not the safety, review,
isolation or gate requirements. No push or sibling implementation is authorized.

**Planning; WAITING ON the shared-reader prerequisite.** Foundation close is
integrated at `2dd3048f8d5d223f3eb1347353c83c3d07297cfe`. The independently reviewed
shared-reader prerequisite owned by the 1-1 session must publish its integration
SHA before this assignment creates its implementation worktree. Record that
resolved common base here before the first product edit. No implementation or
acceptance has yet been completed.

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
| F8 · integration/consumer | New data route and inferred factory extension isolate shared root ownership. Phase 3.1.11-2 consumes this response later. | Exercise the actual Hono data registration with real canonical backing, request/version validation and typed refusals. Existing Context Data/Attempts payloads and intake read behavior remain compatible. Full offline gates cover registered workflow/descriptor changes. Preserve source version and exact field coordinates across HTTP → supplied planner request. |

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
| Presentation | New endpoint/factory only; no modal/UI changes or parity refreeze. Existing Context Data/Attempts rendered behavior must remain compatible. If reader changes affect that payload, run affected Context parity and the required full lane before the final implementation commit under dashboard rules; a discovered visual change reopens this exclusion. |

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
3.1.11-2. Planning quality is conditional on the explicit shared prerequisite;
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
> write proof, and a byte-identical source run. Task 3.1.11-2 owns all modal state and submission.
