# dcr-q3 — partial gate and UI verification

Status: **PARTIAL / COVERAGE RED — PREREQUISITE** (2026-08-30). The explicitly released heavy slot was used for one coverage run, which exited 1. Heavy work is stopped; the coordinator can release the logical slot. This is not a release handback.

## Target and scope

- Assigned product head: `6d1e3ca89714e13ea7bbb440d27957301ffc6ca6`.
- Actual coverage execution and post-run HEAD: `c39d5f5fa4cd8ef3f0e7bef9a73b389863cf862e`, branch `codex/r-dcr-authority-close`.
- Post-run `git diff --quiet 6d1e3ca89714e13ea7bbb440d27957301ffc6ca6 -- src tests scripts config package.json package-lock.json` exited `0`: product paths are unchanged from the assigned product head.
- No source, test, reference, migration, or authority edits were made by Q3. Owned artifacts are this report and `evidence/dcr-q3/` only.

## Light checks completed

| Check | Result | Evidence |
| --- | --- | --- |
| Build-manifest freshness | PASS, exit 0; generated manifest had no diff | `evidence/dcr-q3/build-manifest.log` |
| Roadmap freshness | PASS, exit 0 | `evidence/dcr-q3/roadmap-check.log` |
| Diff whitespace | PASS, exit 0 | `evidence/dcr-q3/diff-check.log` |
| UI layout scan | PASS, exit 0; `[]` | `evidence/dcr-q3/ui-layout-detector.log` |
| UI source/fixture/reference audit | PASS, 0 findings | `evidence/dcr-q3/ui-source-audit.log` |

Each recorded light command ran at product head `6d1e3ca8`; the later commits through `c39d5f5f` are docs-only and leave all checked product paths byte-identical. These are retained light results, not reruns at the resumed HEAD.

## UI route — Operate/review

Stack: React 19.2.8, Vite 8.2.2, Tailwind 4.2.2, Lucide 1.8.0; no `components.json`, so shadcn rules do not apply. WIG was fetched live. Reviewed: `activity.tsx`, `activity-model.ts`, `receipt.tsx`, `receipt-model.ts`, `day-search.tsx`, and `day-search-model.ts` with the target fixtures and parity reference metadata/a11y snapshots.

- Activity unavailable is explicitly anchored to “Distinct people unavailable” and its mixed-key-generation reason; no zero substitution.
- Receipt comparison keeps ready/protected and typed-refused arms distinct; refusal renders an alert and protected detail remains withheld.
- Cross-date search keeps authority refusal/no-local-substitution and empty-result states explicit.
- The parity suite registers 18 target captures: 3 states × 3 viewports × 2 themes. PNG inspection is deferred until the project parity assertion passes; no snapshot was re-frozen.

Parent-session evidence (not rerun by Q3): typecheck exit 0; lint exit 0; focused reporting suite 8 files/63 passed (Vitest 4.1.10, 12.57s); migration/D75 focused suite 2 files/4 passed, 27 filtered (2.59s).

## Released coverage gate — exact result

The coordinator explicitly opened DCR's heavy slot after R2 parity passed. One command ran from `/Users/julianhein/.codex/worktrees/3646/hr-automation-rebuild` at the HEAD above:

```sh
/usr/bin/lockf -k -t 0 /tmp/hr-dashboard-full-gate.lock env HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npm run test:coverage
```

| Evidence | Result |
| --- | --- |
| Complete command output | `evidence/dcr-q3/coverage-c39d5f5f.log` (162 lines, 18,317 bytes) |
| Start / end UTC | `2026-08-30T14:29:07Z` / `2026-08-30T14:34:38Z` |
| Process / exit | Tool session `91045` completed; exit **1** |
| Vitest | 4.1.10; duration 330.76s |
| Files | 352 passed, 1 failed; 353 total |
| Tests | 3,829 passed, 2 failed; 3,831 total |
| Coverage thresholds / suite-size | Not established; no final coverage metrics printed, and the `&& tsx scripts/suite-size.ts` step did not execute |
| Parity / asserted PNG judgment | Not run; no rendered-proof claim |

Both failures are in `tests/unit/dry-run-scenario-composition.test.ts`, describe `dry-run scenario production composition boundary`:

1. `composes both worker drains and the real gate command through terminal receipt evidence` — first drain at line 362.
2. `derives transaction reach and EID-safe failure evidence from every durable worker sink` — first drain at line 436.

Both report `SecretFileError: duoWebauthnCredential is unavailable at the registered rebuild credential path`, caused by ENOENT while statting `/Users/julianhein/.codex/worktrees/3646/hr-automation-rebuild/.auth/duo-webauthn.json`.

The exact stack crosses `src/server/dry-run-scenario/runtime.ts:159` → `src/server/worker/compose.ts:504` → `src/core/duo-ceremony-gate.ts:380` / `:364` → `src/domain/secrets.ts:508` / `:452`. Read-only inspection confirms both tests inject deterministic session factories and `env: {}`, but the runtime still composes the production Duo ceremony gate. Its enabled-by-default WebAuthn identity resolution requires the registered credential file before either test's first worker drain completes. The identity parser uses public `rpId` and `credentialId` fields, suggesting a hermetic synthetic test prerequisite may be possible; **no such fixture was created or validated**, and no repair is authorized in Q3. Real credentials must not be linked or copied here.

## Stop boundary, resources, and continuation

- The coverage command and lock holder exited. The parent was signaled immediately after the final result so the logical slot can be released. No retry, parity, dependency provisioning, or browser runtime was started afterward.
- No `.env`, credential contents, live authority, or HR workflow was accessed. The failing gate attempted only the missing credential-file stat. No foreign processes or browser sessions were closed; Q3 created no parity/browser session needing cleanup.
- No source, tests, migrations, reference snapshots, assertions, timeouts, or thresholds changed. Parent-owned pending edits to `reports/dcr.md` remain untouched. The closed board blob remains `5c3d196b547553265d15c30f694bea48801634a0`.
- Post-coverage product equality and `git diff --check` both exited 0; exact commands, HEAD, status, board blob, and coverage-log SHA-256 are recorded in `evidence/dcr-q3/post-coverage-state-c39d5f5f.log`.
- Migration integration remains OPEN/UNAPPROVED; D75 admission behavior and historical migrations are unchanged. Q3 made no commits.
- Parent direction is required for an isolated prerequisite/repair disposition. After that and a newly allocated slot, coverage must pass, then fixture-only parity must pass before representative PNGs are inspected with `view_image`. No blanket refreeze. Manifest/roadmap evidence remains the retained light run, not a resumed rerun; whitespace/product-equality checks are not substitutes for passing heavy gates.
- Retained historical scheduling disclosure: before this explicit release, Q3 made one prohibited nonblocking lock probe; it returned busy (75), did not run a gate, and did not wait/unlink/retry. There were no additional probes during the hold.
