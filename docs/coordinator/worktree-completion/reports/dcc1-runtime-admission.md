# DCC1 F7 — runtime-generation admission hold

Coordinator receive, 2026-08-30. Assigned source:
`/Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc1`.
This records the diagnosis and subsequent bounded F7b approval, not heavy-gate readiness.

## F7b partial receive — pinned implementation, reviews pending

Coordinator verified HEAD0c115123/MERGE13175, exact staged tree
`c9fb464e21479be70e24bf2897c9430b66bde71a`, and its four-path delta from160eeda8:
runtime, public composition test, root AGENTS and F7b report only. Excluded source/history paths
are unchanged; no unresolved entries, cached whitespace0. Only supervisor coordination reports
have unstaged changes. Runtime blob `ec2933b2587eee5359abd0c7d7b44952ff9d38de`, test
`4346f2f4b7de075eeb190d2f46bf643a57c265ce`, AGENTS
`3e5940007eba8341f1b0ea69e8c50a56b2ebb5ee` match the receipt. Recomputed recursive-tree listing
using the gate-freeze recipe, excluding only run reports/evidence/handoffs, yields
`6e48c11225f5614eb83a7764c40e8a01ac755d33a4522d634173d695e7dee886`.

| Evidence | Classification / limit |
|---|---|
| Runtime delta | Source-verified selected Settings resolve, exact journal/runtime fence before planner/kernel, retained active snapshot, and identity publication after transaction/handle closure; independent correctness/security review still pending |
| Conditional Duo port | Retained blob diffs independently verified exactly4runtime+3test additions. Separate normalized returned-output ledger29375 exit1 has13pass/2credential failures after admission;70085 exit0 has15pass |
| Worker final checks | F7b ledger28124 exit0,15/15 at09:03:44/3.61s; individually locked15288 typecheck0 and95655 lint0 after earlier lint correction. Ledger explicitly trims trailing formatter whitespace: normalized tool output, not byte-identical raw logs |
| Parent rerun | Received assigned dcc1-review-candidate.md exact command/output/exit records:59203 exit0,15/15 at09:07:56/3.77s; separately locked58014 typecheck0 and47509 lint0. Presentation-normalized returned tool output, not byte-identical logs or a coordinator rerun |
| Review/readiness | Independent Silent-failures Count0 persisted/received on160eeda8..c9fb464e; Correctness/Security Count0 callback-reported, remaining axes active/pending. No full gate, allocation, commit or final acceptance |

The original distinct generation failure remains historical evidence below. No heavy reservation
or product commit authorization follows from this partial receive.

| Claim | Classification | Evidence checked | Disposition |
|---|---|---|---|
| Conditional Duo-port red did not match | Proved from retained command/output receipt | Assigned `reports/dcc1-f7.md`: single-worker `npm run test -- tests/unit/dry-run-scenario-composition.test.ts`, session70316 exit1, 2 failed/6 passed,2.79s; both fail `runtime config has no dashboard-activated generation` | Duo port withheld; equal failure counts are not equal failure causes |
| Parent reproduced same red | Supervisor-reported, not a coordinator rerun | Parent callback: exit1,2 failed/6 passed,2.56s | Consistent corroboration; not relabeled independent coordinator execution |
| No executable change from ready candidate | Proved by Git | HEAD0c115123a738f62cbe01c9b45f53b7289284479c, MERGE_HEAD13175b13340fec7b5326207fe54f98078d481d7d; index68c6147bc0dc88786e7a3659901968db43551df1 differs from488fecfabb40df072c4294800b07c3771ba1a20e only by166-line F7 report | Prior executable closure remains; readiness still withdrawn |
| Failure precedes Duo construction | Proved by source plus stack | `worker/compose.ts:463–471` requires exact active Settings/config; Duo factory is later at510; `authority-database.ts:3810` rejects absence | Do not weaken worker admission or provision credentials |
| Starter and worker use different config authority paths | Proved by source | `dry-run-scenario/runtime.ts:208–223` resolves env+empty Settings and inserts a new snapshot; dashboard `compose.ts:604–623` inserts its snapshot and activates runtime generation | Production composition join needs resolution; a test-only seed would not fix it |
| Activation belongs to dashboard boot | Proved by owner text | Assigned `clock-config-secrets.md:401–430`, with dry-run execution contract in `guards-and-tests.md` §10.4 | Preserve owner; no new standalone activation policy inferred |

