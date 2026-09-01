# DCA4 A2 — exact archived capture resource authority

STATUS: Backend seam complete; pending parent acceptance/review and category commit. No backend implementation remains.

ROLE: `sup_sol_dca4_a2_exact_archive_resource` — sole execution writer, no scouts or nested agents.

MODEL / REASONING: Native `sup_sol`, high, as dispatched; focused `tdd` tests mode at the supplied query and route seams.

COMMITS: None; intentionally uncommitted under the required gate-before-commit ordering. Frozen-diff receive is not a gate waiver. No staging, pushes, resets, cleanups of inherited work, live authority access, or workflows. Original and final HEAD: `eda17b2708286e36542e1e18e9f8ef6a06cf3187`, branch `feature/dca4-archive-evidence`.

WORKTREE: `/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4`. Every command used this explicit workdir; all edited paths were absolute under it. Boards remained read-only. No frontend/fixture/parity changes were made by A2.

## Implementation / invariant

The exact frozen archive is the only metadata authority. Both resource and byte reads parse both caller ids before lookup; validate the repository result's strict schema, requested run identity and recomputed archive content digest; and refuse conflicting references before any byte open. Repeated bundle tiles for an artifact are admitted only when digest, byte length and media type all agree. Current runs, descriptors and the diagnostic attachment index are not consulted.

Resource status calls the existing DCA1 verify-only stream without retaining an assembled copy. Downloads independently materialize and verify an exact standalone buffer; an earlier available response does not authorize later missing/corrupt bytes. The ref is frozen before passing it to storage. The strict resource wire rejects URLs naming another host/path/run/artifact.

Resource states remain `available`, `missing` and `error`. No durable purge tombstone exists, so neither deadlines nor absent current index rows produce `purged`. Missing archive/tile metadata answers 404; unavailable composition 409; malformed caller ids 400. Corrupt/foreign archived authority answers non-retryable 500 `ARCHIVED_CAPTURE_CORRUPT`. Physical byte absence answers resource `missing`, byte-route 500 `ARCHIVED_CAPTURE_BYTES_MISSING`; failed byte verification answers resource `error`, byte-route 500 `ARCHIVED_CAPTURE_CORRUPT`. Safe messages preserve run/artifact ids and do not expose stored values or filesystem paths.

Successful downloads preserve frozen MIME and length, set an id-only attachment filename, `nosniff`, and `no-store`. Resource responses are no-store. Unsupported Range is 416 only after full verification. The capture Host refuses both routes before lookup using the ordinary not-found response.

## GATE — exact commands and evidence

All commands below ran in the worktree above. No coverage or parity command, including targeted parity, was run. Heavy gates remain parent/coordinator allocated.

| Command | Exit / evidence |
|---|---|
| `npm run test -- tests/unit/server/archive-capture-resource.test.ts tests/unit/server/archive-capture-routes.test.ts` | **0**; **2 files, 71 passed** (33 query/wire + 38 HTTP). Final restored-source run: 07:01:44, 2.25s. |
| `npm run test -- tests/unit/server/bff-flow.test.ts tests/unit/server/diagnostic-bundle-readback.test.ts tests/unit/archive-wire-model.test.ts` | **0**; **3 files, 50 passed**, 3.21s. |
| `npm run typecheck` | **2**, solely inherited `tests/parity/helpers/fixture-bff.ts(242,25)` TS2345: `Uint8Array<ArrayBufferLike>` not assignable to `BodyInit`. No A2 type errors remain. |
| `npm run lint` | **1**, solely inherited `tests/unit/dashboard/archive-detail-render.test.ts:30:15` and `tests/unit/dashboard/archive-render.test.ts:307:112`, both `@typescript-eslint/no-unnecessary-type-assertion`; **2 errors, 0 warnings**. |
| `npm run build:manifest` | **0**, wrote generated manifest. |
| `git diff --exit-code -- src/domain/workflow/generated-build-manifest.ts` | **0**, generated manifest unchanged. |
| `git diff --check` | **0**. |

### Red-capable proof

Before correction, the query suite produced **14 failed / 19 passed**: missing expected rejections for foreign identity, digest mismatch and conflicting duplicates; copying status bytes; and foreign URL acceptance. Route tests then exposed absent safe headers and untyped HTTP failures (a preliminary fixture FK defect was corrected by inserting the required test task, not by weakening authority).

After green, temporarily bypassing both physical verifiers (status verification removed; download buffer replaced with zeros) produced **18 failed / 53 passed** using the exact two-file acceptance command. Failures included missing/error promoted to available, wrong returned bytes, incomplete Range drain, and a lost download answering 200 rather than 500. Restoring the source returned **71/71 green**. Before/after restored query SHA-256 was identical: `ed9d6ee05c23d210d10403d05493cee99e09112e9b9d9ce15ec6f18845d4f387`.

