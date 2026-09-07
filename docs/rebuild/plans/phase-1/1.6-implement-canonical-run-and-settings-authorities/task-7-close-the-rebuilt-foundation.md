# Task 7 · Close the rebuilt foundation
<!-- roadmap: p1f-close -->

Read the [subphase overview](README.md) before this assignment for shared scope, dependencies, decisions and gates.

**Seam:** no product code beyond fixes the gates demand; this task file and the subphase overview (this section's
`log:`/status), the roadmap nodes, ref lessons, the 2.6 handoff. **Gate:** base + `npm run test:parity`
+ `npm run stores:catalog:check` + `npm run test:architecture` + `npm run cli -- storage doctor` on the
fresh operator root after the approved reset and D341 detour + both workflows' T1b live manifests (`dry-run-scenario person-lookup` `live-read`,
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
identifier must remain only in private test configuration after the D341 detour: no committed registry, plan, migration record, log,
command evidence or review output may contain it. Task 7 records only the stable public label,
observation date, systems checked, read-only purpose and test-input reference.

The operator approved the following handoff refinements in the subsequent skill/plan review session
on 2026-09-07: the repaired-candidate live route below, secret-free confirmation of private-test-input
application, and reproducible gate commands/configuration. The original scope and pending runtime
prerequisites remain; this amendment records no new live verification or completed implementation.

### D341 detour prerequisite and reset amendment (approved 2026-09-07)

Task 7 waits for accepted completion of the test-data foundation detour: configuration ownership
is `ref clock-config-secrets` §D341 and completion evidence is `ref guards-and-tests` §10.5.
**Detour completed 2026-09-07:** review accepted (rounds 2–4 plus conversion addendum), integrated into
local `master` as `bc6dc9b54` (+ `4ef3b1eee`), and the actual private conversion performed on the
primary checkout's operator root — credential document v2 revision 3 with the four live entries
unchanged, `config/test-data.local.json` (0600) carrying the Separations document number, post
doctor exit 0. Still open for this task: person-lookup EID input, retired-environment cleanup, and
confirmation of the selected Separations replacement.
The operator requested a temporary detour handoff, not a new phase/task number. The entire fixture
consolidation and private canary migration finish there; Task 7 consumes them and retains its live
acceptance, independent review, integration and cleanup obligations.

The operator explicitly reset the primary rebuild database during the detour planning session.
The new schema-32 root was doctor-healthy with zero runs/spans and zero pending counts; the old
spans/artifacts/backup were removed. Credentials remained byte-identical and settings remained their
existing defaults. The earlier v32/g94 and backup-g91 observations are historical, not prerequisites
or restoration targets. Do not recreate deleted operator runs or backups. The migration/recovery
fixture pair remains synthetic and reproducible through the existing test constructors.

The assigned Task-7 worktree already exists at `3bb9abdb35396250fc260351a05ca9f1c82be41d`, with
only its owner’s untracked preflight handoff observed. Preserve that file and checkout. After verifying
ownership, absence of implementation changes and clean tracked state, its supervisor must bring the
branch forward to the committed detour integration and amended plan before resuming step 1; do not
reset it, copy private files into it, or execute the obsolete preflight instructions. Revalidate the
actual root and environment/input prerequisites afresh. If that branch has acquired implementation
changes, stop for reconciliation rather than treating it as the observed plan-only branch.

### Provider reference-file amendment (operator-approved 2026-09-07)

The operator explicitly requested that `.env` remain intact for later reference, that supported
keys be copied to their runtime source, and that OCR/provider UI work remain deferred. D343 in
`ref clock-config-secrets` owns this narrow source-path change. It supersedes the cleanup prerequisite
above and below: normal startup admits only repository-anchored `.env.providers`, with the existing
five-family allowlist and all existing secure admission checks. It never opens or falls back to
`.env`. Retired names remain refused in the runtime file and parent environment. Existing operational
credentials and D341 private test configuration retain their authorities; no values enter evidence.

Task 7 owns bootstrap/source metadata, associated diagnostics, setup instructions and source-isolation
tests. Copy supported bindings once into an absent ignored owner-only `.env.providers` on the primary
checkout, validate it with the production reader, and verify `.env` bytes unchanged in memory without
printing values or hashes. Do not copy unsupported families or private files to the worktree. This is
not automatic migration at startup. Historical explicit storage-upgrade input semantics stay intact.
Regenerate affected manifests and rerun candidate gates; earlier gates are historical evidence only
for changed inputs. All six steps, live proofs, unchanged parity references, review and merge conditions
remain required. OCR behavior, additional providers and Settings UI are outside this amendment.

Resume consumed the environment-admission handoff. The owned branch incorporates the reviewed D342
master `f0b1cf92195897e56e4917384b512c45d7b4d41a` via merge
`45f36cc702677f8f9b10e5b87d8cf559221fc22f`; tracked state was clean, with only the owned handoff untracked.
The earlier refused launch remains failed evidence and produced no run or result to retry.

### Fingerprint-only parity exception (operator-approved 2026-09-07)

After inspecting the failed gate and the proposed narrow exception, the operator replied `approve`.
Task 7 may refresh generated descriptor/implementation fingerprint provenance and displayed identifier
text, including their corresponding screenshot pixels. This supersedes only the reference-body
prohibition for those exact generated identifiers. Preserve every other semantic field, copy, layout,
assertion, viewport and zero-pixel tolerance. Classify all changed a11y/metadata lines and image pixels;
any unrelated change remains outside scope. Run full assertion-mode parity and all required candidate
gates after the refresh, then resume steps 4–6. Existing failed evidence stays retained. No OCR feature
or Settings UI expansion is authorized. D343 records this consequence at the source contract.

### Assignment, checkout and integration

One supervisor owns the complete close because the deterministic gates, the one upgraded operator
root, the two serial live runs, their evidence rows and the Phase-2.6 handoff form one acceptance
boundary. There are no implementation workers. One fresh native `sup_review` reviewer independently
owns the complete adversarial acceptance review; it does not rerun either live workflow.

