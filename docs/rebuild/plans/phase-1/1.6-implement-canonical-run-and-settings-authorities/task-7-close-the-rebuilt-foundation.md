# Task 7 · Close the rebuilt foundation
<!-- roadmap: p1f-close -->

Read the [subphase overview](README.md) before this assignment for shared scope, dependencies, decisions and gates.

**Seam:** no product code beyond fixes the gates demand; this task file and the subphase overview (this section's
`log:`/status), the roadmap nodes, ref lessons, the 2.6 handoff. **Gate:** base + `npm run test:parity`
+ `npm run stores:catalog:check` + `npm run test:architecture` + `npm run cli -- storage doctor` on the
upgraded operator root + both workflows' T1b live manifests (`dry-run-scenario person-lookup` `live-read`,
`dry-run-scenario separations` `dry-run-preview`, exact zero write-authority deltas) + one adversarial
review that finds no second run/settings lifecycle authority, no secret value on any sink and the
`no-lifecycle-sql` negative control intact. **Hands 2.6:** the migrated fixture pair (a v29→floor copy and
a fresh root); A0/A1 → 2.6 Task 2, A2 with `run-status-fold-contributes-no-lifecycle-arm` landing in the
deletion commit → 2.6 Task 1-3, A3's table removal → 2.6 Task 1-3, A8/P40 → 3.1 Task 9-2; the D183
disposition table; the operator-visible `migrated-refused` note; the `checkpoint_payloads` single-writer
fact §D330.11 #22 / M23 guard; any residual as a named defect, never absorbed.

## Approved Task 1.6.7 execution plan (2026-09-07)

The operator approved this plan in the direct `/phase-plan 1.6.7` session. The operator also selected
a replacement Separations read-only canary and reported a same-day Kuali and New Kronos check. Its
identifier remains only in protected settings: no committed registry, plan, migration record, log,
command evidence or review output may contain it. Task 7 records only the stable public label,
observation date, systems checked, read-only purpose and protected-setting reference.

The operator approved the following handoff refinements in the subsequent skill/plan review session
on 2026-09-07: the repaired-candidate live route below, secret-free confirmation of private-setting
application, and reproducible gate commands/configuration. The original scope and pending runtime
prerequisites remain; this amendment records no new live verification or completed implementation.

### Assignment, checkout and integration

One supervisor owns the complete close because the deterministic gates, the one upgraded operator
root, the two serial live runs, their evidence rows and the Phase-2.6 handoff form one acceptance
boundary. There are no implementation workers. One fresh native `sup_review` reviewer independently
owns the complete adversarial acceptance review; it does not rerun either live workflow.

| Assignment | Branch | Absolute worktree | Base and prerequisites | Owned files and resources | Acceptance and merge condition |
| --- | --- | --- | --- | --- | --- |
| `1.6.7` | `codex/phase-1-6-foundation-close` | `/Users/julianhein/Projects/hr-worktree-foundation-close` | Create from the verified committed approved-plan SHA on local `master`; it must retain Task-6 completion `2875f4e315f8bc56abc4e9dd7574f169cfaae5c2` and integration `440013f193d7f3451828cbc740591248139db077` as ancestors. Recheck ref/path absence, clean target, plan content and worktree capacity before creation. | This task owner; the Phase-1.6 overview status/log; `config/test-subjects.json` availability/provenance only; the two existing migration records; the Phase-2.6 handoff; roadmap source/generated output; `ref lessons` only for a proved new lesson; focused test or product fixes only when a required gate exposes a defect already owned by 1.6. The primary checkout's upgraded `.tracker` root is the sole actual target and is never copied into the task worktree. | Freeze the exact candidate and obtain a fresh complete `sup_review` PASS. Against local `master` still containing the approved plan and Task-6 prerequisite, merge `--no-ff` without a behavior-changing conflict or renew review for the fix; run required integration gates, record review/merge/gate evidence, remove only the owned worktree/ref, and mark Task 7 plus Phase 1.6 complete. No push. |

The primary checkout remains the integration and actual-runtime checkout. Live commands run there
only after it is verified clean, still at the approved implementation/plan lineage and byte-identical
to the task worktree for every executable, manifest and operational registry field. The task branch
may differ at that point only in planning or evidence text and in the selected registry entry's
dated reason/provenance fields; its public label, availability state, workflow kind and protected
reference must remain identical. Any other difference stops that equivalence-based live route.

