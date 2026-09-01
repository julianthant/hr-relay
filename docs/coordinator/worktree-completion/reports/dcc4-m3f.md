# DCC4 M3f — retained Explorer redaction inventory

2026-08-30 · `sup_sol_dcc4_m3f_redaction_inventory` · high reasoning.
Status: narrow repair frozen for independent review and supervisor gates; no commit.

## Verified entry and scope

Every command/edit targeted `/Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc4`.
Before editing: HEAD `49c6206cbc3d3e30e97603628590823787d120d8`, MERGE_HEAD
`13175b13340fec7b5326207fe54f98078d481d7d`, index tree
`dbd1b32cc6233fb9fdf6f7b577ab4be06098822f`; no unstaged tracked changes. Existing merge
and other writers' files preserved. Read `debug`, the assigned hr-debug wrapper, TDD tests
guidance, root AGENTS, project profile, owning §3.15 and §5.4, and redaction lessons.
No nested agents, worktrees, tasks, runtime edits, live database, or HR access.

Changes relative to that index, excluding this report: four files, **112 insertions, zero
deletions**: redaction helper +21, existing redaction test +74, nearest AGENTS +3, owning
guards-and-tests §3.15 +14. The scanner, two-way enumeration, egress matrix, leaf walker,
auditor implementation and existing assertions are unchanged. No manifest entry is needed:
the three added cases extend the existing guard.

## Red loop and cause

Original minimized command, rerun before code inspection:

```sh
VITEST_MAX_WORKERS=1 HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation npx vitest run tests/unit/architecture/redaction-surface-scan.test.ts -t 'registers every surface-bearing module in both directions' --maxWorkers=1 --reporter=dot
```

Exit 1: one failed, 16 skipped, 1.39s. The declared module list omitted
`src/domain/dashboard/explorer-edit.ts`; the scanned list correctly included it.
Supervisor's existing minimized red and full-coverage red are preserved unchanged.

Hypotheses tested: (1) missing inventory entry—confirmed as an **inherited omission**, not
proved to be a recent deletion: `git show 49c6206c:tests/unit/architecture/helpers/redaction-surface-audit.ts`
also has no entry for the historical module or its durable records; (2) alternate coverage—no
registered schema is either retained record; (3) false-positive scan—disproved by the actual
two storage-schema bindings below. Registering only the real surfaces next exposed exactly
four undispositioned free-text leaves. No temporary instrumentation was necessary.

## Complete Explorer boundary accounting

Current census through the public helper: **26 modules, 35 surfaces, 608 decidable leaves,
608 dispositions**. All existing two-way/module, exported-wire, leaf and canary checks pass.

| Registered surface | Owning module | Class | Decidable leaves / dispositions |
| --- | --- | --- | --- |
| `wire/workflow-explorer` | `src/domain/dashboard/explorer.ts` | operator-loopback | 52 / 52 |
| `wire/explorer-edit-validation` | same | operator-loopback | 31 / 31 |
| `wire/explorer-edit-apply` | same | operator-loopback | 26 / 26 |
| `wire/ui-catalog` | same | operator-loopback | 2 / 2 |
| `file/explorer-overrides` | same | durable-file | 1 / 1 |
| `durable/explorer-edit-review-token` | `src/domain/dashboard/explorer-edit.ts` | durable-authority | 2 / 2 |
| `durable/explorer-edit-projection-outbox` | same | durable-authority | 2 / 2 |

The last two schemas are the actual `ExplorerEditReviewTokenRecordSchema` and
`ExplorerEditProjectionOutboxRecordSchema`, respectively. The new regression checks **object
identity**, not a similar shape, against both module exports and
`AUTHORITY_RECORD_SCHEMA_REGISTRY.explorer_edit_reviews` / `.explorer_edit_outbox`
(`src/infra/sqlite/storage-records.ts:251–252`). Embedded draft, change, receipt and applied
override schemas are walked through those records; the fingerprint functions add no surface.

Historical free leaves and their exact declarations:

| Record | Paths | Origin / authority |
| --- | --- | --- |
| review token | `draft.changes[].fields[].label`; `draft.changes[].value` | external-text; each has a written §5.4 retention-only exception |
| projection outbox | `override.changes[].fields[].label`; `override.changes[].value` | external-text; each has a written §5.4 retention-only exception |

The `value` union's free-text arms are workflow/timeline labels; enum/policy/boolean arms
remain closed. Edit Data labels are also historical operator input. Historical label validation
accepts all seven universal credential/regulated sentinel strings while today's label schema
rejects them, as pinned by tests. Therefore neither repository-authored nor today's constrained
operator-authored origin is true here. **External-text** is the conservative existing category.
Ref operator-trust §5.4 already requires immutable v19 record validation/retention; the four
exceptions record that obligation only. They authorize no new write, projection, export,
current override interpretation, or old-command compatibility. The owning redaction contract
now states that accounting explicitly; no new origin, generic exception or admission policy.

### Explicit retirement / mapping

At `49c6206c`, Explorer GET embedded historical `ExplorerEditReadbackSchema` as `workflows[].edit`;
routes offered `/api/v1/explorer/reviews` and `/api/v1/explorer/apply`, and commands used family
`explorer-edit` with a review token and draft. The assigned merge already retired those doors.
Current GET and `/api/v1/explorer/validate`, validation/apply result schemas and file authority
use `explorer.ts`; the sole apply command is family `explorer`, `apply-explorer-edit`, with the
complete strict envelope. Current `commands` storage maps to that current `CommandRequestSchema`.
This audit does **not** assert that old command-envelope rows remain parse-compatible.

