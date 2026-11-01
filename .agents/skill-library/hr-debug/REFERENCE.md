# hr-debug — this repo's failure classes, and the loop for each

> Internal repository playbook. Read through the global `debug` router or `hr-workflow`; it is not
> an independent operator command.

The general method is the global `debug` skill: red gate → minimise → hypothesise → instrument → fix
→ regression test → cleanup. Use `sup_sol` at high reasoning for a subtle seam only when `/supervise`
or the user explicitly authorizes delegation. This skill adds the repo-specific evidence sources,
failure classes, and forbidden first moves. Read the owning reference and nearest module `AGENTS.md`
before forming a theory.

## 0 · Forbidden first moves
- "Add a longer wait / pollMs" before you have DISPROVEN timing (read the span timings; the operator has been burned: *"timing is not the cause, don't repeat that"*).
- A fallback, default, `??`, or swallowed catch to make the run pass — this repo's rule is fail loud; the retained `review` skill's Silent failures axis treats it as a defect.
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
| old visual receipt mistaken for current acceptance, or a visual-test request | Operator-led visual-test design → §8 |
| "is the dry run really submit-free" / which workflows have a dry run | **Dry-run audit** → §9 |

## 2 · Selector / page-state repair (the loop — no shortcuts)
1. Read the run's failure record (`npm run cli -- explain run <id>`) and the store's screenshots under `.tracker/artifacts/…`; quote the exact error and the step.
2. `playwright-cli -s=dbg open "<url>"` headless through the Fast Duo workflow session (`channel: chromium`); use the registered protected credential source; `playwright-cli --raw snapshot > /tmp/s.yml`; find the TRUE anchor.
3. Fix in the store driver / selector registry: **structural anchors first (`id`, `name`, role+accessible name), observed labels behind them; a no-match must refuse by NAME, never fall through** (`.or()` is a union under strict mode — it asserts the arms are exclusive; prefer `.first()`-settle + a pure verdict function, D213).
4. Port from legacy only with `// ported from hr-automation@<sha> <path>`; re-verify LIVE (D150 — live beats diffing legacy).
5. Re-run the failing step live; then the focused unit or architecture check that covers it. If scenario-test evidence is needed, record the gap for operator-led design; run `npm run build:manifest` if a descriptor closure moved.
6. `playwright-cli close-all`. Record: the run id, the anchor before/after, the live proof — in the migration doc or the store AGENTS.md (invariants only). Lesson-worthy → tell the operator.

Known traps on record: the count banner `#PTS_CRITTEXT_DISP` renders WITH the grid (D213); Kuali paints client-side (~1 s menubar, ~3 s heading, empty-heading decoys) — bound-wait for the fact; a Kuali `actionId` names a step, not a document — prove the document number from the h1; TritON renders one field under three labels — labels identify the realm; ui-grid virtualization terminates on coverage, not on `scrollTop` (D205); header names must come from the same container as the cells.

## 3 · Auth / session
- Authentication is proven by CONTENT (`PS_TOKEN` / `sid` + no sign-in form), never by URL (D120). A 3-second "success" is the public portal.
- Duo: the WebAuthn counter is per credential, shared across profiles — presented value must be `max(stored+1, nowSec)`; a refused profile is BURNT (only a fresh profile recovers) — read `ref execution-and-sessions` before deleting anything. "canceled or timed out" in ~1 s = the counter refusal, not a slow prompt.
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

## 8 · Visual and scenario-test evidence
`npm run test:parity` is the active desktop visual contract. Read [guards and tests](../../../docs/rebuild/reference/guards-and-tests.md)
for its runner and evidence requirements, and [dashboard parity](../../../src/dashboard/PARITY.md)
for scene rules. Old visual receipts are historical; a green accessibility tree does not establish
current visual acceptance (D187).

There is no current `tests/scenario/` rehearsal corpus. An absent `dry-run.scenario.ts` manifest
reports unavailable before execution. Scenario declarations and role-derived paths do not prove
that a rehearsal ran. Scenario-test design remains operator-led.

## 9 · Dry-run audit ("dry run means nothing gets submitted")
For a workflow (or all of them):
1. From the descriptor, list every node that touches an external system; mark each `read` / `transaction` / `child-run`.
2. For each transaction node: under `dryRun`, `executeDryRun` must PREVIEW (probe + would-prepare, or report `already-present`) and never fence/commit. Retained write-safety guards protect the fence and commit boundary; they do not prove a workflow rehearsal ran.
3. A missing dry-run rehearsal manifest reports unavailable before execution. Do not invent a manifest or subject, and do not start browser/runtime work in its place.
4. When an authorized live dry run has an available manifest, verify the whole path (search, navigation and form staging), then inspect `explain run` and durable counts. A refusal where the real run succeeds is a false rehearsal (D215); a preview that answers where the real run stops is the same defect from the other side.
5. Record the matrix: `| workflow | rehearsal manifest (available/unavailable) | last verified live dry run (date, run id) | durable deltas | gaps |`. Scenario-test proof remains deferred to operator-led design.

## Close
Failing test pinned → fix → gate green → under `/supervise` or an explicit review request, run the retained `review` skill's Correctness + Silent failures axes; otherwise inspect those two concerns inline → record (migration doc line / store AGENTS.md invariant) → tell the operator if it is lesson-worthy.
