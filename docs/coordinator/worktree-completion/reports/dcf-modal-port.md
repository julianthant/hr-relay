# DCF Run-modal destination-only port

Date: 2026-08-31

Branch: `codex/r-dcf-modal-port`

Base: `13175b13340fec7b5326207fe54f98078d481d7d` (`integration/03b`)

Authority: root `e5595e4e`; replacement brief `docs/coordinator/worktree-completion/briefs/dcf-modal-port.md`; final answer `1A`

## Outcome

The Run Modal no longer renders or submits a per-start Destination choice, and it no longer draws a test-target badge. The ordinary `Input -> Options -> Confirm` path remains. Enabling `Customize steps` still inserts the separate `Steps` screen, and the exact `selectedStepKeys` remain part of the dashboard request, request fingerprint and confirmation. The lower-level optional `requestedInstance` ingress remains available to authorized tools; only the dashboard producer stopped supplying it.

No graph timeline or older DCF queue-copy change was ported. No integration/master merge, push, live HR action or retained-branch cleanup occurred.

## Commits

| Commit | Category | Proof |
|---|---|---|
| `4aa2bb6a` | Product, focused tests, D293 owner/pointer and nearest lesson | Destination state/request/fingerprint/UI removed; D285 path and step payload pinned |
| `02f7d486` | Reviewed parity references and manual rendered evidence | Four intended Options reference pairs refreshed; seven responsive screenshots retained |

## Rendered proof

`playwright-cli` drove the local rebuild BFF and Vite app only. It traversed Input, Options, the conditional Steps screen, Confirm, and a local `Start applied` result. One local Person Lookup row was enqueued in ignored rebuild state; no worker ran and no external HR system was contacted. The browser, BFF and Vite processes were closed afterward.

| Surface | 1440x900 | 768x900 | 375x812 |
|---|---|---|---|
| Options | `../evidence/dcf-modal-port/options-1440x900.png` | `../evidence/dcf-modal-port/options-768x900.png` | `../evidence/dcf-modal-port/options-375x812.png` |
| Steps | `../evidence/dcf-modal-port/steps-1440x900.png` | `../evidence/dcf-modal-port/steps-768x900.png` | `../evidence/dcf-modal-port/steps-375x812.png` |
| Result | — | — | `../evidence/dcf-modal-port/result-375x812.png` |

The three widths had no horizontal page overflow. Keyboard traversal reached `Customize steps`; activation inserted and focused the four-stage rail. The mobile result kept the applied banner and Confirm content within the dialog.

## Review

| Axis | Native reviewer | Result |
|---|---|---|
| Repository standards | `sup_luna_review_standards` | PASS |
| Amended authority/spec | `sup_terra_review_spec` | PASS |
| Correctness | `sup_terra_review_correctness` | PASS |
| Silent failures | `sup_terra_review_silent_failures` | PASS |
| Performance | `sup_terra_review_performance` | PASS |
| Tests | `sup_luna_review_tests` | PASS after strengthening the exact selected-step and destination-absence assertions |
| Docs | `sup_luna_review_docs` | PASS |
| UI/WIG | `sup_terra_ui_finish_dcf_modal` | Destination-free responsive result PASS; pre-existing sub-44px checkbox/footer touch targets recorded below |
| Security | Supervisor | PASS — capability removal only; no new endpoint, parser, secret, authority or injection surface |

The UI pass used the live Vercel Web Interface Guidelines fetched on 2026-08-31. Its one finding concerns unchanged checkbox/footer control geometry that predates this destination-only diff. Expanding those targets would exceed D293 and change unrelated parity, so it remains a separately owned residual rather than being folded into this port.

## Gates

| Gate | Result |
|---|---|
| `npm run build:manifest:check` | PASS — generated manifest current |
| `npm run roadmap:check` | PASS — generated roadmap current |
| locked `npm run lint` | PASS, zero warnings |
| locked `npm run typecheck` | PASS |
| focused Vitest, one worker | PASS — 4 files, 36 tests |
| locked `npm run test:coverage`, one worker | PASS — 336 files, 3,675 tests; 84.57% statements, 86.53% lines |
| scoped `npm run test:parity:update -- --grep "separations start-run continuity"` | PASS — exactly four Options PNGs and four a11y trees updated after direct inspection |
| locked `npm run test:parity` | PASS — 239/239 |
| `git diff --check` | PASS |

The first coverage invocation failed loud because this worktree lacked the legacy sibling and Duo credential path. The successful rerun used the documented `HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation` override and an ignored symlink from this worktree's credential path to the existing rebuild credential; no credential bytes were copied. The first asserted parity run produced only the four expected Options a11y drifts (235/239), after which the repository's deliberate scoped update command refreshed the reviewed references and the full asserted rerun passed.

## Coordinator integrity and residue

The coordinator board remained read-only and unchanged from intake:

- SHA-256: `27d016ca1073c0f8b225570ec9135970135502417a5cd780639aece4db45ba0d`
- coordinator root HEAD: `dd55a5be86c5d322b01309cf01c63638eb064cda`
- board blob: `40c6ebf723cdb77e16d1a43a23189700bde6f9ab`

The retained earlier branch remains untouched at `45b525f1c8828c9eb16e1fd4598441bfd4bbe981`. The only ignored local prerequisites/state are `.auth/duo-webauthn.json` (symlink to the existing rebuild credential) and the rebuild's local `.tracker-rebuild` data used for the rendered result. No handoff file is required.
