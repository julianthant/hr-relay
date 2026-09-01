# DCA4 A2 — independent test-proof corrections

STATUS: Both test-proof findings verified repaired; accepted capability-precedence documentation finding repaired and pinned. Allocated light gate/probe work complete; ownership relinquished to parent.

ROLE: `sup_sol_dca4_a2_test_proof`. MODEL / REASONING: native `sup_sol`, high; `tdd` tests mode at the operator-confirmed HTTP seam.

WORKTREE: `/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4`. All shell commands used this explicit workdir and all edits used absolute paths beneath it. HEAD at intake remains `eda17b2708286e36542e1e18e9f8ef6a06cf3187`.

COMMITS: None; no staging. No lasting production changes, UI changes, other report edits, or board writes. Final changed paths in this follow-up are `tests/unit/server/archive-capture-routes.test.ts`, `docs/rebuild/reference/frontend-backend-integration.md`, and this report. The two explicitly authorized domain-schema mutations were run separately and each immediately restored, with hash evidence below.

## Changes

1. **Malformed repository result:** the injection signature now explicitly returns `unknown`. The test returns the malformed object directly, without calling `ArchivedRunRecordSchema.parse` inside the lookup. Its extra field must be rejected by production. Assertions retain HTTP 500 / `ARCHIVED_CAPTURE_CORRUPT`, non-retryability, safe redacted messages and zero byte opens; they additionally require the authority-verification message.
2. **Active MIME with valid digest:** a local `rawArchiveContentDigest` helper uses the archive's canonical JSON/hash envelope without archive-schema validation. The test first compares this helper against a valid writer-produced digest, changes only the tile MIME to `text/html`, recomputes the complete content digest, and injects the resulting raw record. The response must identify authority-verification failure, not content-digest mismatch, with zero byte opens. Artifact payload digest and length remain unchanged.

Those repairs replace the same two test declarations under both resource and byte routes (four expanded cases). Both are now independently red-capable, as proved below.

3. **Capability-before-id precedence:** four additional route cases cover malformed artifact and run ids on each route with no artifact-store capability composed. They require no-store HTTP 409 / `SECTION_UNAVAILABLE`, zero archive lookups and zero byte opens. The existing composed-capability cases still require malformed-input 400. The owning reference's prose and table now explicitly state this existing handler precedence; runtime behavior did not change.

## Exact hashes

| Artifact | SHA-256 |
|---|---|
| Test file before this repair | `f624b28882b316c062de3730cd61afc83a7f73259a23823555234e5a82908178` |
| Test file after proof repair, before precedence cases | `a456e08d764bc0d212db949ea008b5eec2f819a25cd4b26f1083b16f030aabdc` |
| Final test file | `e0d7d28094586d8adcebc5612820d5d3da8ccffb60badfca6b06a5eb55092a30` |
| Entire final untracked test-file patch versus `/dev/null` | `92702ed99b43102eb15736ad167645eda040a0a30b866c704efcca15c63cd443` |
| Final `docs/rebuild/reference/frontend-backend-integration.md` | `a5efeff5a72529c8c472c14c90ba1efdbbe314f3ec586360930f68adc3fbf1f7` |
| Owning reference's entire tracked diff from HEAD | `1d17f52c4f98f0a1b6552a87d12d44ed8d5516553ecddc7ec340a248576680a6` |

Patch reproduction: `git diff --no-index -- /dev/null tests/unit/server/archive-capture-routes.test.ts | shasum -a 256`.

Reference patch reproduction: `git diff --binary -- docs/rebuild/reference/frontend-backend-integration.md | shasum -a 256`.

Production hashes matched at intake, immediately after restoring each probe, and at final verification. The query was never edited in this follow-up. `git diff --exit-code -- src/domain/archive/model.ts src/domain/archive/sections.ts` returned 0 after the probes:

