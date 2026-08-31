# DCF Run-modal receive — NEEDS COORDINATOR

Date: 2026-08-31

Mode: coordinated read-only board

Board: `/Users/julianhein/Projects/hr-automation-rebuild/docs/coordinator/worktree-completion/board.md`
(not modified)

Branch: `codex/r-dcf-dashboard-fidelity`

Source head: `cf9884a9158f1f69a91cea2e7ae651adf18a3171`

Feature base: `d8554009563a9635bfafc38d6cadbef74001e0c7`

Target inspected: `integration/03b` at `13175b13340fec7b5326207fe54f98078d481d7d`

## Outcome

**NEEDS COORDINATOR.** The four commits are real, unique work, but they are not integration-ready:
the branch and current integration reuse D284/D285 for different authorities, and D285 carries
incompatible Run-modal behavior. No product source, test, owner doc, parity reference, generated site,
other worktree, coordinator board, live HR state, integration branch, master, or remote was mutated.

Decision sheet:
`docs/coordinator/worktree-completion/decisions/dcf-modal-authority-conflict.md`.

## DCF-M1 — provenance and disposition

| Item | Proof |
|---|---|
| Exact four commits | `e52a22fe` destination removal; `0972b056` destination-free parity; `376a2675` workflow-path preview; `cf9884a9` workflow-timeline parity |
| Ancestry | `git merge-base integration/03b HEAD` -> `d8554009`; exactly four commits are unique to this branch |
| Feature range | `git diff --name-status e52a22fe^..cf9884a9` -> 70 paths, 961 insertions, 773 deletions |
| Classification | 11 product/normative paths; 8 test paths; 48 parity reference paths (24 PNG+a11y triplets' changed members); 1 generated roadmap site; 1 stale historical plan; 1 parity-attribution plan |
| Direct merge simulation | `git merge-tree --write-tree integration/03b HEAD` reports conflicts in decisions/owner docs, Run-modal UI/model/bootstrap, focused tests, and the affected reference corpus |

The stale historical path is
`docs/plans/2026-08-21-03a-fidelity-1-shell-queue-start.md`; the deliberate attribution record is
`docs/plans/2026-08-26-p1-refreeze-attribution.md`; the generated path is
`docs/roadmap/index.html`.

## Authority collision

| Authority | DCF branch | Current `integration/03b` | Chronology |
|---|---|---|---|
| D284 | destination-free Start Run, `decisions.md:1635` | sole 4537 canary, `decisions.md:1637` | DCF `e52a22fe` 11:31; integration `90bbe4f6` 12:36 PDT |
| D285 | descriptor prose replaced by graph-derived timeline, `decisions.md:1644` | `Input -> Options -> Confirm` with optional Customize steps, `decisions.md:1646` and owner `dashboard-surfaces.md:2472-2483` | DCF `376a2675`/`cf9884a9` 12:14; integration `8b77c634` 19:07 PDT |

This is behavioral, not just numbering drift. Current integration sends `requestedInstance` and
`selectedStepKeys` from `run-start.tsx:771-777`, renders descriptor summary at `:983-985`, and
implements the later step-selection authority in `src/services/start/step-selection.ts`. The DCF
branch removes destination controls/request data and instead renders an exhaustive required/skippable/
human-confirmation timeline.

## DCF-M2 — focused and rendered verification

Stopped before execution because the owner conflict decides which implementation and reference corpus
are eligible to test. No focused Vitest, locked typecheck/lint, fresh `playwright-cli` session, reference
refresh, coverage, or parity command was run. This is an authority refusal, not a green gate.

Read-only UI review inspected the committed 1024px references in both themes. They contain the DCF
timeline and controls, but no committed 375px or 768px evidence exists. The live WIG fetch succeeded for
the independent UI reviewer; stack is React 19 + Vite 8 + Tailwind 4, with no `components.json`/shadcn.

## DCF-M3 — independent review

Target: `e52a22fe^..cf9884a9` only. Later integration was used solely for authority/supersession evidence.

| Axis | Count | Worst | Disposition |
|---|---:|---|---|
| Standards | 0 | none | repository structure and component/model split preserved |
| Spec | 2 | high | blocked with the authority collision; dashboard BFF still admits `requestedInstance` at `start-plan-service.ts:35-42,114` despite DCF UI omission |
| Correctness | 2 | high | same BFF boundary finding; timeline array lacks cross-entry key/label uniqueness at `bootstrap.ts:165-170` |
| Silent failures | 0 | none | no swallowed/defaulted failure introduced |
| Performance | 1 | medium | exhaustive timeline render has no contractual category bound (`run-start.tsx:221-274`; `bootstrap.ts:165-170`) |
| Tests | 1 | medium | parity covers 1024/1280/1440, not required 375/768 responsive/keyboard proof |
| Docs | 0 | none | DCF owner text and 24-triplet attribution agree internally, but collide with current authority |
| Security | 0 | none | no new auth/secret/command-execution exploit path found; strict zod boundaries remain |

One inherited issue was recorded but not charged to the feature: close/reopen with an unchanged form can
let a prior in-flight plan/command settle into the reopened dialog because async ownership uses only the
request fingerprint, not a dialog epoch (`run-start.tsx:836-843,864-933`). The pre-existing 375px fixed
picker + 300px controls geometry is also unproved and may clip inside the overflow-hidden dialog.

## DCF-M4 — gates and handback

| Check | Result |
|---|---|
| Full coverage | NOT RUN — authority conflict |
| Full parity | NOT RUN — authority conflict |
| Typecheck / lint | NOT RUN — no eligible candidate |
| Manifest / roadmap freshness | NOT RUN — no eligible candidate |
| `git diff --check e52a22fe^..cf9884a9` | PASS |
| Product worktree before report | clean at `cf9884a9` |

No reference was changed by this receive. The branch's existing four commits contain 48 changed parity
reference files; all are withheld from integration until the coordinator chooses the surviving authority.

## Recommended serial integration position

Do not merge this branch as-is. Recommended disposition is decision option 1A: preserve current
integration D284/D285, port only destination-free Start Run under the next available decision after the
current D292 line, and run it after the current Run-modal/step-selection authority is present but before
later broad dashboard artifact/reporting branches. The timeline source/tests/references should be marked
superseded rather than merged. This recommendation requires coordinator ratification before any code or
owner-doc rewrite.

## Native returns

- `sup_scout_dcf_m1_provenance`: exact four-commit/path classification and authority collision.
- `sup_analyst_dcf_m3_authority_review`: Spec/Correctness/Silent-failure review.
- `sup_analyst_dcf_m3_ui_review`: Accessibility/UI, Performance, Tests and Docs review.