HTTP cases use the real Hono handlers and a real temporary SQLite archive repository. Test task rows exist only to satisfy the archive FK; poisoned current-run/index/descriptor accessors demonstrate that the read path never consults them. Fault injection supplies wrong/malformed repository results or stream faults at system boundaries. No mocked query/handler/verifier stands in for the behavior tested.

## FILES — frozen patch identity for parent review

Tracked backend/doc patch SHA-256: `5d273caa52780898f7af96a5a5d58f34d3359636fef51f1c28068189ffc38728`.

Reproduce with `git diff --binary -- AGENTS.md docs/rebuild/reference/dashboard-surfaces.md docs/rebuild/reference/frontend-backend-integration.md src/domain/dashboard/archive.ts src/server/dashboard/queries/archive.ts src/server/dashboard/routes/api.ts | shasum -a 256`.

Untracked test diff hashes (`git diff --no-index -- /dev/null <path> | shasum -a 256`):

| Path | Diff SHA-256 |
|---|---|
| `tests/unit/server/archive-capture-resource.test.ts` (adopted interrupted test, expanded) | `ea924620114fa7f287cb5d7edecec291d2bc73525070d83a728519ee1ffdcb20` |
| `tests/unit/server/archive-capture-routes.test.ts` (new) | `999355e1565f801a28100c7d2eb479ee43c73063c5bbbe4768fbaed3e9567baa` |

Final content hashes:

| Path | SHA-256 |
|---|---|
| `AGENTS.md` | `ce11229cefd7b60ba35b9a9a2474d3206ad43111322bc59606e8482af4bc6280` |
| `docs/rebuild/reference/dashboard-surfaces.md` | `34d0faa318cb46bcf2c6bba0c64a2b0dfd77d138bfcb353e7240b5a3f55b7e5e` |
| `docs/rebuild/reference/frontend-backend-integration.md` | `c1e598d6178d5b0b62ae677703aab5b3f6725096bea74c064726d2bffde9876e` |
| `src/domain/dashboard/archive.ts` | `b17115ea5b2821471437df0773c84c47931167656002175d127c495707e5092c` |
| `src/server/dashboard/queries/archive.ts` | `ed9d6ee05c23d210d10403d05493cee99e09112e9b9d9ce15ec6f18845d4f387` |
| `src/server/dashboard/routes/api.ts` | `63d76a39600e5dcf7f45a5b51bc3bb57840de5e4b2b268257ee601d5cc15cddc` |
| `tests/unit/server/archive-capture-resource.test.ts` | `6853648c074d7f97eae16d83a7f04dccfef4b838ed5879b62e3c4a6d801d1907` |
| `tests/unit/server/archive-capture-routes.test.ts` | `f624b28882b316c062de3730cd61afc83a7f73259a23823555234e5a82908178` |

## Preserved inherited work

These seven tracked frontend/fixture/test paths were SHA-256 identical at intake and final check:

| Path | Unchanged SHA-256 |
|---|---|
| `src/dashboard/AGENTS.md` | `adc86c0ab09bae52444243269cbd9e14706ed7315d31187110b894e32c96d065` |
| `src/dashboard/client/queries.ts` | `cd7388d60f86f34490f6ac07eb2050954115bae9e8ed876b4bb40b52380a6749` |
| `src/dashboard/surfaces/archive-model.ts` | `08097087af95f58376a75d374d86ef97a452bfa2af486e73daa9b3b35aef1f9c` |
| `src/dashboard/surfaces/archive.tsx` | `1c7c1b0de139e74e64fd996e799f68fbdc93d1363cbab168b872a47e9c3d2886` |
| `tests/parity/helpers/fixture-bff.ts` | `aa48dee2e5f233ad11d6ecc184a4ef67278c369036d0c5a6ac71bc5c1fa05702` |
| `tests/unit/dashboard/archive-detail-render.test.ts` | `adad04b10036808d51479a9fbf89fc067fbac3ebed36d08d7444a43514d3678e` |
| `tests/unit/dashboard/archive-render.test.ts` | `8c1e4881d46d37c6a51eba2dd2aad9d47cf8d6e9811da1fadc5bf83a4c724b50` |

Existing untracked parity spec, snapshots, references, and other coordination files were untouched. This report is the only A2 coordination artifact; no board edits. The tree is intentionally dirty, not claimed clean.

REVIEW-HINT: Review the exact-id/digest gate before artifact open; repeated-reference agreement; wire URL refinement; verify-only status versus independently verified downloads; new safe archive-specific error mapping in `api.ts`; and zero-open refusal tests. The scoped contract update also corrects the stale claim that DCA1's diagnostic-index byte route is unserved; it does not close the generic gallery deferral or create retention policy.

NOTES: Parent reruns focused acceptance, then may transfer writing ownership to UI A3. A3 owns both inherited lint errors, the BodyInit typing issue, and broken images in the inherited parity screenshots. Parent/coordinator owns independent review, allocated full gates and category commits. A2 requires no additional backend action before that transfer.
