---
name: hr-debug
description: 'Internal repo-specific debugging for Relay: selector/page-state repair via live probe, structural anchors, registry fix, live re-verification, and provenance; login/Duo/session problems; stale-singleton-BFF fingerprint; checkpoint-key and gate-resume collisions; span/projection gaps; guard/manifest failures; parity-lane lies; and a dry-run audit proving no submission node by node. Wraps global debug with fail-loud rules against longer waits, unverified fallbacks, and fixture-only repros.'
user-invocable: false
---

# hr-debug — this repo's failure classes, and the loop for each

The general debugging method is the global `debug` skill (gate → minimise → hypothesise → instrument → fix → regression test → cleanup); hr-debug is the repo-specific wrapper that adds this repo's failure classes, evidence sources, and forbidden first moves. Before hypothesising, name a red command you have already run — or build the feedback loop first. Read the reference that owns the failure class and the nearest module `AGENTS.md` before forming a theory; system-driver issues use `src/backend/systems/<system>/AGENTS.md`.

## 0 · Forbidden first moves
- "Add a longer wait / pollMs" before you have DISPROVEN timing (read the span timings; the operator has been burned: *"timing is not the cause, don't repeat that"*).
- A fallback, default, `??`, or swallowed catch to make the run pass — this repo's rule is fail loud; the silent-failure-hunter reviewer will refuse it anyway.
- Fixing legacy (`../hr-automation`) — it is frozen data; port with provenance, never edit.
- Reproducing only in a fixture when the failure was live: live access is pre-authorized — go look at the page.
- Touching another process's lock file or `.tracker` rows by hand to "unblock".

## 1 · Triage — what kind of failure is it?

| Symptom | Class → section |
|---|---|
| Playwright strict-mode violation, element not found, wrong element, wrong frame, "the field didn't take the value" | **Selector / page-state** → §2 |
| login smoke "passes" in 3 s, Duo burns the window, `PS_TOKEN` absent, every acquisition hits `sessionAcquireMs` | **Auth / session** → §3 |
| `ECONNREFUSED :3938`, worker refuses the run (`contractFingerprint` mismatch), "already running", run planned but never claimed | **Runtime / singleton** → §4 |
| immutable insert refused on `run_checkpoints`, gate resume fails one node past approval, retry impossible, attempt already spent | **Identity / checkpoint** → §5 |
| timeline empty or one event, fold collapses two executions, receipt 500, panel blank | **Projection / evidence** → §6 |
| `descriptor-coverage` red, guard-manifest mismatch, ratchet arm fires, typecheck red only in prod build | **Guards / build** → §7 |
| parity screenshot green but wrong, theme wrong, 2-px panel | **Parity lane** → §8 |
| "is the dry run really submit-free" / which workflows have a dry run | **Dry-run audit** → §9 |

## 2 · Selector / page-state repair (the loop — no shortcuts)
1. Read the run's failure record (`npm run cli -- explain run <id>`) and the store's screenshots under `.tracker/artifacts/…`; quote the exact error and the step.
2. `playwright-cli -s=dbg open "<url>"` headless with Duo Autopilot (`channel: chromium`); log in with `.env` creds; `playwright-cli --raw snapshot > /tmp/s.yml`; find the TRUE anchor.
3. Fix in the store driver / selector registry: **structural anchors first (`id`, `name`, role+accessible name), observed labels behind them; a no-match must refuse by NAME, never fall through** (`.or()` is a union under strict mode — it asserts the arms are exclusive; prefer `.first()`-settle + a pure verdict function, D213).
4. Port from legacy only with `// ported from hr-automation@<sha> <path>`; re-verify LIVE (D150 — live beats diffing legacy).
5. Re-run the failing step live; then the unit/scenario that pins it; `npm run build:manifest` if a descriptor closure moved.
6. `playwright-cli close-all`. Record the run id, anchor before and after, and live proof in the active brief's assigned evidence folder under the main checkout's `.work/`; keep lasting invariants in the owning module `AGENTS.md`.

Known traps on record: the count banner `#PTS_CRITTEXT_DISP` renders WITH the grid (D213); Kuali paints client-side (~1 s menubar, ~3 s heading, empty-heading decoys) — bound-wait for the fact; a Kuali `actionId` names a step, not a document — prove the document number from the h1; TritON renders one field under three labels — labels identify the realm; ui-grid virtualization terminates on coverage, not on `scrollTop` (D205); header names must come from the same container as the cells.