| Assignment | Branch | Absolute worktree | Base and prerequisites | Owned files and resources | Acceptance and merge condition |
| --- | --- | --- | --- | --- | --- |
| `1.6.7` | `codex/phase-1-6-foundation-close` | `/Users/julianhein/Projects/hr-worktree-foundation-close` | Reuse the verified plan-only Task-7 branch/worktree and bring it forward to local `master` containing accepted D341 detour integration and this amended plan; if absent, create from that verified base. It must retain Task-6 completion `2875f4e315f8bc56abc4e9dd7574f169cfaae5c2` and integration `440013f193d7f3451828cbc740591248139db077` as ancestors. Recheck ownership, existing ref/path state, clean tracked target, plan content and capacity before reuse or creation. | This task owner; the Phase-1.6 overview status/log; `config/test-data.json` subject availability/provenance only; the two existing migration records; the Phase-2.6 handoff; roadmap source/generated output; `ref lessons` only for a proved new lesson; focused test or product fixes only when a required gate exposes a defect already owned by 1.6. The primary checkout's fresh operator-reset `.tracker` root is the sole actual target and is never copied into the task worktree. | Freeze the exact candidate and obtain a fresh complete `sup_review` PASS. Against local `master` still containing the approved plan and Task-6 prerequisite, merge `--no-ff` without a behavior-changing conflict or renew review for the fix; run required integration gates, record review/merge/gate evidence, remove only the owned worktree/ref, and mark Task 7 plus Phase 1.6 complete. No push. |

The primary checkout remains the integration and actual-runtime checkout. Its root is now the fresh
operator-reset root, with credentials converted by D341 before Task 7 resumes. Live commands run there
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
operator root, rewrite private test configuration or credentials, force checkout, stash another session's files or reset refs.
After stopping owned runtime and preserving sanitized evidence, restore the recorded original branch
with `git switch <recorded-branch>` and verify its original HEAD, clean tracked state and unchanged
ref before normal review/integration. Restore after a failed proof too when safe; a dirty checkout,
foreign process, ref change or restore failure blocks further work and is reported without force.
Bind every live result to the frozen candidate, target and observed private-test-input state. Subsequent
behavioral changes invalidate affected proof. The single final reviewer still reviews the complete
Task-7 candidate and live evidence before merge; temporary candidate execution is not acceptance.

### Feasibility and actual-target preflight

| Requirement | Current mechanism and evidence | Required Task-7 action and proof |
| --- | --- | --- |
| Healthy fresh authority | The operator reset the root on 2026-09-07; schema 32, zero runs/spans/pending counts, valid integrity, doctor exit 0; no retained database backup. D341 later converts only private test/credential files. | Recheck exact identity/schema, fresh-baseline marker, health, reconciliation, stopped locks/processes and relevant counts before/after the live pair. Record newly created runs honestly. Do not restore deleted data or create a backup merely because one is absent. Unknown/unhealthy state or foreign activity stops the lane. |
| Runtime environment admission | At the latest detour-planning name-only check, only the retired canary environment name remained from the previously reported nine names. Normal bootstrap still refuses it; the detour does not rewrite `.env`. | Operator removes remaining retired names. Supervisor verifies all retired-name absence without printing values or sourcing/rewriting `.env` before normal runtime. Recheck current state; missing cleanup remains `WAITING ON`, never a bypass. |
| Private test targets | D341 moves current canaries into ignored `config/test-data.local.json`; public subjects are in `config/test-data.json`. Before conversion the Separations input was present and person-lookup absent; presence did not prove the selected replacement had been applied. | Require detour conversion evidence, provision missing private input, and verify the selected Separations replacement through a value-free receipt or explicit operator confirmation with observation/source identity. Use the new reader’s status check and recheck intervening changes. Never ask for values in chat, route them through Settings, fabricate availability, or launch with missing/malformed/unavailable inputs. |
| T1b result and zero-effect proof | `cli dry-run-scenario` selects the one manifest case, runs the production runtime, persists an insert-only `dry_run_scenario_results` row, and compares exact per-run deltas for `write_intents`, `write_attempts` and `durable_outbox`. Person Lookup is the transaction-free `live-read` arm; Separations is the transaction-bearing `dry-run-preview` arm. | Run the two registered labels serially. Require exit 0, verdict `met`, the expected arm/terminal/receipt/checkpoint assertions and exact `0/0/0` deltas in each persisted result. Read back by returned result/run identity through the supported authority repository or an equivalent read-only exact query. A blocked/failed row is evidence, not permission to retry. |
| Migrated fixture pair | `tests/unit/storage-upgrade.test.ts` owns reproducible temporary-root constructors for a fresh root and a v29 root converted to v32; the wider upgrade/restore suites own preservation and refusal cases. No checked-in operator database is needed. | Re-run and name the exact fresh-root and v29-to-v32 cases, expected schema/generation behavior and commands in the 2.6 handoff. Hand the reproducible fixture recipe and proof locations, never copied operator bytes or a disposable `/tmp` pathname. |
| Single authorities and secrecy | `no-lifecycle-sql-outside-the-adapter`, `no-secret-values-in-logs`, `redaction-surface-scan`, `sqlite-settings-authority` and `authority-upgrade-adapters-isolated` are active. Their violating fixtures make the principal negative controls red-capable. | Run the focused guards and full architecture lane; reviewer inspects the production closure, guard implementations and injected violations. No grep-only or self-attested audit substitutes for the guards. |
| Downstream handoff | Phase 2.6 already owns downstream readers and A0/A1/A2/A3 deletion; Phase 3.1 Task 9-2 owns the remaining Settings expansion. Task 6 changed the immediate settings source copy to `Saved`. | Record actual A0/A1 module paths and expiry guards; A2's same-commit authority-only status test; A3 removal; current D183 dispositions; `migrated-refused`; the `checkpoint_payloads` gate-record-only fact; and the corrected post-D336 A8/P40 boundary. Do not perform downstream deletion or UI work here. |