**Repaired-candidate route.** If an admitted repair changes executable/configuration inputs, finish
its deterministic candidate gates and commit/freeze the exact task candidate first. With exclusive
use of the clean primary checkout, record its original branch and full HEAD, verify stopped owned and
foreign runtime processes/locks, and use `git switch --detach <frozen-candidate-sha>` there. The original
`master` ref must remain unchanged; no merge is performed. Verify candidate HEAD, installed dependency
compatibility, executable/config/manifest equivalence and the same primary operator-root identity
before the live pair. Keep the candidate and target exclusive through both runs. Do not copy the
operator root, rewrite private settings, force checkout, stash another session's files or reset refs.
After stopping owned runtime and preserving sanitized evidence, restore the recorded original branch
with `git switch <recorded-branch>` and verify its original HEAD, clean tracked state and unchanged
ref before normal review/integration. Restore after a failed proof too when safe; a dirty checkout,
foreign process, ref change or restore failure blocks further work and is reported without force.
Bind every live result to the frozen candidate, target and observed private-setting state. Subsequent
behavioral changes invalidate affected proof. The single final reviewer still reviews the complete
Task-7 candidate and live evidence before merge; temporary candidate execution is not acceptance.

### Feasibility and actual-target preflight

| Requirement | Current mechanism and evidence | Required Task-7 action and proof |
| --- | --- | --- |
| Healthy upgraded authority | Read-only `storage doctor --json` executed during planning at `2026-09-07T09:06:19.861Z`: schema 32, generation 94, `quick_check=ok`, zero invariant or foreign-key violations, reconciled spans, zero pending commands, unresolved write intents and outboxes. The verified generation-91 backup is stale by three generations, which is expected because D322 forbids automatic replacement. | Recheck identity, schema, health, reconciliation, stopped locks/processes and relevant counts before and after the live pair. Do not create a backup merely to make it current. A different schema, unhealthy/unknown state, active foreign process or changed target identity stops the lane. |
| Runtime environment admission | Planning inspected names only and found all nine Task-6 `migrated-refused` names still in `.env`; normal bootstrap must refuse them before secret or browser access. | Operator removes those names without Task 7 reading, printing, sourcing or rewriting `.env`. Supervisor verifies name absence only before any normal runtime command. Missing cleanup remains `WAITING ON`, never a bypass. |
| Protected test targets | Planning doctor showed the Separations canary reference present and `personLookupCanaryEid` absent. The operator selected and manually checked a replacement Separations subject; the committed registry still carries only closed references. | Operator applies the selected Separations value if needed and provisions `personLookupCanaryEid` through the existing protected-settings operation, outside agent-visible input/output. Supervisor requires a secret-free apply receipt or explicit operator confirmation that the selected change was applied, with observation time and protected-store revision when available; selection or manual testing alone is not confirmation of application. Combine it with presence-only readback and recheck intervening changes before the real scenario. Preserve confirmation while valid; if identity is uncertain, resolve application status without disclosing the value. Missing/malformed/unavailable input blocks before browser start and is not a failed proof. |
| T1b result and zero-effect proof | `cli dry-run-scenario` selects the one manifest case, runs the production runtime, persists an insert-only `dry_run_scenario_results` row, and compares exact per-run deltas for `write_intents`, `write_attempts` and `durable_outbox`. Person Lookup is the transaction-free `live-read` arm; Separations is the transaction-bearing `dry-run-preview` arm. | Run the two registered labels serially. Require exit 0, verdict `met`, the expected arm/terminal/receipt/checkpoint assertions and exact `0/0/0` deltas in each persisted result. Read back by returned result/run identity through the supported authority repository or an equivalent read-only exact query. A blocked/failed row is evidence, not permission to retry. |
| Migrated fixture pair | `tests/unit/storage-upgrade.test.ts` owns reproducible temporary-root constructors for a fresh root and a v29 root converted to v32; the wider upgrade/restore suites own preservation and refusal cases. No checked-in operator database is needed. | Re-run and name the exact fresh-root and v29-to-v32 cases, expected schema/generation behavior and commands in the 2.6 handoff. Hand the reproducible fixture recipe and proof locations, never copied operator bytes or a disposable `/tmp` pathname. |
| Single authorities and secrecy | `no-lifecycle-sql-outside-the-adapter`, `no-secret-values-in-logs`, `redaction-surface-scan`, `sqlite-settings-authority` and `authority-upgrade-adapters-isolated` are active. Their violating fixtures make the principal negative controls red-capable. | Run the focused guards and full architecture lane; reviewer inspects the production closure, guard implementations and injected violations. No grep-only or self-attested audit substitutes for the guards. |
| Downstream handoff | Phase 2.6 already owns downstream readers and A0/A1/A2/A3 deletion; Phase 3.1 Task 9-2 owns the remaining Settings expansion. Task 6 changed the immediate settings source copy to `Saved`. | Record actual A0/A1 module paths and expiry guards; A2's same-commit authority-only status test; A3 removal; current D183 dispositions; `migrated-refused`; the `checkpoint_payloads` gate-record-only fact; and the corrected post-D336 A8/P40 boundary. Do not perform downstream deletion or UI work here. |

