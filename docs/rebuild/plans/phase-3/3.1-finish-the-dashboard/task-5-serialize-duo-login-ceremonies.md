# Task 5 · Serialize Duo login ceremonies
<!-- roadmap: duo-lease -->

Read the [subphase overview](README.md) before this assignment for shared scope, dependencies, decisions and gates.

<!-- roadmap-status: duo-lease -->
- [x] BE `duo_ceremony_leases` in authority, plus the lease token `defineVerifiedLoginRecipe` requires (`bfc7d318`, `cb7f17f8`)
- [x] BE bounded waiters and the fresh-profile-once recovery, both failing by name (`cb7f17f8`)
- [x] BE the guard — no login path without the lease, with a violating fixture (`37e747f0`)
- [x] PROOF two workers' cold starts serialize — unit (`1c244a40`) plus the LIVE two-worker cold start, 2026-08-21 (`live-a` / `live-b` on one credential, ceremonies serialized at lease generations 3 → 4 with no overlap and zero waiter refusals; ref execution-and-sessions §10 §Live proof carries the numbers)
- [x] DOCS the decision in `reference/execution-and-sessions.md` and `reference/decisions.md` (D267)
> 2026-08-20 | docs-cohesion 03a | nothing named duo_ceremony_leases or a ceremony lease exists anywhere in src/; defineVerifiedLoginRecipe (src/infra/browser/authenticated-application.ts:159) takes system + verify + flow and no lease token
> 2026-08-21 | duo-lease E1 | built (D267): store+token+leaf bfc7d318 · gate+wiring+recovery cb7f17f8 · guard 37e747f0 · unit proof 1c244a40; left: the live two-worker cold start
> 2026-08-21 | duo-lease E2 | the live two-worker cold start RAN — both `logged-in` (23.2 s holder, 37.2 s waiter), the waiter's ceremony began 228 ms after the holder released; the record is ref execution-and-sessions §10 §Live proof
<!-- /roadmap-status -->

**The hazard is present today, which is why this is platform hardening and not a parallel-runs
feature.** D243 root-caused the "browser-profile wedge": Duo's WebAuthn signature counter is per
CREDENTIAL, one credential covers every UCSD system, and Duo Autopilot's copy of it lives in
`chrome.storage.local` — which is per BROWSER PROFILE, while `ref execution-and-sessions` §1
partitions profiles per `(worker, system, instance, configFingerprint)`. So N writers share one
server-side counter and none can see another's copy. The arithmetic fix (`max(stored + 1, nowSec)`)
landed; the SERIALIZATION did not. Two workflows' workers cold-starting together against the one
credential is enough to reach it, and that configuration exists the moment a second workflow gets a
worker — before any pool is built.

**Why the failure must be prevented rather than recovered from.** Once Duo sees one cloned-key
signal it BURNS the profile: D243 recorded a profile that stayed refused across three further logins
presenting counters more than a thousand ahead, and only a freshly created profile recovered. That is
why "delete the directory" was the only remediation anybody ever found, and why the lease has to
stop the first refusal instead of healing after it.

**The design, as ruled (R12).** A durable per-credential lease in authority
(`duo_ceremony_leases`) serializes EVERY Duo ceremony across every worker and every system, from
"navigate to SSO" until the content verifier proves the session — the same content-level proof
`ref execution-and-sessions` §4.1 already requires, because a URL is never the conclusion. TTL is
`timeouts.sessionAcquireMs` plus grace. Waiters are bounded and refuse loud NAMING the holder, so a
stuck ceremony reads as a stuck ceremony rather than as a slow login. D243's counter arithmetic is
unchanged and a warm profile skips the ceremony entirely, so the lease costs nothing on the common
path. On a refused assertion the worker poison-closes, recreates a FRESH profile under the SAME
lease and retries ONCE, then fails naming the profile. `defineVerifiedLoginRecipe` takes a lease
token only the lease store mints, pinned by a guard with a violating fixture — the same shape the
mutation capability uses, for the same reason: a rule that can be satisfied by a caller's claim is
not a rule.

**Done looks like** two cold starts serialized in a unit test, one live two-worker cold start
recorded, a guard that fails any login path reaching SSO without a token, and the decision ratified
in `reference/execution-and-sessions.md` in the commit that builds it. It lands BEFORE the worker
pool, because the pool multiplies the hazard it removes.
