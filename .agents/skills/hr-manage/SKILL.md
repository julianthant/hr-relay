---
name: hr-manage
description: >-
  The shared operations skill every workflow-specific HR skill is built on — managing the Relay dashboard and its workflow runs: start and stop the dashboard runtime, start runs (dryRun default) for one subject or a cohort through the signed-in dashboard, monitor (Logs, explain run, Settings storage section), take gate approvals, retry only real failures, refuse re-runs after an UNKNOWN submit, and close with a per-subject status table. Also covers runtime housekeeping (ports, locks, orphan browsers). Invoke on `/hr-manage`, "run X for these people", "start/restart the dashboard", "what's the status of the runs", "approve the gate", "monitor the batch".
---

# /hr-manage — run, batch, monitor, approve, report

The operator's standing rules, applied without being told: **dryRun=true by default**, **proof from authority or the source system — never from a log line or an empty grid**, **one subject first before fanning out**, **never re-run a subject whose last submit ended UNKNOWN until the source system says what happened**, **live access is pre-authorized — never ask**, **never push**.

For a named workflow, apply `hr-workflow`'s short-id rule and read the exact existing
`.agents/skill-library/hr-<short-id>/REFERENCE.md` before operating it. Do not select a workflow
resource by recency or fuzzy name; when the exact resource is absent, read the descriptor directly.
Browser operations read `~/.agents/skills/playwright-cli/SKILL.md`. Platform defects read
`.agents/skill-library/hr-debug/REFERENCE.md` before forming a theory.

## 1 · Runtime commands

Every command runs from the checkout that owns the store and ports. `npm run cli` is the only CLI entry point; `npm run cli -- help` lists it.

| Purpose | Command |
|---|---|
| Dashboard: backend + Vite, one terminal | `npm run dashboard` (Ctrl+C stops both) |
| Backend alone / Vite alone | `npm run backend` / `npm run web` (start the backend first) |
| Production bundle | `npm run web:build`, then `npm run dashboard:prod` |
| Active isolation (state root, ports, namespace) | `npm run cli -- phase` |
| Authority and storage health | Settings, signed in: the served storage section |
| Explain a run from authority | `npm run cli -- explain run <traceId\|runId> [--json]` |
| Persisted diagnostics | `npm run cli -- explain diagnostics [--run <runId>] [--json]` |
| Subject readiness by label | `npm run cli -- test-data check --json --subject <label> [--workflow <id>]` |
| Transaction history | `npm run cli -- storage transactions --from YYYY-MM-DD --to YYYY-MM-DD [--system SYSTEM] --output PATH` |

`dashboard`, `backend` and `cli` prepare the ignored workflow manifest first. Ports, state roots and the session namespace come from `config/runtime-isolation.json` (backend 3938, Vite 5174, namespace `hrauto-rebuild`); never use legacy's.

## 2 · Bring the stack up (and know it is the right stack)

```bash
playwright-cli list                       # identify sessions; close only sessions this task owns
LOCKS="$HOME/Library/Application Support/Relay/.tracker/data/locks"   # Windows: %LOCALAPPDATA%\Relay\.tracker\data\locks
ls "$LOCKS"; lsof -nP -iTCP:3938 -iTCP:3939 -iTCP:5174 -sTCP:LISTEN   # a stale pid or busy port explains "already running"
npm run dashboard                         # ONE terminal; wait for "dashboard BFF listening on 127.0.0.1:3938"
```

The backend is a singleton (pinned port + lock). A backend started before a workflow-definition edit serves the old fingerprint and refuses every run it plans: restart it (`hr-debug` §Runtime). Dashboard boot never launches a worker; Run, Rerun and Sessions › Add workers do.

Settings › Preflight shows the served capability checks. Run it from the signed-in dashboard before live work; it runs no OCR and starts no run.

## 3 · Start a run (one subject)

- **Dashboard**: `playwright-cli -s=mgr open http://localhost:5174` → sign in → Run → the workflow's declared entry shape (the modal shows examples) → Confirm shows the exact input, options and step plan → Start with `dryRun` checked. Screenshot the confirmation.
- Run and Rerun offer no worker choice: they use the workflow's live workers and start one when none is live.
- Start and confirm through the signed-in dashboard. Do not call backend HTTP endpoints directly.
- Subjects by LABEL (`config/test-data.json` → `subjects`); private values live in the ignored `config/test-data.local.json` and are read only through the typed reader. Check with the `test-data check` command above; an unavailable label → `blocked: needs <label>`.
- A REAL write (`dryRun=false`): only under `ref write-safety` with the operator's explicit authorization for that run/subject/document, stated in the conversation; say it back before you send it.

## 4 · Batch / cohort (the "do these N" request)

1. **Worklist first.** Build it once from what the operator gave (names/EIDs/doc numbers) or from an intake artifact (`hr-scan`). Do not re-download a roster you already have. Print the worklist as a table with a row id per subject.
2. **One first.** Run subject #1 alone, read its result, fix the systemic error if there is one. Then fan out.
3. **Fan out.** Queue all items through the dashboard Run surface (or its spreadsheet intake). For more parallel workers, use Sessions › Add workers with the count the operator named; default 3 if they said "parallel" without a number.
4. **Monitor** (§5) until every row is terminal or parked.
5. **Retry only genuine failures**: a `failed` row with a cause you fixed → the dashboard's Retry (new attempt, same item). A parked write or `unknown` is NOT a retry: resolve it through the dashboard after the source system is checked (`ref write-safety`). A subject whose submit state is UNKNOWN is frozen until you or the operator confirm existence in the source system.
6. **Close** with the table in §6.

## 5 · Monitor

| Question | Where |
|---|---|
| What happened in run X | `npm run cli -- explain run <traceId\|runId> [--json]` — authority, not logs |
| Live timeline / queue / gate | dashboard (playwright-cli snapshot + screenshot); Logs holds the failure record and evidence receipt |
| Failure details | `npm run cli -- explain diagnostics --run <runId> --json`; stopped boot faults: `explain diagnostics --boot` |
| Alerts | the notification bell / inbox (storage-degraded, needs-you); the storage banner for authority-unavailable |
| Health | Settings' storage section; worker log lines; the lock directory above |

A gated run parks: approve only through the dashboard ceremony. The approval shape is computed server-side; the packet leads with disconfirming evidence — read it, don't rubber-stamp.

## 6 · The status table (always, at the end — and on request mid-batch)

| # | subject (label) | run / trace | attempt | state | gate | write intent | result / txn id | next action |
|---|---|---|---|---|---|---|---|---|

States come from authority (`explain run` and the dashboard), never from memory. "Done" rows cite the receipt / read-back; "failed" rows cite the failure record's `code`; parked rows name the human decision required. Nothing is summarized as "all good" without this table.

## 7 · Housekeeping

- Stop: Ctrl+C the dashboard terminal (a clean shutdown drains workers and writes the shutdown backups); close only task-owned browser sessions; confirm the lock directory (§2) holds no live pid (`kill -0`) and ports 3938/3939/5174 are free.
- Backups are automatic at clean shutdown and before an upgrade; there is no backup command. `storage upgrade` runs only stopped and only when the operator says so.
- Orphan browsers: `playwright-cli list`, close your own sessions by name; never close another task's.
- Anything that smells like a platform defect → `.agents/skill-library/hr-debug/REFERENCE.md`; a
  repeatable gotcha → keep its lasting rule in the owning reference and nearest module `AGENTS.md`; system drivers use `src/backend/systems/<system>/AGENTS.md`.