Planning verified a clean local `master` at `2875f4e315f8bc56abc4e9dd7574f169cfaae5c2`,
with Task-6 integration as an ancestor, only the primary registered worktree, and both proposed task
branch and worktree path absent. These facts are volatile and must be rechecked at supervisor start.

### Ordered supervisor steps

1. **1.6.7.1 — bind the checkout and preflight.** Send the required Done / Now / Remaining update,
   create the proposed dedicated worktree/branch from the verified approved-plan commit, verify all
   ancestry and plan contents, inventory dirty paths and owned resources, and recheck the primary
   operator root without changing it. Record `WAITING ON` until the nine migrated environment names
   are absent, both protected canary references are presence-true and application of the selected
   replacement is confirmed as above. Never inspect or echo a value.
2. **1.6.7.2 — deterministic authority and handoff proof.** Run the fresh-root and v29-to-v32 fixture
   pair plus the affected upgrade/restore/doctor checks. Run the focused lifecycle SQL, secrecy,
   redaction, SQLite-settings and adapter-isolation guards, including their violating fixtures. Inspect
   the actual A0/A1 modules, A2/A3 owners, D183 table and `checkpoint_payloads` writer/guard evidence;
   reconcile the Phase-2.6 wording to Task 6's D336 result without deleting an adapter.
3. **1.6.7.3 — pre-live base gate.** With the selected public registry metadata recorded but no
   identifier committed, run typecheck, lint, full coverage/suite size, manifest, store-catalog and
   roadmap freshness, standalone architecture, unchanged desktop parity and diff checks. Coverage
   runs without compiler/linter contention through the reproducible two-worker config below, which
   imports the actual checkout config and changes only root/per-project worker counts. Architecture
   and parity run serially because Task 6 evidenced their contention.
   Any parity reference body change is out of scope.
4. **1.6.7.4 — actual-root live pair.** Select the equivalence-based or repaired-candidate route above.
   Reverify exact executable identity, stopped processes, operator-root identity, environment-name
   absence, presence-only canary state and still-valid confirmation of the selected application.
   Run `npm run cli -- storage doctor --json`, then
   `npm run cli -- dry-run-scenario person-lookup --subject person-lookup-canary`, then
   `npm run cli -- dry-run-scenario separations --subject finalization-canary`, one at a time from the
   primary checkout. After each, resolve its returned result id and inspect the insert-only result and
   exact run-scoped write-safety rows read-only. Finish with another JSON doctor and close every owned
   browser/session/process; restore and verify the original primary branch when using the repaired
   candidate. Preserve a blocked or failed result and diagnose before any proposed retry;
   never retry a deterministic or unknown outcome as though transient.
