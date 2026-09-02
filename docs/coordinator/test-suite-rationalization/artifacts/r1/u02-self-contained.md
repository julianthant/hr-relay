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
Tests  63 passed (63)
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

## Follow-up provenance-integrity verification

Parent verification found that the initial snapshot had used `trimEnd()` while reading Git blobs: recorded SHA-1 ids referred to bytes ending in a newline, while frozen `text` omitted that newline. The package script map was also independent of its recorded package blob. This follow-up corrects both defects.

Every text-bearing frozen file now preserves exact UTF-8 Git bytes, including its terminal newline. The helper hashes `blob <byteLength>\0<exact UTF-8 bytes>` with SHA-1 and rejects a mismatch while parsing the whole provenance document. The 44 validated text-bearing entries are the 18 selector/catalog files, one runtime provider file, 24 canonical-field sources, and the legacy `package.json`.

`operationalIsolation.package` is now one ordinary frozen `{ path, blob, text }` file. The operational-isolation guard derives `scripts` by parsing that exact text only after blob integrity passes.

Focused red controls retain their recorded blob while changing frozen text:

```text
frozen legacy blob mismatch for src/systems/crm/SELECTORS.md: expected 5b928a9bd686727fb10700a61ac116138df7eb44; actual 9bbf201523ab234f34aeb597f5e03f19b55b8d21
frozen legacy blob mismatch for package.json: expected fd94ce86cef204cd40569f9b7728a2c5999ffc57; actual 68d91ff7581e31a5fcd6ce8579168af76a31723e
```

Green proof:

```text
text-bearing=44 blob-mismatches=0
Test Files  7 passed (7)
Tests  63 passed (63)

> hr-automation-rebuild@0.1.0 typecheck
> tsc --noEmit

> hr-automation-rebuild@0.1.0 lint
> eslint src tests scripts --max-warnings 0
```

The typecheck, lint, and `git diff --check` gates passed after this follow-up.
