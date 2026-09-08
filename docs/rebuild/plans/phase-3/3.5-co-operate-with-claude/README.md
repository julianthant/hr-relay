# Phase 3.5 · Codex and Claude cooperation

Read the [phase overview](../README.md) for shared context, decisions and phase-wide exit criteria.

This part gives operator-directed agents the same local dashboard API capabilities as the human
operator. D338 (2026-09-06) supersedes R15's two-actor approval design: agents can queue runs, approve
gates, authorize live runs, edit settings and invoke any other supported human action. Every caller
uses the same command protocol and guardrails. Actor identity makes the history truthful; it does
not create a permission tier. Direct HTTP access is sufficient; an MCP wrapper is optional.

**Execution order.** D342 renumbers this part from 3.4 to 3.5; stable node IDs and D338 scope
remain unchanged. Begin after 3.3 closes; optional Phase 3.4 does not block entry. Task 1 → Task 2 →
Tasks 2.1/2.2 (independent parallel children) → Task 3. This part closes Phase 3
before Phase 4. Desktop attachment remains Phase 6. Existing D75 solo request admission is built;
the agent capability and attribution changes below are not yet implemented.

## Current assignment names (D344)

| Current task | Outcome | Historical task alias |
| --- | --- | --- |
| 3.5.1 | Actor identity and capability parity | 1 |
| 3.5.2 | Existing API and shared client prerequisite | 2 |
| 3.5.2.1 | Monitoring and actor inbox | 3 |
| 3.5.2.2 | Actor-aware clients | 4 |
| 3.5.3 | Integrated cooperation proof and closure | 5 |