5. **1.6.7.5 — candidate evidence and downstream handoff.** Record sanitized result/run identities,
   manifest digests, arm/verdict/assertion summary, exact `0/0/0` deltas, doctor identity and wall time
   in `docs/rebuild/migrations/person-lookup.md` and `docs/rebuild/migrations/separations.md`. Update
   this owner, the Phase-1.6 overview, `config/test-subjects.json` availability/provenance, the 2.6
   handoff and roadmap status/output. Record zero residuals or each residual as a named defect with an
   owner. Verify that evidence text contains no protected value or derived value. Since this recording
   follows the executable candidate gate, run the applicable roadmap-binding, target-registry,
   link/instruction, lint, generation/freshness and diff checks; reuse the full gate only after an exact
   input comparison proves no executable, test, configuration, dependency or reference input changed.
   Otherwise rerun every affected full gate.
6. **1.6.7.6 — independent review, integration and cleanup.** Freeze exact base, candidate, input map,
   live result ids and gate evidence. Dispatch one fresh native `sup_review` reviewer for the complete
   scope below. Fix findings locally, rerun affected neighboring/full/live proof only where required,
   and renew review for behavioral changes. After PASS, merge `--no-ff` to local `master`, verify exact
   reviewed-tree equivalence or explain the evidence-only merge delta, run the complete required
   integration gates, record review/merge/gate/cleanup evidence, then remove only the owned worktree,
   branch and attributable temporary resources. Mark only Task 7 and Phase 1.6 complete; do not start
   Phase 2.6.

### Gate schedule and review coverage

The focused deterministic set includes the fresh/v29 upgrade and restore cases and the architecture
files for `no-lifecycle-sql-outside-the-adapter`, `no-secret-values-in-logs`,
`redaction-surface-scan`, `sqlite-settings-authority` and
`authority-upgrade-adapters-isolated`. Use the reproducible commands below and record successful
test titles and real exit status.
The full candidate and integration sets are:

- `npm run typecheck` and `npm run lint`;
- `npm test -- --coverage --config "$task_gate_config" && node --import tsx scripts/suite-size.ts`;
- `npm run build:manifest:check`, `npm run stores:catalog:check` and `npm run roadmap:check`, after
  any corresponding generation has completed;
- `npm run test:architecture -- --config "$task_gate_config"` and then `npm run test:parity`, serialized;
- the applicable roadmap-binding, registry/document/link/instruction checks and `git diff --check`.

**Recreate the resource-only adapter.** In an owned temporary directory, create `two-workers.config.mts`
from this body, replacing `ABSOLUTE_CHECKOUT` with the verified checkout being tested. Set
`task_gate_config` to its absolute pathname. Recreate/rebind it for integration; do not depend on
Task 6's scratch file or import another checkout. This is temporary gate setup, not a tracked
config change. Record its hash, imported config identity and two effective workers from resolved
configuration or observed workers before accepting the run.

```ts
import { deepStrictEqual, strictEqual } from "node:assert";
import base from "ABSOLUTE_CHECKOUT/vitest.config.ts";

const projects = base.test!.projects!;
for (const project of projects) {
  if (typeof project !== "object" || project === null || !("test" in project)) {
    throw new Error("UNSUPPORTED_GATE_PROJECT_SHAPE");
  }
}
const adjusted = {
  ...base,
  test: {
    ...base.test,
    maxWorkers: 2,
    projects: projects.map((project: any) => ({
      ...project, test: { ...project.test, maxWorkers: 2 },
    })),
  },
};
function withoutWorkers(config: any) {
  const { maxWorkers: _root, projects: entries, ...test } = config.test;
  return { ...config, test: { ...test, projects: entries.map((project: any) => {
    const { maxWorkers: _project, ...projectTest } = project.test;
    return { ...project, test: projectTest };
  }) } };
}
deepStrictEqual(withoutWorkers(adjusted), withoutWorkers(base));
strictEqual(adjusted.test.maxWorkers, 2);
for (const project of adjusted.test.projects) strictEqual(project.test.maxWorkers, 2);
export default adjusted;
```

**Focused commands** (from the verified task checkout, with that adapter):

