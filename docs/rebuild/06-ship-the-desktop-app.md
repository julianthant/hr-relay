# 06 · Phase 6 — ship the desktop app

This doc is the dedicated home of **Phase 6**, tree node `{#desktop-app}` — the phase that turns the
rebuild from *a repository you run* into *an application you install*. The operator's instruction
(2026-08-21, plan ruling **R14**) is one sentence: at the end of the program the rebuild is delivered
as a **Mac and Windows desktop app**. Nothing in this phase is built, and nothing in it is designed
past the shape below.

**Why the doc exists before the code does.** Every other phase doc records what was decided and what
is left; this one records what the phase INHERITS, so the first agent to open it does not rediscover
five constraints Phases 1–5 already settled. Four of them are load-bearing enough that a naive
Electron port would fail on them in the first hour, and each is named with the file that proves it.
Contracts belong to `reference/` as always; this doc owns the phase, not the contracts.

## Phase summary
<!-- roadmap: desktop-app -->

<!-- roadmap-status: desktop-app -->
- [ ] an Electron shell that hosts the BFF and the dashboard bundle in one process tree
- [ ] the worker processes managed by the app — started and stopped from the dashboard, not from a terminal
- [ ] the browser automation (Playwright's full Chromium + Duo Autopilot) running as child processes under app data
- [ ] credentials in the OS keychain, read through `src/domain/secrets.ts` and nowhere else
- [ ] packaged and signed for macOS and Windows
- [ ] a full workflow dry run driven from the packaged app, on BOTH operating systems
- [ ] nothing is built at HEAD — there is no Electron dependency in `package.json`, and no `desktop/` tree
> 2026-08-21 | docs-cohesion R14 | phase drawn from the operator's instruction; verified UNBUILT against `package.json` (the only `electron` string in `package-lock.json` is `electron-to-chromium`, browserslist data) and against `src/server/dashboard/compose.ts:322-331`, `src/domain/config/schema.ts:8`, `src/dashboard/app/main.tsx:21`; left: all of it
<!-- /roadmap-status -->

### What Phase 6 is

**A delivery phase, not a feature phase.** Every capability the app will expose already exists or is
already owned by another node: the BFF serves the wire, the dashboard bundle renders it, the worker
runs the workflows, the write sequencer keeps the writes safe. What does not exist is a way to hand
somebody all of that **without a terminal, an `npm install`, and a repository checkout**. That is the
whole phase: a shell, a process tree, a credential store, an installer, and a proof that the thing
installed still runs a real workflow.

**Five task nodes, in the order they unblock each other.** `{#desk-shell}` (the main process and the
window) → `{#desk-worker}` (the worker processes the app owns) → `{#desk-secrets}` (credentials off
the disk and into the keychain) → `{#desk-package}` (signed installers) → `{#desk-proof}` (a dry run
from the packaged app on both OSes). The first four can be built in that order on macOS alone; the
Windows half is not a port at the end — `{#desk-package}` and `{#desk-proof}` are where it is
discovered, and `{#desk-secrets}` and `{#desk-worker}` each carry a Windows item of their own.

**It is not a hosting phase, and R14 does not reopen D193(a).** A desktop app is still the operator's
LOCAL tool: one machine, one operator, no server, no tenancy, no remote access. Packaging changes how
the software is delivered and where its files live; it changes nothing about who can reach it. The
one deny-by-default exception to loopback stays what it already is — the operator-started,
D294 retires the former mobile-capture ingress exception.

### What it inherits — five things Phases 1–5 already decided

| # | Inherited from | What it means for the app |
|---|---|---|
| 1 | **D181's runtime role lock** (`src/server/dashboard/compose.ts:346-356`) | The dashboard takes a `server` role lock, one holder, before it opens the authority database. The app's own single-instance lock (`app.requestSingleInstanceLock()`) is the second, coarser half — and the two must not fight: a second app launch focuses the open window, and a BFF that finds the role lock held refuses BY NAME rather than starting a second one. The lock files are also what `cli storage restore` composes its stopped-system proof from, so the app may not route around them |
| 2 | **`config/runtime-isolation.json`'s roots** | `stateRoot` `.tracker-rebuild`, `artifactRoot` `.tracker-rebuild/artifacts`, `processLockRoot` `.tracker-rebuild/locks`, `browserProfileRoot` `.auth` — all resolved **repo-relative** today (`repoRoot = process.cwd()`, `compose.ts:336-337`). A packaged app has no repo and no meaningful cwd, so every one of them resolves under `app.getPath("userData")`. The NAMES stay: `operational-isolation.test.ts` pins them, and what changes is how a root is resolved, not what it is called |
| 3 | **D189's byte path** (`ref frontend-backend-integration` §6.9) | The BFF serves **no** frontend bytes and the desktop does not need it to — the renderer loads `dist/dashboard` from app resources. The remaining `{#def-byte-path}` task is ordinary local static serving for non-desktop operation; D294 retires its former phone/tunnel scope. |
| 4 | **`{#parallel-runs}`' worker pool** | `createDashboardWorkerSupervisor` refuses to spawn a worker today and its refusal literally says *"start worker `<id>` with: npm run cli worker `<workflowId>`"* (`compose.ts:322-331`). In a packaged app there is no npm and no terminal, so that refusal is not survivable — the app MUST supply a real `WorkerProcessSupervisor`, which is the same build `{#parallel-runs}` already owns. Phase 6 consumes it; it does not fork it |
| 5 | **`{#duo-lease}`** | The desktop is where several workers finally run on one machine as the ordinary case, so D243's shared per-credential Duo counter stops being a hazard two cold-starting workflows can hit and becomes one the product's default shape hits. The lease is a prerequisite, not an optimization |

### Where it sits in the order

**After the cutover — "at the end", in the operator's words.** The order is deliberate rather than
incidental: the cutover (`05-cut-over.md`) is a single all-at-once authority switch with a rollback
asset behind it, and adding a new delivery mechanism to the same day would mean rolling back two
things at once if either failed.

**The operator may pull it earlier, and the trigger is one question:** *should the cutover itself run
on the packaged app?* If the answer is yes — because the D89 day is the day the operator stops using
a terminal at all — then Phase 6 moves in front of `{#cutover}` and the cutover's smoke gates run
against the installed app rather than against `npm run dashboard`. That is a decision for the
operator, and nothing in this doc presumes it. Until they take it, the tree's `needs: cutover` stands.

**What this supersedes.** `05-cut-over.md` §Later, unplanned records *"packaging the local system as a
locally-run app (web app → real app)"* as a D193(a) LATER item with no owner and no design. R14 gives
it both. The other LATER item — a cooperation / multi-user mode — is untouched and still has neither,
and hosting is still a decided refusal rather than a LATER item.

### The honest state at HEAD (2026-08-21)

**Nothing is built.** There is no `desktop/`, no main process, no preload, no builder config, and no
Electron dependency: `package.json` carries none, and the single `electron` match in
`package-lock.json` is `electron-to-chromium`, which is browserslist's Chromium-version data pulled
in transitively by the build tooling. Verified 2026-08-21.

**Four obstacles are already visible in the code, and each is a real change rather than a
configuration detail.** They are listed here rather than inside a task section because each crosses
two of them:

1. **Every absolute-path config leaf is POSIX-only.** `AbsolutePathSchema` is
   `z.string().min(1).refine((value) => value.startsWith("/"))` (`src/domain/config/schema.ts:8`) and
   nine `paths.*` leaves use it, including `stateRoot`, `browserProfileRoot`, `duoExtensionDir` and
   `duoCredential`. A Windows build fails config resolution at the schema boundary — loudly and
   correctly, which is the point, but it means **Windows is a schema change, not a packaging flag.**
   Widening the refinement is read-forward-safe: every stored `config_snapshots` row holds a POSIX
   path that still parses, so no D133 snapshot-generation entry is owed. Narrowing later would not be.
2. **The renderer cannot be loaded from `file://` as it stands.** `main.tsx:21` builds the client with
   `baseUrl: window.location.origin`, and a `file://` document's origin is the string `"null"` in
   Chromium — so every request would go to `null/api/v1/…`. The seam already exists
   (`createDashboardTransport` takes a `baseUrl`), so the fix is small; what it must NOT be is a
   silent default. The two honest shapes are a custom `app://` protocol registered in the main process
   or an explicit `http://127.0.0.1:<port>` base with the BFF allowing that one origin. The SSE
   subscription rides the same decision.
3. **The roots are computed from `process.cwd()`**, which is item 2 of the inheritance table, and it
   reaches further than the dashboard: the app version stamped on every `RunRecord` (D179) is read
   from `join(repoRoot, "package.json")` (`compose.ts:337-340`), and inside a packaged app that file
   is in the asar archive rather than beside the process.
4. **The worker supervisor's refusal names npm** (inheritance item 4). A packaged app that shows an
   operator that sentence has told them to do something they cannot do.

**Nothing here blocks anything.** No other phase's exit criteria name Phase 6, and Phase 6 names no
gate of its own until the operator schedules it.

## Electron shell — the main process, the window, the single instance
<!-- roadmap: desk-shell -->

<!-- roadmap-status: desk-shell -->
- [ ] the Electron main process, the app lifecycle, and one BrowserWindow
- [ ] the BFF started and supervised by the main process (recommendation: as a managed CHILD process — see below)
- [ ] the renderer loads `dist/dashboard` from app resources, with an API base that is not `window.location.origin` under `file://`
- [ ] single instance — `app.requestSingleInstanceLock()` on top of D181's `server` role lock, with a second launch focusing the open window
- [ ] every runtime root resolved under `app.getPath("userData")` instead of `process.cwd()`, with the `runtime-isolation.json` names unchanged
- [ ] the app version stamped on a `RunRecord` (D179) read from a source that survives packaging
- [ ] an application menu, and keep-awake while any run is in flight — a suspended worker mid-run is a real failure, not an inconvenience
> 2026-08-21 | docs-cohesion R14 | nothing built; the four obstacles above were read out of `src/server/dashboard/compose.ts`, `src/domain/config/schema.ts` and `src/dashboard/app/main.tsx`
<!-- /roadmap-status -->

**The one design question this node settles: in-process or child process?** The recommendation is a
**managed child process**, and the reasons are all about locks and lifetimes rather than taste.

- **The role lock is per-PROCESS.** `acquireRuntimeProcessLock({ … name: "server", pid: process.pid })`
  atomically claims one singleton server record, and `cli storage restore` composes its stopped-system
  proof from that record plus the per-start worker aggregate (D181). A child process holds a lock whose pid is a real,
  observable BFF; an in-process BFF makes the Electron main process the `server` holder, so the app
  cannot be running while the BFF is stopped — which is exactly the state a restore needs.
- **A BFF crash must not take the window with it.** In-process, an unhandled rejection in the API
  layer kills the app; as a child, the main process observes the exit, tells the operator what died,
  and can restart it under the same lock discipline.
- **The composition root already assumes a process.** `src/cli.ts` registers composers and calls
  `startRebuildRuntime` at top level; the BFF is a command, not a library entry. A child process runs
  that entry unchanged, with an explicit cwd and env, and the app's Node and Electron's Node stay
  separate concerns.
- **The cost is honest and small:** one more process to supervise, and the app must forward its
  stderr somewhere the operator can read.

**What the window loads.** `dist/dashboard` ships in app resources and the renderer is the same bundle
`npm run web:build` already produces — the desktop does not fork the frontend. The API base is the one
thing that must change, and it must change EXPLICITLY (obstacle 2 above): a wrong base under `file://`
does not fail at build time, it fails as a dashboard that renders and then reports every request as a
network error.

**Keep-awake is a correctness item, not a nicety.** A worker holds a claim with a heartbeat, and a
claim that stops beating is swept and requeued; a machine that sleeps mid-run with a browser open on a
half-staged UCPath page is the state doc 09's recovery lane exists for. The app should hold a power
save blocker while any run is in flight, and if it cannot get one, say so rather than proceed quietly.

## Worker lifecycle — the pool the app owns
<!-- roadmap: desk-worker -->

<!-- roadmap-status: desk-worker -->
- [ ] workers as managed child processes — start and stop from the dashboard, which IS `{#parallel-runs}`' pool
- [ ] Playwright's full bundled Chromium available to a packaged app — shipped with it, or installed on first run into app data
- [ ] Duo Autopilot placed under app data and `paths.duoExtensionDir` pointed at it (it is a hard runtime dependency, D244)
- [ ] browser profiles under app data, keeping doc 05's `(worker, system, instance, configFingerprint)` partition intact
- [ ] Windows: the extension path, the profile root and the Chromium launch verified on a real Windows box
- [ ] a worker that dies is reported to the operator with its exit reason, and its claim released through the D200 lease sweep rather than by guessing
> 2026-08-21 | docs-cohesion R14 | nothing built; `createDashboardWorkerSupervisor` (`src/server/dashboard/compose.ts:322-331`) still refuses spawn by name and tells the operator to run npm
<!-- /roadmap-status -->

**This node does not invent a worker pool — it consumes `{#parallel-runs}`'.** The kernel's worker
command arms exist and are validated; what refuses is the process effect behind them. Building a
second spawn path inside the Electron main process would mean two supervisors with two lifetimes over
one authority table, which is the shape D200 already warned about from the other side (a recovery
mechanism living inside the thing it recovers). The app's job is to be the process parent, not to be
a second scheduler.

**Chromium and the extension are the packaging risk in this node.** The browser session factory
launches Playwright's **full** bundled Chromium (`channel: "chromium"`, a persistent context, with the
Duo Autopilot MV3 extension loaded) — the lightweight headless shell cannot load an extension, so
there is no smaller option. Two shapes are available and the choice is `{#desk-package}`'s to make
with this node's input: ship the browser inside the installer (large, deterministic, offline) or
install it on first run into app data (small installer, a network dependency, a first-run screen). The
extension itself is vendored in `duo-autopilot/` and must land at a real path on disk, because
`paths.duoExtensionDir` is an absolute path leaf and D244 makes it a hard runtime dependency of every
authenticated login.