The parent completes its own accepted, merged scope before either child starts. Its focused plan
must settle shared interface/fixture changes, exact disjoint paths, gate resources and either-order
integration. Both children consume the completed observed-log producer. Agents work independently
by default and coordinate only when necessary under [D344](../../../../roadmap/roadmap.md#d344--operator-coordinated-prerequisite-groups-2026-09-08).
The operator chooses launches and merges. Historical headings below remain citation aliases.

## Track summary
<!-- roadmap: claude-operator -->

<!-- roadmap-status: claude-operator -->
> 2026-09-07 | D342 optional documents | cooperation moves to 3.5; optional 3.4 features are not prerequisites; implementation remains open
- [ ] one local BFF and one shared API for the operator, Codex and Claude clients
- [ ] actual caller identity derived at admission and recorded on every durable action
- [ ] full action parity, including HR approvals and live-run authorization, with the same guardrails
- [ ] direct HTTP command/read/stream access; no mandatory MCP server or second API
- [ ] actor-aware monitoring, notification inbox and existing clients
- [ ] an agent-operated dry-run proof with agent-resolved gates and truthful attribution
> 2026-09-06 | D338 operator correction | replaces the unbuilt two-actor rule and required MCP wrapper; implementation and proof remain open
<!-- /roadmap-status -->

### Governing contracts

| Concern | Owner / inherited behavior |
|---|---|
| Commands and actor attribution | ref frontend-backend-integration §3.4 / §4; one admission checkpoint, strict envelopes, current-version conflict detection, exact replay and truthful outcomes |
| HR approval and write resolution | ref write-safety §D338 / §14 / §4.1; every caller satisfies the same evidence, identity, freshness, ceremony, idempotency and unknown-submit rules |
| Run identity and lifecycle | ref dashboard-surfaces §D330; the same canonical run service and command journal |
| One host and client attachment | D181's server role lock; web and agent clients attach to the same BFF; Phase 6 owns desktop attachment |
| Monitoring and notifications | ref frontend-backend-integration §3.5; ref operator-trust §6; resumable stream, truthful gaps, actor-keyed inbox and observed logs |

**What parity means.** If a human could approve the current gate through the dashboard, an agent
with the same current evidence and required confirmation fields can approve it through the API.
That approval takes effect once and records the agent as resolver. There is no human confirmation
step, agent proposal state or `pending-confirmation` result. Stale evidence, an invalid subject,
a duplicate command or an unresolved possible submit receives the same result for either caller.
The agent follows the operator's instructions; this phase introduces no autonomous operating policy.

## Task 1 · Derive actor identity and preserve full capability parity
<!-- roadmap: claude-actor -->

<!-- roadmap-status: claude-actor -->
- [x] D75 solo baseline: one BFF admission checkpoint, strict local-operator identity, mismatch rejection before effects (2026-08-29)
- [ ] extend that checkpoint to derive the supported human/agent caller from its own client credential; never trust a body-supplied actor alone
- [ ] preserve one action policy for all callers, including gate resolution, live start and evidence-qualified write resolution
- [ ] stamp actual caller identity in command/audit, gate resolver, ledger, receipts and other existing actor-bearing records
- [ ] reject attribution spoofing and stale/invalid requests equally, without an agent-specific capability refusal
- [ ] prove one valid approval settles for one caller; no two-actor pending state or confirming-actor migration is added
> 2026-09-06 | D338 | actual actor attribution and API parity replace the proposed two-actor schema; the D75 solo proof stays evidenced
<!-- /roadmap-status -->

The focused plan binds supported actor IDs and client-credential mechanics against the existing
request checkpoint. It must not create a separate agent execution path, duplicate action policy,
second listener for privilege selection or permission escalation by changing `requestedBy`.
Preserve all historical resolver identities; an old record is not relabelled as agent-performed.
Any schema work is justified by actor attribution itself, never by the retired second confirmer.

## Task 2 · Make the existing API usable by agent clients
<!-- roadmap: claude-mcp -->

<!-- roadmap-status: claude-mcp -->
- [ ] expose/document the existing loopback bootstrap, read models, command endpoint and resumable stream for authenticated agent clients
- [ ] cover every supported human command, including Run/Rerun, approvals, write resolution, queue, archive, settings, intake, notifications and bulk operations
- [ ] use current versions and server-declared actions/ceremony fields; preserve exact replay and surface all named refusals without hiding them
- [ ] document direct HTTP examples for read → command → result/monitor; no MCP dependency is needed to perform or prove those operations
- [ ] refuse truthfully when no BFF answers; a client does not start a competing host
> 2026-09-06 | D338 | direct API access is the required path; the stable roadmap node id claude-mcp is retained, but an MCP wrapper is optional convenience
<!-- /roadmap-status -->

Use the same `/api/v1/**` routes and schemas as the dashboard. An optional MCP client wraps those
routes, reuses the existing transport/contracts and exposes the same capabilities. It owns no
journal, approval state, policy registry or execution engine. The existing source-bound Run/Rerun
flow and duplicate-submission warning apply unchanged; source-run editing and retired Capture
commands do not return. A stale or unavailable action is equally unavailable to any caller.

Before closing current 3.5.2, complete shared interface/fixture changes needed by both children;
bind disjoint paths and private gate resources, and prove independent candidates can merge in either
order. Coordinate when necessary to clarify overlap; operator-approved plan changes precede affected writes.

## Task 3 · Add cursor-based monitoring and the actor inbox
<!-- roadmap: claude-monitor -->

**Current assignment: 3.5.2.1.** The heading is a historical citation alias.

<!-- roadmap-status: claude-monitor -->
- [ ] expose a resumable stream using Last-Event-ID; report reset-required, missing history and degraded monitoring explicitly
- [ ] serve actor-keyed notification inbox/read/snooze through the existing notification authority
- [ ] persist the actor stream cursor so a new client session resumes, and serve a bounded what-changed-since-cursor read
- [ ] deliver observed logs and evidence references, not invented page observations or step names presented as observations
- [ ] prove reconnect, duplicate/missed events, actor-inbox isolation and a second simultaneous reader
<!-- /roadmap-status -->

The stream and projections remain shared. The agent monitors the same runs, facts and changes the
operator sees; its inbox state is its own actor-keyed state. Cursor acknowledgement never proves
that an HR action was performed. This task depends on Task 2 and the observed-log producer.

## Task 4 · Make existing clients actor-aware
<!-- roadmap: claude-clients -->

**Current assignment: 3.5.2.2.** The heading is a historical citation alias.

<!-- roadmap-status: claude-clients -->
- [ ] preserve one BFF elected by the server-role lock; web and agent clients attach to that host
- [ ] render the actual actor on approvals, archive plans, receipts, commands and notifications
- [ ] show the live client roster and last activity honestly as live state, not durable history
- [ ] surface no-BFF and stale-version conflicts through the shared response vocabulary
- [ ] prove simultaneous clients cannot silently overwrite each other's actions; Phase 6 owns desktop attachment and packaged-app messaging
<!-- /roadmap-status -->

An approval performed by an agent says who approved it; it never says a human confirmed it unless
there was an actual separate human action with that meaning. Client presentation cannot authorize
an action the shared API would reject or impose an extra agent-only confirmation.

## Task 5 · Prove attributed cooperation and close Phase 3
<!-- roadmap: claude-proof -->

**Current assignment: 3.5.3.** The heading is a historical citation alias.

<!-- roadmap-status: claude-proof -->
- [ ] drive a Separations dry run through direct API calls: start, monitor, resolve a required identity gate, resume and reach its terminal preview
- [ ] attribute each action to its real caller, including the agent gate resolver; require no second-actor confirmation
- [ ] prove agent/human capability parity for every command family with focused tests, including live-start and write-resolution boundaries without adding a live HR write to this proof
- [ ] prove stale evidence, invalid ceremony, divergent replay, unknown-submit retry and caller spoofing are refused by the same rules for both caller kinds
- [ ] prove simultaneous human/agent clients, one host/journal, resumable monitoring and actor-keyed inbox behavior
- [ ] record the durable dry-run/T4 evidence and complete the required integrated gates, review and cleanup
<!-- /roadmap-status -->

This proof does not repeat Phase 3.3's controlled transactions. D338 grants product capability
parity; it does not silently authorize a new live transaction in this implementation task. T4's
parallel-run arm still depends on the real worker pool and Duo lease. A wrapper is not required for
the direct-API proof, and failure of an optional wrapper cannot invalidate a correctly proven API.

## Decisions this track ratified

D338 is owned by ref frontend-backend-integration §4 and ref write-safety §D338, with its pointer in
ref decisions. R15's local cooperation goal survives; its two-actor approval and mandatory-MCP
mechanisms are superseded. Actor attribution, shared command validation and the one-host topology
remain requirements. This document is the phase assignment, not another API specification.

## Exit criteria

| Criterion | Required evidence |
|---|---|
| Direct API operation | An agent can read, command and monitor through the existing BFF with truthful unavailable/conflict outcomes |
| Full capability parity | The same valid request is eligible for human and agent callers; no agent-only denial or second confirmation |
| Approval correctness | An agent resolves a real dry-run gate once; current evidence/ceremony checks and unknown-write refusal remain proven |
| Attribution and concurrency | Real caller recorded throughout; one host/journal and ordinary version conflicts across clients |
| Monitoring | Resumable stream, truthful gaps, actor-keyed inbox and actual observed logs |

No remote hosting, multi-user tenancy, separate execution engine or hosted-model API is added.
