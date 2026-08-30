# dcr-q3r — fixture isolation repair disposition

Status: **BLOCKED ON SCOPE / INTERFACE MISMATCH** (2026-08-30). No repair applied. The authorized three-line test-only patch depends on four source lines absent from this checkout. Parent authorization or integration of that prerequisite is required before a valid repair can proceed.

## Identity and scope

- Unit: `sup_terra_dcr_q3r_fixture_isolation`; same Q3 agent, `gpt-5.6-terra`, high reasoning.
- Execution HEAD: `c39d5f5fa4cd8ef3f0e7bef9a73b389863cf862e`; branch `codex/r-dcr-authority-close`.
- Assigned workdir for every command: `/Users/julianhein/.codex/worktrees/3646/hr-automation-rebuild`.
- Authorized code scope: only `tests/unit/dry-run-scenario-composition.test.ts`. No test changes made; every assertion, timeout, and test count remains unchanged.
- No source, auth, production bypass, migration, dependency, or shared-board edits. No commits. Parent-owned report changes and all original Q3 artifacts are preserved.

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

Current `ProductionDryRunScenarioRuntimeInput` does not declare the field, and its default drain does not forward it. `src/server/worker/compose.ts` already supports the downstream optional factory at line 231 and chooses it at line 504, but the enclosing dry-run runtime is the missing link. `src/core/duo-ceremony-gate.ts` is unchanged between the compared commits. No entire security commit was cherry-picked.

The existing two tests are the correct regression seam: their receipt, gate-result, write-safety, terminal, and EID-safe evidence assertions must all remain intact. No new test, timeout increase, assertion weakening, credential file, environment toggle, or drain-worker stub was introduced. Applying an unsupported property would not exercise the intended factory and would also violate the current TypeScript interface; no knowingly incompatible patch was applied merely to manufacture another red.

## Verification and stop boundary

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

All owned command sessions have exited; no browser or live runtime was launched and no foreign resource was cleaned up. Both full light gates were admitted and ran sequentially, with no lock retry or unlink. No credential file was created, copied, linked, or read; the red tests failed on the missing-path stat. No new tests or throwaway prototype files were created.

The debug method stops at the validated scope boundary before FIX: parent must disposition the four-line runtime prerequisite. A future authorized repair must prove focused red→green, unchanged assertions, lint/typecheck, independent review, and newly allocated full coverage/parity. Current red evidence is not a gate pass. No new root invariant was established, so AGENTS.md was not changed. Commit is intentionally absent because there is no valid authorized repair to commit.
