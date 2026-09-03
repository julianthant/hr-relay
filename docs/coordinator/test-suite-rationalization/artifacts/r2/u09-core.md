# R2 u09 — core planning, execution, commands, and projections

## Owned ledger

This family owns 15 files / 219 tests: `command-kernel` and `command-kernel-step-omission-carry`;
`dry-run-scenario-runner`; `run-executor`, `run-executor-capability-wiring`,
`run-executor-control-nodes`, and `run-executor-step-omission`; `run-fan-out-step-omission`;
`run-result` and `run-result-step-omission`; `retry-item-attempt`; `intake-command-arms`; `edit-data`;
`start-plan`; and `start-step-selection`. All paths are under `tests/unit/` and end in `.test.ts`.

The primary public seams are `createCommandKernel`, `executeClaimedRun`, `planStart`, and
`projectStartSteps`. Their distinct failure risks are command admission/CAS/idempotency, executor
capability and checkpoint wiring, omission carry across plan/enqueue/retry/result, retry-attempt
identity, and Edit Data authority.

## Disposition

- Retain every case. D307 assertions in planner, command kernel, fan-out, executor, and result are
  repeated facts at different public boundaries, not duplicate tests of one boundary.
- `intake-command-arms` now names its mapping refusal as a command-level pre-mutation guarantee;
  this distinguishes it from the pure `confirmBinding` refusal in `intake-mapping.test.ts`.
- The worker-browser arm in `command-kernel.test.ts` retains only authority-before-runtime behavior
  here. Process effects and primary server/runtime/worker/session tests are exact R3 residue.
- `diagnostic-capture`, `diagnostic-safety-projection`, and `notification-inbox` are cross-owner
  operator-trust/storage files, not u09 consolidation candidates.

## Proof

The Scout's explicit 15-file run passed 15/15 files and 219/219 tests in 5.71 seconds with verbose
project/file/full-title output. No core production behavior changed.
