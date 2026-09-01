# DCA4 A7 — hermetic Duo composition port

Status: bounded implementation and permitted light gates complete; candidate frozen for parent receive and independent Tests/Security/Correctness review. No full-gate or DCA4 completion claim. Writer/light ownership relinquished on return; no active command.

## Scope and provenance

Applied only the approved four runtime additions, three composition-fixture additions, and seven-line root lesson: **3 files, +14/−0**, no new product/test file. Every added line in each file matches git object `845ca5a115ee6eef3e10598e88ea0a7fdf361888`, which records provenance from `964c9636e291510be58175246759b724d1c257c9`. This was a contextual additive port, not a cherry-pick or whole-file replacement. Branch-specific fixtures and all assertions/timeouts remain intact.

The root lesson at `AGENTS.md:300` is additive to the A6 before file (`a7acd7d…`), preserving its entire content and newly added lesson. Runtime changes are at `runtime.ts:13,47–48,173`; fixture changes at `dry-run-scenario-composition.test.ts:32,359,434`.

The /hr-debug and /tdd loop used the existing real composition seam: unchanged suite red first, exact conditional port, identical suite green. No new fake worker drain, credential provisioning, exception suppression, fallback, or timeout change.

## Observed cause and test proof

The unchanged suite produced exactly the required named failures:

1. `composes both worker drains and the real gate command through terminal receipt evidence`
2. `derives transaction reach and EID-safe failure evidence from every durable worker sink`

Both reported `SecretFileError: duoWebauthnCredential is unavailable at the registered rebuild credential path`, through runtime drain → `composeWorkerRuntime:445` → `composeDuoCeremonyGateFactory` → `duoCeremonyCredentialKey` → registered credential identity resolution. Their deterministic sessions did not prevent worker boot from taking its default credential factory. The current inherited suite contains **9**, not 8, tests: red was 2 failed / 7 passed and green was all 9 passed. No test was added, removed, or rewritten beyond the approved three injection lines.

The existing credential-refusal test was also run unchanged. It uses temporary synthetic inputs, asserts missing extension/credential and loose-permission refusal, and treats feature-off as an explicit decision. It does not launch a real browser. This is readiness refusal proof, not a new direct test of the production factory's omission expression.

| Gate | Process session | Exit | Result | Evidence |
| --- | --- | --- | --- | --- |
| red | 53904 | 1 | 2 failed / 7 passed; exact two credential failures (2.32s) | [raw log](../evidence/dca4-gates/duo-port-red.log) |
| green | 37201 | 0 | 9 passed (1.94s) | [raw log](../evidence/dca4-gates/duo-port-green.log) |
| credential-refusal | 4948 | 0 | 1 passed / 8 unselected (1.30s) | [raw log](../evidence/dca4-gates/duo-port-credential-refusal.log) |
| typecheck | 65428 | 0 | Green | [raw log](../evidence/dca4-gates/duo-port-typecheck.log) |
| lint | 10361 | 0 | Green | [raw log](../evidence/dca4-gates/duo-port-lint.log) |

All raw stdout/stderr was captured directly by command-owned `tee` under `set -o pipefail`; it was not reconstructed from visible tool output. The corresponding `duo-port-<gate>-execution.json` files retain exact command strings, session IDs, tool chunk IDs, and start/finish UTC times.

Exact payload commands (each tee target was the unique absolute evidence path named above):

```sh
VITEST_MAX_WORKERS=1 npm run test -- tests/unit/dry-run-scenario-composition.test.ts
VITEST_MAX_WORKERS=1 npm run test -- tests/unit/dry-run-scenario-composition.test.ts
VITEST_MAX_WORKERS=1 npm run test -- tests/unit/browser-session-factory.test.ts -t 'refuses to launch when the Duo extension or credential is not ready'
/usr/bin/lockf -k -t45 /tmp/hr-worktree-light-gate.lock npm run typecheck
/usr/bin/lockf -k -t45 /tmp/hr-worktree-light-gate.lock npm run lint
```

Commands were serial and every shell command explicitly used `/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4`.

## Default omission and security review evidence

- `src/cli.ts:21–31` still passes the production runtime creator without a Duo override.
- `src/server/dry-run-scenario/compose.ts:59–65,97–104` still types and supplies only isolation, repoRoot, env, clock, and ids to that creator.
- Runtime forwarding at `runtime.ts:173` omits the property when undefined; it does not create a default factory.
- `src/server/worker/compose.ts:225,445–450` retains its existing optional seam and exact `input.duoCeremony ?? composeDuoCeremonyGateFactory(...)` default.
- `src/core/duo-ceremony-gate.ts:363–380` still resolves registered credential identity when Duo WebAuthn is enabled. Neither credential checks nor feature flags changed.
- `tests/unit/fixtures/duo-ceremony-fixtures.ts:36–78` retains the existing synthetic fingerprint and lazy temporary authority database. It delegates to the real gate factory using `database.authority.duoCeremonyLeases`; it does not bypass lease ownership with an in-memory token.
- A search of unit tests found no direct import/use of `composeDuoCeremonyGateFactory` or `duoCeremonyCredentialKey`. Default omission is therefore supported here by the actual initial missing-credential stacks plus unchanged caller/default source and the existing readiness-refusal test, not claimed as a newly added post-port omission regression.