```sh
npm test -- --config "$task_gate_config" --project unit tests/unit/storage-upgrade.test.ts tests/unit/storage-upgrade-admission.test.ts tests/unit/storage-upgrade-d331.test.ts tests/unit/storage-upgrade-environment.test.ts tests/unit/storage-upgrade-sources.test.ts tests/unit/storage-upgrade-tombstones.test.ts tests/unit/storage-restore-drill.test.ts tests/unit/dashboard/settings-storage-doctor.test.ts tests/unit/sqlite-settings-authority.test.ts
npm run test:architecture -- --config "$task_gate_config" tests/unit/architecture/no-lifecycle-sql-outside-the-adapter.test.ts tests/unit/architecture/no-secret-values-in-logs.test.ts tests/unit/architecture/redaction-surface-scan.test.ts tests/unit/architecture/sqlite-settings-authority.test.ts tests/unit/architecture/authority-upgrade-adapters-isolated.test.ts
npm run test:architecture -- --config "$task_gate_config" tests/unit/architecture/roadmap-doc-binding.test.ts tests/unit/architecture/test-target-registry.test.ts
npm test -- --config "$task_gate_config" --project unit tests/unit/test-target-registry.test.ts
```

The fixture pair is in `tests/unit/storage-upgrade.test.ts`: “plans a fresh root without files,
creates v32 directly, and reruns without writes” and “preserves an applied empty v29 revision and
authenticates its immutable historical journal after conversion.” Record their actual assertions and
results for the handoff; the surrounding file/suites remain required. Do not narrow full gates to
these selectors. From the tested checkout, run
`python3 ~/.agents/skills/docs/scripts/audit.py "$PWD" --check` (Claude uses `~/.claude/skills/docs/scripts/audit.py`)
for existing instruction twins/size, then inspect changed documents' links. Preserve the command,
process/session handle, exit result, config identity and log path in the working checkpoint; after
compaction recover an uncertain result before starting another run.

Typecheck, lint and read-only freshness checks may share a concurrent group only while no generator
or writer is active. Coverage is exclusive from compiler/linter work. Architecture and parity are
exclusive from each other. Live commands are serial and exclusive on the primary operator root.
No other task's port, browser profile, lock or test-run root may be killed or reused.

The fresh reviewer receives the exact candidate and the D330/D331/D332/D336 contracts. It must
independently inspect all changed paths, the production import/consumer closure and the recorded live
rows; reconcile the fixture and adapter handoff; verify that lifecycle mutation/SQL remains confined
to the canonical service/adapter; verify that ordinary settings have no second authority; verify that
protected values and derived values reach no journal, SQLite row, output, diagnostic, log, evidence or
review text; execute or inspect the red-capable negative controls; and confirm both T1b rows prove the
expected arm and exact zero write-safety deltas. It does not rerun live HR workflows or accept prior
Task-6 review as Task-7 review credit.

### Exclusions and stop conditions

- No legacy production access/change, controlled commit, real HR transaction, cutover, automatic
  backup, `.env` rewrite, secret-value capture, push, Phase-2.6 implementation or Phase-3.1 Settings
  presentation work is authorized.
- Product/test fixes are limited to defects a required Task-7 gate exposes inside the existing 1.6
  contracts. A required contract redesign returns to a newly numbered 0.3 task. A downstream reader
  change stays with 2.6; a Settings UI/refreeze change stays with 3.1 Task 9-2.
- A live result that is blocked or failed is retained as evidence. A nonzero write-intent,
  write-attempt or durable-outbox delta stops immediately. A changed/unknown target, active foreign
  process, unreadable protected authority, secret exposure, unexplained parity change or
  behavior-changing integration conflict stops for diagnosis and, when material, an approved plan
  amendment.
- The stale generation-91 backup is reported truthfully and remains acceptable while doctor verifies
  it as compatible; D322 does not permit Task 7 to create a replacement merely to close the task.

**Launch readiness at approval:** `WAITING ON`. The committed plan and Task-6 prerequisite can be
made available immediately, but normal runtime remains blocked until the operator removes the nine
migrated `.env` names, confirms application of the selected Separations canary (not merely its
presence or earlier manual test), and provisions the absent `personLookupCanaryEid`. The supervisor
prompt must retain these as named start prerequisites and may
be issued only after plan persistence verification; live work stays gated on their presence/name-only
rechecks.

- [ ] Pass targeted, full, generated, storage, live-dry-run and adversarial authority gates.
- [ ] Record the migration in this section's `log:` and hand 2.6 only verified contracts, fixtures,
  residuals and exact commands.
