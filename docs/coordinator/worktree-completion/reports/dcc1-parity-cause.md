# DCC1 ae007 — parity cause receive and bounded capture proposal

2026-08-30. **Read-only diagnosis complete; parity remains RED. No capture, instrumentation,
reference update, repair, further gate, or commit is authorized.** Heavy slot was released at
17:43:30.417Z; scheduling belongs to the coordinator.

## Received evidence and limits

Native `sup_sol` unit `01a052fa-e2fc-7a32-81d0-23814d305b56` was reused under `/supervise`,
`/ui` and `/hr-debug`, high reasoning, 240k/220k. It performed only saved-output/source/history
analysis, including a read-only pure fingerprint-helper evaluation. No browser or gate was run.

- [Full gate receipt](dcc1-ae007-full-gates.md), [parent receive](dcc1-ae007-parent-receive.md):
  coverage6021 gate0/logger0,335files/3806tests; parity15690 gate1/logger0,227passed/12failed.
- [Complete received matrix, full source arrays and native narratives](../evidence/dcc1-parity-cause-received.json)
  is parent-persisted structured tool return, **not raw process output**. It is 53,758 bytes,
  SHA256 `697f30083dd2f67b3a729ee591d46e8bc82d096af6aaf569b7b8b78cdbedceac`.
- All twelve error contexts have only Instructions/Test info/Error details/Test source. There
  are no full actual trees, actual metadata files, or failed Explorer PNGs. The retained fifteen
  parity outputs comprise these twelve contexts, `.last-run.json`, and two unrelated observed-log
  PNGs. No full-snapshot equality or visual pass can be inferred.
- Parent `a3e75e` exit0 independently checked all48 matrix file hashes/sizes/modes, twelve exact
  named reported hunks, and the missing snapshot sections. Each Error details section reports
  one changed line with no suppression marker. The phrase in a test-source excerpt was an
  initial broad-scan false positive, corrected by section-scoped extraction.
- The immutable parity raw log remains75,758bytes/SHA256
  `71ed0d442bf83354f447128b48b7006c4bfcac298c022357f908e55453218300`.

| Theme | Viewport | explorer-graph | explorer-transaction |
| --- | --- | --- | --- |
| graphite-warm | 1280x720 | H1 | H2 |
| paper-ink | 1280x720 | H1 | H2 |
| graphite-warm | 1440x900 | H1 | H2 |
| paper-ink | 1440x900 | H1 | H2 |
| graphite-warm | narrow-1024x768 | H1 | H2 |
| paper-ink | narrow-1024x768 | H1 | H2 |

H1: reported line150, `ucpath/search-person-org`, `fe99beff4f72 → 843937a26347`.
H2: reported line143, `ucpath/read-job-summary`, `692804fed6ae → 847db5229dea`.
Only those fingerprints differ **within the reported lines**. Diagnostic reference/actual
duplication is not evidence of duplicate rendered rows. Complete before/after strings and all
48 file paths/digests are in the received JSON; absent actual files are explicitly marked.

## Exact cause of the reported differences

The fixture serves the real Explorer projection over `WORKFLOW_MODULES`, not literal task hashes:
`fixture-bff.ts:203` → `fixture-explorer.ts:33` → `tests/fixtures/explorer-seams.ts:36` →
`src/server/dashboard/queries/explorer.ts:185` → `explorer.tsx:1093–1100` (first12 hash characters).
The UI, fixture, capture/comparison helpers, bundle helper and spec remain baseline-identical.

`src/infra/build/workflow-build-manifest.ts:58–133` hashes canonical JSON containing the fixed
kind/version, installed TypeScript5.9.3/Zod4.4.3, task ID and sorted repo-relative path/raw-source
SHA256 pairs. Whole files and type-only import edges are intentionally included; timestamps,
absolute paths and the generated manifest itself are excluded. Both task closures reach Settings
through task implementation → `base/task.ts` → type `base/providers.ts` → type
`domain/provider-admission.ts` → value `ProviderBudgetSchema` import from `config/schema.ts`.
ProviderBudgetSchema itself did not change; the entire schema file is hashed.

| Task | Sources | Baseline fingerprint | Frozen/current fingerprint |
| --- | --- | --- | --- |
| ucpath/search-person-org | 50 | `fe99beff4f72f671ed7aca0a258426ce9ce13ba72e6288e87b2c7f37da4637db` | `843937a26347631c12d20fc40af902154380c6252b88861379cc275d8b8ed2ac` |
| ucpath/read-job-summary | 51 | `692804fed6ae5369ad477a04846c59dbed7fbdaec66720b9858e76796a4753c5` | `847db5229deae8b2f599da281b597546e72836f3c026aa709e7ff344d4640c0b` |

Parent `fa8ffb` exit0 independently rehashed every current and baseline source byte, canonicalized
the exact fingerprint object, reproduced all four complete hashes and found no added/removed
closure path. **Only `src/domain/config/schema.ts` differs from baseline13175 in either closure.**
Its SHA256 changes `18d2f166a244c69bd3e831716b441857b999813668071bf16002976c5f545e13` →
`2560b002d9c4d1f2b2f29dd71578583d9c42eb5569f95dab0045514dc8b86923`.

The baseline-to-candidate schema delta includes the retained alternate closed editable schema
(origin `bffb2ccbe8c1896eb42c84e6e2bb35886ed9886a`) **plus** M3's six lines/four approved leaves:
reportsDir, pageConcurrency, maxValidationRetries and defaultWorkers. It is not merely a six-line
delta against baseline13175. M2 accepted map and [M3](dcc1-m3.md) own this reconciliation; the
broader resolver/defaults and task implementations did not change. The schema already matched at
historical0b5 and is not an F8b change. M3 remains an uncommitted pending merge, not a new commit.

