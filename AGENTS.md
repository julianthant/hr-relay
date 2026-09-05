# HR Automation — rebuild

Legacy `/Users/julianhein/Projects/hr-automation` remains the sole production authority and rollback
asset until the single all-at-once cutover (D89/D93). This rebuild is not production.

## Working rules

- Never push without explicit instruction. Commit by logical category, stage exact paths (never
  `git add -A` / `git add .`), and preserve other sessions' edits.
- Keep existing `AGENTS.md` / `CLAUDE.md` pairs byte-identical. Write one shared text; update both.
  Change instructions when their rules change, not after every feature edit. Put requested lessons
  in the module's linked ledger. Use `/docs` for broader documentation cleanup; `/docs audit` is read-only.
- Before committing: `npm run typecheck && npm run lint && npm run test:coverage` (D191).
  Update relevant tests for feature changes; say when none exist. Lint failures are task failures.
  Preserve assertions, membership, isolation, coverage floors, and timeouts. Use at most four file
  workers and run coverage without this task's compiler/linter contention. Guard additions/retirements
  must update `docs/rebuild/guard-inventory.json` with the deciding evidence.
- Report results with evidence in a compact table. Use `/ui` for frontend work. Delegate only when
  explicitly authorized; complexity alone does not trigger `/supervise`. Discussion/grilling is
  explicit-only; persist inquiry only when asked. Batch operator decisions using `/decision-brief`.
  Use `/handoff` before stopping unfinished work; verify its git state and gates on resume.

## Find the owner before changing a contract

The [roadmap](docs/roadmap/roadmap.md), admitted phase docs under `docs/rebuild/`, and contracts under
`docs/rebuild/reference/` are the one plan. Read the relevant phase/contract; never invent another plan
or infer implementation from design. Roadmap §Governance owns D1/D263. Decisions are ratified in the
owning contract plus a pointer in `reference/decisions.md` in the same commit; never reuse D131.
History is evidence, not current authority. Read phase docs / `npm run cli -- phase` for current status.

D326/D328/D329 order 0.3 → 1.6 → 2.6 → 3.1 → 3.2 → 3.3 → 3.4. Parts contain numbered supervisor
tasks; parallel peers use `N-1`, `N-2`, etc. with recorded isolation. Phase 3.2 freezes the candidate;
3.3 consumes it unchanged. Defects/drift return to 3.2. Phase 4 requires D319 admission and operator
approval; Phase 5 owns cutover. Never retry an UNKNOWN submit.

`ref <slug>` below means `docs/rebuild/reference/<slug>.md`. Search/read the relevant section, not
an entire historical ledger. Before editing a module, read its nearest instruction file even when
the task started at the root. Both agents use the same module instructions and references.

| Work | Read before changing it |
| --- | --- |
| Tasks / workflows | `ref task-contract`, `ref workflow-model`, `ref stores` (derived; code wins), `docs/guides/workflow-authoring.md` |
| Run / settings / upgrade | `ref dashboard-surfaces` D330/D332, `ref clock-config-secrets` D331/D332, `ref guards-and-tests` §5.2, active phase bindings |
| Workers / browser / writes | `ref execution-and-sessions`, `ref write-safety`, relevant store instructions |
| Dashboard / BFF / CLI | `src/dashboard/AGENTS.md`, `src/server/AGENTS.md`, `ref frontend-backend-integration`, `ref dashboard-surfaces`, `ref operator-trust` |
| Intake / OCR / Edit Data | `ref data-intake-and-edit-data` |
| Tests / guards | `ref guards-and-tests`; `tests/scenario/AGENTS.md` for scenarios |
| Known kernel / workflow / driver / dashboard / safety failures | Search `ref lessons` and the module's lesson ledger by seam/decision |
| Environment / isolation / porting / detailed conventions | Relevant section of [.agents/skill-library/repository-work/REFERENCE.md](.agents/skill-library/repository-work/REFERENCE.md) |
| Authorized orchestration | Operating reference §Authorized orchestration, then the platform's `~/.agents/skill-library/parallel-agent-work/REFERENCE.md` (Codex) or `~/.claude/skill-library/parallel-agent-work/REFERENCE.md` (Claude) |