Original planning verified a clean local `master` at `2875f4e315f8bc56abc4e9dd7574f169cfaae5c2`,
with Task-6 integration as an ancestor, only the primary registered worktree, and both proposed task
branch and worktree path absent. That absence observation is superseded by the existing-worktree facts in the D341 amendment; all ownership and base facts must be rechecked at supervisor start.

### Ordered supervisor steps

1. **1.6.7.1 — bind the checkout and preflight.** Send the required Done / Now / Remaining update,
   verify accepted D341 detour integration, reuse/advance or create the assigned dedicated worktree
   under the amendment above, verify ancestry and committed plan contents, inventory dirty paths and
   owned resources, and recheck the fresh primary root without changing it. Record `WAITING ON`
   until all retired environment names are absent, both private test inputs are ready and application
   of the selected replacement is confirmed as above. Never inspect or echo a value.
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
   absence, value-free private test-input state and still-valid confirmation of the selected application.
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
   this owner, the Phase-1.6 overview, `config/test-data.json` subject availability/provenance, the 2.6
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
- The prior generation-91 backup was removed by the operator-authorized reset. Report the current
  backup state truthfully; D322 does not permit Task 7 to create one merely to close the task.

**Launch readiness after D341 plan approval:** `WAITING ON`. Require accepted detour integration
and the amended plan in the assigned checkout. Before normal runtime, verify all retired environment
names absent, the selected Separations input applied/confirmed in private test configuration, and
person-lookup input provisioned. Do not treat presence or an earlier manual test as proof of the
selected replacement. Recheck source identity, availability, the fresh actual root and process
ownership; the old preflight handoff does not satisfy these conditions.

- [ ] Pass targeted, full, generated, storage, live-dry-run and adversarial authority gates.
- [ ] Record the migration in this section's `log:` and hand 2.6 only verified contracts, fixtures,
  residuals and exact commands.

## Task 1.6.7 execution evidence

Status: **WAITING ON environment admission** at step 4; steps 1–3 accepted. No candidate
acceptance or phase completion claimed.

**Step 1 accepted (2026-09-07).** Verified accepted D341 completion and conversion at
`da85e5d1d8b652dab36d78bd4addb794dad377f2`, including merge `bc6dc9b54` and the conversion
review addendum in `ref guards-and-tests` §10.5. Advanced the clean, plan-only owned branch
`codex/phase-1-6-foundation-close` by fast-forward from `3bb9abdb3` to that base. Both Task-6
ancestors remain reachable. Primary `master` is clean; the task worktree contains only owned
evidence/configuration changes and its temporary preflight handoff. Dependencies installed from
the committed lockfile with `npm ci --ignore-scripts --no-audit --no-fund` (exit 0).

Name-only `.env` inspection found none of the nine original retired names or the retired
person-lookup name. Both exact `test-data check --json --subject <label> --workflow <workflow>`
commands exited 0: shared/local configuration valid, both private inputs present, each subject ready.
The operator's “its done” reply confirms application of the selected private inputs. This is setup
confirmation, not live acceptance. The observed private source is the primary checkout's ignored
`config/test-data.local.json`, mode 0600, regular/non-symlink, inode 252722454 and mtime
1788802729144036248 ns; recheck it before live execution. No private value or value-derived digest
is recorded. Public Separations provenance now describes the September 7 selection/checks.

Primary read-only doctor exited 0 at `2026-09-07T17:39:55.854Z`: schema 32, generation 0,
quick check ok, valid invariants, zero foreign-key violations, reconciled zero runs/spans and all
pending counts zero. Backup missing, reported without creation. Database identity
`35ae66fbb575adebdc61b4018fb4d9153d53bbb8d0f38e0b45cba410c459f54a` identifies the primary
root only; it is not a canary fingerprint. The supported runtime-lock observer at
`2026-09-07T17:40:28.202Z` reported server and workers stopped (runtime generation 3);
no listeners on 3938/5174 or matching runtime processes were present. Historical locks were preserved.

**Working gate record.** Scratch owner is this supervisor:
`/var/folders/pt/fjkm2v7952902hpx0jcdxfnh0000gn/T/task-1-6-7-dzgx4bwi`.
`two-workers.config.mts` was extracted from the approved recipe above and bound to this worktree;
SHA-256 `1da8cd8f34f538a00f96e5d92a7b422a53794b05b79789c5a24c880184e63936`;
imported `vitest.config.ts` SHA-256
`1f9122bf9bbcf1fcab9e01b5aec3428bcde7f9b10b47f0f91aab41775bdbf68f`.
The executable assertions prove only root/project maxWorkers differ and every effective count is 2.
The nine-file focused unit command above passed 139 tests, exit 0, 22.71 s, at base `da85e5d1d`;
log `focused-unit.log`, completed process session 57832. Both named fixture cases passed.
Focused guards completed in session 10948, log `focused-guards.log`: 5 files / 60 tests passed,
18.58 s, exit 0, including injected SQL/mutator/reader and secrecy violations.

**Step 2 accepted.** The Phase-2.6 overview now records the reproducible fixture pair, actual
A0/A1 paths/expiry, A2/A3 same-commit deletion obligations, gate-record-only writer and #22/M23
proofs, D183 disposition table, `migrated-refused`, and the post-D336 A8/P40 boundary. A separate
read-only count confirmed one fresh baseline marker and zero task rows on the primary root.

The metadata update exposed three old date expectations in the focused registry architecture
gate (log `bindings.log`, exit 1; retained runner root `/private/tmp/hrt-501/run-OgfGx7`).
Updated the explicit September-7 date expectations in the two registry tests while preserving
the historical failed-result reason and every assertion. The rerun passed 38 architecture checks
(`bindings-fixed.log`, 1.29 s) and 50 unit tests (`registry-unit.log`, 0.579 s), exit 0. No product
behavior, manifest, parity reference, guard membership or coverage threshold changed.