**Profiles keep their partition.** Doc 05 partitions a profile per `(worker, system, instance,
configFingerprint)` and D216 makes the roots repo-relative so two checkouts never collide. Under app
data the same partition holds, with the root moving — and it matters more here than it did in a
checkout, because a shared profile is how D243's counter hazard gets a second front door.

## Credentials — the OS keychain behind the one reader
<!-- roadmap: desk-secrets -->

<!-- roadmap-status: desk-secrets -->
- [ ] macOS Keychain and Windows Credential Manager as the credential source, replacing `.env` for a packaged app
- [ ] `src/domain/secrets.ts` stays the ONLY module that reads a credential — `secrets-single-source.test.ts` unchanged
- [ ] the Duo credential (`paths.duoCredential`) moved off a plain file into the same store, or its file placed under app data with the app's own protection
- [ ] a first-run setup screen that collects what is missing and names each credential it needs
- [ ] a decision recorded on HOW the keychain reaches the reader — env-block injection vs a source seam inside `secrets.ts` (they differ in exposure, see below)
- [ ] no credential ever interpolated into a message, log or crash report the app produces (`no-secret-values-in-logs.test.ts` already holds the runtime half)
> 2026-08-21 | docs-cohesion R14 | nothing built; `src/domain/secrets.ts` reads an injected `NodeJS.ProcessEnv` defaulting to `process.env`, so the seam is a map rather than an async source
<!-- /roadmap-status -->

