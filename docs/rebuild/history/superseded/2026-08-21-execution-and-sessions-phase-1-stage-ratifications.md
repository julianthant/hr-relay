# Superseded — `reference/execution-and-sessions.md`'s four Phase-1 stage blocks

**Moved here 2026-08-21** by the docs-cohesion rewrite (step 5.1). These four dated blocks stood
above `## 0.` and narrated the session seam as it was ratified stage by stage: what Phase 1d could
declare, what the 1f runtime then owned, what the concrete factory landed, and the bound D125 added
after the Phase-1 live exit run.

**What answers each of them now** — `reference/execution-and-sessions.md`:

| this file's block | where its contract lives now |
|---|---|
| `## Phase 1d session seam ratification (2026-08-01)` | §2 (the workflow session contract, with the nine declared providers and the four landed bindings as-built) |
| `## Phase 1f worker-session runtime (2026-08-02)` | §4 (browser-session behaviour: the callback lease, the D116 reuse identity, the poison rule) and §2.1 (park/stop) |
| `## Phase 1f concrete session factory (2026-08-03)` | §4 (the factory, the profile partition and the close proof) and §4.1 (the content-level proof it re-runs) |
| `## Session acquisition is bounded separately from the task (D125, 2026-08-04)` | §4.3, which keeps the whole argument and the measured numbers |

Nothing here is normative. Two of its sentences were already false of the tree when it moved: only
UCPath and CRM were bound in it (four systems are bound today — `src/infra/browser/system-bindings.ts`),
and it was written before D243 made a Duo ceremony a shared-resource problem (§4.2, §10).

---

## Phase 1d session seam ratification (2026-08-01)

**D96 replaces the partial shapes in earlier drafts with one imported ref task-contract `SessionNeed`:**
`{system, access:"read"|"transaction", session:"reuse-worker"|"fresh", exclusive?:true,
acceptDownloads?:true}`. This doc owns worker/session behavior but does not redefine that type.
Read tasks require read access; prepare/commit tasks require transaction access; mismatches fail at
the task/store boundary before an executor exists. `exclusive:true` is legal only for OnBase, and
OnBase is the only identity-exclusive provider declaration. Phase 1d may declare sessions and
fail-loud unwired login callbacks; acquisition, close ordering, fresh-boundary execution, and
cross-process lease behavior remain 1f runtime work.

As built on 2026-08-01, each of the nine browser stores declares exactly one matching
`SessionProvider`. Every placeholder login rejects with an explicit "declared but unwired in Phase
1d" error; none creates a browser or claims authentication. OnBase alone declares and requires
`exclusive:true`. The store/task boundary validates the full `SessionNeed` shape and effect/access
agreement now, while worker-owned acquisition, reuse, close/reset, and cross-process leases remain
absent until 1f.

## Phase 1f worker-session runtime (2026-08-02)

`WorkerSessionManager` now owns the callback-scoped driver lease for each
`(worker, system, resolvedInstance, configFingerprint)` identity.
The manager serializes use within that pair, performs a single authenticated start, and reuses the
resource only when that complete identity plus its download and exclusivity launch properties
match the authored need. A changed config fingerprint or resolved instance closes the old resource
and creates a new one; it can never reuse a context authenticated/configured under another run
snapshot. A clean callback must reset before release. A task failure, cancellation, or failed reset
poison-closes the resource; a `fresh` need proves the old page/context (and OnBase identity lease)
closed before the replacement emits `browser-session:start`.

Parking and worker stop first reject new leases, wait behind every in-flight callback, then close
all owned resources. A missing or failed close proof leaves the resource registered and poisoned:
the manager refuses reuse instead of treating an uncertain close as success. The same rule covers
failed-login cleanup, so a resource whose cleanup could not be proved cannot disappear from worker
ownership. The nine store providers now accept the worker resource's bounded authentication handle;
concrete browser creation remains a factory injected at the runtime composition boundary.

## Phase 1f concrete session factory (2026-08-03)