| Restored/unchanged production path | SHA-256 |
|---|---|
| `src/server/dashboard/queries/archive.ts` | `ed9d6ee05c23d210d10403d05493cee99e09112e9b9d9ce15ec6f18845d4f387` |
| `src/domain/archive/model.ts` | `3d9538fc1d5744d938816c30e30a58aa7d4e05c17499f950b6f311c8a3c54b6f` |
| `src/domain/archive/sections.ts` | `284d187e2d7fd6b1a80f55d34080d87300d71971f441ca5c4981937cf533c2ad` |

## GATE — sequential allocated evidence, 2026-08-30

Every command used the assigned absolute workdir. Gates and probes ran one at a time. Every Vitest invocation used `VITEST_MAX_WORKERS=1`. No full lint/typecheck, browser, build, roadmap regeneration, coverage, or parity command ran; parent owns those gates and the unrelated UI lint repair. No global lock was needed for a full lint/typecheck command because neither was invoked.

| Stage | Exact command | Exit / result |
|---|---|---|
| Baseline after test repairs | `VITEST_MAX_WORKERS=1 npm run test -- tests/unit/server/archive-capture-resource.test.ts tests/unit/server/archive-capture-routes.test.ts` | 0; **71 passed**, 2 files, 07:33:20, 2.44s |
| Unknown-field negative control | `VITEST_MAX_WORKERS=1 npm run test -- tests/unit/server/archive-capture-routes.test.ts` | 1; **2 failed / 36 passed**, 07:33:34, 2.25s |
| Active-MIME negative control | `VITEST_MAX_WORKERS=1 npm run test -- tests/unit/server/archive-capture-routes.test.ts` | 1; **2 failed / 36 passed**, 07:33:45, 2.17s |
| Both probes restored | `VITEST_MAX_WORKERS=1 npm run test -- tests/unit/server/archive-capture-resource.test.ts tests/unit/server/archive-capture-routes.test.ts` | 0; **71 passed**, 2 files, 07:33:53, 2.47s |
| Final, including precedence cases | `VITEST_MAX_WORKERS=1 npm run test -- tests/unit/server/archive-capture-resource.test.ts tests/unit/server/archive-capture-routes.test.ts` | 0; **75 passed** (33 query/wire + 42 route), 2 files, 07:34:09, 2.89s |
| Own-file lint | `./node_modules/.bin/eslint tests/unit/server/archive-capture-routes.test.ts --max-warnings 0` | 0; no diagnostics |
| Restored domain files | `git diff --exit-code -- src/domain/archive/model.ts src/domain/archive/sections.ts` | 0; no diff |
| Whitespace | `git diff --check` | 0 |

### Independent red controls

- **Unknown field:** temporarily changed only `ArchivedRunRecordSchema = z.strictObject(...)` to `z.object(...)` (strip unknown keys). Exactly the resource and bytes cases named `classifies a malformed stored row as server corruption, not invalid caller input` failed at the HTTP assertion: **`200 !== 500`**. The active-MIME cases still passed. Restored the schema immediately before running the second probe; all three production hashes matched.
- **Active MIME:** temporarily appended only `text/html` to `ArchivedCaptureTileSchema.mediaType`'s enum. Exactly the resource and bytes cases named `rejects an active document media type from a malformed repository result before byte open` failed at the HTTP assertion: **`200 !== 500`**. The unknown-field cases still passed. Digest checking and full byte verification remained active, proving a stale seal was not the rejection reason. Restored the enum immediately; all three production hashes matched, then all 71 pre-precedence tests passed.

Neither probe bypassed digest verification, byte verification, routes, or query logic. Neither leaves a permanent schema change or widened MIME permission.

SCOUTS: None.

INVARIANT: The real production boundary sees the malformed data; an unrelated stale digest cannot satisfy the media restriction's test. Missing capability retains the existing no-store 409 precedence over malformed ids.

REVIEW-HINT: Raw lookup injection and schema-independent resealing each now have a separately observed negative control. Parent may reconcile the two Tests findings and accepted Docs finding using this evidence; their owning review reports and boards were not edited here.

NOTES: Write and light gate/probe ownership returned to parent on delivery. No tests or other commands remain running. No additional edits or probes will occur without a new allocation. No commits; full gates and category commits remain parent-owned.
