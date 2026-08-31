# DCC4 M3E — deterministic Duo fixture seam

## Scope

Ported the bounded DCC4 composition-test seam from
`845ca5a115ee6eef3e10598e88ea0a7fdf361888` (original source
`964c9636e291510be58175246759b724d1c257c9`):

- `ProductionDryRunScenarioRuntimeInput.duoCeremony?`, typed as
  `DuoCeremonyGateFactory`, is forwarded to `composeWorkerRuntime` only when
  present.
- The two deterministic composed-drain fixtures inject
  `fixtureDuoCeremonyGates(clock)`.
- `AGENTS.md` records that production CLI omission retains the credential-backed,
  fail-loud production factory.

No production CLI, core Duo/auth implementation, wire contract, historical
assertion, timeout, or live execution changed.

## Focused evidence

Command, in the assigned DCC4 worktree:

```sh
VITEST_MAX_WORKERS=1 npx vitest run tests/unit/dry-run-scenario-composition.test.ts --maxWorkers=1
```

Red before the port: exit 1; `1 failed` file, `2 failed | 6 passed` tests.
Both failures were the expected fail-loud missing `duoWebauthnCredential` at the
registered rebuild credential path while the synthetic worker drain composed the
real Duo factory. Retained sanitized output:
`docs/coordinator/worktree-completion/evidence/dcc4-duo-red.log`.

Green after the port: exit 0; `1 passed` file, `8 passed` tests. Retained output:
`docs/coordinator/worktree-completion/evidence/dcc4-duo-green.log`.

The source diff is clean. Supervisor removed only the final blank line from each
retained Vitest log so the evidence also passes `git diff --cached --check`;
diagnostics, counts and timings are unchanged. No credentials were provisioned, printed, or used;
no live database or HR system was contacted.

## Handoff state

Changes are staged only; no commit was made. Existing staged merge work and
supervisor reports were preserved. The worktree remains on
`HEAD 49c6206cbc3d3e30e97603628590823787d120d8` with
`MERGE_HEAD 13175b13340fec7b5326207fe54f98078d481d7d`.