**Step 3 accepted; pre-live candidate ready to freeze.** Gates tested the current configuration
and two test expectation edits against base `da85e5d1d`, with the unchanged approved adapter:

| Gate | Result and evidence |
| --- | --- |
| `npm run typecheck` | Exit 0; `typecheck.log`, session 84395 |
| `npm run lint` | Exit 0, zero warnings; `lint.log`, session 8454 |
| Full coverage command above + `scripts/suite-size.ts` | Exit 0; 438 files / 5510 tests; 322.27 s Vitest / 323.481 s runner; statements 85.86%, branches 77.49%, functions 89.86%, lines 87.98%; floors met. `coverage.log`, `suite-size.log`, session 45456. Unit 341 / architecture 80 / scenario 17 files. |
| Standalone architecture with the adapter | Exit 0; 80 files / 832 tests, 59.93 s; `architecture.log`, session 74238 |
| `npm run test:parity` | Exit 0; 259 passed, 61.286 s runner; `parity.log`, session 41370. No reference changes. |
| Manifest, store catalog, roadmap freshness | All current, exit 0; roadmap generation precedes checks |
| Instruction audit and diff | Exit 0; 9 existing pairs equal; all discovered project chains below 32768 bytes; `git diff --check` clean |

Live execution will use the approved repaired-candidate route because the metadata gate required
two test-file edits. Freeze this tree first, record its commit, detach the clean primary checkout at
that commit, and preserve `master` at `da85e5d1d8b652dab36d78bd4addb794dad377f2` until restoration.
No application runtime code or dependency input differs from that base. All current source and
configuration inputs must match the frozen candidate before either run. The exact original branch
must be restored after the pair or after a blocked/failed proof. The old preflight handoff has been
consumed; current requirements and resume state are now here. Steps 4–6 remain open: live proof,
candidate evidence/review, integration gates and cleanup. No acceptance or merge is yet authorized
by gate success alone.

**Step 4 blocked before runtime (2026-09-07).** Pre-live candidate
`231a349486f17d278957fc8ea20e9d549b847235` contains the gated metadata/test-expectation changes
and deterministic handoff. The primary checkout was clean, stopped and detached at that exact
commit; original `master` remained `da85e5d1d8b652dab36d78bd4addb794dad377f2`. Both input
status checks again returned ready. Pre-live doctor at `2026-09-07T17:54:10.233Z` was healthy
at schema 32/generation 0 with zero runs/spans/pending counts.

`npm run cli -- dry-run-scenario person-lookup --subject person-lookup-canary` exited 1 after
387 ms, before creating any run/result or launching a browser. The exact isolated environment
admission observer reproduced `SecretSourceError: local environment file .env contains unsupported
key CEREBRAS_API_KEY; only registered provider key families are allowed`. A names-only inventory
identified all unsupported entries: `CEREBRAS_API_KEY`, `CEREBRAS_API_KEY2`, `CEREBRAS_API_KEY3`,
`CEREBRAS_API_KEY4`, `CEREBRAS_API_KEY5`, `CEREBRAS_API_KEY6`, `CEREBRAS_API_KEY7`,
`COHERE_API_KEY`, and `OCRSPACE_API_KEY`. The five admitted families are Gemini, Groq, Mistral,
OpenRouter and SambaNova as declared in `SECRET_FAMILY_SPECS`. The earlier nine retired names
and person-lookup retired name were absent; this is a separate provider-only file-admission rule.
No value was displayed or persisted and `.env` was not rewritten. Operator cleanup remains required.

No deterministic outcome was retried; Separations was not launched through the same known refusal.
Exact read-only counts confirmed zero task rows and zero `dry_run_scenario_results` rows. No T1b
verdict or run-scoped delta is claimed. Post-blocked doctor at `2026-09-07T17:55:09.186Z` exited 0;
database identity/content fingerprint equal the pre-live report, all pending counts zero, zero
spans/runs. Lock observation again found server/workers stopped. Restored primary `master`, verified
its original full HEAD and clean tracked state. No owned browser/process remains.

Sanitized scratch evidence: `person-lookup-command.json`, `pre-live-doctor.json`,
`post-blocked-doctor.json`; the live wrapper retained only command, exit, elapsed time and result
identities (none), never arbitrary process output. `run-live.py` and `read-run.mjs` in the named
scratch directory are owned helpers; the latter has not yet read a live result. Failed focused-test
scratch `/private/tmp/hrt-501/run-OgfGx7` remains intentionally retained. The task worktree/ref remain
owned and unmerged. Step 4 must resume after full environment admission passes, then both live
proofs, step-5 evidence, complete fresh review, integration gates and final cleanup remain.

**Provisional delivery assessment.** D341 was an approved external prerequisite change; accepted
integration and input provisioning resolved the earlier blocker. Updating registry provenance
required one expectation-repair round, with red/green evidence and no weakened assertion. The new
launch blocker is an operator-file admission mismatch outside the original retired-name checklist;
checking the complete provider-only admission boundary before the pre-live gate would expose it
earlier. Mandatory gates passed and remain reusable only under the plan's exact-input rules.
No independent review has been dispatched; repair/review/integration totals remain open.

Blocked-evidence recording checks: 38 roadmap/registry architecture checks passed, 1.38 s,
`blocked-record-check.log`; instruction audit, roadmap freshness and diff checks passed.
Compared this recording diff against `231a349486f17d278957fc8ea20e9d549b847235`: only this owner
and the person-lookup migration log changed. Source, scripts, tests, configuration, dependencies and
parity references are identical, so D191 permits reuse of the above passing typecheck, lint,
coverage/suite-size and parity results. No live proof is reused or inferred.

### D343 execution checkpoint — parity exception pending (2026-09-07)