No live authentication, browser, or operator credential access/provisioning command was run. The expected red itself attempted normal registered-file resolution and failed at the missing path.

## Frozen identities

HEAD remains `eda17b2708286e36542e1e18e9f8ef6a06cf3187`.

| Scoped file | Before SHA-256 | After SHA-256 | Delta |
| --- | --- | --- | --- |
| `src/server/dry-run-scenario/runtime.ts` | `d4b168c62bc0081c3930cfc3ee5ed1cd24148cd471e6dbc9a254f8283b2fcb63` | `d745bad8399767640b730a6787c9794ada474f9661afb1659f8aab6471fafcfa` | +4/−0 |
| `tests/unit/dry-run-scenario-composition.test.ts` | `c3d188b28fafd8370618d78d1e48772a55423cd3fbd5e2ded932b20e455c8965` | `f47721d4384a347bfbb345f602c98bb4ce1486d45a34213630a74fadb8ee18eb` | +3/−0 |
| `AGENTS.md` | `a7acd7d280dc1a0bcf84b9447f10ea21687f5596f8ded2f198cc4171087b5588` | `fc6dfe830fb7afcf8f3ac062cec3b96c7af616f4acc4dba5a2a13630264f943f` | +7/−0 |

- Incremental A7 patch SHA-256: `9cd4f02311494bb83fbe4028028d2d1ae90336208f8a746f6b2611e210a04af9` — [exact delta](../evidence/dca4-gates/duo-port-delta.patch).
- Current `git diff HEAD` over the three scoped paths SHA-256: `f66c6a610d640579757c229dedafe005941395323cf9c74cfb2dcd00617f213a`. This includes inherited root/test changes and is **not** the isolated A7 patch.
- Byte-exact before files and [fresh before identity](../evidence/dca4-gates/duo-port-before.json) were retained before the first test/edit. The [source patch](../evidence/dca4-gates/duo-port-source-845.patch) is the exact approved upstream two-file diff.
- [After identity](../evidence/dca4-gates/duo-port-after.json) retains all companion hashes, gate records, and comparison results. Verification tool chunk `acd27d`, exit 0.
- Protected tracked/untracked `src tests scripts config AGENTS.md` file set, excluding only these exact three A7 paths: **1626**, compact sorted path→SHA JSON digest `95ad1eb76c8802d3c2588dc41d92f3a362cb7419b1cb7772dde9bb14cc6f35c9`, equal to before.
- UI7 aggregate remains `3c89958afe63d1b8c0b5b8e8d01fffff25e94d89a2cbbc517ec7b799cdb4d461`.
- Browser spec remains `e2c03cb1480d144a4e889e52e98f4dc302bcb4c51fa16042bd448ba35bbac1c0`, **23317 bytes**.
- CLI, dry-run command composer, worker composer, core gate, and existing fixture helper hashes are unchanged.
- Generated manifest remains `66d399b7cc1370018778a9101dd9fedd6dcc478b02bd35b214aabe60288a5a49`. No descriptor/domain/base source or descriptor import closure was edited; the server adapter adds a type-only core import. No manifest generation was necessary or run.
- `git diff --check` passed; protected comparison includes Archive source, spec, refs, shared helpers, and A6 implementation. No shared guard/materializer/PNG/HTTP fixture changes.

## Raw log identity

| Log | Bytes | SHA-256 |
| --- | --- | --- |
| red | 5556 | `b1b2b9efe45186d28c048cce368908b1a599e7ab7ce3721247c7e8769b3b1fc5` |
| green | 373 | `c85441c891a2960ea6aeb946b1a85baa7a1dd4b6ad3a2bb9357d0af27003e8eb` |
| credential-refusal | 441 | `0ab51cbf887feae48f7d7f3e27eb348ad390f66327255d513ddc3287c24f4ad6` |
| typecheck | 57 | `ffac772e97ce1b0aeb0f982c7ba9630aa798a27a12a6706d40b50bdb86f64036` |
| lint | 81 | `cfb3a35a240932c8cf36ee05be81eca1cb9e8bee2e2516b0ca6ee56a8d482385` |

## Return boundary

Pending logical commit category: hermetic dry-run composition seam, paired existing-fixture injection, and lesson. **No staging or commits performed.**

No browser, parity, reference update, coverage, build, auth provisioning, registry edit, DCC1 join, or other-branch fixture port. Earlier evidence/refs remain untouched. Full-candidate gates and parent independent review remain required and belong to the coordinator's next allocation. This return closes A7 implementation/light ownership, not DCA4 acceptance.