## Initial read-only disposition — completed

Existing DCC1 supervisor received a read-only, single-seam analysis assignment using an existing
native unit. Return the minimal proposal for admitting the scenario starter against the selected
Settings/current/runtime identity and its activated snapshot **before start-plan/run effects**.
Trace the owning dry-run contract for any explicit incompatible standalone guarantee. The proposal
must preserve environment precedence, immutable run identity and dashboard-only activation.

Identify red-capable tests through the public production runtime for absent/stale/divergent
admission, activated nondefault Settings success, and no start effects on refusal. This is not
permission to write tests or implementation yet. No fake authority seed, auto-activation, default
generation, worker/CLI/auth/history edits or live provisioning. A genuine product-choice conflict
returns to the coordinator/operator rather than being decided in code. The seven-line Duo port
remains conditional on its actual later failure, not the presently observed one.

Fresh locked lint exit0 is recorded by the F7 receipt; no coordinator product tests were run.
Two unstaged files and the one untracked freeze ledger are coordination evidence only. No merge
commit or full coverage/parity has run. DCC4 retains the allocated9ede08fa heavy slot; DCC1 has no
reservation. Migration and D75 shared-integration boundaries remain unchanged.

## F7a received; bounded F7b implementation approved

Read complete assigned `reports/dcc1-f7a-analysis.md` and independently checked the named interfaces:
`runtimeConfig.requireActive` validates the exact selected revision/settings/config and retained
snapshot; `get()` can supply its ID in the same SQLite transaction. `BEGIN IMMEDIATE` excludes
concurrent writers through commit, nested authority calls use savepoints, and `withExactRecord`
preserves the file identity fence. Owner clock-config-secrets:401–430 assigns activation to
dashboard boot. No incompatible never-activated standalone guarantee was found in the bounded
guard owner passages §10.4/§10.6; this is not a repository-wide absence claim. Git still shows no
product/test/config/reference delta from488fecfa before approval.

Approved to the existing supervisor, reusing one native writer: `runtime.ts` start-time admission
join, its public composition tests, nearest lesson and only directly inaccurate owner wording.
No new activation policy. Selected Settings reconciliation, env+Settings resolution, final exact
file/journal/runtime admission and planner/kernel creation use the existing synchronous authority
fences. Reuse the validated activated snapshot; do not mint a second one or change worker/core/
CLI/dashboard/blocked-target composition. No live state, auth, migration or D75 changes.

Explicit test seam: public `runtime.start` against temporary real selected file/journal/runtime
authorities. Prove absent/stale/env-divergent/missing-or-mismatched-snapshot refusal before start
effects; journaled nondefault Settings plus matching activation must retain exact snapshot identity
and environment precedence with no new snapshot. Check plans/runs/runSessions/start commands/audits/
snapshots separately from legitimate Settings reconciliation/init. Pin rollback and in-memory
identity consistency at the existing seam; failure cannot publish usable stale start identity.
Positive activation setup is a legitimate prerequisite, not a seed concealing unchanged production.

Retain original red and show new admission/nondefault tests red before fix. If the repaired path
then exposes the distinct missing-Duo red, the earlier exact four runtime plus three fixture lines
from845ca5a1 remain conditionally approved as a separately recorded delta; no wholesale replacement
over the join and no production default changes. Stop if excluded interfaces or activation policy
must change. Independent Spec/Correctness/Silent/Tests/Security and relevant Standards/Docs/
Performance reviews, fresh serial locked lights and new frozen identity precede heavy readiness.
No full gate or pre-gate product commit authorized. Queue remains DCC4 → DCA4 → DCA2.
