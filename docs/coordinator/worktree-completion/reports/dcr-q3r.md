# dcr-q3r — fixture isolation repair disposition

Status: **REPAIRED / READY FOR INDEPENDENT REVIEW** (2026-08-30). The coordinator expanded scope to the exact four runtime lines plus three test lines from `964c9636`, with a nearest-AGENTS seam lesson. The full focused file, fresh lint, and fresh typecheck are green. Heavy gates remain held; independent review is parent-owned.

## Identity and scope

- Unit: `sup_terra_dcr_q3r_fixture_isolation`; same Q3 agent, `gpt-5.6-terra`, high reasoning.
- Diagnostic execution HEAD: `c39d5f5fa4cd8ef3f0e7bef9a73b389863cf862e`; approved repair base: `1582f95c5c114162d980b247a58cb7f2d2f22bb9`; branch `codex/r-dcr-authority-close`.
- Assigned workdir for every command: `/Users/julianhein/.codex/worktrees/3646/hr-automation-rebuild`.
- Initial code scope was only `tests/unit/dry-run-scenario-composition.test.ts`; the first attempt correctly stopped without a patch. The approved continuation adds `src/server/dry-run-scenario/runtime.ts` and root `AGENTS.md` (the nearest applicable instructions, read in full). Every assertion, timeout, and test count remains unchanged.
- No auth, production-bypass configuration, migration, dependency, or shared-board edits. Parent-owned report changes and all original Q3 artifacts are preserved. Only the two approved code files and AGENTS lesson are intended for the local repair commit; report/evidence remain for parent.

## /debug full method and red loop

Read the full debug skill and `.agents/skill-library/hr-debug/REFERENCE.md`; applied its gate-first method. Reviewed relevant lessons on credential-scoped Duo identity (D243/D244), fixture boundaries hiding validation failures, and real composed dry-run/gate-resume evidence. This is a deterministic unit composition failure, not live authentication; no live workflow or browser investigation is appropriate.

1. **Original focused red:** `env VITEST_MAX_WORKERS=1 npx vitest run tests/unit/dry-run-scenario-composition.test.ts --reporter=verbose` — exit 1; 1 file failed; 2 tests failed, 6 passed; Vitest 4.1.10, 2.77s. Full output: `evidence/dcr-q3r/focused-red.log`.
2. **Minimized repeated red:** same command with `-t 'composes both worker drains and the real gate command through terminal receipt evidence'` — exit 1; 1 failed, 7 filtered/skipped; 2.45s. This isolates one first worker drain without editing any test. Full output: `evidence/dcr-q3r/minimized-red.log`.
3. Both original failures remain at test lines 362 and 436: `SecretFileError: duoWebauthnCredential is unavailable at the registered rebuild credential path`, caused by ENOENT stat of the assigned checkout's `.auth/duo-webauthn.json`.

## Ranked hypotheses and discriminating probes

These hypotheses were shown before provenance/interface inspection. Read-only probes were labeled `[DEBUG-q3r]` in evidence; no instrumentation was added to code.

| Rank | Hypothesis and falsifier | Result |
| --- | --- | --- |
| 1 | Missing fixture injection; falsified as a sufficient repair if the runtime cannot accept/forward the injected factory | Both tests omit the factory, but the runtime also lacks the seam; three test additions alone are insufficient |
| 2 | A real operator credential fixture is necessary; falsified if the established helper can provide a credential-free real ceremony gate | Existing `fixtureDuoCeremonyGates(clock)` uses the real lease-store-backed gate with a fixed synthetic key; no real credential is inherently needed for this fixture design, but the current runtime cannot receive it |
| 3 | Current runtime interface differs from R2; falsified by an existing optional `duoCeremony` input and forwarding expression | **Confirmed:** both are absent in this HEAD and present in R2's source commit |

Exact commands, source diffs, and current interface are retained in `evidence/dcr-q3r/provenance-interface.log`. A guessed fixture filename in the first probe did not exist; the correct source-derived path was then read completely and recorded in `evidence/dcr-q3r/fixture-interface-followup.log`. No probe failure was treated as a passed check.

## Verified provenance and missing prerequisite

