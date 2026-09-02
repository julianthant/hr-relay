# R1 / U02 — self-contained architecture provenance

## Before-red

Command:

```text
HRAUTO_LEGACY_REPO=/definitely/nonexistent/hr-automation npm run test:architecture
```

Exact failure excerpts before this unit:

```text
Failed Suites 49
Error: Legacy repository not found at /definitely/nonexistent/hr-automation (HRAUTO_LEGACY_REPO). The rebuild's D90 change accounting, D58 capability disposition, and environment/runtime-dependency inventories all audit the legacy repo; set HRAUTO_LEGACY_REPO to its checkout.
```

The eager `LEGACY_REPO_ROOT` module initializer made every architecture import depend on the external checkout, including guards that never read legacy facts.

## Frozen provenance

`config/ports/legacy-architecture-provenance.json` is an exact in-repo, schema-validated source snapshot. It contains:

| Invariant | Frozen source |
| --- | --- |
| Selector ports | 18 selector/catalog text blobs at `793abe1f8265f3213ffe8a80d6cfd9860a32a1dc`; every recorded SHA-1 and source line is re-derived. |
| Runtime dependencies | 87 `src/systems` source paths and the `provider-limits.ts` text/blob at `9d19e4141d57617e2bf895e21e34a5bd8f15047c`. |
| Capability disposition | 78 discovered capability paths and 79 exact source/evidence paths at `9d19e4141d57617e2bf895e21e34a5bd8f15047c`. |
| Legacy tests | 518 baseline files at `353739ac9e1db01cae9da8a13da53605cd767574` and 534 current files at `9d19e4141d57617e2bf895e21e34a5bd8f15047c`. |
| Canonical-field scan | 24 source text/blob records at the resolved `4deabc5a` commit. |
| Operational isolation | Legacy `package.json` script map and blob at `9d19e4141d57617e2bf895e21e34a5bd8f15047c`. |

The shared helper parses the closed schema and fails loud for duplicate paths, malformed commits/blobs, and missing selector source files. Focused negative controls prove missing selector source, malformed commit, and duplicate frozen test/runtime/capability paths all fail.

## After gates

Focused command under the nonexistent override:

```text
Test Files  7 passed (7)
Tests  62 passed (62)
```

Collection under the same override completed (all architecture files listed); the finished guards contain no `HRAUTO_LEGACY_REPO`, external legacy path, `LEGACY_REPO_ROOT`, or external-repository git reader.

```text
npm run typecheck
> tsc --noEmit

npm run lint
> eslint src tests scripts --max-warnings 0
```

Both passed. `git diff --check` passed.

The complete missing-path architecture command reached all 70 test files and failed only in pre-existing/unrelated dashboard browser observation tests:

```text
Test Files  1 failed | 69 passed (70)
Tests  45 failed | 648 passed (693)
Invalid hook call. Hooks can only be called inside of the body of a function component.
```

No failure mentions a legacy checkout. `npm run test:coverage` reproduced the same unrelated invalid-hook-call failure family and was interrupted after diagnosis (exit 130); it is not a passing gate.

## Residue

No remaining architecture execution reader reaches the external checkout. `HRAUTO_LEGACY_REPO` remains as historical/test-only registry vocabulary in `src/domain/runtime-environment.ts`; it is no longer read by an architecture guard.