Parent `0f8514` read the import chain and independently blamed both representative reference
lines to `17a11a6cf20e7786ba51388a09ca825f612e9a82` (2026-08-28). Native trace covers all twelve.
Parent `fa8ffb` verified all36 reference a11y/meta/PNG bytes equal both baseline13175 and frozenae007.
Reference metadata `capturedAt: 2026-08-03` is the synthetic FIXTURE_DAY (`spec:512`), not capture
wall time. The descriptor metadata hash does not pin the task implementation closure.

Ranked diagnosis: reviewed source-closure movement explains the **reported** hashes. Stale bundle
or untracked/nondeterministic hash inputs are unsupported for these hashes: full postflight pins
600 bundle inputs/91 outputs and the correct stamp. Native read-only receipt80b31c rechecked792
retained files. Additional semantic or visual drift remains unresolved because actual captures
are absent; no blanket fingerprint-drift waiver follows.

## Smallest proposed next action — approval and allocation required

Request ONE observation-only diagnostic run for exactly the twelve matrix cases, not a reference
refresh or full parity retry. A plain rerun would reproduce the retention gap. Proposed temporary
scope: **only `tests/parity/helpers/capture.ts`**, with a reviewed exact patch retained separately;
no production/source/hash algorithm, public interface, assertion, threshold, wait or reference
change. The current restoration blob is `641378037d2396a6e84003115a5f158f178e17c7`.

1. Re-pin full candidate, installed graph/browser, all reference triples and existing outputs.
   Keep original `.output` untouched by using a new, exclusive Playwright output directory.
   Preserve exact current bundle-stamp bytes before the legitimate test helper replaces the stamp;
   retain all original raw/meta logs and the existing600/91 inventory. No cleanup or overwrite.
2. Temporary observer admits only the twelve exact capture names. After the existing single
   `ariaSnapshot()` returns, persist that **same tree string**, exact metadata serialization and
   rendered reference-format a11y to exclusive new diagnostic files BEFORE the original assertion.
   Record process/case times separately from synthetic metadata. No second-tree substitution,
   silent write fallback, snapshot normalization or authority seeding.
3. Keep `assertOrUpdateParityReference` unchanged. At `captureParityPair`, catch its refusal only
   to retain a full viewport diagnostic PNG with the existing animation policy, record that the
   image is a later post-refusal observation (not the original passing screenshot assertion), and
   rethrow the SAME error. On observation failure, preserve the original error first and surface
   the observation failure too. Never continue into or claim a passing screenshot comparison.
4. Proposed command, **NOT RUN**, only after explicit heavy OPEN and exact observer receive:

```sh
/usr/bin/lockf -k -t 0 /tmp/hr-dashboard-full-gate.lock env -u PARITY_UPDATE HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npm run test:parity -- tests/parity/dashboard-reference.spec.ts --grep 'explorer-(graph|transaction)$' --output=tests/parity/.output/dcc1-explorer-diagnostic-01
```

   Confirm selection is exactly12, no retries. Persist direct raw bytes before transport plus
   separate actual gate/logger exits, start/end, per-case artifact size/hash and before/after
   build/reference identities in a new named evidence set outside runner-cleaned directories.
   Existing full-run evidence must survive. Busy75 is scheduling, not a pass or retry license.
5. Release heavy ownership immediately on command terminal, BEFORE image/report polish. Restore
   only the reviewed observation patch with apply_patch; hash-check exact capture blob and entire
   executable closured681, indexae007, original source/ref/output hashes. Any unexpected input drift
   stops for scope decision. Record both instrumented identity and restored identity; do not claim
   this diagnostic ran against an unmodified closure. Request/perform separately authorized serial
   locked lint under the single light lane; do not implicitly reserve more browser work.
6. Independently compare all twelve complete captured trees/headers and metadata against the
   original references, enumerate EVERY delta without masking, and visually inspect every diagnostic
   PNG beside its exact reference. Diagnostic images are not a passed Playwright pixel assertion.
   Only if all differences are attributable and accepted should a later proposal request one
   scoped twelve-case paired update plus asserted verification. Any extra delta returns for
   disposition. No manual hash text replacement, full-corpus refresh, or current update approval.

The observer's artifact directory must be new and no-overwrite; the concrete proposed run suffix
must be checked absent before installation/run. Temporary observer review/restore, raw persistence,
lint and scheduling are requested together; none has started. Capture names are the twelve matrix
`name` fields, not an open-ended glob. Existing `reference-store.ts`, package/config and references
remain byte-identical throughout the diagnostic.

Owning constraints: ref frontend-backend-integration §7.1/D132 requires deliberately paired
reference updates and assertions; D187 requires visual proof alongside semantic proof. These are
why `/ui` and `/hr-debug` produce a capture proposal, not an automatic refresh or a parity waiver.

## Identity and remaining authority

Parent `ee77f2`/`fa8ffb`: HEAD `0c115123a738f62cbe01c9b45f53b7289284479c`, ordered MERGE_HEAD
`13175b13340fec7b5326207fe54f98078d481d7d`, complete index
`ae00723e05d20a6c87d0ada500fc77a456870ea9`, execution closure
`d681c0c5a4d7e2764d40f231e1f5f3650a838b044264a5a37077235de1f18051`; no unresolved entries.
Only parent coordination evidence/reports are changed outside that index. No stage/commit.

Migration-history disposition and D75 remain coordinator-owned/open. All40 archived plaintext
originals remain untouched until gated committed-archive durability is independently verified.
No board write-back, source-tree removal, authority access, reference update or heavy reservation.