**The guard does not move.** `secrets-single-source.test.ts` pins `src/domain/secrets.ts` as the only
module permitted to read a credential from `process.env`, and nothing about a keychain justifies
widening that. Every shape below keeps the reader exactly where it is.

**The design question is HOW the keychain's answer reaches a synchronous reader, and the two options
differ in what they expose.** `secrets.ts` takes a `NodeJS.ProcessEnv` (defaulting to `process.env`)
and answers synchronously; a keychain read is asynchronous and prompts.

- **Populate the child's environment at spawn.** The main process reads the keychain once and hands
  the BFF and each worker an env block. Nothing in `secrets.ts` changes. The cost is that credentials
  sit in a process environment block for the life of the process, which is readable by anything
  running as the same user.
- **Give `secrets.ts` a source seam.** The main process resolves the keychain before composition and
  injects a resolved map (or a small synchronous accessor) into the one reader. More work, and it
  keeps the credential out of the environment block. This is the shape to prefer unless the first one
  turns out to be forced.

Whichever is taken, it is a decision with a D-number, because it changes where a real credential
lives on a real machine.

**The first-run screen is part of the phase, not a nicety.** A packaged app has no `.env.example` to
copy, so the app must name what it needs — the SSO username and password, the Duo credential, any
provider keys — and refuse to start a workflow that is missing one, with the name of the missing
credential in the refusal. A silently missing credential turns into a login failure three layers
down, which is the fail-loud rule applied to setup.

