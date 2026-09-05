# src/server lessons

Historical evidence moved from the instruction pair on 2026-09-04. Search by the affected
seam or decision and read matching entries before changing it. Current contracts and current
source win over historical status. Record requested lessons here; keep the entry point concise.

## Dated lessons

- **2026-09-03 — a long-lived CLI command must own its shutdown, and the process lock is the
  proof.** The `dashboard` branch detached `compose(...).then(...)` and discarded `running.stop`, so
  `composeDashboardRuntime`'s ordering never ran: SIGINT took Node's default terminate and left
  `.tracker/locks/server.lock.json` at `releasedAt: null`, the authority handle abandoned and
  no completed graceful drain (D322 subsequently made backups explicit-only). `startRebuildRuntime` is now `async` and the branch awaits the
  composition, then the FIRST SIGINT/SIGTERM through an injectable `signals` seam, then `stop()` —
  once, awaited, with that ordering still the sole shutdown authority. Register both signals with
  `process.on`, NEVER `process.once`: a `once` listener removes itself as it fires, and a signal with
  zero listeners restores Node's default terminate, so the second Ctrl+C would kill the process
  mid-drain — the same abandoned handle and `releasedAt: null` this fix exists to prevent. Both stay
  subscribed until `stop()` settles; only then does the disposer run, in `finally`. A rejecting stop
  propagates; this library never calls `process.exit`. `runCli` returns that promise and the secure
  bootstrap awaits it. Prove it with a real child (`node --import tsx
  scripts/secure-env-bootstrap.ts cli dashboard`) asserting exit 0 and a `releasedAt` on the lock
  record naming THAT pid — an injected composer cannot see whether the production entrypoint
  registered any handler at all. Spawn that child in a scratch `mkdtemp` cwd holding only
  `package.json`, `package-lock.json` and a `node_modules` symlink (Node resolves the bare
  `--import tsx` specifier against the CWD), because the composition takes `repoRoot = process.cwd()`
  and would otherwise run every per-commit gate over the developer's own authority; send the second
  SIGINT inside the measured ~40ms drain, and assert the child is still draining before you send it.

- **2026-09-03 — `dashboard --prod` serves `dist/dashboard` from the BFF; a flag the runtime ignores
  is a mode that does not exist.** `parseDashboardCommandOptions` refuses any unexpected argument by
  name; `built-bundle` composition realpaths the bundle and requires `index.html` before any
  authority, lock or socket. The static handler (`static-bundle.ts`) is registered LAST, decides
  lexically then physically (realpath containment; a symlink out of the bundle is refused), serves a
  closed extension allowlist (unlisted = 404, never octet-stream), caches only `/assets/*` immutably,
  and never echoes a refused path. Remember the WHATWG URL layer resolves `/../` and `%2e%2e` before
  any handler: test the encoded `..%2f` and backslash forms for the handler's own refusals.
- **2026-09-02 — the SSE hub delivers on demand; never push into a stream controller.** A hub
  connection exposes `next()`/`pending`, and `subscriptions/sse-response.ts` drains it from a Web
  Stream `pull()`, so socket backpressure reaches the hub's ONE bounded queue and overflow becomes
  exactly one `reset-required`. A push listener bypasses the bound the moment it registers. Prove
  slow-consumer behaviour through the real Node adapter with a paused client, not a fake sink.
- **2026-09-02 — every browser-reachable BFF mutation is admitted by the loopback Host/Origin
  door before its handler runs (D75).** Register `app.use(<path>, operatorMutationIngressGuard)`
  (JSON envelope: also requires `application/json`) or `operatorOpaqueIngressGuard` (intake bytes,
  the body-less advisory) BEFORE the `app.post`; the `operator-mutation-admission` guard pins the
  closed route → door table in `routes/api.ts`. A JSON-shaped `text/plain` body parses through
  `c.req.json()`, so media type is part of the admission. Refuse with the body unread and zero
  planner/intake/authority/provider effects; prove it with `Request` read spies and `bodyUsed`.
- **2026-08-29 — BFF request identity is one admission checkpoint.** Every request crosses the
  first middleware exactly once. Solo composition accepts only the strict configured
  `local-operator`; body, query, headers, XLSX metadata and mobile-capture credentials are not actor
  inputs. Schema-valid command-envelope `requestedBy` claims must match before handler effects.
  Pass the derived actor separately to actor-attributed services: XLSX requests stay strict and
  actor-free, new evidence is v2 with `requestedBy`, and immutable v1 rows stay unattributed with no
  backfill. Every browser-reachable durable operator mutation, including XLSX export, requires the
  exact same-origin loopback Host/Origin pair and `application/json` before its body or authority is
  touched. Mirrored evidence columns must agree with JSON at read and boot. (D75)
- **2026-08-31 — historical D290 integration admitted only the common v18 lineage. Superseded for ordinary boot by the v30 floor / D332.** Fresh and
  exact-v18 databases run the pinned DCR-primary sequence followed by DCC1 Settings and accepted
  bulk-replay support. Any existing post-v18 pre-integration suffix refuses before connection
  configuration, migration, replay, or effects; source SQL/digests remain evidence, never a silent
  conversion recipe. DCC4's Explorer schema suffix is superseded, not erased.
- **Archived capture resources (DCA4):** `queries/archive.ts` binds resource status and downloads
  to the exact archived run, verifies its immutable content digest, and resolves byte metadata only
  from its frozen capture tiles. Repeated tile ids must agree on the complete byte reference.
  Status uses the shared verify-only stream; downloads independently materialize verified bytes.
  Never consult current runs/indexes/descriptors or infer a purge from a retention deadline. The
  two archive resource routes in `routes/api.ts` report named, path-free archive failures and keep
  downloads no-store, nosniff and attachment-only; resource URLs bind both ids in the strict wire.