## 3 · Auth / session
- Authentication is proven by CONTENT (`PS_TOKEN` / `sid` + no sign-in form), never by URL (D120). A 3-second "success" is the public portal.
- Duo: the WebAuthn counter is per credential, shared across profiles — presented value must be `max(stored+1, nowSec)`; a refused profile is BURNT (only a fresh profile recovers) — read `docs/rebuild/reference/execution-and-sessions.md` and the nearest module `AGENTS.md` before changing Duo session state. "canceled or timed out" in ~1 s = the counter refusal, not a slow prompt.
- `sessionAcquireMs` (60 s) bounds the whole login chain; do not raise it to hide a dead session.

## 4 · Runtime / singleton
- BFF is ONE process (lock + pinned 3938). Compare SERVED vs TREE fingerprint: `curl -s localhost:3938/api/v1/explorer | jq '.[].contractFingerprint'` vs `src/workflow-kit/validation/generated-build-manifest.ts` after `npm run build:manifest`. Mismatch → restart the BFF; every run it planned is unclaimable.
- `ls .tracker/locks/` + `kill -0 <pid>` — a dead holder's lock is observed, never rewritten by you.
- Worker wedged at boot with its own old claim → D200 (lease is the evidence; sweep by workerId). A `claimed` row with an `attempting` intent is refused at startup by design — that is a §4.1 recovery, not a restart.

## 5 · Identity / checkpoint
- Key is `(workflow, item, node, attempt, claimGeneration?)` — a gate park+resume is TWO executions in one attempt (D214); a retry is a NEW attempt of the same item and must take the next unspent attempt from authority (D221). Never UPDATE/delete-reinsert a checkpoint; never advance the attempt by hand.
- Gate dependency ≠ gate packet (D211); gate result is not a checkpoint — readers carry `gateResults` (D203/D204).

## 6 · Projection / evidence
- The ONE live feed is the offset-aware disk tail (D218); an empty timeline with one `gate.resolved` = the old in-process hook shape. A torn trailing line is in-flight; a line shorter than the cursor throws (files don't shrink).
- Fold by `(attempt, spanPath)` (D123); a receipt that 500s usually cites an unemitted verification id (D187) or a re-derivation under a moved declaration (D199 — drop and re-derive the row as a recorded decision; no waiver arm).
- Run status joins authority; logs re-read notes JSONL — the surfaces BESIDE a broken one are what hide it.

## 7 · Guards / build
- `build:manifest` after ANY edit under a descriptor's import closure; `descriptor-coverage` diff = stale manifest.
- New guard = file + `docs/rebuild/guard-inventory.json` entry, same commit; retire only with a `retired` entry.
- A browser-reachable module importing `node:*` crashes dev and only warns in prod — never alias/stub; move the Node half to a server module (`dashboard-wire-boundary` prints the chain).
- `npm run typecheck && npm run lint && npm run test:coverage` is the gate; `--max-warnings 0`, no debt manifest.

## 8 · Parity lane
- References only change via `npm run test:parity:update`; theme is seeded through `addInitScript` + asserted (`assertThemeApplied`); a green a11y tree is not a visible panel (D187) — look at the PNG.

## 9 · Dry-run audit ("dry run means nothing gets submitted")
For a workflow (or all of them):
1. From the descriptor, list every node that touches an external system; mark each `read` / `transaction` / `child-run`.
2. For each transaction node: under `dryRun`, `executeDryRun` must PREVIEW (probe + would-prepare, or report `already-present`) and never fence/commit — check the `dry-run-commit-free` + `subject-before-fence` guards cover it and the scenario asserts `write_intents` / `write_attempts` / `durable_outbox` deltas = 0.
3. The rehearsal must still exercise the WHOLE path (searches, navigation, form staging) — a preview that refuses where the real run succeeds is a false rehearsal (D215); a preview that answers where the real run stops is the same defect from the other side.
4. Run it live with `dryRun=true` (hr-manage), then `explain run` + the durable counts.
5. Emit the matrix: `| workflow | has dry-run scenario | last live dry run (date, run id) | durable deltas | gaps |` — and record task-specific gaps in the active brief's assigned evidence folder; put lasting rules in the owning reference or nearest module `AGENTS.md`.

## Close
Failing test pinned → fix → gate green → `code-reviewer` + `silent-failure-hunter` on the diff → record task evidence in the active brief's assigned evidence folder; keep lasting invariants in the owning module `AGENTS.md`.
