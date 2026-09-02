# R4a rehearsal evidence

Date: 2026-09-02 (America/Los_Angeles)

## Runtime admission

- Base admitted: `e8cd9dc5`; current separations descriptor fingerprint served by the dashboard: `a6a1600a4398f7caa9d14f14821a9abc606de603ed2a3e83af58d99c72e1d81a`.
- Dashboard endpoints responded before the run: BFF `127.0.0.1:3938`, Vite `127.0.0.1:5174`.
- Initial authority state was healthy, schema 29, and span authority was reconciled.
- The operator explicitly waived the wait for a current backup before the retry. The authority remained healthy and spans reconciled; backup staleness is recorded as residue rather than hidden.

## Candidate inspection

Read-only Kuali inspection was limited to the operator-supplied sequence `4593, 4579, 4564, 4544, 4502, 4495`. All six documents were present in the Action List. Document `4579` was the first viable non-future candidate in that sequence and was selected for the submit-free rehearsal. Exact person values and live fields remain in the ignored restricted artifact named in the report.

Read-only UCPath inspection confirmed that the supplied EID for document `4579` resolved to a current employment record. This pre-run check did not replace the workflow's D309 durable machine-verification node.

## Attempt 3 — brief-authorized rehearsal

- Run: `0bb750ee-3cc3-4bf2-86ec-f916323da412`
- Trace: `sp-120825-0bb7`
- Attempt: 3
- Mode: `dryRun=true`, headed browser, captures enabled, ordinary steps included
- Terminal result: failed at New Kronos `timecard-search`
- Failure code: `EMPLOYEE_NOT_FOUND`
- Write state: `not-attempted`
- Open gate: absent

The dashboard-start confirmation visibly said “Dry run: On.” One dashboard start and one supported separations worker drain were used. The New Kronos page returned its explicit empty-result sentinel.

## Attempt 5 — operator-authorized retry

After the first terminal result, the operator directly superseded the brief's no-retry boundary with “try again” and then explicitly waived the backup wait. The retry used the dashboard's `Run again` command on the same item; no new subject was introduced.

- Run: `6d1746f5-cfb6-49a4-9ccc-2cdccbda25da`
- Trace: `sp-122139-6d17`
- Attempt: 5 (attempt 4 already existed as a cancelled history row before this retry)
- Mode: `dryRun=true`
- Terminal result: failed at New Kronos `timecard-search` after 34 seconds
- Failure id: `170cb768-3502-4972-8777-7ac2682549f3`
- Failure fingerprint: `229736d37c06b88c262d7a1345c02da7a5c744535ce1998208d1dcbdd2e1bac2`
- Failure code: `EMPLOYEE_NOT_FOUND`
- Same fingerprint seen: 4
- Write state: `not-attempted`
- Open gate: absent
- Receipt: `8a09a747-8c86-5c55-b24f-5e1e58ff556f`, result `failed`, confidence `unknown`

The run's own restricted capture shows the authenticated New Kronos home page and open Employee Search panel. It is not a login screen: the page displays the logged-in welcome state, while the employee query result says “There are no items to display.” This independently rules out Wi-Fi/login as the terminal cause for attempt 5.

## Node truth

The attempt-5 receipt records these nodes verified from durable authority: `resolve-action`, `document`, `plan`, `termination-type`, `name-search`, `subject`, `job-summary`, `employment`, and `department-option`.

`timecard-search` and all later nodes are unknown/not reached because the explicit New Kronos employee lookup failed: `timecard`, `dates`, `comparison`, `identity-approval`, `approval`, `pending-set`, `clear-pending`, `file-termination`, `receipt`, `filing-presence`, and `finalize-kuali`.

The explain record reports no open gate and no durable dependency. Because D309 `identity-approval` was not reached, this run proves neither the supplied/read-back machine-verification arm nor the name-only parked-gate arm. Because D310 `pending-set` was not reached, it supplies no exact eligible/protected termination set.

## Document 4502 — operator-selected replacement

The operator then selected Kuali document `4502` and asked that the headed browser fit the screen. Through the dashboard Settings surface, `display.screenWidth` / `display.screenHeight` were saved as `1440` / `900`, and the dashboard was cleanly restarted with no active worker. The restarted Settings surface showed the persisted values with no restart warning. Every run-owned capture for this attempt reports dimensions `1440 × 900`.

- Run: `05d9d8fa-22e0-4b5c-9e38-2df095162284`
- Trace: `sp-122836-05d9`
- Attempt: 3 for match key `separations:4502`
- Mode: `dryRun=true`, headed browser, captures enabled, ordinary steps included
- Terminal result: failed after the live New Kronos timecard read
- Failure id: `3a7959e9-c230-44ae-8c8c-0cd3e5d32278`
- Failure fingerprint: `d0e11f1e85783ee4067addac7c971b8963a145dbffaac248b535bcccf0591644`
- Failure code: `UNHANDLED`
- Exact diagnostic: `[workflow:separations/read-separation-dates] unhandled: task workflow:separations/read-separation-dates has no recorded provenance for output field source`
- Write state: `not-attempted`
- Open gate: absent

Fresh live observations reached `resolve-action`, `document`, `plan`, `termination-type`, `name-search`, `subject`, `job-summary`, `employment`, `department-option`, `timecard-search`, and `timecard`. The restricted terminal browser capture shows the authenticated New Kronos Employee timecards grid for the resolved person at 1440×900, establishing that both login and employee lookup succeeded.

`dates` and `comparison` were replayed from the prior attempt-2 checkpoint. The failure occurred because that replayed `dates` checkpoint lacks required provenance for output field `source`. `identity-approval` and `pending-set` have no record; all write/finalization nodes remained not reached. This is a code/data-authority defect, not a live-system outage and not a reason to retry the same unchanged item.

## Submit-free invariant

After the 4502 attempt, direct authority counts were:

| Authority table | Global rows | Rows bound to attempt-5 run |
|---|---:|---:|
| `write_intents` | 0 | 0 |
| `write_attempts` | 0 | 0 |
| `durable_outbox` | 0 | 0 |

The worker exited cleanly with `stopped: idle` and outcome `failed`. The post-run doctor reported healthy authority, schema 29, reconciled span authority with 24 stream runs and 24 live runs, zero pending commands, zero unresolved write intents, and zero durable outbox rows. Backup staleness remained visible as explicitly accepted operator residue.

## Span evidence

The attempt-5 restricted span extract contains 5 lines / 2,035 bytes and has SHA-256 `7d1275e0ecda6faade9944e5d2f68533e906cf30a11b1a01714f460e7b7da129`. The containing day stream had 59 lines / 39,046 bytes at collection and SHA-256 `5c66224a575f7707c7a912ccd088855aa8665c09d8ea06b74a31b1ac6b507b32`.

The 4502 restricted span extract contains 39 lines / 38,123 bytes and has SHA-256 `3d9e0edddb83d1be60c7c2253ec1f1df537d557c20dcd8e67e5b6fb3cd7af6e2`.
