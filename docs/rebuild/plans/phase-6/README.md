# Phase 6 · Ship the desktop application

This stable-path doc is the dedicated home of tree node `{#desktop-app}`, the later stage that turns the
rebuild from *a repository you run* into *an application you install*. The operator's instruction
(2026-08-21, plan ruling **R14**) is one sentence: at the end of the program the rebuild is delivered
as a **Mac and Windows desktop app**. D297 (2026-09-01) keeps Electron as that app's shell and fixes
the initial update policy: signed, in-place manual installers first; a controlled updater only after
the app can prove it is safe to stop. Nothing in this stage is built.

**D323 numbering note (2026-09-03).** This is Phase 6. Its lettered parts sit horizontally from the
Phase 6 spine node, with their concrete acceptance work recorded beneath each part.

**Why the doc exists before the code does.** Every admitted phase doc records what was decided and what
is left; this one records what the stage INHERITS, so the first agent to open it does not rediscover
five constraints earlier work already settled. Four of them are load-bearing enough that a naive
Electron port would fail on them in the first hour, and each is named with the file that proves it.
Contracts belong to `reference/` as always; this doc owns the stage, not the contracts.

## Stage summary
<!-- roadmap: desktop-app -->

<!-- roadmap-status: desktop-app -->
- [ ] an Electron shell that hosts the BFF and the dashboard bundle in one process tree
- [ ] the worker processes managed by the app — started and stopped from the dashboard, not from a terminal
- [ ] the browser automation (Playwright's full Chromium + Duo Autopilot) running as child processes under app data
- [ ] credentials in the OS keychain, read through `src/domain/secrets.ts` and nowhere else
- [ ] packaged and signed for macOS and Windows
- [x] the delivery/update policy ratified (D297) — Electron remains the shell; v1 updates are signed, in-place manual installs; controlled in-app update is a named later deferral
- [ ] a full workflow dry run driven from the packaged app, on BOTH operating systems
- [ ] nothing is built at HEAD — there is no Electron dependency in `package.json`, and no `desktop/` tree
> 2026-08-21 | docs-cohesion R14 | phase drawn from the operator's instruction; verified UNBUILT against `package.json` (the only `electron` string in `package-lock.json` is `electron-to-chromium`, browserslist data) and against `src/server/dashboard/compose.ts:322-331`, `src/domain/config/schema.ts:8`, `src/dashboard/app/main.tsx:21`; left: all of it
<!-- /roadmap-status -->

### What the desktop stage is

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

**Electron earns its place because this is a local PROCESS product, not because the dashboard needs
a special browser.** The installed app must own the BFF, Node workers, Playwright's full Chromium,
the Duo extension, the OS keychain and their shared shutdown. A PWA cannot own those local processes.
A thinner native webview shell would still have to ship and supervise the Node/Playwright runtime,
moving the hard packaging work without removing it. D297 therefore keeps the already-planned
Electron boundary; being offline changes the release channel, not the shell.

### What it inherits — five things Phases 1–5 already decided

| # | Inherited from | What it means for the app |
|---|---|---|
| 1 | **D181's runtime role lock** (`src/server/dashboard/compose.ts:346-356`) | The dashboard takes a `server` role lock, one holder, before it opens the authority database. The app's own single-instance lock (`app.requestSingleInstanceLock()`) is the second, coarser half — and the two must not fight: a second app launch focuses the open window, and a BFF that finds the role lock held refuses BY NAME rather than starting a second one. The lock files are also what `cli storage restore` composes its stopped-system proof from, so the app may not route around them |
| 2 | **`config/runtime-isolation.json`'s roots** | `stateRoot` `.tracker`, `artifactRoot` `.tracker/artifacts`, `processLockRoot` `.tracker/locks`, `browserProfileRoot` `.auth` — all resolved **repo-relative** today (`repoRoot = process.cwd()`, `compose.ts:336-337`). A packaged app has no repo and no meaningful cwd, so every one of them resolves under `app.getPath("userData")`. The NAMES stay: `operational-isolation.test.ts` pins them, and what changes is how a root is resolved, not what it is called |
| 3 | **D189's byte path** (`ref frontend-backend-integration` §6.9) | The BFF serves **no** frontend bytes and the desktop does not need it to — the renderer loads `dist/dashboard` from app resources. The remaining `{#def-byte-path}` task is ordinary local static serving for non-desktop operation; D294 retires its former phone/tunnel scope. |
| 4 | **`{#parallel-runs}`' worker pool** | `createDashboardWorkerSupervisor` refuses to spawn a worker today and its refusal literally says *"start worker `<id>` with: npm run cli worker `<workflowId>`"* (`compose.ts:322-331`). In a packaged app there is no npm and no terminal, so that refusal is not survivable — the app MUST supply a real `WorkerProcessSupervisor`, which is the same build `{#parallel-runs}` already owns. The desktop stage consumes it; it does not fork it |
| 5 | **`{#duo-lease}`** | The desktop is where several workers finally run on one machine as the ordinary case, so D243's shared per-credential Duo counter stops being a hazard two cold-starting workflows can hit and becomes one the product's default shape hits. The lease is a prerequisite, not an optimization |

### Where it sits in the order

**After the cutover — "at the end", in the operator's words.** The order is deliberate rather than
incidental: the cutover (`05-cut-over.md`) is a single all-at-once authority switch with a rollback
asset behind it, and adding a new delivery mechanism to the same day would mean rolling back two
things at once if either failed.

**The operator may pull it earlier, and the trigger is one question:** *should the cutover itself run
on the packaged app?* If the answer is yes — because the D89 day is the day the operator stops using
a terminal at all — then the desktop stage moves in front of `{#cutover}` and the cutover's smoke gates run
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

**Nothing here blocks anything.** No other phase's exit criteria name the desktop stage, and the desktop stage names no
gate of its own until the operator schedules it.

## Decisions this stage ratified

**One: D297.** Electron remains the desktop shell. V1 updates use signed, in-place manual installers;
the future controlled updater may discover and download a release while the app is open but may
install only after the app proves quiescence and completes its ordered child/storage shutdown. Its
normative delivery text is in §Packaging above and its later implementation trigger is indexed in
doc 04. R14 remains the earlier operator RULING that authorized the phase and its shape.

**What the first decisions here will be**, so the next agent recognizes them when they arrive:

| Likely decision | Owning doc it must land in |
|---|---|
| BFF in-process vs managed child, and how the app's single-instance lock composes with D181's role lock | `ref frontend-backend-integration` (the BFF's process contract) + this doc §Electron shell |
| How runtime roots resolve under app data without changing `runtime-isolation.json`'s names | `ref clock-config-secrets` §3 (the config resolver) + `config/runtime-isolation.json`'s own note |
| Widening `AbsolutePathSchema` for Windows paths, and why no snapshot generation is owed | `ref clock-config-secrets` (the durable config schema) |
| How the OS keychain reaches `src/domain/secrets.ts` — env block vs source seam | `ref clock-config-secrets` §Secrets, with the guard unchanged |

Each lands with a one-line pointer in `reference/decisions.md` and its normative text in the owner, in
the same commit — the standing rule, not a desktop-stage rule.

## Exit criteria

The desktop stage is done when an operator who has never seen this repository can install the app on either
operating system and run a real workflow from it. The five criteria below are the readable form of
that sentence; all five are open, because nothing is built.

| # | Criterion | State | Evidence / what is left |
|---|---|---|---|
| 1 | **Installable and upgradeable on both operating systems** | **open** | a signed macOS `.dmg` and a signed Windows installer, each producing a working app on a machine with no checkout, no Node and no npm; an older installed version upgrades in place without losing authority rows, artifacts, profiles, settings or keychain credentials |
| 2 | **A real workflow dry run from the app** | **open** | R10's T1 tier run from the INSTALLED app on both OSes, with its checkpoints asserted over authority and the result recorded durably |
| 3 | **Credentials never in a file the app ships** | **open** | the keychain is the source; `src/domain/secrets.ts` is still the only reader; the Duo credential is not a plaintext file inside the bundle; a missing credential refuses BY NAME at first run |
| 4 | **The worker survives sleep, or refuses loud** | **open** | a power save blocker held while any run is in flight, and — when one cannot be held — a refusal the operator can read, rather than a run swept and requeued by a heartbeat nobody watched |
| 5 | **The byte path closed for the desktop** | **open** | the renderer loads the bundle from app resources with an explicit API base; ordinary local static serving remains a separate D189/D294 dashboard task |

**What is NOT on this list, deliberately.** Controlled in-app update (D297 gives it a safety invariant
and doc 04 gives it a trigger, but v1 deliberately ships with manual in-place updates);
any form of hosting, remote access or multi-user (D193(a), unchanged by R14); and a Linux build, which
nobody has asked for. Adding any of them to the desktop stage would be the tree inventing scope, which the plan's
own rules forbid — they would be findings first.

## Subphase plans

- [Phase 6A · Controlled desktop updates](6A-controlled-desktop-updates.md)
- [Phase 6B · Application shell](6B-application-shell.md)
- [Phase 6C · Worker lifecycle](6C-worker-lifecycle.md)
- [Phase 6D · Credentials and keychain](6D-credentials-and-keychain.md)
- [Phase 6E · Signed installers](6E-signed-installers.md)
- [Phase 6F · Packaged-app proof](6F-packaged-app-proof.md)