## Packaging — signed installers for both operating systems
<!-- roadmap: desk-package -->

<!-- roadmap-status: desk-package -->
- [ ] electron-builder configured, with the dashboard bundle and `duo-autopilot/` as app resources
- [ ] macOS: a signed and notarized `.dmg` (an unsigned build cannot launch a bundled Chromium cleanly on a current macOS)
- [ ] Windows: an installer (nsis or msix), signed
- [ ] the release version = the app version stamp `RunRecord` already carries (D179), so an archived run names the build that produced it
- [ ] auto-update: LATER, deliberately — a channel is not built in this phase, and the reason is written down rather than assumed
- [ ] the build is reproducible from a clean checkout by one command, and the gate family still runs against the source tree unchanged
> 2026-08-21 | docs-cohesion R14 | nothing built; no builder config and no `electron` dependency at HEAD
<!-- /roadmap-status -->

**The version stamp is already durable, and packaging should reuse it rather than mint a second
identity.** D179 put `appVersion` on `RunRecord` at the one enqueue point precisely so an archived run
can say which build produced it; the installer's version is that string. Two version numbers for one
build is how a run record starts naming something nobody can find.

**Signing is not optional on either OS, for a reason specific to this product.** The app launches a
second browser and loads an unpacked extension into it. An unsigned or un-notarized macOS build makes
that path fight Gatekeeper at exactly the moment a live run needs it, and an unsigned Windows
installer makes the operator click through a warning every update. The cost is a developer identity on
each platform, and it belongs in this phase's estimate rather than in a surprise.