That injected factory is now real. `src/infra/browser/` launches Playwright's FULL bundled Chromium
(`channel: "chromium"`) in a persistent context with the Duo Autopilot extension loaded — all three
are requirements rather than preferences: Chrome stable dropped `--load-extension`, the lightweight
headless shell cannot run an extension, and an extension requires a persistent context. Profiles
live under the runtime-isolation `browserProfileRoot`/`browserSessionNamespace`, namespaced per
`(worker, system, resolvedInstance, configFingerprint)`, so D116's no-cross-snapshot-reuse rule also
holds for on-disk state, not just for the in-memory context.

`close()` returns a proof only after observing every page closed AND the context's own close event
inside a bounded deadline; an unproven or hung close throws, and the manager's existing poison rule
does the rest. A clean release re-navigates to the system's entry route and re-runs the system's
full authentication proof (§4.1), so "reusable" is an observation. Login recipes stay with their
stores (`stores/<system>/session.ts`), which — together with `src/infra/browser/**` — are the two
raw-browser owner families the task-driver boundary permits; task and workflow code may reach
neither, transitively or otherwise. UCPath and CRM are bound today; a system without both a driver
and a login recipe refuses at open rather than launching an unusable browser, and the exclusive
OnBase identity lease is explicitly not landed here.

## Session acquisition is bounded separately from the task (D125, 2026-08-04)

**`timeouts.sessionAcquireMs` (default 60 000 ms) bounds ONE browser-session acquisition — the
factory `open` plus that system's login recipe — and it is a different bound from
`timeouts.taskMs`.** The kernel-owned `MonotonicDeadlineScheduler` arms it, the acquisition runs
under its own linked `AbortSignal` so a cooperative recipe cancels itself, and expiry FAILS the
lease with a message naming both leaves. It is never converted into a retry.

**Why the whole-task deadline could not do this job.** The Phase-1 live exit run
(`4ebf7275-0158-49af-a78f-1f37948efb27`, master plan §Phase 1) spent **262.9 s** inside one
`withDriver` when the CRM browser died. Every step *inside* the login recipe was already bounded —
each navigation by `navigationMs`, the Duo window by `duoApprovalCrmSeconds` — but **nothing bounded
the chain**, and the only outer bound reaching that code was `taskMs`. `taskMs` must stay generous
because it covers the real read (UCPath person-org ≈22 s; Kuali fill→save→reload→verify 8–10 s per
cycle), so it is structurally the wrong instrument for "is this session alive?". In that run it
never fired: the D118 claim sweep (60 s staleness on a 30 s cadence, measured on the WALL clock)
requeued the run first, the next heartbeat reported the claim lost, and the task span closed
`cancelled` at 4 m 23 s. Claim expiry is recovery, not a liveness bound — it is the last line, and
it was doing first-line work.

**Why 60 s is safe.** Acquisition is not the slow part of a healthy run: §4.1 authentication is
live-verified at ~17 s (UCPath) and ~12 s (CRM) with Duo Autopilot clearing the ceremony hands-off
(charter §9), so the default is >3x the measured worst case. It cannot fail a legitimately slow
*read*, because a read happens after acquisition, under `taskMs`. A deployment that reverts to a
HANDS-ON Duo approval must raise `sessionAcquireMs` above `duoApprovalSeconds` — the inner Duo wait
would otherwise outlive its own envelope — and the refusal message says exactly that.

**An acquisition that outlives its bound is UNCERTAIN.** A cooperative recipe rejects on the
acquisition signal and runs `#openAndLogin`'s own proven cleanup. A non-cooperative one may still
land a live session afterwards; that session is poison-closed rather than inherited by the next
lease as a warm reuse, and a close that cannot be proven leaves the system poisoned so the next
acquisition refuses by name (§4, ref execution-and-sessions poison rule).

The `fresh-session-boundary` guard is now ACTIVE against these pieces (ref guards-and-tests §5): the boundary
close reason exists only in the session-ownership modules, every authored `session:` need is a
string literal rather than a computed value, repeated `reuse-worker` needs mint no boundary, and
both an authored `fresh` need and a D116 identity mismatch close with an accepted proof before the
replacement opens. Its one outstanding arm — descriptor-level node-execution ordering — lands with
the first workflow that authors a fresh-boundary node.
