# Diagnostic evidence and failure resolution

## Assignment and approval

**Owner: `side/diagnostics`. Approved planning; implementation WAITING ON accepted integration of
`side/run-completion`.** This is one combined diagnostic assignment, not another roadmap phase.

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

## Authorities, prerequisites and scope

- [Root instructions](../../../AGENTS.md), [document routing](../../README.md),
  [roadmap governance](../../roadmap/roadmap.md), and
  [operating reference](../../../.agents/skill-library/repository-work/REFERENCE.md).
- [Operator trust: diagnostic evidence and resolution](../../rebuild/reference/operator-trust.md#diagnostic-evidence-and-resolution)
  owns the pending amendment to diagnostic/receipt naming and §4's knowledge/fix authority.
- [Dashboard surfaces: failure resolution](../../rebuild/reference/dashboard-surfaces.md#failure-resolution)
  owns operator actions, immutable failure/completion/receipt boundaries and archive presentation.
- [Run completion](../run-completion/README.md) is the predecessor. Consume its accepted
  `run_failures` and immutable completion on `workflow_runs`; do not rename failures independently.
  [Provider usage](../provider-usage/README.md) and [timeline history](../timeline-history/README.md)
  are transitive prerequisites. This ordering resolves shared migrations, deletion, command and
  diagnostic presentation ownership without amending those plans.
- [Clock/config/secrets](../../rebuild/reference/clock-config-secrets.md), D321/D322/D332,
  [guards and tests](../../rebuild/reference/guards-and-tests.md), §3.14 D191, and
  [frontend/backend integration](../../rebuild/reference/frontend-backend-integration.md) own
  upgrade/backup, evidence protection, gates, command transport and parity.

Own diagnostic/failure/receipt domain and storage contracts; SQLite migrations, FK/index/integrity,
recovery/backup/deletion readers; diagnostic capture/retention and receipt services; knowledge/fix
retirement; one failure-resolution command through existing command/audit infrastructure; minimal
failure-detail UI and archived readback; associated tests, generated catalogs and owner documentation.
Read nearest instructions including `src/server/AGENTS.md`, `src/dashboard/AGENTS.md`, and
`src/control/AGENTS.md` where applicable, plus each affected module's linked lessons.

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
| Archive snapshots freeze projected failure/receipt data. | Show any current resolution separately from frozen historical content; never rewrite archive JSON/digests or describe resolution as known at archive time when it happened later. |

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
For archived retained runs, bind access to canonical archive/run/failure identity and show **current
resolution** outside the immutable snapshot. The action changes only the retained failure annotation,
not archived content or its digest. Deleted/absent failures cannot be recreated by an action or a
cached archive. Captures without a failure have no resolution control. Ordinary resolution timeline
events follow ordinary retention; current resolution fields remain until authorized failure deletion.

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

1. **S1 Admission:** verify accepted run-completion integration, plan/base availability and exclusive
   checkout; record current name/consumer map, annotation schema and command/archived read boundaries.
2. **S2 Storage:** implement three renames, preserved evidence/pins, knowledge/fix retirement and
   independently versioned failure annotation with strict populated migration/backup proof.
3. **S3 Resolution:** add the transactional command, audits/events, read model and scoped failure UI;
   verify current-versus-frozen archived resolution, correction and protection boundaries.
4. **S4 Acceptance:** complete proofs/gates, commit/freeze, obtain independent review, fix/re-review,
   then operator-assigned integration, combined gates and owned cleanup.

| Proof | Required result / negative control |
| --- | --- |
| P1 Evidence-preserving rename | Populated snapshots with multiple file types, duplicate shared artifact references, zero-file/operator captures and receipts preserve IDs/bytes/digests/redaction and FK integrity. Existing capture/download/export/receipt consumers return equivalent evidence. |
| P2 Retirement | No current knowledge/fix readers/writers/projection authority remain. Populated legacy records survive in the verified pre-upgrade backup; absent/mismatched backup refuses destructive retirement. Legacy pins remain protected, recovery pins still work, and no evidence is silently unpinned/deleted or imported into agent prompts. |
| P3 Annotation integrity | Mark resolved/reopen changes only the separate annotation and action history. Failure bytes/fingerprint, run completion/status/version, receipts and archive digests remain exact. Historical unresolved default is explicit; matching fingerprints and successful retries cause no automatic resolution. |
| P4 Commands and concurrency | Real independent DB connections race with version checks; stale or divergent commands refuse. Inject audit/event/storage failure and prove atomic rollback. Exact replay after commit/ack loss/restart is a no-op; wrong run/failure, forged actor, rejected Host/Origin, malformed input and tombstoned target have no mutation. |
| P5 Served behavior | Live and archived failure views show truthful current resolution, accessible actions, optional-note feedback and real refusals. Archive frozen content remains unchanged. Reopening corrects mistaken marking; refreshed processes observe persisted state. Capture-only runs have no control. Marking resolved cannot enable a prohibited retry or resolve UNKNOWN external state. |
| P6 Upgrade/deletion | Fresh DB, supported historical upgrade/backup/restore, interrupted conversion before/after commit, exact resume and repeated no-write conversion pass. D308 removes exact annotations with owner failures and does not resurrect them from cached UI/archive; shared artifacts, diagnostic pin/prune rules and protected download checks remain valid. |

One GPT-6 Astra/high supervisor implements this cohesive diagnostic unit locally; zero implementation
workers. One fresh read-only `sup_review` on Astra/high reviews the complete frozen candidate and
P1–P6, including UI/command and historical evidence boundaries. At most two active agents. Reviewer
receives pinned base/head/tree, complete diff, approved plan and evidence, not the author's working
conversation; it never implements/delegates. No planning agents or automatic new-task dispatch.

| Assignment | Branch / checkout | Base / integration condition |
| --- | --- | --- |
| `side/diagnostics` | Create `codex/diagnostics` in `/Users/julianhein/Projects/hr-worktree-diagnostics`; recheck refs/path/capacity. | Actual accepted local-master integration of `side/run-completion`, containing this plan and transitive prerequisites. Record full SHA before edits; planning HEAD and unfinished peer branches are not substitutes. |

The operator assigns integration into local master at `/Users/julianhein/Projects/hr-automation-rebuild`
after complete review PASS and gates. Recheck ownership, serialize the assigned integration, gate
combined inputs and independently re-review behavioral conflict fixes. Remove only the accepted owned
branch/worktree from a safe checkout. No push or next-task dispatch. Material evidence-loss, scope or
ownership changes return for amendment; routine implementation and test fixes remain local.

## Gates and application

Use `/ui` for the scoped resolution controls; read the specimen/design/parity/module lessons before
implementation. Focused iteration selectors include:

- `npm run test -- tests/unit/diagnostic-capture.test.ts tests/unit/diagnostic-safety-projection.test.ts tests/unit/storage-diagnostic-redaction.test.ts tests/unit/server/diagnostic-bundle-readback.test.ts`
- `npm run test -- tests/unit/evidence-receipt-repository.test.ts tests/unit/receipt-derivation-binding.test.ts tests/unit/archive-model.test.ts tests/unit/archive-protected-identity.test.ts`
- `npm run test -- tests/unit/storage-upgrade.test.ts tests/unit/storage-upgrade-tombstones.test.ts tests/unit/storage-backup.test.ts tests/unit/storage-restore-drill.test.ts`
- `npm run test:architecture -- tests/unit/architecture/knowledge-fix-integrity.test.ts tests/unit/architecture/migration-history-immutability.test.ts tests/unit/architecture/evidence-receipt.test.ts`

Replace retired selectors/guards with meaningful negative proof in the same unit, recording the mapping
and guard inventory evidence. Add actual command/multi-connection rollback, annotation/receipt/archive
immutability and resolution UI cases; existing tests alone do not establish the new behavior. Run lint
whenever tests run. Focused passes do not substitute for full gates or mandate repeated unchanged runs.

Every implementation commit/candidate and materially changed integration requires `npm run typecheck`,
`npm run lint`, `npm run test:coverage`, `npm run web:build`, `npm run test:parity`, affected generated
checks and `git diff --check`. Deliberate UI reference changes require review; do not blanket refreeze.
Run affected `build:manifest`, `stores:catalog` and `roadmap` generation before their `:check` commands;
never hand-edit generated output. Keep membership, isolation, floors, assertions and timeouts intact.

Use at most four effective file workers. Keep coverage free of this task's compiler/linter contention;
serialize mutable coverage/parity/build/generation outputs and evidenced host conflicts without killing
peer processes. Independent typecheck/lint/freshness may overlap within verified capacity. Record tested
SHA/tree, commands/exits, logs, resolved worker settings and P1–P6 evidence. Reuse only with original
identity/results and unchanged relevant inputs; changes/failures/unresolved proof require rerun.
Documentation-only changes follow D191 scoped checks and make no runtime proof claim.

Live HR/provider calls are unnecessary. Acceptance uses synthetic workers and populated isolated
databases plus local UI. Operator database application is separately assigned after accepted integration:
recheck exact target/schema/executable/stopped locks, take verified explicit backup (including any
retiring records), plan/apply the supported storage upgrade, run storage doctor and compare sanitized
counts, identities, evidence digests and integrity. Preserve original recovery material and runtime state.

## Progress and launch status

- Planning: scope approved, current code and sanitized target inspected. Scoped checks passed on
  2026-09-08: `npm run roadmap:check`, 12 local links, 15 test-selector paths, nine instruction pairs
  (largest chain 16,648 bytes), six preceding plans byte-unchanged, and `git diff --check`. Changes
  are this plan and authored contract/index additions only. No product tests were run or reused
  as proof of the proposed behavior; implementation remains unverified.
- S1–S4, P1–P6, implementation gates, review, integration and cleanup: **not started**.
- Launch: **WAITING ON accepted integration of `side/run-completion`**, approved-plan/base availability
  and assigned-checkout admission. No earlier plan was amended.

The operator opens `/supervise side/diagnostics` with this absolute plan path and verified plan SHA
once prerequisites are accepted. This is an approved side-work assignment: this side plan owns progress,
review, gate evidence and completion wherever `/supervise` refers to a task/phase section. Do not invent
a phase number or mark roadmap tasks complete. Preserve repository contracts, independent review and
assigned integration/cleanup conditions. Send Done / Now / Remaining at start/resume and after each
verified step, keeping all unfinished proofs, gates, review and cleanup visible.
