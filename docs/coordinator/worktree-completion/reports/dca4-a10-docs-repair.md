# DCA4 A10.4D — docs drift repair

**Status:** complete, frozen, uncommitted; `sup_luna` writer released. HEAD remains `eda17b2708286e36542e1e18e9f8ef6a06cf3187`; index remains empty.

## Result

- `frontend-backend-integration.md:511-519,1304-1320` now distinguishes the three genuinely pending section arms from D292's independent async capture capability. It records verified diagnostic authority, the lazy mounted Receipt consumer and exact artifact-resource URL while retaining the unserved generic resource-status/gallery family and pending browser/full integration gates.
- `dashboard-surfaces.md:2937-2945,3983` no longer says captures can never be advertised or that no bytes are served. Captures remain Receipt content rather than a tab; the generic `ArtifactResourceWireSchema` status/gallery roadmap item remains open.
- `run-detail.ts:930` now says Archive's synchronous `buildRunDetail` freeze is independent of async capture verification, without falsely calling that descriptor-resolving projection descriptor-free.

## Identity and proof

| File | Before SHA256 | After SHA256 |
|---|---|---|
| `frontend-backend-integration.md` | `c8b78782…25aa` | `e82e8a43…3ccf` |
| `dashboard-surfaces.md` | `aece0a07…5fe6` | `49c2ee22…a8b7` |
| `run-detail.ts` | `d6c1022f…23d` | `d7573200…2b95` |

Isolated patch: `dca4-a10-docs-isolated.patch`, SHA256 `da4547ca…a01`; reverse-check 0. Removing line 930 from before/after source yields identical SHA256 `c3922442…446`, proving comment-only source change. Dirty-status hash stayed `a2599ccf…3734`; target `git diff --check` passed.

`npm run roadmap:check` exited 1 because `docs/roadmap/index.html` is stale. Per brief, no generation was run; parent owns final freshness. No tests, lint, typecheck, build, browser, coverage, parity, stage, commit, merge or dispatch ran.

Evidence: `evidence/dca4-a10-docs-{before,after}.json`.

## Matrix follow-up — 2026-08-30

Independent spec/docs re-review found the same stale D292 claim in the as-built matrix. Only
`frontend-backend-integration.md:981,985` changed: `context-evidence` remains declared-unserved,
while verified asynchronous captures are advertised and read by the mounted Receipt consumer
through exact `/artifacts/v1/:artifactId` resources. The rows explicitly retain the unserved
generic `ArtifactResourceWireSchema` status/gallery, browser acceptance, full integration gates
and D291 shared-byte verification cost.

Before candidate: 30 paths, `1fea7985…b0b24`; after: `2b961630…aa209`. Target SHA256
`e82e8a43…23ccf` → `571c6adf…156a7`; protected 1,840-path digest remained
`89aee037…01ca`. Follow-up isolated patch SHA256 `47b67ca2…88580`, reverse-check 0;
target `git diff --check` passed. The first repair's red `roadmap:check` history above is retained;
this follow-up did not regenerate or re-check the roadmap because the parent owns both.

Evidence: `evidence/dca4-a10-docs-matrix-{before,after}.json` and
`evidence/dca4-a10-docs-matrix-isolated.patch`. Writer released again. No other gate or mutation ran.
