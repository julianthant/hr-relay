# R4d — Smart HR pending-set settlement diagnosis and repair

Date: 2026-09-02. No date gate. Base: current `feature/03b-live-close` after R4c evidence merge `8962c70e` plus coordinator receive/admission commit.
Repository `/Users/julianhein/Projects/hr-automation-rebuild`. Board `docs/coordinator/separations-completion/board.md` is READ ONLY.
Profile/workspace/run plan: `/Users/julianhein/Projects/hr-automation-rebuild/docs/coordinator/separations-completion/{project-profile.md,run-plan.md}`.
Report: `docs/coordinator/separations-completion/reports/r4d-smart-hr-settlement-repair.md`. Sanitized evidence: `docs/coordinator/separations-completion/evidence/r4d/`. Identifying values and live snapshots stay only under the primary checkout's ignored `.tracker-rebuild/restricted/r4d/` or existing R4c restricted packet; never commit them.

## u20 — exact red and diagnosis

Invoke `/supervise`, `/debug`, and `/ui` in browser Operate/Verify mode. All browser operations use `playwright-cli`. Exact red authority:

- run `26e7eaa2-1111-4a88-be5e-b71e4432b4f7`, trace `sp-132417-26e7`, failure `85895513-780e-445f-87c3-6a5a42f69eb5`;
- fingerprint `d811fe253c4fa59c5eea9dc13b310c8599a9430d85d3e0b60e4f4c1ae1a4f7ab`, code `UNEXPECTED_PAGE_STATE`, write state `not-attempted`;
- exact symptom: the SS Smart HR search rendered neither a result row nor PeopleSoft's explicit no-results marker within 45 seconds;
- exact run had zero write intents, write attempts, durable outbox rows and gate rows.

Use the full ranked-hypothesis debug loop until direct cause is proved. Read the exact R4c report/evidence and restricted diagnostic in the primary checkout. Perform a fresh read-only live SS Smart HR search for the same machine-verified subject through a dedicated `playwright-cli` session; snapshot the settled DOM/accessibility state and current route without clicking any external-commit control. Close all owned browsers. Do not start or retry a workflow run.

## Repair boundary

Scope starts at `src/stores/ucpath/driver/smart-hr-operation.ts`, `src/stores/ucpath/driver/ui-registry.ts`, and `tests/unit/ucpath-smart-hr-operation.test.ts`. Prove a deterministic red at the real settlement/classification seam before production edits. Then apply the smallest fail-loud repair supported by current live evidence.

- Do not turn an indeterminate response into an empty set, widen to a guessed selector, swallow a timeout, weaken D310's stable-T-ID/six-grid-fact authority, or increase the 45-second bound without measured evidence.
- A new locator/page-state path is admissible only when live-verified for the exact state and pinned by positive plus ambiguous/error tests with dated provenance.
- Preserve the distinction among populated results, explicit no-results, stale/old rows, server/error state, and genuinely indeterminate settlement. Preserve redaction of EID/person/transaction facts.
- Touch executor, contracts, D310 semantics, write sequencer or replay only if the narrow live/test evidence disproves the driver boundary. No source change is required if the failure is conclusively external/transient; return that evidence instead.
- Update the nearest `src/stores/ucpath/AGENTS.md` and `CLAUDE.md` twin with a dated lesson for any non-obvious live page-state rule. Refresh `src/domain/workflow/generated-build-manifest.ts` for any descriptor-closure change.

Run the focused red/green tests, UCPath/separations structural scenarios, `npm run typecheck`, `npm run lint`, `npm run test:coverage`, `npm run build:manifest:check`, `npm run roadmap:check`, `git diff --check`, and `npm run test:parity`; quiesce/restore the owned dashboard only as required by the profile. Require fresh independent native `sup_terra` correctness and silent-failure review, plus applicable spec/tests/docs/security/performance axes. Commit logical categories with explicit paths and clean all worker worktrees.

No workflow retry, gate resolution, actual HR write, runtime-row mutation/repair, registry/environment change, board edit, master merge, or push is authorized. R4e, under another fresh supervisor after coordinator integration, owns the next 4495 dry run. Stop with exact diagnosis, commits, gates, reviews, runtime/browser cleanup, and a clean branch; no handoff on coherent completion.
