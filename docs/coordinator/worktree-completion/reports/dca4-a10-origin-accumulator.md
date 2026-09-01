# DCA4 A10.4P — origin accumulator

**STATUS:** complete, frozen, uncommitted; writer/light lane released.  
**ROLE/MODEL:** `sup_sol`, native Sol/high, 240k/220k.  
**HEAD/INDEX:** `eda17b2708286e36542e1e18e9f8ef6a06cf3187`; index empty.

## Result

`verifyRunCaptures` now accumulates origins with request-local mutable arrays and `push`, preserving deterministic bundle order without copying every prior origin per membership. After all existing run-index, exact durable row/digest/manifest/index/byte verification and complete metadata conflict checks, each artifact is projected once through `RunCaptureArtifactWireSchema.parse` and recursively frozen. No cache, cap, cross-request state, public interface, reader, byte, route, adapter, materializer, selected-pass, or DCA2 change.

A real SQLite/public-query regression inserts 12 same-run bundles sharing one artifact and independently asserts all 12 ordered `(bundleId, originKind)` tuples exactly once.

## Files

- `src/server/dashboard/queries/run-detail.ts` — SHA256 `d6c1022f605dfb4a0f4c89879bb6c36bf18531e17bc8232bcc0978d64130323d`
- `tests/unit/server/run-detail-captures.test.ts` — `38d96fe5faae6c8f236d95fa44982ad4c0cf95598bb2245446054b52315a92cd`
- `AGENTS.md` — `3d2a69a55b0affca28102c3012c1c29169b12068be54830c26b4820e7772497a`

[Isolated delta](/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4/docs/coordinator/worktree-completion/evidence/dca4-a10-origin-accumulator-delta.patch): SHA256 `24a006e50075a29ee7622c95a870f973006dc546b5480275e50ec54ef4839838`.

## Proof

- Query: 29/29 green before and after refactor.
- Overwrite control: 2 failed/27 passed, detecting dropped 2-origin and 12-origin memberships; exact three-file restoration passed.
- Focused query/wire/BFF/strict-boundary: 73/73.
- Globally locked typecheck and lint: exit 0.
- Source-shape check and reverse-patch/diff checks: exit 0.
- All 1,867 protected paths unchanged; digest `96c9b21734c487b9927f2fe2616f789c2ddb069324a0dfc55f46d1cc68b4f7ce`; all post-F/T pins match.

[Gate receipts](/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4/docs/coordinator/worktree-completion/evidence/dca4-a10-origin-accumulator-gate-receipts.json) record exact commands, logs, sessions, chunks, and exits.

**OPEN DCA2 D291 residue:** N×S repeated shared-artifact byte verification remains medium finding `4e95bb66`; this repair does not claim measured allocation/latency or joined/full acceptance. No heavy gates run.
