# Database prerequisites — launch this task first

## Assignment and approval

**Task: `side/database-prerequisites`. One Astra/high supervisor executes both prerequisite units
sequentially.** On 2026-09-08 the operator requested one folder containing the prerequisite plan and
all parallel plans, so they can finish the prerequisite and then launch all peers. This entry point
combines the launch, not the safety boundaries: A and B retain their own implementation, gates,
independent reviews, accepted integration commits and cleanup. Product contracts are unchanged.

**WAITING ON accepted integration of existing timeline T2 and its unchanged prerequisites.** Do not
launch early, import an unmerged prerequisite or modify the four existing running assignments.
Planning has not implemented or released this prerequisite.

## What this task completes

1. **Unit A — run completion:** execute the complete [00a-run-completion.md](00a-run-completion.md)
   specification, including all P1–P6. Keep its stable unit ID `side/run-completion` for proof records.
2. **Unit B — shared storage:** after A's accepted integration and cleanup, execute the complete
   [foundation specification](README.md#b--shared-database-foundation), its allocated product proofs
   and the [frozen peer ownership/release requirements](README.md#frozen-peer-ownership-and-release-proof).
   Keep unit ID `side/database-foundation`. B completes all shared migrations, contracts, adapters,
   import/extraction work and composition required before independent peers can start.
3. **Release the peers:** after B's accepted integration, gates and cleanup, publish the exact shared
   base and evidence below. Return the three launch prompts with that actual SHA. Do not launch peers.

The complete product scopes remain in [provider usage](01-provider-usage.md),
[diagnostics](02-diagnostics.md) and [artifacts](03-artifacts.md). This entry point does not replace
their data contracts, exclusions or proof rows. The [batch README](README.md) owns cross-plan file
ownership, concurrency, resource scheduling, gates, integration and compact handoffs.

## One task, two checked boundaries

Run both units locally in this supervisor task. Do not spawn subordinate supervisors or ask the
operator to start a second prerequisite task. Send Done / Now / Remaining at start/resume and after
each verified step; keep all outstanding review, gates, integration, cleanup and release work visible.

| Unit | Create branch and absolute checkout | Verified execution base | Boundary before continuing |
| --- | --- | --- | --- |
| A | `codex/run-completion`, `/Users/julianhein/Projects/hr-worktree-run-completion` | Actual accepted local-master timeline T2 integration containing this approved plan; record full SHA. | Complete A, all gates, fresh independent review, accepted local integration and owned cleanup. |
| B | `codex/database-foundation`, `/Users/julianhein/Projects/hr-worktree-database-foundation` | A's actual accepted local-master integration, recorded after A closes. | Complete B, all allocated proof, gates, fresh independent review, accepted local integration, owned cleanup and release evidence. |

Verify availability and the four-auxiliary-worktree ceiling before creating either checkout. Reuse
only this exact task/unit's verified interrupted checkout. Do not reserve B's checkout while A runs.
When leaving a completed checkout, move to a safe directory before removing it. Keep A and B evidence
at their respective specification owners; this entry point holds only links and accepted identities.

The prerequisite launch prompt **explicitly assigns local integration and cleanup of A then B** to
this implementing supervisor after review PASS and required gates. That permits finishing the whole
prerequisite without another launch or routine permission request. It does not permit integrating an
unreviewed candidate, overriding a busy/shared target, pushing, launching peers, changing scope or
applying a migration to the operator database. The operator remains free to restrict that launch.

Target: local master at `/Users/julianhein/Projects/hr-automation-rebuild`. Verify target ownership
and serialize target mutation. If the target is shared/dirty, isolate integration as the batch plan
requires; preserve unrelated changes. A real unavailable integration window blocks progression to B
or peer release. Return its concrete owner/resource/evidence without idle polling. Do not label a
reviewed candidate complete before accepted integration, integration gates and cleanup.

## Agents and gates

A uses this supervisor and one fresh independent read-only `sup_review`, Astra/high. B retains its
one optional bounded `sup_astra` test worker only after stable inputs exist, then a fresh independent
`sup_review`. Finish the worker before final review. At most two active agents in this prerequisite
task at a time. Follow native role checks, exact ownership and context bounds; no nested delegation.

Every implementation candidate/commit and materially changed integration tree retains typecheck,
lint, full coverage, web build, full parity, affected generation checks and `git diff --check`, with
D191 cadence and the batch's test-resource rules. Independent review binds exact base/head/tree and
the complete assigned unit, including its cross-unit interactions. Fix findings and re-review;
behavioral integration conflicts require renewed independent review and gates. Existing assertions,
test membership, coverage floors, isolation and timeouts remain unchanged.

The record must prove B alone provides the real production interfaces, schemas, migrations and
fixtures needed by each peer. Do not release promised APIs, a frontend backed only by mocks, a
future shared schema edit, or gates that require another unmerged peer. Each parallel task must
implement and test against this same accepted B base and be integrable before or after either peer.

## Release record

The prerequisite supervisor fills this table from actual evidence. An empty field is not a passed
condition. Detailed A proof stays in 00a; detailed B/frozen-interface proof stays in the README.
Only this prerequisite task writes this release record. Parallel peers consume it without editing it.

| Required evidence | Current value |
| --- | --- |
| Approved plan commit and actual prerequisite task ID | Not launched |
| Accepted timeline T2 base and existing predecessor proof | Pending verification |
| A candidate base/head/tree, review PASS and gate evidence | Not started |
| A accepted integration SHA and verified branch/worktree cleanup | Not started |
| B candidate base/head/tree, review PASS and gate evidence | Not started |
| Exact frozen APIs, production entry points and disjoint P/D/G file/test/fixture ownership | Not implemented; see README release criteria |
| Independent real baseline flows and pairwise either-order dependency proof | Not implemented |
| B accepted local-master integration SHA — common peer execution base | Not available |
| B integration gates and verified branch/worktree cleanup | Not started |
| Available peer worktree capacity and host test-slot allocation | Recheck at release |
| Peer launch status | **WAITING ON complete prerequisite acceptance** |

Only after every required row is verified, record **READY: P, D and G may launch independently from
the recorded B release SHA**, and return updated copy-ready prompts for all three. Do not automatically
start tasks. If interrupted with unique state, use a compact durable handoff and resume this task;
do not replace the two checked boundaries with an unreviewed combined shortcut.

## After release

The operator launches three Astra/high supervisor tasks: [provider accounting](01-provider-usage.md),
[diagnostic resolution](02-diagnostics.md), and [generated artifacts](03-artifacts.md). Each has its
own independent reviewer. Provider accounting remains the one implementing peer integration owner;
this prerequisite task ends and does not become a fourth coordinator or monitor.