The operator requested preserving `.env`, copying supported keys to their runtime source, and
postponing OCR/UI expansion. The task branch implements the fixed `.env.providers` bootstrap,
updates the five provider catalog source paths, retains all admission mechanics, and updates
sanitized diagnostics and setup guidance. The shared historical grammar validator uses a path-neutral
syntax error; explicit historical storage-upgrade `.env` semantics remain unchanged. The generated
manifest was regenerated from the changed source closure.

One-time primary setup opened `.env` read-only/no-follow, checked regular-file/owner-only/size
metadata, validated its complete grammar, selected only registered pool bindings, validated the
prospective bytes through the production admission function, and created `.env.providers` with
exclusive creation and mode 0600. Production admission of the written file passed: 29 bindings,
only supported families. In-memory before/after source comparison plus file identity verified
`.env` unchanged. No source value or derived source hash was printed or recorded. The runtime file
is ignored; no private file was copied into the task worktree. Existing credentials/private inputs
were not modified.

All logs below are in the existing owned scratch directory
`/var/folders/pt/fjkm2v7952902hpx0jcdxfnh0000gn/T/task-1-6-7-dzgx4bwi`.
The same two-worker adapter/imported Vitest configuration from the earlier evidence was used,
unchanged; compiler/linter finished before coverage, and architecture/parity ran serially.

| Gate / observation | Evidence and outcome |
| --- | --- |
| Source-isolation negative control | `provider-red.log`, session 38903: four failures against the old path; unsupported reference-file content and absent runtime file cannot masquerade as a valid runtime source. Retained `/private/tmp/hrt-501/run-N8mnuX`. |
| Initial focused proof | `provider-focused.log`, session 67027: 2 files / 46 tests passed. |
| First full coverage | `provider-coverage.log`, session 13337: 437 files / 5512 tests passed, one lifecycle fixture failed because it still created `.env`; 320.79 s. Retained `/private/tmp/hrt-501/run-vNXLYb`. No production retry or assertion weakening. |
| Fixture repair | Real-child lifecycle fixture now creates `.env.providers` plus an unsupported `.env` reference and proves normal startup/shutdown and unchanged reference bytes. `provider-focused-fixed.log`, session 57367: 3 files / 47 tests passed, 3.40 s. |
| Typecheck / lint | `provider-typecheck-fixed.log` session 68817 and `provider-lint-fixed.log` session 17596, both exit 0; lint zero warnings. |
| Generated and instruction checks | `provider-freshness-fixed.log` / `provider-doc-audit-fixed.log`, session 5538: manifest, store catalog and roadmap current; existing instruction pairs equal and chains within cap; diff check clean. |
| Repaired full coverage | `provider-coverage-fixed.log`, session 46571: 438 files / 5513 tests passed, 303.98 s Vitest / 305614 ms command. Statements 85.86%, branches 77.49%, functions 89.86%, lines 87.98%; configured floors met. |
| Suite membership | `provider-suite-size-fixed.log`: unit 341 / architecture 80 / scenario 17; exit 0. |
| Standalone architecture | `provider-architecture.log`, session 46571: 80 files / 833 tests passed, 60.80 s / 61423 ms command. |
| Desktop parity | `provider-parity.log`, session 46571: exit 1, 190 failures / 69 passes, 136966 ms command. References remain unchanged. Failed runner `/private/tmp/hrt-501/run-uggmgy`; full failed output copied to `provider-parity-failed-output` before any future rerun. |
| Drift classification | `provider-parity-drift-classification.json`: all 190 errors were a11y fingerprint drift; no truncated differences. 190 descriptor headers and matching metadata records need new hashes; 52 body lines in 52 cases change only displayed descriptor/implementation fingerprints. No other reported semantic change. Pixel assertions for failed a11y pairs did not run, so unchanged layout/pixels are not yet claimed. |
| Concrete proposed refresh | `provider-fingerprint-only-proposal.patch` contains only the 190 header/metadata updates and 52 hash-text updates; it has not been applied. Screenshot differences still require generation, classification and review under an explicit exception. |
| Fresh actual-root doctor | `provider-preflight-doctor.json`, checked 2026-09-07T19:17:37.724Z: exit 0, same source identity/content fingerprint, schema 32/generation 0, healthy/reconciled, zero runs/spans/pending counts, no backup. |
| Current private targets | Person Lookup and workflow-qualified Separations checks report ready. Private source device/inode/mtime/mode match the prior operator-confirmed observation. The unqualified finalization label also reports its distinct standalone finalization workflow blocked; that is outside the assigned composed Separations proof. Both observations are retained in `provider-*-input.json`; no live attempt occurred. |

`provider-gate-results.json` records exact serial commands/exits/wall times;
`provider-gated-inputs.json` records only tracked code/test/template hashes for future reuse checks.
`run-provider-gates.py` owns the serial gate invocation. `run-live.py` now reserves distinct
`*-d343-command.json` output names so the earlier refused launch report cannot be overwritten.
`preflight-provider.mjs` is a prepared value-free provider/input/lock observer; it has not launched
anything. The old environment-admission handoff was consumed and is superseded by this checkpoint.

**Actual blocker:** Step 3's explicit prohibition on parity reference-body changes conflicts with
the generated fingerprints caused by the authorized source move. The supervisor requested a narrow
fingerprint-only exception; no approval is assumed. Steps 4–6 remain open. Primary `master` remains
clean at `f0b1cf92195897e56e4917384b512c45d7b4d41a`; it has not executed this candidate. No new live
run, final review, integration, reference refreeze, production write or push occurred.

**Provisional delivery assessment addendum:** preserving the operator reference file is new operator
scope (D343), not a missed original implementation requirement. Its descriptor-closure change
predictably changes parity provenance and displayed hashes; that dependency should be included in
any future source-path amendment before full gates. One fixture-repair round was needed after the
first full run exposed the real child bootstrap fixture. Mandatory reruns and the failed parity lane
are reported separately; no completed-task assessment is claimed yet.