`git log 54060ded -- tests/unit/dry-run-scenario-composition.test.ts` identifies source commit **`964c9636e291510be58175246759b724d1c257c9`**, `fix(security): close environment admission boundary`.

The exact three test additions in that commit are:

```diff
+import { fixtureDuoCeremonyGates } from "./fixtures/duo-ceremony-fixtures.js";
+      duoCeremony: fixtureDuoCeremonyGates(clock),
+      duoCeremony: fixtureDuoCeremonyGates(clock),
```

However, comparing **also** `src/server/dry-run-scenario/runtime.ts` exposes four additional lines in that same commit:

```diff
+import type { DuoCeremonyGateFactory } from "../../core/duo-ceremony-gate.js";
+  /** Deterministic credential-free gate seam; omitted by production CLI composition. */
+  readonly duoCeremony?: DuoCeremonyGateFactory;
+      ...(input.duoCeremony === undefined ? {} : { duoCeremony: input.duoCeremony }),
```

At the diagnostic HEAD, `ProductionDryRunScenarioRuntimeInput` did not declare the field, and its default drain did not forward it. `src/server/worker/compose.ts` already supported the downstream optional factory at line 231 and chose it at line 504, but the enclosing dry-run runtime was the missing link. `src/core/duo-ceremony-gate.ts` is unchanged between the compared commits. No entire security commit was cherry-picked.

The existing two tests are the correct regression seam: their receipt, gate-result, write-safety, terminal, and EID-safe evidence assertions must all remain intact. No new test, timeout increase, assertion weakening, credential file, environment toggle, or drain-worker stub was introduced. Applying an unsupported property would not exercise the intended factory and would also violate the current TypeScript interface; no knowingly incompatible patch was applied merely to manufacture another red.

## Initial diagnostic verification and stop boundary (historical)

| Check | Result / evidence |
| --- | --- |
| Focused full file | RED, 2 failed / 6 passed; `focused-red.log` |
| Minimized regression | RED, 1 failed / 7 filtered; `minimized-red.log` |
| Green proof | Not available; missing source seam is outside authorized scope |
| Serialized lint | PASS, exit 0; `/usr/bin/lockf -k -t 45 /tmp/hr-worktree-light-gate.lock npm run lint`; 14:38:37Z–14:39:12Z; `evidence/dcr-q3r/lint.log` |
| Serialized typecheck | PASS, exit 0; `/usr/bin/lockf -k -t 45 /tmp/hr-worktree-light-gate.lock npm run typecheck`; 14:39:20Z–14:39:35Z; `evidence/dcr-q3r/typecheck.log` |
| Product equality | `git diff --quiet 6d1e3ca8 -- src tests scripts config package.json package-lock.json` exit 0 |
| Original raw coverage log | SHA-256 remains `340c1bdc9584d206c4b9594c347eeefcd3b212add06229714d84bfc046865442` |
| Heavy gates | Not run or polled; slot released by parent before this seam |
| Cleanup / diff | `rg -n -F '[DEBUG-q3r]' src tests` returned 1 (no source instrumentation); `git diff --check` exit 0; `evidence/dcr-q3r/unchanged-cleanup.log` |

All initial diagnostic command sessions exited; no browser or live runtime was launched and no foreign resource was cleaned up. Both initial full light gates were admitted and ran sequentially, with no lock retry or unlink. No credential file was created, copied, linked, or read; the red tests failed on the missing-path stat. No new tests or throwaway prototype files were created.

The initial debug attempt stopped before FIX at the validated scope boundary; no repair or AGENTS change was made at that point. Parent committed that diagnostic evidence at `1582f95c`, then explicitly authorized the missing prerequisite. The red evidence remains immutable and is not a gate pass.

## Approved continuation — exact seven-line port

**Coordination correction:** the earlier test-only comparison included the core Duo module but omitted `src/server/dry-run-scenario/runtime.ts`. The coordinator acknowledged that omission and approved the four runtime lines in addition to the three test additions. No broader security commit was imported.

Applied with `apply_patch` from verified source commit `964c9636e291510be58175246759b724d1c257c9`:

