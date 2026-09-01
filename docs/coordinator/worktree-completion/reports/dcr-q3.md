# dcr-q3 — gate and UI verification

Status: **GATES + UI VERIFIED / READY FOR PARENT Q4** (2026-08-30). At `6851990b`, fresh coverage passed 353 files / 3,831 tests and asserted parity passed 265/265 tests. All 30 reporting reference triples were asserted; 10 representative PNGs were then inspected with `view_image`, with zero findings in this bounded review. The heavy commands have exited and the parent was signaled immediately to release the logical slot. Earlier red and stop-boundary sections below remain historical evidence, not the current scheduling state.

## Resumed candidate and verification boundary

- Clean allocated HEAD: `6851990b161830b5ad2a532bcdcfa69178a3ede4`, branch `codex/r-dcr-authority-close`.
- Reviewed repair code: `845ca5a115ee6eef3e10598e88ea0a7fdf361888`; `git diff --exit-code 845ca5a1 -- src tests scripts config package.json package-lock.json` returned 0 at intake. No further code, tests, auth, migration, or reference changes are authorized.
- `reports/dcr-q3r-review.md` records six independent review axes, each zero findings. Q3r ported only the approved four runtime lines and three test additions from `964c9636`, plus the seam lesson. No operator credential was provisioned.
- Fresh Q3r locked lint/typecheck apply to this unchanged code; parent also reran the committed focused file (8/8) and locked lint. See `evidence/dcr-q3r/{typecheck-green-1582f95c.log,lint-green-1582f95c.log,parent-verification.md}`. These are retained exact-code checks, not new Q3 reruns.
- **Pre-commit gate-order deviation:** product commit `845ca5a1` predates fresh passing full coverage. That does not satisfy AGENTS' coverage-before-product-commit requirement and is not a waiver. Gates at `6851990b` can prove the candidate only; they cannot retroactively satisfy the required pre-commit order. No history rewrite/revert or further product commit is performed.
- Fresh coverage used the same exact locked invocation recorded below, writing a distinct `evidence/dcr-q3/coverage-6851990b.log`. The original `coverage-c39d5f5f.log` remains immutable.
- `/ui` route: UI review → project parity → representative PNG inspection. React 19.2.8 / Vite 8.2.2 / Tailwind 4.2.2 / Lucide 1.8.0 / TypeScript, no Next or shadcn. [WIG](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md) fetched fresh; complete UI-review, Playwright, nearest dashboard instructions and project parity contract read. Repository density, supported viewport, token, and authority rules remain primary; no redesign.
- The complete reporting subset is **30 reference triples**: Activity present/unavailable, comparison ready/refused, and cross-date search × three supported viewports × two themes. The earlier 18-capture inventory below referred only to unavailable Activity and the two comparison arms.

## Fresh heavy results at 6851990b

| Check | Exact result | Complete evidence |
| --- | --- | --- |
| Coverage | Exit 0; Vitest 4.1.10; 353/353 files, 3,831/3,831 tests passed; duration 354.14s; UTC 14:49:26–14:55:22 | `evidence/dcr-q3/coverage-6851990b.log`, tool session 96445 |
| Coverage metrics | Statements 84.64% (25,454/30,070); branches 74.87% (13,141/17,551); functions 88.29% (5,221/5,913); lines 86.59% (23,478/27,111) | Same complete coverage log; configured threshold gate passed |
| Suite-size step | Completed: unit 266 files / 90,865 lines; scenario 18 / 7,125; architecture 69 / 22,258 | Same log, following successful Vitest |
| Asserted parity | Exit 0; 265/265 tests passed / 1 worker; duration 4.0m; UTC 14:55:35–14:59:34; no update mode | `evidence/dcr-q3/parity-6851990b.log`, tool session 29174 |

Exact heavy commands (sequential, assigned workdir, unchanged HEAD):

```sh
/usr/bin/lockf -k -t 0 /tmp/hr-dashboard-full-gate.lock env HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npm run test:coverage
/usr/bin/lockf -k -t 0 /tmp/hr-dashboard-full-gate.lock npm run test:parity
```

Before parity, a shell guard required `PARITY_UPDATE` unset/empty or `0`; no update command, pixel tolerance, timeout, or assertion was changed. Current reference config is `updateSnapshots: none`, `maxDiffPixels: 0`, `threshold: 0.2`; accessibility and metadata are compared byte-for-byte. The project lane verifies the served bundle against current source/output digests and owns its isolated fixture/seeded servers and headless browser lifecycle.