Keep instruction entry points concise, with explicit read triggers for relocated rules. Verify
existing twin equality and complete project chains below 32,768 UTF-8 bytes; do not raise the cap
to hide growth. Ordinary code/schema/catalog facts should be looked up at their owner.

## Safety boundaries

- Fail loud: missing/corrupt data or failed checks must not become plausible defaults, alternate
  selectors, cached/latest values, or swallowed results. A fallback requires both a valid expected
  case and recorded verification (live for page state, tests for pure logic). Otherwise throw a
  named error or propagate a distinct unknown that the caller checks. Never log secret/canary values.
- Runtime and finished gates never import, invoke, proxy, or read legacy live state. Port by copying
  with legacy commit + source path and live reverification. Never delete legacy files or restore its
  execution dependency. Cross-repo inventory paths use the `legacy:` prefix.
- `config/runtime-isolation.json` owns rebuild ports 3938/5174, session `hrauto-rebuild`, and its
  repo-relative state/artifact/lock/auth roots. Preserve settings/database coupling (D321), terminal
  delete/tombstones (D308), and explicit-only verified backup (`cli storage backup`, D322).
  Never discard an authority half to hide a mismatch. Boot/upgrade follows the current floor/D332;
  read the operating reference before touching authority or resolver behavior.
- Never overwrite an existing `.env` or print credentials. Missing-file setup, secure bootstrap,
  sole credential reader, display propagation, and canary resolution are specified in the operating
  reference's Environment section; read it before configuration or live-run work. Registry defects
  throw; unavailable/declared-pending subjects block before secret access or browser launch. Do not
  silently replace a canary or treat a dated availability claim as current verification.

## Live verification and commands

Read-only selectors, login checks, collectors, and dry-runs are pre-authorized; never ask about access,
spending the session, or Duo. Transaction-bearing verification uses `dryRun=true`: no UCPath submit
or Kuali finalization. D318's transaction-free `live-read` uses `dryRun=false` only with a zero-transaction
graph and zero deltas in `write_intents`, `write_attempts`, and `durable_outbox`. This does not authorize cutover.

Use `playwright-cli` and its platform playbook, never Codex-in-chrome/chrome-devtools MCPs. Default
headless; snapshot before selecting locators. Duo Autopilot requires full Chromium; see
`duo-autopilot/README.md`. Close owned sessions/sweep orphans, preserving other active sessions.
Skip a down system and continue with the rest. Use rebuild drivers; consult legacy only for porting.

- Dev: `npm run dashboard` starts BFF + Vite; Ctrl+C stops both. BFF alone: `npm run cli -- dashboard`.
  Production: `npm run web:build` then `npm run dashboard:prod`.
- Live case: `npm run cli -- dry-run-scenario <workflow> --subject <label>`.
- Visual/a11y: `npm run test:parity`; follow dashboard cadence. Refreeze only deliberately with review.
- Descriptor import-closure edits: `npm run build:manifest` / `npm run build:manifest:check`.
  Store catalog: `npm run stores:catalog` / `npm run stores:catalog:check`.
  Roadmap: `npm run roadmap` / `npm run roadmap:check`. Never hand-edit generated output.

For coding conventions, driver bindings, workflow layout, omission, gates, provenance, and recovery,
read the operating reference and owning contract before changing that seam. Those rules apply even
when their full explanation is not repeated in this entry point.

## Direct roadmap assignments

The user is the coordinator. “You are a supervisor; complete 1.6.1” assigns exactly that task:
verify prerequisites, implement, test, commit/integrate locally, update its owning phase and
roadmap with completion evidence, regenerate/check the roadmap, and stop. No agent coordinator,
separate coordination paperwork, or next-task dispatch is required. Read roadmap §Governance's
Direct supervisor assignments amendment; it supersedes older coordinator ceremony while retaining
scope, gates, isolation, and live approvals. Preserve ownership of already enrolled work.
