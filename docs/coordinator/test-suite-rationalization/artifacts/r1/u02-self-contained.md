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

`config/ports/legacy-architecture-provenance.json` is an in-repo, schema-validated provenance
snapshot. It preserves the exact legacy source-blob identities while authenticating redacted source
text separately. It contains:

| Invariant | Frozen source |
| --- | --- |
| Selector ports | 18 selector/catalog source-blob records at `793abe1f8265f3213ffe8a80d6cfd9860a32a1dc`; selector source lines are re-derived from authenticated redacted text. |
| Runtime dependencies | 87 `src/systems` source paths and the `provider-limits.ts` source-blob record at `9d19e4141d57617e2bf895e21e34a5bd8f15047c`. |
| Capability disposition | 78 discovered capability paths and 79 exact source/evidence paths at `9d19e4141d57617e2bf895e21e34a5bd8f15047c`. |
| Legacy tests | 518 baseline files at `353739ac9e1db01cae9da8a13da53605cd767574` and 534 current files at `9d19e4141d57617e2bf895e21e34a5bd8f15047c`. |
| Canonical-field scan | 24 authenticated redacted source/source-blob records at the resolved `4deabc5a` commit. |
| Operational isolation | Legacy `package.json` script map and source-blob identity at `9d19e4141d57617e2bf895e21e34a5bd8f15047c`. |

The shared helper parses the closed schema and fails loud for malformed commits/blobs and missing selector source files. The provenance-owner test is the single generic parser oracle; it owns malformed generated-path records, ordering, duplicate entries, and every named snapshot's drop-entry control, while consumer guards retain only their distinct behavioral assertions.

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

## Follow-up 2 — authenticated generated path inventories

**High finding repaired:** six frozen legacy path inventories were arrays checked only for nonempty/unique shape. Removing an entry could therefore weaken a guard while leaving all frozen file-blob checks green.

Each path list is now one named generated text snapshot: `name`, exact source command, `contentAddress`, and `text`. These are deliberately not called Git blobs: the commands produce inventories rather than objects reachable from a legacy commit. The surrounding legacy commit remains the source revision; `contentAddress` is the SHA-256 of the snapshot's exact UTF-8 bytes.

| Snapshot | Source revision and collection command |
| --- | --- |
| Browser-system paths (87) | `9d19e4141d57617e2bf895e21e34a5bd8f15047c`; `git ls-tree -r --name-only <commit> -- src/systems` |
| Capability discovered/source paths (78 each) | `9d19e4141d57617e2bf895e21e34a5bd8f15047c`; `jq -r '[.entries[].sourcePaths[]] | sort[]' config/legacy-capabilities.json` |
| Capability evidence paths (79) | `9d19e4141d57617e2bf895e21e34a5bd8f15047c`; `jq -r '[.entries[].sourcePaths[], "src/services/timecard/index.ts"] | sort[]' config/legacy-capabilities.json` |
| Legacy-test baseline (518) | `353739ac9e1db01cae9da8a13da53605cd767574`; `git ls-tree -r --name-only <commit> -- tests | grep -v '^tests/rebuild/'` |
| Legacy-test current (534) | `9d19e4141d57617e2bf895e21e34a5bd8f15047c`; same test-tree command |

`frozenLegacyPaths` authenticates the content address before returning paths, then rejects missing final newlines, empty/malformed records, duplicates, and non-lexical order. Runtime-dependency, capability-disposition, and legacy-test-disposition guards consume only that parser.

The mapped surviving control is `legacy-selector-port-provenance.test.ts`: its table drives all six named snapshots. With a path dropped while the recorded digest remains unchanged, each fails red with the named `content-address mismatch`; separate authenticated fixtures prove malformed, unordered, duplicate, and missing-final-newline text also fails. The former identical consumer-level duplicate-path assertions were removed.

Representative red output (dropping the first browser-system entry without changing its recorded address):

```text
frozen legacy path snapshot content-address mismatch for legacy-browser-system-files:
expected sha256:d0a90aa07b59e544a0f766dc6b3b4181a55ee287302410b9870e6f7aef50e808;
actual sha256:b747115cb3ab92e175949a0a4f3c6f1df8208240594a687362669d173121e901
```

Focused green proof under a deliberately nonexistent legacy checkout:

```text
HRAUTO_LEGACY_REPO=/definitely/nonexistent/hr-automation npm run test:architecture -- \
  tests/unit/architecture/legacy-selector-port-provenance.test.ts \
  tests/unit/architecture/runtime-dependency-coverage.test.ts \
  tests/unit/architecture/legacy-capability-disposition.test.ts \
  tests/unit/architecture/legacy-test-disposition.test.ts

Test Files  4 passed (4)
Tests  39 passed (39)
```

The source commands reproduced all six recorded content addresses (`87/78/78/79/518/534` paths). `npm run typecheck`, `npm run lint`, and `git diff --check` passed.

## Follow-up 3 — identifier-safe source evidence

The exact-byte follow-up above authenticated Git blobs correctly but also copied direct
identifier-shaped values from historical source comments/examples into the new evidence file. The
final schema therefore separates provenance from consumable evidence: `sourceBlob` retains the
original Git object identity, while `contentAddress` authenticates source text after the declared
`zero-direct-identifiers-v1` transform. Newline count and selector definition line positions remain
unchanged. A code-owned SHA-256 of the complete parsed payload prevents an editor from changing
text and recomputing its adjacent digest.

The security negative control first failed on the unsanitized evidence. The final focused run proves
the checked-in JSON has no SSN- or UCSD EID-shaped literal, rejects changed text with its recorded
content address, and rejects changed text even when its local content address is recomputed.

```text
Test Files  2 passed (2)
Tests  24 passed (24)
```