| File | Exact change |
| --- | --- |
| `src/server/dry-run-scenario/runtime.ts` | 4 additions, 0 deletions: type import at line 13; comment/property at 47–48; conditional forwarding at 173 |
| `tests/unit/dry-run-scenario-composition.test.ts` | 3 additions, 0 deletions: fixture import at 32; factory injection at 348 and 423 |
| `AGENTS.md` | 7-line dated seam lesson at line 300; no other instruction changes |

`git diff --exit-code 964c9636e291510be58175246759b724d1c257c9 -- src/server/dry-run-scenario/runtime.ts tests/unit/dry-run-scenario-composition.test.ts` exits 0: both complete repaired code files are byte-identical to that commit. The exact patch, unchanged surrounding product proof, caller inspection, and 34 unchanged assertion-bearing lines are in `evidence/dcr-q3r/approved-port-proof.log`. No assertion or timeout line was added, removed, or changed; all eight existing tests remain collected.

The existing helper `tests/unit/fixtures/duo-ceremony-fixtures.ts` is unchanged. It lazily creates the **real lease-store-backed** Duo ceremony factory using a fixed synthetic credential identity and throwaway authority database, not a bypass token or mocked receipt/worker result. The test supplies that factory alongside its existing deterministic browser sessions. Both real worker drains, real gate command, receipt derivation, durable write-safety counts, and safe failure-evidence assertions remain exercised.

Production omission was checked in the actual caller: `src/cli.ts` passes this runtime constructor to `composeDryRunScenarioCommand`; the latter calls it with only `isolation`, `repoRoot`, `env`, `clock`, and `ids`. No wire, CLI argument, or environment setting introduces the optional factory. If absent, the conditional spread passes no property and the unchanged worker composition selects `composeDuoCeremonyGateFactory`, retaining its fail-loud credential identity checks. No core Duo, secrets, migration, config, wire, or CLI file changed.

## Fresh post-repair validation

Commands run from the assigned workdir at base HEAD `1582f95c5c114162d980b247a58cb7f2d2f22bb9` plus the approved working diff; each new light gate is individually locked, with at most one owned light process.

| Command | Result | Complete log |
| --- | --- | --- |
| `env VITEST_MAX_WORKERS=1 npx vitest run tests/unit/dry-run-scenario-composition.test.ts --reporter=verbose` | PASS, exit 0; 1 file / 8 tests; Vitest 4.1.10; 2.85s | `evidence/dcr-q3r/focused-green-1582f95c.log` |
| `/usr/bin/lockf -k -t 45 /tmp/hr-worktree-light-gate.lock npm run lint` | PASS, exit 0; 14:41:39Z–14:42:10Z | `evidence/dcr-q3r/lint-green-1582f95c.log` |
| `/usr/bin/lockf -k -t 45 /tmp/hr-worktree-light-gate.lock npm run typecheck` | PASS, exit 0; 14:42:49Z–14:43:04Z | `evidence/dcr-q3r/typecheck-green-1582f95c.log` |

The retained full-file red (2 failures / 6 passes) and this same full-file green (8 passes) establish the regression without adding or weakening tests. No fresh coverage/parity command or heavy-lock probe is authorized or attempted. Parent owns independent Tests/Security/Correctness/Silent-failures review and the next heavy-slot request.

Post-repair cleanup evidence is `evidence/dcr-q3r/approved-cleanup-proof.log`: no `[DEBUG-q3r]` instrumentation under source/tests, unchanged raw red logs, and `git diff --check` exit 0. Every owned light process exited. No browser/live workflow or foreign cleanup was performed; no real credential file was accessed or provisioned. The newly observed parent edit to `reports/dcr.md` was not touched or staged.

## Local commit and handback

Committed **`845ca5a115ee6eef3e10598e88ea0a7fdf361888`** — `fix(test): isolate dry-run composition Duo gates`. Exactly three explicitly staged files: runtime (4 additions), composition test (3 additions), and AGENTS (7 additions); 14 insertions, no deletions. The message records exact source provenance, diagnosed cause, red→green proof, and held heavy gates. Complete commit output: `evidence/dcr-q3r/repair-commit.log`.

Reports and new evidence remain uncommitted for parent; no parent-owned documentation was staged. This is the repaired candidate for independent review, not a full-gate or UI-parity pass. Subsequent coverage/parity still require fresh coordinator allocation.
