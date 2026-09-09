# Diagnostic evidence and failure resolution

**Current execution authority:** the operator approved [D01–D05](#approved-execution-brief--2026-09-09)
after verification of repaired F on 2026-09-09. That brief supersedes this file's earlier waiting,
no-master-merge, retained-branch and frozen-path wording for D only. It includes three explicit
ownership amendments, focused checks, local master merge and owned cleanup. Full gates and fresh
independent review remain at 2.6.9. D01–D05 are complete as a focused development release; see the execution record below.

**Phase 2.6-only execution rule:** 2.6.9 is the single Finalization task and the last task of
the phase. No intermediate or nested finalizers. Earlier implementation tasks use focused tests,
lint and affected freshness; 2.6.9 owns full gates, independent review, remaining repairs, master
integration when assigned, handover and cleanup. Other phases retain their existing rules.

**Rename ownership amendment (2026-09-09).** [2.6.2 R](renames.md) now owns the seven
approved naming-only changes, including diagnostic/receipt/snapshot/dryrun names. Consume R's
committed names and evidence; do not repeat its migrations. Earlier rename allocations below are
historical product scope, superseded only for execution ownership. This owner retains all later
retirement, behavior and integration proof.

> **Combined-plan amendment — 2026-09-09.** This file retains the approved product scope,
> acceptance proofs and historical inspection below. [The combined workflow](README.md) and
> [prerequisite releases](prerequisites.md) now exclusively own assignment IDs, dependencies,
> write-set allocation, candidate release, gates, review timing, integration and launch status.
> Earlier A/B/T1/T2/P/D/G execution allocations, per-unit full gates/reviews, master prerequisites
> and provider-owned integration below are superseded for this unlaunched batch. They are not
> alternate launch instructions. Every product proof remains required; heavy proof and independent
> review run in the final session. Existing in-flight timeline T1 keeps its own schedule.

## Archive-report amendment — 2026-09-08

This plan retains ownership of diagnostic capture and live failure-resolution commands. The
approved archive is now a saved report whose source run/failure rows leave live storage. Its
resolution status, actor/time, note and diagnostic content are captured at archive time. Archived
reports have no Mark resolved/Reopen controls and no read-through to live failure annotations.
Reject stale actions targeting a moved failure without recreating it. This supersedes all earlier
requirements below for editable/current resolution on archived retained runs. The archive owner
implements report conversion/viewing; this plan supplies diagnostic values and file ownership.
P3/P5 must prove snapshot-time resolution, read-only archived presentation, refusal of stale actions,
and readability after live failure deletion, without weakening live annotation/UNKNOWN protections.

Coordinate failure/annotation fields used by the approved [shared run summaries](decisions.md#approved-group-5-dryrun-results-and-shared-run-summaries)
through one prerequisite update seam. D retains ownership of live annotation semantics; the summary
owner supplies derivation/query behavior. Prove relevant changes cannot leave served summary fields
stale, and do not add a second diagnostic summary table or broaden the source run's mutation rules.

Archive design owner: [independent archive reports](decisions.md#approved-group-3-independent-archive-reports-and-no-relaunch).
This is a planning amendment. Preserve existing in-flight gate schedules, candidate evidence and
accepted work; it does not launch implementation or reschedule reviews. New launch readiness awaits
the complete revised allocation and verified prompts.

## Assignment and approval

**Current assignment: 2.6.6.2 D.** This file owns its product requirements within the
[combined workflow](README.md). Implementation waits for C0 and the verified F development
release. Earlier side-work IDs are historical aliases only.

On 2026-09-08 the operator approved `diagnostic_snapshots`, `diagnostic_files` and `run_receipts`.
They subsequently rejected keeping database lessons and detailed fix records, preferring workflow
and agent documentation for useful guidance and a simple indication that a failure's problem was
addressed. After that design was explained, they said **“plan it”**, then **“add it to the diagnostic
plan you made earlier since its kinda the same scope.”** The earlier names existed only in chat;
repository inspection found no saved diagnostic plan. This file consolidates both approved parts
at one owner. The combined scope supersedes the earlier three-changes-per-plan preference for this
assignment. It does not implement or alter any running predecessor.

Outcomes:

1. Rename `diagnostic_bundles` → `diagnostic_snapshots`, `diagnostic_attachments` → `diagnostic_files`,
   and `evidence_receipts` → `run_receipts`, preserving evidence and existing behavior.
2. Remove `knowledge_records` and `fix_records`, their unused service/projection machinery and
   obsolete database-authority requirements. Do not first rename them to diagnostic lessons/fixes.
3. Add lightweight, explicit operator resolution to `run_failures`: status, actor/time and optional
   short note, with a usable dashboard action and honest history. No separate issue/fix table.

Use [prerequisites](prerequisites.md) for the exact release and evidence allocation. Each peer
records progress only in its assigned owner/evidence file; shared plan edits belong to the
prerequisite or final owner. No shared implementation.md or peer-plan edits.

## Authorities, prerequisites and scope

- [Root instructions](../../../../../../AGENTS.md), [document routing](../../../../../README.md),
  [roadmap governance](../../../../../roadmap/roadmap.md), and
  [operating reference](../../../../../../.agents/skill-library/repository-work/REFERENCE.md).
- [Operator trust: diagnostic evidence and resolution](../../../../reference/operator-trust.md#diagnostic-evidence-and-resolution)
  owns the pending amendment to diagnostic/receipt naming and §4's knowledge/fix authority.
- [Dashboard surfaces: failure resolution](../../../../reference/dashboard-surfaces.md#failure-resolution)
  owns operator actions, immutable failure/completion/receipt boundaries and archive presentation.
- The [combined execution plan](README.md) owns the shared prerequisite B, following run completion and
  timeline T2. B provides `run_failures`, immutable completion, diagnostic renames and strict annotation
  storage. Provider accounting and generated-file behavior are independent peers, not prerequisites.
- [Clock/config/secrets](../../../../reference/clock-config-secrets.md), D321/D322/D332,
  [guards and tests](../../../../reference/guards-and-tests.md), §3.14 D191, and
  [frontend/backend integration](../../../../reference/frontend-backend-integration.md) own
  upgrade/backup, evidence protection, gates, command transport and parity.

B owns diagnostic/failure/receipt schemas, migrations/FKs/integrity/recovery/deletion registration,
knowledge/fix retirement and protected backup, existing capture/readback adaptations, and low-level
independently versioned annotation storage. D owns resolution command admission/dispatch, the command
transaction and audits/events, current annotation read model, failure-detail/archive controls, exclusive
tests and this plan/evidence. The [combined execution plan](README.md) binds exact paths, resource slots and release proof.
D alone owns the enumerated command/UI files; provider and generated-artifact peers cannot edit them.
D cannot reopen shared migration/composition/domain-ID files. Read nearest server/dashboard/control
instructions and linked lessons before edits.

Keep `run_failures`, `run_results`, `workflow_runs`, artifact storage and timeline authority. No
snapshot/file-table merge, attachment deduplication redesign, new global issue tracker, commit/file-list
fix ledger, automatic agent learning, automatic fixes, notification system or new outbox. No change
to run outcomes, current ownership, retry admission, UNKNOWN-submit recovery, receipt confidence,
diagnostic sensitivity, artifact sharing or retention periods. No automatic resolution based on a
commit, a successful retry or a matching failure fingerprint. No new workflow knowledge prose is
authored or auto-imported here; future requested guidance belongs in its existing linked documentation.
No live HR write, provider wiring, operator-database application, push, cutover or task dispatch.

## Inspected mechanisms and target

Planning inspected `f7e69f149f1df65a9e9b0a2851c2ee375d4c140b` on master. This is evidence, not the
future implementation base. No implementation checkout or agents are created during planning.

| Evidence | Required treatment |
| --- | --- |
| `src/domain/trust/diagnostic.ts` stores capture origin, run/failure links, immutable digest, redaction, attachment metadata and retention. Capture may be operator-requested without failure. | Preserve multiple snapshots per failure/run and zero-file snapshots. Resolution belongs to the failure, not each snapshot or artifact. |
| `services/trust/diagnostic-capture.ts` writes bytes to artifact storage; `authority-database.ts` writes the snapshot JSON and attachment lookup rows. Metadata is represented in both. | Rename storage without combining these representations or changing their validated relationship. File bytes remain in artifact storage; neither table rename rewrites those bytes. |
| `core/evidence-receipt.ts` and `server/trust/receipt-service.ts` derive and persist terminal receipts from retained run/result/failure/checkpoint/operation/gate evidence. Dashboard and CLI share this path. | Keep the same receipt IDs, derivation bindings and evidence semantics. Resolution annotations must not alter the immutable failure bytes used to derive or compare old receipts. |
| `services/trust/knowledge-service.ts` has authored record admission and generated guide methods but no production caller; §4 of operator-trust explicitly records this gap. | Retire the service, tables and obsolete generated-guide obligations. Preserve useful existing repository instructions/lessons; do not delete or overwrite hand-authored documentation. |
| Diagnostic retention stores pin reasons `knowledge`, `fix` or `write-recovery` in each snapshot, not as live joins to those tables. | Removing lesson/fix tables must not silently unpin or purge evidence. Preserve historical pins through a versioned representation; do not require nonexistent knowledge rows to read them. |
| `run_failures` is currently immutable occurrence evidence; run completion/receipts/archives can depend on its exact content. There is no failure-resolution field/action in the inspected path. | Add separately versioned annotation fields on the same failure row. Preserve the original failure record and hashes; provide a separate annotation read model and transactional command. |
| Archive reports capture projected failure/receipt data and resolution. | Save the resolution known at transfer time; render it read-only without a live failure join. Verified conversion may change representation, not invent information. |

Sanitized read-only target at `2026-09-08T21:13:53.153249+00:00`:
`/Users/julianhein/Projects/hr-automation-rebuild/.tracker/state.db` held ten diagnostic bundles,
zero attachment rows, twelve receipts, zero knowledge records, zero fix records, ten failures and
zero archive rows. Quick check `ok`; FK violations zero. This is count/health evidence, not complete
conversion proof. Tests must cover populated attachments, retired records, pins and archives despite
their absence on the observed target. No payloads, keys or subject data were printed.

## Resolution contract and user workflow

Run 42 fails and keeps its original failure, snapshots/files and receipt. After addressing the
problem, the operator opens its failure details and selects **Mark resolved**, optionally entering
a short note such as “Updated page control.” The database records resolution status, the admitted
actor, server timestamp and note. The run still shows failed; its original receipt remains unchanged.
**Reopen** allows correction of an accidental resolution without inventing another failure or run.
No note, commit, file list or verification report is mandatory.

Store a strict `unresolved`/`resolved` annotation with its own monotonically increasing version on
`run_failures`. In the resolved state, require actor and timestamp; allow a bounded trimmed note
using the existing operator-note/reason constraints and protected-text handling. Historical rows
initialize explicitly to unresolved: absence of a fix row is not proof that the issue was fixed.
For reopened state retain action history through commands/audits and timeline; do not erase the
original failure or describe reopening as another workflow failure.

Keep resolution outside the original immutable failure `record_json`/fingerprint or equivalent
frozen evidence payload. Give it separate schema/columns or typed annotation JSON on the same row;
SQL mirrors and integrity checks must agree. Existing immutable failure readers return the original
failure unchanged. New resolution readers return the annotation separately. Do not bump the run's
logical version or modify its accepted completion merely to change resolution.

Use the existing command envelope, admission, actor and audit infrastructure, with exact run and
failure IDs and expected annotation version. Select the current run/failure from authority; reject
mismatched ownership, deleted/tombstoned targets and invalid input before mutation. Only explicit
operator actions change resolution. A repeated command ID with exact content returns its recorded
result; changed content under that ID refuses. Concurrent commands fence on annotation version.
Commit annotation, command/audit outcome and timeline event atomically. Event failure rolls back
the update. Cross-process refresh reads durable state rather than relying only on a UI callback.

Resolution is administrative follow-up, not evidence that a code change passed tests or that an
external operation is safe to repeat. An unknown external-write outcome remains unknown, even when
its failure is marked resolved. Existing recovery and retry gates continue to apply. Do not resolve
other occurrences that share the failure fingerprint, even if the same repair might address them.

Add status, actor/time, optional note and the two actions within the existing failure-detail surface;
use existing design-system components, command feedback and accessibility patterns. Failed commands
show their real refusal and do not leave an optimistic resolved label. No separate management page.
Archived reports show the resolution annotation captured during archive transfer. They are read-only
and do not query a retained live failure. Mark resolved/Reopen applies only to eligible live failures;
moved/deleted/absent failures cannot be recreated by an action or cached archive. Captures without a
failure have no resolution control. Ordinary resolution events follow ordinary retention; current
live fields remain until authorized deletion or verified archive transfer removes their owning row.

## Migration and retirement

Append supported migrations, preserving released migration fingerprints and normal boot refusal of
pending upgrade. Rename the three evidence tables, all associated FK/index/trigger/catalog/read-write
registrations and SQL/JSON integrity checks. Preserve every diagnostic, file, artifact, receipt, run,
failure and export identity; content digests, redaction and frozen JSON bytes remain valid. Historical
formats are admitted by explicit versioned readers, not by permissive parsing or live old-table aliases.

Remove knowledge/fix authority schemas, repositories, service/projection methods and live consumers
or obligations that exist solely for those tables. Preserve unrelated advisory evidence and diagnostic
retention. Legacy knowledge/fix provenance referenced by historical data may remain an inert typed
reference, not a fabricated resolution or a restored runtime authority. Keep historical pin protection;
removal is not authorization to change retention or delete artifact bytes.

Empty retired tables may be dropped by the supported conversion. Nonempty historical inputs require
preservation in a verified backup bound to the stopped pre-upgrade authority before retirement; test
that missing/mismatched preservation refuses without dropping data. Retain explicit old-backup inspection
and restore support. Do not silently convert unverified prose to active agent instructions or mark
failures resolved based on a retired fix's status/fingerprint. Actual backup creation and operator
conversion remain part of a separately assigned application, never automatic boot side effects.

Existing repository lesson files and their instruction links remain in place. Update current contract
text that says database knowledge is the future authority to point to linked workflow/module guidance;
retire its unwired projection/search obligation without claiming unrelated roadmap tasks complete.
Generated files are not hand edited; do not overwrite an existing generated or authored guide merely
to remove its generator. Keep source provenance and historical migration evidence recoverable.

D308 deletes resolution annotations with their owning failure and preserves the normal tombstone,
command/audit and shared-evidence behavior. Snapshot/file pruning remains independent of resolution:
marking resolved neither deletes evidence nor extends its retention automatically. Shared artifact
bytes and protected download admission retain their existing rules.

## Ordered work, allocation and proof

1. **S1 Admission:** verify F development release and exact frozen annotation/transaction contracts,
   owned command/read/UI files, base and test slots. No dependency on P or G.
2. **S2 Resolution:** implement the admitted Mark resolved/Reopen command, canonical actor/version
   fences, atomic annotation/audit/event persistence, read model and usable failure UI on F alone.
3. **S3 Proof:** complete P3–P5 and annotation-specific P6; link B's P1/P2/storage P6 evidence and
   test the composed current/archive boundary without requiring sibling behavior.
4. **S4 Development release:** focused proof, lint and affected freshness; record the committed
   candidate for final 2.6.9 validation, repair and independent review.

| Proof | Required result / negative control |
| --- | --- |
| P1 Evidence-preserving rename | Populated snapshots with multiple file types, duplicate shared artifact references, zero-file/operator captures and receipts preserve IDs/bytes/digests/redaction and FK integrity. Existing capture/download/export/receipt consumers return equivalent evidence. |
| P2 Retirement | No current knowledge/fix readers/writers/projection authority remain. Populated legacy records survive in the verified pre-upgrade backup; absent/mismatched backup refuses destructive retirement. Legacy pins remain protected, recovery pins still work, and no evidence is silently unpinned/deleted or imported into agent prompts. |
| P3 Annotation integrity | Mark resolved/reopen changes only the separate annotation and action history. Failure bytes/fingerprint, run completion/status/version, receipts and archive digests remain exact. Historical unresolved default is explicit; matching fingerprints and successful retries cause no automatic resolution. |
| P4 Commands and concurrency | Real independent DB connections race with version checks; stale or divergent commands refuse. Inject audit/event/storage failure and prove atomic rollback. Exact replay after commit/ack loss/restart is a no-op; wrong run/failure, forged actor, rejected Host/Origin, malformed input and tombstoned target have no mutation. |
| P5 Served behavior | Live failure views show current resolution, accessible actions, optional-note feedback and real refusals. Archived reports show captured resolution read-only after live source removal; stale archive actions refuse. Reopening corrects mistaken marking; refreshed processes observe persisted state. Capture-only runs have no control. Marking resolved cannot enable a prohibited retry or resolve UNKNOWN external state. |
| P6 Upgrade/deletion | Fresh DB, supported historical upgrade/backup/restore, interrupted conversion before/after commit, exact resume and repeated no-write conversion pass. D308 removes exact annotations with owner failures and does not resurrect them from cached UI/archive; shared artifacts, diagnostic pin/prune rules and protected download checks remain valid. |

## Cross-stage proof allocation

D proves P1–P4 and the live portion of P5/P6 on F alone, consuming F's exact migration proof where
unchanged. The approved saved-report portion of P5 and post-transfer deletion portions of P6 belong
to L/A/H and final 2.6.9, using D's stable capture/read-only resolution interface. They remain
required; D does not need an unmerged archive implementation to pass its independent focused gates.

## Execution ownership

Use [the combined workflow](README.md), [prerequisite releases](prerequisites.md) and
[launch registry](PROMPTS.md). One Astra/high supervisor owns this assignment; default zero
implementation workers. Shared migrations, composition and fixture work belongs to its prerequisite.
Return a committed development candidate after focused checks, lint and affected freshness; final
2.6.9 owns heavy gates, independent review, all remaining repairs and operator-assigned integration.
No per-peer review, master merge, provider-owned integration or automatic task dispatch remains.

## Focused checks and final proof

Suggested selectors from source inspection, to verify on the actual prerequisite release:

- `npm run test -- tests/unit/diagnostic-capture.test.ts tests/unit/diagnostic-safety-projection.test.ts tests/unit/storage-diagnostic-redaction.test.ts tests/unit/server/diagnostic-bundle-readback.test.ts`
- `npm run test -- tests/unit/evidence-receipt-repository.test.ts tests/unit/receipt-derivation-binding.test.ts tests/unit/archive-model.test.ts tests/unit/archive-protected-identity.test.ts`
- `npm run test -- tests/unit/storage-upgrade.test.ts tests/unit/storage-upgrade-tombstones.test.ts tests/unit/storage-backup.test.ts tests/unit/storage-restore-drill.test.ts`
- `npm run test:architecture -- tests/unit/architecture/knowledge-fix-integrity.test.ts tests/unit/architecture/migration-history-immutability.test.ts tests/unit/architecture/evidence-receipt.test.ts`

Add real populated migration, concurrent connection and fault-injection tests for the proof rows;
replace retired guards with meaningful negative controls and deciding inventory evidence. Preserve
all assertions, test membership, coverage floors, isolation and timeouts. Run lint whenever tests
run. A focused pass is not complete product acceptance. The full required typecheck/coverage/
architecture/parity/build/recovery and generated gates are owned by [2.6.9](final-validation.md).
Use /ui for frontend work and deliberate parity changes; preserve the scoped product exclusions.

No live external submission, real provider/key wiring, operator database upgrade or source cleanup
is authorized here. An operator-root upgrade/cleanup is a separately assigned action after accepted
integration, verified stopped ownership, source-bound backup, supported upgrade plan/apply/doctor
and sanitized before/after identity/count evidence. This planning work changes no runtime data.

**WAITING ON:** the assignment's actual prerequisite development release. C0's execution allocation is admitted below; no future base is guessed.
All earlier planning checks remain historical Git evidence, not gates for the new implementation.

## C0 execution allocation — 2.6.6.2 D

Prerequisite: **one frozen F release, identical to P/G/S base**. One Astra/high supervisor, zero implementation workers.
Use the exact `D` branch and absolute worktree in [PROMPTS.md](PROMPTS.md#binding-registry).
This allocation supersedes older shared-file/side-task ownership in this owner; product proof is retained.
Current inspected baseline is R `60b356dd119140dc972a077751ad16af934acb2e`, schema39/floor37.
Future prerequisites build the explicitly named new modules before peers launch; names do not assert readiness.

Ordered outcomes: Verify fixed F command/repository/capture interfaces; implement resolution commands and live UI; prove atomic annotation and served refusal paths; release to L.

### Exclusive changing paths

- `src/core/failure-resolution.ts` (new target)
- `src/infra/sqlite/failure-resolution.ts` (new target)
- `src/server/dashboard/queries/failure-resolution.ts` (new target)
- `src/server/dashboard/commands/failure-resolution.ts` (new target)
- `src/server/dashboard/compose/failure-resolution.ts` (new target)
- `src/server/dashboard/queries/run-trust.ts`
- `src/dashboard/surfaces/trust.tsx`
- `src/dashboard/surfaces/trust-model.ts`

### Proof and test ownership

P1–P6 remain with the cross-stage allocation above. F owns global domain/command/read-detail unions and root dispatch; D cannot edit them. New dedicated desktop resolution parity case and references are owned by D, with existing shared fixture construction frozen by F.

- `tests/unit/failure-resolution/commands.test.ts` (new required test)
- `tests/unit/failure-resolution/capture.test.ts` (new required test)
- `tests/unit/dashboard/failure-record-render.test.ts`
- `tests/unit/dashboard/failure-record-model.test.ts`

Run the owned unit files with `VITEST_MAX_WORKERS=1 npm run test -- --project unit --maxWorkers=1`
followed by their explicit paths above (exclude a performance script from Vitest). New paths must exist
and collect meaningful cases before release. Use `npm run lint`; run affected architecture guards
with `--project architecture --maxWorkers=1`, and the affected manifest/catalog/roadmap generators
before their `:check` commands. Preserve existing floors, membership, assertions and timeouts.
Desktop visual work uses `/ui`; focused rendering/accessibility proof is due here, complete parity/build
and all heavy gates remain 2.6.9. Preserve every inherited proof row; record exact tested tree and exits.

The prerequisite owns shared fixtures, registries, global unions and generated inputs; create only
owned fixture files beside the new tests. Shared architecture guard retirement is recorded by the
prerequisite with violating fixtures and guard-inventory evidence. No peer may edit another peer
or prerequisite path. A newly discovered required shared edit blocks peer release until its owning
prerequisite is amended and revalidated. Do not replace a missing baseline with an unused export.

Release committed candidate/base/tree and focused evidence to the next named consumer. No master
integration, independent review, heavy-gate waiver, sibling dispatch or live database application.
Future-base binding remains WAITING ON the actual prerequisite release, not a fabricated SHA.

Authored evidence stays in this task's existing `diagnostics.md` owner; shared indices remain read-only.


## Approved execution brief — 2026-09-09

The operator approved this entire proposal with “approve” after reporting the repaired F release.
Their explicit instruction assigns local merge and cleanup at the end of 2.6.6.2 and preserves
full gates at the end of 2.6, not here. This section is the complete current D execution brief;
older S1–S4/C0 execution restrictions above remain historical where this section overrides them.
All original P1–P6 product obligations and their explicit cross-stage allocation remain binding.
No implementation, task launch or phase acceptance is claimed by this planning record.

### Assignment, prerequisite and isolation

| Binding | Approved value |
| --- | --- |
| Task and owner | 2.6.6.2 D; this diagnostics.md section and its execution evidence |
| Supervisor | One GPT-6 Astra/high supervisor implementing locally; zero implementation workers and no independent reviewer in D |
| Common runtime prerequisite | Complete resolver F integration `2bb25b6efbe62ca88d64a429f01dc567a76ecfbc`, superseding the earlier F releases; see the factual rebind below |
| Inspected planning source | Clean master `0eeedcadad5ed4f686799be4dd190133372d5e2b`; F repair candidate `a1e963445bc05d57f1eb9abbff95a9238300ab3a` is integrated |
| Implementation base | Exact verified rebind commit supplied by the planner, containing approved plan `950c5b617d73d2e9d1f7e43b7e90f3eaf21c80be` and F integration `2bb25b6efbe62ca88d64a429f01dc567a76ecfbc`; never the older plan commit alone |
| Checkout creation | Create `codex/diagnostics` at `/Users/julianhein/Projects/hr-worktree-diagnostics` from that base; never implement in the integration checkout |
| Integration target and owner | Local master at `/Users/julianhein/Projects/hr-automation-rebuild`; the same D supervisor owns D-only integration and cleanup after focused PASS |
| Release consumer | 2.6.7 L consumes D's recorded integrated commit alongside its other explicit prerequisites; no successor dispatch |

Recheck plan content, both ancestries, clean ownership, ref/path absence and worktree capacity before
the first edit. Planning observed only the primary checkout and unrelated
`/Users/julianhein/Projects/hr-separation-accounting-final`; preserve that checkout and branch.
The diagnostics path/ref and F's removed path/ref were absent. Names are proposals, not reservations.
At most four auxiliary worktrees may exist; never borrow an active sibling's checkout.

F's [repair and integrated release](foundation.md#f-prerequisite-repair--2026-09-09) and
[complete cleanup receipt](/Users/julianhein/Projects/hr-database-foundation-repair-evidence-20260909/closure.json)
are the prerequisite evidence: 961 unit tests, 199 affected architecture tests, 67 filtered UI cases,
lint and freshness passed. These are F's focused evidence, not D's behavior proof or full gates.
F repair changed the command kernel's settings branch and appended settings tests, but left D's
production modules, timeline grammar, shared failure UI and unavailable-resolution expectations
unchanged. Preserve those new settings tests. No actual-target preflight is needed here: all D
verification uses disposable synthetic authority roots, never the operator database.

### Exclusive paths and approved ownership amendments

D retains these production paths:

- `src/core/failure-resolution.ts`
- `src/infra/sqlite/failure-resolution.ts`
- `src/server/dashboard/queries/failure-resolution.ts`
- `src/server/dashboard/commands/failure-resolution.ts`
- `src/server/dashboard/compose/failure-resolution.ts`
- `src/server/dashboard/queries/run-trust.ts`
- `src/dashboard/surfaces/trust.tsx`
- `src/dashboard/surfaces/trust-model.ts`

The operator approved three narrowly bounded additions to the former frozen allocation:

1. `src/events/timeline.ts`: add a strict failure-resolution history payload with exact run/workflow,
   failure, command, actor, action, annotation version and time binding. Use the existing timeline
   transaction/repository and ordinary retention. Preserve historical payloads, SQL schema and
   execution-span semantics; do not disguise annotation history as a run transition or gate event.
2. `src/dashboard/surfaces/log-panel.tsx`: pass live action context and admitted actor through the
   existing failure-detail call chain. Shared failure rendering defaults to read-only; the existing
   archive caller receives no live controls. Keep callbacks/context inside this existing surface
   and the D-owned trust files; no app-shell or archive redesign.
3. Resolution cases in `tests/unit/command-kernel.test.ts` and
   `tests/unit/database-foundation/four-way-independence.test.ts`: retain explicit unavailable-port
   refusal proof while adding activated-command proof. Preserve all unrelated settings, provider,
   artifact and pair/order assertions. These tests are D-owned for this bounded change only.

D owns `tests/unit/failure-resolution/commands.test.ts` and `capture.test.ts` (new), local fixtures
beside those tests, existing `tests/unit/dashboard/failure-record-render.test.ts` and
`failure-record-model.test.ts`, and new `tests/parity/failure-resolution.spec.ts`,
`tests/parity/helpers/fixture-failure-resolution.ts`, `tests/parity/references/failure-resolution-*`.
Tests for the new timeline payload belong in D's dedicated command/capture suites. Shared fixture,
registry, migration, global command union, authority-database and root composition edits remain
excluded. Any further necessary shared edit requires amendment before dependent work proceeds.

D records authored progress only here. Planning owns the synchronized shared admission pointers.
These additions do not intersect P/G/S's allocated changing paths; all still consume repaired F
without an unmerged sibling API. Either sibling merge order remains permitted. Serialize only
shared-target merge/regeneration and evidenced resource conflicts; D has no permission to merge a
sibling. L/final 2.6.9 retain combined actual-candidate pair/order verification.

### Parallel coordination — operator-requested protocol amendment

The operator requested this plan/prompt correction and then directed a reread of the updated
protocol on 2026-09-09. Follow [Parallel coordination](/Users/julianhein/.agents/skill-library/focused-sessions/REFERENCE.md#parallel-coordination)
and the linked isolation/gate rules. This section supersedes earlier coordination wording in this
owner; historical planning/rebind orders below are evidence, not a standing queue or reservation.
Product scope, D01–D05, the three ownership amendments and the 2.6.9 gate exception are unchanged.

**Default to independent work and no peer messages.** This protocol is not a request for check-ins,
peer availability surveys, start/finish notices, readiness broadcasts or acknowledgment rounds.
Do not contact another task merely because it exists, shares master or has completed work. First
read the committed plan, Git state and existing primary evidence. Message only a known affected
owner when a concrete unresolved blocker, conflicting claim, changed required input or necessary
transfer requires that owner's action and the evidence cannot resolve it. State that needed action
before sending; otherwise stay silent. Use the exact returned task ID and one concise message
with the relevant resource/commit and requested action. Do not relay progress or copy gate results
that records/native delivery already provide. This grants no new dispatch or messaging authority.

| Boundary | D's bound responsibility |
| --- | --- |
| Implementation | The operator-started D supervisor implements and repairs D in `codex/diagnostics` at `/Users/julianhein/Projects/hr-worktree-diagnostics`, with the exact approved files and one effective test file worker. No P/G/S dependency, new workers or coordinator. Recheck `git worktree list --porcelain`, actual branch/path and available ownership evidence before writing. |
| Shared writes | Planning documents, the Git index and shared generated output are writes too. D's worktree-local owner/evidence and generated artifacts remain isolated. Shared master mutation is limited to D's authorized integration/recording; verify exclusive access at that boundary. Never edit shared files concurrently and rely on selective staging to repair ownership afterward. |
| Actual resource conflict | Serialize only the conflicting operation. Prefer an existing verified acquisition mechanism; otherwise request once from the known current owner. Begin only on a valid grant or verified supported mechanism, never clean status alone, silence, elapsed time or a peer title. Preserve an already agreed order while an operation is in flight; crossed/contradictory claims stop that operation until the current owner resolves the conflict. No group-wide slot, speculative queue, broadcast or repeated reminder. |
| Gates | Continue independent work and isolated checks while an actual shared operation is blocked. Preserve the existing worker budget and scoped gates; release a conflicting resource when its operation/process has finished, including failure. Send a release only if a named waiter needs it to proceed, with verified completion/exit evidence. |
| Integration and cleanup | The same D supervisor retains D05: exact-path commit, local master merge after focused PASS, invalidated integration rechecks, preserved evidence and owned worktree/ref cleanup. D cannot merge siblings. L consumes the recorded D release; 2.6.9 owns full gates, complete independent review and remaining phase repairs. An already assigned downstream owner needs no new acceptance handshake just to read D's completed release. |

Before READY, before the first implementation edit and before integration, verify the current
required F release at its owning record, exact ancestry and complete cleanup receipt. If primary
evidence shows the required release reopened or superseded, establish whether the admitted source
is still valid; do not dismiss a known change as unrelated without the owning evidence. If that
cannot be established, mark the dependent boundary WAITING ON the specific release/repair. Rebind
the actual completed prerequisite, inspect changed inputs and rerun invalidated checks before
issuing a replacement READY prompt. Do not guess a future SHA, silently adopt a new master, or
launch on a source already declared superseded. Unrelated peer progress does not itself create a
new dependency or require a survey.

Keep one compact current-state/evidence record here during execution: actual D task ID, branch/path,
approved plan/base/candidate/tree, owned scope, tested inputs/commands/exits, unresolved blocker and
remaining integration/cleanup owner. Resolve actual supervisor IDs at execution; these planning
sessions are not future implementation identities. Record the final integrated release and residue
here so L/finalization can verify it without a coordination conversation.

Retain every owned duty until complete or explicitly transferred with the receiving owner's
acceptance; a delivered message cannot transfer unfinished work. Native returns and existing
completion waits suffice for already assigned work; do not duplicate them with messages. For a
necessary owned dependency, use supported waits with cursors/backoff only while its result is
needed and continue independent work. No sibling observer loop or invented automation/subscription.
When no local work/process remains and other duties already belong to an authorized owner, end
the turn with D's contribution status and remaining owner. If a required resume has no established
authorized delivery mechanism, state the operator resume point. Keep Done / Now / Remaining in
this task's user-facing chat; do not forward those updates to peers.

Amendment persistence used clean master `391686035bc85a0587958e09dae7cf0feceadbed` after G's
explicit release of the actual shared PROMPTS/index operation; no repository writes preceded that
release. Only this owner and D's prompt entry changed. The exact amendment passed 24 roadmap binding
tests, a fresh `npm run lint`, roadmap generation/freshness, 46 local links, nine instruction pairs
(maximum chain 17,333 bytes) and whitespace checks. Evidence and final committed-content/ancestry
verification are retained at `/tmp/diagnostics-plan-evidence-20260909/protocol/`. Original feature
approval, completed F prerequisite, focused merge/cleanup and deferred 2.6.9 acceptance are preserved.

### Feasibility and proof bindings

| Requirement / inspected mechanism | Required change and earliest proof |
| --- | --- |
| `createFailureResolutionRepository.read/update` already supplies strict annotation JSON, independent version/CAS and an outer-transaction-compatible writer. Kernel dispatch already encloses command insertion, application and audit in one authority transaction. | D02 activates its existing executor/capability and appends the resolution timeline event inside that transaction. D04 injects annotation, audit and event failures and proves complete rollback, including generation and command journal. |
| The current timeline payload union admits only spans, checkpoints and confirmed operations. Existing repository admits an exact run/workflow owner and distinguishes confirmed versus ordinary retention. | D02 adds the narrowly owned strict payload. D04 proves restart/readback, source binding, ordinary pruning, duplicate identity and unchanged historical/event readers. This was a known allocation gap, not supervisor discovery. |
| F's failure query is wired into trust/receipt composition; failure-detail wire already carries separate resolution/capability. `run-trust.ts` currently projects that annotation directly. | D02/D03 serve current annotation and apply existing protected-text rules to optional note values. Prove protected note text does not escape served views/errors/history while immutable failure and receipt content remains exact. Keep raw capture identity separate from public projection. |
| The same failure body renders in live log-panel and Archive. Only the live panel currently has the admitted actor context; existing client provides command and run-section reads. | D03 passes explicit live context; absent context is read-only. Use durable section readback and a bounded lifecycle-cleaned refresh mechanism so another process's annotation change is visible without bumping run version or relying only on a local callback. Prove read failure is visible, no stale optimistic success, and unmount/selection changes stop obsolete refreshes. |
| F's two shared tests expressly assert capability remains unavailable. | D02/D04 retain injected-unavailable negative proof and add active resolution proof; do not delete unrelated assertions or leave final gates knowingly broken. |
| Archive transfer is not yet implemented; immutable snapshots may outlive source failures. | D04 proves current read-only presentation and stale/deleted target refusal on F alone. L/A/H and final 2.6.9 retain saved-report capture-time resolution, deletion/readability and full archive conversion portions of P5/P6. No fake archive producer is introduced. |

The command proof matrix includes valid resolve/reopen; same-ID exact replay after commit/ack loss
and restart; changed content under the same ID; two real connections competing for one version;
wrong run/failure pairing; absent/tombstoned/moved source; invalid action/version/note; forged actor
and rejected Host/Origin at the actual HTTP boundary. Invalid requests must have no annotation or
other forbidden mutation. Inject failures after the annotation change but before audit/event commit,
with a valid positive control reaching the same boundary. Reopen retains action history; matching
fingerprints and successful retries never resolve another occurrence. Resolution cannot make an
UNKNOWN external write retryable. P3/P4 compare original failure bytes/fingerprint, run completion,
status/version and receipt bytes/digests before and after, rather than merely checking row counts.

### Ordered execution

| Step | Outcome / completion boundary |
| --- | --- |
| D01 — Bind scope | Read the linked Parallel coordination protocol; verify the approved plan, current F release/closure and exact ownership from primary evidence; create the isolated branch/worktree and inspect the three amended paths. No routine peer check-in or reservation round. |
| D02 — Resolution commands | Implement resolve/reopen with exact target/version and admitted actor/time, optional bounded note, typed refusals and atomic annotation/command/audit/timeline history. Preserve replay, immutable evidence and the unavailable-port negative control. |
| D03 — Live controls | Use /ui locally: Components lead with Verification support, no delegated UI agents. Use the existing specimen/design system for status, actor/time, optional note, Mark resolved/Reopen, pending/failed feedback and keyboard access. Keep archived rendering read-only and provide durable cross-process refresh. |
| D04 — Focused proof | Complete D-owned P3/P4, live P5 and annotation-specific P6, link unchanged R/F P1/P2/storage evidence, run the exact focused gates below, repair failures and record the candidate SHA/tree and logs. |
| D05 — Merge and cleanup | Retain ownership through completion: commit exact paths, serialize only the actual shared-target mutation, merge D locally after focused PASS, revalidate invalidated inputs, record release for L, preserve evidence and remove only D's owned worktree/ref after stopping owned processes. Follow the actual-conflict rule above; no routine completion broadcast or downstream acceptance round. |

One supervisor fits the coupled command/annotation/UI seam and proof on an already composed F base.
No workers, per-peer reviewer, nested finalizer or separate repair task is assigned. Independent
complete review belongs to 2.6.9's fresh read-only sup_review on Astra/high, after its full gates.
Keep Done / Now / Remaining visible at start/resume and each verified step, including pending merge,
cleanup and the deferred phase acceptance. Routine implementation choices and in-scope repairs do
not require renewed approval.

### Exact focused gates and scheduling

Run from the verified D worktree. Keep logs and the configuration below in an owned external
`/tmp/diagnostics-*` directory during iteration; preserve final evidence outside the removed
worktree in `/Users/julianhein/Projects/hr-diagnostics-evidence-20260909` without overwriting another
owner's evidence. At most one effective D test file worker, within the four-worker batch budget.

Create external `vitest-one.config.mts` by importing the actual D worktree `vitest.config.ts`,
spreading the imported configuration and its `test` object, setting root `maxWorkers: 1`, and
mapping every object in `test.projects` to preserve all fields while setting its nested
`test.maxWorkers: 1`. Reject unexpected project shapes. Preserve forks, isolation, project membership,
assertions, timeouts and coverage floors. Verify the resolved root/project worker settings and save
the comparison; environment/CLI flags alone were insufficient in F. No production runner edit.

Use `VITEST_MAX_WORKERS=1 npm run test -- --config <absolute owned vitest-one.config.mts> --project unit --maxWorkers=1`
with this exact selector set (new files must collect meaningful cases):

```text
tests/unit/failure-resolution/commands.test.ts
tests/unit/failure-resolution/capture.test.ts
tests/unit/dashboard/failure-record-render.test.ts
tests/unit/dashboard/failure-record-model.test.ts
tests/unit/command-kernel.test.ts
tests/unit/command-kernel-restart.test.ts
tests/unit/database-foundation/transaction-contracts.test.ts
tests/unit/database-foundation/four-way-independence.test.ts
tests/unit/diagnostic-capture.test.ts
tests/unit/diagnostic-safety-projection.test.ts
tests/unit/storage-diagnostic-redaction.test.ts
tests/unit/server/diagnostic-bundle-readback.test.ts
tests/unit/evidence-receipt-repository.test.ts
tests/unit/receipt-derivation-binding.test.ts
tests/unit/archive-model.test.ts
tests/unit/archive-protected-identity.test.ts
```

Use the same invocation with `--project architecture` for:

```text
tests/unit/architecture/control-command-single-path.test.ts
tests/unit/architecture/command-result-exhaustive.test.ts
tests/unit/architecture/dashboard-wire-boundary.test.ts
tests/unit/architecture/redaction-surface-scan.test.ts
tests/unit/architecture/strict-boundary-schemas.test.ts
```

Run `npm run lint` whenever tests run. Run affected generators before their checks:
`npm run build:manifest` / `npm run build:manifest:check`, `npm run stores:catalog` /
`npm run stores:catalog:check`, and `npm run roadmap` / `npm run roadmap:check` as their inputs change.
Do not hand-edit generated output or use a failing guard as permission to weaken its requirement.
Guard additions/retirements need the deciding inventory evidence and an ownership amendment if a
shared path is required; none is presumed by this plan.

Desktop proof is `npm run test:parity -- tests/parity/failure-resolution.spec.ts --workers=1`.
Its local fixture must exercise actual command/refusal/readback paths, keyboard access, both themes,
1024×720 minimum desktop, zoom/wrapping, protected notes, pending/error states, cross-process refresh
and archived read-only rendering. New reference creation is deliberate /ui verification, followed
by the assert run. Preserve existing shared fixtures and unrelated references; broad refreezes
remain downstream. The filtered lane may build its candidate bundle as required by its own runner;
this is not the deferred broad production-build acceptance gate. Use playwright-cli and its required
playbook for manual browser work, not prohibited browser MCPs.

Iteration runs the affected subset; the committed development candidate must have the complete
focused set above, lint, affected freshness and dedicated desktop proof. Gates sharing mutable
outputs run sequentially. The parity runner's worktree-local reports/build and ephemeral ports/root
are D-owned; verify current ownership before starting. Full typecheck, coverage, whole architecture,
full parity, broad build/performance and original phase-wide recovery/scenario proofs remain at
2.6.9. No full gates or independent review are run merely to commit or merge D.

Before integration, recheck master HEAD and clean exclusive integration access, candidate/plan
identity and mergeability. Do not overwrite another session or infer ownership from idle status.
After merging, rerun invalidated focused checks and freshness. Reuse only proven unchanged inputs,
recording original tested commit/tree, integrated tree and inspected source/test/config/dependency
comparison; any uncertainty requires the applicable rerun. Record-only commits use document/link,
instruction-pair/chain, affected generation and whitespace checks, without rerunning unaffected
runtime gates. A new SHA alone neither invalidates nor proves existing evidence.

### Completion, exclusions and stop conditions

D is complete only as a merged focused development release with actual integration SHA, tested
candidate/tree, exact commands/exits, retained proof paths, explicit P1–P6 cross-stage disposition
and verified worktree/ref/process cleanup. L and final 2.6.9 can consume the reachable master commit
without retaining D's branch. Do not remove the active supervisor checkout from inside it; use the
safe primary checkout after preserving ignored outputs and verifying no owned process remains.
No branch deletion before verified integration, no unrelated worktree cleanup and no push.

No new migration, schema/fingerprint registry, global command union, root dispatch/composition,
provider/key wiring, archive implementation, automatic resolution, changed run/receipt identity,
new issue/fix/knowledge authority, retention policy, notification/outbox, live HR write, operator
upgrade, cutover or successor dispatch is authorized. No existing failed focused check can be
carried as PASS. Missing/changed prerequisites, an unowned required change, incompatible protected
projection or additional material contract decision stops dependent work for amendment; continue
independent authorized work. The three known allocation gaps above are already approved and must
not be returned as fresh permission questions.

### Planning verification

Approval covers this entire brief and its three ownership amendments on repaired F. Planning
changes only this owner, synchronized admission/contract pointers and generated roadmap. Evidence
is retained at `/tmp/diagnostics-plan-evidence-20260909`; the planner records final check results
before committing, then verifies the committed section, ancestry, reachability and launch bindings.
No D implementation or runtime proof is claimed here. READY requires that complete committed
plan plus passing documentation gates and the verified repaired F prerequisite.


Planning gates passed on the D-only document snapshot based on
`0eeedcadad5ed4f686799be4dd190133372d5e2b`. P and G were concurrently editing shared documents;
commit/index/roadmap operations were coordinated D → P → G. The planner reconstructed only D's
approved edits over the committed base, generated its roadmap in an isolated document snapshot,
and staged exact D blobs. Peer authored changes remain unstaged and preserved.

| Planning check | Verified evidence |
| --- | --- |
| Documentation binding | 1 file / 24 tests PASS, exit 0; `candidate-binding-rerun.log`, then final recording rerun. Command uses the real test runner, architecture project and one-worker adapter against the D-only snapshot. |
| Lint | `npm run lint` PASS, exit 0, `lint.log`. Source/tests/config/dependencies match planning source; these documentation edits change no lint input. |
| Roadmap | `npm run roadmap` then `npm run roadmap:check` PASS, exit 0 in the D-only snapshot; `candidate-roadmap.log` and `candidate-freshness.log`. Regenerated again after this evidence record. |
| Links/instructions | 218 D-candidate local links/anchors resolve; nine existing instruction pairs are identical; longest project chain 17,333 UTF-8 bytes, below 32,768. `candidate-doccheck.log`. |
| Selector and scope preflight | All existing focused selectors resolve; only the two explicitly new resolution suites and dedicated parity case are pending creation. No implementation/runtime test or full gate was run by planning. |
| Commit verification | Exact-path D-only staging, whitespace checks, committed owner readback, prerequisite ancestry and reachability are verified before the outgoing prompt; final receipt is in the planning evidence directory. |

The first isolated binding attempt failed to import a guard helper omitted from the temporary
snapshot; no tests ran. Including the unchanged committed helper fixed that test setup, and the
24-case rerun passed. The first isolated link check needed canonical `/private/tmp` path handling;
its corrected rerun passed without any source-link change. Failed logs remain as setup evidence.
The shared working-tree binding test also passed but is not substituted for the D-only candidate
check. Full gates and fresh independent review are explicitly unrun here and remain at 2.6.9.


### Factual prerequisite rebind — complete F resolver release

The superseding F repair is now integrated at `2bb25b6efbe62ca88d64a429f01dc567a76ecfbc`;
final release record `e06a1c82e9983deb281c5400671f6ce330214000` contains D's approved planning
commit `950c5b617d73d2e9d1f7e43b7e90f3eaf21c80be`. The
[resolver cleanup receipt](/Users/julianhein/Projects/hr-database-foundation-resolver-evidence-20260909/closure.json)
is complete: owned worktree/ref absent, no owned processes, earlier receipts preserved. This
clears the temporary launch hold raised after the first D prompt; the earlier prompt's base is
superseded. The final planner prompt binds the exact commit containing this rebind as implementation
base while retaining the original approved-plan identity. No scope, ownership or gate approval changes.

Source comparison from the approved plan through F's final record proves every D production file,
the timeline schema, live-panel context and four-way resolution expectation unchanged. The shared
command-kernel tests now construct valid complete settings resolver results; preserve those fixture
repairs when implementing D's separately owned resolution cases. All three approved D ownership
amendments remain necessary. F's follow-up changed settings contracts/fixtures and no D feature.

F's tested candidate is `f917ffe7b2308b4746e2aba16719a68cbafdb56c`: 1,195 unit cases across
input-verified runs, 199 affected architecture cases, 67 filtered UI cases, lint and freshness PASS.
Its `final-reuse.json` records identical non-document inputs at the final F record. These are
prerequisite facts, not D acceptance. Full phase gates and independent review remain at 2.6.9.

The owner-only rebind passed 24 roadmap binding tests, a fresh `npm run lint`, roadmap freshness,
27 local links, nine instruction pairs (maximum chain 17,333 bytes) and whitespace checks. Logs and the final exact commit/ancestry
receipt are retained at `/tmp/diagnostics-plan-evidence-20260909/rebind/`. D worktree/ref availability
and capacity are rechecked before handoff; the supervisor repeats volatile checks before creation.
The shared registry's current D binding already names this F release in `e06a1c82e`; no peer or
shared registry edits are needed here. The factual rebind slot is P → D → G after F's release.

## D execution record — 2026-09-09

Current assignment: **2.6.6.2 D**, one GPT-6 Astra supervisor, zero workers. Branch
`codex/diagnostics`, checkout `/Users/julianhein/Projects/hr-worktree-diagnostics`, approved
plan/implementation base `883ae264c170e4c82fd2240078cd3a4b25bb0976`. Required F integration
`2bb25b6efbe62ca88d64a429f01dc567a76ecfbc` is an ancestor. F's resolver closure receipt was
read and its absent worktree/ref verified. D's path/ref were absent before creation; two auxiliary
worktrees existed. Shared master had unrelated documentation edits, which were preserved.

D01–D05 are complete. D04 candidate checks and D05 integration/cleanup are recorded below.
Full gates and fresh independent review remain with 2.6.9. Iteration evidence is
`/tmp/diagnostics-20260909/`; retained evidence is
`/Users/julianhein/Projects/hr-diagnostics-evidence-20260909/`.

**Operator-approved bounded test ownership amendment:** the required focused guard
`tests/unit/architecture/control-command-single-path.test.ts` omitted failure-resolution from its
expected active partition and command corpus even though the admitted F base registered the arm.
The operator explicitly approved adding that one family/action and its missing valid fixture on
2026-09-09. All existing assertions, partition/corpus equality and unavailable-port controls remain.
No guard was added or retired, so guard-inventory ownership is unchanged. The failing evidence is
`architecture-first.log`; the unrelated command-result fold failure in the same run is repaired in
D's owned model using the existing exhaustive settlement function.

**Operator-approved bounded database ownership amendment:** same-ID changed-content resolution
reaches the shared database's identity check before D's executor. Only settings mapped that mismatch
to `CommandIdentityConflictError`; other families threw a generic Error. The operator explicitly
approved adding failure-resolution beside settings in that single condition in
`src/infra/sqlite/authority-database.ts` on 2026-09-09. No other database behavior or family changes.
`commands-render.log` and `command-capture.log` retain the reproducer. Regression proof checks
kernel and actual HTTP typed `command-divergent` refusal, no protected note in errors, and unchanged
rows/generation after rejection.

### D implementation and focused proof

D02 activates the admitted failure-resolution command inside the kernel's existing authority
transaction. Exact run/failure identity, independent annotation version and archived/deleted
refusals precede mutation. Annotation, command journal, audit and strict native timeline history
commit together. History contains identity/action/version/time, never optional free text. No run,
failure, fingerprint, receipt or completion bytes change. Same-state/stale commands refuse without
burning their IDs. Protected note projection leaves raw captured evidence separate.

D03 uses existing Field/Textarea/Button/Banner components. Live Logs passes admitted actor/time;
shared and archived rendering has no action context and remains read-only. The component displays
pending/refused/read-error states, reads durable authority after commands, and polls every three
seconds with one in-flight read and selection/unmount cancellation. Exact nested annotation
identity is checked. Two independent OS processes prove version competition and another process's
updates appear in the desktop without changing run version.

| Proof allocation | D evidence and remaining stage |
| --- | --- |
| P1/P2 foundation, naming and storage | Reuse R/F prerequisites and F's complete resolver closure above. D changes no SQL migration, table catalog, fingerprint registry or naming authority. Combined storage/conversion acceptance remains 2.6.9. |
| P3 authority and atomicity | `commands.test.ts`: resolve/reopen, exact replay after lost acknowledgement/restart, divergent identity, stale/mismatched/malformed targets, ordinary timeline retention and same-version competing OS processes. Injected post-annotation/event/audit failures roll back rows, journal and generation; identical commands then succeed as positive controls. |
| P4 immutable evidence and safety | `capture.test.ts`: populated receipt/run/failure bytes and receipt identity remain exact across resolve/reopen; protected notes are absent from served views/errors/history. Corrupt annotation fails by name. Matching fingerprints remain separate. Parked UNKNOWN write and generic retry refusal remain unchanged. |
| P5 served behavior | Unit rendering/readback plus two-theme dedicated desktop: keyboard/focus, pending/refusal, read failure/recovery, cross-process refresh, protected long note, minimum desktop, zoom and archived read-only presentation. Archive fixture is explicitly a captured presentation snapshot, not an archive producer. Saved-report transfer, post-source-deletion readability and full archive conversion remain L/A/H and 2.6.9. |
| P6 lifecycle/recovery | Exact lost-ack replay, concurrent annotation CAS, deletion/tombstone refusal, bounded refresh cancellation and unavailable-executor negative control pass. Upgrade/recovery and combined archive lifecycle remain downstream. |

The external Vitest adapter imports the real configuration and changes only root/project
`test.maxWorkers` to 1. `resolved-workers.json` records forks, isolation, membership and timeouts.
Final gates run serial test lanes. No full typecheck/coverage, whole architecture/parity, broad
build/performance, live application, independent review or peer dispatch occurred.

### Delivery assessment

Two discoverable foundation/plan allocation omissions required operator-approved bounded ownership
amendments: the active command guard omitted F's registered arm, and shared identity admission did
not provide failure-resolution's required typed divergent-ID refusal. Checking the executable
partition corpus and the pre-executor identity path during planning would have exposed both.
Neither amendment expands the product scope. Existing assertions and unavailable-port negative
controls remain; no guard was added or retired.

Implementation repair rounds corrected fixture migration-owner spelling, historical SQL table
names, receipt schema/hash binding, HTTP malformed-request status, a write-proof binding and lint
issues; adopted the existing exhaustive command-result fold; and fixed desktop wrapper attachment
names and archive viewport position. Failed logs remain under `iteration/`. The extra guessed
roadmap selector collected no tests alongside the five real architecture files; the actual
`roadmap-doc-binding.test.ts` is run separately. These are setup/implementation defects, not waived
requirements. One context compaction occurred; elapsed work/wait attribution is not measured.
Full independent assessment remains 2.6.9; this supervisor's inspection is not a review verdict.

### D candidate gates and integration disposition

Implementation commit `c702be5c6c685ffa70a476774085e66a7088b411` contains exactly 32 owned
production/test/reference paths, including the two explicitly approved bounded shared amendments.
The tested non-document manifest is unchanged across the final gates and commit. The exact
recording candidate SHA/tree is bound externally in `candidate.json`.

| Candidate check | Result / retained log under `iteration/` |
| --- | --- |
| Exact 16-file unit lane | 293 PASS, exit 0; `unit-final.log` |
| Exact five-file architecture lane | 58 PASS, exit 0; `architecture-final.log` |
| Roadmap document binding | 24 PASS, exit 0; `doc-binding-candidate.log` |
| Lint | `npm run lint`, exit 0; `lint-final.log` |
| Freshness | Manifest/catalog/roadmap generation then check, all exit 0; `*-final-generate.log`, `*-final-check.log` |
| Dedicated desktop | Both themes PASS, exit 0; `parity-candidate.log`; four D-only PNG/a11y/meta reference sets. Manual specimen inspected using owned playwright-cli session, then closed. |
| Documents/instructions | Local links resolve, nine existing twin pairs equal, maximum chain 17,333 bytes; `doccheck-candidate.log`; whitespace PASS. |

D05 retains merge and cleanup. Master advanced through G's completed release, including artifact
source/test changes; D will rerun its full focused unit/architecture/desktop/lint set on the combined
tree rather than reuse uncertain transitive inputs. No merge conflict or contested ownership has
been observed. G's complete closure is primary evidence that its shared mutation finished. D uses
Git's actual index/ref locking for its authorized merge; no peer message or reservation queue.
Full independent review and phase acceptance remain at 2.6.9.

### D05 focused development release and owned cleanup

| Release fact | Exact evidence |
| --- | --- |
| Implementation | `c702be5c6c685ffa70a476774085e66a7088b411` |
| Recording candidate / tree | `b74503847152790168c7f24220912f84a1029582` / `f95768f4b72172c258adc64654e04a22bc5fac19` |
| Local integration / tested tree | `7443100f701e95f22363cbf39da085f88d14a4ac` / `8fd5491aed93f35bedc7e2959eac8951e76cf7c2` |
| Integration focused gates | 293 unit cases, 58 architecture cases plus 24 document-binding cases, two desktop themes, lint, manifest/catalog/roadmap generation and freshness: all PASS, exit 0. `integration.json` and `iteration/*-integration*.log` retain command/exits and evidence. |
| Input proof | The isolated D checkout fast-forwarded to the exact local merge before integration gates. All 2,079 non-document file hashes stayed unchanged across those checks. |
| Cleanup | Owned process audit empty; manual browser closed and specimen Vite stopped. Browser/report/bundle evidence preserved externally. D-installed dependencies and owned ignored caches removed; ordinary `git worktree remove` and `git branch -d` exited 0. Registration, physical path and branch absence verified. Other worktrees remain. |
| Later peer merge | P merged `4818223c9da0231481da6051f73f2c33ee16abf0` after D's successful integration checks. D's 31 non-shared implementation/test/reference paths are byte-identical and its shared database condition is unchanged. P's two database edits concern provider invariants only. P06 retains its later merge checks; no D claim of testing that later combined runtime is made. |
| Final recording | This owner-only completion record changes no D runtime/test/configuration input. Documentation binding, links, instruction pairs/chains, roadmap freshness and whitespace are checked on the recording tree. D's runtime acceptance remains bound to the exact tested integration above. Final SHA/tree and cleanup checks are retained in `closure.json`. |

The [D closure receipt](/Users/julianhein/Projects/hr-diagnostics-evidence-20260909/closure.json),
[candidate receipt](/Users/julianhein/Projects/hr-diagnostics-evidence-20260909/candidate.json) and
[integration receipt](/Users/julianhein/Projects/hr-diagnostics-evidence-20260909/integration.json)
are the reachable release for L and 2.6.9. D kept all assigned implementation, gate, merge and cleanup
duties; no worker, reviewer, peer message, responsibility transfer or successor dispatch occurred.
No push, live database application, HR write or operator upgrade occurred.

**Completion boundary:** D01–D05 are complete as a locally merged focused development release.
Full gates, fresh independent review, saved archive transfer/readability, upgrade/recovery and
remaining combined P1–P6 acceptance stay with their admitted owners and final **2.6.9**. D stops here;
this record neither launches L nor claims sibling completion.
