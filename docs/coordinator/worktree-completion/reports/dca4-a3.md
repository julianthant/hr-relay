# DCA4 A3 — Archive evidence viewer

## Status

**Partial / awaiting gate release.** The UI implementation is frozen for receipt: no commit has been
made, and this worker will make no further edits under the resource hold. Backend/domain/root-AGENTS/
reference-contract paths remain untouched after A2 closed.

## UI seam delivered

- `src/dashboard/client/queries.ts` now passes an exact archive-capture read's `AbortSignal` to the
  existing typed transport.
- `archive-model.ts` binds resource state to `(runId, artifactId, viewerEpoch)`, aborts on walk or
  close, rejects foreign response ids and an injected foreign download path, and never renders an
  old resource during a different capture's pre-effect frame.
- `archive.tsx` preserves frozen facts in every state; renders `available`, `missing`, verification
  error, request failure, and non-image download-only paths; delays its positive image caption until
  browser load + `decode()` + positive dimensions; and makes post-metadata image failures visible.
  The existing capture footer wraps at phone width while retaining the established DS primitives and
  coarse-pointer 44px controls.
- A dedicated `fixture-archive-evidence.ts` makes a real 1440×900 PNG, then derives the served tile's
  digest and byte length from those exact bytes. It replaces the prior first-map-entry substitute only
  on the archive-evidence fixture route. Its `ArrayBuffer` body conversion resolves the inherited
  `BodyInit` type error without an assertion.

## Proof prepared

Unit coverage pins load/decode gating, image failure, missing/corrupt/request-failure metadata,
non-image download-only behavior, next/close/reopen abort and stale rejection, same-URL reopen image
state, injected foreign URL refusal, transport signal forwarding, and fixture bytes/headers.
The parity spec now waits for image decode, asserts natural dimensions and the exact URL, and reads the
download bytes before capture. It has not run: the original broken PNGs remain unmodified under the
spec snapshot directory pending the allocated parity refresh, then must receive an explicit disposition.

## Gates and review

Passed before the coordinator resource hold (before the final client-only signal test and product
callback forwarding were added):

| Command | Result |
| --- | --- |
| `npm run test -- archive-render archive-detail-render archive-evidence-fixture archive-view-model` | 4 files, 51 tests passed |
| `npm run typecheck` | passed |
| `npm run lint` | passed |
| `npm run web:build` | passed; chunk-size warning only |

An isolated fixture-server attempt correctly refused the unstamped ordinary build; no browser or parity
runner ran. The later five-file focused command was stopped by this unit's 45-second watchdog during
external contention, not accepted as a gate result. No own browser or command session remains active.
Under the coordinator hold, the frozen diff is received **without final focused proof**. The parent must
run these exact remaining gates after release:

1. `VITEST_MAX_WORKERS=1 npm run test -- tests/unit/dashboard/archive-render.test.ts tests/unit/dashboard/archive-detail-render.test.ts tests/unit/dashboard/archive-evidence-fixture.test.ts tests/unit/dashboard/archive-capture-resource-client.test.ts tests/unit/dashboard/archive-view-model.test.ts`
2. `npm run typecheck`
3. `npm run lint`
4. Allocated parity update/assertion and rendered review.

`git diff --check` passed during frozen UI review. No product-contract change is expected.

## Frozen-diff receipt

Owned implementation paths frozen for handoff: `src/dashboard/AGENTS.md`,
`src/dashboard/client/queries.ts`, `src/dashboard/surfaces/archive-model.ts`,
`src/dashboard/surfaces/archive.tsx`, `tests/unit/dashboard/archive-render.test.ts`,
`tests/unit/dashboard/archive-detail-render.test.ts`,
`tests/unit/dashboard/archive-evidence-fixture.test.ts`,
`tests/unit/dashboard/archive-capture-resource-client.test.ts`,
`tests/parity/helpers/fixture-archive-evidence.ts`, `tests/parity/helpers/fixture-bff.ts`, and
`tests/parity/archive-evidence.spec.ts`. The untracked parity references and inherited broken snapshot
PNGs are intentionally not accepted proof and are left untouched for the allocated parity lane.
