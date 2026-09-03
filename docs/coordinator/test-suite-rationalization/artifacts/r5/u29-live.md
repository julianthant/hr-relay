# R5a u29 — T1b durable-authority audit (no live execution)

## Scope boundary

This audit read the two declarations, descriptor/runtime nodes, target registry, manifest loader,
architecture guards, and recorded migration/roadmap evidence. It started **no browser and no
workflow**. Both files remain declarations named `dry-run.scenario.ts`, so no Vitest project imports
or executes them.

## Current authority

| Manifest / case | Collection | Registered target truth | Earliest result | Durable rehearsal claim |
| --- | --- | --- | --- | --- |
| `separations-kuali-finalization/dry-run` · `ordinary` | uncollected; loadable only through the explicit dry-run command | `finalization-canary` / `ordinary`; availability `gone`, last observed 2026-09-01 | `blocked` before environment resolution or browser composition | Reached path is four pre-approval reads → `approval` → `filing-presence` → `finalize-kuali`; conditional gate excluded; six checkpoints; 0 intent / 0 attempt / 0 outbox delta; partial/unknown receipt; stop-after-prepare with no external commit. |
| `separations/dry-run` · `nothing-to-sweep` | uncollected; loadable only through the explicit dry-run command | `finalization-canary` / `full-chain-dry-run`; availability `gone`, last observed 2026-09-01 | `blocked` before reading the ignored document-number environment reference or composing a browser | Reached path includes 13 read/fold nodes, `approval`, `pending-set`, then `clear-pending`; gate and downstream filing/finalization nodes excluded; 15 checkpoints; 0/0/0 durable delta; partial/unknown receipt; already-present live-probe preview declaration. |

The historical separations authority is not `met`: `docs/migrations/separations.md` §9.33 records a
failed pre-plan run with 0/0/0 write-family movement, and roadmap evidence records that Kuali action
4537 disappeared. `gone` therefore blocks; it must never be rewritten as a workflow failure or a
successful rehearsal.

## Stale graph delta found and corrected

| Manifest | D310/runtime node omitted before R5a | Correct declaration |
| --- | --- | --- |
| finalization | `filing-presence` | Reached after its dependency `approval`, checkpointed, and represented by one non-mandatory verified receipt obligation. |
| separations | `pending-set`; downstream `filing-presence` | `pending-set` reached/checkpointed/verified before `clear-pending`; `filing-presence` explicitly excluded/unknown downstream of the stop. |

The runtime-node completeness guard now derives each descriptor's exact node set and requires every
T1b case to partition it exactly once across reached/excluded nodes and to carry exactly one
`node.<id>` receipt obligation. It rejects missing, duplicate, unknown, and receipt-unaccounted
nodes.

## Red/green and no-write proof

- Controlled red: before manifest correction,
  `npx vitest run --project architecture --reporter=verbose tests/unit/architecture/test-target-registry.test.ts`
  failed the new runtime-node assertion; the diagnostic named `separations` and the missing
  `pending-set`/`filing-presence` nodes (`/tmp/r5a-u29-red.log`, 1 failed / 15 passed).
- Green after correction: the same file passed 16/16 (`/tmp/r5a-u29-green.log`); the final full
  architecture project passed 70 files / 705 cases.
- The no-write assertion is a per-run before/after delta across `write_intents`, `write_attempts`,
  and durable outbox rows joined through that run's intents. Existing authority rows cannot make a
  zero claim pass, and an unrelated run cannot contaminate it.
- `unknown` is retained for write-side receipt obligations because no external commit occurred;
  absence is used only for the conditional gate whose `when` is false.

## Future proof boundary

The present declarations are accurate but cannot record `met` without a fresh, documented canary
and an authorized live dry run. Selecting or changing that canary is product/live authority outside
R5a. This run made no availability claim, chose no replacement, and performed no live retry.
