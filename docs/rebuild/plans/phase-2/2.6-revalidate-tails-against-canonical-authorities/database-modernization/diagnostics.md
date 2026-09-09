# Diagnostic evidence and failure resolution

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

**WAITING ON:** C0's exact execution brief and the assignment's actual prerequisite release.
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