**Auto-update is deferred ON PURPOSE and names its reason.** This app files real HR transactions; an
update that lands between a fence and a read-back is a hazard nobody has designed for yet. Until the
run lifecycle has a stated position on "may the app update while a run is in flight?", the answer is a
manual download. That is a deferral with a trigger, in `04-close-the-deferrals.md`'s sense, and it gets
one when this node is scheduled.

## Proof — a dry run from the packaged app on both operating systems
<!-- roadmap: desk-proof -->

<!-- roadmap-status: desk-proof -->
- [ ] a full workflow **dry run** driven from the INSTALLED app on macOS — R10's T1 tier, run against the package rather than the checkout
- [ ] the same on Windows, on real hardware
- [ ] R10's T3 tier attached — a dashboard condition driven through the app's own window while the run is parked
- [ ] the parity corpus rendered in the Electron renderer, so the operator's actual pixels are the ones the corpus pins
- [ ] the result recorded durably the way every other dry-run scenario is: an evidence row plus a dated line here
- [ ] the recovery drill (`cli storage restore`) exercised through the app's own lock files — D181's proof composes from them, and the app is what writes them now
> 2026-08-21 | docs-cohesion R14 | nothing built; `{#test-tiers}` owns T1–T4 and no workflow has a T1 pair at HEAD
<!-- /roadmap-status -->

