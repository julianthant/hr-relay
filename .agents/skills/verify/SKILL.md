---
name: verify
description: >-
  Drive Relay's dashboard (BFF :3938, Vite :5174) in a visible browser to prove a workflow or dashboard feature works, ending in a live dry run with evidence. Use before a workflow PR merges, for "verify X", "do the dry run", "prove it in the app", or "run the sign-off walkthrough". The operator does the login and Duo; the run is dryRun=true only.
---

# /verify — live dry run of Relay through the dashboard

Proves a change the way the operator uses it: sign in, Run, read Logs, check the result. Read-only and `dryRun=true` only. Start and stop through `.agents/skills/hr-manage/SKILL.md`; browser commands follow `~/.agents/skill-library/playwright-cli/REFERENCE.md`. Features and their passing states: [features/README.md](features/README.md).

## Rules

- The operator types the password and answers Duo. You never type, read, log, screenshot, `state-save` or `eval` credentials or login-form values.
- `dryRun` stays checked. No UCPath submit, no Kuali finalization, no gate approval, no real-write retry, no `Finish` in sign-up. Anything that would cross a write boundary: stop, screenshot, report.
- One instance per machine: state lives in `~/Library/Application Support/Relay`, ports 3938/5174 are fixed. Never run beside another checkout's dashboard or against a store you do not own. A busy port or live lock means stop and ask.
- Use only subject labels from `config/test-data.json`. Never print private values from `config/test-data.local.json`.
- Close only browser sessions and processes you started.

## Launch

With the dashboard stopped, run `npm run verify:prelogin` before `npm run dashboard`. Start only with `npm run dashboard`. Never start the BFF and Vite by hand.

```bash
EVID=/Users/julianhein/Projects/hr-relay/.work/verify/<workflow>-$(date +%F)   # evidence survives cleanup
mkdir -p "$EVID"
LOCKS="$HOME/Library/Application Support/Relay/.tracker/data/locks"   # Windows: %LOCALAPPDATA%\Relay\.tracker\data\locks
lsof -nP -iTCP:3938 -iTCP:3939 -iTCP:5174 -sTCP:LISTEN; ls "$LOCKS"   # all empty, else stop
nohup npm run dashboard > "$EVID/dashboard.log" 2>&1 & echo $! > "$EVID/dashboard.pid"
until grep -q "dashboard BFF listening" "$EVID/dashboard.log"; do sleep 2; done  # read only for readiness
playwright-cli -s=verify open http://localhost:5174 --headed
```

No separate worker step: dashboard boot launches no worker; Run starts the workflow's worker when none is live (Sessions › Add workers adds more).

Start from the checkout that is meant to be previewed (`staging` or the PR branch in the main checkout); `.worktrees/` checkouts share the store and ports, so use them only when the operator says so.

## Doctor (read-only; run first, and again whenever something looks off)

```bash
npm run cli -- phase                       # state root, ports, namespace are Relay's, not legacy's
npm run cli -- test-data check --json --subject <label>   # the subject is available (names only)
playwright-cli list                        # sessions you do not own are left alone
```

After sign-in, open Settings › Preflight and Run preflight, and read the storage section; screenshot both. Preflight runs no OCR and starts no run.

## Hand over for login

Wait until the sign-in page shows the sign-in form, not a named refusal. If `GET http://127.0.0.1:3938/api/v1/profile/state` reports `resumable: true`, press Resume and confirm the dashboard opens. Ask the operator only when sign-in needs the password.

1. `playwright-cli -s=verify snapshot` of the signed-out page only.
2. When the password is required, tell the operator: "Sign in and approve Duo in the open window; say done." Take no snapshot, screenshot or `eval` until they do.
3. After the dashboard is open: snapshot, confirm the signed-in dashboard, screenshot to `$EVID/00-signed-in.png`.

## Drive a dry run

Per the feature file: Run → workflow → input → Confirm (read the exact input, options and step plan; screenshot) → Start with `dryRun` checked → watch Queue and Logs by snapshot until the run is terminal or parked. A parked gate waits for the operator; never approve it for them. Locate elements by snapshot refs, never coordinates. Do not call backend HTTP endpoints.

## Evidence

Under `$EVID/`:
- `NN-<step>.png` screenshots: Confirm screen, Queue row, each Logs step list, the result;
- `run.md`: workflow, subject label, run ID and trace ID, start/end time, terminal state, the Logs steps in order, the result as shown;
- `explain.json`: `npm run cli -- explain run <runId> --json`; plus a Settings storage-section screenshot after the run.

Proof standard: the run came from the real Run path; Logs show every declared step with its dry-run state (Previewed, Not clicked, Skipped with reason); `explain run` shows no write attempt or submit receipt; the source system's record is unchanged. Mock-served data, an empty grid or a log line alone proves nothing.

## Cleanup

```bash
playwright-cli -s=verify close
kill -INT "$(cat "$EVID/dashboard.pid")"      # npm forwards it; waits for the clean shutdown
LOCKS="$HOME/Library/Application Support/Relay/.tracker/data/locks"
lsof -nP -iTCP:3938 -iTCP:3939 -iTCP:5174 -sTCP:LISTEN; ls "$LOCKS"   # empty
```

Leave `$EVID/` in place. Report: workflow, run ID, pass/fail per the feature file, evidence path, anything not checked.
