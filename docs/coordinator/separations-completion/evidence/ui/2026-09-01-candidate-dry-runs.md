# Sanitized UI evidence — Separations candidate dry-runs — 2026-09-01

The operator supplied document numbers 4589, 4588, 4579, 4564, 4544, 4502 and 4495. The dashboard
started every item with `dryRun=true`; one worker proved the first item before the remaining six
were drained by three pool members. This manifest contains no captured person value. The restricted
screenshots remain local under `.screenshots/separations-2026-09-01/` and are excluded from git.

| Document | Run / trace / attempt | Durable stop | Exact-run write authority |
|---|---|---|---|
| 4589 | `ca6a5462-4e52-43b7-ac85-f9bdb7fd30cf` / `sp-155454-ca6a` / 1 | terminal `done` after operator identity approval; `clear-pending` preview settled `already-present`; receipt `0fa49971-bd6a-5a80-8c23-6392614d46c7` | 0 intents / 0 attempts / 0 outbox |
| 4588 | `cb6aa949-a387-4d1a-9b90-29ba3e14121d` / `sp-155717-cb6a` / 1 | terminal `CONCURRENT_ACTIVE_EMPLOYMENTS`, write state not-attempted | 0 / 0 / 0 |
| 4579 | `ed18da2f-7025-4e99-a803-43c81e5b0a02` / `sp-155717-ed18` / 1 | terminal `EMPLOYEE_NOT_FOUND`, write state not-attempted | 0 / 0 / 0 |
| 4564 | `a071bce2-704f-4724-aae6-310bdd98ba02` / `sp-155717-a071` / 1 | terminal `SEPARATION_DATE_IN_FUTURE`, write state not-attempted | 0 / 0 / 0 |
| 4544 | `d78ca17d-55d6-42cc-8e2b-fcb69b7dd89c` / `sp-155717-d78c` / 1 | terminal `SEPARATION_DATE_IN_FUTURE`, write state not-attempted | 0 / 0 / 0 |
| 4502 | `1e513fbd-9249-421e-841a-d88c7edfbef8` / `sp-155717-1e51` / 2 | `parked-gate` at `identity-approval`; historical approval checkpoint visible but not accepted as this run's identity decision | 0 / 0 / 0 |
| 4495 | `178b9f34-647f-420f-a072-aafcfda4b4eb` / `sp-155717-178b` / 1 | terminal `SEPARATION_DATE_IN_FUTURE`, write state not-attempted | 0 / 0 / 0 |

UI verification used `http://localhost:5174`, selected the exact run by durable run id, and viewed
the Logs tab beside the Run data rail. `capturedValue: false`: the committed proof records only that
the surfaces rendered. Logs showed redacted `data.observed` rows for every step reached. After the
operator resolved 4589's identity gate, an explicit worker drain resumed the run to its preview
terminal and the refreshed dashboard rendered its dry-run receipt. The Run data rail remained
empty, including for the settled 4589 run and the runs that reached comparison/identity review; that
rail is the checkpoint/edit ledger, not the observed-log projection, but its current sentence says
the run has not extracted any fields and is misleading for these runs.