Checkpoint recording checks: `provider-record-check.log` (session 93490), 2 files / 39 architecture
binding/registry tests passed in 1.29 s; roadmap freshness and instruction audit passed; diff check
clean. The tracked executable/test/template input map matches the successful coverage/typecheck/lint
state byte-for-byte. Those gates are reused for this evidence-only addition, not claimed as rerun.

### Approved fingerprint refresh — classified before candidate gates (2026-09-07)

The operator explicitly approved the requested fingerprint-only exception. Consumed the provider-parity
handoff against checkpoint `9316abc6cf772212acef0541f26b903ac6e1db11`, clean tracked task state and
unchanged clean primary `master` at `f0b1cf92195897e56e4917384b512c45d7b4d41a`. The approval is
persisted in the plan and D343; earlier pending-decision text is historical evidence.

`npm run test:parity:update` (session 84116, `provider-parity-update.log`) passed all 259 tests in
63.227 s runner time. The complete update changed 210 a11y files, 210 corresponding metadata files
and 43 PNGs. Twenty additional capture pairs became reachable after the first failing capture in
multi-capture tests was repaired. Every text change matches the exact generated-fingerprint mappings
verified from the failed run; no other text or metadata field changed. The initial 190-case proposal
remains retained rather than silently rewritten to imply it covered those later captures.

`classify-provider-parity.py` and `provider-parity-classified.json` in the owned scratch root bind all
changed references to checkpoint `9316abc6`. Six before/after contact sheets were visually inspected,
covering every changed PNG. The installed Playwright `utils.getComparator('image/png')` then compared
all 43 pairs using the existing threshold 0.2 and maxDiffPixels 0: 7–81 counted pixels per image,
all within the displayed descriptor-hash glyphs (including dimmed background text behind dialogs).
Dimensions are unchanged; no counted differences exist elsewhere. Some raw antialiasing pixels
outside those regions differ but are ignored by the unchanged production comparator. No screenshot
was hand-edited and no assertion, tolerance, layout or UI code changed. Detailed counted diff images
are retained under `provider-counted-pixel-diffs` for independent review.

Full assertion-mode parity and candidate gates follow this classification; update-mode success alone
does not discharge Step 3. Private `.env`, `.env.providers`, credentials and test configuration were
not modified during this refresh. Steps 4–6 remain open.

### Step 3 reaccepted after the approved refresh (2026-09-07)

The candidate consists of source checkpoint `9316abc6` plus the classified fingerprint-reference
refresh and its approval/evidence records. No product/test/config source changed after that checkpoint.
The full required gate was rerun after references changed, using the unchanged two-worker adapter.

| Command | Result and evidence in the owned scratch root |
| --- | --- |
| `npm run typecheck` | Exit 0, session 8916, `refreshed-typecheck.log`. |
| `npm run lint` | Exit 0, zero warnings, session 19078, `refreshed-lint.log`. |
| Manifest / catalog / roadmap freshness; instruction audit | Exit 0, session 60986, `refreshed-freshness.log` / `refreshed-doc-audit.log`; diff check clean. |
| Full coverage through the approved adapter | 438 files / 5513 tests passed; statements 85.86%, branches 77.49%, functions 89.86%, lines 87.98%; 319.76 s Vitest / 321434 ms command. Session 8509, `refreshed-coverage-fixed.log`. |
| Suite-size | Unit 341 / architecture 80 / scenario 17, exit 0; `refreshed-suite-size-fixed.log`. |
| Standalone architecture through the same adapter | 80 files / 833 tests passed, 60.15 s Vitest / 60730 ms command; `refreshed-architecture.log`. |
| `npm run test:parity` (assertion mode) | All 259 passed, 59.1 s Playwright / 60021 ms command, no reference writes; `refreshed-parity.log`. |

`refreshed-gate-results.json` preserves exact commands/results/times. `refreshed-gated-inputs.json`
records all tracked executable, test, configuration, dependency and reference inputs for comparison
with subsequent evidence-only records. This recording also reconciles the roadmap's active status
and the explicit D343 parity exception; completion remains open. Live proofs, independent review,
integration and cleanup remain mandatory. Freeze the resulting commit before the primary checkout's
candidate-detach route; record its full identity with the new live evidence.

### Step 4 resumed — UCPath session acquisition blocked (2026-09-07)

Frozen candidate `331b7a8454afb19671e48881d5d8cb3ed93b6001` contains the approved fingerprint
refresh. The primary checkout was verified clean, dependency-compatible and byte-identical for all
tracked executable/configuration/test/reference inputs, then detached at that candidate. Original
`master` stayed `f0b1cf92195897e56e4917384b512c45d7b4d41a`. Both workflow-qualified private-input
checks were ready; source metadata matched the operator-confirmed input. Provider-file admission and
parent retired-name checks passed. Pre-doctor at `2026-09-07T20:18:20.312Z` was healthy v32/g0 on
the previously recorded database identity, with zero tasks/results and exact whole-table 0/0/0 writes.

The first new launch exited 1 in 1654 ms without a run/result. Raw process output was not retained;
a subsequent isolated admission probe reproduced `runtime config has no dashboard-activated generation`.
The actual `runtime_config` table was empty. Provider admission, CLI import and host-display probes
passed. This is the documented activation prerequisite, not a transient workflow outcome. The
supervisor had omitted BFF activation after the operator reset; no application-code repair was needed.
The failed report remains `person-lookup-d343-command.json`; the exact isolated refusal is
`d343-activation-refusal.json`, both in the existing owned scratch root.

Started the candidate BFF through `npm run cli -- dashboard` (owned launcher PID 18160, process
session 55688). Bootstrap returned HTTP 200, ordinary settings revision 1 activated as runtime
generation 1, and the same exact `requireActive` admission check passed. Activated pre-doctor at
`2026-09-07T20:21:43.469Z` was healthy schema 32/authority generation 1, same database identity,
zero tasks/results and zero write tables. No authority row was edited manually.