The removed historical exports are `ExplorerEditReviewRequestSchema`, `ExplorerEditApplyRequestSchema`,
`ExplorerCompiledEditSchema`, `ExplorerEditReviewConsumeRequestSchema`,
`ExplorerEditProjectionAckRequestSchema`, `ExplorerEditAuthorityFileSchema`,
`ExplorerEditApplyResultSchema`, and `ExplorerEditReadbackSchema`. Their active protocol/file
roles are retired or replaced by the current boundaries above, not newly registered historical
egress. Token repositories and the outbox projector remain removed. The only production import
of `domain/dashboard/explorer-edit.js` is `src/infra/sqlite/storage-records.ts`.

## Gate evidence

Raw focused outputs were handed back untracked and later archived byte-for-byte by the supervisor:
[red / mutation evidence](../evidence/dcc4-redaction-m3f-red.log.gz) and
[final focused green evidence](../evidence/dcc4-redaction-m3f-green.log.gz).
See the [archive manifest](../evidence/dcc4-evidence-manifest.md) for hashes and decompression.
Each includes command, workdir, HEAD, baseline index, exit and raw output.

| Check | Exit | Result |
| --- | --- | --- |
| New exact-schema regression before registration | 1 | 1 failed, 17 skipped |
| Existing leaf audit after registration, before dispositions | 1 | precisely 4 missing leaves; 1 failed, 17 skipped |
| New per-record origin regressions before dispositions | 1 | 2 failed, 18 skipped |
| Deliberately misclassify review `draft.changes[].value` as repository-authored, without exception | 1 | 1 failed, 1 passed, 18 skipped; mutation restored |
| Original minimized command after repair | 0 | 1 passed, 19 skipped; 1.81s |
| Full redaction file after mutation restoration | 0 | 20 passed; 1.76s |
| `migration-history-immutability.test.ts` | 0 | 2 passed; 0.128s |
| `explorer-edit-protocol.test.ts` | 0 | 19 passed; 0.209s |
| `workflow-editor-compile-integrity.test.ts` | 0 | 25 passed; 1.67s |
| `explorer-edit-service.test.ts` | 0 | 14 passed; 1.90s |
| `explorer-query.test.ts` | 0 | 17 passed; 1.25s |
| `explorer-override-store.test.ts` | 0 | 25 passed; 1.18s |
| `git diff --check` | 0 | no whitespace waiver |

Final full-file checks: **7 files / 122 tests passed**, sequential single-worker commands.
Every Vitest command uses `VITEST_MAX_WORKERS=1`, `--maxWorkers=1`, and the explicit legacy
guard-data path. One initial new-test name filter selected zero tests; the corrected filter
then demonstrated the two actual failures. A first non-test census invocation omitted the
legacy guard-data environment and failed loud; its corrected invocation produced the census
above. Neither unsuccessful diagnostic attempt counts as validation.

The per-record negative controls call `auditSurfaceOrigins`: each of four missing dispositions
and four missing exceptions yields exactly one named violation; moving either real schema to
durable-file, phone-scoped, process-egress or OS-notification yields refusal for both leaves
(16 leaf refusals). A written retention exception cannot override those refused origins.
The exact-origin mutation proves the regression catches a dishonest but generally admissible
repository-authored disposition. Schema identity tests reject substitute shapes.

## Preserved authority / remaining work

`git diff --exit-code dbd1b32cc6233fb9fdf6f7b577ab4be06098822f -- src tests/unit/architecture/migration-history-immutability.test.ts`
returned 0. All source blobs and migration-history test bytes are unchanged from assignment.
Migrations, authority registry and storage-record validation are also unchanged from HEAD.

| Preserved path | Assigned blob |
| --- | --- |
| `src/domain/dashboard/explorer-edit.ts` | `74171fac871367826b7f6c42aee5867eb49bdf41` |
| `src/domain/dashboard/explorer.ts` | `1fc67e67ee83463070e8dc4b851155d06c05f75c` |
| `src/infra/sqlite/migrations.ts` | `f8ba1cb024c0d7e2661a7a08e4933a418259a095` |
| `src/infra/sqlite/storage-records.ts` | `59fd2132bc17b965580a87005ed9a7f402966e24` |
| `src/domain/authority.ts` | `1b427523ccd20fbb575a589bb255f9af131db593` |
| `tests/unit/architecture/migration-history-immutability.test.ts` | `f193d25340dd49d6c2e1cd1fb32b60dc807c4299` |

Existing full coverage log SHA-256 remains
`192d2a098effb567ef5be9ad9d3ac3a3b0f79c7fbff590b85213a5c505261297`;
existing focused-red log SHA-256 remains
`c9bf9d98242ff3bcfe22da7323bedd5cf1ef03b9108abbada03a8fa27224b593`.
No active task-owned process, temporary mutation, debug instrumentation, new fixture file,
browser or live state remains. No commit or push. Stage only the four code/test/doc paths and
this report; leave all focused logs untracked as requested.

Supervisor still owes fresh locked lint/typecheck, any newly allocated heavy gate, and independent
Tests/Security/Standards/Correctness/Silent-failures reviews. The repository lint obligation is
not claimed green or waived: allocation explicitly reserves it for the supervisor after freeze.
Review focus: exact historical schema/storage identities, conservative external-text origin,
retention-only owner authority, and absence of revived protocol or broadened egress.
