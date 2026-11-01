---
name: hr-manage
description: >-
  The shared operations skill every workflow-specific HR skill is built on — Codex managing the Relay workflows and dashboard: bring the BFF + worker up correctly, start runs (dryRun default) for one subject or a whole cohort with N parallel workers, monitor (timeline, explain run, spans, storage doctor), take gate approvals, retry only real failures, refuse re-runs after an UNKNOWN submit, and close with a per-subject status table. Also covers dashboard/runtime housekeeping (ports, locks, orphan browsers, fingerprint check, notifications, archive). Invoke on `/hr-manage`, "run X for these people", "N parallel sessions", "start/restart the dashboard", "what's the status of the runs", "approve the gate", "monitor the batch".
---

# /hr-manage — run, batch, monitor, approve, report

The operator's standing rules, applied without being told: **dryRun=true by default**, **proof from authority or the source system — never from a log line or an empty grid**, **one subject first before fanning out**, **never re-run a subject whose last submit ended UNKNOWN until the source system says what happened**, **live access is pre-authorized — never ask**, **never push**.

For a named workflow, apply `hr-workflow`'s short-id rule and read the exact existing
`.agents/skill-library/hr-<short-id>/REFERENCE.md` before operating it. Do not select a workflow
resource by recency or fuzzy name; when the exact resource is absent, read the descriptor directly.
Browser operations read `~/.agents/skill-library/playwright-cli/REFERENCE.md`. Platform defects read
`.agents/skill-library/hr-debug/REFERENCE.md` before forming a theory.

## 1 · Bring the stack up (and know it is the right stack)

```bash
playwright-cli list                                           # identify sessions; close only sessions owned by this task
ls .tracker/locks/                                    # D181 role locks: server / worker — a stale pid here explains "already running"
npm run dashboard                                              # ONE terminal: BFF :3938 + vite :5174 (Ctrl+C stops both); BFF alone: npm run cli -- dashboard
npm run build:manifest && git diff --quiet src/workflow-kit/validation/generated-build-manifest.ts || echo "TREE MOVED — restart the BFF"
npm run cli -- worker <workflow-id> --pool-index 1 [--drain]   # one worker; batch pool indices must be admitted and distinct (1–3), see §3
npm run cli -- storage doctor                                  # authority + span reconciliation (+ backup report) before a batch
npm run cli -- storage backup                                  # the ONLY way a verified SQLite backup is written (D322)
```
The BFF is a singleton (pinned port + lock). A BFF started before a descriptor edit serves the OLD fingerprint and `run-executor` refuses every run it plans — restart it (hr-debug §stale-bff). Isolation: `.tracker/`, ports 3938/5174, session namespace `hrauto-rebuild` — never legacy's.

## 2 · Start a run (one subject)

- **Dashboard**: `playwright-cli -s=mgr open http://localhost:5174` → run modal → the descriptor's declared entry shape (`surfaces.inputRun`; examples are shown in the modal) → confirm with `dryRun` checked. Screenshot the confirmation.
- Start and confirm through the signed-in dashboard. Do not call backend HTTP endpoints directly.
- Subjects by LABEL (`config/test-data.json` → `subjects`), private values from ignored `config/test-data.local.json` via `src/backend/app/registries/test-data.ts` (D341); check with `npm run cli -- test-data check --json --subject <label>`; missing → `blocked: needs <label>`.
- A REAL write (`dryRun=false`): only under `ref write-safety` with the operator's explicit authorization for that run/subject/document, stated in the conversation; say it back before you send it.

## 3 · Batch / cohort (the "do these N" request)

1. **Worklist first.** Build it once from what the operator gave (names/EIDs/doc numbers) or from an intake artifact (hr-scan). Do not re-download a roster you already have. Print the worklist as a table with a row id per subject.
2. **One first.** Run subject #1 alone, read its result, fix the systemic error if there is one. Then fan out.
3. **Fan out.** Use at most three worker processes for the workflow. Give each a distinct admitted `--pool-index` from 1 to 3 (`npm run cli -- worker <id> --pool-index <index>`). Queue all items; or use N dashboard sessions when the operator says "sessions". Keep N to what the operator said; default 3 if they said "parallel" without a number.
4. **Monitor** (§4) until every row is terminal or parked.
5. **Retry only genuine failures**: a `failed` with a cause you fixed → `retry` (new attempt, same item — D221). `parked-write` / `unknown` → NOT a retry: resolve via the parked-write panel or `ref write-safety` §4.1 after the source system is checked. A subject whose submit state is UNKNOWN is frozen until you (or the operator) confirm existence in the source system.
6. **Close** with the table in §5.

## 4 · Monitor

| Question | Where |
|---|---|
| What happened in run X | `npm run cli -- explain run <traceId\|runId> [--json]` — authority, not logs |
| Live timeline / queue / gate | dashboard (playwright-cli snapshot + screenshot); the run-detail panel holds the failure record + evidence receipt |
| Raw events | `.tracker/spans/*.jsonl` (grep run id); a torn last line is an in-flight append, not corruption |
| Durable truth | `run_checkpoints`, `gate_results`, `write_intents`, `write_attempts`, `durable_outbox` — what a dry run must leave at 0 |
| Alerts | the notification bell / inbox (storage-degraded, needs-you); the storage banner for authority-unavailable |
| Health | `npm run cli -- storage doctor [--json]`; worker log lines; locks dir |

A gated run parks: approve only through the dashboard ceremony. The approval shape is computed server-side; the packet leads with disconfirming evidence — read it, don't rubber-stamp.

## 5 · The status table (always, at the end — and on request mid-batch)

| # | subject (label) | run / trace | attempt | state | gate | write intent | result / txn id | next action |
|---|---|---|---|---|---|---|---|---|

States from authority (`queued · claimed · running · parked · done · failed · cancelled`), never from memory. "Done" rows cite the receipt / read-back; "failed" rows cite the failure record's `code`; parked rows name the human decision required. Nothing is summarized as "all good" without this table.

## 6 · Housekeeping

- Stop: Ctrl+C the dashboard terminal; `--drain` a worker; close only task-owned browser sessions; confirm `.tracker/locks/` is empty of live pids (`kill -0`).
- Archive / activity: the archive model is append-only (v13 tables abort UPDATE/DELETE) — apply re-derives blockers in its own transaction; a refused apply is normal when a run went queued in between.
- Backups are written only on command (`storage backup`, D322) — take one before a real write; `storage doctor` reports the latest but no longer gates on it; `storage restore --from <manifest>` only stopped-system and only when the operator says so.
- Anything that smells like a platform defect → `.agents/skill-library/hr-debug/REFERENCE.md`; a
  repeatable gotcha → keep its lasting rule in the owning reference and nearest module `AGENTS.md`; system drivers use `src/backend/systems/<system>/AGENTS.md`.