## Fresh rendered proof, freshness, and cleanup

| Check | Result | Evidence |
| --- | --- | --- |
| Reporting references | All 30 triples asserted: five states × three supported viewports × two themes | Full parity log above |
| Manual PNG inspection | 10/10 inspected after assertion: five states in Paper & Ink 1440×900 and Graphite Warm 1024×768; zero bounded visual findings | [Rendered review and image links](../evidence/dcr-q3/rendered-review-6851990b.md) |
| Image provenance | Exact copies of asserted references with PNG/a11y/metadata companions; all 30 copied files compared and SHA-256 logged | `evidence/dcr-q3/asserted-copy-proof-6851990b.log` |
| Manifest | `npm run build:manifest` exit 0; `git diff --exit-code -- src/domain/workflow/generated-build-manifest.ts` exit 0 | `evidence/dcr-q3/build-manifest-6851990b.log` |
| Roadmap | `npm run roadmap:check` exit 0; committed index is fresh | `evidence/dcr-q3/roadmap-check-6851990b.log` |
| Final integrity | Exact HEAD, unchanged product/reference/manifest paths, original red-log hash, closed-board blob, and `git diff --check` | `evidence/dcr-q3/final-state-6851990b.log` |

The `/ui` review route determined the checks and rendered evidence, not a redesign. Activity's unavailable axis is explicitly not zero; receipt comparison refusal remains distinct from the unchanged receipt; search shows the measured corpus and exact durable result. The narrow comparison screenshot is intentionally scrolled within the supported stacked layout; complete comparison contents, including the protected withheld arm, are covered by the exact a11y assertion rather than claimed to all fit in one viewport. See the linked image review for that limitation.

Coverage session 96445, parity session 29174, and the subsequent manifest/roadmap session 23805 all completed with exit 0. The parity runner completed its owned fixture/server/browser lifecycle; no separately opened browser session, production BFF, HR workflow, or foreign fleet cleanup was used. Logs and asserted reference copies are retained as evidence, not live authority. No `.env` or credential contents were read or provisioned. No dependencies, tests, assertions, timeouts, reference snapshots, product source, migrations, or shared boards were changed by this resumed Q3 pass. Parent-owned `reports/dcr.md` changes remain untouched. No commits were made in this pass.

The initial coverage red is resolved by the separately reviewed Q3r fixture seam, not by credentials or an assertion change. Its raw log remains unchanged. Fresh green gates establish this candidate's verification only, not retroactive pre-commit-order compliance. Parent Q4 and the OPEN/UNAPPROVED migration integration decision are outside Q3 completion.

## Initial target and scope (before Q3r repair)

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

## Initial released coverage gate — exact red result

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

## Initial stop boundary, resources, and continuation (historical)

- The coverage command and lock holder exited. The parent was signaled immediately after the final result so the logical slot can be released. No retry, parity, dependency provisioning, or browser runtime was started afterward.
- No `.env`, credential contents, live authority, or HR workflow was accessed. The failing gate attempted only the missing credential-file stat. No foreign processes or browser sessions were closed; Q3 created no parity/browser session needing cleanup.
- No source, tests, migrations, reference snapshots, assertions, timeouts, or thresholds changed. Parent-owned pending edits to `reports/dcr.md` remain untouched. The closed board blob remains `5c3d196b547553265d15c30f694bea48801634a0`.
- Post-coverage product equality and `git diff --check` both exited 0; exact commands, HEAD, status, board blob, and coverage-log SHA-256 are recorded in `evidence/dcr-q3/post-coverage-state-c39d5f5f.log`.
- Migration integration remains OPEN/UNAPPROVED; D75 admission behavior and historical migrations are unchanged. Q3 made no commits.
- Parent direction is required for an isolated prerequisite/repair disposition. After that and a newly allocated slot, coverage must pass, then fixture-only parity must pass before representative PNGs are inspected with `view_image`. No blanket refreeze. Manifest/roadmap evidence remains the retained light run, not a resumed rerun; whitespace/product-equality checks are not substitutes for passing heavy gates.
- Retained historical scheduling disclosure: before this explicit release, Q3 made one prohibited nonblocking lock probe; it returned busy (75), did not run a gate, and did not wait/unlink/retry. There were no additional probes during the hold.