| Live proof | Exact authority evidence |
| --- | --- |
| Person Lookup command | `npm run cli -- dry-run-scenario person-lookup --subject person-lookup-canary`; process session 31160, exit 1, 62226 ms command / 60164 ms evaluator. |
| Insert-only result | `df0e7125-3c46-45c5-9127-47bf94c9a3a1`, `failed`, `live-read`; recorded `2026-09-07T20:22:54.737Z`; manifest digest `c7f309fc8e1bdc49f30a2b3574391e8872f8761d9c862160acf0814e9b5299a4`. |
| Run and trace | `6e42041a-cd1f-48c7-bc62-d945bd4b8950` / `pl-132154-6e42`; attempt 1, `dryRun=false`, terminal `failed`, zero checkpoints. |
| Failure and receipt | Failure `45b18271-c3b5-459a-832b-93aef6c90c11`, code `UNHANDLED`, node `searching`, `transient=false`, `writeState=not-attempted`. Diagnostic bundle `474a0aa8-ff51-4f53-965f-90d34c2a0f48`; receipt `725c0e5e-b898-56e6-bafe-3aa5394855e3`, result `failed`, confidence `unknown`. |
| Assertions | `nodes-excluded`, `gate-results`, `write-safety-deltas` met. `nodes-reached`, `checkpoints`, `receipt`, `terminal` failed. No passing live proof is claimed. |
| Exact write readback | Run-scoped `write_intents` / `write_attempts` / `durable_outbox` counts and deltas **0 / 0 / 0**; whole-table counts also **0 / 0 / 0**. |
| Separations | Not launched: it needs the same currently unverified UCPath login. This is a blocked prerequisite, not a scenario result or a claim about the selected subject. |

The failure's known static diagnostic identifies UCPath browser-session acquisition (open + login)
exceeding the unchanged 60000 ms `timeouts.sessionAcquireMs` bound. It carries no recorded Duo
terminal-refusal marker. A separate login-only diagnostic used the existing production smoke script,
`node --import tsx scripts/live-browser-login-smoke.ts ucpath --worker task-1-6-7-login`, on its own
fresh profile. Session 69548 exited 1 in 61430 ms at the same bound. Its value-free navigation-host
chain reached UCPath, the UC identity proxy, `a5.ucsd.edu`, Duo, then `a5.ucsd.edu` again; it never
proved an authenticated UCPath application. This narrows the blocker to login acquisition but does
not establish whether the remote service, returned SSO page or login recipe caused it. No timeout
was raised, no credential replaced, no workflow retried, and no production transaction occurred.
The next discriminating diagnosis is the exact post-Duo page state through an owned playwright-cli
session; a blind workflow rerun cannot settle it. Preserve the failed attempt and the manifest's
attempt-sensitive checkpoint assertions when deciding any future recovery.

Post-doctor at `2026-09-07T20:25:31.694Z` exited 0: same root identity, healthy schema 32/g39,
reconciled one run, zero pending commands/unresolved intents/durable outbox/terminal outbox/provider
reservations/artifact outbox. Doctor counts one lease row; exact readback proves worker
`person-lookup-worker-1` stopped (PID 18243 is gone), and the Duo ceremony lease is released. Do not
misreport the retained lease-row count as zero or delete it. Server/workers are stopped, no listeners
remain on 3938/5174, no matching owned runtime process remains, and playwright-cli reports no browsers.
The BFF stopped with exit 0. Restored the original `master` branch and full HEAD with clean tracked
and untracked state; private source files were not changed during live execution or diagnosis.

Sanitized scratch records: `live-primary-binding.json`, `live-d343-*-input.json`,
`live-d343-source-preflight.jsonl`, `live-d343-pre-doctor.json`, `live-d343-pre-counts.json`,
`d343-activated-pre-counts.json`, `live-d343-activated-pre-doctor.json`,
`person-lookup-d343-activated-command.json`, `person-lookup-d343-readback.json`,
`person-lookup-d343-failure-classification.json`, `d343-login-diagnostic.json`,
`live-d343-post-failed-doctor.json`, `live-d343-post-failed-source-locks.jsonl`, and
`live-d343-final-counts.json`. The wrapper never persisted arbitrary process output, private inputs,
credentials or value-derived hashes. Earlier failures and their scratch roots remain retained.

**Actual blocker:** UCPath login acquisition has not succeeded, so Step 4 and full acceptance remain
open. Steps 1–3 remain accepted at the frozen candidate. No final review or merge has occurred;
steps 5–6 still require passing live evidence, final handoff reconciliation, one fresh complete
`sup_review`, integration gates and owned cleanup. The worktree/ref and diagnostic artifacts remain
owned and unmerged. Phase 2.6 and production work remain unauthorized.

**Provisional delivery assessment:** the missed dashboard activation was a supervisor execution
omission of an existing runtime prerequisite, resolved through ordinary BFF startup and a positive
admission check. Add that admission observation to any resume preflight. The subsequent UCPath
acquisition failure is a live prerequisite failure with cause still unresolved; neither external
outage nor product defect is proved. No live retry or review repair round is claimed.

Blocked-record checks: 2 architecture files / 39 roadmap-binding and target-registry tests passed
in 1.54 s (`live-blocked-record-bindings.log`, session 20494). Lint passed with zero warnings
(`live-blocked-record-lint.log`, session 32026); roadmap freshness, instruction-pair/size audit and
diff checks passed. All 1908 entries in `refreshed-gated-inputs.json` matched byte-for-byte, so
D191 reuses the recorded full typecheck/coverage/architecture/parity gates for these three
Markdown-only evidence additions. Live failure is not waived by that reuse. The stopped diagnostic
profile `.auth/hrauto-rebuild/task-1-6-7-login` and its stopped smoke lock remain retained on the
primary checkout for unresolved diagnosis; do not sweep other profiles in the shared worker root.


### Login diagnosis and required-gate repair in progress (2026-09-07)