**The proof is a dry run, not a demo, and the distinction is R10's.** A T1 scenario is a live
`dryRun=true` run of a real workflow with its checkpoints asserted over authority — nodes reached,
checkpoints written, gate results, intents, receipt shape — against a named canary subject. Running
one from the packaged app proves the thing installers usually break: that the app's roots, its
Chromium, its extension, its keychain and its worker supervision all line up on a machine that never
saw the repository. A screenshot of the dashboard proves none of that.

**Both operating systems, on real hardware.** A Windows VM is acceptable for iteration and is not
acceptable as the proof: the two items most likely to break there — the extension path and the
Chromium launch — are exactly the ones a VM's file system and GPU stack make unrepresentative.

**Parity in the renderer is worth its own line, because of what D187 found.** The parity corpus was
photographed against a browser the harness controlled, and for the whole life of the corpus it
photographed the wrong theme while every gate stayed green. The Electron renderer is a different
browser with a different default surface, and the operator's eye is the acceptance bar — so the corpus
runs there before the app is called done.

## Decisions this phase ratified

**None, and that is correct at HEAD.** `reference/decisions.md` carries no `_phase: 6_` marker,
because Phase 6 has no code and this program ratifies a decision only when its normative text lands in
an owning doc in the same commit. R14 is an operator RULING recorded in
`docs/plans/2026-08-20-rebuild-docs-roadmap-cohesion.md` §0 — it authorizes the phase and its shape; it
is not a D-number and does not pretend to be one.

**What the first decisions here will be**, so the next agent recognizes them when they arrive:

| Likely decision | Owning doc it must land in |
|---|---|
| BFF in-process vs managed child, and how the app's single-instance lock composes with D181's role lock | `ref frontend-backend-integration` (the BFF's process contract) + this doc §Electron shell |
| How runtime roots resolve under app data without changing `runtime-isolation.json`'s names | `ref clock-config-secrets` §3 (the config resolver) + `config/runtime-isolation.json`'s own note |
| Widening `AbsolutePathSchema` for Windows paths, and why no snapshot generation is owed | `ref clock-config-secrets` (the durable config schema) |
| How the OS keychain reaches `src/domain/secrets.ts` — env block vs source seam | `ref clock-config-secrets` §Secrets, with the guard unchanged |
| Whether the app may update while a run is in flight (the auto-update deferral's trigger) | `04-close-the-deferrals.md`, as a new deferral with a named trigger |

Each lands with a one-line pointer in `reference/decisions.md` and its normative text in the owner, in
the same commit — the standing rule, not a Phase 6 rule.

## Exit criteria

Phase 6 is done when an operator who has never seen this repository can install the app on either
operating system and run a real workflow from it. The five criteria below are the readable form of
that sentence; all five are open, because nothing is built.

| # | Criterion | State | Evidence / what is left |
|---|---|---|---|
| 1 | **Installable on both operating systems** | **open** | a signed macOS `.dmg` and a signed Windows installer, each producing a working app on a machine with no checkout, no Node and no npm |
| 2 | **A real workflow dry run from the app** | **open** | R10's T1 tier run from the INSTALLED app on both OSes, with its checkpoints asserted over authority and the result recorded durably |
| 3 | **Credentials never in a file the app ships** | **open** | the keychain is the source; `src/domain/secrets.ts` is still the only reader; the Duo credential is not a plaintext file inside the bundle; a missing credential refuses BY NAME at first run |
| 4 | **The worker survives sleep, or refuses loud** | **open** | a power save blocker held while any run is in flight, and — when one cannot be held — a refusal the operator can read, rather than a run swept and requeued by a heartbeat nobody watched |
| 5 | **The byte path closed for the desktop** | **open** | the renderer loads the bundle from app resources with an explicit API base; ordinary local static serving remains a separate D189/D294 dashboard task |

**What is NOT on this list, deliberately.** Auto-update (this phase defers it with a stated reason);
any form of hosting, remote access or multi-user (D193(a), unchanged by R14); and a Linux build, which
nobody has asked for. Adding any of them to Phase 6 would be the tree inventing scope, which the plan's
own rules forbid — they would be findings first.