The operator confirmed normal-browser UCPath access and explicitly resumed execution. Reverified
clean primary master `f0b1cf92`, owned branch `d5253fc1`, all 1908 gated inputs, unchanged private
source metadata, admitted provider file, stopped runtime and healthy v32/g39 root. The diagnostic
browser ran only from primary detached at executable candidate `331b7a84`; primary master was
restored afterward. No workflow was retried and no private source was changed.

An owned playwright-cli session, `task7-auth-inspect`, used full Chromium 1228 (the same binary as
the runtime) and the production login recipe through a credential-reading page-init hook. The CLI's
newer default Chromium revision was absent; the diagnostic was explicitly pointed at the existing
runtime binary. Two harness admission errors were corrected before interpreting login observations:
the credential source must expose only `read`, and the recipe/ceremony gate must share one module
namespace. Neither harness refusal is live workflow evidence.

Live observations then proved Duo `Success` / `Duo Autopilot approved`, followed by UCPath's
`WEBLIB_IS_PB.ISCRIPT1.FieldFormula.IScript_BuildPage` redirect. Twice the login's explicit HR Tasks
navigation was interrupted by that ongoing navigation; the final page then became HR Tasks and
held a nonempty PS_TOKEN with no TritON or PeopleSoft sign-in form. The decisive sanitized nested
error is in `auth-inspect-navigation-race.json`; `auth-inspect-returned-page.json` retains the first
observation. Query values and credentials were excluded. This proves a redirect-ownership defect,
not a need to raise a timeout or change the operator's MFA. The earlier acquisition timeout remains
historical evidence; its unobserved page state is not retroactively relabeled.

The Task-7 required-gate repair changes only the UCPath entry-navigation failure arm. When the
reported interruption coincides with the observed BuildPage route on the configured origin and
PeopleSoft realm, wait for the exact configured entry rather than issue another navigation. All
other errors refuse. The existing final authentication proof (PS_TOKEN and both sign-in-form
absences), the configured timeouts and outer session-acquisition deadline remain unchanged. No
SSO replay, guessed selector, credential mutation or authority bypass is introduced.

Regression `auth-redirect-red.log`, session 89171: one expected failure / 37 passes at the original
login implementation, retained `/private/tmp/hrt-501/run-NAIF8l`. After the repair,
`auth-redirect-green.log`, session 55620: three files / 73 tests passed (2.73 s), covering exact entry,
missing cookie, remaining form, wrong route, unsettled redirect, foreign origin and unrelated error.
Typecheck passed (`auth-typecheck.log`, session 28210). Initial lint found one test call-format error
(`auth-lint.log`, session 66428); the format is repaired before full gates. No reference or generated
manifest changed when `npm run build:manifest` was rerun for this session-only source repair.

The retained failed Person Lookup run spent attempt 1. Its next rehearsal's T1b declaration now pins
exact attempt 2; the evaluator/schema and all seven assertions are unchanged. This is an exact
manifest precondition update, not accepting an arbitrary observed attempt, deleting history or
waiving checkpoint identity. The real-runtime fixture first reproduces a failed acquisition with no
checkpoint, then proves the new run owns attempt 2 while attempt 1 remains terminal failed. A
negative control rejects attempt-1 checkpoint evidence. An initial fixture used a successful prior
run and correctly exposed fresh-checkpoint reuse (`auth-attempt-fixture.log`, retained
`/private/tmp/hrt-501/run-qsREsG`); it was corrected to the actual failed-acquisition precondition,
not by changing replay policy. `auth-attempt-fixture-fixed.log`, session 72616, passed all five tests;
the added wrong-attempt negative control will also run in the full candidate gate.

Steps 3–6 remain open for this repaired input set: full deterministic gates, frozen-candidate primary
login/live proofs, evidence, fresh complete review, integration and cleanup. Both passing live
manifests remain mandatory; no acceptance is inferred from diagnostic login or focused tests.

### Repaired Step 3 accepted (2026-09-07)

The repaired input set passed typecheck, zero-warning lint, manifest/catalog/roadmap freshness,
instruction-pair/size audit and diff checks. Serial gate session 48301 used the same checked
two-worker adapter (SHA-256 `1da8cd8f34f538a00f96e5d92a7b422a53794b05b79789c5a24c880184e63936`,
actual task vitest config `1f9122bf9bbcf1fcab9e01b5aec3428bcde7f9b10b47f0f91aab41775bdbf68f`).
`auth-candidate-gate-results.json` records every command and exit 0:

| Gate | Accepted evidence | Wall time |
| --- | --- | --- |
| Full coverage | 438 files / 5520 tests; statements 85.87%, branches 77.51%, functions 89.87%, lines 87.99%; floors met | 302321 ms |
| Suite size | Passed without membership or floor changes | 203 ms |
| Standalone architecture | 80 files / 833 tests | 59140 ms |
| Assertion-mode desktop parity | 259 passed; no further reference changes | 60662 ms |

The four logs are `auth-candidate-coverage-fixed.log`, `auth-candidate-suite-size-fixed.log`,
`auth-candidate-architecture.log` and `auth-candidate-parity.log` in the existing owned scratch root.
`auth-gated-inputs.json` captures all 1908 tracked gate-input hashes before this evidence-only
addition. The exact source/test changes will be committed before primary execution. Step 4 still
requires a successful production-factory login smoke and both mandatory T1b proofs. Review and
integration remain open.

The consumed `2026-09-07-task-1-6-7-ucpath-login.md` handoff's surviving Git, failed-run, private-source,
restoration and retained-profile facts are now recorded above. Its pending normal-browser question
is answered, and the observed navigation diagnosis supersedes its proposed next action. Removed
only that temporary handoff. Retain the original failed smoke profile and the three stopped owned
diagnostic profiles `.auth/task7-auth-inspect-profile`, `.auth/task7-auth-inspect-second-profile`,
`.auth/task7-auth-cause-profile` until diagnosis and final owned cleanup conclude. The last actual-root
doctor at `2026-09-07T22:38:26.555Z` was healthy schema32/g47, with zero pending counts and one
retained stopped worker lease. Recheck this volatile state before any launch.
